---
'@objectstack/spec': patch
---

The `DashboardWidgetOptionsSchema` doc comment no longer says that a misspelled widget `options` key is an author-time type error. The bag ends in `.passthrough()`, so a misspelled key such as `sortDirection` or `granularity` compiles and parses like any other extra key, and it changes nothing at render time. A wrong value for a declared key, such as `sortOrder: 'sideways'`, is the type error and the parse error. `os validate`, `os build` and `os lint` name the misspelled key with the `unconsumed-widget-option` warning, which does not fail any of the three commands. Only the comment changed. The schema's shape is the same.

Clause-②: no
