import { randomUUID } from "node:crypto";
import { digest, redact } from "./policy.js";
import { escapeMarkdown } from "./report.js";
import { UserError } from "./settings.js";
import type { Report } from "./schema.js";
export type Draft = {
  id: string;
  repository: string;
  title: string;
  body: string;
  hash: string;
  state: "draft" | "publishing" | "published" | "uncertain";
  url?: string;
};
const repositoryPattern =
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
export function createDraft(
  report: Report,
  findingId: string,
  repository: string,
  secrets: string[] = [],
): Draft {
  if (!repositoryPattern.test(repository))
    throw new UserError("Enter a GitHub repository as owner/name.");
  const f = report.findings.find((f) => f.id === findingId);
  if (!f || f.status !== "CONFIRMED")
    throw new UserError("Only a confirmed finding can become an issue draft.");
  const text = (s: string) => escapeMarkdown(redact(s, secrets));
  const title = redact(`[QA] ${f.title}`, secrets)
    .replace(/[\r\n]/g, " ")
    .slice(0, 200);
  const body = [
    `## Observed failure\n\n${text(f.actual)}`,
    `Severity: ${f.severity} (provisional)`,
    `URL: ${text(f.url)}`,
    `## Steps to reproduce\n\n${f.steps.map((s, i) => `${i + 1}. ${text(s.kind + " " + (s.href || s.testId || s.url) + (s.value ? " using " + s.value : ""))}`).join("\n")}`,
    `Expected (agent hypothesis): ${text(f.expected)}`,
    `Reproduced: ${f.reproductions.filter((a) => a.matched).length}/${f.reproductions.length} attempts.`,
    `## Evidence\n\nScreenshot: ${text(f.evidence.screenshot || "unavailable")}\n\nSHA-256: ${f.evidence.sha256 || "unavailable"}\n\nThe screenshot is a local artifact; attach it manually after reviewing it. It is not uploaded automatically.`,
    `Run: ${report.runId}\n\nCaptured: ${f.evidence.capturedAt}\n\n${text(f.confirmationRule)}`,
  ].join("\n\n");
  return {
    id: randomUUID(),
    repository,
    title,
    body,
    hash: digest(JSON.stringify({ repository, title, body })),
    state: "draft",
  };
}
export async function publishDraft(
  draft: Draft,
  approval: { approved: boolean; hash: string },
  token: string,
  send: typeof fetch = fetch,
): Promise<string> {
  if (!approval.approved || approval.hash !== draft.hash)
    throw new UserError("Approve the exact draft shown before publishing.");
  if (draft.state !== "draft")
    throw new UserError(
      "This draft was already submitted or its outcome is uncertain. Check GitHub before trying again.",
    );
  if (!token)
    throw new UserError(
      "Set GITHUB_TOKEN locally to publish, or copy the draft to GitHub manually.",
    );
  draft.state = "publishing";
  try {
    const r = await send(
      `https://api.github.com/repos/${draft.repository}/issues`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({ title: draft.title, body: draft.body }),
      },
    );
    if (!r.ok) {
      await r.body?.cancel();
      throw new UserError(
        `GitHub returned HTTP ${r.status}. Check the repository before retrying; no automatic retry was made.`,
      );
    }
    const data = (await r.json()) as { html_url?: string };
    if (
      !data.html_url?.startsWith(
        `https://github.com/${draft.repository}/issues/`,
      )
    )
      throw new UserError(
        "GitHub returned an unexpected result. Check the repository manually.",
      );
    draft.url = data.html_url;
    draft.state = "published";
    return data.html_url;
  } catch (error) {
    draft.state = "uncertain";
    throw error instanceof UserError
      ? error
      : new UserError(
          "Issue creation outcome is uncertain. Check GitHub; the request will not be retried automatically.",
        );
  }
}
