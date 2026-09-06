# Solari QA report

Run: ffec7f0a-d710-4253-a520-8b265e8555fe

Target: https://1d79f4dbd565f1d001bc-3000.preview.getsolari.com/

Termination: workflows-limit

Actions: 24; model calls: 6; workflows attempted: 3


Executed actions are not equivalent to passed tests. Policy blocks and infrastructure errors are not application bugs.


## BUG-001 — CONFIRMED

HTTP 500 at /search

Severity: medium

URL: https://1d79f4dbd565f1d001bc-3000.preview.getsolari.com/search?q=qa-test

Expected (agent hypothesis): Clicking Search submits the query and the page shows search results (or an empty-results message) for the synthetic term without errors.

Observed: HTTP 500 at /search


Steps:

1. navigate https://1d79f4dbd565f1d001bc-3000.preview.getsolari.com/

2. navigate https://1d79f4dbd565f1d001bc-3000.preview.getsolari.com/catalog

3. fill query using qa-test

4. click search

Reproduced: 2/2 attempts

Evidence: [screenshot](evidence/observed-d30d2d0b086f.png) — SHA-256 0d220e22fd75d128329c90e2cb0e1f26b8271b4951bf0c9fd452d732f816ab44

Same HTTP/runtime failure after independent safe replay, without policy blocks. Blank-page heuristics remain potential.


## BUG-002 — CONFIRMED

HTTP 404 at /help

Severity: medium

URL: https://1d79f4dbd565f1d001bc-3000.preview.getsolari.com/help

Expected (agent hypothesis): Help page loads with informational content and navigation controls remain available.

Observed: HTTP 404 at /help


Steps:

1. navigate https://1d79f4dbd565f1d001bc-3000.preview.getsolari.com/

2. navigate https://1d79f4dbd565f1d001bc-3000.preview.getsolari.com/catalog

3. fill query using qa-test

4. click search

5. navigate https://1d79f4dbd565f1d001bc-3000.preview.getsolari.com/help

Reproduced: 2/2 attempts

Evidence: [screenshot](evidence/observed-aef976071de6.png) — SHA-256 c16a83e90bac8e2826539390e56b7c91b8340f0ff245e214b99ed746a1350b54

Same HTTP/runtime failure after independent safe replay, without policy blocks. Blank-page heuristics remain potential.


## Run log

- 2026-09-06T07:45:19.567Z SETUP: sandbox-create

- 2026-09-06T07:45:21.888Z SETUP: sandbox-connect

- 2026-09-06T07:45:22.271Z SETUP: fixture-upload

- 2026-09-06T07:45:23.029Z SETUP: fixture-start

- 2026-09-06T07:45:23.432Z SETUP: fixture-preview

- 2026-09-06T07:45:24.869Z SETUP: fixture-readiness

- 2026-09-06T07:45:28.770Z SESSION: Solari browser launched

- 2026-09-06T07:45:43.305Z ACTION: catalog-search: navigate

- 2026-09-06T07:45:50.713Z ACTION: catalog-search: fill

- 2026-09-06T07:45:58.975Z ACTION: catalog-search: click

- 2026-09-06T07:46:00.814Z POTENTIAL: HTTP 500 at /search

- 2026-09-06T07:46:25.365Z CONFIRMED: BUG-001: 2/2 replays matched

- 2026-09-06T07:46:34.027Z ACTION: help-page: navigate

- 2026-09-06T07:46:35.879Z POTENTIAL: HTTP 404 at /help

- 2026-09-06T07:47:02.047Z CONFIRMED: BUG-002: 2/2 replays matched

- 2026-09-06T07:47:11.671Z ACTION: about-page: navigate

- 2026-09-06T07:47:17.813Z WARNING: workflows-limit


## Limitations

This is bounded functional QA, not a security audit. Read routes and controls are owner-approved. Screenshots mask inputs and marked private regions; arbitrary sensitive page content cannot be perfectly detected.
