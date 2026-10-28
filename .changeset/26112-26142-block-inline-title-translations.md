---
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(spec): a joined report's block headings and a master-detail field's inline grid heading are translatable

Clause-②: yes
Metadata-protocol: added

Two authored, user-visible labels had no translation slot, so a zh-CN user read them in the authoring language and `os i18n check` could not see the gap:

- **A joined report's blocks.** The `reports` translation group declares `blocks`, keyed by the block's `name`: `reports.<report>.blocks.<block>.label` / `.description`. `translateReport` overlays them on each block of the served report (`GET /meta/report`), which is what the joined renderer draws above each block.
- **A field's `inlineTitle`.** `FieldTranslationSchema` declares `inlineTitle`: `objects.<child>.fields.<field>.inlineTitle`, on the child object whose master-detail (or lookup) field declares the heading. `translateObject` overlays it on the served child object (`GET /meta/object`), which is what the console copies onto the parent's form as the inline grid's heading.

Both follow the packaged-base rule (ADR-0029 D9.2a): a string an org re-authored on top of the packaged declaration keeps its text. An authored `inlineTitle` with no entry keeps its authored text; the child object's plural label is never substituted for it.

`os i18n extract` scaffolds both keys and `os i18n check` counts them: a block's `label` / `description` under the report bucket, `inlineTitle` under the field bucket. A block without a `label`, or a field without an `inlineTitle`, is recorded without being demanded.
