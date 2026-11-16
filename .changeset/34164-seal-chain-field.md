---
'@objectstack/spec': minor
'@objectstack/plugin-audit': minor
---

feat(spec, plugin-audit): a sealed object names its chain column with `lifecycle.seal.chainField`

Clause-②: yes (widening). A sealed object may name its chain column, the default stays `tenant_id`, and an object that seals today is byte-identical.
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-data/rules/lifecycle.md, skills/objectstack-data/evals/objects-fields-relationships.json

An audit-class object that declares `lifecycle.seal` was sealed only when it had a `tenant_id` column, because the sealer read each row's organization from that column alone. An object whose organization lives in the tenant column the platform injects, `organization_id`, was reported at `error` every hour and never sealed.

- **The key.** `lifecycle.seal.chainField` names the column whose value is the organization chain a sealed row joins, for example `seal: { valueFields: ['payload'], chainField: 'organization_id' }`. It is optional. An object that names none chains by `tenant_id`, as before.
- **Refused at authoring.** A named column the object does not have is refused at `lifecycle.seal.chainField`, with the reason. Declared fields count, and so do the columns the platform injects: `organization_id` counts unless the object opts out of the tenant column (`systemFields: false`, `systemFields.tenant: false`, `tenancy.enabled: false`).
- **One reader.** The sealer, `os audit verify`'s live check and the proof bundle it writes read a row's chain value through one function. `os audit verify --org X` reports the rows of organization `X` whichever column holds it.
- **Bytes unchanged.** The checkpoint's signed `tenant_id` member keeps its name and carries the chain column's value. For an object chained by `tenant_id`, the leaf input, the signed body and the root are byte for byte what they were.
- **Still reported, not refused.** Authoring refuses only a `chainField` the object names and does not have. An object that names no chain column and has no `tenant_id` still parses: the sealer reports it at `error` and does not seal it, as before. It does the same for a definition that reached the registry without the parse and names a column it lacks, and for an object chained by `organization_id` that its deployment declares platform-global, which withholds that column. Refusing the default case at authoring is a narrowing, and #34352 carries it.

ADR-0154 gains a note recording the key under D10, and how D5's "its `tenant_id` names" reads with it.
