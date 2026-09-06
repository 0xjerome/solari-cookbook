import { UserError } from "./settings.js";
import {
  decisionSchema,
  type Report,
  type Step,
  type Finding,
  type Signal,
  type Event,
} from "./schema.js";
import { Budget, Policy, Stop, redact, bounded } from "./policy.js";
import type { Driver } from "./browser.js";
import type { Planner } from "./planner.js";

export async function reproduce(
  driver: Driver,
  steps: Step[],
  signal: Signal,
  budget: Budget,
  attempts: Finding["reproductions"] = [],
): Promise<Finding["reproductions"]> {
  for (let n = 0; n < budget.limits.maxReproductionAttempts; n++) {
    budget.check();
    budget.counts.reproductions!++;
    try {
      await driver.reset();
      let restricted = driver.blocked();
      for (const step of steps) {
        await driver.execute(step);
        restricted ||= driver.blocked();
      }
      const matches = (await driver.signals()).some(
        (s) => s.kind === signal.kind && s.fingerprint === signal.fingerprint,
      );
      const matched = matches && !restricted;
      attempts.push({
        matched,
        evidence: await driver.evidence(
          `repro-${signal.fingerprint.slice(0, 12)}-${n + 1}`,
        ),
        ...(!matched
          ? {
              reason:
                "Failure did not recur, or a policy block invalidated the attempt",
            }
          : {}),
      });
    } catch (error) {
      if (budget.signal.aborted) throw error;
      attempts.push({
        matched: false,
        reason: "Replay could not complete safely",
      });
    }
  }
  return attempts;
}
export async function runEngine(
  driver: Driver,
  planner: Planner,
  policy: Policy,
  budget: Budget,
  report: Report,
  secrets: string[] = [],
  onEvent?: (event: Event) => void,
) {
  const history: unknown[] = [];
  const seen = new Set<string>();
  const workflows = new Set<string>();
  const log = (type: string, message: string) => {
    const e = {
      at: new Date().toISOString(),
      type,
      message: redact(message, secrets),
    };
    report.events.push(e);
    onEvent?.(e);
  };
  const steps: Step[] = [];
  let traceRestricted = false;
  const initial: Step = {
    kind: "navigate",
    url: policy.config.target,
    href: policy.config.target,
    expected: "Application loads without a server error",
  };
  async function inspect(expected: string) {
    const signals = await driver.signals();
    traceRestricted ||= driver.blocked();
    if (traceRestricted) {
      log(
        "WARNING",
        "Policy restrictions affected this observation; no bug is confirmed from it",
      );
      return;
    }
    for (const signal of signals.slice(0, 1)) {
      if (seen.has(signal.fingerprint)) continue;
      seen.add(signal.fingerprint);
      const finding: Finding = {
        id: `BUG-${String(report.findings.length + 1).padStart(3, "0")}`,
        status: "POTENTIAL",
        title: signal.detail,
        severity: "medium",
        url: (await driver.observe()).url,
        signal,
        expected,
        actual: signal.detail,
        steps: structuredClone(steps),
        reproductions: [],
        evidence: await driver.evidence(
          `observed-${signal.fingerprint.slice(0, 12)}`,
        ),
        confirmationRule:
          "Same HTTP/runtime failure after independent safe replay, without policy blocks. Blank-page heuristics remain potential.",
      };
      report.findings.push(finding);
      log("POTENTIAL", finding.title);
      finding.reproductions = await reproduce(
        driver,
        finding.steps,
        signal,
        budget,
        finding.reproductions,
      );
      if (
        signal.kind !== "blank-page" &&
        finding.reproductions.some((a) => a.matched)
      )
        finding.status = "CONFIRMED";
      if (
        finding.reproductions.length &&
        !finding.reproductions.at(-1)?.matched
      )
        throw new Stop("reproduction-inconclusive");
      log(
        finding.status,
        `${finding.id}: ${finding.reproductions.filter((a) => a.matched).length}/${finding.reproductions.length} replays matched`,
      );
    }
  }
  try {
    await driver.execute(initial);
    steps.push(initial);
    await inspect(initial.expected);
    while (true) {
      budget.check();
      const observation = await driver.observe();
      budget.take("modelCalls");
      const decision = decisionSchema.parse(
        await bounded(planner.decide(observation, history), budget.signal),
      );
      if (decision.action.kind === "finish") {
        report.termination = "completed";
        break;
      }
      if (
        !workflows.has(decision.workflow) &&
        workflows.size >= budget.limits.maxWorkflows
      )
        throw new Stop("workflows-limit");
      workflows.add(decision.workflow);
      report.workflows = [...workflows];
      const control = observation.controls.find(
        (c) =>
          c.id ===
          ("control" in decision.action ? decision.action.control : undefined),
      );
      if (
        !control?.permitted ||
        control.kind !== decision.action.kind ||
        !policy.control(observation.url, control)
      ) {
        budget.counts.skipped!++;
        history.push({ result: "SKIPPED", reason: "Control not permitted" });
        log("SKIPPED", "Model action rejected by deterministic policy");
        continue;
      }
      const step: Step = {
        url: observation.url,
        kind: decision.action.kind,
        href: control.href,
        testId: control.testId,
        ...(decision.action.kind === "fill"
          ? { value: decision.action.value }
          : {}),
        expected: redact(decision.expected, secrets),
      };
      let completed = false;
      for (let retry = 0; retry <= budget.limits.maxRetriesPerAction; retry++) {
        try {
          await driver.execute(step);
          completed = true;
          break;
        } catch (error) {
          if (budget.signal.aborted) throw error;
          if (
            step.kind !== "navigate" ||
            retry === budget.limits.maxRetriesPerAction
          )
            break;
        }
      }
      if (!completed) {
        log(
          "WARNING",
          "Action failed; stopping because browser state is uncertain",
        );
        report.termination = "action-failed";
        break;
      }
      steps.push(step);
      log("ACTION", `${decision.workflow}: ${step.kind}`);
      await inspect(step.expected);
      history.push({
        workflow: redact(decision.workflow, secrets),
        action: step.kind,
        result: driver.blocked() ? "restricted" : "executed",
        findings: report.findings.slice(-8).map((f) => ({
          title: f.title,
          status: f.status,
        })),
      });
    }
  } catch (error) {
    report.termination = budget.signal.aborted
      ? String(budget.signal.reason?.message || "cancelled")
      : error instanceof Stop
        ? error.message
        : "agent-error";
    log(
      "WARNING",
      error instanceof UserError ? error.message : report.termination,
    );
  } finally {
    for (const f of report.findings)
      if (
        f.signal.kind !== "blank-page" &&
        f.reproductions.some((a) => a.matched)
      )
        f.status = "CONFIRMED";
  }
}
