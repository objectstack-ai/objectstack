---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(objectql,runtime): a stack's `datasourceMapping` is installed before the engine's first schema sync, and the datasources it routes platform objects to are connected then, so a served boot keeps every object in the store its rule names (#23649)

Clause-②: no

A mapping rule is routing, not a hint (ADR-0062, the `datasourceMapping` half of D2): every object it matches resolves to the datasource it names. `AppPlugin.start()` installed the rules late. By then `ObjectQLPlugin.start()` had schema-synced every registered object onto the host's default store, and the auth plugin had written the Default Organization there. A host config declaring `datasourceMapping: [{ default: true, datasource: 'primary' }]` over a declared `primary` reached `Server is ready` with `OS_DATABASE_URL` set (or under `--dev`), and every platform read then failed with `no such table`, because the platform tables and the organization were in the URL store and `primary` had neither. `os start` with `OS_DATABASE_URL` set to a different database than the rule names behaved the same way. A rule that routes platform objects only (`objectPattern: 'sys_*'`) also left its datasource unconnected, because the connect gate counted the app's own objects only. Every platform read then failed with "mapped for object … is not registered".

**What changes**

- **`@objectstack/objectql`.** `ObjectQLPlugin.start()` triggers the kernel event `objectql:drivers-ready` (exported as `OBJECTQL_DRIVERS_READY_HOOK`), with the engine as its argument. It fires once per boot, after the boot drivers are adopted and connected and before the first schema sync, the `sys_metadata` hydration or any read or write. A handler that throws fails the boot.
- **`@objectstack/runtime`.** `AppPlugin` handles that event. It installs the stack's `datasourceMapping`, then connects every declared datasource the rules route an already-registered object to, platform objects included. The connect is the same `connectDeclared` `start()` uses, with the same fail-fast verdict. The first DDL, the hydration and the Default Organization then land on the mapped datasource. On a composition whose engine never fires the event, `start()` installs the rules as before.

**Unchanged**

- A config with no `datasourceMapping`, and a rule naming the host's `default`.
- The engine's default driver. The mapped datasource connects after the engine has adopted its `driver.*` services, so it never takes the default slot from a stack plugin's driver.
- Where an object's rows live after boot. The rules were already in force once `start()` had run.
- `os start` on the config-declared default (`datasourceMapping` `{ default: true }` and no URL). The resolver points the host default at the same database, so everything was already in one file, and still is.
- A rule routing only the app's own objects. Their rows were already written to the mapped datasource. The only difference is that the first sync no longer creates an empty copy of their tables in the default store.

**Refused at boot, as documented.** The docs already say a rule that routes objects to a datasource that cannot be connected fails the boot. A rule that routed only platform objects to such a datasource used to reach `Server is ready` with every platform read failing. It now fails the boot with the connect error and the objects routed to the datasource. The remedy is to make the datasource reachable, or to remove the rule.

**Still on the default store:** the package registry's own `sys_packages` table. It is not an object, so no rule routes it, and the package service creates and reads it on the engine's default driver.
