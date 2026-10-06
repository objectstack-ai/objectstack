---
'@objectstack/service-settings': minor
---

fix(service-settings)!: the Localization settings no longer offer `date_format`, `time_format`, `number_format` or `first_day_of_week`: dates, times, numbers and the week start follow the locale (#21958)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) The four keys were settings values, not metadata: only the platform-shipped localizationSettingsManifest declared them (only platform code declares a settings manifest), SettingsManifestSchema and every other spec declaration are unchanged, and a value stored for one of them lives in sys_setting (runtime state, ADR-0007), not sys_metadata, and is kept as it is. Nothing read the keys in objectstack, objectui, cloud or hotcrm, so no consumer has anything to rewrite and objectstack migrate meta has nothing to reach. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a settings key (not already-registered); and the change is the value of an exported manifest constant, not an interface or a type alone (not runtime-interface-only or type-surface-only). -->

**BREAKING**: the Localization settings namespace (`localizationSettingsManifest`) drops four specifiers that nothing ever read: `date_format`, `time_format`, `number_format` and `first_day_of_week`, together with the Formats group they made up and their copy in the `en`, `zh-CN`, `ja-JP` and `es-ES` settings bundles. Setup → Localization no longer shows them, and `GET /api/settings/localization` no longer serves them. The maintainer ruled that dates, times, numbers and the first day of the week follow the user's locale (language and region), as Salesforce derives them from a Locale, and that the four separate settings retire rather than being implemented. `timezone`, `locale`, `default_country`, `currency` and `fiscal_year_start` are unchanged. The manifest's `version` is now 2, as the `SettingsManifest.version` contract asks when keys are removed.

**A value a workspace already stored for one of the four is kept.** Measured at the REST surface:

- The `sys_setting` row stays exactly as it was. No read, save or reset rewrites or deletes it.
- `GET /api/settings/localization` does not resolve it: the key is absent from both `manifest.specifiers` and `values`.
- A `PUT /api/settings/localization` that names one of the four is refused with `400 UNKNOWN_KEY` (`details.key` names it), the answer every undeclared key gets. The refusal covers the whole batch, so a live key sent beside it does not land either.
- A stored row never blocks saving the live keys, and the built-in `reset` action leaves it in place.
- In process, `settings.get('localization', 'date_format')` (or any of the four) now rejects with `SETTINGS_UNKNOWN_KEY`.
- An `OS_LOCALIZATION_DATE_FORMAT`, `OS_LOCALIZATION_TIME_FORMAT`, `OS_LOCALIZATION_NUMBER_FORMAT` or `OS_LOCALIZATION_FIRST_DAY_OF_WEEK` variable is no longer read. It set a value that nothing read before either.

**What to do after upgrading.** Nothing has to be rewritten: the four keys never changed how anything rendered. There is no replacement key. `locale`, the workspace's language and region, is what decides how dates, times and numbers are written. The console's calendar and timeline do not yet take their first day of the week from it; that is objectui work, tracked and shipped separately.

It ships as `minor` under the launch-window convention for narrowings.
