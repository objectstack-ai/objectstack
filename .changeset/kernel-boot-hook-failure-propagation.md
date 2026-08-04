---
"@objectstack/core": minor
---

fix(core)!: a throwing `kernel:bootstrapped` / `kernel:listening` handler fails the boot on LiteKernel too (#5257)

**A failed `listen()` no longer yields a false "✅ Bootstrap complete".**

#5170 (PR #5258) unified `kernel:ready`: a handler that throws fails the boot on
`ObjectKernel` and `LiteKernel` alike. It deliberately ruled that one hook only,
leaving the other lifecycle hooks split — `ObjectKernel` propagates their
failures (its `context.trigger` is a bare awaited loop that never catches) while
`LiteKernel` routed them through the isolating dispatcher, logging
`Hook handler failed: <name>` and carrying on. This closes the two boot-path
hooks that were left: `kernel:bootstrapped` and `kernel:listening` now use the
propagating dispatcher (`triggerHookOrThrow`) on `LiteKernel`, in the same shape
#5258 established — the remaining handlers for that hook are skipped, the later
boot hooks never fire, the original error reaches the caller **unwrapped**,
`state` is left `'stopped'` rather than `'running'`, and the success line is
never logged.

The concrete failure this removes: `HonoServerPlugin` opens its socket inside a
`kernel:listening` handler — `await this.server.listen(port)`, with no try/catch
of its own, deliberately. When that rejected on `LiteKernel` (EACCES on a
privileged port, a failure inside the port-fallback logic itself, a serverless /
edge host where `listen` is not available at all) the throw was swallowed,
`bootstrap()` resolved normally, and the process printed
`✅ Bootstrap complete` while **nothing was listening**. The same plugin code on
`ObjectKernel` failed the boot. The health check that came next was the first
thing to notice, and it had already been told startup succeeded. Plain "port is
in use" was never affected — `server.listen` falls back to a random port
internally — which is exactly why this stayed invisible.

`kernel:bootstrapped` carries reconcile and audit work (objectql's
`announceOpenMigrationGates`, service-automation's node-type / trigger-binding
audits, the sharing plugin's boot backfills); a swallowed failure there is a
quieter version of the same lie — the audit silently does not run.

**`kernel:shutdown` keeps fail-soft dispatch**, now as an explicit per-hook
judgement recorded in a comment at the dispatch site rather than an inherited
default. On the teardown path there is no "refuse to proceed" left to buy, and
the handlers queued behind a failing one — plus the reverse-order `destroy()`
pass after them — are what flush buffers, close connections and release locks.
Aborting that sequence would convert one bad handler into leaked resources and
unflushed writes.

**Who is affected.** Hosts that boot through `LiteKernel` — vitest, serverless,
edge (Workers) — and register a `kernel:bootstrapped` or `kernel:listening`
handler that can throw. Such a host previously came up "successfully" with the
work of that handler silently skipped; it now refuses to start and surfaces the
original error. If a handler of yours performs best-effort work whose failure
genuinely must not stop the boot, it needs its own `try/catch` — which is what
the in-repo `kernel:bootstrapped` subscribers already do, per handler, with the
reason written down. Nothing in this repo relied on the swallow: the core (426),
client, runtime, http-conformance, connector-{rest,mcp,slack} and
service-automation (665) suites pass unchanged.

Boot assertions still belong in `kernel:ready`: it is the earliest hook at which
the service registry is finished filling.
