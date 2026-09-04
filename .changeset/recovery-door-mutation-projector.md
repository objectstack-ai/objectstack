---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the three recovery doors run the ADR-0094 mutation projector

`rollbackMetaItem`, both limbs of `revertCommit`, and `deleteMetaItem`'s
legacy raw-engine exit restored the metadata row and the in-memory registry
but never called the awaited ADR-0094 mutation projector — so a derived
read-model (e.g. `permission` -> `sys_permission_set`) stayed on the
rolled-back-FROM state until an unrelated save/publish/delete on the same
name, or a boot reconciliation, re-derived it. `saveMetaItem`,
`runPublishSideEffects`, and `deleteMetaItem`'s repository branch already ran
this hook; the three recovery doors were the same gap the prior card closed
for the mutation-event choke point, one call site over.

All four sites now call `runMutationProjector`, awaited BEFORE the existing
fire-and-forget `emitMetadataMutation` call — the order `saveMetaItem`'s own
comment establishes: `rollbackMetaItem` and `revertCommit`'s restore limb
project `state: 'active'` with the restored body; `revertCommit`'s
soft-remove limb and `deleteMetaItem`'s legacy exit project
`state: 'deleted'`, the same call `deleteMetaItem`'s repository branch
already makes. `deleteMetaItem`'s legacy exit now also carries
`projectionApplied` on its success return, the same optional key its
repository-branch sibling has declared since ADR-0094 shipped.

Internal only: `runMutationProjector` is a private, best-effort,
already-registered hook (never thrown, logged on failure) — no published
schema or wire shape moves. ADR-0094 D2's door enumeration is amended in a
companion `docs/adr/**` PR.
