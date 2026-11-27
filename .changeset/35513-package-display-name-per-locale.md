---
'@objectstack/spec': minor
'@object-ui/i18n': minor
'@object-ui/app-shell': minor
---

feat(spec): a package's display name per locale — the translation bundle's `packages` group, read by Setup's package list and Studio's package switcher

Clause-②: yes (widening) — the translation bundle (`TranslationDataSchema`, `PlatformTranslationDataSchema`, `ServedTranslationDataSchema`, `TranslationItemSchema`) accepts a new group `packages`, keyed by `manifest.id`, each row `{ name?, description? }`; a bundle that wrote `packages` was refused as an unknown key before. `@object-ui/i18n` `useObjectLabel()` gains `packageName` and `packageDescription`.
Metadata-protocol: added — a new translation group `packages.MANIFEST_ID.name` / `.description`
Skills-docs: follow-up owed — skills/objectstack-i18n/SKILL.md

A package had one name, the plain-string `manifest.name`, so a zh-CN administrator read every package in Setup's package list, and every package with no app of its own in Studio's package switcher, in English, beside a launcher that already named the same apps in Chinese.

A package now names itself per locale in the translation bundle it already ships:

```ts
export const zhCN: TranslationData = {
  packages: { 'com.acme.reporting': { name: '报表', description: '经营报表' } },
};
```

- The key is the package's `manifest.id`. A key that is not a manifest id — a namespace like `crm`, or a display name — is refused at parse, naming the rule, because a row keyed by one would never render. `package`, and the leaf spellings `label`, `title` and `displayName`, are answered with the declared spelling.
- The console draws the translated name where a reader sees a package — Setup's package list (row, detail title, description, search, the installed-apps group) and Studio's package switcher for a package that ships no app — and falls back to `manifest.name`. A package that publishes an app is still named by the app's label in the switcher.
- `manifest.name` stays exactly as authored on every wire and in every editor: the translation is a display overlay, so the edit dialog that prefills from the listed manifest never saves a translated name back.
- A disabled package keeps its translated name: its bundle is loaded at boot whether or not the package is enabled.

`MANIFEST_ID_PATTERN` is now declared in `kernel/address-grammar.ts` beside `NAMESPACE_PATTERN`; `kernel/manifest.zod.ts` re-exports it, so every existing import keeps working.
