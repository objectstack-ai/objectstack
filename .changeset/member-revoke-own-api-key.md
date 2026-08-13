---
"@objectstack/plugin-security": patch
---

fix(plugin-security): a member can revoke their OWN API key — owner-scoped `update` on `sys_api_key` for `member_default` (#8053)

An ordinary member who minted a personal API key could not revoke it.
`PATCH /api/v1/data/sys_api_key/{their own id} {"revoked": true}` answered **403
`PERMISSION_DENIED`**, the row stayed `revoked: false`, and the key kept
authenticating. The `revoke_api_key` / `restore_api_key` row actions rendered in
that member's own **My Keys** grid the whole time — a dead affordance on the
persona the surface is built for.

A personal API key acts as its owner ("treat it like a password", per the
console's own mint screen), and the owner is the person who discovers it leaked.
Their only remedy was to find an admin.

This is the residual of #7727, one layer down. That fix was correct as far as it
went: the method gate opened (`enable.apiMethods` gained `update`) and ADR-0092
D2's column whitelist registered `revoked`. But the **object-CRUD** layer was
untouched — the platform `member_default` set granted only `allowRead` across the
better-auth-managed identity tables, so `update` on `sys_api_key` resolved for
`admin_full_access` and nobody else. `GET /api/v1/security/explain` said so
outright, as that member: *"No resolved permission set grants update on
sys_api_key"*. Because #7727's tests all drove the admin, the member half stayed
hidden behind its fix.

`member_default` now carries an explicit `sys_api_key` entry with `allowEdit`.
Two pre-existing mechanisms bound it, and the grant is deliberately not bounded
by the permission-set boolean alone:

- **which rows** — the `sys_api_key_self` RLS carve-out
  (`user_id == current_user.id`), which already made the row owner-*visible*;
  there was simply no `allowEdit` to go with it. A member PATCHing another
  user's key is still refused **403**, row unchanged.
- **which fields** — ADR-0092 D2's identity write guard, whose per-object update
  whitelist for this table lists `revoked` alone. `key` stays unwritable (a
  rotated hash would mint a credential nobody holds) and `user_id` stays
  unwritable (re-owning a key is privilege transfer) — both are stripped even
  when smuggled alongside a legal `revoked`.

**Unaffected, and pinned as such:** cross-owner revocation stays 403; a
non-`revoked` column stays refused for the owner too; `create` / `delete` stay
**405** at the method gate (minting remains `POST /api/v1/keys`, the only path
that returns the raw secret once, and rows retire by revoking, not deleting);
show-once semantics are intact. Every other better-auth-managed identity table
stays write-denied — `sys_api_key` is the one exception, and it is one because
that table is hand-rolled ObjectStack rather than better-auth-owned, with a
registered whitelist already governing its single platform-owned column.

The regression pin runs as the key's **owner**, not as an admin — the persona
gap that let this survive #7727's own test suite.
