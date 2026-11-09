---
'@objectstack/runtime': minor
'@objectstack/cloud-connection': minor
'@objectstack/organizations': patch
---

feat(runtime,cloud-connection): the marketplace install, the sample-data reseed, the restart heal and the per-organization seed replay pick `Seed.locale` datasets by the organization's language

Clause-②: yes (widening)
Metadata-protocol: semantic

An app that ships one demo dataset per language market (`locale: ['zh-CN']` beside `locale: ['en-US']`) now gets the right one on every path that seeds an organization, not only on the boot path. Before, the install paths passed no locale, so a Chinese organization received the English rows and a page of refused-insert warnings for the Chinese twins (or both sets, where no unique key stopped the second), and one server's per-organization replay gave every new organization the boot app's `i18n.defaultLocale`.

The locale is resolved for the organization the rows land in. The first answer wins:

1. the organization's `localization.locale` setting, through the settings service's own cascade (an env override, the organization's row, the deployment-wide `global` row). Only a value somebody set counts: the manifest's built-in `en-US` default (`source: 'default'`) is not the organization's choice;
2. `sys_user.locale` of the person installing, reseeding or founding the organization;
3. the app's declared `i18n.defaultLocale`.

Nothing answers ⇒ no locale is sent, and every dataset loads as before (the loader still warns, naming each locale-scoped dataset it let through). A dataset without `locale` loads whatever the answer is. When no dataset in a load declares `locale`, neither the setting nor the user is read.

- **The per-organization replay** resolves the locale per organization, at replay time, instead of once at boot. At founding the organization has no setting of its own yet, so its founder's language decides; an organization inserted with no person behind it takes the app's default. The replayer (`seed-replayer` service) now takes an optional second argument, `(organizationId, { userId })`; a caller passing only the organization id works as before.
- **`@objectstack/organizations`**: the org-scoping middleware hands the replayer the insert's attributed user (better-auth's create runs as system with the signed-in creator attributed) as the founder.
- **`@objectstack/cloud-connection`**: the install and the reseed pass the installing user and the package's own `i18n.defaultLocale`; the restart heal passes the package's default only (no person starts it); the replayer this plugin registers when the host has none passes the founder and no app default, because it replays every installed package at once.
- **`@objectstack/runtime`** exports the shared producer: `resolveSeedLocaleForLoad(host, { seeds, organizationId, userId, appDefaultLocale })`, `appDefaultSeedLocale(body)`, `seedsDeclareLocale(seeds)`, `describeSeedLocale(resolved)` and the `ResolvedSeedLocale` / `SeedLocaleQuestion` / `SeedLocaleSource` types.
- A settings or user read that throws is not skipped over: the seed reports the failure (the install's seed summary, the reseed's `RESEED_SKIPPED`, the replay's warning) and writes nothing, rather than seeding another language over a choice that could not be read. A host with no `settings` service skips step 1.

Unchanged: the boot seed and the dev hot-reload seeder still filter on the app's `i18n.defaultLocale`; package apply and draft publish still pass no locale.
