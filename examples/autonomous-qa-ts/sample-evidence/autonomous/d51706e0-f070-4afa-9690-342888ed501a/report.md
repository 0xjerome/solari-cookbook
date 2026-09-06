# Solari QA report

Run: d51706e0-f070-4afa-9690-342888ed501a

Target: https://ded5bb2816c76093e550-3000.preview.getsolari.com/

Termination: agent-error

Actions: 2; model calls: 2; workflows attempted: 1


Executed actions are not equivalent to passed tests. Policy blocks and infrastructure errors are not application bugs.


## Run log

- 2026-09-06T07:48:14.454Z SETUP: sandbox-create

- 2026-09-06T07:48:15.861Z SETUP: sandbox-connect

- 2026-09-06T07:48:16.228Z SETUP: fixture-upload

- 2026-09-06T07:48:17.418Z SETUP: fixture-start

- 2026-09-06T07:48:17.755Z SETUP: fixture-preview

- 2026-09-06T07:48:19.268Z SETUP: fixture-readiness

- 2026-09-06T07:48:23.359Z SESSION: Solari browser launched

- 2026-09-06T07:48:36.092Z ACTION: catalog-search: navigate

- 2026-09-06T07:48:56.575Z WARNING: Model API failed (HTTP 502); no automatic retry


## Limitations

This is bounded functional QA, not a security audit. Read routes and controls are owner-approved. Screenshots mask inputs and marked private regions; arbitrary sensitive page content cannot be perfectly detected.
