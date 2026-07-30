---
"@objectstack/driver-memory": major
"@objectstack/spec": major
"@objectstack/plugin-dev": patch
---

fix(driver-memory,spec): persistence is opt-in again — `new InMemoryDriver()` is pure in-memory (#4065)

`InMemoryDriverConfig.persistence` defaulted to `'auto'`, and in Node.js `'auto'`
means **file**. So a bare `new InMemoryDriver()` — the shape every caller in this
repo used — silently wrote `.objectstack/data/memory-driver.json` into the process
CWD and reloaded it on the next boot. The default is now `false`.

**This restores the accepted design rather than replacing it.** #815, the issue
that introduced the persistence capability, specified it as opt-in in requirement
\#1 — "默认情况下不启用持久化（纯内存，行为不变）" — and listed
`new InMemoryDriver()` under "纯内存" in its own config examples. The `'auto'`
default was a drift from that spec.

What let the drift survive is worth naming, because it is not "there was no
test". `MemoryConfigSchema` *did* pin the default, and asserted `'auto'`; the
driver honoured `'auto'`; so spec and implementation agreed, and the pair looked
verified. What nothing checked was whether the value they agreed on was the one
#815 accepted. The driver's own `persistence.test.ts` could not have caught it
either — every case there passes `persistence` explicitly, so the omitted-value
path was untested on the implementation side. Both sides are now covered: three
behavioural tests in `persistence.test.ts` (no CWD write, no cross-instance row
carry-over, opt-in still persists) and the flipped schema assertion.

**The symptom this fixes.** `packages/runtime/src/datasource-autoconnect.test.ts`
seeds two rows with fixed ids and asserts the exact set. Run 1 passed and wrote
the rows to disk; run 2 loaded them back, appended two more, and failed with four
rows; run N had 2N. CI never saw it — every job is a fresh clone, so every CI run
is run 1 — but `pnpm test` twice in one working tree could only ever go green
once. The persisted file's `created_at` values, one pair per run, were the proof.

(#4083 fixed that particular suite from the factory side, and its regression
test is kept as-is. The blast radius was wider than one suite, though: **every**
bare `new InMemoryDriver()` inherited the default, so any code path constructing
one directly wrote to its working directory. Unit tests should not have write
side effects on the CWD at all.)

**Migrating.** Callers that want durability now ask for it:

```ts
new InMemoryDriver()                        // pure in-memory (new default)
new InMemoryDriver({ persistence: 'file' })  // Node.js, durable across restarts
new InMemoryDriver({ persistence: 'local' }) // browser, durable across reloads
new InMemoryDriver({ persistence: 'auto' })  // previous default behaviour
```

The `'auto'` / `'file'` / `'local'` / custom-adapter paths are unchanged; only
the value used when `persistence` is omitted moved.

**Relationship to #4083.** That issue fixed the same hazard one consumer at a
time, and landed first: `createDefaultDatasourceDriverFactory` now passes
`persistence: false` for a declared `{ driver: 'memory' }` datasource and scopes
an opted-in destination *per datasource*, and the dev sqlite step-down's
last-resort rung passes `false` too. Both are kept exactly as #4083 wrote them.
This change closes the half they deliberately left open — a directly-constructed
`new InMemoryDriver()` — which is the path that still wrote into the working
directory of whatever process happened to build one.

The two are complementary, not redundant. #4083's per-datasource scoping is
still the only thing that expands `'auto'`/`'file'`/`'local'` into a destination
carrying the datasource name, so two pools that DO opt in never alias one file;
its explicit `false` becomes belt-and-braces, which is the right posture for a
path that must never persist.

`DevPlugin`'s driver is now explicitly `persistence: false`, matching the cache,
queue, job, i18n, storage and search stubs it ships beside — it was the one piece
of that stack that quietly outlived the process.

**One claim trimmed, no behaviour attached.** The class docstring called this a
"production-ready implementation of the ObjectStack Driver Protocol". It stores
no constraints at all — `create()` is a `table.push()` and `syncSchema()` only
allocates an array — so there is no primary key, uniqueness, `NOT NULL`, foreign
key or column typing, and `bulkCreate` lands duplicate ids where a SQL driver
raises a violation (the second finding in #4065). The docstring now says so, and
points test authors at in-memory SQLite. Per Prime Directive #10 the fix for
`declared ≠ enforced` is to implement it, trim the claim, or file it; with this
driver moving to maintenance-only the claim is what goes.
