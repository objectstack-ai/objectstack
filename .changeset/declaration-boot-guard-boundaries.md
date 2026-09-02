---
"@objectstack/cli": patch
---

fix(cli): close the declaration-boot write guard's two named boundaries — engine-held drivers and immediate DDL (#14126)

`os migrate plan` / `os migrate apply` boot host plugins for their declarations behind a guard that refuses the contract's row writes and, since #13332 / #14053, prints "a plan writes nothing" only when that held. Two boundaries were left open and named in the guard's own census; both are now covered, under ONE outcome-line rule:

- **Engine-held drivers.** Only the default datasource is published as `driver.*`; every other driver reaches the engine through `engine.registerDriver` alone (`DatasourceConnectionService.connect()`, `AppPlugin`'s `drivers.register`, `ObjectQL.create`), so a hook writing to an object bound to a second datasource landed during a plan. The guard now shadows `registerDriver` on the engine instance the kernel publishes (`objectql` / `data`) for the length of the boot, arms each driver instance in place as it is registered — forwarding the SAME instance, never a wrapper, never a second registration under a held name — reaches drivers the engine already held through its public accessors, and restores the engine on `disarm()`. Such a write is now refused and reported as `via engine.<datasource>`.
- **Immediate DDL.** `dropTable()` / `rotateShards()` are not held back by the schema deferral and execute immediately. They are still not refused (refusing DDL an operator's own hook asked for is out of this guard's scope) — but they now get `execute()`'s treatment: forwarded, counted per driver/method/object, warned once per driver on stderr, named in the notes, and the run no longer claims "a plan writes nothing".

The rule, decided once: the claim prints only when it held across everything the guard can see — every write refused, nothing forwarded (raw `execute()`, immediate DDL), and no instance that refused the override (a frozen driver, an engine that could not be shadowed). Each of those is named in the notes and withholds the line. An embedder with no data plane, and read/log-only hooks, are untouched: a quiet boot still renders byte-identically.
