---
'@objectstack/lint': minor
---

**BREAKING** fix(lint)!: a page variable `source` naming no component on the page, and a page predicate reading a `page.NAME` the page does not declare, are refused

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no file under `skills/**` teaches a page variable's `source` binding or `page.NAME` reads; both refusals carry their own fix and `os explain` entries.

<!-- adr-0087: not-required (no-migration-prescription) The narrowing is a refusal at the authoring doors (the metadata save door, a draft's diagnostics and its publish, and os validate / os build / os lint) of two references that never resolved at runtime: a page variable `source` that names no component id on the page (the console binds the writer by exact id, so nothing ever writes the variable), and a page component `visibleWhen` reading `page.NAME` for a `NAME` the page's `variables` does not declare (the read faults and the element renders unconditionally). No metadata key, accepted key, export or error code is removed or renamed, and no stored shape changes. The fix is the author's choice of the component id or variable name they meant, so there is no mechanical conversion for `objectstack migrate meta` to apply; the shipped corpus (examples, platform packages) carries 3 variable `source` bindings and 5 `page.NAME` predicate reads (all on two showcase pages), none of them refused. -->

#28663 judged a page's `variables` list itself. Two references into that list still saved, read `valid: true` as drafts, published and passed `os validate`, though neither can ever resolve:

- `page-variable-source-unknown` (in `validatePageVariables`): a variable whose `source` names a component `id` the page does not hold. The console binds a writer element by comparing its `id` with `source` exactly, so no element writes the variable and it keeps its default for the page's whole life. Components nested inside containers count; a page authored as code (`kind: 'react'` or `'html'`) is not judged, since its components live in the code. Located at `variables[i].source`.
- `visibility-page-variable-undeclared` (in `validateVisibilityPredicates`): a page component `visibleWhen` reading `page.NAME` (or `page.?NAME`) where the page declares no variable `NAME`. `page` holds the page's declared variables and nothing else, so the read faults and the element always renders. Judged from the predicate's existing parse; an index read (`page['x']`) and a predicate whose comprehension binds `page` as its loop variable are not judged. Located at the component.

**Where.** The metadata save door (`PUT /api/v1/meta/page/:name`, Studio, MCP), a draft's `_diagnostics`, the publish (`422 INVALID_METADATA`), and `os validate` / `os build` / `os lint`. Stored pages keep loading and serving; only the next save of one with a finding is refused, with the fix.
