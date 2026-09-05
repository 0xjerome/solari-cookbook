import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "patchright-core";
import { BrowserDriver } from "../src/browser.js";
import { Budget, Policy, parseConfig, digest } from "../src/policy.js";
import { fixtureServer, fixtureConfig } from "../fixture/app.js";
import { reproduce } from "../src/engine.js";

test(
  "real browser: search failure, independent reproduction, screenshot integrity and unsafe control blocking",
  { skip: process.env.QA_BROWSER_TESTS !== "1" },
  async () => {
    const browser = await chromium.launch({
      channel: process.env.QA_BROWSER_CHANNEL || "chrome",
      headless: true,
    });
    const { server, counters } = fixtureServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const target = `http://127.0.0.1:${address.port}/`;
    const config = parseConfig({ ...fixtureConfig, target });
    const budget = new Budget({ ...config.limits, actionIntervalMs: 250 });
    const dir = await mkdtemp(join(tmpdir(), "solari-qa-test-"));
    const d = new BrowserDriver(
      () =>
        browser.newContext({ serviceWorkers: "block", acceptDownloads: false }),
      new Policy(config),
      budget,
      dir,
      [],
      () => {},
    );
    try {
      await d.init();
      const initial = {
        url: target,
        kind: "navigate" as const,
        href: target,
        expected: "Home loads",
      };
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
      await assert.rejects(
        d.execute({
          kind: "click",
          url: target,
          testId: "delete",
          expected: "Forbidden",
        }),
        /policy/,
      );
      const steps = [
        initial,
        {
          kind: "navigate" as const,
          url: target,
          href: target + "catalog",
          expected: "Catalog opens",
        },
        {
          kind: "fill" as const,
          url: target + "catalog",
          testId: "query",
          value: "qa-test" as const,
          expected: "Synthetic query entered",
        },
        {
          kind: "click" as const,
          url: target + "catalog",
          testId: "search",
          expected: "Search results load",
        },
      ];
      for (const step of steps.slice(1)) await d.execute(step);
      const signals = await d.signals();
      assert.equal(signals[0]?.detail, "HTTP 500 at /search");
      const attempts = await reproduce(d, steps, signals[0]!, budget);
      assert.equal(attempts.length, 2);
      assert.ok(attempts.every((a) => a.matched));
      const evidence = await d.evidence("test");
      assert.ok(evidence.screenshot);
      assert.equal(
        digest(await readFile(join(dir, evidence.screenshot))),
        evidence.sha256,
      );
      assert.equal(counters.danger, 0);
    } finally {
      budget.dispose();
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
