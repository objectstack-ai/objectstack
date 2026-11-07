---
'@objectstack/plugin-auth': patch
'@objectstack/service-settings': patch
'@objectstack/platform-objects': patch
---

feat(plugin-auth, service-settings)!: the access policy is set per organization, and the multi-factor requirement has three levels

Clause-②: yes (narrowing) — a new `access_policy` settings namespace (scope `tenant`) carries each organization's allowed IP ranges, idle, absolute and concurrent session limits and multi-factor requirement; `auth.mfa_required` changes from a toggle to the levels `off` / `administrators` / `everyone`, `sys_organization.require_mfa` is no longer writable, and `AuthManagerOptions.mfaRequired` becomes `mfaRequirement`.
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only packages/plugins/plugin-auth/src/auth-manager.ts#AuthManagerOptions) the narrowed operands are a runtime option of the auth manager (`AuthManagerOptions.mfaRequired`, which the compiler names at every caller), a settings value (`auth.mfa_required`, rewritten from a stored toggle to a level by plugin-auth at boot) and a platform object column's editability (`sys_organization.require_mfa`, whose stored value plugin-auth moves into the organization's access policy at boot); no packages/spec schema, registered node type or ADR-0087 conversion surface names any of them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING.** The access policy is set per organization (rulings of record on objectstack-ai/cloud#3668: 「支持按组织（推荐）」, 「可以，按三档做（推荐）」). Each organization sets its own allowed IP ranges, session idle timeout, absolute session lifetime, concurrent-session cap and multi-factor requirement in **Settings → Access policy** (the `access_policy` namespace, one row per organization, written by its administrators). The deployment's values in **Settings → Authentication** are the default and the floor: an organization may tighten and never loosen.

The rule per key — a value weaker than the deployment's is refused at the save, and enforcement holds the floor whatever is stored:

- `allowed_ip_ranges`: each range must lie inside a deployment range (any range when the deployment sets none), and the list must admit the address it is saved from. A request must pass both lists. A session is scoped to an organization only from an address its list admits: the sign-in is refused with `403 IP_NOT_ALLOWED` when the organization the session would be scoped to does not admit the address, and so is a switch of the active organization. A session the organization's list no longer admits (it roamed, or the list was tightened) is signed out on its next session read through the auth routes. Sign-in itself, before any organization is chosen, is judged by the deployment's list alone. A platform administrator is held by the deployment's list only, so an organization that locks out its own administrators can be reopened, and the save check does not refuse a platform administrator's save from outside an organization's list.
- `session_idle_timeout_minutes`, `session_absolute_max_hours`: `0` keeps the deployment's limit; a positive value may not exceed the deployment's. The shorter of the two applies to every session scoped to the organization. A switch of the active organization is judged against the target organization's limits before it lands, from the session's last request in any organization; a session past either is signed out and the switch refused.
- `max_concurrent_sessions_per_user`: `0` keeps the deployment's cap; a positive value may not exceed the deployment's. The deployment's cap still counts every session of the user, in any organization; an organization's cap counts only the user's sessions in that organization and signs out only those, oldest first. Both are checked at sign-in and when a session switches into the organization.
- `mfa_required`: `off` keeps the deployment's level; a level may not be weaker than the deployment's. The stronger of the two applies. `administrators` holds platform administrators, the organization's own administrators (owner or admin membership) and delegated administrators (a permission set with an `adminScope`), and lets everyone else through.

What to do on upgrade:

- `auth.mfa_required` saved as on now reads `everyone`, and as off `off`. A stored toggle is rewritten at the first boot; the `OS_AUTH_MFA_REQUIRED` env override still reads `true`/`false` with a warning for one major release — set it to `off`, `administrators` or `everyone`. A **write** of `true` or `false` to `auth.mfa_required` is now refused by the setting's option table (`invalid_option`): write `everyone` or `off`. Consumer: objectstack-ai/cloud's `apps/cloud/test/settings-cross-org-doors.test.ts` (`:533` writes `true`, `:552` expects it back) must be rewritten to `everyone` when the framework pin moves past this release.
- An organization whose `sys_organization.require_mfa` was on now carries `access_policy.mfa_required` set to `everyone`. Moved at the first boot (unless the organization already chose a level), and the column is cleared once the row lands; a move that fails is logged at `error` and retried at the next boot. The column is now readonly: a data-API write to it is refused like any other non-editable column.
- A host that passed the auth manager or plugin option `mfaRequired: true` passes `mfaRequirement: 'everyone'` (or `'administrators'`) instead. A host still passing `mfaRequired` is refused at construction (and on `applyConfigPatch`) with an error naming the replacement, never run without the requirement.

What does not change: with no organization policy saved, every deployment enforces exactly what it enforced before, and the deployment's own keys keep their names.
