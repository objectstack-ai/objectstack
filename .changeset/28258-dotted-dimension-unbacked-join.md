---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: a dataset dimension spelled through a relationship path the dataset does not declare is refused INVALID_FIELD on the native, ObjectQL and draft-preview faces

Clause-②: no (narrowing) — a `queryDataset` selection naming a dimension through a relationship path the dataset's `include` does not declare is now refused `INVALID_FIELD` / 400 on all three faces. The draft preview served it as one `null` group and the ObjectQL strategy served a real lookup by joining it anyway; both now refuse. The native strategy refused it `DATASET_INVALID` / 400 and now answers `INVALID_FIELD` / 400 for this case only. Nothing is widened: no export, answer member, error code or status is added; both codes were already on the wire.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a selection that names an undeclared relationship path is refused on the faces that served it, and the native face's refusal takes the member-level code the other dimension gates answer. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on `queryDataset` (`@objectstack/service-analytics`), and a code change on one native refusal.

- **Before.** A selected dimension spelled through a relationship the dataset does not include (`OBJECT.bogus`, or a real lookup such as `account.name` with no `include: ['account']`) got three answers: the native strategy refused `DATASET_INVALID` / 400 ("join … is not backed by a declared relationship"), the ObjectQL strategy refused `OBJECT.bogus` `INVALID_FIELD` from the driver and served `account.name` grouped by the related record, and the draft preview (`previewDrafts: true`) served one `null` group with the whole total.
- **Now.** The service asks one gate on every strategy and on the preview, after the object, body, internal-field and field-level verdicts: the member is refused `INVALID_FIELD` / 400 with one message naming it, the first undeclared path hop by hop (`account.owner` when only `account` is included), the declared paths and the valid dimensions. The error carries `member`, `param: 'dimensions'` and `cube`.
- **Unchanged.** A dimension through a declared path, and a dotted spelling that resolves to a declared dimension (`CUBE.region`, `OBJECT.region`), serve as before. An undeclared plain dimension keeps its own refusal. A path through an object the caller may not read keeps its 403. A `runtimeFilter` member through an undeclared path, and a hand-authored cube's configured allowlist, still reach the native strategy's `DATASET_INVALID`.
- **Who sees it.** A widget or caller grouping by a related field the dataset forgot to include: every face now gives the refusal, instead of a blank group in the draft, a served chart on an ObjectQL driver, and `DATASET_INVALID` on a SQL driver.

**The remedy.** Add the relationship to the dataset's `include`, or group by a dimension the dataset declares.
