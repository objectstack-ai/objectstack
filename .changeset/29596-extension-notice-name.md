---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a stored `object_extension` conversion notice names the extension's target, one notice per row

Clause-②: no

Metadata-protocol: none

When a stored row carries a pre-protocol shape, the protocol's read seams print `[Protocol] stored TYPE/NAME carries a pre-protocol shape; …` once per conversion and row. The name was read from the body's `name` key. An `object_extension` body carries `extend` and no `name`, so every stale stored extension was reported as `object_extension/<unnamed>`, and all of them shared one notice: with three stale extensions an operator heard about one, unnamed.

- **Now.** The notice names the item by the identity its type uses, the same one a list read slots it under. An extension is named by its target (`object_extension/crm_account`), and each stale extension row gets its own notice.
- **Unchanged.** Rows convert exactly as before, and the body is not given a `name`. Every other type is still named by its `name`, and a body with none still reads `<unnamed>`. The `[DatabaseLoader]` notice already named each row by its stored row name, which for an extension is its target.
