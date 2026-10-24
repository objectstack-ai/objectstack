---
'@objectstack/platform-objects': minor
---

fix(platform-objects): `SETUP_NAV_CONTRIBUTIONS` no longer carries the Setup → Branding entry; `@objectstack/service-settings` contributes it with the `branding` namespace

Clause-②: no (the entry moves to the package that serves its page: a composition that serves Setup → Branding still lists it, and one that does not no longer lists a page it cannot open)

The `nav_settings_branding` entry (Setup → Configuration → Branding) was a static item of `SETUP_NAV_CONTRIBUTIONS`, listed whatever the settings service offered. From this release `@objectstack/service-settings` does not offer the `branding` namespace under the `group` and `isolated` tenancy postures, so a static entry would open a page the server refuses with `404 UNKNOWN_NAMESPACE`.

`SettingsServicePlugin` (`@objectstack/service-settings`, same release) now contributes the entry from the same `kernel:ready` step that offers the namespace, and only then. On a single-organization deployment Setup still lists Branding, now at the end of the Configuration group's platform entries. Its translated labels are unchanged and still keyed `apps.setup.navigation.nav_settings_branding`.
