import { readFile } from "node:fs/promises";
import { executeRun } from "./runner.js";
import { readSettings, UserError } from "./settings.js";
async function main() {
  const args = process.argv.slice(2);
  const demo = args.includes("--demo");
  const file = args.find((a) => !a.startsWith("--"));
  if (!demo && !file)
    throw new UserError(
      "Usage: npm start -- --demo [--healthy] OR npm start -- config.json",
    );
  const cancel = new AbortController();
  const stop = () => cancel.abort(new Error("cancelled"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const { report, dir } = await executeRun(await readSettings(), {
      demo,
      healthy: args.includes("--healthy"),
      config: file ? JSON.parse(await readFile(file, "utf8")) : undefined,
      signal: cancel.signal,
      onEvent: (e) => console.log(`${e.type}: ${e.message}`),
    });
    console.log(`Report: ${dir}/report.md\nTermination: ${report.termination}`);
    if (report.termination !== "completed" || report.cleanupErrors.length)
      process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
main().catch((error) => {
  console.error(
    error instanceof UserError
      ? error.message
      : "Run setup failed. Check configuration and service availability; credentials were not logged.",
  );
  process.exitCode = 1;
});
