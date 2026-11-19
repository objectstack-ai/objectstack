---
'@objectstack/objectql': minor
---

fix(objectql): an `object_extension` whose record-mode amount names a sibling `currencyField` the served object does not hold is refused at the save, not at every write

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-data/rules/field-types.md` already says a record-mode amount's code lives in the `text` field `currencyField` names, declaring `valueDomain: 'iso_4217_currency'`, with no carve-out for an extension; the refusal now makes that true for an extension's amount, and its text carries the prescription

<!-- adr-0087: registered record-currency-sibling-extension-judged-as-served -->

**BREAKING** accept-set narrowing, shipped as `minor`. An object body whose record-mode amount names a one-segment `currencyField` it does not declare, or a field holding no ISO 4217 code, is refused `422 INVALID_METADATA` at parse. An extension's amount cannot be judged there, because its pointer may name a field only the owner declares, and the record-currency follow door judged an extension only on the two-segment `MASTER_DETAIL.CODE` path. So `PUT /api/v1/meta/object_extension/showcase_invoice` adding `fee: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'zz_missing' } }` answered 200 and was served, and every later write of `fee` was refused `ERR_CURRENCY_CODE_REQUIRED`, prescribing a write into `zz_missing`, which does not exist.

- **The verdict.** The follow door (`SchemaRegistry.objectRegistrationRefusal` with `againstRegistry`, and the end of an install, upgrade or reload on a running server) now judges a one-segment pointer against the object AS SERVED: its base, every enabled extension, and the incoming body. A pointer naming no other field, or a field that is not a `text` field declaring `valueDomain: 'iso_4217_currency'`, is refused `422 INVALID_METADATA` (`RecordCurrencyFollowRefusedError`), naming the amount, the pointer and the object's code-field candidates; nothing is stored.
- **Admitted as before.** A pointer naming a code field the owner declares, the same extension adds, or another enabled extension adds.
- **The owner's end.** An owner re-registering without the code field an extension's amount names is refused, naming the package that adds the amount.
- **Runs and single saves.** An install, upgrade or reload that leaves such a pointer as it found it is not refused over it. A published single save and the batch writers judge with the slot left empty: re-publishing an unchanged extension whose pointer a cold boot admitted is refused, and so is a published save of the owner while an extension's amount names no code field. Correct that extension's pointer (or uninstall it), then save the owner again unchanged.
- **Not asked.** The cold boot: packages installed before this release keep loading.

One-line fix: point the amount's `currencyField` at the extended object's ISO 4217 code field (the refusal lists the candidates), or add one in the same extension and name it.
