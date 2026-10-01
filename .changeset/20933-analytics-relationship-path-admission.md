---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: an object an analytics query reads through a relationship path is admitted and row-scoped exactly as a declared join to it is, on both strategies (#20933)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, export or stored shape is removed or renamed. The change refuses, or row-scopes, what the native-SQL strategy read from an object reached through an undeclared relationship path, the way a declared join to the same object already was; there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING for analytics queries that read a related object through a relationship path the cube does not declare: on a SQL deployment, and on `POST /api/v1/analytics/sql` whichever strategy serves the cube.**

**What changed.** The analytics door admits and row-scopes one object set
before either strategy runs. It held the cube's base object and the joins the
cube declares (`joins`, or a dataset's `include`). An object reached through a
relationship path the cube does not declare was not in it, although both
strategies read that object: a dotted member of an inferred cube, an authored
member whose `sql` walks a relationship the cube's `joins` does not list, or a
dotted member the query names itself. Every such object is now in the set, so
`POST /api/v1/analytics/query`, `POST /api/v1/analytics/sql` and
`POST /api/v1/analytics/dataset/query` treat it exactly as a declared join:

- a related object the caller may not read answers `403 PERMISSION_DENIED`,
  naming that object, before any statement runs;
- the caller's row scope on the related object is applied, so related rows
  outside it are not read. On the native-SQL strategy a base row whose related
  record is outside the scope drops out of the answer, as it already did for a
  declared join; the ObjectQL strategy still groups such rows as restricted;
- a related-object scope the native-SQL strategy cannot compile routes the
  query to the ObjectQL strategy, as it already did for a declared join.

Each hop of a multi-hop path is judged on its own object, resolved the way the
field-level gate resolves it: the join the cube keys by the path, or else the
relationship name itself.

**What is not affected.** A query through a related object the caller may read
answers as before, within the caller's row scope. A system context, and a
caller with no permission sets, are unaffected, as on the data API. A
deployment with no security service applies no object-level check, as on the
data API.

**Refusals that change form.** On the ObjectQL strategy a related object the
caller may not read was already refused on `POST /api/v1/analytics/query` and
`POST /api/v1/analytics/dataset/query`, though `POST /api/v1/analytics/sql`
printed the statement; on those two doors it now answers the analytics door's
refusal rather than the engine's, the same one a declared join gets. A filter,
a time window or a two-hop path through such an object moves from
`400 INVALID_FIELD` to that `403`. A relationship path whose relationship name
is not itself an object name was never served by either strategy; for a caller
the object-level check applies to, it now answers `403 PERMISSION_DENIED`
naming that relationship.

**If a widget stopped answering for some users,** it reads a related object
those users may not read. Grant read access on that object to the users who
need it, or build the widget on objects they can read.
