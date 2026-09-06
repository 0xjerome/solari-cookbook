import { test } from "node:test";
import assert from "node:assert/strict";
import { Budget, Policy, parseConfig } from "../src/policy.js";
import { reproduce, runEngine } from "../src/engine.js";
import type { Driver } from "../src/browser.js";
import type { Signal, Report } from "../src/schema.js";
import { fixtureConfig } from "../fixture/app.js";
const config = parseConfig({
  ...fixtureConfig,
  target: "https://fixture.example.com/",
});
const signal: Signal = {
  kind: "http-error",
  fingerprint: "known",
  detail: "HTTP 500 at /search",
};
// Unit doubles only. These are never used by the CLI or counted as live evaluation.
function driver(match = true, blocked = false): Driver {
  return {
    observe: async () => ({
      url: config.target,
      title: "",
      text: "",
      controls: [],
    }),
    execute: async () => {},
    reset: async () => {},
    signals: async () => (match ? [signal] : []),
    evidence: async () => ({
      capturedAt: new Date().toISOString(),
      captureError: "unit double; no screenshot",
    }),
    blocked: () => blocked,
    clear: () => {},
  };
}
function report(): Report {
  return {
    schemaVersion: 1,
    runId: "unit",
    mode: "solari",
    target: config.target,
    startedAt: new Date().toISOString(),
    termination: "",
    limits: config.limits,
    counts: {},
    workflows: [],
    findings: [],
    events: [],
    cleanupErrors: [],
  };
}
test("reproduction cap and denominator reflect actual attempts", async () => {
  const b = new Budget(config.limits);
  let resets = 0;
  const d = driver();
  d.reset = async () => {
    resets++;
  };
  try {
    const a = await reproduce(d, [], signal, b);
    assert.equal(a.length, 2);
    assert.equal(resets, 2);
    assert.ok(a.every((x) => x.matched));
  } finally {
    b.dispose();
  }
});
test("policy block anywhere in replay invalidates confirmation", async () => {
  const b = new Budget(config.limits);
  const d = driver(true, true);
  try {
    assert.ok((await reproduce(d, [], signal, b)).every((x) => !x.matched));
  } finally {
    b.dispose();
  }
});
test("non-reproduced observation stays potential", async () => {
  const b = new Budget(config.limits);
  const d = driver();
  let replay = false;
  d.reset = async () => {
    replay = true;
  };
  d.signals = async () => (replay ? [] : [signal]);
  const r = report();
  try {
    await runEngine(
      d,
      {
        decide: async () => ({
          workflow: "done",
          rationale: "",
          expected: "",
          action: { kind: "finish" },
        }),
      },
      new Policy(config),
      b,
      r,
    );
    assert.equal(r.findings[0]?.status, "POTENTIAL");
    assert.equal(r.findings[0]?.reproductions.length, 2);
  } finally {
    b.dispose();
  }
});
test("confirmed finding requires independent recurrence", async () => {
  const b = new Budget(config.limits);
  const r = report();
  try {
    await runEngine(
      driver(),
      {
        decide: async () => ({
          workflow: "done",
          rationale: "",
          expected: "",
          action: { kind: "finish" },
        }),
      },
      new Policy(config),
      b,
      r,
    );
    assert.equal(r.findings[0]?.status, "CONFIRMED");
  } finally {
    b.dispose();
  }
});
test("untrusted model cannot execute invented controls", async () => {
  const b = new Budget(config.limits);
  const r = report();
  let calls = 0,
    actions = 0;
  const d = driver(false);
  d.execute = async () => {
    actions++;
  };
  try {
    await runEngine(
      d,
      {
        decide: async () => ({
          workflow: "attack",
          rationale: "",
          expected: "",
          action:
            ++calls === 1
              ? { kind: "click", control: "delete" }
              : { kind: "finish" },
        }),
      },
      new Policy(config),
      b,
      r,
    );
    assert.equal(actions, 1);
    assert.equal(b.counts.skipped, 1);
    assert.equal(r.findings.length, 0);
  } finally {
    b.dispose();
  }
});

test("rejected model decisions still exhaust the model-call budget", async () => {
  const b = new Budget({ ...config.limits, maxModelCalls: 2 });
  const r = report();
  try {
    await runEngine(
      driver(false),
      {
        decide: async () => ({
          workflow: "attack",
          rationale: "",
          expected: "",
          action: { kind: "click", control: "unknown" },
        }),
      },
      new Policy(config),
      b,
      r,
    );
    assert.equal(r.termination, "modelCalls-limit");
    assert.equal(b.counts.modelCalls, 2);
  } finally {
    b.dispose();
  }
});
test("blank-page heuristic is never promoted to a confirmed bug", async () => {
  const b = new Budget(config.limits);
  const r = report();
  const d = driver();
  d.signals = async () => [
    { kind: "blank-page", fingerprint: "blank", detail: "No visible content" },
  ];
  try {
    await runEngine(
      d,
      {
        decide: async () => ({
          workflow: "done",
          rationale: "",
          expected: "",
          action: { kind: "finish" },
        }),
      },
      new Policy(config),
      b,
      r,
    );
    assert.equal(r.findings[0]?.status, "POTENTIAL");
    assert.ok(r.findings[0]?.reproductions.every((a) => a.matched));
  } finally {
    b.dispose();
  }
});
