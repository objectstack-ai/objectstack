---
'@objectstack/spec': patch
---

docs(spec): the documented `fieldPatches` example keys its option by a value `crm_account.industry` really stores

Clause-②: no
Metadata-protocol: none

The `fieldPatches` description, its TSDoc example and the refusal text for an option list under `options` showed `options: { tech: { label: 'Technology' } }`. `crm_account.industry` stores `technology`, not `tech`, so a copy of that example was refused at `os validate` and at install as naming an option the field does not have. The example now reads `options: { technology: { label: 'Tech' } }`, the same spelling the published skill uses. Prose only: no schema accepts or refuses anything differently.
