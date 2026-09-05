# Verification record

Recorded 2026-09-05. This is an engineering validation record, not an autonomous-agent benchmark.

## Automated checks

- TypeScript strict typecheck: passed.
- Unit and local HTTP fixture suite: **20 passed, 0 failed**. Two browser suites are explicitly opt-in and skipped in the default command.
- Separate real Solari cloud integration: **passed**.
- Optional local Chrome integration: not verified on this host; its initial launch was blocked by the managed environment. The actual cloud-browser adapter was verified through Solari.
- Model payload/schema tests use explicitly labeled unit doubles. No live model call has been made.

## Real Solari integration

Source: [integration.json](sample-evidence/integration.json).

- Started: 2026-09-05T12:57:06.679Z.
- Finished: 2026-09-05T12:58:05.524Z.
- Scripted actions: 14; distinct navigation URLs: 5; intercepted requests: 13.
- Model calls: **0**. The steps were predetermined integration-test steps.
- The synthetic search returned HTTP 500 and recurred in **2/2 independent replays**.
- [Screenshot](sample-evidence/evidence/search-failure.png) captured through the actual Solari browser; SHA-256 was checked against the saved bytes.
- Redirect and background-request guards were exercised. The fixture-side audit recorded **zero requests to the forbidden endpoint**.
- Browser and sandbox cleanup completed without an unverified release.
- The preview URL in the record is no longer live because the sandbox was destroyed. The session reference is hashed.

Earlier setup checks exposed a signed-preview-URL mismatch. The adapter now exchanges that bootstrap credential for a cookie before navigating the clean target URL. Only successful final evidence is included here; no failed run is counted as an autonomous success.

## Not yet established

Autonomous exploration, model-selected workflow completion, detection recall, false-positive rate, and model-driven prompt-injection resistance have **not** been measured. These require a model API key and repeated evaluation. Policy tests show that model output cannot change scope or invoke arbitrary tools; they do not prove that a model will always choose useful workflows.

The known help-page 404 was not part of the scripted search reproduction test. No detection credit is claimed for it.
