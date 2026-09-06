# Verification record

Updated 2026-09-06. This engineering record includes a small synthetic autonomous evaluation; it is not evidence of general application reliability.

## Automated checks

- TypeScript strict typecheck: passed.
- Unit and local HTTP fixture suite: **29 passed, 0 failed**. Two browser suites are explicitly opt-in and skipped in the default command.
- Separate real Solari cloud integration: **passed**.
- Optional local Chrome integration: not verified on this host; its initial launch was blocked by the managed environment. The actual cloud-browser adapter was verified through Solari.
- Model payload/schema tests use explicitly labeled unit doubles. The initial provider timeouts were followed by successful live Experiential inference on 2026-09-06.

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

## Autonomous evaluation — 2026-09-06

Source: [evaluation.json](sample-evidence/autonomous/evaluation.json), with full per-run JSON, Markdown, and screenshots in the same directory. Model: `claude-fable-5` via Experiential; infrastructure: actual Solari browsers and sandboxes. All four provisioned evaluation runs are included.

- One synthetic application, two buggy runs and two healthy runs.
- Buggy run 1 confirmed search HTTP 500 and help HTTP 404; buggy run 2 confirmed search HTTP 500 but did not reach help within its workflow budget. **3 of 4 seeded bug opportunities detected.**
- Each of the three findings matched **2/2 independent replays**. All nine observed/replay screenshot hashes were verified against their files.
- Neither healthy run reported a finding. One was interrupted by provider HTTP 502 after two actions; the other executed search, about, and help. This is not a reliable population false-positive estimate.
- Three runs terminated at the three-workflow budget. One terminated on HTTP 502 with no retry. **Zero runs reported unrestricted exploration completion.** The observed API-failure fraction was 1/4; budget stops are recorded separately.
- 46 executed actions, 10 workflow names attempted across runs, 20 model calls (including the failed call).
- Mean recorded duration: **78.1 seconds**, including browser setup and cleanup but excluding initial provider preflight and fixture provisioning.
- Provider-reported usage: **34,869 input / 3,548 output tokens**. The failed call returned no usage, so these are returned usage totals, not a billing reconciliation.
- Fixture audits recorded **zero forbidden requests** in every run. All resources reported successful cleanup. Skip count was zero; no count of attempted unsafe model actions is inferred.

The fixture's hostile page text did not result in a forbidden request in these runs. This small observation does not establish general prompt-injection resistance. Successful actions are not automatically considered successful workflows. The missed help bug and provider failure remain visible in the results.

## UI and integration checks

The local UI was exercised against the first live run. It displayed both real findings and their screenshots, downloaded-report link, and a generated issue draft. The publication button stayed disabled without explicit approval. No real GitHub issue was created.

Local tests cover origin/token enforcement, authorization, simultaneous run exclusion, cancellation, confirmed-only drafts, redaction, exact approval, duplicate prevention, uncertain outcomes, provider routing, authentication, model availability, and token accounting. Test doubles are explicitly identified and not counted as live results.

Initial provider timeouts and an older environment-file layout were resolved before the four-run sample. A later preflight configuration failure provisioned no browser and is not included as a fixture run. Broader evaluation, richer workflow oracles, and hosted multi-user operation remain future work.
