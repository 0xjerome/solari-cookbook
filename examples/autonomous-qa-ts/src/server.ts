import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeRun, type RunOptions } from "./runner.js";
import { readSettings, UserError, type Settings } from "./settings.js";
import { createDraft, publishDraft, type Draft } from "./issues.js";
import type { Report, Event } from "./schema.js";
import { z } from "zod";

type Job = {
  id: string;
  status: "running" | "complete" | "failed";
  events: Event[];
  cancel: AbortController;
  report?: Report;
  dir?: string;
  error?: string;
};
const startSchema = z
  .object({
    demo: z.boolean(),
    healthy: z.boolean().optional(),
    authorized: z.literal(true),
    config: z.unknown().optional(),
  })
  .strict();
const draftSchema = z
  .object({ findingId: z.string().max(40), repository: z.string().max(201) })
  .strict();
const approvalSchema = z
  .object({ approved: z.literal(true), hash: z.string().length(64) })
  .strict();
async function json(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new UserError("JSON request required.");
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16000) throw new UserError("Request is too large.");
  }
  return JSON.parse(body);
}
export function createApp(
  dependencies: {
    execute?: typeof executeRun;
    settings?: () => Promise<Settings>;
    publish?: typeof publishDraft;
  } = {},
) {
  const token = randomBytes(32).toString("hex");
  const jobs = new Map<string, Job>();
  const drafts = new Map<string, Draft>();
  const execute = dependencies.execute || executeRun;
  const settings = dependencies.settings || readSettings;
  let origin = "";
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const reply = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        reply(403, { error: "Local origin required" });
        return;
      }
      const url = new URL(req.url || "/", origin);
      const path = url.pathname;
      if (req.method === "POST") {
        const actual = Buffer.from(String(req.headers["x-qa-token"] || ""));
        const expected = Buffer.from(token);
        if (
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        ) {
          reply(403, { error: "Invalid request token" });
          return;
        }
      }
      if (
        req.method === "GET" &&
        ["/", "/app.js", "/style.css"].includes(path)
      ) {
        const file = path === "/" ? "index.html" : path.slice(1);
        let content = await readFile(
          new URL(`../web/${file}`, import.meta.url),
          "utf8",
        );
        if (path === "/") content = content.replace("__CSRF__", token);
        res.writeHead(200, {
          "content-type":
            path === "/"
              ? "text/html; charset=utf-8"
              : path.endsWith(".js")
                ? "text/javascript"
                : "text/css",
        });
        res.end(content);
        return;
      }
      if (req.method === "POST" && path === "/api/runs") {
        const input = startSchema.parse(await json(req));
        if ([...jobs.values()].some((j) => j.status === "running")) {
          reply(409, { error: "A run is already active" });
          return;
        }
        if (jobs.size >= 25) {
          reply(409, {
            error:
              "Restart the local server before starting more runs. Existing reports remain on disk.",
          });
          return;
        }
        const id = randomUUID();
        const job: Job = {
          id,
          status: "running",
          events: [],
          cancel: new AbortController(),
        };
        jobs.set(id, job);
        reply(202, { id });
        void (async () => {
          try {
            const output = await execute(await settings(), {
              demo: input.demo,
              healthy: input.healthy,
              config: input.config,
              runId: id,
              signal: job.cancel.signal,
              onEvent: (e) => {
                job.events.push(e);
                if (job.events.length > 250) job.events.shift();
              },
            } satisfies RunOptions);
            job.report = output.report;
            job.dir = output.dir;
            job.status =
              output.report.termination === "completed" ? "complete" : "failed";
          } catch (e) {
            job.status = "failed";
            job.error =
              e instanceof UserError
                ? e.message
                : "Run failed. Check local configuration and service availability.";
          }
        })();
        return;
      }
      const run = path.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(.*))?$/);
      if (run) {
        const job = jobs.get(run[1]!);
        if (!job) {
          reply(404, { error: "Run not found" });
          return;
        }
        const action = run[2];
        if (req.method === "GET" && !action) {
          reply(200, {
            id: job.id,
            status: job.status,
            events: job.events,
            report: job.report,
            error: job.error,
          });
          return;
        }
        if (req.method === "POST" && action === "cancel") {
          job.cancel.abort(new Error("cancelled"));
          reply(200, { cancelling: true });
          return;
        }
        if (req.method === "GET" && action === "report.json" && job.report) {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="report.json"',
          );
          reply(200, job.report);
          return;
        }
        if (
          req.method === "GET" &&
          action?.startsWith("evidence/") &&
          job.dir
        ) {
          const name = action.slice(9);
          if (!/^[a-zA-Z0-9-]+\.png$/.test(name)) {
            reply(400, { error: "Invalid evidence path" });
            return;
          }
          const data = await readFile(join(job.dir, "evidence", name));
          res.writeHead(200, { "content-type": "image/png" });
          res.end(data);
          return;
        }
        if (req.method === "POST" && action === "draft" && job.report) {
          if (drafts.size >= 50)
            throw new UserError(
              "Draft limit reached; restart to create more drafts.",
            );
          const body = draftSchema.parse(await json(req));
          const s = await settings();
          const draft = createDraft(
            job.report,
            body.findingId,
            body.repository,
            [s.solariKey, s.modelKey, s.githubToken || ""],
          );
          drafts.set(draft.id, draft);
          reply(200, draft);
          return;
        }
      }
      const publish = path.match(/^\/api\/drafts\/([a-f0-9-]{36})\/publish$/);
      if (req.method === "POST" && publish) {
        const draft = drafts.get(publish[1]!);
        if (!draft) {
          reply(404, { error: "Draft not found" });
          return;
        }
        const approval = approvalSchema.parse(await json(req));
        const s = await settings();
        const url = await (dependencies.publish || publishDraft)(
          draft,
          approval,
          s.githubToken || "",
        );
        reply(200, { url });
        return;
      }
      reply(404, { error: "Not found" });
    } catch (e) {
      reply(
        e instanceof UserError ||
          e instanceof z.ZodError ||
          e instanceof SyntaxError
          ? 400
          : 500,
        {
          error:
            e instanceof UserError
              ? e.message
              : e instanceof z.ZodError
                ? "Invalid request configuration."
                : e instanceof SyntaxError
                  ? "Invalid JSON."
                  : "Request failed.",
        },
      );
    }
  });
  return {
    server,
    async listen(port = 3001) {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Bind failed");
      origin = `http://127.0.0.1:${address.port}`;
      return origin;
    },
    async close() {
      for (const j of jobs.values())
        j.cancel.abort(new Error("server-stopping"));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createApp();
  app
    .listen(Number(process.env.PORT || 3001))
    .then((url) => console.log(`Solari QA: ${url}`))
    .catch(() => {
      console.error("Could not start local UI");
      process.exitCode = 1;
    });
  const stop = () => void app.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
