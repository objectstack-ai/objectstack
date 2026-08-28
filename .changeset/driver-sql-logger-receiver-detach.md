---
"@objectstack/driver-sql": patch
---

fix(driver-sql): keep the logger's receiver at the nine detach-then-call sites — a class-based host logger no longer turns a durability warning into a `TypeError` (#12792)

Nine sites in `sql-driver.ts` picked a log channel by **extracting** the method before
calling it — eight on the durability channel and one on `info`:

```ts
(this.logger.error ?? this.logger.warn)(msg, meta);   // 8 sites
(this.logger.info  ?? this.logger.warn)(msg);         // 1 site
```

`a.b` in *call position* passes `a` as the receiver; `(a.b ?? c.d)(…)` evaluates to the
bare function first, so the call runs with `this === undefined`. A plain-closure logger
does not read `this` and survives it — which is why no suite ever went red, since this
class's own default sink and every test double in the package are closures.
`@objectstack/core`'s `ObjectLogger` is a real class with prototype methods and no
constructor binding — `error`/`fatal` reach for `this.writeErrorLike`,
`debug`/`info`/`warn` for `this.write` — so a host that injects one got:

```
TypeError: Cannot read properties of undefined (reading 'writeErrorLike')
    at error (packages/core/src/logger.ts:414:14)
    at SqlDriver.syncDeclaredIndexes (packages/drivers/driver-sql/src/sql-driver.ts)
```

The asymmetry that makes it worth fixing rather than noting: these particular lines
report **durability degradation and schema drift** — the channel that exists to be loud
when a constraint the metadata claims is enforced is not. A throw there converts the one
signal into silence plus an unrelated crash, and where the site sits inside the
reconcile's own `try` the throw is swallowed and re-reported as
`dev auto-reconcile failed` — a reconcile that really happened, announced as a failure,
with the post-reconcile re-detect skipped so the next warning describes a state that is
no longer true.

The eight `error ?? warn` sites now call `logDurabilityFailure()` — the property-access
helper this class already had, three lines from the docblock that explains it. The ninth
is `info ?? warn` and reports a reconcile that **succeeded**, so it keeps its level with
an in-place property-access spelling rather than being escalated onto the durability
channel; escalating a functional report to `error` is the over-application AGENTS.md
names as what makes `error` unreadable in the first place.

**Why `patch`.** No export, signature, accepted input or rejected input changes, and no
message text changes. A host whose logger is a plain closure object sees byte-identical
behaviour — that shape worked before and is pinned unchanged. The one behaviour a
consumer could observe is a subclass that overrides the `protected`
`logDurabilityFailure`: eight more calls now route through its override. That method is
already this class's declared verb for the durability channel and the fallback semantics
at those sites are unchanged (`error` when the sink has one, else `warn`), so more calls
honouring the override is the documented intent rather than a break.

Also measured and recorded rather than assumed: **nothing composes an `ObjectLogger`
into `SqlDriver` today**. The plugin's `onEnable` builds `new SqlDriver(config)` and
never passes the kernel's logger, the constructor reads no `logger` key, and every
`driver.logger = …` assignment in the repo is a test or a testkit; the one production
seam that *can* install one is `SqliteWasmDriver`'s constructor, inherited straight into
this class, and no caller passes it yet. So these were latent, not live — which decides
urgency, not whether: a call that runs with `this === undefined` is a defect whatever
today's wiring happens to tolerate.

The regression pin (`logger-receiver-detach.test.ts`) uses **class-based** logger doubles
whose channels dispatch through `this`, drives the real reconcile and the real
declared-index sync against real SQLite, and adds a structural AST scan over
`sql-driver.ts` for all four detach spellings — including the two a single-line regex
cannot see, which is how this file's count was twice taken as a floor.
