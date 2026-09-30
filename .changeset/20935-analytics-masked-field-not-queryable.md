---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: a field the caller is served masked is refused as a group key, an aggregate input, a filter or a sort key on every analytics face, whichever strategy serves the cube (#20935)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, export or stored shape is removed or renamed. The change refuses analytics queries that group, aggregate, filter or sort by a field the caller may only see masked, which the engine already refuses on the data API and on the ObjectQL strategy, so there is nothing for `objectstack migrate meta` to rewrite. The one public-surface addition is a new optional service hook. -->

**BREAKING for analytics queries on a SQL deployment that group, aggregate, filter or sort by a field the caller may only see masked.**

**What changed.** The field-level gate on `POST /api/v1/analytics/query`,
`POST /api/v1/analytics/sql` and `POST /api/v1/analytics/dataset/query` judged
each member by the caller's readable fields. A field whose `maskingRule` applies
to the caller is readable (its values are served masked), so the gate admitted
it, and the native-SQL strategy then grouped or filtered by the stored value.
The gate now also asks which fields the caller may query on, and refuses a
member naming a masked field with `403 PERMISSION_DENIED`, in the words the
engine uses for the same field. The ObjectQL strategy and the data API already
refused these queries.

**What is not affected.** A caller who holds the capability that lifts a
field's masking rule queries the field as before. A system context is
unaffected. A query that names no masked field answers as before.

**New hook.** `AnalyticsServiceConfig.getQueryableFields(object, context)`
supplies the answer. `AnalyticsServicePlugin` wires it to the `security`
service's `getQueryableFields`. When that service predates the method, or
answers "no answer", the plugin treats every field that declares a
`maskingRule` as not queryable, for every caller. A host that
constructs `AnalyticsService` itself with `getReadableFields` and without
`getQueryableFields` is warned once at construction.

**If a widget stopped answering for some users,** it groups or filters by a
field those users see masked. Give the users who need it the capability the
field's `requiredPermissions` names, or build the widget on fields they can query.
