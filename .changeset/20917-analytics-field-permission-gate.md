---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: every analytics face answers the engine's field-level read refusal, whichever strategy serves the cube: a field the caller may not read is judged before either strategy runs (#20917)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, export or stored shape is removed or renamed. The change refuses analytics queries that read a field the caller's field-level permissions hide, which the engine already refuses on the data API and on the ObjectQL strategy, so there is nothing for `objectstack migrate meta` to rewrite. The one public-surface addition is a new optional service hook. -->

**BREAKING for analytics queries on a SQL deployment that read a field the caller may not read.**

**What changed.** `POST /api/v1/analytics/query`, `POST /api/v1/analytics/sql`
and `POST /api/v1/analytics/dataset/query` now judge every field a query reads
against the caller's field-level read permissions before a strategy is chosen:
dimensions, measures, time dimensions, filter members, order keys, members
joined through a relationship, and a dataset's own and its requested measures'
filters. A member of an authored cube is judged by the field it resolves to,
not by its name in the cube. A field the caller may not read answers
`403 PERMISSION_DENIED`, in the words the engine uses for the same field. The
native-SQL strategy, the one a SQL driver serves first, answered such queries;
the ObjectQL strategy and the data API already refused them.

**What is not affected.** A query that reads only fields the caller may read
answers as before. A system context, and a caller with no permission sets, are
unaffected, as on the data API. A host read scope (row-level policy) may still
name fields the caller cannot read. A deployment with no security service applies
no field-level check, as on the data API. A member of an authored cube whose `sql`
is an expression is not attributed to a field.

**New hook.** `AnalyticsServiceConfig.getReadableFields(object, context)` supplies
the reader. `AnalyticsServicePlugin` wires it to the `security` service's
`getReadableFields`; a host that constructs `AnalyticsService` itself passes its
own, and without one no field-level check applies.

**If a widget stopped answering for some users,** it reads a field those users
may not read. Grant that field's read permission to the users who need it, or
build the widget on fields they can read.
