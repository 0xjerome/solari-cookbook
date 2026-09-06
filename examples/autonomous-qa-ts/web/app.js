"use strict";
const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="qa-token"]').content;
let runId, selectedFinding, draft;
async function request(path, body) {
  const r = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-QA-Token": token },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
$("demo").addEventListener("change", () => {
  $("target").disabled = $("demo").checked;
  $("target").required = !$("demo").checked;
});
$("run-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  error("");
  $("start").disabled = true;
  $("results").hidden = true;
  $("events").textContent = "";
  try {
    const demo = $("demo").checked;
    const config = demo
      ? undefined
      : {
          ...JSON.parse($("manifest").value),
          target: $("target").value,
          authorized: $("authorized").checked,
        };
    const result = await request("/api/runs", {
      demo,
      authorized: $("authorized").checked,
      ...(config ? { config } : {}),
    });
    runId = result.id;
    $("progress").hidden = false;
    $("cancel").hidden = false;
    $("cancel").disabled = false;
    $("status").textContent = "Starting QA run…";
    void poll();
  } catch (e) {
    error(e.message);
    $("start").disabled = false;
  }
});
async function poll() {
  try {
    const job = await request(`/api/runs/${runId}`);
    $("events").textContent = job.events
      .map((e) => `${e.type}  ${e.message}`)
      .join("\n");
    $("events").scrollTop = $("events").scrollHeight;
    if (job.status === "running") {
      setTimeout(poll, 1000);
      return;
    }
    $("start").disabled = false;
    $("cancel").hidden = true;
    $("status").textContent =
      job.status === "complete"
        ? "QA run complete"
        : `Run stopped${job.report ? ": " + job.report.termination : ""}`;
    if (job.error) error(job.error);
    if (job.report) showReport(job.report);
  } catch (e) {
    error(e.message);
    $("start").disabled = false;
  }
}
$("cancel").addEventListener("click", async () => {
  try {
    $("cancel").disabled = true;
    await request(`/api/runs/${runId}/cancel`, {});
  } catch (e) {
    error(e.message);
  }
});
function showReport(report) {
  $("results").hidden = false;
  $("download").href = `/api/runs/${runId}/report.json`;
  $("counts").textContent =
    `${report.counts.actions} actions · ${report.workflows.length} workflows attempted · ${report.findings.filter((f) => f.status === "CONFIRMED").length} confirmed findings · ${report.counts.skipped} policy skips`;
  $("findings").replaceChildren();
  if (!report.findings.length)
    $("findings").append(
      el(
        "p",
        "No failures were confirmed in this bounded run. This does not establish that the application is bug-free.",
      ),
    );
  for (const finding of report.findings) {
    const card = el("article");
    card.className = "finding";
    const badge = el("span", finding.status);
    badge.className = "badge";
    card.append(
      badge,
      el("h3", finding.title),
      el("p", "Expected (agent hypothesis): " + finding.expected),
      el("p", "Observed: " + finding.actual),
    );
    const steps = el("ol");
    for (const step of finding.steps)
      steps.append(
        el(
          "li",
          `${step.kind} ${step.href || step.testId || step.url}${step.value ? " using " + step.value : ""}`,
        ),
      );
    card.append(
      steps,
      el(
        "p",
        `Reproduced ${finding.reproductions.filter((a) => a.matched).length}/${finding.reproductions.length} attempts`,
      ),
    );
    if (finding.evidence.screenshot) {
      const img = el("img");
      img.alt = "Screenshot captured during this finding";
      img.src = `/api/runs/${runId}/${finding.evidence.screenshot}`;
      img.loading = "lazy";
      card.append(img);
    }
    if (finding.status === "CONFIRMED") {
      const button = el("button", "Draft GitHub issue");
      button.className = "secondary";
      button.addEventListener("click", () => {
        selectedFinding = finding.id;
        draft = undefined;
        $("draft-preview").hidden = true;
        $("approve").checked = false;
        $("publish").disabled = true;
        $("draft-error").textContent = "";
        $("published").replaceChildren();
        $("draft-dialog").showModal();
      });
      card.append(button);
    }
    $("findings").append(card);
  }
}
$("draft-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    draft = await request(`/api/runs/${runId}/draft`, {
      findingId: selectedFinding,
      repository: $("repository").value,
    });
    $("destination").textContent = "Destination: " + draft.repository;
    $("draft-title").value = draft.title;
    $("draft-body").value = draft.body;
    $("draft-preview").hidden = false;
    $("approve").checked = false;
    $("publish").disabled = true;
    $("draft-error").textContent = "";
  } catch (e) {
    $("draft-error").textContent = e.message;
  }
});
$("approve").addEventListener("change", () => {
  $("publish").disabled = !$("approve").checked;
});
$("publish").addEventListener("click", async () => {
  if (!draft || !$("approve").checked) return;
  $("publish").disabled = true;
  try {
    const result = await request(`/api/drafts/${draft.id}/publish`, {
      approved: true,
      hash: draft.hash,
    });
    const link = el("a", "Open created issue");
    link.href = result.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    $("published").replaceChildren(link);
    $("approve").disabled = true;
  } catch (e) {
    $("draft-error").textContent = e.message;
  }
});
$("close-dialog").addEventListener("click", () => {
  $("draft-dialog").close();
  $("approve").disabled = false;
});
