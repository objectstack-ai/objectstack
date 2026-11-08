---
'@objectstack/spec': patch
'@objectstack/service-settings': patch
'@object-ui/console': patch
---

feat: a settings `map` specifier's column headers can be translated, and Data Lifecycle's three map tables ship translated headers

Clause-②: yes (widening)
Metadata-protocol: none

- `PlatformTranslationDataSchema` (`@objectstack/spec/system`): the platform bundle's `settings.<namespace>.keys.<key>` entry gains two optional groups, spelled as the `map` specifier spells its headers. `keyColumn` translates the key column and `columns.<name>` each value column, keyed by the column's `name`. Each carries `label` (the header) and `help` (the column's `description`, shown as the header's hover text), and is strict like its siblings: an undeclared leaf is refused, with `description` → `help` and `title` → `label` named, and `headers` / `columnLabels` → `columns`, `keyHeader` → `keyColumn` named on the setting entry. A bundle written before this change parses exactly as it did. `settings` stays platform-only, so no application bundle can write these groups.
- `@objectstack/service-settings`: every shipped non-English bundle (zh-CN, zh-Hant, ja-JP, ko, es-ES, pt-BR, fr, de, ru, ar) translates the five headers of `lifecycle.retention_overrides`, `lifecycle.quotas` and `lifecycle.quota_defaults` (`Object`, `Keep rows for`, `Expire rows after`, `Max rows`, `Lifecycle class`). The settings translation coverage test now holds each `map` header to the same per-locale coverage as the setting's label, and refuses header copy for a setting that is not a map or a column the map does not declare.
- `@object-ui/console`: the Settings page's map table reads the two groups. A header with no translation keeps the manifest's text, as every other settings string does. The key column now shows its declared `description` as hover text, as the value columns already did.
- Stored values, the save door and the manifest shape do not change.
