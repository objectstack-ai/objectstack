---
'@objectstack/lint': patch
---

fix(lint): a context pack is warned when it reads an injected column with no storage on an external object

Clause-②: yes (widening)
Metadata-protocol: none

A new advisory rule, `ai-context-field-unprovisioned` (a `warning`), reports a context pack (`ai_context`) that names a system column the platform injects (`owner_id`, `created_at`, `created_by`, …) on an ADR-0015 `external` object. The name resolves, so `ai-context-field-unknown` stays silent, but the remote database owns the table and the platform provisions no column behind it. The rule judges the names in the root's `fields`, `body.field`, and each `related` entry's `fields`, `where`, `orderBy` and link field. Its message names the cost for each position: an empty value on every record, no body, no rows, or an arbitrary order. A column the author declares on the external object is never reported. The provenance answer is the spec's `unprovisionedInjectedColumns`, which every other unprovisioned-anchor rule reads too. `os explain ai-context-field-unprovisioned` states the cause and the remedy, and `os explain ai-context-field-unknown` now says that injected columns count as defined.
