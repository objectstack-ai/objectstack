---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/core': patch
---

feat(plugin-auth): a platform administrator sees who holds platform-admin standing from Setup → Users (#28793)

Clause-②: yes (widening)
Metadata-protocol: none

The Users list carries no column for platform-admin standing, because that standing is derived per user and is not stored on `sys_user`. The list toolbar now has one entry instead, **Platform Administrators**, which opens a list of every user who holds that standing right now.

- **The answer.** `POST /api/v1/auth/admin/list-platform-admins` (`@objectstack/plugin-auth`) enumerates the candidates with the last-admin guard's own enumerator: the in-window `admin_full_access` grants the Default Organization owns, and the verified `sys_user` rows on the `OS_PLATFORM_OWNER_EMAIL` list. It then confirms each candidate through `hasPlatformAdminStanding`. The roster can only be narrower than that predicate, never wider. Organization owners and admins are not platform administrators and are not listed.
- **Who may read it.** Only a caller who holds platform-admin standing. Anonymous callers get 401, and every other caller, an organization owner or admin included, gets 403 `PERMISSION_DENIED` with no data.
- **Exported.** `resolveAdminUserIds(engine, { standing })` (`@objectstack/plugin-auth`): `'administrators'` (the default) is the population the break-glass guard protects, and `'platform-admins'` drops the organization half. The guard's own behaviour is unchanged.
- **Pinned.** `ADMIN_STANDING_PLATFORM_ENUMERATION` (`@objectstack/core`) names the enumerator and classifies every input of the administrator derivation as a candidate source or not, so a new source of platform-admin standing is red until the enumerator reads it.
- **Unchanged.** The Users list still reads one page per request. No `sys_user` field is added.
