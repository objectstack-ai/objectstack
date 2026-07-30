---
"@objectstack/plugin-sharing": minor
---

feat(sharing): a record's share-manager may revoke any share-link on that record (ADR-0111 D8)

`ShareLinkService.revokeLink` was creator-or-system only, so a record's owner or
a Modify-All admin could not kill a link someone else minted on their record —
their record's exposure, but not their link to revoke. Revoke authority now
also admits a record **share-manager**, probed via the sharing service's
late-bound `canManageShares` (owner / `modifyAllRecords`). The probe fails
closed: a deployment without it (or a throwing probe) keeps the pre-D8
creator-only behaviour. Mint authority is unchanged and now documented as the
D8 decision it always enforced — the object's `publicSharing` opt-in AND the
caller's visibility of the record.
