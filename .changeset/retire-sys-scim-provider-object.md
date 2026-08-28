---
'@objectstack/platform-objects': minor
'@objectstack/spec': minor
'@objectstack/plugin-auth': minor
'@objectstack/plugin-security': minor
---

**BREAKING (platform object removed):** the `sys_scim_provider` platform object is retired (#11757, ruled on #11693 — leg 1a of the #11632 SCIM epic).

FROM → TO, per surface:

- `SysScimProvider` (export of `@objectstack/platform-objects` / `.../identity`) → removed, no replacement export. Fix: delete the import. Stable SCIM state lives on the seven `sys_scim_*` stable-model objects (#3653), and connection credentials on `sys_scim_connection_credential`.
- `sys_scim_provider` in `PLATFORM_PROVIDED_OBJECT_NAMES` (`@objectstack/spec/system`) → removed. `isPlatformProvidedObjectName('sys_scim_provider')` is now `false`, so a stack referencing the name is flagged as a probable typo instead of resolving.
- plugin-auth: the object is no longer provisioned, and `AUTH_MODEL_TO_PROTOCOL` carries no `scimProvider` entry — the installed stable `@better-auth/scim@1.7.1` derives no such model, so the entry bridged nothing.
- plugin-security: the `BETTER_AUTH_MANAGED_OBJECTS` write-deny entry for it is gone with the object (the list is pinned bidirectionally against `managedBy: 'better-auth'` declarations).

The rc.1-era row was written only by the retired `/scim/generate-token` endpoint; after the stable-1.7.1 migration (PR #12726) nothing could write to it. Per the maintainer's ruling (2026-08-24, 「不需要考虑历史数据」; reaffirmed 2026-08-25 — SCIM has no real customers), **no data migration ships**: existing `sys_scim_provider` tables in deployed databases are left untouched — no backfill, no reaper, no migrate command. SCIM-enabled deployments re-register connections on the stable surface; the IdP token reissue is a migration-day operator action regardless of this change.

The ADR-0066 D3 capability-gate pin moves from the retired object to its surviving sibling `sys_sso_provider`, so the gate posture stays test-pinned.

Breaking ships as `minor` per the launch-window convention (`scripts/check-changeset-no-major.mjs`) and the #12726 precedent on the same ruling.

<!-- adr-0087: registered scim-provider-object-retired -->
