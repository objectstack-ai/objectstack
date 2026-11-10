---
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

fix(objectql)!: a single-object save is refused when a record-mode amount follows no code field on its parent, or a `record` roll-up reads an amount that follows nothing

Clause-②: yes (narrowing) — a single-object save, after the cold boot, of a record-mode amount whose `currencyField` path `PARENT_FIELD.CODE_FIELD` names no ISO 4217 code field on the `master_detail` parent (or of a parent without the code field a registered child follows), and of a `summary` declaring `currencyMode: 'record'` over a child amount that follows no record, was admitted and is now refused `INVALID_METADATA` / 422.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The refusal is the registry's existing INVALID_METADATA for a body it refuses, judged only at a registration after the cold boot, so a stored row boots exactly as before and there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the engine registry (`SchemaRegistry.registerObject`, `@objectstack/objectql`), the door a single-object save reaches.

`defineStack` already refused both shapes when a stack declares both objects. A save of one object, with the other end already registered, did not: a child amount following `invoice.currency` (no such field on `invoice`) or `invoice.title` (a field that holds no code) was admitted, and every write of the amount was then refused `ERR_CURRENCY_CODE_REQUIRED` at data entry or labelled with whatever the field held. A `summary` declaring `currencyMode: 'record'` over a `fixed` or plain-number child field was admitted, and showed the total in the parent's currency though no child amount was in it.

Now, once the server has finished booting, each is refused `INVALID_METADATA` / 422 (`RecordCurrencyFollowRefusedError`), whichever object is saved second, with the message `defineStack` prints: the two messages and the code-field predicate are one module of `@objectstack/spec/data` (`isRecordCurrencyCodeField`, `recordCurrencyFollowedCodeError`, `recordCurrencyRecordRollupError`, `recordCurrencyUnfollowedRollupError`), read by both doors. A parent saved without the code field a registered child follows is refused the same way. A code field the parent gets from a registered `objectExtensions` entry counts.

What an author does: name a code field of the parent in the path's second segment (a `text` field declaring `valueDomain: 'iso_4217_currency'`; the message lists the candidates), and declare `currencyMode: 'record'` on a roll-up only when its child amounts follow the parent through the `master_detail` it rolls up (else delete `currencyConfig`, or declare `fixed`).

What does not change: the boot registers every stored or packaged object it registered before, a `record` roll-up over a child amount in its own record currency stays D6's refusal (`RecordCurrencySummaryRefusedError`), and the stack check's findings and words are unchanged.
