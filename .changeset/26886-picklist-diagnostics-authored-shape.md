---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata-protocol): load-time diagnostics no longer report "`picklist` and `options` cannot both be declared" on a field that declares only `picklist`

Clause-②: no
Metadata-protocol: none

A select field that names a shared list (`picklist: 'industry'`) is served with the list's options written beside `picklist`, and the diagnostics judged that served copy, so every shared-picklist field of every app was reported as declaring both keys: in an item's `_diagnostics`, in the list read's, and in `GET /meta/diagnostics` (Setup › All Metadata Types). They now judge the field as its author wrote it.

- **The rule stands.** A field that authors both `picklist` and `options` is still reported, with the same message and severity, at `fields.NAME.options`.
- **What `/meta` serves is unchanged.** A picklist-bound field is still served with `picklist` and the resolved `options`.
- **How the two are told apart.** The picklist resolution marks the options array it derives; `@objectstack/metadata-protocol` exports `markResolvedPicklistOptions` and `isResolvedPicklistOptions`, and the diagnostics leave a marked array out of the judgement. The mark is not part of any response or stored row.
