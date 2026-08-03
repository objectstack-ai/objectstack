---
'@objectstack/spec': patch
---

fix(spec): register the missing ADR-0087 migration surface for the `enable.trash` / `enable.mru` removal, and repoint its tombstones at the parked soft-delete issue (#3207)

The 16.x removal of the dead object capability flags (PR #3414,
`remove-enable-trash-mru`) tombstoned both keys in the `.strict()`
capabilities block but registered no D2 conversion. Two consequences this
closes:

- **Stored 16.x rows flagged forever.** A `sys_metadata` object row written
  before the removal still carries `enable.trash`/`enable.mru`; with no
  conversion to own that history, every rehydration re-flagged it
  `metadata_spec_invalid` — mislabelling chain-owned history as a
  current-contract violation (#3903's invariant). The new
  `object-enable-trash-mru-removed` conversion (protocol 17,
  `retiredFromLoadPath`) strips both keys on the stored-row pass, and
  `os migrate meta --from 16` now rewrites authored sources.
- **Tombstones pointed at a closed issue.** The prescriptions named #1893
  (closed 2026-07-24) as where a real recycle bin returns. Per the #3207
  ruling (2026-08-02), soft delete is parked at #3146 — the `trash`
  tombstone, the `restore` legacy-apiMethod guidance and the api-derivation
  note now point there, and both tombstones name the
  `os migrate meta --from 16` rewrite.

FROM → TO: `enable.trash` / `enable.mru` → *(removed)* — delete the key;
the flags never gated behavior, so the rewrite is lossless.
