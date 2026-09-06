import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Report } from "./schema.js";
import { redact } from "./policy.js";
export function escapeMarkdown(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]#!|]/g, "\\$&");
}
export function sanitizeReport(report: Report, secrets: string[] = []): Report {
  return JSON.parse(
    JSON.stringify(report, (_key, value) =>
      typeof value === "string" ? redact(value, secrets) : value,
    ),
  ) as Report;
}
export async function saveReport(
  report: Report,
  dir: string,
  secrets: string[] = [],
) {
  const safe = sanitizeReport(report, secrets);
  await writeFile(
    join(dir, "report.json"),
    JSON.stringify(safe, null, 2) + "\n",
    { mode: 0o600 },
  );
  const lines = [
    "# Solari QA report",
    `Run: ${safe.runId}`,
    `Target: ${safe.target}`,
    `Termination: ${safe.termination}`,
    `Actions: ${safe.counts.actions}; model calls: ${safe.counts.modelCalls}; workflows attempted: ${safe.workflows.length}`,
    "\nExecuted actions are not equivalent to passed tests. Policy blocks and infrastructure errors are not application bugs.",
  ];
  for (const f of safe.findings) {
    lines.push(
      `\n## ${f.id} — ${f.status}`,
      escapeMarkdown(f.title),
      `Severity: ${f.severity}`,
      `URL: ${escapeMarkdown(f.url)}`,
      `Expected (agent hypothesis): ${escapeMarkdown(f.expected)}`,
      `Observed: ${escapeMarkdown(f.actual)}`,
      "\nSteps:",
      ...f.steps.map(
        (s, i) =>
          `${i + 1}. ${s.kind} ${escapeMarkdown(s.href || s.testId || s.url)}${s.value ? ` using ${s.value}` : ""}`,
      ),
      `Reproduced: ${f.reproductions.filter((a) => a.matched).length}/${f.reproductions.length} attempts`,
      f.evidence.screenshot
        ? `Evidence: [screenshot](${f.evidence.screenshot}) — SHA-256 ${f.evidence.sha256}`
        : `Evidence: ${f.evidence.captureError}`,
      f.confirmationRule,
    );
  }
  lines.push(
    "\n## Run log",
    ...safe.events.map(
      (e) => `- ${e.at} ${e.type}: ${escapeMarkdown(e.message)}`,
    ),
    "\n## Limitations",
    "This is bounded functional QA, not a security audit. Read routes and controls are owner-approved. Screenshots mask inputs and marked private regions; arbitrary sensitive page content cannot be perfectly detected.",
    ...safe.cleanupErrors.map((e) => `Cleanup warning: ${e}`),
  );
  await writeFile(join(dir, "report.md"), lines.join("\n\n") + "\n", {
    mode: 0o600,
  });
}
