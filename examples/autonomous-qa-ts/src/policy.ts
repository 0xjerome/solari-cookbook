import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  configSchema,
  synthetic,
  type Config,
  type Control,
  type Step,
} from "./schema.js";

export class Stop extends Error {}
export const prohibited =
  /\b(buy|pay|delete|publish|send|book|order|transfer|invite|password|subscription|billing|remove|purchase)\b/i;
export function parseConfig(input: unknown): Config {
  const config = configSchema.parse(input);
  const u = new URL(config.target);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    !(u.protocol === "https:" || (loopback && u.protocol === "http:"))
  )
    throw new Error(
      "Target must be HTTPS (HTTP loopback allowed), without credentials, query, or fragment",
    );
  if (
    !loopback &&
    (/^[\d.]+$/.test(u.hostname) ||
      u.hostname.includes(":") ||
      /(^|\.)(internal|local)$/.test(u.hostname))
  )
    throw new Error("Private/literal network targets are outside this MVP");
  if (!config.safeReadPaths.includes(u.pathname))
    throw new Error("Target path must be an explicitly safe read path");
  return config;
}
export class Policy {
  readonly origin: string;
  constructor(readonly config: Config) {
    this.origin = new URL(config.target).origin;
  }
  request(raw: string, method = "GET"): boolean {
    try {
      const u = new URL(raw);
      if (
        u.origin !== this.origin ||
        u.username ||
        u.password ||
        !["http:", "https:"].includes(u.protocol)
      )
        return false;
      if (
        method !== "GET" ||
        prohibited.test(u.pathname) ||
        !this.config.safeReadPaths.includes(u.pathname)
      )
        return false;
      // Synthetic query values only. No arbitrary payloads, credentials, or callback URLs.
      return (
        [...u.searchParams].every(
          ([key, value]) =>
            key === "q" &&
            synthetic.includes(value as (typeof synthetic)[number]),
        ) && [...u.searchParams].length <= 1
      );
    } catch {
      return false;
    }
  }
  control(url: string, c: Pick<Control, "kind" | "href" | "testId">): boolean {
    if (!this.request(url)) return false;
    if (c.kind === "navigate") return !!c.href && this.request(c.href);
    return (
      !prohibited.test(c.testId || "") &&
      this.config.safeControls.some(
        (rule) =>
          rule.path === new URL(url).pathname &&
          rule.testId === c.testId &&
          rule.kind === c.kind,
      )
    );
  }
  step(s: Step): boolean {
    return (
      this.control(s.url, { kind: s.kind, href: s.href, testId: s.testId }) &&
      (s.kind !== "fill" || synthetic.includes(s.value!))
    );
  }
}
export class Budget {
  readonly controller = new AbortController();
  readonly started = Date.now();
  readonly counts: Record<string, number> = {
    actions: 0,
    pages: 0,
    requests: 0,
    modelCalls: 0,
    reproductions: 0,
    skipped: 0,
  };
  private timer: ReturnType<typeof setTimeout>;
  private lastAction = 0;
  private paths = new Set<string>();
  constructor(readonly limits: Config["limits"]) {
    this.timer = setTimeout(
      () => this.stop("runtime-limit"),
      limits.maxRuntimeMs,
    );
    this.timer.unref();
  }
  get signal() {
    return this.controller.signal;
  }
  stop(reason: string) {
    if (!this.signal.aborted) this.controller.abort(new Stop(reason));
  }
  check() {
    if (Date.now() - this.started >= this.limits.maxRuntimeMs)
      this.stop("runtime-limit");
    if (this.signal.aborted) throw this.signal.reason;
  }
  take(key: "actions" | "requests" | "modelCalls") {
    this.check();
    const max = {
      actions: this.limits.maxActions,
      requests: this.limits.maxRequests,
      modelCalls: this.limits.maxModelCalls,
    }[key];
    if (this.counts[key]! >= max) {
      this.stop(`${key}-limit`);
      this.check();
    }
    this.counts[key]!++;
  }
  page(url: string) {
    this.check();
    const key = new URL(url);
    key.hash = "";
    if (this.paths.has(key.href)) return;
    if (this.paths.size >= this.limits.maxPages) {
      this.stop("pages-limit");
      this.check();
    }
    this.paths.add(key.href);
    this.counts.pages = this.paths.size;
  }
  async action() {
    this.take("actions");
    await delay(
      Math.max(0, this.lastAction + this.limits.actionIntervalMs - Date.now()),
      undefined,
      { signal: this.signal },
    );
    this.check();
    this.lastAction = Date.now();
  }
  dispose() {
    clearTimeout(this.timer);
  }
}
export function redact(text: string, secrets: string[] = []): string {
  let value = text;
  for (const s of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
    value = value.split(s).join("[REDACTED]");
  return value
    .replace(/\b(?:sk-|slr_)[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
    .replace(
      /([?&](?:token|key|secret|password|auth|session)[^=\s]*=)[^&\s"<>]+/gi,
      "$1[REDACTED]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) =>
      email.endsWith("@example.invalid") ? email : "[EMAIL]",
    );
}
export function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
export async function bounded<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    throw signal.reason;
  }
  let listener: () => void = () => {};
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        listener = () => reject(signal.reason);
        signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
