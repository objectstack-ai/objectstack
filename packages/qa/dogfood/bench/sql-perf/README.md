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

The run writes `results/<dialect>-<scale>.json` (every sample, plus the SQL text
of each admin scenario) and `results/<dialect>-<scale>.md` (the table).

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
  discloses to an admin only; the member's count is exact, its text is not shown.

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
