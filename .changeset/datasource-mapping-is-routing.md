---
"@objectstack/objectql": minor
"@objectstack/service-datasource": minor
"@objectstack/runtime": minor
---

A `datasourceMapping` rule is routing, not a hint — an object mapped to an
unreachable datasource no longer silently reads and writes the DEFAULT store
(#4462).

**Observable behavior change; read this before upgrading.** Measured on `main`
during the v17 verification: map an object to a Postgres datasource with a bad
URL and the boot succeeds, `/ready` answers `200`, the datasource name appears in
**zero** log lines, `POST /api/v1/data/<mapped object>` returns `201` — and the
row is physically in the default store. The operator finds out by opening the
database they declared and finding it empty. ADR-0062 D2's phase-1 note called a
mapping-only datasource "decorative" to keep an example byte-for-byte unchanged;
what that bought was a silent data-placement bug.

The fix is a pair, and each half is what makes the other correct:

1. **Routing stops falling through** (`@objectstack/objectql`). `getDriver` step
   2: a mapping rule that MATCHES and names a datasource with no live driver now
   throws — `DatasourceUnavailableError` when the connect layer recorded a
   verdict, otherwise an error naming the object, the datasource and the two
   remedies. `default` still resolves onward: the default driver keeps its
   natural name (#3826), so step 5 is how routing to it works.
2. **ADR-0062 D2 grows gate (d)** (`@objectstack/service-datasource`,
   `@objectstack/runtime`). A datasource a mapping rule routes at least one
   object to is auto-connected at boot, and a boot-time connect failure is
   **fatal** with an operator-readable reason — the same call gate (b) already
   makes for an explicit `object.datasource` binding, now correct for (d)
   because half 1 removed the fallback. `OS_ALLOW_DRIVER_CONNECT_FAILURE` still
   degrades the boot instead, as for every other fatal connect.

The mapped-object list is resolved by the boot path from the engine's own
matcher (`ObjectQLEngine.resolveMappedDatasource`, newly public) and passed to
`connectDeclared({ mappedObjects })`; the connection service never re-derives
rule matching. Two matchers drifting by one clause would connect a datasource
routing never uses, or route to one nothing connects — the defect again.

**What to do if this breaks your boot.** It means a `datasourceMapping` rule in
your stack points at a datasource that cannot be connected. Either fix the
datasource configuration, or delete the rule — the second is what
`examples/app-crm` did in this change, and it is what keeps that example's
runtime behavior identical: its rules routed everything to an unconnected
`:memory:` datasource, i.e. to the default store by fall-through.
