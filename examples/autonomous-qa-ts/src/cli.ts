import { openSession } from "./session.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Solari, type BrowserSession } from "@solarisdk/browser";
import { parseConfig, Policy, Budget, bounded, digest } from "./policy.js";
import { BrowserDriver } from "./browser.js";
import { ModelPlanner } from "./planner.js";
import { runEngine } from "./engine.js";
import { saveReport } from "./report.js";
import type { Report } from "./schema.js";
import { deployFixture } from "./deploy-fixture.js";

export async function main() {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const args = process.argv.slice(2);
  const demo = args.includes("--demo");
  const configPath = args.find((a) => !a.startsWith("--"));
  if (!demo && !configPath)
    throw new Error("Usage: npm start -- --demo OR npm start -- config.json");
  const apiKey = process.env.SOLARI_API_KEY;
  const modelKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.QA_MODEL;
  if (!apiKey || !modelKey || !model)
    throw new Error(
      "Set SOLARI_API_KEY, ANTHROPIC_API_KEY and QA_MODEL in the ignored .env file before running",
    );
  const secrets = [apiKey, modelKey];
  let fixture: Awaited<ReturnType<typeof deployFixture>> | undefined;
  let config = demo
    ? undefined
    : parseConfig(JSON.parse(await readFile(resolve(configPath!), "utf8")));
  // Provisioning is bounded separately; it cannot consume the entire QA run budget.
  if (demo) {
    console.log("Provisioning isolated synthetic fixture in Solari");
    fixture = await deployFixture(apiKey);
    config = fixture.config;
  }
  if (!config) throw new Error("Missing configuration");
  if (
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(config.target).hostname,
    )
  ) {
    await fixture?.close();
    throw new Error(
      "Solari cloud browsers cannot reach this local server. Use --demo or an authorized HTTPS deployment.",
    );
  }
  const budget = new Budget(config.limits);
  const runId = randomUUID();
  const dir = resolve("runs", runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const report: Report = {
    schemaVersion: 1,
    runId,
    mode: "solari",
    startedAt: new Date().toISOString(),
    target: config.target,
    termination: "starting",
    ...(demo ? { dataset: "fieldnotes-v1" as const } : {}),
    limits: config.limits,
    counts: budget.counts,
    workflows: [],
    findings: [],
    events: [],
    cleanupErrors: [],
  };
  const log = (type: string, message: string) => {
    report.events.push({ at: new Date().toISOString(), type, message });
    console.log(`${type}: ${message}`);
  };
  const client = new Solari({ apiKey, maxAttempts: 1, timeoutMs: 10000 });
  let browser: BrowserSession | undefined;
  const cancel = () => budget.stop("cancelled");
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const launch = openSession(client, budget.signal);
    // A launch that finishes after cancellation must still be released.
    void launch
      .then(async (b) => {
        if (budget.signal.aborted) await b.close();
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
        await fixture?.authorize(context);
        return context;
      },
      new Policy(config),
      budget,
      dir,
      secrets,
      log,
    );
    await bounded(driver.init(), budget.signal);
    await runEngine(
      driver,
      new ModelPlanner(modelKey, model, budget),
      new Policy(config),
      budget,
      report,
      secrets,
      (e) => console.log(`${e.type}: ${e.message}`),
    );
  } catch {
    report.termination = budget.signal.aborted
      ? String(budget.signal.reason?.message || "cancelled")
      : "infrastructure-error";
  } finally {
    budget.dispose();
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    for (const [name, close] of [
      ["browser", () => browser?.close()],
      ["client", () => client.close()],
      ["fixture", () => fixture?.close()],
    ] as const) {
      try {
        await bounded(Promise.resolve(close()), AbortSignal.timeout(15000));
      } catch {
        report.cleanupErrors.push(
          `${name} release not verified; inspect Solari console`,
        );
      }
    }
    report.finishedAt = new Date().toISOString();
    await saveReport(report, dir, secrets);
    console.log(`Report: ${dir}/report.md`);
    console.log(`Termination: ${report.termination}`);
    if (report.termination !== "completed" || report.cleanupErrors.length)
      process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error &&
      /^(Usage:|Set |Solari cloud|Target |Missing)/.test(error.message)
      ? error.message
      : "Setup failed; verify configuration and service availability. No credentials were logged.",
  );
  process.exitCode = 1;
});
