---
"@objectstack/types": minor
"@objectstack/plugin-approvals": minor
"@objectstack/rest": minor
---

An approval decision that lands while its flow run strands now says so in fields, not only in prose.

`POST /api/v1/approvals/requests/{id}/reject` — and its sibling decision doors — could produce three coexisting outcomes from one call: the caller read HTTP 500, the request row **was** in its terminal status and had left the pending inbox, and the workflow run was stranded. A caller reading 500 has one honest inference available — "the rejection did not happen" — and it was the wrong one, so scripts and operators retried or escalated against a decision that was already durable. The only carrier of the truth was English prose in `error`, so finding the affected run meant regexing a run id out of a sentence, and nothing said whether that run could be repaired at all.

The 500 stays. A recorded decision whose flow never advances is still a failure and is still reported as one; the door does not become atomic and no decision is ever rolled back. What changed is that it stops discarding what the engine already said:

- **The `RESUME_FAILED` body gains four fields**, additively — `finalized` (always `true`: the decision stands), `decision`, `runId`, and `repairable`. Existing consumers see the same `code`, the same `error` and the same status.
- **`repairable` carries the engine's own discriminator** — `AutomationResult.status === 'stranded'`, the state stamped on exactly the exit that journals a repair snapshot. `false` is the answer for every other failure, including a lost run: absence of the signal is not repairability, and a repair verb that would refuse is worse than no promise.
- **`serviceResume` carries `status`** through to the door. It previously read only `success` / `code` / `error`, and the stranded exit reports a `status` and no `code` at all — so the platform's own repairability signal died one line before the envelope was built.

`@objectstack/types` gains `strandedDecisionFailure` / `strandedDecisionDetails` and the `StrandedDecisionDetails` type — the constructor and its recogniser in one module, so the producing service and the REST door cannot drift. A `RESUME_FAILED` raised without that carrier answers exactly the body it always did; the door never synthesises the envelope.
