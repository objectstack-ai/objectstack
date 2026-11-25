---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell)!: Home no longer offers 「Build with AI」 or 「Build an app」

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) the removed operands are two Home entry points, one welcome sentence and three translation keys of the console's own language packs; no packages/spec schema, registered node type, stored row or ADR-0087 conversion surface names them, and no key, value or default a metadata author can write changes, so there is nothing for objectstack migrate meta to rewrite -->

**BREAKING** for a deployment that overrides one of the removed translation keys below: the override no longer applies, because nothing reads the key any more.

The home page shows on a phone, and on a desktop as the 「No applications yet」 screen when you have no app. On it:

- **「Build with AI」** is gone: the button shown beside the greeting, and in the phone's 「No applications yet」 welcome, when the build agent is deployed.
- **「Build an app」** is gone: the chip beside the greeting that opened Studio when the build agent is deployed.
- **The phone welcome makes no AI-building promise any more.** On a phone with no app yet, an administrator on a deployment with the build agent was welcomed with 「Build your business system with AI」 and "Describe your business in one sentence — AI generates …". That welcome now reads 「No applications yet」 with the description other deployments show: set up your first application from the Administration menu, plus the AI-assistant sentence where an ask agent is deployed. Deployments without the build agent keep their welcome unchanged.

Everything else stays. 「Start with a template」 is still there, and so is 「New blank app」 where it showed before. 「Ask AI」 shows exactly where it did before.

Nothing to do on upgrade, unless your deployment overrides one of the keys below.

## Removed translation keys

Removed from every language pack of `@object-ui/i18n` (ar, de, en, es, fr, ja, ko, pt-BR, ru, zh-Hans, zh-Hant). Each shipped in 18.6.0.

- `home.build.title` (en: "Build an app")
- `home.buildWithAI` (en: "Build with AI")
- `home.welcomeAdminDescription` (en: "Describe your business in one sentence — AI generates the objects, screens, APIs and agent tools. Or set things up yourself from the menu on the left.")
