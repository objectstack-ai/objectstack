---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(objectql)!: a single-object save or publish is refused when a record-mode amount follows no code field on its parent, or a `record` roll-up reads an amount that follows nothing

Clause-②: yes (narrowing) — after the cold boot, a published single-object save through `PUT /meta/object/:name` or the runtime `/meta` dispatcher, and a per-item publish (`POST /meta/object/:name/publish`), of a record-mode amount whose `currencyField` path `PARENT_FIELD.CODE_FIELD` names no ISO 4217 code field on the `master_detail` parent (or of a parent without the code field a registered child follows), of a `summary` declaring `currencyMode: 'record'` over a child amount that follows no record, or of an ADR-0144 D6 roll-up over a child amount in its own record currency, was answered `200` / `published` and is now refused `INVALID_METADATA` / 422 with nothing stored or promoted; nothing else moves for the follow pair.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The refusal is the registry's existing INVALID_METADATA for a body it refuses, judged only at a single save or publish after the cold boot, so a stored row boots exactly as before and there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the metadata save and per-item publish doors' registry pre-flight (`saveMetaItem`, `publishMetaItem`, `@objectstack/metadata-protocol`; the question is `SchemaRegistry.objectRegistrationRefusal`'s `againstRegistry`, `@objectstack/objectql`).

`defineStack` already refused both shapes when a stack declares both objects. A save of one object, with the other end already registered, did not: a child amount following `invoice.currency` (no such field on `invoice`) or `invoice.title` (a field that holds no code) was admitted, and every write of the amount was then refused `ERR_CURRENCY_CODE_REQUIRED` at data entry or labelled with whatever the field held. A `summary` declaring `currencyMode: 'record'` over a `fixed` or plain-number child field was admitted, and showed the total in the parent's currency though no child amount was in it.

Now, once the server has finished booting, each is refused `INVALID_METADATA` / 422 (`RecordCurrencyFollowRefusedError`), whichever object is saved second, with the message `defineStack` prints: the two messages and the code-field predicate are one module of `@objectstack/spec/data` (`isRecordCurrencyCodeField`, `recordCurrencyFollowedCodeError`, `recordCurrencyRecordRollupError`, `recordCurrencyUnfollowedRollupError`), read by both doors. A parent saved without the code field a registered child follows is refused the same way. A code field the parent gets from a registered `objectExtensions` entry of an enabled package counts.

Where the refusal is heard: only at a door that makes one body live and answers its author. A published save through `PUT /meta/object/:name` (`meta-envelope`) or the runtime `/meta` dispatcher (`meta-dispatch`), and the per-item publish `POST /meta/object/:name/publish`, ask the registry with `againstRegistry` before anything is stored or promoted, so this door and D6's answer `422` there. Before, that pre-flight judged the body alone: a save stored the row and answered `200`, a publish promoted the draft and answered `published`, and the registration refusal was only logged, leaving the object unregistered (new) or with its old definition (re-saved). D6's roll-up over a child amount in its own record currency is therefore also refused at those doors now, where it was stored and logged. The faces and doors are enumerated in `registry-question.ts` (`@objectstack/metadata-protocol`), with a pin over every `saveMetaItem` and `promoteDraftForPublish` call.

What does not move for the follow pair: `registerObject` itself never asks the follow door, so the boot, hydration, `registerApp` (install and reload, whose `objectExtensions` register after its `objects`), a draft save, the batch writers (package duplicate, unmanaged import, external import, the stored-object migration passes) and a package publish (`publishPackageDrafts`) register it exactly as before. D6's door is unchanged at those paths (refused at registration, logged where the caller only logs; #32369 tracks relaying those).

What an author does: name a code field of the parent in the path's second segment (a `text` field declaring `valueDomain: 'iso_4217_currency'`; the message lists the candidates), and declare `currencyMode: 'record'` on a roll-up only when its child amounts follow the parent through the `master_detail` it rolls up (else delete `currencyConfig`, or declare `fixed`). For a D6 refusal, use `function: 'count'`.

What does not change: the boot registers every stored or packaged object it registered before (the option is honoured only after `kernel:bootstrapped`), and the stack check's findings and words are unchanged.
