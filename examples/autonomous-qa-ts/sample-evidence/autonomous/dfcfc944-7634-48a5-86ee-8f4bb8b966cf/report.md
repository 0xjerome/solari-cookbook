# Solari QA report

Run: dfcfc944-7634-48a5-86ee-8f4bb8b966cf

Target: https://c4facad37b092eb2d914-3000.preview.getsolari.com/

Termination: workflows-limit

Actions: 14; model calls: 6; workflows attempted: 3


Executed actions are not equivalent to passed tests. Policy blocks and infrastructure errors are not application bugs.


## BUG-001 — CONFIRMED

HTTP 500 at /search

Severity: medium

URL: https://c4facad37b092eb2d914-3000.preview.getsolari.com/search?q=qa-test

Expected (agent hypothesis): Clicking Search submits the query and the page shows search results or an empty-results message for the synthetic term.

Observed: HTTP 500 at /search


Steps:

1. navigate https://c4facad37b092eb2d914-3000.preview.getsolari.com/

2. navigate https://c4facad37b092eb2d914-3000.preview.getsolari.com/catalog

3. fill query using qa-test

4. click search

Reproduced: 2/2 attempts

Evidence: [screenshot](evidence/observed-d30d2d0b086f.png) — SHA-256 0d220e22fd75d128329c90e2cb0e1f26b8271b4951bf0c9fd452d732f816ab44

Same HTTP/runtime failure after independent safe replay, without policy blocks. Blank-page heuristics remain potential.


## Run log

- 2026-09-06T07:49:04.065Z SETUP: sandbox-create

- 2026-09-06T07:49:05.790Z SETUP: sandbox-connect

- 2026-09-06T07:49:06.130Z SETUP: fixture-upload

- 2026-09-06T07:49:06.884Z SETUP: fixture-start

- 2026-09-06T07:49:07.255Z SETUP: fixture-preview

- 2026-09-06T07:49:08.780Z SETUP: fixture-readiness

- 2026-09-06T07:49:13.762Z SESSION: Solari browser launched

- 2026-09-06T07:49:29.665Z ACTION: catalog-search: navigate

- 2026-09-06T07:49:37.339Z ACTION: catalog-search: fill

- 2026-09-06T07:49:45.858Z ACTION: catalog-search: click

- 2026-09-06T07:49:47.494Z POTENTIAL: HTTP 500 at /search

- 2026-09-06T07:50:13.779Z CONFIRMED: BUG-001: 2/2 replays matched

- 2026-09-06T07:50:23.613Z ACTION: home-navigation: navigate

- 2026-09-06T07:50:32.091Z ACTION: about-page: navigate

- 2026-09-06T07:50:38.713Z WARNING: workflows-limit


## Limitations

This is bounded functional QA, not a security audit. Read routes and controls are owner-approved. Screenshots mask inputs and marked private regions; arbitrary sensitive page content cannot be perfectly detected.
