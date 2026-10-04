---
'@objectstack/objectql': minor
---

An in-process engine verb refuses an object name the registry does not resolve, with the data door's own `OBJECT_NOT_FOUND`, instead of handing it to the driver as a raw table name

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing at the engine's name resolution: no authorable spec key, export or metadata shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What a caller meant by a name the registry does not hold is not decidable by a conversion entry. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered); and the change narrows what runtime verbs accept, not a runtime interface or a type surface alone (not runtime-interface-only / type-surface-only). -->

**BREAKING** accept-set narrowing of the engine's in-process verbs, shipped as `minor` under the repo's launch-window convention for breaking changes.

**What was accepted before.** `find`, `findOne`, `count`, `aggregate`, `insert` (and `insertMany`), `update`, `delete` and `validate` resolved their target through the schema registry and, for a name the registry did not resolve, handed the name to the driver as a raw table name. A caller in the process (a sandboxed action or hook body's `ctx.api`, an action handler, host code) could therefore read or write a table by a name the generic data door refuses with `404 OBJECT_NOT_FOUND`, and every in-process guard keyed by a registered object name could be stepped around by naming the target another way.

**What is refused now.** Such a name is refused with the data door's own envelope (`OBJECT_NOT_FOUND`, `status: 404`, the name on `object`, built by `objectNotFoundError` from `@objectstack/core`) before any hook, middleware or driver runs. A registered name resolves exactly as before. `judgeFilter` still judges the filter for a name the registry does not hold, because it reads nothing and reaches no driver; execution refuses that object before admission.

**Inside the engine.** The single-tenant organization probe asks the registry first: an install that registers no organization object is the lean case it always was, with no organization to derive, and the write proceeds unstamped without a driver read.

**The fix.** Register the object (in the stack, with `registry.registerObject`, or through a plugin manifest) before addressing it through the engine. Host code that must reach storage without a registry entry addresses the driver itself (`datasource(name)`, `getDriverForObject(name)`), a path a sandboxed body cannot reach.
