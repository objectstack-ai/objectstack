---
"@objectstack/client": minor
---

feat(client): `automation.resume()` / `automation.getScreen()` — finish a paused screen flow from the SDK (#3528)

A `type: 'screen'` flow suspends when it reaches a `screen` node: `execute()`
returns `{ status: 'paused', runId, screen }` and the run waits for input. The
second half of that contract — `POST /automation/:flow/runs/:runId/resume` —
has shipped in the dispatcher since ADR-0019, but the client SDK's automation
surface stopped at `getFlow` / `execute` / `listRuns` / `getRun`. Anything built
on the SDK could therefore *start* a screen flow and never finish it: the run
stayed suspended and the only way out was hand-rolling the HTTP call. That gap
is what stranded the Console's developer "Flow Runs" test runner, where every
test run of a screen flow orphaned a `paused` row.

- **`automation.resume(flowName, runId, signal?)`** — posts the collected screen
  values as `inputs` (applied as bare flow variables), plus the approval-style
  `output` / `branchLabel` the dispatcher already accepts. Returns the next
  `{ status: 'paused', screen }` of a multi-step wizard, or the terminal
  `AutomationResult`.
- **`automation.getScreen(flowName, runId)`** — the screen a paused run is
  waiting on, so a client that did not launch the run (a page reload, another
  tab, an inbox) can render the pending step before resuming.
- Both are available on the environment-scoped client
  (`client.project(id).automation.*`) as well as the unscoped one.

Also covers the two dispatcher routes with tests — the resume and screen paths
had none, including the ordering guard that keeps `/runs/:runId/screen` from
being swallowed by the `/runs/:runId` run lookup.
