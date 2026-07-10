# ADR-0092: sys_user profile-field editing — guarded edit affordance via engine hook

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ObjectStack Protocol Architects
- **Relates to:** [ADR-0010](./0010-metadata-protection-model.md) (identity tables managed by better-auth), [ADR-0049](./0049-no-unenforced-security-properties.md) (no unenforced security properties), [ADR-0068](./0068-unified-user-context-and-built-in-identity-roles.md) (platform-admin gate), [ADR-0069](./0069-enterprise-authentication-hardening.md) (system-managed auth stamps), #2766 / PR #2771 (admin user management + identity import), #2784 (this RFC)

## TL;DR

`sys_user` is `managedBy: 'better-auth'`: every generic CRUD affordance is off and the
default permission sets deny direct writes, because a raw ObjectQL write bypasses the
better-auth pipeline (scrypt hashing, `sys_account` creation, verification flows,
session-cache coherence). After #2766, every *credential* mutation has a purpose-built
endpoint — but editing a **pure profile field** (a user's display name) still cannot go
through the standard edit form / data API, which leaves the Users surface inconsistent
with every other object.

Decision — open a **narrow, server-enforced** profile write path:

- **D1** — classify `sys_user` columns into three tiers: *profile-editable*
  (`name`, `image`), *admin-surface-only* (written only by dedicated endpoints /
  import: `role`, `phone_number`, `manager_id`, `ai_access`, ban columns), and
  *never-direct* (login identity, credentials, every system-managed stamp).
- **D2** — enforcement lives in a **`beforeUpdate` engine hook** in `plugin-auth`
  that fail-closed strips any non-whitelisted field from a *user-context* update to
  `sys_user`. UI `readonly` flags alone are explicitly rejected as the mechanism
  (ADR-0049: a boundary the runtime does not enforce is worse than absent).
- **D3** — one shared whitelist module in `plugin-auth`; the import upsert's
  `UPDATE_ALLOWED_FIELDS` (PR #2771) becomes a superset re-exported from it, so the
  two surfaces cannot drift.
- **D4** — only after D2 lands, flip the UI affordance: `userActions: { edit: true }`
  on `sys_user` (create / import / delete stay off). Non-whitelisted fields must
  render non-editable in the standard edit form.
- **D5** — permission sets are unchanged: members / org-admins keep
  `allowEdit: false`; the standard edit path is therefore **platform-admin only**.
  Self-service profile editing stays on better-auth `/update-user`
  (the existing `update_my_profile` action).
- **D6** — an `afterUpdate` companion hook invalidates the affected user's cached
  session snapshots (secondary storage), keeping better-auth session reads coherent
  without delegating the write itself to `internalAdapter.updateUser`.

Side effect worth naming: D2 also **closes an existing hole** — today
`admin_full_access` (wildcard, no RLS) can already write *any* `sys_user` column —
including `email`, `banned`, `must_change_password` — through the generic data API;
only UI affordances hide it. After D2 that path is whitelist-filtered too.

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

Three findings from the current code shape this decision:

1. **Field-level `readonly` is a UI hint, not a server boundary.**
   `validateRecord` *skips* system/readonly columns rather than rejecting writes to
   them, and only `readonlyWhen` (conditional, state-dependent locks) is stripped
   server-side on update (`engine.ts` B2). Opening `edit` with only `readonly` flags
   would ship exactly the "parsed but unenforced security property" ADR-0049 bans.
2. **The affordance matrix is advisory.** `resolveCrudAffordances` gates toolbar
   buttons; the REST data API for `sys_user` is fully on
   (`apiMethods: ['get','list','create','update','delete']`). The real gate is the
   permission-set layer — and `admin_full_access` passes it with a wildcard.
3. **better-auth's own writes flow through the ObjectQL engine.** The better-auth
   adapter (`objectql-adapter.ts`) calls `engine.update(...)` with no caller context,
   which means (a) engine hooks *do* fire for better-auth writes — audit already
   captures them — and (b) a guard hook must distinguish user-context writes from
   internal/system writes, not just "writes".

### Session-cache consistency

ADR-0069 D2 wires the kernel cache service as better-auth `secondaryStorage`, which
caches session (+ user snapshot) entries. better-auth's own update paths keep those
snapshots coherent; a raw engine write to `sys_user` does not. For the D1 whitelist
(`name`, `image`) staleness is cosmetic, but "cosmetic until someone widens the
whitelist" is how drift ships — coherence is handled explicitly (D6).

## Decisions

### D1 — Field tiers

**Tier 1: profile-editable** (standard form / data API, guarded by D2):

- `name` — display name. No auth semantics (`displayNameField`, not a login key).
- `image` — avatar URL. No auth semantics.

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

### D2 — A fail-closed `beforeUpdate` guard hook in plugin-auth

`plugin-auth` registers (at `kernel:ready`, same pattern as the existing SCIM
provenance hook):

```
engine.registerHook('beforeUpdate', guardSysUserProfileWrite,
                    { object: 'sys_user', packageId: 'com.objectstack.plugin-auth' });
```

Behaviour:

- **Applies to user-context writes only**: when `hookContext.session` carries a real
  user and the operation context is not `isSystem`. Internal writes — the better-auth
  adapter (no context), plugin system writes (`SYSTEM_CTX`), import's engine calls —
  bypass the guard unchanged. This is what keeps sign-in stamps, ban endpoints and
  the import path working.
- **Whitelist-filters, fail-closed**: every key in the update payload that is not in
  Tier 1 is stripped; if the payload becomes empty the hook throws a
  `FORBIDDEN`-class error (so a form that only tried to set `email` gets a loud
  failure, not a silent no-op). Unknown/new columns are non-whitelisted by
  construction — adding a field to `sys_user` never silently opens it.
- **Covers both update shapes**: single-id updates and `options.multi` bulk updates
  run through the same `beforeUpdate` event; the filter applies to the payload in
  both cases.
- Self-vs-other is *not* distinguished here: permission sets already decide who may
  update at all (D5); the hook decides *which columns* any permitted actor may touch.

Why a hook and not the alternatives:

- **Not UI `readonly` only** — finding #1 above; ADR-0049 prohibits it.
- **Not full delegation to `internalAdapter.updateUser`** — the adapter itself writes
  through `engine.update`, so a hook that re-enters better-auth would recurse through
  the very pipeline it guards; it also couples the data path to better-auth API
  stability for zero gain, since the columns in Tier 1 have no auth-side effects.
  Delegation remains the right answer for anything credential-shaped — which is why
  those stay on dedicated endpoints (Tier 2/3), not in the whitelist.
- **Not a new `/admin/update-profile` endpoint** — it would fix the one missing cell
  but keep `sys_user` off the standard UI path (the very inconsistency this RFC is
  about), add a bespoke audit surface, and leave the `admin_full_access` raw-write
  hole open.

Trade-off accepted: `admin_full_access`'s "rescue data directly" capability on
`sys_user` narrows to Tier 1 via the HTTP data API. Rescue of other columns now
requires system context (server-side script / CLI), which is deliberate hardening —
the columns in question are exactly the ones raw rescue is most dangerous for.

### D3 — One whitelist module, import re-uses it

New module in `plugin-auth` (e.g. `sys-user-writable-fields.ts`):

```ts
/** Tier 1 — standard form / data-API editable (guard hook, D2). */
export const SYS_USER_PROFILE_EDIT_FIELDS = new Set(['name', 'image']);

/** Import-upsert may additionally touch these (admin bulk-identity surface). */
export const SYS_USER_IMPORT_UPDATE_FIELDS = new Set([
  ...SYS_USER_PROFILE_EDIT_FIELDS, 'phone_number', 'role',
]);
```

`admin-import-users.ts` replaces its private `UPDATE_ALLOWED_FIELDS` with
`SYS_USER_IMPORT_UPDATE_FIELDS`. The relationship is subset-by-construction
(a spread, not two hand-maintained lists), which is the actual anti-drift property
the RFC asked for — the two surfaces intentionally differ (import may set `role` /
`phone_number`; the form may not), so "the same set" would be wrong; "one file, one
derivation" is right.

### D4 — Affordance flip, after enforcement exists

Once D2 is merged and tested, `sys_user` gains:

```ts
userActions: { edit: true },   // create / import / delete stay bucket-default (off)
```

`managedBy: 'better-auth'` stays — it remains true (drives permission-set defaults,
system-field injection skip, docs) — the per-flag override is exactly what
`userActions` exists for.

Form rendering: every non-Tier-1 field must render non-editable in the standard edit
form. Most Tier 2/3 columns already carry `readonly: true`; the remainder (`email`,
`email_verified`, `two_factor_enabled`, `role`, `banned`, `ban_reason`, `ban_expires`,
`ai_access`) need field-level treatment at implementation time. Constraint for the
implementer: `email` / `role` are referenced as action `params` (`create_user`,
`invite_user`, `set_user_role`) — verify that flipping `readonly` on the field does
not disable those param inputs before choosing between `readonly: true` and a
form-level exclusion. Sequencing is a hard rule either way: **affordance ships in the
same or a later release as the guard, never earlier** (ADR-0049).

### D5 — Who can edit whom: unchanged permission topology

- `member_default` / `viewer_readonly` / `organization_admin`: `allowEdit: false` on
  `sys_user` stays. Nothing about this ADR widens *who* may write.
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

### D6 — Session-cache invalidation companion hook

An `afterUpdate` hook (same registration site, `object: 'sys_user'`) invalidates the
affected user's cached session entries in secondary storage when a user-context write
changed a Tier-1 field. Implementation detail delegated to the auth manager (it owns
the storage keys); the hook only reports "user X changed". No-op when secondary
storage isn't wired (single-node memory cache TTLs it out).

### Audit (evaluation item 4 — no decision needed)

Nothing to build: plugin-audit already registers engine-wide `beforeUpdate` (previous
snapshot) + `afterUpdate` (audit_log write) hooks, so guarded profile edits are
captured with field-level before/after — *better* than the dedicated endpoints, whose
audit trail is bespoke. This asymmetry is an argument for the hook mechanism, not
against it.

## Alternatives considered

| Alternative | Verdict |
|:---|:---|
| Status quo + dedicated `/admin/update-profile` endpoint | Fixes the gap, keeps the UI inconsistency, adds bespoke audit, leaves the wildcard raw-write hole. Rejected. |
| `userActions.edit: true` + field `readonly` flags only | UI-only boundary; server accepts any column from any permitted actor. Prohibited by ADR-0049. Rejected. |
| Delegate profile writes to `internalAdapter.updateUser` inside the hook | Re-entrancy (adapter writes back through the engine), better-auth API coupling, no benefit for columns with no auth side effects. Rejected; D6 covers the one real coherence concern. |
| Widen whitelist to `phone_number` / `manager_id` now | Login-identifier re-keying without verification; silent RLS-scope changes. Deferred behind dedicated flows. |

## Risks

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

1. Implementation issue (on acceptance): guard hook + shared whitelist module +
   import refactor + tests (user-context strip/throw, system-context bypass,
   multi-update, better-auth adapter path untouched).
2. Session-cache invalidation hook (D6) — same PR or immediate follow-up.
3. Affordance flip + field-level form gating + objectui verification — separate PR,
   gated on 1.
4. Docs: update the identity/user-management guide to say profile fields are
   form-editable for platform admins; everything else keeps its dedicated action.
