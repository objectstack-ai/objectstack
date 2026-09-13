---
'@objectstack/plugin-auth': patch
'@objectstack/lint': patch
---

`sys_user.manager_id` gains an admin write surface: `POST /api/v1/auth/admin/set-user-manager`

`{ type: 'manager' }` is the canonical first rung of a tiered approval ladder,
and it resolves `sys_user.manager_id` — a column **no product surface could
write**. Measured: the generic data path refuses it (the ADR-0092 D2
managed-update whitelist for `sys_user` is `{name, image, locale}`), the admin
bulk import does not carry it (`admin-import-users.ts` matches `manager_id` 0
times, against a control of `phone_number` 8), and the column is `readonly` on
the user form. So on any install without a directory sync the rung expanded to
nobody, the request opened on a slate no one could act on, and under the
default `lockRecord: true` the record stayed locked.

**The endpoint.** A platform admin posts `{ userId, managerId }`; `managerId:
null` clears the link. It is an ObjectStack mount on the raw app ahead of the
better-auth catch-all — the same family as `POST /api/v1/auth/admin/unlock-user`
— platform-admin gated (ADR-0068) and ledgered in `auth-route-ledger.ts`.

**It is not a new editable profile column, and that is the design.** The
handler runs under a **system context**, so it reaches the column by context
rather than by a whitelist entry — the same way `admin-import-users` already
reaches `phone_number` and `role`. `SYS_USER_PROFILE_EDIT_FIELDS` is
untouched, `MANAGED_EXTENSION_EDITABLE_FIELDS.sys_user` stays `{locale}`, and
`sys_user.manager_id` keeps `readonly: true`, so ADR-0092 D4 still holds by
construction. Since ADR-0092 D5's amendment made Tier-1 membership imply
self-editability, admitting the column to Tier 1 would have handed every member
their own first-rung approver and a widening of their own `own_and_reports`
read scope; it is not admitted.

**Five refusals, every one enforced at the write** — the only manager-chain
walkers in the open tree are single-hop, so nothing downstream catches a bad
link: self-assignment; a link that closes a cycle (the walk is itself
cycle-safe, so a pre-existing loop is reported rather than hung on); a chain
past the depth cap that ADR-0057 D3's bounded rollups require; a manager
provably outside every organization the user belongs to (beside, not instead
of, the existing routing-time screen); and any identity whose `sys_user.source`
is `idp_provisioned`, where the directory stays the one authoring surface.

**`@objectstack/lint`** keeps the `approval-approvers-may-resolve-empty`
advisory and its `stackWiresManagerChain` silencer — the dead end it reports
survives the write surface, because a static check still cannot read the
column; only its *cause* became recoverable. What changed is the remedy text,
which named a column with no route and now names the endpoint, its body, how to
clear the link, and what it refuses. The Approvals guide carries the same
rewrite in prose.

**Why `patch` and not `minor`.** No new exported symbol is reachable from
either published entry: `admin-set-user-manager.ts` is deliberately not
re-exported from `plugin-auth/src/index.ts` and is not named in the package's
`exports` map, so none of `runSetUserManager`, `MAX_MANAGER_CHAIN_DEPTH`,
`SetUserManagerDeps`, `SetUserManagerEngine`, `SetUserManagerResult` or
`SetUserManagerRefusalReason` appears in the built `dist/index.d.ts`. No
already-published payload gains a key — the endpoint's response is a new
payload, not a new field on an old one. A new **route** is wire, and wire
compatibility is not the grading floor.
