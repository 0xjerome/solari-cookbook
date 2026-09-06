import { openSession } from "../src/session.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Solari, type BrowserSession } from "@solarisdk/browser";
import { deployFixture } from "../src/deploy-fixture.js";
import { BrowserDriver } from "../src/browser.js";
import { Budget, Policy, bounded, digest, redact } from "../src/policy.js";
import { reproduce } from "../src/engine.js";
import type { Step } from "../src/schema.js";

test(
  "Solari cloud integration (scripted, no model): observe, interact, reproduce, capture evidence",
  { skip: process.env.QA_SOLARI_TESTS !== "1", timeout: 240000 },
  async () => {
    process.loadEnvFile(".env");
    const apiKey = process.env.SOLARI_API_KEY;
    assert.ok(apiKey, "SOLARI_API_KEY required");
    const dir = resolve("runs", `integration-${randomUUID()}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const startedAt = new Date().toISOString();
    let fixture: Awaited<ReturnType<typeof deployFixture>> | undefined;
    let browser: BrowserSession | undefined;
    let budget: Budget | undefined;
    const client = new Solari({ apiKey, maxAttempts: 1, timeoutMs: 10000 });
    const result: Record<string, unknown> = {
      mode: "scripted-solari-integration",
      autonomous: false,
      startedAt,
      passed: false,
    };
    try {
      fixture = await deployFixture(apiKey, (stage) => {
        result.stage = stage;
        console.log(stage);
      });
      const config = fixture.config;
      budget = new Budget(config.limits);
      result.stage = "browser-launch";
      browser = await bounded(
        openSession(client, budget.signal),
        budget.signal,
      );
      result.sessionId = "sha256:" + digest(browser.id);
      result.target = config.target;
      const d = new BrowserDriver(
        async () => {
          const context = await browser!.newContext({
            serviceWorkers: "block",
            acceptDownloads: false,
          });
          await fixture!.authorize(context);
          return context;
        },
        new Policy(config),
        budget,
        dir,
        [apiKey],
        () => {},
      );
      result.stage = "browser-init";
      await d.init();
      const initial: Step = {
        kind: "navigate",
        url: config.target,
        href: config.target,
        expected: "Home loads",
      };
      result.stage = "initial-navigation";
      await d.execute(initial);
      const observation = await d.observe();
      assert.equal(
        observation.controls.find((c) => c.testId === "delete")?.permitted,
        false,
      );
      assert.equal(
        observation.controls.find((c) => c.label === "External partner")
          ?.permitted,
        false,
      );
      const catalog = new URL("/catalog", config.target).href;
      const steps: Step[] = [
        initial,
        {
          kind: "navigate",
          url: config.target,
          href: catalog,
          expected: "Catalog opens",
        },
        {
          kind: "fill",
          url: catalog,
          testId: "query",
          value: "qa-test",
          expected: "Synthetic query entered",
        },
        {
          kind: "click",
          url: catalog,
          testId: "search",
          expected: "Search results load",
        },
      ];
      for (const step of steps.slice(1)) {
        result.stage = step.kind;
        await d.execute(step);
      }
      const signals = await d.signals();
      const signal = signals.find((s) => s.detail === "HTTP 500 at /search");
      assert.ok(signal, "Expected fixture search failure");
      result.stage = "reproduction";
      const attempts = await reproduce(d, steps, signal, budget);
      assert.equal(attempts.length, 2);
      assert.ok(attempts.every((a) => a.matched));
      const evidence = await d.evidence("search-failure");
      assert.ok(evidence.screenshot, evidence.captureError);
      assert.equal(
        digest(await readFile(join(dir, evidence.screenshot))),
        evidence.sha256,
      );
      result.stage = "network-safety";
      await d.reset();
      await assert.rejects(
        d.execute({
          kind: "navigate",
          url: config.target,
          href: new URL("/redirect", config.target).href,
          expected: "Redirect must be blocked",
        }),
      );
      assert.equal(d.blocked(), true);
      await d.reset();
      await d.execute({
        kind: "navigate",
        url: config.target,
        href: new URL("/network-guard", config.target).href,
        expected: "Unsafe background requests must be blocked",
      });
      assert.equal(d.blocked(), true);
      const audit = await fixture.audit();
      assert.equal(
        audit.filter((r) => r.path === "/danger" || r.method === "POST").length,
        0,
      );
      result.safetyChecks = {
        redirectBlocked: true,
        backgroundRequestsBlocked: true,
        dangerEndpointRequests: 0,
      };
      result.passed = true;
      result.reproductions = attempts;
      result.evidence = evidence;
      result.counts = budget.counts;
    } catch (error) {
      const e = error as {
        name?: string;
        status?: number;
        code?: string;
        message?: string;
      };
      result.diagnostic = redact(
        (e.message || "").replace(/https?:\/\/\S+/g, "[URL]"),
        [apiKey],
      );
      result.errorName = e.name;
      result.httpStatus = e.status;
      result.errorCode = e.code;
      console.log({
        diagnostic: result.diagnostic,
        stage: result.stage,
        name: e.name,
        status: e.status,
        code: e.code,
      });
      result.failure =
        "Integration failed; inspect service availability and SDK compatibility. Secrets omitted.";
      throw new Error(String(result.failure));
    } finally {
      budget?.dispose();
      const cleanup: string[] = [];
      for (const [name, close] of [
        ["browser", () => browser?.close()],
        ["client", () => client.close()],
        ["fixture", () => fixture?.close()],
      ] as const) {
        try {
          await bounded(Promise.resolve(close()), AbortSignal.timeout(15000));
        } catch {
          cleanup.push(name);
        }
      }
      result.cleanupUnverified = cleanup;
      result.finishedAt = new Date().toISOString();
      await writeFile(
        join(dir, "integration.json"),
        JSON.stringify(result, null, 2) + "\n",
        { mode: 0o600 },
      );
      console.log(`Integration evidence: ${dir}`);
      assert.equal(cleanup.length, 0, "Remote cleanup must be verified");
    }
  },
);
