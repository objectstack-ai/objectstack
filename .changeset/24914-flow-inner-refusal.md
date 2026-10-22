---
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
---

fix(service-automation,runtime): a flow whose data node is refused answers its caller with the refusal structured — `details.innerRefusal` and the producer-marked `userMessage` on every door's `400 FLOW_FAILED` — beside an unchanged `message`

Clause-②: yes (widening)
Metadata-protocol: none

Ruling B′ on #24914 (the maintainer's 「同意」, decision batch #379 item 5), the emission half of the contract `@objectstack/spec` declared in #24996. A record save the platform refuses reaches a record form as `code`, `message` and the producer-marked `userMessage`; the same refusal met by a flow's data node used to be flattened into one string (`Node 'ID' failed: create_record(OBJECT) failed: …`), so a screen flow could only show its user that developer text.

- **`service-automation`.** The catch arms of `get_record`, `create_record`, `update_record` and `delete_record` read the refusal off the thrown error: the producer-marked `userMessage` (through `declaredUserMessage`) and, for a throw that declared a 4xx answer, `{ code, message }` with `code` in the WIRE spelling the data door answers for the same throw — `UNIQUE_VIOLATION` for a unique refusal, `VALIDATION_FAILED`, `PERMISSION_DENIED`, or the member an app hook's declared status names. `NodeExecutionResult` gains the two optional members, and the engine carries them from the failing node to `AutomationResult.userMessage` / `.innerRefusal` on `execute()`'s failure exit, the `resumeInternal` stranded exit and the retry exits. A fault (no declared answer, or a declared 5xx) carries neither member; nothing is read from message text.
- **`runtime`.** The trigger, resume, `/actions` and declared-endpoint doors build their `400 FLOW_FAILED` details through one builder typed as `FlowFailureDetailsSchema` (`errorMessage?`, `summary?`, `innerRefusal?`) and put the run's `userMessage` at the envelope's top level (`ApiErrorSchema.userMessage`). The MCP `resume_run` bridge carries both as the REST resume door serves them. `DomainHandlerDeps.error` gains an optional fourth argument, `extra: { userMessage? }`, the declared slot the doors use; a call without it builds the envelope it always built.
- **Unchanged.** Every `error` / `message` text, byte for byte — the node's, the engine's prefix, the stored run, approvals and each door's wording. The in-flow `$error.code` keeps the engine's in-process `DUPLICATE_RECORD`. `error.code` stays `FLOW_FAILED`, and `AutomationResult.code` stays the closed union.

**For consumers.** A flow runner can render a refused run the way a record form renders a refused save: the top-level `userMessage` when present, then `details.innerRefusal`, then `message`. A client that does not read the new members keeps its current behaviour. A container that rewords a child's failure into its own (`try_catch` without a catch region, `subflow`) does not forward the members yet; the run then carries none.
