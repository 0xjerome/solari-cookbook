import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "patchright-core";
import { Budget, Policy, bounded, digest, redact } from "./policy.js";
import type { Evidence, Observation, Signal, Step } from "./schema.js";

export interface Driver {
  observe(): Promise<Observation>;
  execute(step: Step): Promise<void>;
  reset(): Promise<void>;
  signals(): Promise<Signal[]>;
  evidence(name: string): Promise<Evidence>;
  blocked(): boolean;
  clear(): void;
}
export class BrowserDriver implements Driver {
  private failures: Signal[] = [];
  private policyBlocked = false;
  private page!: Page;
  private eventCount = 0;
  private context!: BrowserContext;
  constructor(
    private createContext: () => Promise<BrowserContext>,
    private policy: Policy,
    private budget: Budget,
    private outDir: string,
    private secrets: string[],
    private log: (type: string, message: string) => void,
  ) {}
  async init() {
    this.context = await bounded(this.createContext(), this.budget.signal);
    this.context.setDefaultTimeout(8000);
    this.context.setDefaultNavigationTimeout(10000);
    await this.context.route("**/*", async (route) => {
      const r = route.request();
      let allowed = false;
      try {
        this.budget.take("requests");
        allowed = this.policy.request(r.url(), r.method());
        // No additional pages, frames, or popups, even on the target origin.
        if (r.isNavigationRequest())
          allowed =
            allowed && !!this.page && r.frame() === this.page.mainFrame();
        if (allowed && r.isNavigationRequest()) this.budget.page(r.url());
      } catch {
        allowed = false;
      }
      if (!allowed) {
        this.policyBlocked = true;
        this.budget.counts.skipped!++;
        if (this.eventCount++ < 30)
          this.log(
            "SKIPPED",
            `Request blocked: ${redact(r.method() + " " + r.url(), this.secrets).slice(0, 250)}`,
          );
        await route.abort().catch(() => {});
        return;
      }
      // Fetch without following redirects, then fulfill. Checking page.url() after
      // navigation is too late; a redirect may already have contacted another host.
      try {
        const response = await route.fetch({
          maxRedirects: 0,
          maxRetries: 0,
          timeout: 8000,
        });
        if (response.status() >= 300 && response.status() < 400) {
          this.policyBlocked = true;
          this.budget.counts.skipped!++;
          this.log("SKIPPED", "Redirect blocked before destination request");
          await route.abort();
        } else await route.fulfill({ response });
        await response.dispose();
      } catch {
        this.policyBlocked = true;
        await route.abort().catch(() => {});
      }
    });
    await this.context.routeWebSocket("**/*", (ws) => {
      this.policyBlocked = true;
      this.log("SKIPPED", "WebSocket blocked");
      ws.close();
    });
    this.page = await this.context.newPage();
    this.context.on("page", (page) => {
      if (page !== this.page) void page.close().catch(() => {});
    });
    this.page.on("dialog", (dialog) => {
      this.policyBlocked = true;
      this.log("SKIPPED", "Dialog dismissed");
      void dialog.dismiss().catch(() => {});
    });
    this.page.on("download", (download) => {
      this.policyBlocked = true;
      void download.cancel().catch(() => {});
    });
    this.page.on("response", (r) => {
      if (r.status() === 429) {
        this.budget.stop("target-throttled");
        return;
      }
      if (
        r.status() >= 500 ||
        (r.status() === 404 && r.request().isNavigationRequest())
      ) {
        if (this.failures.length < 10) {
          const u = new URL(r.url());
          this.failures.push({
            kind: "http-error",
            fingerprint: digest(`${r.status()}:${u.pathname}`),
            detail: `HTTP ${r.status()} at ${u.pathname}`,
          });
        }
      }
    });
    this.page.on("pageerror", (error) => {
      if (this.failures.length < 10) {
        const message = redact(error.message, this.secrets).slice(0, 300);
        this.failures.push({
          kind: "runtime-error",
          fingerprint: digest(message),
          detail: message,
        });
      }
    });
  }
  clear() {
    this.failures = [];
    this.policyBlocked = false;
  }
  blocked() {
    return this.policyBlocked;
  }
  async observe(): Promise<Observation> {
    const raw = await bounded(
      this.page.evaluate(() => {
        const elements = Array.from(
          document.querySelectorAll("a[href],button,input,textarea,select"),
        ).slice(0, 100);
        const controls = elements.map((el, i) => {
          const input = el as HTMLInputElement;
          const tag = el.tagName.toLowerCase();
          const label =
            el.getAttribute("aria-label") ||
            ("labels" in input ? input.labels?.[0]?.textContent : "") ||
            el.textContent ||
            input.name ||
            tag;
          return {
            id: `c${i}`,
            kind:
              tag === "a"
                ? "navigate"
                : ["input", "textarea"].includes(tag)
                  ? "fill"
                  : "click",
            label: (label || tag).trim().slice(0, 120),
            href: tag === "a" ? (el as HTMLAnchorElement).href : undefined,
            testId: el.getAttribute("data-testid") || undefined,
            sensitive:
              tag === "input" &&
              ["password", "file", "hidden"].includes(input.type),
          };
        });
        return {
          url: location.href,
          title: document.title,
          text: (document.body?.innerText || "").slice(0, 6000),
          controls,
        };
      }),
      this.budget.signal,
    );
    const controls = raw.controls.map((c) => ({
      ...c,
      href: c.href && this.policy.request(c.href) ? c.href : undefined,
      kind: c.kind as "navigate" | "fill" | "click",
      label: redact(c.label, this.secrets),
      permitted:
        !c.sensitive &&
        !/\b(buy|pay|delete|publish|send|book|order|transfer|invite|password|subscription|billing|remove|purchase)\b/i.test(
          c.label,
        ) &&
        this.policy.control(raw.url, {
          ...c,
          kind: c.kind as "navigate" | "fill" | "click",
        }),
    }));
    return {
      url: redact(raw.url, this.secrets),
      title: redact(raw.title, this.secrets),
      text: redact(raw.text, this.secrets),
      controls,
    };
  }
  async execute(step: Step) {
    this.budget.check();
    if (!this.policy.step(step)) throw new Error("Step rejected by policy");
    if (step.kind !== "navigate" && this.page.url() !== step.url)
      throw new Error("Stale action URL");
    this.clear();
    await this.budget.action();
    if (step.kind === "navigate") {
      this.budget.page(step.href!);
      await bounded(
        this.page.goto(step.href!, { waitUntil: "domcontentloaded" }),
        this.budget.signal,
      );
    } else {
      const locator = this.page.getByTestId(step.testId!);
      if ((await locator.count()) !== 1)
        throw new Error("Control must resolve uniquely");
      // Repeat the policy check against fresh state immediately before interaction.
      const now = await this.observe();
      const control = now.controls.find(
        (c) => c.testId === step.testId && c.kind === step.kind,
      );
      if (!control?.permitted) throw new Error("Control is stale or unsafe");
      if (step.kind === "fill")
        await bounded(locator.fill(step.value!), this.budget.signal);
      else await bounded(locator.click(), this.budget.signal);
    }
    // Bounded observation window, not a claim that all asynchronous work has finished.
    await bounded(
      new Promise((resolve) => setTimeout(resolve, 350)),
      this.budget.signal,
    );
  }
  async reset() {
    await bounded(this.context.close(), this.budget.signal);
    this.clear();
    await this.init();
  }
  async signals() {
    this.budget.check();
    const blank = await bounded(
      this.page.evaluate(
        () =>
          !document.body?.innerText.trim() &&
          !document.querySelector("img,canvas,video,svg,input,button,iframe"),
      ),
      this.budget.signal,
    );
    if (blank && !this.failures.length)
      this.failures.push({
        kind: "blank-page",
        fingerprint: digest(this.page.url() + ":blank"),
        detail:
          "No visible text or common content elements after the observation window",
      });
    return [...this.failures];
  }
  async evidence(name: string): Promise<Evidence> {
    const capturedAt = new Date().toISOString();
    try {
      this.budget.check();
      const text = await bounded(
        this.page.locator("body").innerText(),
        this.budget.signal,
      );
      if (
        this.secrets.filter(Boolean).some((s) => text.includes(s)) ||
        /\b(?:sk-|slr_)[A-Za-z0-9_-]+|Bearer\s+\S+/.test(text)
      )
        return {
          capturedAt,
          captureError: "Screenshot omitted: possible secret in visible text",
        };
      const bytes = await bounded(
        this.page.screenshot({
          fullPage: false,
          mask: [this.page.locator("input,textarea,[data-private]")],
        }),
        this.budget.signal,
      );
      await mkdir(join(this.outDir, "evidence"), {
        recursive: true,
        mode: 0o700,
      });
      const screenshot = `evidence/${name}.png`;
      await writeFile(join(this.outDir, screenshot), bytes, { mode: 0o600 });
      return { capturedAt, screenshot, sha256: digest(bytes) };
    } catch {
      return { capturedAt, captureError: "Screenshot unavailable" };
    }
  }
}
