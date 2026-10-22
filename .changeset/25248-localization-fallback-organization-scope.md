---
'@objectstack/core': patch
---

fix(core)!: `resolveLocalizationContext`'s direct `sys_setting` fallback reads the caller's organization's rows only, never another organization's row or a row with no organization outside a lean embedding

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) Which stored `sys_setting` row the localization fallback takes changes. No key of any metadata schema is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite and no tombstone is needed. No export, type, error code or route is removed or renamed: `resolveLocalizationContext` keeps its signature. The remedy for the rows this stops reading is the existing organization-ownership ceremony, stated below. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this read (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** read narrowing (ADR-0131 D8 "no layer has a NULL arm"). It changes which stored row a localization read takes when the settings service cannot answer, not what a metadata author can write, so it ships as `patch` with this banner.

- FROM: when the settings service was absent or threw (a namespace not yet bound, a failed organization or posture read), `resolveLocalizationContext` read `sys_setting` tenant rows for `timezone` / `locale` / `currency` with no organization filter and took the first row per key. A signed-in user of one organization could be answered with another organization's timezone, locale or currency, or with a row written with no organization, and the success cache could hold that answer.
- TO: the fallback reads with the reach the settings service reads with:
  - A caller that names an organization reads that organization's rows, under every posture.
  - A caller that names none reads the one organization ADR-0131 D9 derives under `single`. Behind a wall (`group` / `isolated`, the requested posture), at zero or several organizations, or when the organization read fails, it reads nothing and the built-ins `UTC` / `en-US` answer.
  - A composition that registers no `sys_organization` (a lean embedding) reads the rows written with no organization, the only rows it can hold.

**Who is affected.** Only a deployment whose settings service fails a localization read, and only for an organization with no tenant localization row of its own, or a store holding organization-less tenant localization rows. A healthy settings service never reaches this read.

**The remedy.** Run `os migrate organization-ownership --out PLAN`, review the reported `sys_setting` rows, and save each localization value again from inside the organization it belongs to (Setup → Localization, or `PUT /api/settings/localization` with that organization active).
