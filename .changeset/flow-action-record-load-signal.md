---
"@objectstack/runtime": minor
"@objectstack/spec": patch
---

feat(runtime): a flow action's run context now carries `recordLoadDenied` (#15168)

The previous release declared `AutomationContext.recordLoadDenied?: true` and
said so plainly: **declared, not yet populated on the flow face.** The
script/body face of both action doors emitted the signal, but
`dispatchFlowAction` handed `automation.execute` a context without it, so a
`runAs: 'system'` flow that guarded on the documented key was inert — never
`true`, never wrong, and indistinguishable from a flow whose caller could read
the row.

**This release populates it, on both doors in one stroke** — REST
`POST /api/v1/actions/...` and the MCP `run_action` bridge:

```js
// a runAs:'system' flow, guarding before it acts on the subject row
if (context.recordLoadDenied === true) { /* the invoker cannot read this row */ }
```

- **The exact producer shape, unchanged.** The one shared producer
  (`loadActionSubjectRecord` → `actionRecordLoadSignal`) already returns
  `{ recordLoadDenied?: true }`, and the flow door now spreads it as a
  **sibling of `record`** — never a key on the record, and **absent**, never
  `false`, when nothing was refused. So a flow reads it exactly as a handler
  does, `recordLoadDenied === true`.
- **Both doors, structurally.** `dispatchFlowAction`'s wiring now takes the
  load OUTCOME (`subject`) instead of a bare `record`, and derives both the
  record and the signal from it. A caller can no longer forward the row while
  dropping the verdict that says the caller could not read it — the omission is
  a compile error rather than a guard silently inert one door over, which is
  the defect the handler-face signal was filed for.
- **Purely additive.** Nothing is refused that was not refused before, no
  existing key changes value, and the `recordId` stamp is deliberately kept:
  `record.id` still arrives exactly as it did, which is why the flag — and not
  `record.id` — is the authorization predicate. Whether the automation engine
  *acts* on the key (a flow-level refusal, a step condition) is a separate
  decision and is deliberately not part of this change.
- **`@objectstack/spec` (docs only).** The contract's "not yet populated on the
  flow face" sentence is retired; no type changes.
