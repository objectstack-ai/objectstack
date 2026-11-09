---
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

The Console language menu now names the built-in languages from the platform
locale table (`PLATFORM_LOCALES` in `@objectstack/spec/system`): each entry
shows its row's `label`, such as `简体中文`, `繁體中文` and
`Português (Brasil)`. The menu used to keep its own list of names, keyed by
the retired `zh` and `pt` codes, so those three languages were named by the
runtime's `Intl.DisplayNames` instead, which varies by browser and ICU version
and shows the bare code where `Intl.DisplayNames` is missing. A code that is
not on the table, such as an app-shipped `th`, is still named by
`Intl.DisplayNames`. The set of languages the menu offers is unchanged.
