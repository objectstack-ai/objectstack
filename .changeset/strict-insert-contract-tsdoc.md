---
"@objectstack/spec": patch
---

docs(spec): `WriteObservabilityOptions.strictReadonlyWrites` no longer claims INSERT ignores it (#7064)

The contract's closing paragraph still said "INSERT ignores it … insert is
exempt from both strips, so there is nothing to refuse" — true when #5126
shipped the option, false since #5503 wired `engine.insert` to REFUSE a
payload carrying a runtime-owned value (`RUNTIME_OWNED_FIELD_TYPES`, today
`autonumber`) under `strictReadonlyWrites: true`, throwing
`ReadonlyFieldRejectedError` (`ERR_READONLY_FIELD_REJECTED`,
`operation: 'insert'`) and writing nothing.

The TSDoc now states, measured against the engine: insert stays exempt from
the two author-declared strips at this seam (#3413 — an in-process create may
seed a `readonly: true` field's initial value; `readonlyWhen` cannot lock a
create), while the runtime-owned strip runs on insert and is exactly what
strict refuses; the exempt writers are the ones the error message names
(`isSystem`, and `preserveAudit` for a #3493 historical import), explicitly
scoped to this in-process seam so the DataProtocol ingress policy
(#3043/#6640, `FieldSchema.readonly`) stays a distinct layer. Prose only — no
key, type, or behaviour changes.
