import type { BrowserContext } from "patchright-core";
import { SolariClient } from "@solarisdk/sdk";
import { fixtureServer, fixtureConfig } from "../fixture/app.js";
import { bounded, parseConfig } from "./policy.js";

// Only our fixed fixture code is uploaded; the model has no access to these tools.
export async function deployFixture(
  apiKey: string,
  onProgress: (stage: string) => void = () => {},
) {
  const client = new SolariClient({ apiKey });
  const signal = AbortSignal.timeout(60000);
  onProgress("sandbox-create");
  const creation = client.sandboxes.create({
    template: "base",
    timeoutMs: 120000,
  });
  void creation
    .then(async (s) => {
      if (signal.aborted) await s.kill();
    })
    .catch(() => {});
  const sandbox = await bounded(creation, signal);
  try {
    // Capture the same fixture responses used by local integration tests.
    const { server } = fixtureServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Fixture bind failed");
    const pages: Record<
      string,
      { status: number; body: string; location?: string }
    > = {};
    try {
      for (const path of fixtureConfig.safeReadPaths) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}${path}`,
          { signal, redirect: "manual" },
        );
        pages[path] = {
          status: response.status,
          body: await response.text(),
          ...(response.headers.get("location")
            ? { location: response.headers.get("location")! }
            : {}),
        };
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    onProgress("sandbox-connect");
    await bounded(sandbox.connect(), signal);
    onProgress("fixture-upload");
    await bounded(
      sandbox.files.write("/tmp/qa-pages.json", JSON.stringify(pages)),
      signal,
    );
    await bounded(
      sandbox.files.write(
        "/tmp/qa-server.py",
        `import json\nfrom http.server import BaseHTTPRequestHandler, HTTPServer\nfrom urllib.parse import urlparse\npages=json.load(open('/tmp/qa-pages.json'))\nclass Handler(BaseHTTPRequestHandler):\n def do_GET(self):\n  open('/tmp/qa-audit.log','a').write(json.dumps({'method':'GET','path':urlparse(self.path).path})+'\\n')\n  page=pages.get(urlparse(self.path).path, {'status':404,'body':'Not found'})\n  self.send_response(page['status'])\n  if page.get('location'): self.send_header('Location',page['location'])\n  self.send_header('Content-Type','text/html; charset=utf-8')\n  self.send_header('Cache-Control','no-store')\n  self.end_headers()\n  self.wfile.write(page['body'].encode())\n def do_POST(self):\n  open('/tmp/qa-audit.log','a').write(json.dumps({'method':'POST','path':urlparse(self.path).path})+'\\n')\n  self.send_error(405)\n def log_message(self,*args): pass\nHTTPServer(('0.0.0.0',3000),Handler).serve_forever()\n`,
      ),
      signal,
    );
    onProgress("fixture-start");
    const start = await bounded(
      sandbox.commands.run("sh", {
        args: [
          "-c",
          "nohup python3 /tmp/qa-server.py >/tmp/qa-server.log 2>&1 &",
        ],
      }),
      signal,
    );
    if (start.exitCode !== 0) throw new Error("Fixture server failed");
    onProgress("fixture-preview");
    const { url } = await bounded(sandbox.previewUrl(3000), signal);
    // Do not allow a service response to redirect the local readiness check elsewhere.
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      !target.hostname.endsWith(".preview.getsolari.com")
    )
      throw new Error("Unexpected preview origin");
    onProgress("fixture-readiness");
    let ready = false;
    for (let n = 0; n < 10; n++) {
      const response = await fetch(target, { signal, redirect: "error" });
      if (response.ok) {
        ready = true;
        break;
      }
      await bounded(
        new Promise((resolve) => setTimeout(resolve, 1000)),
        signal,
      );
    }
    if (!ready) throw new Error("Fixture did not become ready");
    // Preview URLs carry a bootstrap credential. Exchange it for the preview
    // cookie in each fresh context, never expose it to policy, planner, or reports.
    if (
      target.pathname !== "/" ||
      target.username ||
      target.password ||
      target.hash
    )
      throw new Error("Unexpected preview URL shape");
    return {
      config: parseConfig({ ...fixtureConfig, target: target.origin + "/" }),
      authorize: async (context: BrowserContext) => {
        const response = await context.request.get(target.href, {
          maxRedirects: 0,
          timeout: 10000,
        });
        const status = response.status();
        await response.dispose();
        if (status !== 200) throw new Error("Preview authorization failed");
      },
      audit: async () =>
        (await sandbox.files.readText("/tmp/qa-audit.log"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { method: string; path: string }),
      close: () => sandbox.kill(),
    };
  } catch (error) {
    await bounded(sandbox.kill(), AbortSignal.timeout(10000)).catch(() => {});
    throw error;
  }
}
