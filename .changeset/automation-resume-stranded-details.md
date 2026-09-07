---
"@objectstack/spec": minor
"@objectstack/runtime": minor
"@objectstack/client": patch
---

The automation resume route's `400 FLOW_FAILED` now says whether the run is stranded.

`POST /api/v1/automation/:name/runs/:runId/resume` answers a run that consumed its pause and then failed with `400 FLOW_FAILED`, and until now its `error.details` carried the run's two artefacts only (`errorMessage`, `summary`). The engine's own verdict was dropped at the door: `AutomationResult.status: 'stranded'` — a run that is terminally failed *but* repairable by an explicit operator verb, because the pause a durable decision was waiting on is gone with the failure — reached the wire as the same `400` a plain terminal failure does, so an HTTP-only caller could not tell "beyond reach" from "repair waiting".

- **`@objectstack/spec`** declares `ResumeFailureDetailsSchema` (`@objectstack/spec/api`): `{ runId, status?: 'failed' | 'stranded', repairable }` — the machine-readable shape of a resume failure told to the caller, declared once so every carrier of the family ruling spells the same members.
- **`@objectstack/runtime`**: the resume door's `400 FLOW_FAILED` details now carry that structure beside `errorMessage` / `summary`. `runId` is the run the resume was addressed to; `status` is the engine's own stamp, forwarded verbatim when it set one and never synthesised (the subflow-child-failed exit stamps none today); `repairable` is `status === 'stranded'` and is **always present on this arm** — present-and-false on a plain terminal failure, deliberately, so an absent member reads as an older server rather than as "not repairable". The code stays `FLOW_FAILED` (no `FLOW_STRANDED` sibling is minted), so a client that treats it as terminal keeps working and one that wants to offer a repair branches on `details.repairable`, never on the message text. The trigger door and `/actions` are unchanged: they never resume, so the member is absent there and absent means "not a resume".
- **`@objectstack/client`**: `automation.resume` documents the new members.
