import { test } from "node:test";
import assert from "node:assert/strict";
import { createDraft, publishDraft } from "../src/issues.js";
import { parseConfig } from "../src/policy.js";
import type { Report } from "../src/schema.js";
const report: Report = {
  schemaVersion: 1,
  runId: "unit",
  mode: "solari",
  startedAt: "test",
  target: "https://fixture.example.com/",
  termination: "completed",
  limits: parseConfig({
    target: "https://fixture.example.com/",
    authorized: true,
    safeReadPaths: ["/"],
  }).limits,
  counts: {},
  workflows: [],
  events: [],
  cleanupErrors: [],
  findings: [
    {
      id: "BUG-001",
      status: "CONFIRMED",
      severity: "medium",
      title: "500 secret-value",
      url: "https://fixture.example.com/",
      signal: { kind: "http-error", fingerprint: "unit", detail: "HTTP 500" },
      expected: "Load",
      actual: "![unsafe](https://evil.invalid/) secret-value",
      steps: [],
      reproductions: [{ matched: true }],
      evidence: { capturedAt: "test" },
      confirmationRule: "Repeated",
    },
  ],
};
test("issue draft is local, redacted, and only accepts confirmed findings", () => {
  const d = createDraft(report, "BUG-001", "owner/repo", ["secret-value"]);
  assert.equal(d.state, "draft");
  assert.ok(!d.body.includes("secret-value"));
  assert.ok(!d.title.includes("secret-value"));
  assert.ok(d.body.includes("\\!\\[unsafe"));
  assert.throws(() => createDraft(report, "missing", "owner/repo"));
  assert.throws(() => createDraft(report, "BUG-001", "https://evil.invalid/"));
});
test("publication requires exact approval and prevents duplicate requests", async () => {
  const d = createDraft(report, "BUG-001", "owner/repo");
  let requests = 0;
  const send: typeof fetch = async (url, init) => {
    requests++;
    assert.equal(url, "https://api.github.com/repos/owner/repo/issues");
    assert.equal(JSON.parse(String(init?.body)).body, d.body);
    return new Response(
      JSON.stringify({ html_url: "https://github.com/owner/repo/issues/1" }),
    );
  };
  await assert.rejects(
    publishDraft(d, { approved: false, hash: d.hash }, "unit", send),
  );
  await assert.rejects(
    publishDraft(d, { approved: true, hash: "wrong" }, "unit", send),
  );
  assert.equal(requests, 0);
  assert.equal(
    await publishDraft(d, { approved: true, hash: d.hash }, "unit", send),
    "https://github.com/owner/repo/issues/1",
  );
  await assert.rejects(
    publishDraft(d, { approved: true, hash: d.hash }, "unit", send),
  );
  assert.equal(requests, 1);
});
test("ambiguous issue creation is never retried automatically", async () => {
  const d = createDraft(report, "BUG-001", "owner/repo");
  let requests = 0;
  const send: typeof fetch = async () => {
    requests++;
    throw new Error("timeout");
  };
  await assert.rejects(
    publishDraft(d, { approved: true, hash: d.hash }, "unit", send),
  );
  assert.equal(d.state, "uncertain");
  await assert.rejects(
    publishDraft(d, { approved: true, hash: d.hash }, "unit", send),
  );
  assert.equal(requests, 1);
});
