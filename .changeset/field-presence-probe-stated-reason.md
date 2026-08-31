---
"@objectstack/metadata-core": patch
---

docs(metadata-core): correct `createFieldPresenceProbe`'s stated reason — the `organization_id` column is provisioned unconditionally (#13416)

`createFieldPresenceProbe` is a published export, and its docstring is emitted
verbatim into the built declarations (`dist/index.d.ts` and `dist/index.d.cts`),
so it is what a consumer's editor shows on hover. That docstring recorded a
falsified fact as the probe's reason for existing: *"the SchemaRegistry
auto-injects `organization_id` only in multi-tenant mode … so on single-tenant
stacks the `sys_audit_log` / `sys_activity` tables have no such column."*

The column has since been decoupled from the posture flag. It is provisioned
**unconditionally**, subject only to the explicit opt-outs (`systemFields:
false`, `systemFields.tenant: false`, `managedBy: 'better-auth'`,
`tenancy.enabled: false`); the multi-tenant flag now governs only whether the
column is **INDEXED**, never whether it EXISTS. Three sources in the tree agree:
`applySystemFields` says so at the injection site (`objectql/src/registry.ts`),
the derivation it consumes (`resolveInjectedSystemColumns`,
`spec/src/data/injected-system-columns.ts`) accepts no `multiTenant` input to
decide with, and `objectql/src/registry-tenancy-posture.test.ts` pins it
executably. Both tables the old sentence named resolve the column on every
posture.

Read literally, the stale sentence invited two wrong moves — deleting the probe
as dead once someone checked that the column is always provisioned, or
hand-rolling a fresh posture-conditional probe elsewhere on the same false
premise. The sentence is therefore corrected and its history kept, rather than
dropped: the probe never read the posture flag, and what it still answers is
provenance, not posture (an ADR-0015 `external` object, the explicit opt-outs,
and an engine with no `getSchema`).

Prose only. No runtime behaviour, no exported signature and no accept/reject
decision moves; the probe's implementation is byte-identical.
