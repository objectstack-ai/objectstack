---
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

docs: the default-record-page remedies name the other package's page, not the whole package

Clause-②: no

A second `isDefault: true` record page for one object is refused with `DEFAULT_RECORD_PAGE_CONFLICT`. The package registry's refusal already told the author to keep one default or "compose the deployment without the other package's page". Three sibling texts still told them to drop the whole package, though a deployment can keep a package and leave out the one page it ships:

- `@objectstack/metadata-protocol`: the metadata save door's refusal now reads "a page a package ships stays the default unless the deployment is composed without that package's page." Only the remedy clause changed; `code`, `status`, `object` and `holders` are unchanged.
- `@objectstack/spec`: `PageSchema.isDefault`'s TSDoc and the error-code ledger's comment on `DEFAULT_RECORD_PAGE_CONFLICT` say the same.
- `@objectstack/runtime`: `AppPlugin`'s private `bundle` field now documents the three readers outside the class that read it structurally, so a rename is not made blind.

No behaviour changes; nothing to migrate.
