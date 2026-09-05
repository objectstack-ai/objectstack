# ADR-0092: Identity-table write guard — engine-enforced `managedBy: 'better-auth'`, with sys_user profile fields as the first whitelist

- **Status:** Accepted
- **Date:** 2026-07-10 (proposed) · 2026-07-11 (revised: D2 generalized from a sys_user-only hook to a registry-driven guard over every better-auth-managed object, per review) · 2026-07-11 (accepted) · **2026-09-03 (amended: D5 — self-service edits of the whitelisted columns route through the generic data path; see the D5 Amendment)** · **2026-09-05 (amended: D1 — Tier 1 becomes `{name, image, locale}`, carrying the 2026-09-03 ruling on #14787; see the D1 Amendment)**
- **Implementation:** #2816 (generic identity write guard — D2/D3/D6) → #2817 (sys_user edit affordance + form field gating — D4, gated on #2816)
- **Deciders:** ObjectStack Protocol Architects
- **Relates to:** [ADR-0010](./0010-metadata-protection-model.md) (identity tables managed by better-auth), [ADR-0049](./0049-no-unenforced-security-properties.md) (no unenforced security properties), [ADR-0068](./0068-unified-user-context-and-built-in-identity-roles.md) (platform-admin gate), [ADR-0069](./0069-enterprise-authentication-hardening.md) (system-managed auth stamps), #2766 / PR #2771 (admin user management + identity import), #2784 (originating RFC)

## TL;DR

`managedBy: 'better-auth'` promises that identity tables are only written through the
better-auth pipeline — but today that promise is enforced by nothing but UI
affordances and default permission sets. `admin_full_access` (wildcard, no RLS) can
raw-write **any column of any identity table** through the generic data API: a user's
`email`, a `sys_member.role`, a `sys_session` row. That is exactly the "declared but
unenforced security property" ADR-0049 prohibits.

At the same time, the one legitimate gap the RFC (#2784) surfaced — an admin cannot
edit a teammate's display name through the standard form — needs a *narrow opening*,
not a bigger lock.

Decision — one mechanism serves both:

- **D1** — classify `sys_user` columns into three tiers; only `name`, `image` and
  `locale` are profile-editable through the generic path.
  ⚠️ **Amended 2026-09-05** — this bullet read "only `name` and `image`" as
  originally accepted; `locale` was admitted to Tier 1 by the maintainer ruling of
  2026-09-03 on #14787. Read the D1 Amendment below.
- **D2** — plugin-auth installs a **generic identity write guard**: engine
  `before{Insert,Update,Delete}` hooks that fail-closed reject **user-context**
  writes to *every* object whose schema declares `managedBy: 'better-auth'`
  (registry-driven, no hardcoded table list). A per-object **update whitelist**
  is the only opening; `sys_user → {name, image, locale}` is its first entry
  (`{name, image}` as originally shipped — see the D1 Amendment). Internal
  writes (better-auth adapter, `isSystem` plugin/system contexts) bypass untouched.
- **D3** — one whitelist module; the import upsert's `UPDATE_ALLOWED_FIELDS`
  (PR #2771) becomes a superset-by-construction of the sys_user entry.
- **D4** — only after D2 lands, flip the UI affordance: `userActions: { edit: true }`
  on `sys_user` (create / import / delete stay off). Non-whitelisted fields must
  render non-editable in the standard edit form.
- **D5** — permission sets are unchanged: members / org-admins keep
  `allowEdit: false`; the standard edit path is therefore **platform-admin only**.
  Self-service profile editing stays on better-auth `/update-user`
  (the existing `update_my_profile` action).
  ⚠️ **Amended 2026-09-03** — a member may now edit their OWN row on the generic
  data path, bounded by `member_default`'s explicit `sys_user` entry and the
  `sys_user_self` RLS carve-out. Read the D5 Amendment below before this bullet.
- **D6** — an `afterUpdate` companion hook invalidates the affected user's cached
  session snapshots (secondary storage), keeping better-auth session reads coherent
  without delegating the write itself to `internalAdapter.updateUser`.

Scope note: the *decision* about which fields open up is sys_user-specific (D1);
the *mechanism* (D2) is family-wide by construction. A future "org admins may edit
`sys_organization.name`" is a one-line whitelist registration citing this ADR,
not a new ADR.

## Context

### Where writes stand after #2766

| Operation | Surface | Pipeline guarantees |
|:---|:---|:---|
| Create user | `/api/v1/auth/admin/create-user`, invite flow, `/admin/import-users` | scrypt hash, credential `sys_account`, `must_change_password` stamp |
| Password | `/admin/set-user-password`, `/change-password`, reset flow | hashing, `password_changed_at`, session revocation |
| Ban / unban / unlock / role | dedicated `/admin/*` endpoints | admin gate (ADR-0068), session invalidation |
| Self profile (`name`, `image`) | better-auth `/update-user` via `update_my_profile` action | session-cache refresh |
| **Admin edits another user's name** | **nothing** — no endpoint, no form | — |
| Import upsert (existing users) | `/admin/import-users` | profile fields only, `UPDATE_ALLOWED_FIELDS = {name, phone_number, role}` |

The one missing cell is small but structurally annoying: fixing a typo in a teammate's
display name requires either a CSV import round-trip or raw SQL. Meanwhile every other
object in the platform offers inline/form editing gated by permissions.

### What the engine actually enforces today

Four findings from the current code shape this decision:

1. **Field-level `readonly` is a UI hint, not a server boundary.**
   `validateRecord` *skips* system/readonly columns rather than rejecting writes to
   them, and only `readonlyWhen` (conditional, state-dependent locks) is stripped
   server-side on update (`engine.ts` B2). Opening `edit` with only `readonly` flags
   would ship exactly the "parsed but unenforced security property" ADR-0049 bans.
2. **The affordance matrix is advisory.** `resolveCrudAffordances` gates toolbar
   buttons; the REST data API for `sys_user` is fully on
   (`apiMethods: ['get','list','create','update','delete']`). The real gate is the
   permission-set layer — and `admin_full_access` passes it with a wildcard.
3. **The hole is family-wide, not sys_user-wide.** Every table in
   `BETTER_AUTH_MANAGED_OBJECTS` (`default-permission-sets.ts` — `sys_user`,
   `sys_account`, `sys_session`, `sys_organization`, `sys_member`, `sys_invitation`,
   `sys_team`, `sys_team_member`, `sys_api_key`, `sys_two_factor`,
   `sys_verification`, …) relies on the same deny-by-permission-set +
   hide-by-affordance combination. A platform admin can raw-insert a `sys_member`
   row (grant themselves org membership), raw-update a `sys_api_key`, or raw-delete
   a `sys_session` — none of which fires the better-auth side effects those tables
   assume. Guarding only `sys_user` would patch one table and leave ten.
4. **better-auth's own writes flow through the ObjectQL engine.** The better-auth
   adapter (`objectql-adapter.ts`) calls `engine.update(...)` with no caller context,
   which means (a) engine hooks *do* fire for better-auth writes — audit already
   captures them — and (b) the guard must distinguish user-context writes from
   internal/system writes, not just "writes to a table".

### Session-cache consistency

ADR-0069 D2 wires the kernel cache service as better-auth `secondaryStorage`, which
caches session (+ user snapshot) entries. better-auth's own update paths keep those
snapshots coherent; a raw engine write to `sys_user` does not. For the D1 whitelist
(`name`, `image`) staleness is cosmetic, but "cosmetic until someone widens the
whitelist" is how drift ships — coherence is handled explicitly (D6).

## Decisions

### D1 — sys_user field tiers

*(Tier 1 as amended 2026-09-05 — see the D1 Amendment below. This list is rewritten
in place rather than kept verbatim-plus-note, unlike D5: it is the set the D2 guard
is read against, and a reader who took the pre-amendment list as current would
delete an enforced member in good faith. The superseded wording is quoted inside
the Amendment so nothing is lost.)*

**Tier 1: profile-editable** (standard form / data API, guarded by D2):

- `name` — display name. No auth semantics (`displayNameField`, not a login key).
- `image` — avatar URL. No auth semantics.
- `locale` — preferred BCP-47 language tag. No auth semantics: not a login key, not
  authorization state, and better-auth is oblivious to it. Admitted 2026-09-03 by
  maintainer ruling on #14787; shape-checked at the write by the column's own
  `locale_bcp47_shape` rule. See the D1 Amendment.

**Tier 2: admin-surface-only** — legitimate admin writes exist, but each has a
dedicated surface with its own semantics; the generic form must not become a second
door:

- `role`, `banned`, `ban_reason`, `ban_expires` — authorization state; dedicated
  endpoints revoke sessions / apply gates as side effects.
- `phone_number` — a **login identifier** (unique index, sign-in key when the
  phoneNumber plugin is on). Import may upsert it (bulk identity onboarding is that
  surface's purpose); a form edit silently re-keying sign-in is not acceptable.
  If phone editing is later wanted, it needs a verification flow, not a text input.
- `manager_id` — org-chart data, but it drives the `own_and_reports` hierarchy RLS
  scope (ADR-0057): writing it changes *who can read whose records*. Excluded from
  the profile tier; org-structure maintenance is its own surface (future issue if
  demand materialises).
- `primary_business_unit_id` — denormalised projection maintained by plugin-sharing;
  never hand-edited (already documented on the field).
- `ai_access` — a licensed-seat grant, capped by the enterprise AiSeatPlugin; must
  keep flowing through its enforcement path.

**Tier 3: never-direct** — no generic write under any actor:

- `email`, `email_verified` — login identity; changes require the better-auth
  change-email verification flow.
- `two_factor_enabled` and all credential-adjacent state — owned by better-auth
  plugins.
- All system-managed stamps: `password_changed_at`, `must_change_password`,
  `locked_until`, `failed_login_count`, `mfa_required_at`, `last_login_at`,
  `last_login_ip`, `source`, `id`, `created_at`, `updated_at`.

> **D1 Amendment (2026-09-05, #14951)** — carrying the maintainer ruling of
> 2026-09-03 on #14787 (option B, adopted verbatim 「同意」). The *vehicle* was itself
> ruled on #14951: amend ADR-0092 in place, no superseding ADR.
>
> **1 — Tier 1 is `{name, image, locale}`.** The list above is the amended one; as
> accepted 2026-07-11 it read "`name` — display name … `image` — avatar URL" and
> nothing else. The enforced constant `SYS_USER_PROFILE_EDIT_FIELDS`
> (`packages/plugins/plugin-auth/src/sys-user-writable-fields.ts`) has held three
> members since that ruling shipped. This ADR — not the constant — was the record
> out of date, and Prime Directive #13 is why that is not a cosmetic gap: an
> accepted ADR binds until it says otherwise, so a reader reaching the old table
> first would read the third field as drift to be corrected. That is backwards, and
> it is the condition under which a later PR "restores" the old behaviour in good
> faith.
>
> **2 — `locale` qualifies on D1's own test, unchanged.** It has no auth semantics:
> not a login key (unlike `phone_number`, Tier 2), not authorization state (unlike
> `role` and the ban columns, Tier 2), not credential-adjacent (Tier 3). better-auth
> is oblivious to it — neither one of its own user fields nor a declared
> `additionalFields` entry, the latter deliberately, because declaring it there
> would make `getSession` SELECT a column an environment that has not run
> schema-sync does not have. That is exactly the argument that put `name` and
> `image` in Tier 1, applied to a third column without weakening it.
>
> **3 — D6's mirror set deliberately did NOT widen, and the two sets are no longer
> the same set.** Tier 1 and the session-snapshot mirror coincided only while the
> whitelist happened to match better-auth's user model. They no longer do:
> `SESSION_SNAPSHOT_MIRRORED_FIELDS`
> (`packages/plugins/plugin-auth/src/identity-write-guard.ts`) holds `{name, image}`
> and is a separately named constant for that reason. Mirroring `locale` would
> manufacture an incoherence rather than repair one — see the D6 amendment note.
>
> **4 — D5 is unchanged by this amendment, and is restated because it is where
> readers go next.** Two independent answers from two layers: the **whitelist
> decides which columns** any permitted actor may touch (D2's guard), and
> **permission sets decide who** may update at all (D5). Widening Tier 1 does not
> widen who; widening a permission set does not widen which columns.
>
> ⚠️ **On member self-service, read the D5 Amendment rather than this paragraph.**
> The #14787 ruling that admitted `locale` opened *columns*, not *principals*; it
> did not decide whether an ordinary member reaches their own row. That question
> was taken separately by the 2026-09-03 ruling on #14959 (decision batch #22,
> verbatim 「同意」) and is already recorded below as the D5 Amendment:
> `member_default` now names `sys_user` explicitly with `allowEdit: true`,
> row-scoped to the caller by the `sys_user_self` RLS carve-out. Anything past that
> one row — an org admin editing a colleague's profile — **remains open**:
> `sys_user_org_members` stays `select`-only precisely so it cannot compose into
> that write, and no ruling has taken it. This amendment does not take it either.

### D2 — A generic, registry-driven identity write guard

`plugin-auth` registers (at `kernel:ready`, same pattern as the existing SCIM
provenance hook) `beforeInsert` / `beforeUpdate` / `beforeDelete` hooks that apply to
**every object whose registered schema declares `managedBy: 'better-auth'`** — the
guard reads the flag from the schema registry at evaluation time; there is no
hardcoded table list to drift from the schemas (the `BETTER_AUTH_MANAGED_OBJECTS`
array in `default-permission-sets.ts` remains what it is today: the permission-set
seed, mirroring the same flag).

Behaviour:

- **Applies to user-context writes only**: when the operation context carries a real
  user and is not `isSystem`. Internal writes — the better-auth adapter (no
  context), plugin system writes (`SYSTEM_CTX`), import's engine calls — bypass the
  guard unchanged. This is what keeps sign-in stamps, ban endpoints, org lifecycle
  and the import path working.
- **Default-deny**: a user-context insert or delete on a managed table, or an update
  to a managed table with no registered whitelist, is rejected with a
  `FORBIDDEN`-class error naming the dedicated surface (the error message should
  point at "use the Invite / Create User / better-auth API", not just say no).
- **Per-object update whitelist is the only opening**: plugin-auth exposes a small
  registry — `registerManagedUpdateWhitelist(object, fields)` — consulted by the
  `beforeUpdate` guard. Non-whitelisted keys are stripped; if the payload becomes
  empty the hook throws (loud failure, not a silent no-op). First and only entry
  shipped by this ADR: `sys_user → SYS_USER_PROFILE_EDIT_FIELDS` (D1 Tier 1 —
  `{name, image, locale}` since the 2026-09-05 amendment, `{name, image}` as
  originally shipped). Still the only entry: what the amendment widened is that
  entry's field set, not the number of registered objects.
  Unknown/new columns are non-whitelisted by construction — adding a field to any
  identity table never silently opens it.
- **Covers both update shapes**: single-id updates and `options.multi` bulk updates
  run through the same `beforeUpdate` event; the filter applies to the payload in
  both cases.
- Self-vs-other is *not* distinguished here: permission sets already decide who may
  update at all (D5); the guard decides *which columns* any permitted actor may
  touch.

Why a guard hook and not the alternatives:

- **Not UI `readonly` / affordances only** — findings #1–#2; ADR-0049 prohibits it.
- **Not per-table bespoke hooks** — finding #3: the hole is the family, and eleven
  copies of one guard is how the twelfth table ships unguarded. The flag already
  exists on every schema; enforcement should key off the same single source
  (Prime Directive: one contract, not N dialects).
- **Not full delegation to `internalAdapter.updateUser`** — the adapter itself writes
  through `engine.update`, so a guard that re-enters better-auth would recurse
  through the very pipeline it guards; it also couples the data path to better-auth
  API stability for zero gain, since the whitelisted columns have no auth-side
  effects. Delegation remains the right answer for anything credential-shaped —
  which is why those stay on dedicated endpoints (Tier 2/3), not in the whitelist.
- **Not a new `/admin/update-profile` endpoint** — it would fix the one missing cell
  but keep `sys_user` off the standard UI path (the very inconsistency the RFC is
  about), add a bespoke audit surface, and leave the family-wide raw-write hole
  open.

Trade-off accepted: `admin_full_access`'s "rescue data directly" capability on
identity tables goes away at the HTTP data API. Rescue now requires system context
(server-side script / CLI), which is deliberate hardening — the rows in question are
exactly the ones raw rescue is most dangerous for, and every legitimate admin
operation has (or should get) a dedicated endpoint that runs the real pipeline.

### D3 — One whitelist module, import re-uses it

New module in `plugin-auth` (e.g. `sys-user-writable-fields.ts`):

```ts
/** Tier 1 — standard form / data-API editable (D2 guard whitelist). */
export const SYS_USER_PROFILE_EDIT_FIELDS = new Set(['name', 'image']);

/** Import-upsert may additionally touch these (admin bulk-identity surface). */
export const SYS_USER_IMPORT_UPDATE_FIELDS = new Set([
  ...SYS_USER_PROFILE_EDIT_FIELDS, 'phone_number', 'role',
]);
```

⚠️ **As amended 2026-09-05:** the sketch above is the 2026-07-10 design text and is
left verbatim; the shipped `SYS_USER_PROFILE_EDIT_FIELDS` holds
`{name, image, locale}`. D1's tier list is the current statement of the set — do
not read the illustrative `new Set(['name', 'image'])` above as the live value.

`admin-import-users.ts` replaces its private `UPDATE_ALLOWED_FIELDS` with
`SYS_USER_IMPORT_UPDATE_FIELDS`. The relationship is subset-by-construction
(a spread, not two hand-maintained lists), which is the actual anti-drift property
the RFC asked for — the two surfaces intentionally differ (import may set `role` /
`phone_number`; the form may not), so "the same set" would be wrong; "one file, one
derivation" is right. (Import runs under `SYSTEM_CTX`, so it passes the D2 guard by
context, not by whitelist — its field discipline stays its own responsibility,
enforced by this shared constant.)

### D4 — Affordance flip, after enforcement exists

Once D2 is merged and tested, `sys_user` gains:

```ts
userActions: { edit: true },   // create / import / delete stay bucket-default (off)
```

`managedBy: 'better-auth'` stays — it remains true (drives the D2 guard, permission-
set defaults, system-field injection skip, docs) — the per-flag override is exactly
what `userActions` exists for.

Form rendering: every non-Tier-1 field must render non-editable in the standard edit
form. Most Tier 2/3 columns already carry `readonly: true`; the remainder (`email`,
`email_verified`, `two_factor_enabled`, `role`, `banned`, `ban_reason`, `ban_expires`,
`ai_access`) need field-level treatment at implementation time. Constraint for the
implementer: `email` / `role` are referenced as action `params` (`create_user`,
`invite_user`, `set_user_role`) — verify that flipping `readonly` on the field does
not disable those param inputs before choosing between `readonly: true` and a
form-level exclusion. Sequencing is a hard rule either way: **affordance ships in the
same or a later release as the guard, never earlier** (ADR-0049). No other identity
table changes its affordances in this ADR.

### D5 — Who can edit whom: unchanged permission topology

*(As amended 2026-09-03 — see the Amendment below for what changed and why. The
original text is kept verbatim, because the Amendment is only readable against
it and because two of the three bullets still hold.)*

- `member_default` / `viewer_readonly` / `organization_admin`: `allowEdit: false` on
  identity tables stays. Nothing about this ADR widens *who* may write.
- Platform admins (`admin_full_access`) become the only principals whose standard-form
  edits reach the guard — and they were already past the permission layer today.
- Self-service stays on better-auth `/update-user` (`update_my_profile` action):
  it already handles `name` / `image`, refreshes the session cache natively, and
  works for non-admin users, whom the permission layer (correctly) keeps away from
  the CRUD path. We do not build an RLS "self-row edit" carve-out for CRUD — one
  self-service door is enough, and better-auth's is strictly better.

If org-admin-scoped profile editing is wanted later ("org admin fixes a member's
name"), that is a permission-set + RLS decision (`sys_user_org_members` is currently
`select`-only) layered on top of the same guard — a follow-up, not this ADR.

> **Amendment (2026-09-03, #14959 — maintainer ruling, decision batch #22,
> verbatim 「同意」).** A rank-and-file member **may** edit their own `sys_user`
> row on the generic data path. The third bullet above no longer holds: an RLS
> self-row EDIT carve-out for CRUD is exactly what this amendment builds, and
> better-auth's door is no longer strictly better — it cannot carry every
> whitelisted column.
>
> **What forced it.** The 2026-07-11 text rests on a premise that a later ruling
> retired: that better-auth `/update-user` can carry everything Tier 1 holds. It
> could, while Tier 1 was `{name, image}`. The 2026-09-03 ruling on #14787
> admitted `locale`, and `locale` is deliberately **not** a better-auth
> `additionalFields` entry — declaring it there would make `getSession` SELECT a
> column an environment that has not run schema-sync does not have (#13881
> measured this; it is the same hazard the `ai_access` note in `auth-manager.ts`
> records). So `/update-user` cannot post the column, and with `member_default`
> denying `allowEdit` the generic path could not either. The column shipped
> reachable by platform admins alone — a *user-stated* preference (#14788 ruled
> the stored value outranks `Accept-Language` precisely because it is the user's
> own statement) that the user could not state. That is ADR-0049's
> declared-but-not-enforceable shape one step removed, and it is why leaving it
> admin-only was rejected rather than deferred.
>
> **What the amendment decides.** Self-service edits of the D1 Tier-1 columns
> route through the **generic data path**, bounded on the two axes that already
> exist and in the shape `sys_api_key` has shipped since #8053:
>
> - **which rows** — `member_default` gains an explicit `sys_user` entry
>   (`allowRead` / `allowEdit` true, create / delete **false**), and its
>   `sys_user_self` policy (`id == current_user.id`) widens from `select` to
>   `all` so it reaches the by-id write pre-image check. `sys_user_org_members`
>   stays `select`-only: RLS policies OR-combine, so widening the org-peer
>   *visibility* scope would compose `id == me OR id IN <every user in my org>`
>   and hand every member their colleagues' profile rows. The org-admin
>   follow-up named at the end of the original D5 text is therefore still open,
>   and still a separate decision.
> - **which columns** — unchanged. D2's guard keeps bounding a user-context
>   update to the registered whitelist, so widening *who* does not widen *what*.
>   The shape rules on the columns refuse a malformed value identically on every
>   path, which is the property that made this the small decision rather than
>   the large one.
>
> `name` and `image` therefore become editable on the generic path too, not only
> through `/update-user`. That is the real cost of the amendment and it is
> accepted deliberately: **D6** already mirrors better-auth's
> `refreshUserSessions` for exactly those columns, so the session-cache
> coherence the original bullet bought by routing through `/update-user` is
> bought here by the companion hook instead. (`locale` is correctly *excluded*
> from that mirror — better-auth carries no such field on its user model, so
> there is no stale cached copy to repair and merging one would manufacture an
> incoherence rather than fix one.) Both doors stay open; neither is retired.
>
> **Rejected in the same ruling**, recorded so they are not re-proposed:
> a dedicated endpoint (`POST /api/v1/me/locale`, or extending
> `update_my_profile`) writing under system context — the "second stamping
> route" that #14787's own ruling rejected one level up, and the position where
> a shape check is most easily skipped; and `locale` as a better-auth
> `additionalFields` entry, refused on #13881's measurement above.
>
> **Not amended by this, and since reconciled:** when this amendment was written
> D1's tier *table* still listed two Tier-1 members while the enforced whitelist
> constant held three. #14951 closed that gap on 2026-09-05 — the table now holds
> `{name, image, locale}` too. See the D1 Amendment.

### D6 — Session-cache invalidation companion hook

An `afterUpdate` hook (same registration site, `object: 'sys_user'`) invalidates the
affected user's cached session entries in secondary storage when a user-context write
changed a Tier-1 field. Implementation detail delegated to the auth manager (it owns
the storage keys); the hook only reports "user X changed". No-op when secondary
storage isn't wired (single-node memory cache TTLs it out).

> **D6 Amendment note (2026-09-05, #14951).** The mirror set and D1's Tier-1
> whitelist are **no longer the same set**, and the divergence is deliberate rather
> than a deferral. D6 mirrors the columns better-auth itself keeps in its cached
> `{session, user}` snapshots — `SESSION_SNAPSHOT_MIRRORED_FIELDS` in
> `packages/plugins/plugin-auth/src/identity-write-guard.ts`, which holds
> `{name, image}`. Tier 1 holds `{name, image, locale}`. `locale` is excluded on
> purpose: better-auth carries no such field on its user model, so there is no
> stale cached copy to repair, and merging one would MANUFACTURE an incoherence —
> a `user.locale` key present only on sessions that happen to be cached, appearing
> only after a profile edit and differing per session between two callers of the
> same endpoint. The Context note above — "for the D1 whitelist (`name`, `image`)
> staleness is cosmetic, but 'cosmetic until someone widens the whitelist' is how
> drift ships" — is **answered here rather than rewritten**: the whitelist was
> widened, and D6 correctly did not follow.
>
> ⚠️ Widening Tier 1 again does not widen this set. Add a column to the mirror only
> when better-auth actually carries it on its user model (its own field, or a
> declared `additionalFields` entry), and then only under the name better-auth
> uses — a snake_case ObjectStack column whose better-auth spelling is camelCase
> needs a translation, not an entry.

### Audit (RFC evaluation item 4 — no decision needed)

Nothing to build: plugin-audit already registers engine-wide `beforeUpdate` (previous
snapshot) + `afterUpdate` (audit_log write) hooks, so guarded profile edits are
captured with field-level before/after — *better* than the dedicated endpoints, whose
audit trail is bespoke. Guard rejections surface as errors on an audited path. This
asymmetry is an argument for the hook mechanism, not against it.

## Alternatives considered

| Alternative | Verdict |
|:---|:---|
| Status quo + dedicated `/admin/update-profile` endpoint | Fixes the gap, keeps the UI inconsistency, adds bespoke audit, leaves the family-wide raw-write hole. Rejected. |
| `userActions.edit: true` + field `readonly` flags only | UI-only boundary; server accepts any column from any permitted actor. Prohibited by ADR-0049. Rejected. |
| sys_user-only guard hook (first draft of this ADR) | Sound for the RFC's cell, but patches one of eleven tables and invites per-table copies. Superseded by the registry-driven guard. |
| Delegate profile writes to `internalAdapter.updateUser` inside the hook | Re-entrancy (adapter writes back through the engine), better-auth API coupling, no benefit for columns with no auth side effects. Rejected; D6 covers the one real coherence concern. |
| Widen whitelist to `phone_number` / `manager_id` now | Login-identifier re-keying without verification; silent RLS-scope changes. Deferred behind dedicated flows. |

## Risks

- **Default-deny breaks an unknown legitimate user-context write path.** The
  permission layer already denies non-admins, so the exposed surface is
  platform-admin flows only; implementation must grep call sites and run the full
  suite + dogfood pass before merge. Any legitimate path found is either switched to
  system context (if it's really an internal write) or given a dedicated endpoint —
  not whitelisted reflexively.
- **Whitelist too narrow** → admins fall back to import/SQL for excluded fields.
  Acceptable: widening is a one-line, reviewed change against a named tier list.
- **Guard bypass via system context** — any code path that stamps `isSystem` writes
  freely. That is today's status quo for *all* plugin writes and is required for
  better-auth itself; the guard's job is the *user-context* surface. Server-side
  code review remains the control for system-context writes.
- **objectui behaviour** — the edit affordance flip surfaces a form whose field
  gating lives in the sibling repo. Implementation must verify the rendered form
  against a running stack (dogfood check) before the affordance ships.

## Rollout

1. Implementation issue (on acceptance): generic guard (insert/update/delete,
   registry-driven off `managedBy`) + whitelist registry + shared field module +
   import refactor + tests (user-context strip/throw per table, system-context
   bypass, multi-update, better-auth adapter path untouched, whitelist registration).
2. Session-cache invalidation hook (D6) — same PR or immediate follow-up.
3. Affordance flip + field-level form gating + objectui verification — separate PR,
   gated on 1.
4. Docs: update the identity/user-management guide to say profile fields are
   form-editable for platform admins; everything else keeps its dedicated action.
