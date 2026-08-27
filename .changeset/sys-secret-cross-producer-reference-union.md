---
"@objectstack/cli": patch
---

feat(cli): build the cross-producer `sys_secret` reference union — the primitive a safe orphan sweep needs (#12663)

`sys_secret` has three privileged producers, each holding its handle in a
column of its own: `SettingsService` (a bare `sec_…` in
`sys_setting.value_enc`), the engine's `secret`-typed field channel
(`secret:<id>` on an arbitrary business row) and the datasource credential
binder (`sys_secret:<id>` at a datasource artefact's
`external.credentialsRef`). Nothing enumerated all three, so the only sound
deletion predicate — "attributable AND unreferenced by the COMPLETE union" —
had no union to stand on. `packages/cli/src/utils/secret-reference-union.ts`
is that union, read-only across all three surfaces.

Why the shipped report-only classifier is not enough, reproduced against real
code in the new test file: `classifySysSecretRows` attributes a row by
`(namespace, key)` membership in the settings manifests' encrypted specifiers,
and that is a **name match, not ownership** — `sys_secret` carries no producer
column and the three producers write those two columns with three different
meanings. A live, engine-owned credential on an object named like a settings
namespace, with a field named like a specifier key, classifies `orphaned`
today. There is no recovery from acting on that: the audit trail records
digests, not handles, so nothing can name the destroyed handle afterwards.

Completeness is therefore the whole contract, and it is structural rather than
asserted:

- the family set is closed and the assembler takes a `Record` over it, so
  omitting a producer is a type error, not a smaller union;
- a read that did not happen is a declared **gap**, never an empty answer — a
  missing driver, a throwing read, an unparseable artefact, or a host that did
  not declare its code-defined datasources all make the union
  `complete: false`, and `assertSecretReferenceUnionComplete` refuses it with
  the ADR-0112 pair `PRECONDITION_REQUIRED` / 428;
- family 2 is enumerated from the metadata registry on every call, because its
  holders are every `secret`-typed field on every registered object,
  tenant-authored ones included — a newly registered secret field is in the
  union with no code change.

Reads go to the driver through the engine's public `getDriverForObject()`: the
`secret:` ref only exists at that level (the read path masks it
unconditionally), and any scoped read would silently under-report — the
direction that deletes live credentials.

`patch` rather than `minor`: this adds no surface to the package's entry
barrel and no command or flag. It is an internal primitive whose named reader
is the deletion half of #8103, in this same package; publishing it as an
external API is a separate decision with its own changeset. Read-only by
construction — nothing here writes, deletes or decrypts, and it contains no
deletion command, dry-run or sweep.
