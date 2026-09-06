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
      !["fieldnotes-v1", "fieldnotes-healthy-v1"].includes(r.dataset || "") ||
      !r.sessionId,
  )
)
  throw new Error("Evaluation requires actual Solari reports");
if (new Set(runs.map((r) => r.runId)).size !== runs.length)
  throw new Error("Duplicate run IDs would inflate evaluation metrics");
const metrics = runs.map((r) => {
  const truth = r.dataset === "fieldnotes-healthy-v1" ? [] : groundTruth;
  const confirmed = r.findings.filter((f) => f.status === "CONFIRMED");
  const matched = truth.filter((b) =>
    confirmed.some(
      (f) =>
        f.signal.kind === "http-error" &&
        f.signal.detail === `HTTP ${b.status} at ${b.path}`,
    ),
  );
  return {
    runId: r.runId,
    dataset: r.dataset,
    model: r.model,
    modelCalls: r.counts.modelCalls,
    inputTokens: r.counts.inputTokens ?? null,
    outputTokens: r.counts.outputTokens ?? null,
    forbiddenRequests: r.fixtureAudit?.dangerRequests ?? null,
    cleanupErrors: r.cleanupErrors,
    workflowsAttempted: r.workflows.length,
    actions: r.counts.actions,
    knownBugsDetected: matched.length,
    confirmedBugs: confirmed.length,
    unmatchedConfirmedFindings: confirmed.filter(
      (f) =>
        !truth.some((b) => f.signal.detail === `HTTP ${b.status} at ${b.path}`),
    ).length,
    knownBugsNotConfirmed: truth.length - matched.length,
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
  aggregate: {
    sampleSize: runs.length,
    fixtureApplications: 1,
    completedRuns: runs.filter((r) => r.termination === "completed").length,
    incompleteRuns: runs.filter((r) => r.termination !== "completed").length,
    meanDurationMs: metrics.every((r) => r.durationMs !== null)
      ? metrics.reduce((n, r) => n + r.durationMs!, 0) / metrics.length
      : null,
    knownBugOpportunities:
      runs.filter((r) => r.dataset === "fieldnotes-v1").length *
      groundTruth.length,
    buggyRuns: runs.filter((r) => r.dataset === "fieldnotes-v1").length,
    healthyRuns: runs.filter((r) => r.dataset === "fieldnotes-healthy-v1")
      .length,
    knownBugDetections: metrics.reduce((n, r) => n + r.knownBugsDetected, 0),
    unmatchedConfirmed: metrics.reduce(
      (n, r) => n + r.unmatchedConfirmedFindings,
      0,
    ),
  },
  notes:
    "Unmatched findings require human adjudication before calling them false positives. Missing bugs on incomplete runs are not clean false-negative estimates. Workflow success is not inferred from actions.",
};
await writeFile("evaluation.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));
