---
"@objectstack/spec": major
"@objectstack/example-showcase": patch
---

feat(spec)!: retire `external.label` and `external.requirePermission` (#4583 batch D)

Two keys on the federation block, both read by nothing.

**`external.label`** — nothing rendered the federation block's own label. Setup →
Datasources renders the datasource's **top-level** `label`, which every datasource already
has, so this was a second display name that never displayed. The showcase example declared
both; it now declares only the one that shows.

**`external.requirePermission`** — no authorization check ever consulted it. A permission
named here gated nothing: access to a federated datasource's data is governed by the
ordinary object permission sets and RLS, exactly as for a managed datasource. Naming a
permission that is never required is the false-compliance shape ADR-0049 exists to remove
— it reads like an access control and is one only in the author's head.

FROM → TO: delete `external.label` (use the top-level `label`); delete
`external.requirePermission` and grant or withhold the object permissions instead.
`os migrate meta --from 16` removes both automatically (conversion
`datasource-inert-blocks-removed`).

With these, the `datasource` liveness ledger reaches **zero dead properties** — down from
the 20 it was seeded with in #4487, the highest dead ratio of any governed type.
