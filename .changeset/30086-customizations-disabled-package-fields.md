---
'@objectstack/spec': patch
---

docs(spec): the `contributions` array of `GetPackageCustomizationsResponseSchema` says a disabled package's fields are not listed

Clause-②: no
Metadata-protocol: none

The `.describe()` of the `contributions` array that `GET /api/v1/packages/:id/customizations` answers already left out a disabled package's flows and navigation items, but its field clause still read as listing the fields of every object extension from any package but the base and its pair. The server has not listed a disabled package's extension fields since the served object's fold began withholding them; the field clause now says so, in the same parenthetical form as the flow and navigation clauses. Text only: no key, shape, default or export changes, and the reference page `content/docs/references/api/package-lifecycle.mdx` is regenerated from it.
