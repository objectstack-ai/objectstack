---
'@objectstack/spec': minor
---

feat(spec): a translation bundle may leave out `apps.APP.label`, so a module package can translate only the navigation ids it contributes into another package's app

Clause-②: yes (widening)
Metadata-protocol: added

A module that contributes navigation into an app it does not own (`manifest.navigationContributions`) can now ship those labels in its own bundle, carrying only `apps.<app>.navigation.<contributed id>.label`. Before, `apps.APP.label` was required, so that bundle failed `defineStack`, `os validate` (`translations.0.<locale>.apps.<app>.label`) and `tsc` (TS2741 on `TranslationData`), and the only way through was to restate the owning package's app label in every module pack.

- **What is accepted.** `apps.APP.label` is optional on every schema built from the app translation shape (`TranslationData`, `TranslationBundle`, `TranslationItem`, the platform and served bundles). `apps.APP.navigation.ID.label` stays required: it is the string being translated.
- **What the runtime does.** Nothing changes. Each package's bundle is deep-merged per locale, so the owning package's app label survives a module bundle that leaves it out, in either load order.
- **What lint does.** Nothing changes. `translation-target-unknown` already accepts, under an app the stack only contributes into, the contributed ids alone.
