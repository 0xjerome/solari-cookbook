import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { escapeMarkdown, saveReport } from "../src/report.js";
import type { Report } from "../src/schema.js";
import { parseConfig } from "../src/policy.js";
import { fixtureConfig } from "../fixture/app.js";
test("report redaction preserves valid JSON and neutralizes page-supplied Markdown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qa-report-"));
  try {
    const message = '![remote](https://evil.invalid/) <img src=x> abc"secret';
    const report: Report = {
      schemaVersion: 1,
      runId: "unit",
      mode: "solari",
      target: "https://fixture.example.com/",
      startedAt: "test",
      termination: "completed",
      limits: parseConfig({
        ...fixtureConfig,
        target: "https://fixture.example.com/",
      }).limits,
      counts: {},
      workflows: [],
      findings: [],
      cleanupErrors: [],
      events: [{ at: "test", type: "WARNING", message }],
    };
    await saveReport(report, dir, ['abc"secret']);
    const json = await readFile(join(dir, "report.json"), "utf8");
    assert.ok(!json.includes("secret"));
    assert.ok(JSON.parse(json).events[0].message.includes("[REDACTED]"));
    const md = await readFile(join(dir, "report.md"), "utf8");
    assert.ok(!md.includes("<img"));
    assert.ok(md.includes("\\!\\[remote\\]"));
    assert.ok(escapeMarkdown(message).startsWith("\\!"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
