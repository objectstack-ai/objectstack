---
'@objectstack/lint': patch
---

fix(lint): a permission set's field key on a field that an `objectExtensions` entry adds, a sibling package's in the same artifact included, is no longer refused as `security-fls-unknown-field` (#30303)

Clause-②: yes (widening: the FLS-key check accepts extension-added fields)
Metadata-protocol: none

- **Before.** The FLS-key check resolved `object.field` against the object's declared `fields` only. On a multi-package artifact, an app package's permission set naming `crm_contract.o2c_probe_note`, a field its module package adds to `crm_contract` through `objectExtensions`, failed `os build`, `os validate` and `os lint` with "crm_contract declares no field o2c_probe_note", although the runtime serves the field and the key masks it. A single-package stack's own extension fields were refused the same way.
- **Now.** The key resolves against the object as the registry serves it: its declared fields plus every field an `objectExtensions` entry of any body of the artifact adds to it, folded as `@objectstack/objectql` folds them (fields by name; one entry per package per object, a later entry replacing an earlier one; `extend` naming the object verbatim). A field that no body declares or adds keeps the same refusal, with the same rule id, severity and message, and so does a field an entry only patches through `fieldPatches`, which adds no field. The hint's nearest name reads the served fields too.
- **One fold.** The controlled-by-parent merge (#23210), the membership-key column check and the FLS-key check now read extensions through one shared fold in `object-graph.ts`.
