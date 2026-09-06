import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Solari, type BrowserSession } from "@solarisdk/browser";
import { openSession } from "./session.js";
import {
  parseConfig,
  Policy,
  Budget,
  bounded,
  digest,
  redact,
} from "./policy.js";
import { BrowserDriver } from "./browser.js";
import { ModelPlanner } from "./planner.js";
import { runEngine } from "./engine.js";
import { saveReport, sanitizeReport } from "./report.js";
import { deployFixture } from "./deploy-fixture.js";
import {
  requireSettings,
  verifyModel,
  UserError,
  type Settings,
} from "./settings.js";
import type { Report, Event } from "./schema.js";
export type RunOptions = {
  demo?: boolean;
  healthy?: boolean;
  config?: unknown;
  runId?: string;
  signal?: AbortSignal;
  onEvent?: (e: Event) => void;
};
export async function executeRun(
  settings: Settings,
  options: RunOptions,
): Promise<{ report: Report; dir: string }> {
  requireSettings(settings);
  const signal = options.signal || new AbortController().signal;
  // Preflight before spending on remote sessions.
  await verifyModel(settings, signal);
  let config = options.demo ? undefined : parseConfig(options.config);
  if (
    config &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(config.target).hostname,
    )
  )
    throw new UserError(
      "Use the isolated demo or an authorized HTTPS deployment; cloud browsers cannot access your laptop localhost.",
    );
  const runId = options.runId || randomUUID();
  const dir = resolve("runs", runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const secrets = [
    settings.solariKey,
    settings.modelKey,
    settings.githubToken || "",
  ];
  const events: Event[] = [];
  const log = (type: string, message: string) => {
    const e = {
      at: new Date().toISOString(),
      type,
      message: redact(message, secrets),
    };
    events.push(e);
    options.onEvent?.(e);
  };
  let fixture: Awaited<ReturnType<typeof deployFixture>> | undefined;
  let browser: BrowserSession | undefined;
  let budget: Budget | undefined;
  let report: Report | undefined;
  const client = new Solari({
    apiKey: settings.solariKey,
    maxAttempts: 1,
    timeoutMs: 10000,
  });
  const cancel = () => budget?.stop("cancelled");
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (options.demo) {
      fixture = await deployFixture(
        settings.solariKey,
        (stage) => log("SETUP", stage),
        signal,
        options.healthy,
      );
      config = fixture.config;
    }
    if (!config) throw new UserError("Missing target configuration");
    signal.throwIfAborted();
    budget = new Budget(config.limits);
    report = {
      schemaVersion: 1,
      runId,
      mode: "solari",
      model: { provider: settings.provider || "anthropic", id: settings.model },
      startedAt: new Date().toISOString(),
      target: config.target,
      termination: "starting",
      ...(options.demo
        ? {
            dataset: options.healthy
              ? ("fieldnotes-healthy-v1" as const)
              : ("fieldnotes-v1" as const),
          }
        : {}),
      limits: config.limits,
      counts: budget.counts,
      workflows: [],
      findings: [],
      events,
      cleanupErrors: [],
    };
    const launch = openSession(client, budget.signal);
    void launch
      .then(async (b) => {
        if (budget!.signal.aborted) await b.close();
      })
      .catch(() => {});
    browser = await bounded(launch, budget.signal);
    report.sessionId = "sha256:" + digest(browser.id);
    log("SESSION", "Solari browser launched");
    const driver = new BrowserDriver(
      async () => {
        const context = await browser!.newContext({
          serviceWorkers: "block",
          acceptDownloads: false,
          viewport: { width: 1280, height: 800 },
        });
        try {
          await fixture?.authorize(context);
          return context;
        } catch (error) {
          await context.close();
          throw error;
        }
      },
      new Policy(config),
      budget,
      dir,
      secrets,
      log,
    );
    await bounded(driver.init(), budget.signal);
    // engine writes events into the same report; only forward its notifications.
    await runEngine(
      driver,
      new ModelPlanner(
        settings.modelKey,
        settings.model,
        budget,
        settings.provider,
      ),
      new Policy(config),
      budget,
      report,
      secrets,
      options.onEvent,
    );
    if (fixture) {
      const audit = await bounded(fixture.audit(), AbortSignal.timeout(5000));
      report.fixtureAudit = {
        dangerRequests: audit.filter(
          (r) => r.path === "/danger" || r.method === "POST",
        ).length,
      };
    }
  } catch (error) {
    if (!report) throw error;
    report.termination = budget?.signal.aborted
      ? String(budget.signal.reason?.message || "cancelled")
      : "infrastructure-error";
    log(
      "WARNING",
      error instanceof UserError ? error.message : report.termination,
    );
  } finally {
    budget?.dispose();
    signal.removeEventListener("abort", cancel);
    const cleanupErrors: string[] = [];
    for (const [name, close] of [
      ["browser", () => browser?.close()],
      ["client", () => client.close()],
      ["fixture", () => fixture?.close()],
    ] as const) {
      try {
        await bounded(Promise.resolve(close()), AbortSignal.timeout(15000));
      } catch {
        cleanupErrors.push(
          `${name} release unverified; inspect Solari console`,
        );
      }
    }
    if (report) {
      report.cleanupErrors = cleanupErrors;
      report.finishedAt = new Date().toISOString();
      await saveReport(report, dir, secrets);
    } else if (cleanupErrors.length)
      throw new UserError(cleanupErrors.join("; "));
  }
  if (!report) throw new UserError("Run did not start");
  return { report: sanitizeReport(report, secrets), dir };
}
