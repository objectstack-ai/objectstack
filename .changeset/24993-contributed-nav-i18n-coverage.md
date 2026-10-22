---
"@objectstack/cli": patch
---

fix(cli): `os lint` and `os i18n check` ask for the label of a navigation item another package contributes into an app (#24993)

Clause-②: no
Metadata-protocol: none

A package can add items to an app it does not own through `manifest.navigationContributions`. The runtime merges those items into the app's navigation and shows each one's label from `apps.APP.navigation.ID.label`, where `APP` is the app the item is contributed to. `os validate` already accepted that key. But the i18n extractor only read each app's own `navigation`, so a contributed item's key was never expected: deleting its translation left `os lint --strict` and `os i18n check` green. The same deletion on an item the app declares itself was reported.

Now a contributed item is expected under its target app, from either place a contribution is declared: the stack's own `manifest`, or a package's manifest inside a `composeStacks(…, { manifest: 'preserve' })` artifact. Its source text is its own `label`. A contributed group's children are expected as an app's own group children are. An item the app also declares keeps the app's entry, and a contribution read from two places is expected once.

**What you may see.** A project that contributes navigation and declares a locale beyond its default now gets an `i18n/missing-navigation` finding for each contributed item that locale's pack does not translate. It is a warning by default, which `os lint --strict` fails on. Under `os lint --i18n-strict` or `os i18n check --strict` it is an error, like every other missing translation. To clear them, translate the key under the target app in that locale's pack, for example:

```ts
apps: {
  crm_enterprise: {
    navigation: { nav_case: { label: '工单' } },
  },
},
```

`os i18n extract` now writes these slots too, and keeps the strings a pack already translates. No key, schema or export changes: the key was already part of the translation contract.
