---
'@objectstack/spec': patch
---

fix(spec): the liveness ledger's `Seed.locale` row names the six seed-load request builders and where each one's locale comes from, so it no longer says the marketplace install passes none

Clause-②: no
Metadata-protocol: none

- `liveness/seed.json`'s `locale` row said three publish/install-time paths pass no locale, the marketplace install among them. The install paths now pick seed datasets by locale: the marketplace install, the sample-data reseed, the restart heal and the per-organization replay each resolve one (the organization's Localization setting, then the user's language, then the app's `i18n.defaultLocale`). The boot seed and the dev hot-reload seeder still use the app's `i18n.defaultLocale`. Package apply and draft publish still pass none.
- The earlier ruling that publish and install are locale-neutral is kept as recorded, followed by a dated line saying its bound now covers package apply and draft publish only. The note also says why the loader's no-locale warning stays.
- Nothing to do on upgrade: only the shipped `liveness/seed.json` note text and its `verifiedAt` date change. No key, schema shape or export changes.
