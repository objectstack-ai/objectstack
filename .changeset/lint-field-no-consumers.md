---
"@objectstack/lint": minor
---

New advisory rule `field-no-consumers` (`validateFieldConsumers`): a field declared on an object that nothing in the stack reads or displays is reported as a `warning` by `os validate`, `os build` and `os lint`.

Until now such a field was schema-valid and passed every platform check — the declaration was inert and nothing in the toolchain said so. The rule is object-aware (the same field name on two objects gets two verdicts, resolved against the object whose declaration encloses each reference), and it distinguishes consumers from carriers: a view column, form section, page binding, flow node, dataset dimension, widget filter, formula, validation, hook or action is a consumer; a translation label, a seed value, an import-mapping column, a field-level permission grant or a flow that only writes the field is a carrier and never counts. The finding carries the verdict (`carrier-only` with the carrier paths a removal must clean, or `inert`), the roots scanned, and — when the name is also declared elsewhere — the other objects, so a per-object verdict is never mistaken for a name-level one.

Exempt, each derived from the spec rather than listed by hand: the registry-injected system columns an author re-declared, the record's title field (ADR-0079 `nameField` ladder), and `master_detail` fields (ADR-0035 — cascade delete, `controlled_by_parent` sharing and roll-ups read the relationship by declaration). A stack that declares no consumer root at all (objects only, or objects plus carriers) is not judged: its consumers live in another package. Test fixtures are never scanned.

Public surface: `validateFieldConsumers`, `FIELD_NO_CONSUMERS`, `FIELD_CONSUMER_ROOTS`, `FIELD_CARRIER_ROOTS`, and the `FieldConsumerFinding` / `FieldConsumerVerdict` / `FieldConsumerSeverity` types.
