---
"@objectstack/platform-objects": minor
"@objectstack/spec": minor
---

feat(platform-objects): declare `sys_metadata_activation`, the packaged-metadata activation ledger (#12155)

Additive platform surface implementing **ADR-0126 §4 (D2)**: the disable+clone
family gets **one** data-plane platform object, declared beside its siblings so
it needs **zero `packages/spec` schema or contract surface** — it is an ordinary
platform object, not a metadata type. (The one spec file touched is the
mechanical name census described below, not protocol surface.)

The whole schema, per §4: `metadata_type` · `name` · `package_id` ·
`organization_id` (nullable, **reserved** — NULL on this entire line; the
per-org dimension is an additive column later, never a redesign) · `active`.
An earlier ADR draft carried designation columns (`replaced_by`, `cloned_from`);
amendment ruling 2 removed them — there is **no recorded linkage** between a
clone and its base, matching the landed #11513 posture ("an ordinary org-owned
set with no upgrade linkage"). The pin test asserts the column set by EQUALITY
and names both removed columns separately, so re-growing the linkage is loud.

Row identity is `(metadata_type, name, organization_id NULL-collapsed)`, spelled
as a declared index with **`unique: 'organization'`** (ADR-0120 D1). That
spelling is load-bearing, and the two obvious alternatives are both wrong here:

- bare `unique: true` on a declared index is the positional spelling of
  `'global'` — installation-wide over exactly the listed columns — and is
  already warned by lint `unique/unscoped-declared-index` in 17.x;
- a hand-written `['metadata_type', 'name', 'organization_id']` composite is
  NULL-DISTINCT in SQL, and this line's `organization_id` is NULL on every row
  by construction, so that index would enforce **nothing at all** (#5030,
  measured) and one artifact could carry two contradictory `active` rows.

`'organization'` is the arm that closes exactly that hole: the driver prepends
`COALESCE(organization_id, '__global__')` at registration (ADR-0120 D3), which
is what §4's "NULL-collapsed" names.

The name is also registered in `@objectstack/spec`'s platform-object name census
(`PLATFORM_OBJECTS_BY_PACKAGE`, the `platform-objects` group). That census is a
curated set of REAL names, not a `sys_`-prefix pattern, precisely so a
cross-reference check can tell `sys_user` (real) from a fictional
platform-prefixed name; its module contract is explicit that "adding an object
to a platform package means adding its name here", and the owning package's
conformance pin fails otherwise. This is a one-name roster registration, **not**
protocol or schema surface — the ledger remains an ordinary platform object with
no zod/contract surface of its own, exactly as ADR-0126 §4 requires. Its
user-visible effect is that `isPlatformProvidedObjectName('sys_metadata_activation')`
now answers `true`, so lint stops reading a reference to the ledger as a typo.

**No behavior change.** This leg ships the declaration only — the enable/disable
actions that write the ledger and the per-runtime consult points that read it
are separate legs, and nothing in the tree reads the object yet. Absence of a
row means the packaged default (**active**), so an empty ledger changes nothing
anywhere; there is no seeding mechanism, so a stock boot leaves the table empty.
The object deliberately declares **no `lifecycle` block** — unlike its telemetry
siblings `sys_flow_dispatch` / `sys_automation_run`, a row here is durable
configuration, and reaping one would silently re-arm an artifact an
administrator disabled.
