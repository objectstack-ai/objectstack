# Can `os dev`'s default database move from SQLite (better-sqlite3) to a local libSQL file?

> **Status:** evaluation, measured 2026-11-24 on `origin/main` `9d707686e`. Answers questions 1–7 of
> #37106. It changes nothing: the default stays SQLite on better-sqlite3 at
> `.objectstack/data/objectstack.db`. Every number below was measured in one Linux x64 (glibc)
> container with 4 cores, under the shared verify lock, so absolute times are shared-box seconds.
> Compare the ratios, not the absolutes. The harnesses were throwaway scripts. Each is described
> where its numbers appear, so it can be rebuilt.

## The answer in one paragraph

Not now. "driver-turso on a `file:` URL" does not run libSQL. The driver's local mode is
`SqlDriver` on Knex with **better-sqlite3**, the same engine as today's default
(`turso-driver.ts` `toKnexConfig`: `client: 'better-sqlite3', connection: { filename }`). That
configuration passes everything the default passes, and it buys nothing: no vector functions, no
engine shared with the hosted product, and about 22.6 MB more to install. The libSQL engine is
reachable only by forcing `mode: 'remote'` on a `file:` URL, which puts the file behind the
transport built for Turso Cloud. On that path transactions, `os migrate plan`, schema
introspection, window functions and query plans are refused with 501, and single writes are about
10× slower. A second process gets `SQLITE_BUSY` on most of its writes, and boolean group keys come
back from `aggregate` as `0`/`1`. No `os dev` setting reaches that path for the default datasource
today. Two measurements also argue against putting knowledge vectors into the platform file:
1,000 vectors of 1,536 dimensions grow the file 40×, and stock SQLite tools misread the file once
it holds a vector index. Recommendation: **switch on conditions** (section 7). Until then, keep
better-sqlite3 as the default and give `knowledge-turso` its own libSQL file.

## The three configurations measured

| Id | Construction | Engine that touches the file | How `os dev` reaches it today |
|:--|:--|:--|:--|
| **C0** | `new SqlDriver({ client: 'better-sqlite3', connection: { filename } })` | better-sqlite3 (SQLite 3.53.4) | the default |
| **A** | `new TursoDriver({ url: 'file:…' })` | better-sqlite3, through `SqlDriver` (driver-turso's `local` mode) | `OS_DATABASE_DRIVER=turso` and a `file:` URL (confirmed in a debug-log boot: 17 lines name `com.objectstack.driver.turso`) |
| **B** | `new TursoDriver({ url: 'file:…', mode: 'remote' })` | libSQL (`@libsql/client` 0.18.0 → `libsql` 0.5.29, SQLite 3.45.1 base) through `RemoteTransport` | not reachable for the default datasource. The standalone stack builds the `turso` default as `{ url, authToken }` only (`standalone-stack.ts`, turso arm), so `mode` cannot be passed. A non-default datasource declared with `driver: 'turso'` and `mode: 'remote'` reaches it |

B is the shape the hosted product runs, a `RemoteTransport` over an `@libsql/client` client. It
was checked twice: forced through `mode: 'remote'`, and the way driver-turso's own suites build it
(`url: 'libsql://…'` with `client: createClient({ url: 'file:…' })`). The two gave identical
answers wherever both were run. The constructor does not refuse a forced `mode: 'remote'` on a
`file:` URL, while the package README describes remote mode as having "no local SQLite".

## 1. Parity

### 1a. The spec's conformance tables through the plugin-driver conformance kit

Harness H1 ran `runPluginDriverConformance` (`@objectstack/objectql`, tiers `floor` and `direct`)
against each configuration. The oracle is the spec's `FILTER_LOGIC` / `FILTER_TEXT` / `TEMPORAL` /
`PAGINATION` tables. Each fixture got a fresh file, `initObjects`, then one `create` per row.

| | cases | pass | fail | not offered | pushdown `exact` |
|:--|--:|--:|--:|--:|--:|
| C0 | 310 | 302 | 4 | 4 | 297 |
| A | 310 | 302 | 4 | 4 | 297 |
| B | 310 | 301 | 5 | 4 | 297 |

The 4 failures shared by all three are the `$not returns the rows with no value` row in the floor
and direct tiers (filter and count). The kit sends a raw `$not`, while built-in drivers rely on
the engine seam lowering it first (`lowerFilterCondition`, as `turso-filter-logic-conformance.test.ts`
does). That is a harness limit, the same on every backend. B's fifth failure is
`introspectSchema()`, refused by the remote transport with `NOT_IMPLEMENTED` / 501.

### 1b. driver-turso's own local-mode suites, re-pointed at each configuration

Harness H2 copied 17 of driver-turso's local-mode suites. They were the conformance files
(pagination, filter logic, temporal, value round trip, member keyset walk, readable ids, comparand
types), the json, autonumber and declared-type suites, and `turso-driver.test.ts`. In each copy,
every `new TursoDriver({ url: ':memory:' })` (29 sites) was rewritten to A or B. No other line
changed, so the stub-backed remote sections stay upstream. For B the 16 assertions that the
transport is `'local'` were deleted.

| Run | Files | Tests | Result |
|:--|--:|--:|:--|
| upstream, `:memory:` | 17 | 476 | 476 passed |
| A, `file:` | 17 | 476 | 474 passed. Both failures assert that the url equals `':memory:'` (an artifact of the port) |
| B, `file:` + `mode: 'remote'` | 17 | 476 | 413 passed, 63 failed |

How B's 63 failures break down:

| Count | Cause | What it says about B |
|--:|:--|:--|
| 53 | The suite seeds or inspects rows through the inherited Knex handle (`driver.knex(...)`), and B's Knex has no connection (`Unable to acquire a connection`) | Not measurable on B with these suites. These rows prove nothing either way |
| 4 | Capability claims: B adds `transactionsUnsupported`, turns `aggregationFilter` off, advertises no native date granularity, and carries a `RemoteTransport` | A real difference: the engine falls back to in-memory aggregation where C0 pushes down |
| 2 | Physical column types: B creates `TEXT` / `REAL` / `INTEGER` where C0 creates `varchar(255)` / `float` / `boolean` | A real difference in the file's schema (section 4) |
| 3 | The local face's deep-JSON backfill pins. On B the remote backfill runs instead and leaves a seeded legacy cell `bare` where the local face writes `"bare"` | A real difference, limited to legacy rows written around the write path |
| 1 | The url equals `':memory:'` | Artifact of the port |

The 9 conformance files with no Knex seeding passed on B in full.

### 1c. The checklist on the card, probed directly

Harness H3 ran a fresh file per configuration, an object with text, boolean, json, date, datetime,
number and integer fields, and the calls below.

| Probe | C0 | A | B |
|:--|:--|:--|:--|
| boolean / json / date / datetime / number round trip | identical | identical | identical |
| filter on a boolean | 1 row | 1 row | 1 row |
| `beginTransaction` + rollback / commit | rolled back / committed | rolled back / committed | `NOT_IMPLEMENTED` / 501 |
| add a field to an existing table (`initObjects`) | ok | ok | ok |
| `introspectSchema()` | ok | ok | 501 |
| `detectManagedDrift()` | ok | ok | ok |
| `setDeferredDdl(true)` (what `os migrate plan` calls) | ok | ok | 501 |
| `findWithWindowFunctions()` | ok | ok | 501 |
| `explain()` | ok | ok | 501 |
| `aggregate`, `upsert`, `bulkCreate` (50 rows) | ok | ok | ok |
| `aggregate` grouped by a boolean field | `true` / `false` / `null` | `true` / `false` / `null` | **`1` / `0` / `null`** |
| on disk: `journal_mode`, `auto_vacuum` | `wal`, `2` (incremental) | `wal`, `2` | **`delete`, `0`** |
| on disk: boolean / json / datetime storage | integer 1 / text / ISO text | same | same |
| `integrity_check` | ok | ok | ok |

The boolean group key also diverges one layer up. Through `ObjectQL.aggregate` (harness H3b, the
same rows) C0 and A answer `[{done:null,c:1},{done:false,c:1},{done:true,c:2}]`. B, and the hosted
construction (`libsql://` url + a `file:` client), answer `[{done:null,c:1},{done:0,c:1},{done:1,c:2}]`.
`TursoDriver`'s own comment on its remote read helpers says they exist "so both transports agree
on what a value *is*". The aggregate path does not go through them. This is listed under
out-of-scope findings; it is not fixed here.

**Pagination tie-breaks** passed on all three (the kit's `PAGINATION` cases and the ported
pagination suite). **The remote-only backfills** (`backfillRemoteCanonicalColumns`, codec residue)
run on B's schema sync, and section 4 shows them leaving a C0-written file readable.

## 2. Transactions on local libSQL

**Today: no.** B is the only way the driver puts libSQL on a file, and on B every transaction
member and every `options.transaction` is refused with 501 before anything is read or written. A
uses Knex transactions, but on better-sqlite3, so it is not libSQL either.

**What the client itself gives a local file** (harness H4c, raw `@libsql/client` 0.18.0 on a
`file:` url):

| Measurement | Default client (`timeout` unset) | `timeout: 5000` |
|:--|:--|:--|
| `transaction('write')`, then rollback / commit | works: only the committed row remains | works |
| a write on the same client while a write transaction is open | `SQLITE_BUSY` after 1 ms | `SQLITE_BUSY` after 5,017 ms, with the event loop blocked the whole time (the binding is synchronous) |
| 200 concurrent single-statement writes | 11 ok, 189 `SQLITE_BUSY` | did not finish within 60 s (killed) |
| journal mode of a new file | `delete` | `delete` |

The client pools up to `concurrency` (default 20) connections per file. A transaction holds one of
them until it settles. The native binding's busy timeout defaults to 0 (`libsql/index.js`:
`opts?.timeout ?? 0.0`). So a real transaction on a local libSQL file needs more than calling
`client.transaction()`. Writes have to be serialized inside the process (one writer connection, or
a queue in front of it), because a busy wait on the synchronous binding blocks every request.
The driver would also have to set WAL and a busy timeout itself, as `SqlDriver` does for
better-sqlite3 today.

**How it relates to #32500.** #32500's route is native `@libsql/client` interactive transactions
threaded through `RemoteTransport`'s data methods behind an executor seam (its M2). That seam is
exactly what a local-file libSQL arm needs: the same transport and the same client API, and the
same `transactionsUnsupported` flag to turn off. A `file:` url is the cheapest place to prove the
seam, since it has no server idle timeout and no HTTP stream. It adds the single-writer
serialization above, which a remote endpoint handles on the server. So a libSQL default should
come **after** #32500's M2 lands, or be built as M2's first consumer, never as a separate
transaction implementation.

## 3. Install and startup

### Install size and native binaries

Registry sizes come from `npm view <pkg> dist.unpackedSize`. Installed sizes come from a cold-cache
`npm install` in an empty directory on this container.

| Package | Native binaries | Size |
|:--|:--|:--|
| `better-sqlite3@13.0.3` | 8 prebuilds in the one tarball (`gypfile: false`, nothing is compiled): darwin-arm64, darwin-x64, linux-x64, linux-arm64, linuxmusl-x64, linuxmusl-arm64, win32-x64, win32-arm64, about 1.9–2.4 MB each | 27.3 MB unpacked. Installed: 27.1 MB, 2 packages, 1.05 s cold cache |
| `@libsql/client@0.18.0` closure | one `libsql` platform package per OS/CPU, chosen as an optional dependency | 22.6 MB installed on linux x64: 9 packages, 2.05 s cold cache, **both** the gnu and musl binaries (they declare no `libc`, so npm installs both) |
| `@libsql/darwin-arm64@0.5.29` | | 7.8 MB |
| `@libsql/darwin-x64@0.5.29` | | 8.8 MB |
| `@libsql/linux-x64-gnu@0.5.29` | | 9.7 MB |
| `@libsql/linux-x64-musl@0.5.29` | | 9.9 MB |
| `@libsql/linux-arm64-gnu@0.5.29` / `-musl` | | 8.4 MB / 8.7 MB |
| `@libsql/win32-x64-msvc@0.5.29` | | 8.9 MB |
| `@libsql/win32-arm64-msvc` | **does not exist** (npm 404) | Windows on ARM has no libSQL binary. better-sqlite3 ships one |

Configuration A needs both packages (libSQL for the driver import, better-sqlite3 for the engine),
so it adds about 22.6 MB on Linux x64 to the 27.1 MB the default installs. A libSQL-only default
would save about 4.5 MB and drop Windows on ARM.

### Cold start

Harness H5 timed `os dev --fresh -p <port>` on `examples/app-crm`, from spawn to the first `200`
from `/api/v1/health`, under the verify lock, 5 runs each.

| | runs (ms) | median |
|:--|:--|--:|
| C0 (default) | 12,702 · 12,334 · 11,269 · 11,493 · 11,489 | 11,493 |
| A (`OS_DATABASE_DRIVER=turso`) | 11,836 · 11,476 · 12,119 · 12,745 · 11,691 | 11,836 |

The difference is within the run-to-run spread. The database is a small part of an 11–12 s boot
that compiles the config and seeds the app. B could not be booted through `os dev` (see the table
of configurations), so harness H6 compared the engines directly, with one fresh process per run and
the median of 3:

| ms, median of 3 | C0 | A | B |
|:--|--:|--:|--:|
| connect | 16 | 19 | 50 |
| `initObjects` 40 objects × 12 fields, new file | 77 | 75 | 38 |
| the same on reopen (boot over an existing file) | 112 | 107 | 20 |
| 2,000 sequential `create` | 371 | 358 | **3,615** (1,415–1,694 with WAL set on the file beforehand) |
| 2,000 `findOne` by id | 186 | 246 | 356 |
| 200 filtered, ordered `find` (limit 50) | 171 | 183 | 364 |
| 200 `count` | 43 | 32 | 25 |
| native module load + open, 5 runs | better-sqlite3 9.3–13.1 (median 9.9) | | `@libsql/client` 38.1–52.5 (median 51.2) |

B syncs the schema faster, but writes about 10× slower without WAL and about 4× slower with it.

### Platforms not measured here

macOS arm64 and x64, Linux musl at runtime, Windows x64 and Windows arm64 were not measured.
Only their registry sizes are above. The full `npx create-objectstack` first run was not measured
either. Its install-time difference is the package difference above. libSQL needs no build
scripts, and neither does better-sqlite3 13, which ships prebuilds, so neither one adds a
`pnpm approve-builds` step.

## 4. Existing projects

Harness H4 wrote a file with C0, as `os dev` leaves it (WAL, `auto_vacuum = INCREMENTAL`, 100
rows), and then did the following:

| Step | Result |
|:--|:--|
| open with raw `@libsql/client` | opens as is: `journal_mode = wal`, 100 rows, `integrity_check = ok` |
| open with B, add a column, read, write a row | ok: 50 of 50 boolean matches, json read back as an object, the row written |
| reopen with C0 | ok: the libSQL-written row reads back with its boolean, json and new column; 101 rows; `integrity_check = ok`; still WAL |
| unclean shutdown: copy the db and `-wal` while a better-sqlite3 writer holds 12,392 bytes of uncheckpointed WAL, then open the copy with libSQL | libSQL replays the WAL: the uncheckpointed row is there, `integrity_check = ok` |
| better-sqlite3 holds a write lock in one process while libSQL writes from another | `SQLITE_BUSY` (the locks interoperate across processes) |

So libSQL opens a better-sqlite3 file **as is**, with no conversion, and the move is
**reversible** while the file holds only platform tables. Two things change silently:

- **Column types.** Tables that B creates use `TEXT` / `REAL` / `INTEGER`. Tables that C0 created
  keep `varchar(255)` / `float` / `boolean`. Each engine reads the other's tables, but one file then
  holds two spellings.
- **Journal mode.** A file that B creates stays `delete`. A file that C0 created stays WAL.

**Reversibility ends when the file holds a libSQL vector index.** Section 6 measures that.

## 5. Other users of the default

`better-sqlite3` appears in 1,429 tracked files outside changelogs and the lockfile: 1,279 tests or
testkits, and 101 non-test source files under `packages/`. Four manifests declare it:
`packages/cli` (optional dependency, with `driver-sqlite-wasm` as the fallback), `driver-sql`,
`driver-turso` (optional peer, required for local and replica mode) and `plugin-sharing`. The paths
that would need a decision:

| Surface | What assumes better-sqlite3 | Effect of a libSQL default |
|:--|:--|:--|
| `@objectstack/runtime` `resolveStandaloneDatabase` / `standalone-stack.ts` | `file:` / `sqlite:` / a bare path resolves to the `sqlite` kind and `SqlDriver` with `{ filename }`. The `turso` arm passes `{ url, authToken }` only | the switch itself: the `file:` arm has to change kind, and the `turso` arm has to carry the engine choice |
| `@objectstack/cli` `utils/storage-driver.ts` (legacy serve path) | `SqliteFamilyEngine = 'better-sqlite3' \| 'sqlite-wasm' \| 'memory'` | the same switch on the second host. `driver-vocabulary-parity.test.ts` holds the two hosts equal |
| `@objectstack/service-datasource` `default-datasource-driver-factory.ts`, `sqlite-driver-fallback.ts` | builds better-sqlite3 connections and falls back to WASM SQLite when the native module is missing | needs a libSQL arm, or the fallback ladder changes |
| `cli/src/utils/sqlite-occupancy.ts` (gate on `os migrate apply`) | opens the file with better-sqlite3 for its lock probe (`PRAGMA locking_mode = EXCLUSIVE`, `BEGIN IMMEDIATE`) | works across processes (the locks interoperate), but it misreads a file that holds a vector index (section 6) |
| `cli/src/utils/local-customizations.ts` (`os build`) | opens the file read-only with better-sqlite3 and reads `sys_metadata` | same as above |
| `cli/src/utils/served-database-file.ts`, `schema-migrate.ts` | the `-wal` / `-shm` sidecars of a WAL file | B leaves new files in `delete` mode: no sidecars, and readers block writers |
| `os migrate plan` | `setDeferredDdl(true)` | 501 on B: the dry run is refused |
| `os migrate files-to-references`, datasource connection test, federation validation | `planMediaColumnMove()`, `introspectSchema()` | 501 on B (`introspectSchema` measured; `planMediaColumnMove` from the driver README's refusal table) |
| `driver-sql` | `isSqlite` / `client.driverName === 'better-sqlite3'` keys the dialect rules: journal mode, `auto_vacuum`, busy timeout, temporal SQL, JSON backfill | B's remote face borrows the dialect rules but not the connection pragmas |
| `@objectstack/verify` (`read-coercion.ts`) | names "memory / better-sqlite3" as the local repro that coerces | prose only |
| tests | 1,279 test or testkit files build better-sqlite3 drivers directly. driver-turso's remote conformance mostly runs on a better-sqlite3 stub wearing the `@libsql/client` interface (58 files on the stub, 21 on a real `createClient`) | the existing suites do not measure the libSQL engine. A libSQL default needs its own live cell, as the dialect matrix has for Postgres and MySQL |
| docs | `content/docs/data-modeling/drivers.mdx` (inference table, SQLite section), `deployment/backup-restore.mdx` (`sqlite3 .backup`; driver-turso `local` mode "via the same Knex + better-sqlite3 engine"), `deployment/cli.mdx`, `getting-started/your-first-project.mdx`, `plugins/packages.mdx`, `references/data/driver-sqlite.mdx` (generated) | rewrite at the switch |
| skills | `skills/objectstack-platform/SKILL.md` (driver table) and `references/operations.md` | rewrite at the switch |
| scaffold | `create-objectstack` template `pnpm-workspace.yaml` approves better-sqlite3 builds | unneeded for libSQL |

## 6. Vector search in the same file

`knowledge-turso` (in the cloud repository today, `packages/knowledge-turso`) opens its own
`@libsql/client` on its own url. For each source it creates a table with
`embedding F32_BLOB(<dim>)` and an index `libsql_vector_idx(embedding)` (DiskANN) with default
parameters, and it searches with `vector_top_k` plus `vector_distance_cos`. Harnesses H4, H4b and
H4e measured what sharing the platform file would cost.

**Under C0 or A it is unsafe in one process.** Two SQLite libraries in one process do not see each
other's POSIX locks. Measured in WAL mode: better-sqlite3 holds `BEGIN IMMEDIATE` with an
uncommitted insert, and libSQL in the same process inserts and returns success after 2 ms. After
better-sqlite3 commits, **libSQL's row is gone.** In `delete` mode, better-sqlite3's commit then
fails with `SQLITE_IOERR_DELETE_NOENT`. Across two processes the same pair answers `SQLITE_BUSY`
correctly. So a server running the platform on better-sqlite3 must never open the same file
through `knowledge-turso`.

**Under B it is safe within one process.** Platform creates on B and knowledge inserts on a second
client in one process (400 and 200 writes, interleaved) all succeeded, because the binding is
synchronous and one library tracks all the locks. Contention across processes is the section 2
problem.

**A vector index makes the file unreadable to stock SQLite tools.** Measured with better-sqlite3
on a file that holds one:

| Operation | Result |
|:--|:--|
| open; read and write platform tables | ok. An `SqlDriver` boot with `initObjects` works |
| `select count(*)` on the vector table | **0 instead of 200**. The plan is `SCAN … USING COVERING INDEX kb_vec_idx`, an index stock SQLite cannot maintain. `count(body)` and `NOT INDEXED` answer 200 |
| insert into the vector table | `unknown function: libsql_vector_idx()` |
| `integrity_check` / `VACUUM` | fail: `unknown function: libsql_vector_idx()` |
| `quick_check` | `wrong # of entries in index kb_vec_idx` |
| `PRAGMA incremental_vacuum` | ok |
| online backup (`db.backup()`) | ok. The copy reopens in libSQL and `vector_top_k` answers |

That breaks reversibility (section 4). It also breaks the `sqlite3` CLI's `integrity_check`, any DB
browser, and the CLI's better-sqlite3 probes on that file (section 5).

**Size.** 1,000 chunks of 1,536 dimensions, each with 800 bytes of text: 8.2 MB as rows. Building
the default DiskANN index took 21.8 s and grew the file to **329 MB** (40×). Inside the platform
file, that size lands in every `.backup`, every copy of `.objectstack/data`, and every
`rm -rf .objectstack/data` reset.

**Locking.** SQLite allows one writer per file. A reindex writing chunk rows serializes with every
platform write for its whole duration.

So `knowledge-turso` can share the platform file only once the platform runs on libSQL itself, as
in B. Even then it pays the size and locking costs above. A separate file such as
`.objectstack/data/knowledge.db` avoids all of them and needs none of this card's conditions.

## 7. Recommendation

**Switch on conditions. Do not switch now.**

- Switching to A, the literal reading of "driver-turso on a `file:` URL", changes the wrapper and
  not the engine. Parity is 100% (sections 1a and 1b) and the benefit is zero, at about 22.6 MB
  more install.
- Switching to B, the libSQL engine, today loses transactions, `os migrate plan`, introspection,
  window functions and query plans (all 501). It also loses WAL and a busy timeout: a second
  process lost 292 and 204 of 300 writes, against 0 of 600 on C0 and A. Writes are about 10×
  slower, boolean group keys diverge, and Windows on ARM has no binary.

Conditions for a later switch card, in order:

1. **#32500 M2 lands with a local-file arm.** The executor seam carries `@libsql/client`
   transactions on a `file:` url, with one serialized writer per file, WAL and a non-zero busy
   timeout. Measured bar: the two-process test above gives 600 of 600, and the H3 transaction rows
   match C0.
2. **The doors refused on B are served on the file arm:** `introspectSchema`, `setDeferredDdl`
   (`os migrate plan`), `findWithWindowFunctions`, `explain` (all four measured above), and
   `planMediaColumnMove` and `rotateShards` (refused per the driver README, not measured here). Measured bar: H1 and H2 at C0's counts with no Knex seeding.
3. **The remote face presents aggregate group keys** as `formatOutput` presents rows (the finding
   below). That also fixes the hosted product.
4. **A libSQL live cell in the dialect matrix**, so the parity is guarded on the real engine and
   not on the better-sqlite3 stub.
5. **A decision on Windows on ARM**, which has no `libsql` binary: keep better-sqlite3 as its
   default, or accept a WASM fallback.
6. **A one-way-door rule for vector indexes in the platform file.** Either they never go there, or
   the switch card documents that reverting needs `DROP INDEX` first, and moves the CLI's stock-SQLite
   probes (occupancy, local customizations) to libSQL.

Migration path once those hold: the default resolver maps `file:` to the libSQL arm and the
existing file is opened as is (section 4). New tables get the libSQL column spellings and old
tables keep theirs. `OS_DATABASE_DRIVER=sqlite` stays the escape hatch back, valid until a vector
index enters the file. Docs, skills and the scaffold follow (section 5).

Cards the switch would need: the local-file arm under #32500 M2 (conditions 1 and 2); the
aggregate presentation fix (condition 3); the libSQL matrix cell (4); the Windows on ARM decision
(5); the switch itself with the resolver, CLI probes, docs and skills (6 and the migration path).
Under D12 they come after the knowledge platform. Until then, phase 2's `knowledge-turso` should
use its own libSQL file.

## Findings outside this card

- **Remote-face `aggregate` returns boolean group keys as `1` / `0`** where the local face returns
  `true` / `false`. Measured through `ObjectQL.aggregate` with the hosted construction
  (`libsql://` url + a `file:` client) and with B. The local face presents them through
  `presentReadColumns`. The remote face returns the transport's rows unpresented, against the
  driver's own statement that its remote helpers exist "so both transports agree on what a value
  *is*". The HTTP door (`/api/v1/data/:object/aggregate` on a hosted deployment) was not measured.
- The CLI's missing-URL refusal for `turso` suggests `file:./data/objectstack.db for a local libSQL
  file`. That file is opened by better-sqlite3 (configuration A), not by libSQL.
- driver-turso's remote-mode conformance runs mostly on a better-sqlite3 stub (58 files) and not on
  the libSQL engine (21 files). The stub's header explains why ("libsql IS SQLite"), but SQLite
  3.53.4 and libSQL's 3.45.1 base are not the same engine.
