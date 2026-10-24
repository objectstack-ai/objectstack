---
'@objectstack/spec': minor
---

feat(spec): a failed flow run can carry the refusal its write node met — `AutomationResult.userMessage` / `AutomationResult.innerRefusal`, and one `FlowFailureDetailsSchema` for every door's `400 FLOW_FAILED` details

Clause-②: yes (widening)

The maintainer's 「同意」 on ruling B′ of #24914 (decision batch #379 item 5): the inner refusal of a refused flow write node reaches the client structurally, the way a record save's refusal does, and its code takes the wire spelling. This release is the contract half. The engine and the four doors start emitting the new members when the services and runtime half (#24914) lands; until then nothing on the wire changes.

- **`AutomationResult` (`@objectstack/spec/contracts`) gains two optional members.** `userMessage` has `ApiErrorSchema.userMessage`'s semantics: it is producer-marked end-user text, present only when the inner refusal's producer opted in at throw time, and it never replaces `error`. `innerRefusal` is `{ code, message }`. Its `code` is the wire spelling a record save of the same write answers in `error.code` (`UNIQUE_VIOLATION` for a unique refusal), parsed against the same closed `ErrorCode` set `ApiErrorSchema.code` uses. `TriggerFlowResponseSchema.data` mirrors both, so the `TriggerFlowResponse['data']` = `AutomationResult` parity pin holds.
- **New `FlowInnerRefusalSchema` and `FlowFailureDetailsSchema` (`@objectstack/spec/api`).** The second one is the `error.details` of the `400 FLOW_FAILED` arm of the trigger, resume, `/actions` and endpoint doors, declared once: `errorMessage?`, `summary?` and `innerRefusal?`. On the resume door, `ResumeFailureDetailsSchema`'s `runId` / `status` / `repairable` sit beside them in the same object, and each schema parses its own members.
- **The #9585 `/actions` ceiling, relaxed by the ruling.** That ceiling was exactly two keys in `error.details` (`errorMessage`, `summary`) and no new schema key. Ruling B′ adds one key and names it, `innerRefusal`, so the ceiling is now the three keys `FlowFailureDetailsSchema` declares, at every door.
- **Unchanged.** `error.message` keeps each door's wording byte for byte, `error.code` stays `FLOW_FAILED`, and `AutomationResult.code` stays the closed union the #9378 ruling settled. The inner code is nested in `innerRefusal`, so no new ledger code is added. Every new member is optional: an envelope without them parses exactly as before.

**For consumers.** A flow runner can show a failed run's refusal the way a record form shows a save's refusal. Read the envelope's top-level `userMessage` when it is present. Otherwise read `details.innerRefusal` (`code` and `message`), and fall back to `message` last. A client running behind the server ignores the new members and keeps its current behaviour.
