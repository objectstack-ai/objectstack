---
'@objectstack/spec': patch
'@objectstack/plugin-auth': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): the workspace prompt also asks an administrator for a default currency that is still unset, offering the browser region's currency

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/spec/shared` gains `REGION_CURRENCY` and `currencyForLocale`, the checked-in CLDR region → currency table and its lookup. They move there from `@objectstack/plugin-auth`, which gives a new organization its creator's currency through them and no longer keeps its own copy. The table and the mapping are unchanged. Neither name was exported from the plugin-auth package entry, so nothing an importer of that package used moves.

The console's one-time workspace prompt (Setup → Localization's keys, asked once per administrator per workspace) now covers `localization.currency` too. While that key has no value on any rung, code-less amounts show as plain numbers; an administrator who may write the namespace is asked once, with the field pre-filled with the currency of the browser's first preferred language (`zh-CN` → CNY, shown as "人民币（CNY）" in Chinese). Confirm writes it through the Settings page's own `PUT /api/settings/localization`; "Not now" writes nothing. When the timezone is still the default as well, it is one dialog with both fields and one write. A browser language with no country region (`es-419`) offers no currency, and the prompt does not ask about it. No settings key, server-side dismissed flag or gate is added: the prompt keeps its existing per-device record, so an administrator already asked about the timezone is not asked again.

`@object-ui/i18n` gains eight `console.workspaceTimezonePrompt.*` strings in every built-in locale.
