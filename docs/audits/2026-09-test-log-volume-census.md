# Test-run log volume census — both channels, all 72 packages

**Measured on `origin/main` `b1d49b394`, 2026-09-03T11:41 UTC.** Instrument:
`scripts/qa/log-volume-census.mjs` (this document states nothing the instrument
cannot be re-run to produce).

This extends an earlier reading that covered five suites and left the rest
unmeasured. The question it was dispatched to answer is narrow and it is worth
stating before any number:

> Does the ratio the five suites showed — structured logger ≈ 45% of everything
> a test run writes — hold across the other 67 packages?

**Answer: no, and not in the direction the phrasing suggests.** Across all 72
packages the structured logger is **77.1%** of the output (61,980 of 80,401
lines) — not lower than the five-suite reading, higher. The other 67 packages
are not what moved it: two commits that landed on `main` in the three days
between the earlier reading and this one already took the *original five*
suites from ~45% to ~87% structured on their own, by cutting a debug-only
`console.log` population out of four of them. Extending to all 72 packages
pulls that back down to 77.1%, not because the extra 67 reverse the direction,
but because they are collectively a smaller, more console-leaning slice of
total volume than the five heaviest suites already were. See
[The answer](#the-answer) for the arithmetic.

## What is NOT claimed here

- **No urgency, no correctness impact.** This is CI log volume. The earlier
  reading said so and nothing here changes it.
- **No seam was added, and none is recommended.** The two candidates — an env
  read in the kernel logger, a level field on `BootOptions` — both touch
  published surface, and choosing between them is not a measurement.
- **"A reader of a production boot log may well want every one of these
  lines."** Test-environment noise and production observability are two ends of
  one switch. Nothing here is an argument for lowering the engine's boot INFO
  verbosity; that judgement is not this document's to make.

## Method

For each of the 72 workspace packages that declare a `test` script, the
package's **own** `test` script is run **unchanged** — `pnpm --filter <name> run
test` — and its **combined stdout+stderr** is captured to a file. No package's
vitest config, harness or environment is modified; nothing is added to the
environment except `NODE_OPTIONS=--max-old-space-size=4096` and
`VITEST_MAX_WORKERS=2`, which bound memory and worker count on a shared box and
change interleaving, not which lines are emitted. `CI` is passed through as the
caller has it, never forced — code that branches on `CI` would otherwise be
measured in a mode nobody runs the suite in.

Every captured line is stripped of ANSI SGR sequences and classified:

| bucket | rule |
|---|---|
| **structured** | matches `^<ISO-8601 ms timestamp> (DEBUG\|INFO\|WARN\|ERROR\|FATAL)\b`, the head `ObjectLogger.write()` composes for formats `pretty` (the default) and `text`; plus the `json` format's `{"time":…,"level":…` prefix |
| **reporter** | vitest's own reporter vocabulary plus the pnpm script banner — a closed, enumerated list |
| **console** | everything else |

### The limits, stated

- **`console` is a complement, not a positive identification.** Anything that
  writes to stdout with neither the logger's head nor a reporter shape lands in
  it — a bare `process.stdout.write` from build or seed code included. The
  failure direction is over-counting `console`, never over-counting
  `structured`.
- **There is no channel-level discriminator available, and that is a property
  of the repo, not of the instrument.** All 72 vitest configs set
  `disableConsoleIntercept: true` — enforced by
  `scripts/check-console-intercept-disarm.mjs` — so console output is *not*
  forwarded over vitest's RPC and carries no `stdout | <file> > <test>` header.
  Both populations land on the same two file descriptors, unlabelled.
  Separating them at capture time would mean changing how a package runs its
  tests, which measures a different thing than the suite anyone actually runs.
- **A multi-line `console.*` payload counts as N lines** — a stack trace is
  worth its height. This matches the earlier reading's definition.
- **A red suite writes more than a green one.** Every row carries its exit
  code and non-zero rows are flagged; they are not silently averaged in.
- **Durations are shared-box readings.** Suites ran under this container's
  shared verify lock with other agents on the machine. Ratios survive
  contention; wall-clock absolutes do not, and none are quoted as performance.

## The instrument writes to `process.stdout` directly — verified, not inferred

`packages/core/src/logger.ts:350-395`:

```ts
const isErrorLevel = level === 'error' || level === 'fatal';
const proc = typeof process !== 'undefined' ? (process as any) : undefined;
const stream = proc ? (isErrorLevel ? proc.stderr : proc.stdout) : undefined;
…
if (stream) {
    stream.write(line + '\n');
} else if (typeof console !== 'undefined') { … }
```

The `console` branch is browser-only fallback: it is reached only when
`process` is absent or carries no stdio streams. Observed, with a positive
control:

| probe | result |
|---|---|
| replace all four `console` methods, then emit one `info` and one `error` through a default logger | **0** lines seen by `console` |
| positive control: the same replacement over a real `console.log` | **1** line captured |
| `info` with stderr discarded | `INFO-PROBE` present on **stdout** |
| `error` with stdout discarded | `ERROR-PROBE` present on **stderr** |

So the logger is invisible to any instrument that watches `console`, in either
direction — which is the whole reason this population went uncounted.

## The premise re-verification: no seam a test author can reach

Each of the three claims re-checked on this tree, each with a control.

### The kernel logger reads no level from the environment

`ObjectLogger`'s constructor takes `level: config.level ?? 'info'`
(`packages/core/src/logger.ts:236`). The only `process.env` read in the whole
file is `NO_COLOR` (`:180`), for color, not level.

Observed — one `info()` call through a default logger, counting the emitted
line:

| environment | lines emitted |
|---|---|
| nothing set | 1 |
| `OS_LOG_LEVEL=silent` | 1 |
| `LOG_LEVEL=silent` | 1 |
| `OS_CORE_LOG_LEVEL=silent` | 1 |
| `OS_REGISTRY_LOG=warn` | 1 |
| **positive control** `createLogger({ level: 'silent' })` | **0** |
| **positive control** `createLogger({ level: 'error' })` | **0** |

The positive controls are the point: the probe *can* see suppression, so the
five zeros above them are a reading and not a broken probe.

### `BootOptions` declares no logger field, and the harness passes no config at all

`packages/verify/src/harness.ts`, `export interface BootOptions` spans lines
**96–313** and declares exactly ten fields: `admin`, `authSecret`, `security`,
`analytics`, `multiTenant`, `orgContext`, `hostRoot`, `automation`,
`databaseFile`, `extraPlugins`. No logger, no level.

Type-level control (`tsc --noEmit`, package tsconfig):

```
src/__d2-control-strict.ts(2,37): error TS2353: Object literal may only specify
  known properties, and 'logLevel' does not exist in type 'BootOptions'.
```

while the positive control `const positive: BootOptions = { databaseFile: ':memory:' }`
compiles clean.

⚠️ **The wire is missing one layer lower than the card said, which makes the
premise stronger rather than weaker.** `harness.ts:384` constructs the kernel
as:

```ts
const kernel = new ObjectKernel();
```

— no config object at all. `ObjectKernel`'s constructor does accept
`config.logger` (`packages/core/src/kernel.ts:87`, `this.logger =
createLogger(config.logger)`), so a seam exists *at the kernel*; what does not
exist is any path from a suite to it. Adding a `BootOptions` field would
therefore also mean threading it through this call — it is not a one-line
forward of something already being passed.

**A second, un-asked-for finding, relevant to which seam triage picks:** the
bare `new ObjectKernel()` call in `harness.ts` is not an isolated case.
Repo-wide, `new ObjectKernel(` appears **85 times across 62 files**
(`grep -rn 'new ObjectKernel(' --include='*.ts' packages examples`), most of
them test files constructing a kernel directly rather than through
`packages/verify`'s harness — `packages/objectql/src/kernel-factory.ts:35`
(the factory objectql's own suite boots through, contributing 11,326 of the
61,980 structured lines measured here — 18.3% of the total) is one of them,
with the identical `new ObjectKernel()` — no config — shape. **A `BootOptions`
field on `packages/verify`'s harness would quiet only the suites that boot
through that one harness; it would not reach objectql's kernel construction,
or any of the other ~60 call sites, without each of them being found and
updated individually.** An env-level default read inside the kernel or logger
construction itself (`NO_COLOR`'s existing pattern in the same file is the
precedent) would cover all 85 call sites without touching any of them. This
does not choose a seam — it changes what "choosing" would cost.

### `OS_LOG_LEVEL` is resolved in the CLI and read nowhere below it

Repo-wide, `OS_LOG_LEVEL` is read in exactly one non-test source file:
`packages/cli/src/utils/log-level.ts:53`
(`readEnvWithDeprecation('OS_LOG_LEVEL', 'LOG_LEVEL', …)`). Its consumers are
`packages/cli`'s `serve`, `start` and `dev` commands, which hand a level to the
kernel they spawn. No package outside `packages/cli` reads it.

End-to-end control — `resolveLogLevel()` (`packages/cli/src/utils/log-level.ts`),
called directly from the built `packages/cli/dist`, to confirm the probe can
see a level change before trusting that nothing else reads one:

| call | resolved level |
|---|---|
| `resolveLogLevel({})` | `warn` (the CLI default) |
| `resolveLogLevel({ envLevel: 'debug' })` | **`debug`** |
| `resolveLogLevel({ envLevel: 'silent' })` | **`silent`** |
| `resolveLogLevel({ flag: 'error', envLevel: 'debug' })` | `error` (flag beats env) |
| `resolveLogLevel({ verbose: true, envLevel: 'silent' })` | `debug` (`--verbose` beats both) |

The function is demonstrably sensitive to its input, so the repo-wide grep is
not a probe that happened to see nothing: `grep -rn 'OS_LOG_LEVEL\b'` across
every `.ts`/`.mjs`/`.js` (excluding `dist/`) returns exactly one non-`cli`,
non-test hit — `scripts/pm/dispatch-gates.mjs:14461`, a string literal inside
that script's own self-test fixture, not a read. Every other match is
`packages/cli/src/**` (the resolver plus the three commands that call it) or
`packages/cli/test/**` (tests of that resolution — a package testing its own
env read is expected and not a seam into some other suite).

**⇒ All three premise claims hold. No pre-existing seam was found, so the
card's purpose is unchanged.**

## Reproduction of the five-suite reading

A census that cannot reproduce a known answer is not trustworthy for the
unknown ones, so the five suites were re-run first.

The tree has moved **410 commits** between the earlier reading
(`eb649cb8bc`, 2026-08-31 20:55 UTC) and this one (`b1d49b394`, 2026-09-03
11:41 UTC), and two of those commits act directly on the population being
measured:

- **`b79ddf17d` (#13985, 2026-08-31)** — declares `OS_REGISTRY_LOG=warn` in
  **dogfood**'s vitest harness. Its own commit message measures the population
  it removes: *"66,976 lines to stdout per full run; 39,738 of them (94.9% of
  everything it writes through `console`)"* — 66,976 is, to the line, the
  earlier reading's dogfood total.
- **`5e2c04da7` (#14016, 2026-09-01)** — the same declaration for **objectql,
  verify and runtime**, removing 4,744 / 2,323 / 1,155 `[Registry]` lines
  respectively, measured at `b1b7d6088a`.

`packages/rest` received no such declaration. It is therefore a **natural
control**: the one suite of the five whose console population nothing touched.

| suite | earlier `console` | expected after #13985/#14016 | measured now | earlier `structured` | measured now |
|---|---:|---:|---:|---:|---:|
| `packages/qa/dogfood` | 41,858 | 2,120 | **1,738** | 25,118 | **26,707** |
| `packages/objectql` | 5,347 | 603 | **533** | 10,831 | **11,326** |
| `packages/runtime` | 2,069 | 914 | **815** | 4,658 | **5,550** |
| `packages/verify` | 2,574 | 251 | **221** | 3,093 | **3,171** |
| `packages/rest` *(control — untouched)* | 3,963 | 3,963 | **4,192** | 1,290 | **1,672** |

Residual `[Registry]` lines in the current captures confirm the mechanism
rather than assuming it: dogfood 2, verify 0, runtime 9, objectql 66 — and
rest, the untouched control, **528**.

**Verdict: the instrument reproduces.** Every `structured` figure lands within
+2.5% to +30% of the earlier reading on a tree 410 commits younger, and every
`console` figure lands within 3–18% of what the two intervening commits
predict. The control suite moved +5.8% on `console`, i.e. did not collapse,
which is what makes the other four collapses attributable rather than
instrument drift.

## The census

**All 72/72 packages measured.**

| package | console | structured | reporter | total | exit |
|---|---:|---:|---:|---:|---|
| `examples/app-crm` | 48 | 60 | 13 | 121 | ok |
| `examples/app-showcase` | 346 | 61 | 13 | 420 | ok |
| `examples/app-todo` | 482 | 0 | 13 | 495 | ok |
| `examples/embed-objectql` | 1 | 7 | 13 | 21 | ok |
| `packages/adapters/hono` | 0 | 0 | 13 | 13 | ok |
| `packages/cli` | 1,608 | 4,926 | 49 | 6,583 | ok |
| `packages/client` | 229 | 325 | 13 | 567 | ok |
| `packages/client-react` | 3 | 0 | 13 | 16 | ok |
| `packages/cloud-connection` | 3 | 0 | 13 | 16 | ok |
| `packages/connectors/connector-mcp` | 0 | 61 | 13 | 74 | ok |
| `packages/connectors/connector-openapi` | 0 | 112 | 13 | 125 | ok |
| `packages/connectors/connector-rest` | 0 | 238 | 13 | 251 | ok |
| `packages/connectors/connector-slack` | 0 | 167 | 13 | 180 | ok |
| `packages/core` | 18 | 228 | 13 | 259 | ok |
| `packages/create-objectstack` | 0 | 0 | 13 | 13 | ok |
| `packages/drivers/driver-memory` | 2 | 593 | 13 | 608 | ok |
| `packages/drivers/driver-mongodb` | 7 | 0 | 13 | 20 | ok |
| `packages/drivers/driver-sql` | 223 | 0 | 13 | 236 | ok |
| `packages/drivers/driver-sqlite-wasm` | 3 | 0 | 13 | 16 | ok |
| `packages/drivers/driver-turso` | 9 | 0 | 13 | 22 | ok |
| `packages/formula` | 0 | 0 | 13 | 13 | ok |
| `packages/lint` | 15 | 0 | 13 | 28 | ok |
| `packages/mcp` | 0 | 0 | 13 | 13 | ok |
| `packages/metadata` | 24 | 168 | 13 | 205 | ok |
| `packages/metadata-core` | 0 | 0 | 13 | 13 | ok |
| `packages/metadata-fs` | 0 | 0 | 13 | 13 | ok |
| `packages/metadata-protocol` | 308 | 0 | 13 | 321 | ok |
| `packages/objectql` | 533 | 11,326 | 16 | 11,875 | ok |
| `packages/observability` | 0 | 0 | 13 | 13 | ok |
| `packages/platform-objects` | 0 | 0 | 13 | 13 | ok |
| `packages/plugins/embedder-openai` | 0 | 0 | 13 | 13 | ok |
| `packages/plugins/knowledge-memory` | 0 | 0 | 13 | 13 | ok |
| `packages/plugins/knowledge-ragflow` | 0 | 0 | 13 | 13 | ok |
| `packages/plugins/plugin-approvals` | 428 | 300 | 13 | 741 | ok |
| `packages/plugins/plugin-audit` | 658 | 889 | 13 | 1,560 | ok |
| `packages/plugins/plugin-auth` | 2,678 | 2,149 | 13 | 4,840 | ok |
| `packages/plugins/plugin-dev` | 0 | 0 | 13 | 13 | ok |
| `packages/plugins/plugin-email` | 6 | 60 | 13 | 79 | ok |
| `packages/plugins/plugin-hono-server` | 0 | 1 | 13 | 14 | ok |
| `packages/plugins/plugin-pinyin-search` | 0 | 0 | 13 | 13 | ok |
| `packages/plugins/plugin-reports` | 247 | 8 | 13 | 268 | ok |
| `packages/plugins/plugin-security` | 305 | 422 | 13 | 740 | ok |
| `packages/plugins/plugin-sharing` | 633 | 149 | 13 | 795 | ok |
| `packages/plugins/plugin-webhooks` | 126 | 440 | 13 | 579 | ok |
| `packages/qa/dogfood` | 1,738 | 26,707 | 25 | 28,470 | ok |
| `packages/qa/downstream-contract` | 0 | 0 | 13 | 13 | ok |
| `packages/qa/http-conformance` | 250 | 302 | 13 | 565 | ok |
| `packages/rest` | 4,192 | 1,672 | 13 | 5,877 | ok |
| `packages/runtime` | 815 | 5,550 | 13 | 6,378 | ok |
| `packages/sdui-parser` | 0 | 0 | 13 | 13 | ok |
| `packages/services/service-analytics` | 1 | 294 | 13 | 308 | ok |
| `packages/services/service-automation` | 333 | 607 | 13 | 953 | ok |
| `packages/services/service-cache` | 0 | 0 | 13 | 13 | ok |
| `packages/services/service-cluster` | 5 | 0 | 13 | 18 | ok |
| `packages/services/service-cluster-redis` | 9 | 0 | 13 | 22 | ok |
| `packages/services/service-datasource` | 24 | 16 | 15 | 55 | ok |
| `packages/services/service-i18n` | 4 | 0 | 13 | 17 | ok |
| `packages/services/service-job` | 0 | 0 | 13 | 13 | ok |
| `packages/services/service-knowledge` | 0 | 32 | 13 | 45 | ok |
| `packages/services/service-messaging` | 242 | 380 | 13 | 635 | ok |
| `packages/services/service-package` | 6 | 0 | 13 | 19 | ok |
| `packages/services/service-queue` | 0 | 0 | 13 | 13 | ok |
| `packages/services/service-realtime` | 0 | 0 | 13 | 13 | ok |
| `packages/services/service-settings` | 115 | 341 | 13 | 469 | ok |
| `packages/services/service-sms` | 0 | 0 | 13 | 13 | ok |
| `packages/services/service-storage` | 113 | 218 | 13 | 344 | ok |
| `packages/spec` | 15 | 0 | 17 | 32 | ok |
| `packages/triggers/trigger-api` | 0 | 0 | 13 | 13 | ok |
| `packages/triggers/trigger-record-change` | 401 | 0 | 13 | 414 | ok |
| `packages/triggers/trigger-schedule` | 0 | 0 | 13 | 13 | ok |
| `packages/types` | 1 | 0 | 13 | 14 | ok |
| `packages/verify` | 221 | 3,171 | 13 | 3,405 | ok |
| **total, 72/72 suites measured** | **17,428** | **61,980** | **993** | **80,401** | |

structured share of total, structured / (structured+console+reporter) —
comparable to the 5-suite framing, whose own `console` already absorbed what
this instrument tracks separately as `reporter`: **77.1%**

structured share of console+structured alone, reporter set aside: 78.1%

measured: 72/72

non-zero exit: 0

## The answer

**No — the ratio does not hold, and it moved in the opposite direction from
the one "the other 67 packages are noisier" would predict.**

All 72 packages, all green (exit 0), totals from the ledger:

| | console | structured | reporter | total |
|---|---:|---:|---:|---:|
| **all 72 packages** | 17,428 | 61,980 | 993 | 80,401 |

- **structured share of total** (the metric comparable to the earlier
  reading's own convention, where `console + structured == total` with no
  separate reporter bucket — i.e. `structured / (structured + console +
  reporter)`): **77.1%**.
- **structured share of console+structured alone** (reporter's own ~1% of
  total set aside): 78.1%. The two are close because `reporter` is a small,
  closed vocabulary (993 of 80,401 lines, 1.2%) — see Method.

**Why it moved this far, decomposed:**

1. **The original five suites, re-measured on today's tree, are already at
   86.6% structured** (48,426 structured / 55,925 console+structured — from
   the "Reproduction" table above), not ~45%. Two commits explain essentially
   all of that move: `b79ddf17d` (#13985) and `5e2c04da7` (#14016) each
   declared `OS_REGISTRY_LOG=warn` in a suite's vitest harness, cutting a
   `[Registry]` debug-`console.log` population that had been the majority of
   `console` output in dogfood, objectql, runtime and verify. `packages/rest`
   — the one suite of the five nothing touched — moved only +5.8% on
   `console`, which is what makes the other four attributable to those two
   commits rather than to this instrument reading differently than the
   original one did.
2. **Extending to the other 67 packages pulls the number back down, from
   86.6% to 77.1%, but not remotely far enough to reverse it.** Those 67
   packages contribute 24,396 of the 80,401 total lines (30.3%) — collectively
   a minority of test-run volume — and most of them are near-silent either
   way: **35 of the 72 packages write fewer than 30 lines total**, and **22
   of the 72 write exactly 13** — the reporter's own fixed banner with
   nothing else at all (a package whose suite has no tests that emit
   anything, structured or console). Structured lines require a kernel boot
   (`ObjectLogger`'s INFO-level startup chatter); a package whose suite never
   constructs one — most of `packages/services/*`, `packages/triggers/*`,
   `packages/drivers/*` (besides `driver-memory`), and several thin
   `plugins/*` — writes at or near zero of both.
3. **The marginal 67 packages' own structured share is 57.7%** (13,554
   structured / 23,483 console+structured among just that group) — lower
   than the reproduced five-suite figure, higher than the original ~45%
   reading. The largest genuinely console-**majority** contributors outside
   the original five (`console > structured`, sorted by `console`):
   `packages/plugin-auth` (2,678 console / 2,149 structured — its own suite
   boots a kernel and logs per-request auth denials), `packages/plugin-sharing`
   (633 / 149), `examples/app-todo` (482 / 0), `packages/plugin-approvals`
   (428 / 300) and `packages/trigger-record-change` (401 / 0). `packages/cli`
   has the second-highest raw `console` count outside the original five
   (1,608) but is itself majority-**structured** (4,926) — it belongs to the
   `console`-heavy-in-absolute-terms group, not the console-majority one.

**Reading the two effects together:** the five-suite figure this card cited
(~45%) was a snapshot from *before* #13985/#14016 landed. Re-running the same
five suites today already answers most of the question — the ratio was never
stable at 45%, because the population it measured moved out from under it in
three days. The extension to all 72 packages is the second, smaller
correction, and it is a real one: the untouched 67 packages are more
console-leaning on average (57.7%) than the five heaviest suites (86.6%), so a
full-repo reading is not simply "the five-suite number, unchanged." But at no
point does the combined population cross back toward parity, let alone toward
`console` being the majority — it stays firmly structured-dominated (77.1%)
throughout.

**No seam was added.** Per triage's ruling, this document is the measurement
only; which of the two candidate seams (if either) to build is triage's call,
made with this table in hand.
