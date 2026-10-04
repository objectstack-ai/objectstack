---
'@objectstack/spec': minor
'@objectstack/runtime': minor
---

A refused flow resume answers the engine's own code, on the REST resume door and the MCP `resume_run` tool alike, as the 17.1.0 release notes, `client.automation.resume()`'s documentation and the flows guide already state (#21724).

Clause-②: yes (widening)

- **What moves on the wire.** `POST /api/v1/automation/:name/runs/:runId/resume` used to hand the error builder a status and no code for the engine's refusals, so `error.code` was derived from the status. It now carries the engine's code:

  | Refusal | Status | `error.code` before | `error.code` now |
  |---|---|---|---|
  | a screen input that breaks the screen's declared fields | 400 | `VALIDATION_ERROR` | `INVALID_SCREEN_INPUT` |
  | a signal that writes an engine-reserved `$` name | 400 | `VALIDATION_ERROR` | `INVALID_SIGNAL` |
  | an unknown run, a run whose flow is gone, or a run whose paused node was edited away | 404 | `RESOURCE_NOT_FOUND` | `RUN_NOT_FOUND` |
  | the suspended-run store is unreadable | 503 | `SERVICE_UNAVAILABLE` | `STORE_UNAVAILABLE` |
  | another resume already holds the run | 409 | `RESOURCE_CONFLICT` | `RESUME_IN_PROGRESS` |

  `PERMISSION_DENIED` (403) is unchanged. No status moves, nothing that was accepted is refused, and a refused resume still leaves the run paused, so a corrected resume still completes it. A caller that branched on the status-derived code reads the documented one instead: `err.code` from `client.automation.resume()` is now `INVALID_SCREEN_INPUT`, `INVALID_SIGNAL` or `RUN_NOT_FOUND`, which is what lets it tell a bad screen value from a reserved signal name.
- **`@objectstack/spec` — `minor`.** The ADR-0112 error-code ledger registers `INVALID_SCREEN_INPUT` under `@objectstack/service-automation`, beside `INVALID_SIGNAL` and `RUN_NOT_FOUND`. The engine already returned it and the docs already promised it, but `ErrorCode`, and therefore `ApiErrorSchema`, refused it. The published vocabulary gains one member and loses none.
- **`@objectstack/runtime` — `minor`.** The resume door's answer set gains the five codes above. Both doors read one classifier, so the REST route and `resume_run` answer the same code for the same engine result.
