---
'@objectstack/spec': patch
---

Datasource unknown-key guidance no longer promises validation that does not happen, and the #4001 strictness ledger sees nested schema directories.

Two related corrections to the #4001 unknown-key campaign, both about a check reporting more coverage than it had.

**The `config` prescription was false.** When `DatasourceSchema` rejects a connection detail written at the top level, it prescribed: "Move it to `config: { host: … }`; the driver's own configSchema validates it there." Nothing validates it there — `DriverDefinitionSchema.configSchema` is a `z.record` that both bundled driver specs set to `{}`, and no consumer reads it. The message therefore took an author who had made a recoverable mistake at a place that now catches it and pointed them at a slot where the same mistake is silent again: `config: { hostname: … }` is dropped and the datasource connects on localhost. The guidance now names the per-driver shape to write against (`PostgresConfigSchema` / `MongoConfigSchema` / `MemoryConfigSchema`) instead of promising a gate. Enforcement is tracked in #4410. The same false claim is removed from `data/driver/mongo.zod.ts`, whose header advertised that the Platform validates `datasource.config` with it.

No authorable key changed — this is error-message and documentation text only.

**The ledger gate's coverage walk was one level deep.** `check:strictness-ledger` promises that every `*.zod.ts` with sites in a triaged directory carries a classification row. It listed each directory non-recursively, so `data/driver/` — three per-driver config files, nine authorable sites — was invisible to it while it printed "no undeclared schema files". The walk is now recursive (nested files declare as `driver/postgres.zod.ts`), those three files are classified in the ledger, and `scripts/strictness-ledger.test.ts` pins the recursion — necessary because with the rows in place the gate itself passes either way and cannot catch its own regression.
