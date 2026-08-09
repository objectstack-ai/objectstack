---
"@objectstack/objectql": patch
"@objectstack/service-analytics": patch
---

fix(objectql,service-analytics): report the datasource an object is actually on, not the one it declares (#5288)

Analytics' `getObjectDatasource` probe read `getObject(name).datasource` — the
object's **declared** value, which is step 1 of the five `ObjectQL.getDriver`
resolves by. `ObjectSchema.datasource` carries `.default('default')`, and
`'default'` means "no explicit binding, keep looking" inside the engine, so
every object placed by a `datasourceMapping` rule, by the ADR-0057 §3.6
lifecycle split, or by its package's `defaultDatasource` answered `'default'`
and was read out here as "the primary DB".

`sys_audit_log` is the live specimen: `lifecycle.class: 'audit'` puts it on the
`telemetry` datasource with nothing declared to read. So #5033's query-time
diagnostic — whose entire job is to NAME the database a table is missing from —
named the wrong one:

```
before: table "account" is not on datasource "default",   which is where its base object "sys_audit_log" lives
after:  table "account" is not on datasource "telemetry", which is where its base object "sys_audit_log" lives
```

**New engine accessor — `ObjectQL.resolveEffectiveDatasource(objectName)`.** The
public, name-only face of the resolution order `getDriver` already routes by,
extracted so the order exists exactly once (the same argument that produced
`resolveMappedDatasource` in #4462: a second, shorter copy of a routing order
drifts by one step, silently). `getDriver` now consumes the same resolver and
keeps every existing behaviour — precedence, the refusal to fall through to the
default store when a declared or mapped datasource has no live driver, and both
of its diagnostics.

It answers `undefined` when nothing binds the object anywhere and it simply
rides the deployment's default driver. That is deliberate and unchanged from
what consumers already documented: the default driver keeps its natural name
(#3826), so that name identifies a driver rather than a datasource anyone bound
the object to. `getDefaultDriverName()` is still there for callers that want it.

Analytics' probe now asks the engine instead of the declaration; the routing
rules are **not** re-implemented on the analytics side. #5115's compile-time
cross-datasource join gate keeps its predicate exactly as written — what changed
is that its input can now answer for objects bound by a mapping rule, by the
lifecycle split, or by a package default, so a join between two bound
datasources is refused at registration instead of exploding at query time. A
join from a bound object to one that merely rides the deployment default is
still not decidable at compile time and remains the query-time diagnostic's
business.
