---
'@objectstack/runtime': minor
---

**`createStandaloneStack` now dispatches `mysql://`, and an unknown `OS_DATABASE_DRIVER` value is refused instead of silently becoming SQLite** (#6265).

Two halves of one defect family: a driver selection this stack could not dispatch.

**`mysql://` — the #5820 split with a different scheme.** The CLI has classified `mysql://` / `mysql2://` as the `mysql` kind since forever (`inferDriverTypeFromUrl`), the shared datasource factory has always been able to build it (`SqlDriver` on the `mysql2` client), and `content/docs/data-modeling/drivers.mdx` lists it in the URL-inference table — only `detectDriverFromUrl()` in this package had no arm. So one `OS_DATABASE_URL=mysql://…` booted under `os start` and hard-failed under `os migrate` (which boots through this stack) with `Unsupported database URL scheme`.

- `mysql://…` and `mysql2://…` resolve to the `mysql` kind, matched by character-for-character the same regex the CLI uses — the two functions answer the same question about the same URL, so a divergence between them *is* the bug.
- The stack declares `{ driver: 'mysql', config: { url } }` and the shared factory builds it, exactly like `postgres`. No optional package and no new dependency: `mysql2` is already an optional peer of `@objectstack/driver-sql`, the same posture `pg` has, so a missing client surfaces at connect like it always did.
- `databaseDriver: 'mysql'` and `OS_DATABASE_DRIVER=mysql` are accepted; `sqliteFile` stays `null` for a MySQL target, so `os migrate`'s occupancy probe does not read a DSN as a file path.

**`OS_DATABASE_DRIVER` is validated now.** `databaseDriver` in config was parsed by a zod enum (loud rejection) while the env var was a bare `as` cast — an assertion that checks nothing at runtime. An unrecognised value matched no dispatch arm and landed in the chain's trailing `else`: SQLite, in silence. `OS_DATABASE_DRIVER=mysql` with no URL therefore created a local `standalone.db` while the operator believed they were talking to MySQL, and a typo (`mysq1`, `postgress`) did the same; with a URL set it surfaced as the doubly-misleading "sqlite driver was selected but the URL does not look like a file path" for someone who never selected sqlite. This is the #3276 class.

- Both paths now read **one** declaration (`StandaloneDatabaseDriverSchema`): the config key parses it, the env value parses it, the `ResolvedDriverKind` union is inferred from it, and the refusal enumerates its options rather than repeating them in a hand-written list.
- An unknown value throws, naming the value and every legal driver: `sqlite, sqlite-wasm, memory, postgres, mysql, mongodb, turso`. The env value is lower-cased first, matching the CLI's reader of the same variable; the accepted vocabulary is the enum and nothing else.
- The dispatch chain's trailing `else` is no longer "sqlite" — it is a `never` guard, so the *next* kind added to the enum without a dispatch arm is a compile error rather than a wrong database.

Unknown URL schemes still throw (the message now lists `mysql://`), and the "unknown driver" and "unknown URL scheme" refusals stay distinguishable.
