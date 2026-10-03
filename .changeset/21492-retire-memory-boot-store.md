---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/cli': minor
---

fix(spec,runtime,cli)!: the in-memory (mingo) engine is no longer a boot store — every boot door refuses it and names SQLite instead (#21492, #21572)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no metadata body, authorable key or stored shape moves: the driver table keeps `memory`, `mingo`, `in-memory` and `inmemory` on its config-contract face, so `resolveDriverId` answers them exactly as before and a stored `datasource.driver: memory` still parses against `MemoryConfigSchema`; what narrows is the boot selection (`--database-driver`, `OS_DATABASE_DRIVER`, `databaseDriver`, a `memory://` or `mingo://` database URL, and a project's default datasource declared on the engine), which is host configuration that `objectstack migrate meta` does not rewrite — and no rewrite would be truthful, since the only replacement is a different engine the operator has to choose. The other categories are closed on facts: all three packages publish (not `unpublished`); no ADR-0087 id covers a boot selection (not `registered` / `already-registered`); and the change is runtime behaviour plus exported constant values, not an interface or a type alone (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: the in-memory (mingo) engine can no longer be selected as the store a server, a migration or an embedded stack boots on. It refuses every tenant-scoped read by design, so a boot on it signed a user in and then answered `503` to every data request; there was nothing working to keep. The retirement is made at the declaration: `@objectstack/spec`'s driver table withdrew `memory`, `mingo` and `in-memory` from its selection face (they stay on the config-contract face beside `inmemory`), and every boot door refuses the engine with one sentence that names the replacement.

- **`@objectstack/spec`** — `DATABASE_DRIVER_SELECTION_ALIASES` no longer lists `memory`, `mingo` or `in-memory`; `DATABASE_DRIVER_SELECTION_IDS` no longer lists `memory`; `resolveDatabaseDriverId` answers `undefined` for all four spellings. `resolveDriverId`, `DRIVER_ID_ALIASES`, `BUILTIN_DRIVER_IDS` and the `memory` config contract are unchanged.
- **`@objectstack/cli`** — `--database-driver memory` is refused while the flags parse (`os dev`, `os start`); `OS_DATABASE_DRIVER=memory` / `mingo` / `in-memory` is refused before `os dev` or `os start` prints its Database row; `os serve`'s legacy path refuses the spellings and the `memory://` / `mingo://` schemes as a fatal boot error. The help no longer offers `memory://`.
- **`@objectstack/runtime`** — `createStandaloneStack`, `createDefaultHostConfig` and `resolveStandaloneDatabase` (every ordinary `os dev` / `os start` / `os serve` boot and every `os migrate` subcommand) refuse the spellings, the `memory://` and `mingo://` schemes, and a project whose default datasource is declared with `driver: 'memory'`. `resolveProjectDatabaseUrl` refuses a retired driver selection ahead of every rung, and its `ProjectDatabaseUrlSource` type no longer has the `'memory-driver'` member. `ResolvedStandaloneDatabase.driver` never names `memory`. Two exports are added for hosts that refuse the engine themselves: `namesRetiredMemoryEngine` and `retiredMemoryEngineMessage`.
- **Unchanged:** the `@objectstack/driver-memory` package; a declared non-default datasource with `driver: 'memory'` and a directly constructed `InMemoryDriver`, both still built; SQLite's dev step-down, whose last rung is still this driver.

Migration — one flag change:

- FROM `os dev --database-driver memory` (or `OS_DATABASE_DRIVER=memory`) TO `os dev --fresh` for a throwaway database deleted on exit.
- FROM `OS_DATABASE_URL=memory://…` / `--database memory://…` / `databaseUrl: 'memory://…'` TO `:memory:` (SQLite's own in-memory database), e.g. `OS_DATABASE_URL=:memory:`.
- FROM a default datasource declared `{ driver: 'memory' }` TO a SQLite one, e.g. `{ driver: 'sqlite', config: { filename: ':memory:' } }`.

No shipped example selects the engine. It ships as `minor` under the launch-window convention for accept-set narrowings.
