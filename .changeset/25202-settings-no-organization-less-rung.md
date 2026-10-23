---
'@objectstack/service-settings': patch
---

fix(service-settings)!: a tenant- or user-scope setting stored with no organization no longer answers every organization's read, and a caller with no organization reads and writes as the one organization the deployment derives

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) Which stored `sys_setting` row answers a settings read changes. No key of any metadata schema is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite and no tombstone is needed. No export, type, error code or route is removed or renamed: `bindEngine` gains one optional input, and the plugin supplies it. The remedy for the rows this stops reading is the existing organization-ownership ceremony, stated below. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this read (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** read narrowing (ADR-0131 D1 "nothing reads a NULL tenant value as an owner", and D8 "no layer has a NULL arm"). It changes which stored row a settings read takes, not what a metadata author can write, so it ships as `patch` with this banner.

- FROM: a `tenant`- or `user`-scope `sys_setting` row written with no organization was every organization's fallback. A caller that named an organization read its own row, or failing that the organization-less one. A caller that named none read only organization-less rows behind a wall (`group` / `isolated`). Under `single` it read every row, an organization's first. Under `single` such a caller also wrote with no organization, so its write's identity probe missed the row the engine stamped with the Default Organization. The second save of a key then inserted a second row beside the first. On a SQL store the identity index refuses that insert and the save fails. On a store with no such index the save was lost: every reader kept answering the first value.
- TO: a caller reads its organization's rows and no others. For a caller that names no organization, the deployment names one (ADR-0131 D9, the predicate the engine applies to a system write):
  - Under `single` with one organization, the caller reads and writes as that organization. This covers the process-wide readers: plugin-auth's email brand name and auth locale, and the anonymous `runtime/config` branding read.
  - Behind a wall, or under `single` with no organization or several, the caller has no tenant or user rung. Its read answers from the global rung or the default, and its tenant-scope write is refused (`SETTINGS_VALIDATION`, `constraint: { scope: 'tenant' }`).
  - A composition that registers no organization object (a lean embedding, kept by ruling) still stores and reads its rows with no organization.

**Who is affected.** Only a store holding a tenant- or user-scope `sys_setting` row with a NULL `organization_id`. A fresh install holds none, nor does an 18.0.0-born store written through `os serve`: the measured 18.0.0 fixture holds two `sys_setting` rows, both owned. A v17 store holds none after `os migrate organization-ownership` under `single`, which gives such rows to the Default Organization. Under a walled posture the ceremony leaves such a row NULL and reports it, and from this release that row stops answering any organization.

**The remedy.** Run `os migrate organization-ownership --out PLAN`, review the reported `sys_setting` rows, and save each value again from inside the organization it belongs to (Setup → the settings page, or `PUT /api/settings/:namespace` with that organization active). A value meant for every organization belongs on a key declared at scope `global`.
