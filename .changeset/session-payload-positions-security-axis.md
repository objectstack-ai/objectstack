---
"@objectstack/plugin-auth": minor
"@objectstack/spec": minor
---

fix(plugin-auth)!: `positions[]` on the session payload is the SECURITY axis, not the better-auth role scalar (#15136)

<!-- adr-0087: registered session-payload-positions-security-axis -->

**BREAKING** meaning change on a published payload — `user.positions` in
`GET /api/v1/auth/get-session`. Shipped as `minor` under the repo's
launch-window convention for breaking changes. Maintainer ruling 2026-09-05 on
#15136 (director decision batch #39, item 2, verbatim 「同意」): option A, one
name, one meaning.

`customSession` built the array from the better-auth `sys_user.role` scalar
split on commas, plus the active membership mapped to `org_*`, plus
`platform_admin` — and read **nothing** from `sys_user_position`, the ADR-0057
D4 table that is the source of truth for custom positions. The Console binds
that array straight through as the CEL root `current_user`, so an
`action.visible` (or any `visibleWhen`, nav `visible`, page-tab gate) narrowed
by a business position answered FALSE for **everyone**, including the user who
genuinely held it.

⭐ It failed **silently and in the invisible direction**: the root was bound and
the key was present, so `has(current_user.positions)` was true, CEL raised
nothing, and the predicate simply returned FALSE. A predicate that *faults*
fails OPEN in the shell and would have shown the button; a successful FALSE
shows nothing and reports nothing. The documented example
(`'org_admin' in current_user.positions`) kept working throughout, because
`org_admin` is the one name that sits on **both** axes.

This was a **declared** contract being violated, not an ambiguous name:
`EvalUserSchema` already specified `positions` as "built-in identity names +
position names", exposed to "every predicate surface (server formula, server
RLS, client UI gates) ... with an identical shape" so that a predicate
"evaluates identically wherever it is written". `/auth/me/permissions` and
every server-side evaluator (`ExecutionContext.positions`) already resolved the
security axis; only the session payload did not.

**What changes**

- `packages/plugins/plugin-auth` — the hand-rolled derivation is **deleted**,
  not repaired. `customSession` now asks `resolveUserAuthzGrants`, the ONE
  authority (`core/security/resolve-authz-context.ts`, whose header forbids
  every entry point from re-reading the `sys_*` grant tables itself), scoped to
  the session's active organization. The payload therefore carries the
  `sys_user_position` assignments and the ADR-0090 D5 `everyone` anchor, and
  agrees with `/auth/me/permissions` set for set. Same move
  `isPlatformAdminUserId` made at #10348.
- `isPlatformAdmin` is now derived from that array (ADR-0068 D2 defines it as
  an alias of `'platform_admin' in positions`), so one authority answers both.
- `packages/spec` — `EvalUserSchema` states which axis `positions` is, and
  states that the better-auth role scalar is not it.

**No key is renamed, and none is added.** The ruling anticipated a renamed
auth-role array; measured against the tree, it has no content to carry and no
consumer. Everything the old union contributed beyond the security axis was the
`sys_user.role` scalar's own tokens — and that scalar is **already published,
unchanged, as `user.role`** (the single exception ADR-0090 D3's "role" word ban
carves out, for third-party schema this platform does not own). Minting a
`roles` array would revive that banned word to publish information the payload
already carries. (Precisely: `check:role-word` ratchets the reserved word in
`content/docs` and `skills/` PROSE, while the identifier ban over authored
metadata lives in `packages/lint`; a TypeScript payload key trips neither
mechanically until it is documented. The ADR-level prohibition is what rules
here, not a gate that would have caught it.) A consumer that wants the
better-auth role reads `user.role`.

**What does NOT change:** `user.role` is still never overwritten (ADR-0068 D2);
`platform_admin` still derives from the unscoped `admin_full_access` grant with
its ADR-0091 validity window and ADR-0049 active flag intact —
`platform-admin-standing.consolidation.test.ts` PIN 6 passes unchanged over
those shapes.

⚠️ **`isPlatformAdmin` is derived from the posture RUNG, never from the array.**
`positions.includes('platform_admin')` is the form
`resolve-authz-context.ts` forbids, because an ADR-0057 D4 `sys_user_position`
row may spell that very name — and this card is what made that reachable, by
moving `positions` onto an axis a tenant admin can write. Reading the name would
have let a tenant mint platform standing and pass the `/admin/*` mount gate.
`platform-admin-gate.ts` drops its positions leg for the same reason.
`session-platform-admin-rung-agreement.test.ts` requires the payload alias, that
gate and `hasPlatformAdminStanding` to agree, driven with such a row present and
a genuine grant as the control.

**Upgrade.** If you gate on the better-auth role scalar, read `user.role`
instead of looking for its tokens in `user.positions`. Predicates written
against real position names, built-in identity names, or `everyone` need no
change — they start working. Deployments that stored business role names in
`sys_user.role` rather than assigning positions should assign them through
`sys_user_position` (the governed ADR-0090 D12 channel).

A name in `sys_member.role` is still projected, **with one carve-out**: for a
session carrying NO active organization, membership names are now *added*, from
**every** membership the user holds — the resolver projects them all when no
tenant scopes it, where the old derivation contributed none. Measured on the
real pipeline (`autoActiveOrganization: false`, one `sys_member.role = 'admin'`):
`[]` before, `[org_admin, everyone]` after, pinned by
`session-positions-security-axis.test.ts`. With an active organization the
projection is tenant-scoped exactly as `/auth/me/permissions` scopes it, so
membership-derived names there are unchanged.
