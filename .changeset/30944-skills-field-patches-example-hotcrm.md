---
'@objectstack/skills': patch
---

docs(skills): the `fieldPatches` example relabels HotCRM's `industry` and patches options only on a field that declares its own

Clause-②: no
Metadata-protocol: none

The `objectstack-data` skill's one `fieldPatches` example patched an option of `crm_account.industry`. HotCRM binds that field to the shared `industry` picklist, so a verbatim copy was refused at install and by `os validate` (`picklist-option`). The example now sets `industry`'s `label` only and patches an option of `type`, which declares its own `options` (`customer` → `Client`); the sentence before it names `industry` as the picklist-bound field whose options no patch reaches. No schema, key or behaviour changes.
