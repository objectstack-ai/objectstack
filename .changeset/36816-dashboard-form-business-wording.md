---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

Clause-②: no
Metadata-protocol: none

The dashboard settings panel's hints now read in business terms. Nine field hints of the dashboard authoring form (Name, Label, Columns, Gap, Refresh Interval Seconds, Header, Widgets, Date Range, Global Filters) no longer use developer vocabulary such as "snake_case", "in steps of 0.25rem (4 = 1rem)" or "config". Each one now says what the builder decides. The Columns and Gap hints also describe what an empty value does, in line with the dashboard renderer.

Only hint text moved. No key, accepted value, label or section title changed, and nothing an author can write or validate is different. The platform metadata-form bundles are regenerated, and the nine hints are re-translated in all ten translated locales (zh-CN, zh-Hant, ja-JP, ko, es-ES, fr, de, pt-BR, ru, ar).
