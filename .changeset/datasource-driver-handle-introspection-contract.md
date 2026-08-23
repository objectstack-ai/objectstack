---
"@objectstack/service-datasource": minor
---

feat(service-datasource): `DatasourceDriverHandle.introspectSchema` declares the spec introspection contract, so a mis-shaped custom driver fails to compile naming the wrong field (#11381, option C of the #11123 ruling)

**BREAKING** for TypeScript hosts that build custom external-datasource
drivers, shipped as `minor` under the repo's launch-window convention for
breaking changes.

`DatasourceDriverHandle.introspectSchema` — the seam every host-built driver
crosses, since the framework deliberately ships no driver-by-id registry —
was typed `Promise<unknown>`. The `isPrimary` → `primaryKey` retirement
(#11124, shipped in 17.2.0) named the compiler as the channel that reaches
every affected consumer, but against an `unknown` return that channel
provably never fired: a host driver spelling the per-column primary-key flag
`isPrimary`, or returning `{ tables }` with no `dialect`/`introspectedAt`,
compiled clean, and the mis-shape surfaced only as a federated table whose
records silently could not be located or updated.

The member now declares `Promise<IntrospectedSchema>` — the one introspection
contract in `packages/spec` (`contracts/schema-diff-service.ts`). A
mis-shaped driver is refused at compile time, at the offending field:
`Property 'primaryKey' is missing in type '…' but required in type
'IntrospectedColumn'`, and on a fresh literal additionally `'isPrimary' does
not exist in type 'IntrospectedColumn'`. A driver that already returns the
spec shape — or a richer declared type extending it, the driver-sql /
objectql pattern (table-level `primaryKeys`, per-column `maxLength`) —
compiles unchanged.

Runtime behaviour does not change. The `primaryKeyReader` compatibility belt
in `ExternalDatasourceService` keeps absorbing the retired spelling from
producers no compiler reaches (drivers already built against older versions,
plain-JS drivers, casts). Removing that belt is #11123 option B — a later,
separate step gated on this tightening being released and the retirement
being published — and is not part of this change.

<!-- adr-0087: not-required (runtime-interface-only packages/services/service-datasource/src/contracts/datasource-driver-factory.ts#DatasourceDriverHandle) the tightened member is a published runtime TypeScript interface describing a driver handle's capability surface — not a metadata surface. There is no Zod schema, no `packages/spec` declaration of the old `Promise<unknown>` signature, and no stored representation of a driver handle, so `objectstack migrate meta` has nothing to rewrite; the channel that reaches every affected consumer is the compiler, precisely and at every site. -->
