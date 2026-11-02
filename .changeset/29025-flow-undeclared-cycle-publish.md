---
'@objectstack/metadata-protocol': minor
'@objectstack/metadata-core': minor
'@objectstack/service-automation': patch
---

**BREAKING** fix(metadata)!: a flow whose loop is not closed by a `type: 'back'` edge is refused at publish, and its draft read says so, instead of publishing and then never registering

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-automation/references/state-machines-and-approvals.md` teaches that the resubmit edge MUST be typed `'back'` and that `registerFlow` rejects an unmarked cycle; both stay true, and the publish door now refuses the same flow earlier, in the same words.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The publish doors now refuse a flow body the automation engine already refused to register, with the engine's own sentence, so a published body that could never run has nothing a migration could rewrite it to: the author's fix is the one the refusal names. -->

**BREAKING** accept-set narrowing at the runtime authoring gate (`@objectstack/metadata-protocol`), which the metadata draft read and every publish door run (`PUT /api/v1/meta/:type/:name` live, `POST …/publish`, `POST /api/v1/packages/:id/publish-drafts`).

- **Before.** A flow whose top-level graph had a cycle with no edge typed `back` (ADR-0044) saved as a draft, its draft read answered `_diagnostics: { valid: true }`, and it published (`outcome: 'published'`). The automation engine then refused to register it ("Flow contains a cycle: push → check → revise → push. …"), so the flow never ran, and only the by-name read's `registration` and a boot-log warning said why.
- **Now.** The draft still saves (drafts are never gated). Its read answers `valid: false` with an error coded `flow-undeclared-cycle` on the cycle-closing edge (`edges.N`), and every publish door refuses it `422 INVALID_METADATA` with that finding; a package publish refuses the batch (`outcome: 'refused'`). The message is the engine's registration refusal, word for word.
- **One judge.** The cycle walk moved from `@objectstack/service-automation` to `@objectstack/metadata-core` as `findUndeclaredFlowCycle` (with `undeclaredFlowCycleMessage`). The engine's registration and the publish gate both call it, so they refuse exactly the same graphs; the engine's behaviour and message are unchanged. `@objectstack/metadata-core/testing` exports `FLOW_CYCLE_CORPUS`, the case table both faces are tested against.
- **Unchanged.** A cycle with any of its edges typed `back` publishes and registers, as before. Cycles inside a `loop` / `parallel` / `try_catch` region are judged where they were. `os validate` and `os build` do not run this check yet.

**The remedy.** None for a flow that registers today: it publishes exactly as before. A flow this now refuses was already refused by the engine at registration and never ran; the refusal names the closing edge, and ADR-0044's `type: 'back'` on that edge is how an intended loop is declared. A stored flow published before this change is re-registered exactly as before (still refused by the engine).
