---
'@objectstack/spec': patch
---

Field-key guidance, the retired `DriverCapabilities` tombstones, the datasource `readOnly` guidance, the retired filter operators and the legacy `apiMethods` strip warning no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

These are the `@objectstack/spec` texts an author meets at the moment something is refused or rewritten: the unknown-field-key guidance that `os validate` and the lint print, the parse errors for retired `DriverCapabilities` keys, the guidance for `readOnly` written inside a datasource driver's `config`, the `INVALID_FILTER` refusal every driver face prints for `$regex` / `$options`, and the warning `enable.apiMethods` prints when it strips a retired legacy value. They pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- Field-key guidance: `index` and `indexed` say the field-level index flag built no index and was removed under ADR-0049 enforce-or-remove; `dataQuality` and `cached` say their leftover `DataQualityRules` and `ComputedFieldCache` schemas were deleted from the public API too, and that computed-field caching returns only together with a runtime consumer.
- `DriverCapabilities` tombstones: the `bulkCreate` / `bulkUpdate` / `bulkDelete` prescriptions name discovery's `transactionalBatch` bit, derived from the live composition so a client negotiates instead of probing; the `fullTextSearch` prescription says `$contains` itself stays case-sensitive while textual search is case-insensitive.
- Datasource `readOnly` guidance: says a managed datasource has no read-only gate by decision, because a flag only the application checks cannot stop direct connections, migrations or DDL.
- Retired filter operators: the `$regex` and `$options` refusals say they are retired under ADR-0049 enforce-or-remove, refused rather than reinterpreted.
- Legacy `apiMethods` strip warning: the `restore` and `purge` prescriptions say `enable.trash` was retired because no runtime ever read it, and that the recycle-bin (soft-delete) work `restore` would need is parked.

Text only: no key, schema shape, condition, error code or status moves. A tool or test that matches the old text (for example a tracker-number suffix) needs the new spelling.
