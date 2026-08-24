---
"@objectstack/core": minor
"@objectstack/plugin-auth": patch
---

**Security:** the "is this user id a platform admin?" question is now asked in exactly one place, and the two copies that answered it differently are gone (#10348, #10949).

ADR-0068 D2 defines platform standing as one thing — an unscoped `admin_full_access` grant, held now. `core/security/resolve-authz-context.ts` is the declared authority for authorization derivation and its header states that every entry point must resolve through it and never re-read the grant tables itself. `plugin-auth`'s `auth-manager.ts` did exactly that twice: once inside the `customSession` callback, and once in the predicate that authorizes `/sso/register` and, through the impersonation oracle, `/admin/impersonate-user`. Both copies are deleted. Both callers — and the session payload — now ask `hasPlatformAdminStanding(engine, userId)`, a projection of `resolveUserAuthzGrants` exported from `@objectstack/core`, so a platform-admin verdict is derived in one place for the whole platform.

**What that changes, and it is a tightening on all three counts.** The deleted copies applied neither the ADR-0091 validity window nor the ADR-0049 `active` check, and resolved `admin_full_access` by matching a name over a page of the permission-set catalogue. The authority applies both checks before any derivation and resolves the set by id. So:

- an **expired** platform-admin grant no longer authorizes `/sso/register` or `/admin/impersonate-user`, and no longer appears in the session payload;
- a **deactivated** `admin_full_access` permission set no longer confers platform standing anywhere — the deactivation dialog's promise now holds on these gates too;
- an environment holding **more permission sets than a single catalogue page** can no longer lose the `admin_full_access` row and demote every platform admin at once.

**One behaviour widens, and it was ruled deliberately** (maintainer, 2026-08-24). The `customSession` copy read without a system identity while the other read with one. The single authority reads as system, so on a strictly org-scoped deployment the session payload stops under-reporting platform admin — the fail-closed drift between the payload and the gates ends. Open-core composition is unaffected: the two reads reached identical rows there already.

**The org boundary is unchanged and now pinned at both gates.** An org owner, an org admin, a `TENANT_ADMIN`-posture principal and an org-scoped `admin_full_access` grant are all refused — the `PLATFORM_ADMIN` rung derives from the unscoped capability grant alone. The predicate takes an engine and a user id and nothing else: it deliberately does not accept the resolver's caller-supplied seeds, so no part of a request can supply part of its own verdict.

Population queries are a different kind and are untouched: `ensure-default-organization.ts` asks *which* user is the platform admin, which a per-user predicate cannot express.
