---
"@object-ui/console": patch
"@object-ui/app-shell": patch
"@object-ui/i18n": patch
---

Clause-②: no
Metadata-protocol: none

fix(console, app-shell): four routed console pages and the Studio datasource page speak the session's language instead of hard-coded English (objectui#13460).

- Developer → API Console, Developer → Public Forms, Developer → Integrations & APIs and System → AI Approvals read their copy from new `console.developer.apiConsole.*`, `console.developer.publicForms.*`, `console.developer.integrations.*` and `console.system.aiApprovals.*` keys, translated in all ten locale packs. Sentences with an inline bold action or `<code>` key are one translated string each, so every language places the element itself.
- Setup → Datasources reads its copy from new `engine.datasource.*` rows in the Studio table (en-US and zh-CN, the `engine.*` carve-out). The driver config form's enum option values are unchanged.
- English renders exactly as before, with or without an i18n provider. Code samples, verbs, paths, example slugs and server messages stay as written.
