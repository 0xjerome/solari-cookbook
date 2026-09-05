# Autonomous functional QA with Solari

A bounded QA agent for **applications you own or are explicitly authorized to test**. It observes an application through a Solari browser, asks a model to choose meaningful safe actions, reproduces observable failures in fresh browser contexts, and writes JSON/Markdown reports with screenshot evidence.

Built as an application project for the Pinetree Research / Solari SWE internship. The first milestone focuses on credible findings and enforceable boundaries before a polished UI.

**Status:** the Solari execution path has passed a real, scripted cloud integration check. Autonomous model planning is implemented but has not yet been evaluated with a model API key. Scripted integration results are never presented as autonomous performance.

## Run

Requires Node.js 22+, a Solari key, and an Anthropic API key with an available model ID. A Solari key provides infrastructure, not model inference.

```sh
cd examples/autonomous-qa-ts
npm ci
cp .env.example .env
# Fill .env locally; never paste keys into reports or commit the file.
npm run typecheck
npm test
npm start -- --demo
```

`--demo` provisions our synthetic fixture in a Solari sandbox, opens a Solari browser, and releases both at the end. It uses your Solari balance and model API usage. Initial defaults: one session, 30 actions, 10 pages, 3 workflows, 15 model calls, 200 intercepted requests, and a 3-minute QA deadline. Provisioning has a separate 60-second deadline; cleanup has bounded timeouts. No automatic model retries.

`runs/<id>/report.md`, `report.json`, and `evidence/` contain the result. Run progress is printed to the terminal. Session identifiers are hashed in reports. Screenshot files have SHA-256 checksums.

For an owner-authorized HTTPS deployment:

```sh
npm start -- my-staging.config.json
```

Use `fixture.config.json` as a structural example, replacing the target and safe route/control declarations. Its localhost address is for local tests; a Solari cloud browser cannot reach your laptop's localhost. `--demo` supplies a cloud-accessible fixture automatically.

Do not simply list every production endpoint as safe. The application owner must identify read routes and test-only controls that have no consequential effects. Unknown routes and controls are skipped. This restricts discovery deliberately: an unfamiliar application still needs a trusted scope manifest.

## How Solari is used

- `@solarisdk/browser` creates and owns the remote browser session.
- Its version-matched `patchright-core` connection drives the Solari browser, following Solari's documented connection pattern.
- The session ID is acquired before connection, allowing release if connecting times out. SDK 0.1.3's convenience `launch()` does not set a connection timeout internally.
- Fresh Solari browser contexts isolate each reproduction from prior cookies/storage. This does not reset server-side data; the fixture is stateless.
- `@solarisdk/sdk` uploads our fixed fixture into a sandbox, runs its Python server, and obtains a preview URL.
- Preview bootstrap credentials stay outside model observations, configuration, and reports. Each context exchanges the signed URL for a preview cookie without following redirects.
- A separate Anthropic Messages API integration chooses workflows and actions. Solari is not described as having a native reasoning API.

This builds on `browser-quickstart-ts` and `sandbox-port-preview-ts`. Existing examples are preserved.

## Architecture

1. `schema.ts` validates authorization, trusted configuration, and typed model decisions.
2. `policy.ts` enforces origin/path/method/input limits, budgets, and redaction.
3. `browser.ts` observes UI controls and performs only permitted actions through Solari.
4. `planner.ts` passes bounded, untrusted observations to the model and validates its response.
5. `engine.ts` records the actual action trace, caps replay, and assigns finding status.
6. `report.ts` saves observations, actual attempts, evidence, and termination reasons.
7. `session.ts` / `deploy-fixture.ts` manage remote resources.

The model receives no shell, arbitrary JavaScript, environment access, file tools, or unrestricted navigation tool. It selects control IDs from the current observation. All policy decisions happen again outside the model.

## Safety model

- Explicit authorization is required. Only one exact origin is supported in this milestone.
- Only configured GET paths and the single synthetic `q` query parameter are allowed. Mutation methods, unknown query values, credentials in URLs, and external origins are blocked.
- Fill/click actions require owner-approved `data-testid` controls on exact paths. Password, hidden, and upload inputs and obvious consequential actions are rejected.
- Navigation uses the observed safe URL directly, avoiding arbitrary link click handlers.
- Requests are fetched with redirects disabled. Redirect responses are blocked before the destination is contacted.
- Popups, frame navigation, WebSockets, downloads, and service workers are restricted. HTTP 429 stops the run.
- Retries are limited to declared safe navigation. Clicks and form submissions are never automatically retried after ambiguous failure.
- Reproduction uses the same safety gates and global action/request/time budgets. A policy block anywhere in a replay invalidates it.
- A failed or inconclusive replay stops further exploration because the resulting state is uncertain.
- No profiles, recordings, stealth, CAPTCHA solving, or evasion proxies are enabled.
- Logs redact configured secrets, common credential formats, and personal email addresses. Screenshots mask inputs and `[data-private]` regions; screenshots are omitted when a known secret is visible.

**Limits of the boundary:** browser request interception is not a complete network firewall. Browser-internal traffic, DNS resolution/rebinding, and protocols such as WebRTC require additional infrastructure for comprehensive containment. Use controlled, isolated fixtures or carefully authorized staging. Even GET routes and typing can cause side effects if the application owner misclassifies them. Label matching is supplementary, not proof of safety. General hostile-site containment and arbitrary production testing are deferred.

## What findings mean

- **CONFIRMED:** the same HTTP/runtime failure recurred during at least one independent safe replay, with no policy block. This confirms the observable failure, not its business impact or root cause.
- **POTENTIAL:** observed once, not reproduced, or a blank-page heuristic. Blank pages are never automatically confirmed.
- **WARNING:** inconclusive behavior or execution/infrastructure failure.
- **SKIPPED:** policy prevented testing.

Expected behavior is labeled as an agent hypothesis. Severity is provisionally `medium` and requires human review. Successful actions are not reported as passed workflows. The MVP does not reliably infer silent button failures, business validation rules, or visual correctness. It reports at most one new signal per observation to avoid cascades of duplicate symptoms.

## Verification and evaluation

```sh
npm test                 # Unit and HTTP fixture tests; live suites explicitly skipped
npm run test:solari      # Real Solari + sandbox integration; SOLARI_API_KEY only
npm run test:browser     # Optional local Chrome integration
npm run evaluate -- runs/<autonomous-demo-run>/report.json
```

The real Solari integration test uses predetermined steps to test the adapter, independently replays the search failure twice, checks screenshot hashes, and releases resources. It does **not** use a model. Its artifact is named `integration.json` and explicitly records `autonomous: false`.

The fixture contains a working home/catalog/about journey, an intentional search HTTP 500, and a missing help page (404). It also includes unsafe controls, an external link, and hostile page text. Hidden fixture routes exercise redirect and background-request enforcement. Expected bugs are kept out of planner inputs.

The evaluator accepts only autonomous Solari reports tagged with this fixture dataset. It reports actual attempts and missing/matched known failures. Unmatched findings require adjudication before calling them false positives. A separate fixture-side audit is needed to count prevented unsafe actions; skip counts alone are not that metric.

No autonomous detection rate, workflow success rate, or false-positive rate is claimed yet. See `VALIDATION.md` for checks actually performed.

## Known limitations and next steps

- Configure a model API key and evaluate the planner on repeated healthy and buggy fixture variants.
- Add richer trusted read manifests and stable controls for volunteer staging applications.
- Strengthen process-level cancellation, remote cleanup reconciliation, and network containment before broader deployment.
- Improve evidence privacy for applications containing sensitive data; do not test those with this MVP.
- Add a minimal URL/configuration UI and live progress after the core workflow is evaluated.
- Add GitHub issue drafts later, with explicit review and approval before publication.

No penetration testing, autonomous purchasing, messaging, account administration, or destructive testing is supported.
