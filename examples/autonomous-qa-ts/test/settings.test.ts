import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyModel, modelBase } from "../src/settings.js";
test("Experiential preflight uses its own host and bearer authentication", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.experientiallabs.ai/v1/models");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer unit-key",
      );
      return Response.json({ data: [{ id: "unit-model" }] });
    };
    await verifyModel(
      {
        provider: "experiential",
        modelKey: "unit-key",
        model: "unit-model",
        solariKey: "test",
      },
      new AbortController().signal,
    );
    assert.equal(modelBase(), "https://api.anthropic.com");
  } finally {
    globalThis.fetch = original;
  }
});
test("preflight rejects unavailable model and rejected credentials", async () => {
  const original = globalThis.fetch;
  const s = {
    provider: "experiential" as const,
    modelKey: "unit-key",
    model: "missing",
    solariKey: "test",
  };
  try {
    globalThis.fetch = async () => Response.json({ data: [] });
    await assert.rejects(
      verifyModel(s, new AbortController().signal),
      /not listed/,
    );
    globalThis.fetch = async () => new Response("", { status: 401 });
    await assert.rejects(verifyModel(s, new AbortController().signal), /401/);
  } finally {
    globalThis.fetch = original;
  }
});
