---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: the analytics door judges the two generic-exit declarations every other door judges — an object's `enable` block and a field's `internal: true` (#22634)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime read door: analytics stops serving objects and fields whose existing declarations already withhold them from every other generic exit, and the remedy is the declaration the author already wrote, never a rewrite of anyone's code or metadata. One optional hook, `getObjectDeclaration`, is added to the exported `AnalyticsServiceConfig` type; it is additive, and nothing on the type surface narrows. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

Every generic exit judges an object's `enable` block through the spec's one exposure decision, `apiExposureDenialReason`: the REST data routes, the runtime dispatcher, the MCP data tools, and the cross-object search for the off switch. Every generic exit also withholds a field declared `internal: true`: the data door omits it from rows, the write responses strip it, and the engine's `aggregate()` refuses it as a group key. The analytics door read neither declaration.

**FROM.** On both strategies (native SQL and ObjectQL), and for a member holding read and an administrator alike:

- The ad-hoc query, the SQL face, the configured-cube door and the dataset door served the rows of an object declaring `apiEnabled: false`, and of an object whose `apiMethods` whitelist does not grant `list`.
- On the native-SQL strategy, a field declared `internal: true` was served as a group key, as an aggregate input and as a filter operand.
- On the ObjectQL strategy, the engine refused the same field as a group key or an aggregate input with an undeclared `500`. It still admitted the field as a filter operand.

**TO.** Ahead of strategy selection, the door asks the spec's decision for the `aggregate` operation over every object a query reads: the base object, declared joins and relationship hops. It answers with the data door's codes for the same declaration:

- `404 OBJECT_API_DISABLED` for `apiEnabled: false`;
- `405 OBJECT_API_METHOD_NOT_ALLOWED` for a whitelist that does not grant the verb.

On the ad-hoc doors this happens before any cube is inferred, so a refused request mints nothing. A member that reads a field declared `internal: true` is refused `400 INVALID_FIELD`, naming the object and the field. This holds in every position: dimension, measure input, filter or sort key, dataset filter, and relationship hop.

- **Refused, not withheld.** On the data door, the row path omits such a field because a row is a projection. Every analytics member is evaluated instead: a group key, an aggregate input, a predicate. There is nothing to omit, and the data door's own aggregate face already refuses the field as a group key.
- **Every caller.** Neither declaration takes a user, so administrators are refused exactly as members are. There is no system carve-out.
- **Fails closed.** A declaration lookup that throws refuses the query with `403 PERMISSION_DENIED`, logged at `error`. `AnalyticsServicePlugin` wires the lookup from the data engine and refuses when no engine can answer. A host constructing `AnalyticsService` by hand with no `getObjectDeclaration` hook gets no gate, and is told so once.
- **Unchanged.** An ordinary object and an ordinary field are served as before. An object that merely has an `internal` field is still served for every other field, and so is a bare count over it.

**Measured producers.** On `origin/main` `f368b7e980`, no authored cube, dataset, dashboard or example in this repository names an `apiEnabled: false` object, an object whose whitelist omits `list`, or an `internal` field. The platform's System Overview datasets count `sys_user`, `sys_organization` and `sys_session`, and group `sys_audit_log` by two ordinary fields. Each of those objects grants `list`, and none of those members is `internal`. Deployed and cloud-held analytics definitions were NOT MEASURED.
