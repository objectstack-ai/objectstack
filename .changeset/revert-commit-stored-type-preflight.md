---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `revertCommit` refuses a non-canonical stored type on its restore limb, with the wire-visible code its sibling doors already give (#9174)

`isNonCanonicalStoredType` (#8908) names a six-member class of AT-REST spellings
whose type the manifest-collection map omits — `fields`, `seeds`,
`external_catalogs`, `externalCatalogs`, `translations`, `email_templates`. Rows
of that class are pre-#7894 residue: `PUT /meta/fields/…` answered 200 and
persisted before the `/meta` boundary fold closed that door, and nothing
rewrites them on upgrade.

Two doors that consume an at-rest `type` already answer for the class **by
name**: `publishPackageDrafts` refuses with a `failed[].code` of
`STORED_TYPE_NOT_CANONICAL` (#8908), and `migrateStoredMetadata` reports the row
`skipped` with the same reason stated in full (#8957). `revertCommit` is the
third consumer, and it is the producer #9111 traced and left explicitly
unguarded.

**Measured at HEAD before choosing a shape**, end to end over the real
`SysMetadataRepository` on an unscoped kernel, per limb:

- **restore limb** (`existedBefore: true`) — answered
  `{ success: true, revertedCount: 1, failed: [] }` with
  `reverted[0].action === 'restored'`, called `registerItem` **zero** times, and
  left one line of server-side stderr as the only trace:
  `[Protocol] registry write-through failed for fields/showcase_task.title:
  [registry_type_not_canonical] …`. The receipt claims the pre-commit body is
  what the platform now serves; for this class it cannot be — #9111's mint door
  refuses the entry and boot refuses it too, so the restored body reaches no
  reader at all.
- **soft-remove limb** (`existedBefore: false`) — answered
  `{ success: true, action: 'removed' }`, the row **gone** from `sys_metadata`,
  no warning emitted and no registry key touched. Nothing about that outcome is
  wrong.

**The shape is `saveMetaItem`'s refusal**, carried on this door's existing
per-item `failed[]` channel — the same one `VERSION_NOT_FOUND`, `ITEM_LOCKED`
and `NOT_OVERRIDABLE` already ride. No new receipt surface and no new error
code: `STORED_TYPE_NOT_CANONICAL` is already this package's and already in the
error-code ledger. The test that separates it from `migrateStoredMetadata`'s
decline is whether the door can do what it *promises* for this row: the migrate
pass declines because rewriting a stored type spelling is an identity move and
out of its reach entirely, so `skipped` must not poison `storedMigrationClean`
for a scan that runs forever; here the write is squarely in reach and still
delivers none of what `restored` promises, which is `saveMetaItem`'s case. So it
is refused, and `success` goes false — the commit the operator asked to undo was
not undone, and a one-shot operator action has no forever to poison.

**The soft-remove limb is deliberately outside the gate.** It performs its
promise exactly and completely, and the removal is the one action that makes
this residue smaller; refusing it would answer `success: false` for a revert
that fully succeeded and would hand back an instruction ("drop the `fields`
row") naming the very operation it had just declined to perform.

**Nothing is folded.** The refusal writes no audit row and no commit record, and
carries the stored spelling into `failed[]` verbatim, so #9161's ruling — the
caller's spelling reaches the ledger keys unfolded, and `AUDIT_TYPE_NOT_CANONICAL`
fires loudly when it is wrong — is untouched in both directions. A refused item
is simply absent from `reverted[]`, so the append-only revert commit built from
it never claims an undo that did not happen.

The predicate stays the narrow at-rest one rather than the complete
`canonicalMetaType(t) !== t`: `objects`/`views` fold in the manifest map, so the
restore limb already hands the write-through a canonical key and those rows are
not this defect — widening would change a wire-visible `failed[].code` for them.
