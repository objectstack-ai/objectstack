---
"@objectstack/cli": major
"@objectstack/runtime": major
---

fix(cli,runtime)!: `os start` and `os migrate` finally read the same driver vocabulary (#6345)

One environment variable had two answers. Measured on `main` by driving the real
entry points — `resolveDriverType` + `resolveStorageDefinition` for the `os start`
side, `resolveStandaloneDatabase` for the `os migrate` side — **10 of 21
spellings disagreed**:

```
OS_DATABASE_DRIVER=pg OS_DATABASE_URL=postgres://…  os start        → boots
OS_DATABASE_DRIVER=pg OS_DATABASE_URL=postgres://…  os migrate plan → refused by name
```

`sql`, `wasm`, `wasm-sqlite`, `postgresql`, `pg`, `mysql2`, `mongo`, `mingo`,
`in-memory` and `libsql` were accepted by the CLI and refused by the standalone
stack. Both sides were separately correct and separately pinned; the missing test
was the CROSS-host one, and it now exists
(`packages/cli/src/utils/driver-vocabulary-parity.test.ts` — the only place that
can import both).

**Both hosts now resolve through `@objectstack/spec`'s one driver table.** The
CLI's hand-written `driverType === 'pg' || driverType === 'postgresql'` chains
and the standalone stack's canonical-only `z.enum` are both gone; a driver added
to the spec table appears on both hosts at once, which is the only shape in which
this fork cannot re-open. The standalone `databaseDriver` CONFIG key accepts the
same aliases as `OS_DATABASE_DRIVER`, so the fork cannot relocate to inside one
host either.

**BREAKING ① — selecting a driver whose database lives elsewhere, without saying
where, now refuses.** Four kinds have no local default (`postgres`, `mysql`,
`mongodb`, `turso`), and before this change each side guessed, differently:

| selection, no URL | `os start` before | `os migrate` before | now, both |
| :-- | :-- | :-- | :-- |
| `postgres` | `config.url === undefined` → `pg` connects to ITS localhost:5432 | `file:<state>/data/objectstack.db` | typed refusal |
| `mysql` | `config.url === undefined` | `file:…objectstack.db` | typed refusal |
| `mongodb` | invented `mongodb://localhost:27017/objectstack` | `file:…objectstack.db` | typed refusal |
| `turso` | typed refusal (#5602) | `file:…objectstack.db` | typed refusal |

Eight cells, seven of them wrong in one of two ways: connect the operator to a
database they never named, or hand a server driver a `file:` DSN and let it fail
two layers from the cause. `turso` already said the right sentence; this
generalizes it rather than leaving one kind honest and three guessing. Only the
FALLBACK rungs are refused — a URL from `--database`, `OS_DATABASE_URL`,
`DATABASE_URL`, `TURSO_DATABASE_URL` or the project's declared default datasource
is a statement about where the database is, and is honoured as before, `file:`
DSN included.

**BREAKING ② — an explicitly-named unknown driver refuses on the CLI side too.**
`os dev --database-driver sqlite3` used to fall through to the dev SQLite default
and boot in silence, while `os migrate` refused the same value by name (#6344
killed the silent fallback on that side only). `''` (nobody chose) keeps its old
answer — dev default, `null` in production; a non-empty value can only have come
from an operator, since URL inference yields a canonical id or `''`. The refusal
enumerates the spellings that actually work, from the shared table.

**Widened, not narrowed:** every spelling either host accepted before is accepted
by both now. `sqlite3` / `better-sqlite3` / `mariadb` / `inmemory` stay out of the
selection face on both — neither host ever accepted them as a boot selection, and
converging two hosts is not a licence to widen the flag. They keep resolving a
config CONTRACT, so a stored `driver: 'sqlite3'` datasource is unaffected.

**Why `major` on both.** ① and ② each turn a boot that started into a boot that
refuses. A deployment that really did run postgres on localhost with trust auth,
or that relied on `mongodb://localhost:27017/objectstack`, was working by
accident and now gets a message telling it what to set — but it was working, and
calling that a `patch` because the old behaviour was a bug would let the change
arrive unannounced in a changelog. The alias widening on its own would be
`minor`; the refusals are what price this at `major`.

**Migration.** The stored half of this change is the `mongo` → `mongodb`
canonical-id rename, which both hosts now resolve through the shared table; it is
registered as the ADR-0087 D2 conversion `datasource-driver-mongo-to-mongodb`
and needs no action from anyone — `migrate meta` converges the rows and `mongo`
stays accepted meanwhile. The two refusals have no stored form and no codemod:
they prescribe an operator action (set the database URL, or fix the driver
value) whose correct answer is a fact only the operator has, which is why the
messages name the variable, show the target shape, and say what booting anyway
would have cost.

<!-- adr-0087: registered datasource-driver-mongo-to-mongodb -->
