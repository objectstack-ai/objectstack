---
'@objectstack/spec': minor
'@objectstack/service-settings': patch
---

feat: a settings toggle can declare the question asked before it is turned off (`confirmOffText`), and Setup's email and password sign-in toggle declares one

Clause-②: yes (widening)
Metadata-protocol: added

- `SpecifierSchema` (`@objectstack/spec/system`) gains an optional `confirmOffText: I18nLabel`: the confirm dialog text shown before a toggle's value changes to off. Omitted, nothing is asked, so every existing manifest reads as before. The name mirrors the `confirmText` an `action_button` handler already declares.
- Only a `toggle` may declare it. On any other specifier type the parse refuses it at `confirmOffText`, naming the type, because nothing would ever ask the question there.
- The platform translation bundle carries it at the toggle's own address, beside its label: `settings.<namespace>.keys.<key>.confirmOffText`.
- `@objectstack/service-settings`: the `auth` manifest's `email_password_enabled` toggle declares "People who sign in with a password will need another way in.", with zh-CN, ja-JP and es-ES text in the shipped bundles. The settings translation coverage test now holds a declared `confirmOffText` to the same per-locale coverage as the toggle's label.
- The console asking the question before save is a separate change; until it lands, the key is declared and parsed but not yet shown.
