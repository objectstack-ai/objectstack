---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/service-automation": minor
---

feat(automation): surface silently-stripped write fields as step warnings (#3407)

`update_record` used to report an unconditional `success` even when the data
layer legally stripped the requested write fields — static `readonly` (#2948)
or a TRUE `readonlyWhen` predicate (#3042). The only trace was a server-side
logger warn, invisible in the flow run trace: an author saw a clean 3ms
`success` while the DB truth never changed (how #3356's approval stage
write-backs failed unnoticed).

- **spec**: new `DroppedFieldsEventSchema` / `DroppedFieldsEvent`
  (`{ object, fields, reason: 'readonly' | 'readonly_when' }`) in
  `data/data-engine.zod.ts`, and a `WriteObservabilityOptions`
  (`onFieldsDropped` listener) mixin on `IDataEngine.insert/update` option
  params in `contracts/data-engine.ts`. The listener is a TS-contract-level,
  in-process-only channel — deliberately NOT part of the serializable Zod
  options schemas or the RPC boundary.
- **objectql**: `engine.update()` reports each strip pass's dropped keys +
  reason through `options.onFieldsDropped` (all four strip sites: single-id +
  bulk × readonly + readonlyWhen). A throwing listener never breaks the write.
  System-context writes skip the readonly strip and therefore report nothing,
  as before. `insert()` accepts the option for symmetry but strips nothing
  today (INSERT is readonly-exempt; FLS write denial throws).
- **service-automation**: `NodeExecutionResult` and `StepLogEntry` gain
  advisory `warnings?: string[]`; `update_record` / `create_record` attach one
  warning per strip event naming the dropped fields, plus a structured
  `droppedFields` output (`{<nodeId>.droppedFields}`) for downstream nodes.
  `success` semantics are unchanged — stripping stays legal, it just is no
  longer silent.
