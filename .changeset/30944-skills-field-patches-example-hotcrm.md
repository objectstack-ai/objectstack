---
'@objectstack/skills': patch
---

docs(skills): the `fieldPatches` example relabels HotCRM's `industry` and patches options only on a field that declares its own

Clause-②: no
Metadata-protocol: none

The `objectstack-data` skill's one `fieldPatches` example patched an option of `crm_account.industry`. HotCRM binds that field to the shared `industry` picklist, so a verbatim copy was refused at install and by `os validate` (`picklist-option`). The example now sets `industry`'s `label` only and patches an option of `type`, which declares its own `options` (`customer` → `Client`). The added bytes are paid by deleting a restatement in the same file: the `.custom` paragraph's closing clause "a base field changes only through `fieldPatches`", whose facts the relabel paragraph above it already states. No token ceiling moves. No schema, key or behaviour changes.
