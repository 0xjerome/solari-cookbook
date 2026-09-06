import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { UserError } from "../src/settings.js";
test("local UI rejects cross-origin, unauthenticated and unauthorized run requests", async () => {
  let executions = 0;
  const app = createApp({
    settings: async () => ({
      solariKey: "unit",
      modelKey: "unit",
      model: "unit",
    }),
    execute: async () => {
      executions++;
      throw new UserError("Unit test: no remote execution");
    },
  });
  const origin = await app.listen(0);
  try {
    const html = await (await fetch(origin)).text();
    const token = html.match(/name="qa-token" content="([a-f0-9]+)"/)?.[1];
    assert.ok(token);
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(origin + "/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    assert.equal((await post({ demo: true, authorized: true })).status, 403);
    assert.equal(
      (
        await post(
          { demo: true, authorized: true },
          { "x-qa-token": token, origin: "https://evil.invalid" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await post({ demo: true, authorized: false }, { "x-qa-token": token }))
        .status,
      400,
    );
    assert.equal(executions, 0);
    const response = await post(
      { demo: true, authorized: true },
      { "x-qa-token": token },
    );
    assert.equal(response.status, 202);
    const { id } = await response.json();
    await new Promise((r) => setTimeout(r, 20));
    const job = await (await fetch(origin + "/api/runs/" + id)).json();
    assert.equal(job.status, "failed");
    assert.equal(job.error, "Unit test: no remote execution");
    assert.equal(executions, 1);
    assert.equal(
      (await fetch(origin + "/api/runs/" + id + "/evidence/../../.env")).status,
      404,
    );
  } finally {
    await app.close();
  }
});
test("local UI allows cancellation and prevents overlapping runs", async () => {
  const app = createApp({
    settings: async () => ({
      solariKey: "unit",
      modelKey: "unit",
      model: "unit",
    }),
    execute: async (_s, options) => {
      await new Promise<void>((resolve) =>
        options.signal!.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      throw new UserError("cancelled");
    },
  });
  const origin = await app.listen(0);
  try {
    const html = await (await fetch(origin)).text();
    const token = html.match(/name="qa-token" content="([a-f0-9]+)"/)![1]!;
    const post = (path: string, body: unknown) =>
      fetch(origin + path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": token },
        body: JSON.stringify(body),
      });
    const responses = await Promise.all([
      post("/api/runs", { demo: true, authorized: true }),
      post("/api/runs", { demo: true, authorized: true }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [202, 409]);
    const { id } = await responses.find((r) => r.status === 202)!.json();
    assert.equal(
      (await post("/api/runs", { demo: true, authorized: true })).status,
      409,
    );
    assert.equal((await post("/api/runs/" + id + "/cancel", {})).status, 200);
  } finally {
    await app.close();
  }
});
