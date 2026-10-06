---
'@objectstack/metadata-protocol': minor
---

A metadata publish promotes only the draft its gate judged

Clause-②: yes (widening)

- A publish (`publishMetaItem`, and each promotion of `publishPackageDrafts`) reads the draft to judge it and then promotes the draft row. The promotion is now handed the judged draft's hash. A draft saved after the judgement, or a draft that appears where the judgement found none, is refused with `409 METADATA_CONFLICT`, and nothing is published. Publishing again judges and promotes the current draft.
- `SysMetadataRepository.promoteDraft` takes a new optional `expectedDraftHash` (`string | null`). When it is stated, the draft row the promotion reads must carry that hash (with `null`, no draft row may exist); otherwise the promotion throws a `ConflictError` before anything is written. When it is omitted, the promotion behaves as before.
