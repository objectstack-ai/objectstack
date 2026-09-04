---
"@objectstack/spec": minor
---

feat(spec): declare `AutomationContext.recordLoadDenied` — the flow face of the caller-scope record-load signal (#14244)

An action of `type: 'flow'` hands its target flow the same `record` object the
script/body face receives, and the dispatcher stamps the requested `recordId`
onto `record.id` whether or not the caller's own scope could read the row —
new-record / record-less actions depend on that stamp. So a flow started on a
row its invoker cannot read receives `record = { id: <recordId> }`, shaped
exactly like a legitimate record-less start, with nothing on the run's context
distinguishing the two. The script/body face got its distinguishing key in the
previous release (`ctx.recordLoadDenied`, `@objectstack/runtime`); the flow face
had no equivalent on its contract.

**The addition: `AutomationContext.recordLoadDenied?: true`.** The exact shape
the runtime's one shared producer emits (`actionRecordLoadSignal` in
`action-execution.ts` returns `{ recordLoadDenied?: true }`), mirrored rather
than respelled: `true` exactly when the dispatcher's caller-scope load did not
deliver the row; **absent** — never `false` — otherwise, so a consumer reads
`recordLoadDenied === true`. It reports "the row did not resolve for this
caller", not "an authorization error was caught": a row hidden by row-level
security and an id that names nothing both arrive as `RECORD_NOT_FOUND`,
deliberately, and the key does not pretend to separate them.

A `runAs: 'user'` flow re-derives the caller's scope on its own reads, so the
stub resolves to nothing there. The key exists for the `runAs: 'system'` flow:
it runs elevated **and** receives the stub, and this is what it guards on before
acting on a row its invoker has not demonstrated read access to.

- **Purely additive.** The key is optional; every existing `AutomationContext`
  literal type-checks unchanged and no existing key changes value. Pinned at
  the type level (`true | undefined`, `false` refused at compile time).
- **Declared, not yet populated on the flow face.** This release declares the
  key on the contract. `dispatchFlowAction` (both action doors — REST
  `POST /api/v1/actions/...` and the MCP `run_action` bridge) does not yet pass
  the producer's signal into the run's context; that is a separate runtime
  change. Until it lands, a flow run never sees this key, so a guard on it is
  inert (never `true`), never wrong.
- **Nothing narrows.** `dispatchFlowAction` still starts the run;
  `runAs: 'system'` stays a declared, documented authoring decision.
