---
'@objectstack/spec': minor
'@objectstack/runtime': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(i18n): `GET /i18n/locales` names the source locale, and a design-mode menu rename outside it is stored as that language's translation

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-i18n/SKILL.md

- **`GET /api/v1/i18n/locales` names the source locale.** The body gains an optional `sourceLocale` (`GetLocalesResponseSchema.sourceLocale`): the language the app's own text, a plain-string `label`, is written in. It is the declared `i18n.sourceLocale`, else the default locale, the same rule the metadata translators use. It differs from the `isDefault` locale on an app written in one language that defaults its users to another. It is absent only when the server knows neither. Nothing that parsed before stops parsing.
- **A menu rename in design mode is stored where the reader's language reads it.** The name field of 「Rename and icon」 is now open in every language. A name typed in the source language, over an entry shown by its stored label, is still written to the stored label. Any other name is written as that language's translation of the entry: a name typed in another language, or one typed in the source language over a translation the reader was shown. The stored label stays unchanged, so every other language keeps its name. The rename says so when the new name will be a translation ("The new name is shown in LANGUAGE. The app's other languages keep their names.").
- **Where the translation goes.** It is written to the `translation` item `APP_menu_LOCALE` (for example `crm_menu_zh_cn`), at `apps.APP.navigation.ID.label`, the key app navigation is translated by. It goes into the package the menu is written to: the app's own package when that is writable, else its customization package, whose own translations are read first (ADR-0146 D2). Like the menu, it is saved as a draft with the first-write pin and published at once. A pending draft of it is refused and the reason is shown. A translation-only rename writes the translation and leaves the app alone.
- **A link added in another language** is stored without a name, and the name typed for it becomes that language's translation. The source language names it when someone sets a name there. Until then, a reader in the source language sees the link's URL, as for any link with no label.
- Before this change, the console allowed a rename only when the reader was in the deployment's default language. The default language could differ from the source language, and a rename there was written to the stored label for every language.
