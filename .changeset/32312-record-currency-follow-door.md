---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(objectql)!: a single-object save is refused when a record-mode amount follows no code field on its parent, or a `record` roll-up reads an amount that follows nothing

Clause-②: yes (narrowing) — after the cold boot, a single-object save (`PUT /meta/object`, the runtime `/meta` dispatcher, or a direct registration) of a record-mode amount whose `currencyField` path `PARENT_FIELD.CODE_FIELD` names no ISO 4217 code field on the `master_detail` parent (or of a parent without the code field a registered child follows), of a `summary` declaring `currencyMode: 'record'` over a child amount that follows no record, and, through the `/meta` save door, of an ADR-0144 D6 roll-up over a child amount in its own record currency, was answered `200` and is now refused `INVALID_METADATA` / 422 with nothing stored.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The refusal is the registry's existing INVALID_METADATA for a body it refuses, judged only at a registration or single save after the cold boot, so a stored row boots exactly as before and there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the engine registry (`SchemaRegistry.registerObject`, `@objectstack/objectql`) and at the metadata save door's pre-flight (`saveMetaItem`, `@objectstack/metadata-protocol`).

`defineStack` already refused both shapes when a stack declares both objects. A save of one object, with the other end already registered, did not: a child amount following `invoice.currency` (no such field on `invoice`) or `invoice.title` (a field that holds no code) was admitted, and every write of the amount was then refused `ERR_CURRENCY_CODE_REQUIRED` at data entry or labelled with whatever the field held. A `summary` declaring `currencyMode: 'record'` over a `fixed` or plain-number child field was admitted, and showed the total in the parent's currency though no child amount was in it.

Now, once the server has finished booting, each is refused `INVALID_METADATA` / 422 (`RecordCurrencyFollowRefusedError`), whichever object is saved second, with the message `defineStack` prints: the two messages and the code-field predicate are one module of `@objectstack/spec/data` (`isRecordCurrencyCodeField`, `recordCurrencyFollowedCodeError`, `recordCurrencyRecordRollupError`, `recordCurrencyUnfollowedRollupError`), read by both doors. A parent saved without the code field a registered child follows is refused the same way. A code field the parent gets from a registered `objectExtensions` entry counts.

Where the refusal is heard: by every caller of the registry (`registerObject`, `ObjectQL.registerApp` after boot, the metadata facade's `register`), and by a published single save through the `/meta` doors (`PUT /meta/object/:name`, the runtime `/meta` dispatcher): their pre-flight now asks the registry's doors that read other objects, this one and D6's, so the save answers `422` and stores nothing. Before, that pre-flight judged the body alone: the row was stored, the save answered `200`, and the registration refusal was only logged, leaving the object unregistered (a new object) or as it was (a re-save). D6's roll-up over a child amount in its own record currency is therefore also refused at that save now, where it was stored and logged. A draft save, and the batch writers (package duplicate, unmanaged import, local install of a cloud package, the stored-object migration passes), keep the body-only pre-flight (#29673): a sibling in the same batch can still complete the pair, so there the registration refusal is still logged, not answered.

What an author does: name a code field of the parent in the path's second segment (a `text` field declaring `valueDomain: 'iso_4217_currency'`; the message lists the candidates), and declare `currencyMode: 'record'` on a roll-up only when its child amounts follow the parent through the `master_detail` it rolls up (else delete `currencyConfig`, or declare `fixed`). For a D6 refusal, use `function: 'count'`.

What does not change: the boot registers every stored or packaged object it registered before (the doors are asked only after `kernel:bootstrapped`), and the stack check's findings and words are unchanged.
