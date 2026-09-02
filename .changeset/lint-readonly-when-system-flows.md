---
'@objectstack/lint': patch
---

lint: `flow-update-readonly-when-field` now inspects `runAs:'system'` flows

The `runAs:'system'` exemption in `validate-readonly-flow-writes` was a single
flow-level early return, so it removed an elevated flow from **both** branches of
the rule. Only the static branch warrants it: the engine skips
`stripReadonlyFields` under `if (!opCtx.context?.isSystem)`, but
`stripReadonlyWhenFields` runs on the update path with no `isSystem` guard at all
(`packages/objectql/src/engine.ts`, the #9107 note: "`isSystem` is still NOT an
exemption here, unlike the static strip below"), pinned as "LOCK 2 — isSystem does
NOT exempt a caller-supplied value".

The exemption now gates the static branch only. A `runAs:'system'` flow whose
`update_record` node writes a `readonlyWhen` field reports the branch's existing
`warning` — the same silent-no-op the rule exists to surface, on the flow class the
rule's own hint tells the author elevation cannot save. A system flow writing a
static `readonly:true` field stays silent, as before; rule ids and severities are
unchanged, and the new finding is advisory and never blocks a build.
