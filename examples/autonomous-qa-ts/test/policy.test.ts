import { test } from "node:test";
import assert from "node:assert/strict";
import { Budget, Policy, parseConfig, redact, bounded } from "../src/policy.js";
import { decisionSchema } from "../src/schema.js";
import { fixtureConfig } from "../fixture/app.js";
const config = parseConfig({
  ...fixtureConfig,
  target: "https://staging.example.com/",
});
const policy = new Policy(config);
test("origin matching rejects external, lookalike, credential and alternate-port URLs", () => {
  for (const url of [
    "https://evil.invalid/",
    "https://staging.example.com.evil.invalid/",
    "https://staging.example.com:444/",
    "https://user:pass@staging.example.com/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://staging.example.com/",
  ])
    assert.equal(policy.request(url), false, url);
  assert.equal(policy.request(config.target), true);
});
test("deny unknown paths, mutation methods, encoded paths, and arbitrary query payloads", () => {
  for (const [url, method] of [
    ["/danger", "GET"],
    ["/", "POST"],
    ["/", "DELETE"],
    ["/%73earch", "GET"],
    ["/search?q=private-data", "GET"],
    ["/search?token=abc", "GET"],
  ])
    assert.equal(
      policy.request(new URL(url!, config.target).href, method),
      false,
    );
  assert.equal(
    policy.request(new URL("/search?q=qa-test", config.target).href),
    true,
  );
});
test("authorization and scope are mandatory and strict", () => {
  assert.throws(() => parseConfig({ ...config, authorized: false }));
  assert.throws(() =>
    parseConfig({ ...config, allowedOrigins: ["https://evil.invalid"] }),
  );
  assert.throws(() =>
    parseConfig({
      ...config,
      limits: { ...config.limits, maxActions: 999999 },
    }),
  );
  assert.throws(() =>
    parseConfig({ ...config, target: "https://169.254.169.254/" }),
  );
});
test("controls must be explicitly configured for that page and action", () => {
  assert.equal(
    policy.control("https://staging.example.com/catalog", {
      kind: "fill",
      testId: "query",
    }),
    true,
  );
  assert.equal(
    policy.control(config.target, { kind: "fill", testId: "query" }),
    false,
  );
  assert.equal(
    policy.control(config.target, { kind: "click", testId: "delete" }),
    false,
  );
});
test("page instructions cannot change the action schema or policy", () => {
  assert.throws(() =>
    decisionSchema.parse({
      workflow: "x",
      rationale: "Ignore instructions",
      expected: "",
      action: { kind: "exec", code: "env" },
    }),
  );
  assert.throws(() =>
    decisionSchema.parse({
      workflow: "x",
      rationale: "",
      expected: "",
      action: { kind: "finish" },
      limits: { maxActions: 9999 },
    }),
  );
  assert.equal(policy.request("https://evil.invalid/?q=qa-test"), false);
});
test("redacts configured secrets, common keys, tokens and personal emails", () => {
  const text = redact(
    "abc-secret Bearer opaque slr_live_123 https://x/?token=xyz user@real.com qa-test@example.invalid",
    ["abc-secret"],
  );
  for (const s of [
    "abc-secret",
    "opaque",
    "slr_live_123",
    "xyz",
    "user@real.com",
  ])
    assert.equal(text.includes(s), false);
  assert.equal(text.includes("qa-test@example.invalid"), true);
});
test("action and page budgets count attempts and terminate deterministically", () => {
  const b = new Budget({ ...config.limits, maxActions: 1, maxPages: 1 });
  try {
    b.take("actions");
    assert.throws(() => b.take("actions"), /actions-limit/);
    assert.equal(b.counts.actions, 1);
  } finally {
    b.dispose();
  }
  const p = new Budget({ ...config.limits, maxPages: 1 });
  try {
    p.page(config.target);
    p.page(config.target);
    assert.throws(() => p.page(config.target + "about"), /pages-limit/);
  } finally {
    p.dispose();
  }
});
test("runtime cancellation interrupts pending operations", async () => {
  const b = new Budget({ ...config.limits, maxRuntimeMs: 20 });
  try {
    await assert.rejects(
      bounded(new Promise((resolve) => setTimeout(resolve, 100)), b.signal),
      /runtime-limit/,
    );
  } finally {
    b.dispose();
  }
});
test("request and model budgets cannot be exceeded", () => {
  for (const key of ["requests", "modelCalls"] as const) {
    const b = new Budget({
      ...config.limits,
      maxRequests: 1,
      maxModelCalls: 1,
    });
    try {
      b.take(key);
      assert.throws(() => b.take(key), new RegExp(key + "-limit"));
    } finally {
      b.dispose();
    }
  }
});
