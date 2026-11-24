---
'@objectstack/spec': patch
---

docs(spec): the `SharedRecordIds` docblock describes the share arm after the switch — the capped list of granted ids is retired and the share arm carries the leaf (ADR-0155 step 6)

Clause-②: no
Metadata-protocol: none

Comment-only. The module docblock of `@objectstack/spec/data`'s `SharedRecordIds` no longer says the share arm binds a list of at most 5,000 granted ids today, nor that nothing writes the leaf yet: plugin-sharing's read and write scopes carry the leaf, which is the whole grant set at every count. No schema, export or runtime behaviour changes.
