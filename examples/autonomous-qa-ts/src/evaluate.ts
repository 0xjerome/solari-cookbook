import { readFile, writeFile } from "node:fs/promises";
import { groundTruth } from "../fixture/app.js";
import type { Report } from "./schema.js";
const files = process.argv.slice(2);
if (!files.length)
  throw new Error("Usage: npm run evaluate -- runs/<id>/report.json");
const runs: Report[] = await Promise.all(
  files.map(async (file) => JSON.parse(await readFile(file, "utf8")) as Report),
);
if (
  runs.some(
    (r) =>
      r.schemaVersion !== 1 ||
      r.mode !== "solari" ||
      r.dataset !== "fieldnotes-v1" ||
      !r.sessionId,
  )
)
  throw new Error("Evaluation requires actual Solari reports");
const metrics = runs.map((r) => {
  const confirmed = r.findings.filter((f) => f.status === "CONFIRMED");
  const matched = groundTruth.filter((b) =>
    confirmed.some(
      (f) =>
        f.signal.kind === "http-error" &&
        f.signal.detail === `HTTP ${b.status} at ${b.path}`,
    ),
  );
  return {
    runId: r.runId,
    workflowsAttempted: r.workflows.length,
    actions: r.counts.actions,
    knownBugsDetected: matched.length,
    confirmedBugs: confirmed.length,
    unmatchedConfirmedFindings: confirmed.filter(
      (f) =>
        !groundTruth.some(
          (b) => f.signal.detail === `HTTP ${b.status} at ${b.path}`,
        ),
    ).length,
    knownBugsNotConfirmed: groundTruth.length - matched.length,
    durationMs: r.finishedAt
      ? Date.parse(r.finishedAt) - Date.parse(r.startedAt)
      : null,
    termination: r.termination,
    policySkips: r.counts.skipped,
    unsafeActionsPrevented:
      "requires fixture-side audit; not inferred from skip count",
  };
});
const output = {
  dataset: "synthetic fixture only; do not use for arbitrary applications",
  runs: metrics,
  notes:
    "Unmatched findings require human adjudication before calling them false positives. Missing bugs on incomplete runs are not clean false-negative estimates. Workflow success is not inferred from actions.",
};
await writeFile("evaluation.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));
