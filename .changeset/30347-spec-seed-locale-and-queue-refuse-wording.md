---
'@objectstack/spec': patch
---

docs(spec): `Seed.locale` says which loads filter on it, and the ownership-queue contract says the registered service honours `onFailedRead: 'refuse'`

Clause-②: no
Metadata-protocol: none

Wording only: no schema shape, no type and no behaviour changed.

- **`Seed.locale`** (docblock and `.describe()`, which the references pages render). It no longer says that installing is locale-neutral. The boot seed and the dev hot-reload seeder filter on the app's `i18n.defaultLocale`. The marketplace install, the sample-data reseed, the restart heal and the per-organization replay filter on the locale `resolveSeedLocaleForLoad` (`@objectstack/runtime`) resolves for the load, first answer wins: the `localization.locale` setting, counted only when somebody set it (not `source: 'default'`); then the `sys_user.locale` of the user who installs, reseeds or founds the organization; then the app's `i18n.defaultLocale` where the load names one. Package apply and draft publish still pass no locale: they load every dataset and warn.
