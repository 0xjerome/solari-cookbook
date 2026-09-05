import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureServer } from "../fixture/app.js";
test("fixture serves healthy journeys and the two declared failures", async () => {
  const { server, counters } = fixtureServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const [path, status] of [
      ["/", 200],
      ["/about", 200],
      ["/catalog", 200],
      ["/search?q=qa-test", 500],
      ["/help", 404],
    ] as const) {
      const response = await fetch(base + path);
      assert.equal(response.status, status);
      await response.text();
    }
    assert.equal(counters.danger, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
