---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": minor
"@objectstack/plugin-security": minor
"@objectstack/rest": minor
---

fix(sharing)!: the share-management surface gains the authorization layer it never had (ADR-0111 P0, #3902)

Record sharing shipped as a data layer with no authorization of its own: every
`/data/:object/:id/shares` and `/sharing/rules` route authenticated the caller
and then ran the service under `SYSTEM_CTX` — any signed-in user could revoke
anyone's share, enumerate who-can-see-what, write self-grants, and define /
evaluate org-wide sharing rules. ADR-0111's P0 rulings land here:

- **D1/D2** — `ISharingService.canManageShares(object, recordId, context)`:
  system, the record's owner, or a holder of Modify All Data (probed via the
  new fail-closed `ISecurityService.hasWriteBypass`). Enforced in the SERVICE,
  so every caller is covered; without plugin-security it fails closed to
  owner-only.
- **D4** — `revoke` is symmetric with grant, validates the share belongs to the
  URL's record (`NOT_FOUND` on mismatch), and refuses non-`manual` rows
  (`CONFLICT` — a rule-materialised grant would be resurrected by the next
  reconcile).
- **D5** — `listShares` is management-gated (invisible record → `NOT_FOUND`,
  visible-but-not-manager → `PERMISSION_DENIED`), and the open
  `/data/sys_record_share` read surface is self-scoped: non-admin callers see
  only rows naming them as recipient or grantor.
- **D6** — the whole `/sharing/rules` surface (list/create/get/delete/evaluate)
  requires the new **`manage_sharing`** capability (D9; seeded into
  `admin_full_access`, `manage_platform_settings` honoured as the legacy
  equivalent), enforced in `SharingRuleService`.
- **D7** — no inert grants: `recipientType` is narrowed to `user` (the only
  type any gate enforces), grants on objects the sharing gates never consult
  (public model, no `owner_id`, bypass, `controlled_by_parent`) fail with
  `SHARING_NOT_ENABLED` (422), and the manual upsert keys on
  `(object, record, recipient, source)` so manual and rule rows coexist.

**Breaking** for callers that relied on the missing gate: unauthorized share
management now fails with 403/404/409/422 instead of silently succeeding, and
`ISharingService.revoke` gained an optional `scope` parameter. The verb
boundary (edit ≠ delete, ADR-0111 D3) is NOT in this change — it lands as the
separate P1.
