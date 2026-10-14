---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a fresh `os dev` database opens on the console shell, not on the "Set the workspace timezone" dialog — the dev seed gives the workspace it lands its admin in the host's time zone

Clause-②: no

**FROM.** The dev admin seed (`NODE_ENV=development`, on unless `OS_SEED_ADMIN=0`) created its admin and left the admin's workspace with `localization.timezone` unset. The console asks an administrator for a zone while that key still resolves from the manifest default, so every fresh `os dev` database (each `--fresh` run, each new database file) opened on the dialog. The console's own workspace-creation paths already send the creator's browser zone; the seed did not go through them.

**TO.** On the boot that seeds the admin, the seed writes the host's resolved zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`, so `TZ` chooses it) to `localization.timezone` for each organization the admin is a member of. Under the default `single` posture that is the Default Organization. The write goes through the settings service, the same door the dialog's confirm uses. It is one `tenant` row per organization, with the key's IANA zone check applied there.

**Unchanged.**
- A zone already set on any rung (the organization's, the global one, an `OS_LOCALIZATION_TIMEZONE` override) is never overwritten.
- A host that reports no zone, or reports one the settings door refuses, gets nothing written. The workspace keeps the default and the dialog still asks.
- Boots after the seeding one write nothing, so a database that already exists is not touched.
- Production is not affected: the seed stays gated to `NODE_ENV=development`.
- `sys_organization.timezone` is a separate key, which the dialog does not read. It is not written.

**Note for in-process test boots.** `@objectstack/verify`'s harness forces `NODE_ENV=development` to get the seeded admin, so its boots now give that admin's workspace the host's zone too. On a host in `UTC` the resolved value is the same as before. On a host in another zone, a suite that relies on the default `UTC` can set `TZ=UTC`, or set the zone through `PUT /api/settings/localization` as it would for any workspace.
