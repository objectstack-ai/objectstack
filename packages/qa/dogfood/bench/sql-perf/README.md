# SQL performance baseline

A repeatable benchmark of the read paths the SQL-performance epic is about, on a
real SQL database: SQLite (the `better-sqlite3` SqlDriver) and PostgreSQL. It is
the M0 baseline: it measures, it fixes nothing, and it is not part of the
dogfood test suite (vitest only collects `test/**`).

## Run it

```bash
pnpm --filter '@objectstack/cli...' build      # the closure `os dev` needs; OS_SKIP_DTS=1 is fine
node packages/qa/dogfood/bench/sql-perf/bench.mjs --dialect sqlite --scale 100000
node packages/qa/dogfood/bench/sql-perf/bench.mjs --dialect pg --scale 100000 \
  --pg-url postgres://postgres@127.0.0.1:5432/postgres
```

| flag | default | meaning |
|:--|:--|:--|
| `--dialect` | `sqlite` | `sqlite` or `pg` |
| `--scale` | `100000` | line-item rows; parents are `scale/10` opportunities and `scale/100` accounts |
| `--iterations` / `--warmup` | `20` / `3` | timed and untimed requests per scenario |
| `--pg-url` | `$OS_BENCH_PG_URL` | an admin connection; the run drops and recreates `os_sqlperf_<scale>` there |
| `--work-dir` | `$TMPDIR/os-sql-perf-bench` | the SQLite file, the server logs, `results/` |
| `--only` | all | a comma-separated subset of scenario names |
| `--boot-timeout-ms`, `--request-timeout-ms`, `--seed-timeout-ms` | 240 s, 120 s, 30 min | every phase has a deadline; an overrun fails the run instead of hanging |
| `--shares` | `0` | R9: seed N `sys_record_share` read grants to the member, on accounts it does not own |
| `--db-latency-ms` | `0` | R8, `pg` only: route the server's database connection through a proxy that adds N ms per round trip |
| `--grants-cache-ttl-ms` | unset | R8: boot the measuring server with `OS_AUTHZ_GRANTS_CACHE_TTL_MS=N` (unset = the shipped default, off) |
| `--sql-log` | off | every statement of one warm request per scenario, the member's included (see below); timings of such a run carry the log's cost |

The run writes `results/<dialect>-<scale>.json` (every sample, plus the SQL text
of each admin scenario) and `results/<dialect>-<scale>.md` (the table). A run
with any of the four legs above suffixes both names (`-shares900`, `-rtt10`,
`-gc60000`, `-sqllog`), so it never overwrites the baseline's files.

## What it does

1. Boots `./app` with `os dev --no-watch` on the chosen database, so schema sync
   creates the tables and indexes exactly as a deployment would.
2. Signs in the dev admin, mints a member through `POST /auth/admin/create-user`,
   and writes one row per object through the API, to learn the system columns
   (organization, owner) the runtime stamps.
3. Stops the server and bulk-loads the tables directly (a million rows through
   the API would take hours), then runs `ANALYZE`.
4. Boots again and times each scenario over HTTP, sequentially, with
   `OS_SERVER_TIMING=true`.

### The data set

`bench_region` (20) <- `bench_account` (scale/100, **private** OWD, lookup region)
<- `bench_opportunity` (scale/10, `controlled_by_parent`, master_detail account)
<- `bench_line_item` (scale, `controlled_by_parent`, master_detail opportunity,
lookup `bench_product` (200)). The member owns every tenth account, so it reads
10% of every level, through the nested controlled-by-parent chain.

### The numbers

- **p50 / p95 ms** — client wall time per request (nearest rank).
- **server p50 ms** — the `total` mark of `Server-Timing`.
- **db ms p50** and **SQL statements** — the `db` mark: the SQL driver counts
  every statement a request runs, identity and permission reads included.
- The admin's SQL text comes from `X-OS-Debug-Timing: json`, which the server
  discloses to an admin only and caps at the 20 slowest statements; the
  member's count is exact, its text is not shown there.
- `--sql-log` gets every statement, for both users: the measuring server runs
  with knex's `DEBUG=knex:query`, and after the warmup the bench sends one more
  request per scenario and keeps the lines the server log gained during it
  (requests run one at a time). Background work that runs during that request
  lands in the same lines; the run prints each scenario whose logged count
  differs from its `Server-Timing` count.

### The legs for R8, R9 and R10

- **R8, per-request identity reads.** `public_list_tiny` reads a public object
  (one page, one count), so every other statement is identity and permission
  work. `--grants-cache-ttl-ms` turns the grants cache on; the run records the
  server's own `[authz-cache]` boot line as the proof. `--db-latency-ms` puts
  an in-process TCP proxy between the server and PostgreSQL that holds every
  chunk half the round trip in each direction; the run measures `select 1`
  directly and through the proxy and records how many chunks it forwarded.
- **R9, sharing read scope.** `--shares N` writes the grants as the sharing
  service stores a manual one, spread over the accounts the member does not
  own. The run checks what the member sees: its account total against owned +
  shared, and the first and the last shared account read by id. Past 5000
  grants those disagree (see the R9 addendum on the epic).
- **R10, roll-up recompute.** Three fixed-size pairs, `bench_roll0..2` (200
  parents, 50 children each), identical but for 0, 1 and 2 `summary` fields on
  the parent. `rollupN_insert_pP` / `rollupN_update_pP` write 50 children through
  `createMany` / `updateMany` over P = 1 or 10 distinct parents;
  `rollupN_insert_one` writes one. Every call writes different values. The
  pair with no summary field is the control: its statement count is what the
  write costs without any recompute.

### The paged-list total (R12)

Every paged-list scenario (a `GET` with `top=`) runs again as
`<name>_nocount`, the same request with `count=false`. The list door then skips
the `count(*)` it otherwise runs over the full predicate beside the page, so a
pair's difference in time and in statements is what the total costs. The
twin's rows/total cell shows no total: that is the proof the opt-out was
honoured. `--only list_filter_sort,list_filter_sort_nocount` runs one pair.

The machine is shared and the numbers are wall-clock: compare runs on the same
box, read the statement counts as exact and the milliseconds as indicative.

## SQL pairs (`micro.mjs`)

On a database `bench.mjs` has seeded, `micro.mjs` times the statement the engine
runs today beside the one it could run (same flags: `--dialect`, `--scale`,
`--pg-url`, `--work-dir`). Its "today" SQL is hand-copied from the statements
`bench.mjs` captured, so each report carries the commit it was taken at. The
index pairs create a temporary index, drop any left-over copy before the
"before" reading, and print the planner's plan beside the time: a gain that
comes with an unchanged plan is noise, not the index. The default-order pair is
timed twice on the admin page: chained, as the engine emits it today, and with
the vacuous controlled-by-parent chain dropped.

`--only` picks groups: `m0` (I1 to I8, the M0 pairs), `r9` (I9, the share scope:
needs a database `bench.mjs --shares N` seeded) and `r10` (I10, the roll-up
recompute). I9 and I10 compare the answer as well as the time: a faster
statement that answers differently is not a rewrite, and where it differs on
purpose (more than 5000 grants) the row says so.
