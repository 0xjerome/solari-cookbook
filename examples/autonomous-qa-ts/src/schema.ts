import { z } from "zod";

const path = z
  .string()
  .max(200)
  .regex(/^\/[a-zA-Z0-9/_\.\-]*$/);
export const synthetic = [
  "qa-test@example.invalid",
  "Test User",
  "Synthetic QA message",
  "qa-test",
  "not-an-email",
] as const;
export const configSchema = z
  .object({
    target: z.string().max(2048).url(),
    authorized: z.literal(true),
    // The owner supplies these assertions; page content can never extend them.
    safeReadPaths: z.array(path).min(1).max(100),
    safeControls: z
      .array(
        z
          .object({
            path,
            testId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
            kind: z.enum(["fill", "click"]),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    limits: z
      .object({
        maxPages: z.number().int().min(1).max(50).default(10),
        maxActions: z.number().int().min(1).max(200).default(30),
        maxWorkflows: z.number().int().min(1).max(10).default(3),
        maxRuntimeMs: z.number().int().min(1000).max(600_000).default(180_000),
        maxRetriesPerAction: z.number().int().min(0).max(1).default(0),
        maxReproductionAttempts: z.number().int().min(0).max(2).default(2),
        maxRequests: z.number().int().min(1).max(1000).default(200),
        maxModelCalls: z.number().int().min(1).max(50).default(15),
        actionIntervalMs: z.number().int().min(250).max(5000).default(800),
      })
      .strict()
      .default({
        maxPages: 10,
        maxActions: 30,
        maxWorkflows: 3,
        maxRuntimeMs: 180000,
        maxRetriesPerAction: 0,
        maxReproductionAttempts: 2,
        maxRequests: 200,
        maxModelCalls: 15,
        actionIntervalMs: 800,
      }),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export const decisionSchema = z
  .object({
    workflow: z.string().min(1).max(100),
    rationale: z.string().max(400),
    expected: z.string().max(300),
    action: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("navigate"), control: z.string().max(20) })
        .strict(),
      z
        .object({ kind: z.literal("click"), control: z.string().max(20) })
        .strict(),
      z
        .object({
          kind: z.literal("fill"),
          control: z.string().max(20),
          value: z.enum(synthetic),
        })
        .strict(),
      z.object({ kind: z.literal("finish") }).strict(),
    ]),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;
export type Control = {
  id: string;
  kind: "navigate" | "fill" | "click";
  label: string;
  href?: string;
  testId?: string;
  permitted: boolean;
};
export type Observation = {
  url: string;
  title: string;
  text: string;
  controls: Control[];
};
export type Signal = {
  kind: "http-error" | "runtime-error" | "blank-page";
  fingerprint: string;
  detail: string;
};
export type Step = {
  url: string;
  kind: "navigate" | "click" | "fill";
  href?: string;
  testId?: string;
  value?: (typeof synthetic)[number];
  expected: string;
};
export type Evidence = {
  screenshot?: string;
  sha256?: string;
  capturedAt: string;
  captureError?: string;
};
export type Finding = {
  id: string;
  status: "CONFIRMED" | "POTENTIAL";
  title: string;
  severity: "medium";
  url: string;
  signal: Signal;
  expected: string;
  actual: string;
  steps: Step[];
  reproductions: { matched: boolean; evidence?: Evidence; reason?: string }[];
  evidence: Evidence;
  confirmationRule: string;
};
export type Event = { at: string; type: string; message: string };
export type Report = {
  schemaVersion: 1;
  runId: string;
  sessionId?: string;
  mode: "solari";
  model?: { provider: string; id: string };
  dataset?: "fieldnotes-v1" | "fieldnotes-healthy-v1";
  fixtureAudit?: { dangerRequests: number };
  startedAt: string;
  finishedAt?: string;
  target: string;
  termination: string;
  limits: Config["limits"];
  counts: Record<string, number>;
  workflows: string[];
  findings: Finding[];
  events: Event[];
  cleanupErrors: string[];
};
