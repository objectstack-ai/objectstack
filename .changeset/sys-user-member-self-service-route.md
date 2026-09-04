---
"@objectstack/plugin-security": minor
---

feat(plugin-security): a rank-and-file member may edit their OWN `sys_user` row (#14959)

Maintainer ruling 2026-09-03, decision batch #22, quoted verbatim and
untranslated as adopted:

> 「同意」

The ruling that admitted `locale` to the ADR-0092 D2 column whitelist (#14787 /
PR #14958) opened **which columns** a permitted actor may touch. It did not open
**who**, and ADR-0092 D5 kept that with the permission layer, where
`member_default` still denied `allowEdit` on `sys_user`. The measured
consequence: a member's `PATCH /api/v1/data/sys_user/<self>` was refused by the
object gate *before* the column guard was ever consulted, so `sys_user.locale`
shipped as a user-stated preference only a platform administrator could set —
with objectui#7501's "my language" form item waiting on a route that did not
exist, and #14788 having already ruled the stored value outranks
`Accept-Language` *because it is the user's own choice*.

This opens the route, on the two axes that already existed and in the shape
`sys_api_key` has shipped since #8053:

- **Which rows** — `member_default` gains an explicit `sys_user` entry
  (`allowRead`/`allowEdit` true, create/delete **false**), and its
  `sys_user_self` RLS carve-out (`id == current_user.id`) widens from `select`
  to `all` so it reaches the by-id write pre-image check. `sys_user_org_members`
  — the org-peer *visibility* policy — deliberately stays `select`-only:
  policies OR-combine, so widening it would have composed
  `id == me OR id IN <every user in my org>` and handed every member their
  colleagues' profile rows.
- **Which columns** — unchanged. ADR-0092 D2's identity write guard still bounds
  a user-context update to `SYS_USER_PROFILE_EDIT_FIELDS`
  (`name`, `image`, `locale`); `email`, `role`, the ban columns and every system
  stamp stay unwritable on this path.

`allowCreate` / `allowDelete` stay false: accounts are minted and retired
through better-auth's own endpoints, and this set is bound to the `everyone`
anchor, which must remain anchor-safe (ADR-0090 D5).

**ADR-0092 D5 is amended** by the same ruling — self-service edits of the
whitelisted columns route through the generic data path, with the D6
`afterUpdate` hook as the session-cache refresh. `name` / `image` therefore
become editable there too, not only through better-auth `/update-user`. The
amendment ships as its own PR (`docs/adr/**` is governed and merged by hand).

Rejected in the same ruling, recorded so they are not re-proposed: a dedicated
endpoint writing under system context (the "second stamping route" #14787's own
ruling rejected, one level up); leaving the column admin-only (a user-facing
setting only an administrator can set — ADR-0049's declared-not-reachable shape,
one step removed); and making `locale` a better-auth `additionalFields` entry
(#13881 measured that it breaks `getSession` on any environment that has not run
schema-sync).

The pins are layer-attributed on purpose. Each of the four cases the ruling names
records *which* of the three layers produced its answer — object gate, row scope,
or identity guard — because before this change all four were refused by the
object gate, so "another member's row is refused" and "a non-whitelisted column
is refused by the guard" were both green while neither mechanism had run. A
two-leg ablation confirms it: reverting the permission-set entry drops the
non-whitelisted-column refusal from `identity-guard` to `object-gate`, and
reverting only the RLS widening drops it to `row-scope`.
