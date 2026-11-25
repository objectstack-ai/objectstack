---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell)!: Home no longer offers 「Build with AI」 or 「Build an app」

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) the removed operands are two Home entry points and one translation key of the console's own language packs; no packages/spec schema, registered node type, stored row or ADR-0087 conversion surface names them, and no key, value or default a metadata author can write changes, so there is nothing for objectstack migrate meta to rewrite -->

**BREAKING** for a deployment that overrides the removed translation key below: the override no longer applies, because nothing reads the key any more.

The home page shows on a phone, and on a desktop as the 「No applications yet」 screen when you have no app. Two of its entries are gone from both:

- **「Build with AI」**, the button shown when the build agent is deployed. It is also gone from the buttons of the 「No applications yet」 screen. The sidebar's 「Add app」 menu still offers it.
- **「Build an app」**, the chip beside the greeting that opened Studio when the build agent is deployed.

Everything else stays. 「Start with a template」 is still there, and on the 「No applications yet」 screen it is now the first button. 「New in Studio」 still shows where the build agent is not deployed. 「Ask AI」 shows exactly where it did before.

Nothing to do on upgrade, unless your deployment overrides the key below.

## Removed translation keys

Removed from every language pack of `@object-ui/i18n` (ar, de, en, es, fr, ja, ko, pt-BR, ru, zh-Hans, zh-Hant). It shipped in 18.6.0.

- `home.build.title` (en: "Build an app")
