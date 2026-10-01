---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: a relationship-path hop the cube declares no join for reads the object its lookup field declares, so an inferred cube's dotted path through a lookup named differently from its target is answered

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a change of which OBJECT the analytics doors read at a relationship-path hop the cube declares no join for: the object the lookup field declares as its `reference`, where it used to be an object named after the field. No authorable key, spelling, export or stored shape moves: `@objectstack/service-analytics` exports nothing new and nothing less, `CubeSchema`, `DatasetSchema` and the analytics query body keep parsing every value they parsed, and no stored row is read or rewritten. A cube that declares its join keeps it. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers which object a hop reads (not `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this widens what the analytics query doors answer for a dotted relationship path the cube declares no join for — an inferred cube's dotted member (`owner.region`), or an authored member whose `sql` walks a relationship its `joins` does not list — and narrows it in one case, named below. It holds on `POST /api/v1/analytics/query` and on its dry run `POST /api/v1/analytics/sql`, on both strategies and every SQL driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What an author sees now.** Each hop of the path reads the object its lookup field declares as its target, the way a join the cube declares already did. With a lookup `owner` that references a person object:

- the caller may read the person object: `dimensions: ['owner.region']` is answered with the person rows' regions on both strategies, and `where: { 'owner.region': 'NA' }` is answered on the native-SQL strategy with what the nested form `{ owner: { region: 'NA' } }` answers. The engine-aggregate strategy keeps refusing a filter on a related value with its own `400 INVALID_FIELD`, as it does through a declared join;
- the caller may not read the person object: `403 PERMISSION_DENIED` naming the person object, before any statement runs;
- the field-level gate judges `region` on the person object, and the caller's row scope on the person object is applied where the related value is read (the join on the native-SQL strategy, the related read on the engine-aggregate one).

A lookup to the cube's own object (a self-reference such as `parent`) is read the same way. A lookup named after its target answers exactly as before.

**Why.** An inferred cube declares no join, so a hop fell back to an object named after the lookup field. For a lookup named differently from its target that is no object: a caller who may read both objects was refused `403` "reading "owner" is not permitted", and a caller the object check passes reached a statement over a table named `owner` (`500`).

**The narrowing.** A lookup whose name is ALSO the name of another object — a field `account` referencing `crm_account` while an object `account` exists — used to be read from that other object: joined by the ids of the records the field points to, admitted and scoped as that other object. It now reads its declared target. So that path answers from the target's rows, and a caller who may not read the target is refused `403 PERMISSION_DENIED` naming it, where the query used to be answered.

**Unchanged.** A cube that declares a join for the path keeps reading the join's object. A host that wires no `relationshipResolver` (`AnalyticsServicePlugin` always wires it, from the data engine's object schema), or a relationship field it cannot answer for, keeps reading the object named after the field. A dataset's `include` compiles to declared joins, so a path it declares is unchanged.
