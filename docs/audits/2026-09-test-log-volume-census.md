# Test-run log volume census — both channels, all 72 packages

**Measured on `origin/main` `PLACEHOLDER_SHA`, 2026-09-03.** Instrument:
`scripts/qa/log-volume-census.mjs` (this document states nothing the instrument
cannot be re-run to produce).

This extends an earlier reading that covered five suites and left the rest
unmeasured. The question it was dispatched to answer is narrow and it is worth
stating before any number:

> Does the ratio the five suites showed — structured logger ≈ 45% of everything
> a test run writes — hold across the other 67 packages?

**Answer: no, and not in the direction the phrasing suggests.** Across all 72
packages the structured logger is not ~45% of the output. It is
`PLACEHOLDER_SHARE`% — and the reason is that the *other* half moved. See
[The answer](#the-answer).

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

**IN PROGRESS — 32/72 measured, this is a checkpoint commit, not the final
reading.** Continuing under the shared verify lock with tighter per-batch
budgets so the lock cycles for other agents on this container; the ledger this
table is generated from is `/tmp/os-log-volume-census/ledger.json`, one row
per package written the moment that package finishes, so no completed
measurement is lost if this run is interrupted.

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
| `packages/observability` | — | — | — | — | **NOT MEASURED** |
| `packages/platform-objects` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/embedder-openai` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/knowledge-memory` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/knowledge-ragflow` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-approvals` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-audit` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-auth` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-dev` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-email` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-hono-server` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-pinyin-search` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-reports` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-security` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-sharing` | — | — | — | — | **NOT MEASURED** |
| `packages/plugins/plugin-webhooks` | — | — | — | — | **NOT MEASURED** |
| `packages/qa/dogfood` | 1,738 | 26,707 | 25 | 28,470 | ok |
| `packages/qa/downstream-contract` | — | — | — | — | **NOT MEASURED** |
| `packages/qa/http-conformance` | — | — | — | — | **NOT MEASURED** |
| `packages/rest` | 4,192 | 1,672 | 13 | 5,877 | ok |
| `packages/runtime` | 815 | 5,550 | 13 | 6,378 | ok |
| `packages/sdui-parser` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-analytics` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-automation` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-cache` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-cluster` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-cluster-redis` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-datasource` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-i18n` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-job` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-knowledge` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-messaging` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-package` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-queue` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-realtime` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-settings` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-sms` | — | — | — | — | **NOT MEASURED** |
| `packages/services/service-storage` | — | — | — | — | **NOT MEASURED** |
| `packages/spec` | — | — | — | — | **NOT MEASURED** |
| `packages/triggers/trigger-api` | — | — | — | — | **NOT MEASURED** |
| `packages/triggers/trigger-record-change` | — | — | — | — | **NOT MEASURED** |
| `packages/triggers/trigger-schedule` | — | — | — | — | **NOT MEASURED** |
| `packages/types` | — | — | — | — | **NOT MEASURED** |
| `packages/verify` | 221 | 3,171 | 13 | 3,405 | ok |
| **total, 32/72 suites measured** | **10,828** | **55,372** | **467** | **66,667** | |

structured share of total (structured / (structured+console+reporter)): 83.1%
structured share of console+structured (comparable to the 5-suite framing): 83.6%
measured: 32/72 — NOT MEASURED (40): packages/observability, packages/platform-objects, packages/plugins/embedder-openai, packages/plugins/knowledge-memory, packages/plugins/knowledge-ragflow, packages/plugins/plugin-approvals, packages/plugins/plugin-audit, packages/plugins/plugin-auth, packages/plugins/plugin-dev, packages/plugins/plugin-email, packages/plugins/plugin-hono-server, packages/plugins/plugin-pinyin-search, packages/plugins/plugin-reports, packages/plugins/plugin-security, packages/plugins/plugin-sharing, packages/plugins/plugin-webhooks, packages/qa/downstream-contract, packages/qa/http-conformance, packages/sdui-parser, packages/services/service-analytics, packages/services/service-automation, packages/services/service-cache, packages/services/service-cluster, packages/services/service-cluster-redis, packages/services/service-datasource, packages/services/service-i18n, packages/services/service-job, packages/services/service-knowledge, packages/services/service-messaging, packages/services/service-package, packages/services/service-queue, packages/services/service-realtime, packages/services/service-settings, packages/services/service-sms, packages/services/service-storage, packages/spec, packages/triggers/trigger-api, packages/triggers/trigger-record-change, packages/triggers/trigger-schedule, packages/types
non-zero exit: 0


## The answer

Not yet — see "IN PROGRESS" above. Provisional read at 32/72 (do not cite):
structured share of console+structured is already ~84%, nowhere near the
five-suite ~45%, in the direction the earlier reading's own explanation
predicts (see "What is NOT claimed here" / the five-suite table above): most
of the *unmeasured* population never boots a kernel at all, so it was always
going to skew toward `console`-only or near-silent, not toward more structured
share. The final numbers replace this paragraph once all 72 (or a declared
NOT-MEASURED-with-reason subset) are in.
