---
"@objectstack/spec": patch
---

docs(spec): make the `SystemIdentifierSchema` docblock name the surfaces it actually validates (#13621)

Prose truth restoration. No regex change, no accept-set change, no `.describe()`
change — the diff is comment lines only.

The docblock claimed eleven consuming surfaces ("Applies to all metadata that
acts as a machine identifier": object names, field names, role names, permission
set names, action/trigger names, event keys, app IDs, menu/page IDs, select
option values, workflow names, webhook names). The per-surface census on #12245 —
its `os-dev-report` comment is the measurement of record, taken on `origin/main`
@ `e2debee6` — measured **exactly one** of those eleven as validated by this
schema: select option values (`SelectOptionSchema.value`). Eight are validated by
`SnakeCaseIdentifierSchema` or by an inline flat regex that forbids dots outright,
and event keys went to the sibling `EventNameSchema`, since retired unbound
(#13613). The reach is in-repo, measured: tsup's declaration emit does not carry
this file's docblocks into the published `.d.ts`, so no consumer tooltip changes
— the readers being corrected are the ones working in this source, which is the
reason the card was filed: an AI generator reads this docblock as authority on
where the grammar applies, and a docblock governing one surface while claiming
eleven is a false map of the contract.

The rewritten docblock states, for today's tree:

- The **whole** bound list, as a table: `SelectOptionSchema.value`
  (`data/field.zod.ts`, the one surface with a real authored population, reused by
  the form-view option list via `SelectOptionSchema.shape`), plus three
  object-storage keys the old prose never claimed — `LifecyclePolicyRuleSchema.id`,
  `BucketConfigSchema.name`, `ObjectStorageConfigSchema.name` — recorded as bound
  in declaration with nothing authoring them ("nothing to census", not "censused
  clean").
- Where the ten unbound surfaces are **actually** validated, so a reader who came
  here for the object-name rule leaves with the right file: the inline
  `/^[a-z_][a-z0-9_]*$/` sites, `SnakeCaseIdentifierSchema`,
  `MetadataItemNameSchema`, and — for event keys — the closed `DataEventType` /
  `BulkDataEventType` enums, which are not a grammar at all.
- That these are **different accept sets**, not looser spellings of one another,
  with the measured `SystemIdentifierSchema` vs `MetadataItemNameSchema` delta
  named (`a.`, `a..b`, `a.1b`, `a._b`).
- That the dot this grammar accepts is unexercised on its one live surface: 0 of
  1218 authored select option values contain one.

The `Event keys | dot.notation` row of the naming-convention table and the
`'order.created' (for events)` example both asserted a binding that no longer
exists; both now state what is true. The storage-owned length-ceiling note
(#12144) is carried through unchanged.
