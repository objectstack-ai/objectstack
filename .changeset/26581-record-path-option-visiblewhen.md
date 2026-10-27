---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): `record:path` leaves out a stage the record's status option rules out, instead of ticking it

Clause-②: no
Metadata-protocol: none
Ruling-ref: #26581 ruling `6442747364` letter A, with its guardrail

A path ticked every stage before the current one by position, so a stage the record could never have stood on read as passed: an order contract that skips legal review by type showed 「审查中 ✓」 after approval. The status field's option already says which records it applies to. Its `visibleWhen` means "offered only when TRUE (else omitted)", and the server refuses a write of a value whose predicate is false. So `record:path` now omits, on both the desktop and the mobile row, any stage whose matching option declares a `visibleWhen` that is FALSE for the record.

- Stages match options by value, so authored `stages[]` are filtered the same way as stages derived from the picklist.
- A predicate that reads the acting user (`current_user`, `user`, `ctx` or `os`) hides nothing. It says who may pick the value, not which route the record takes.
- A predicate that cannot be evaluated keeps its stage, as an option list keeps an option (render side fail-open, ADR-0137 D3).
- The stage the record stands on is always drawn.

No new key and no new read: the predicate is evaluated against the record and object definition the record page already holds.
