# Solari QA report

Run: 08f48387-640c-4baa-95c8-5123a7d406bb

Target: https://138a531dbd85071d91b2-3000.preview.getsolari.com/

Termination: workflows-limit

Actions: 6; model calls: 6; workflows attempted: 3


Executed actions are not equivalent to passed tests. Policy blocks and infrastructure errors are not application bugs.


## Run log

- 2026-09-06T07:51:31.127Z SETUP: sandbox-create

- 2026-09-06T07:51:32.547Z SETUP: sandbox-connect

- 2026-09-06T07:51:33.114Z SETUP: fixture-upload

- 2026-09-06T07:51:33.871Z SETUP: fixture-start

- 2026-09-06T07:51:34.215Z SETUP: fixture-preview

- 2026-09-06T07:51:35.743Z SETUP: fixture-readiness

- 2026-09-06T07:51:40.256Z SESSION: Solari browser launched

- 2026-09-06T07:51:54.079Z ACTION: catalog-search: navigate

- 2026-09-06T07:52:01.272Z ACTION: catalog-search: fill

- 2026-09-06T07:52:12.658Z ACTION: catalog-search: click

- 2026-09-06T07:52:23.035Z ACTION: about-page: navigate

- 2026-09-06T07:52:30.906Z ACTION: help-page: navigate

- 2026-09-06T07:52:40.746Z WARNING: workflows-limit


## Limitations

This is bounded functional QA, not a security audit. Read routes and controls are owner-approved. Screenshots mask inputs and marked private regions; arbitrary sensitive page content cannot be perfectly detected.
