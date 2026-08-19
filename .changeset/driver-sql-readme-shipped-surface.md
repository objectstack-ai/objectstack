---
"@objectstack/driver-sql": patch
---

docs(driver-sql): rewrite the published README to the shipped driver surface (#9867)

`packages/drivers/driver-sql/README.md` is in the package's `files` array with
`private` unset, so it is the page npm renders. It told the reader to build a
stack with a static factory on a class that is not exported, at three call sites:

```ts
driver: DriverSQL.configure(getDatabaseConfig())
```

Measured against the built `dist/index.d.ts`: `DriverSQL` occurs **zero** times,
and no `configure` static exists on `SqlDriver` or on anything else the package
exports. `DriverSQL.configure()` was never real — the commit that first repaired
these snippets elsewhere in the same file (2026-05-07) called it "the imaginary
`.configure(...)` static factory", and it fixed only the Basic Usage section, so
the page has contradicted itself since: correct `SqlDriver` import at line 43,
fabricated `DriverSQL` at 448/482/516. The receiver is a free identifier that
imports nothing, which is why `check:published-readme-exports` — both halves of
which key on an *imported* name — could not see it.

Renaming would not have produced working code, and the sweep this card asked for
found the surrounding shape was fabricated too. Every claim on the page was
re-measured; the ones that were wrong:

- **`defineStack({ driver: … })` does not exist** — the six `driver:` call sites
  (three `new SqlDriver(...)`, three `DriverSQL.configure(...)`) all named a key
  `ObjectStackDefinitionSchema` never declared. Since #8687 that schema is
  `.strict()`, so it does not merely drop the key: `defineStack` **throws**
  (`Unrecognized key(s) on this stack definition: 'driver'`), and `tsc` refuses
  the literal with `TS2353`. A driver is a plugin —
  `plugins: [new DriverPlugin(new SqlDriver({ … }))]`, `DriverPlugin` from
  `@objectstack/runtime`. The env-var route (`OS_DATABASE_URL`) is documented
  alongside it.
- **Four of the six documented driver methods do not exist.** `driver.raw()` (six
  call sites) is `execute()`; `checkConnection()` (two) is `checkHealth()`, which
  resolves `false` rather than throwing, so the try/catch example was wrong in
  shape as well as in name; `destroy()` is `disconnect()`; `transaction(cb)` is
  `beginTransaction()` + `options.transaction` + `commit()`/`rollback()`, and the
  callback's `trx.insert({ object, data })` names nothing at all. `getKnex()` was
  the only one that resolved.
- **`kernel.getDriver()`** — three call sites; `ObjectKernel` has no such member
  (`getDriver` is *private* on the engine).
- **The query AST was wrong in three places.** `find` takes the object name as
  its first argument, so `find({ object, … })` is an arity error; the filter key
  is `where` with the ObjectQL dialect (`{ amount: { $gte: 10000 } }`), not
  `filters: [{ field, operator, value }]`; and sorting is
  `orderBy: [{ field, order }]` — `sort`/`direction` is the spelling
  `SortNodeSchema` lists as a retired alias.
- **The config type name was wrong.** The page declared
  `interface SQLDriverConfig`; the export is `SqlDriverConfig`
  (`TS2724 … Did you mean 'SqlDriverConfig'?`), it is `Knex.Config` plus four
  ObjectStack keys, and all four — `schemaMode`, `autoMigrate`,
  `sqliteJournalMode`, `sqliteAbsentFile` — were undocumented.
- **A config block that could not load.** The tenant-field example wrote
  `tenancy: { enabled: true, strategy: 'shared', … }`; `tenancy.strategy` was
  removed after spec 15.0 (#2763) and is now a tombstone that rejects with a
  prescription.
- **The environment-config example did not compile even setting the fabricated
  factory aside** — `configs[env]` with `env: string` is `TS7053`, and `ssl` sat
  at the top level of the config, where Knex does not read it (it belongs to
  `connection`).
- **Every raw-SQL example queried tables that do not exist.** The physical table
  name *is* the namespace-prefixed object name (`crm_account`, `sys_user`);
  nothing is prefixed `objectstack_`.
- **The Migrations section documented an off-platform workflow** — a `knexfile.js`
  plus `npx knex migrate:latest`. Schema is reconciled from object metadata
  (`schemaMode: 'managed'`, `autoMigrate`), reviewed with `os migrate plan` and
  applied with `os migrate apply`; indexes are declared on the object
  (`indexes: [{ fields, unique }]`), not issued as DDL. The "always use
  migrations, never raw DDL" best-practice line said the opposite of how the
  platform works.
- **A dead import.** The Vercel example imported `createClient` from
  `@vercel/postgres` and never used it.

All 19 TypeScript fences on the rewritten page are extracted verbatim and
compiled against the built `.d.ts` files the `exports` maps resolve; the two
`defineStack` shapes are additionally executed. Docs only — no runtime code
changed and no API was added.
