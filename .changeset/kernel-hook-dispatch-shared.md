---
"@objectstack/core": patch
---

refactor(core): one implementation per hook-dispatch flavour, plus a paired-pin gate (#5282)

`ObjectKernel` does not extend `ObjectKernelBase` — it is a standalone
production kernel with its own `hooks` map, and only `LiteKernel` extends the
base. Lifecycle-hook dispatch therefore existed **twice**, with no shared code
path: the base's `triggerHook` (isolating) / `triggerHookOrThrow` (propagating) /
`context.trigger` on one side, and `ObjectKernel`'s private
`triggerShutdownHookIsolating` / `context.trigger` on the other. The two
isolating loops printed the same `Hook handler failed: kernel:shutdown` line
because someone typed it twice.

That seam produced three consecutive bugs, each the same shape — one hook name
meaning opposite things on the two kernels: `kernel:ready` (#5170),
`kernel:bootstrapped` / `kernel:listening` (#5257, where a swallowed
`server.listen()` failure let a process print "✅ Bootstrap complete" with
nothing listening), and `kernel:shutdown` in the other direction (#5274, where
one bad handler skipped every `destroy()`).

**No behaviour change.** The two dispatch flavours move verbatim into an
internal module, `packages/core/src/hook-dispatch.ts`, which both kernels now
call:

- `dispatchHookIsolating` — a failing handler is logged as
  `Hook handler failed: <name>` and the remaining handlers still run.
- `dispatchHookPropagating` — the first failure escapes unwrapped and the
  handlers behind it are skipped.

Every call path keeps the flavour, the log wording and the trace line it had
before, including the one asymmetry inside the propagating flavour:
`PluginContext.trigger` has never emitted the `Triggering hook: <name>` trace on
either kernel, so it still does not. The kernels' two `hooks` maps are
deliberately **not** unified, and `ObjectKernel` deliberately does **not** gain a
base class — both were considered and ruled out of scope.

How "no behaviour change" was proved: the paired kernel pins from #5170 / #5257 /
#5274 pass untouched, and deleting the shared dispatcher's error log now turns
**both** kernels' test files red from a single edit — a property the hand-mirrored
copies could not have (editing `ObjectKernel`'s private loop could never turn
`lite-kernel.test.ts` red).

Shared dispatch cannot cover the residual two-maps seam, so the pairing of the
tests is now a gate rather than a convention: `pnpm check:kernel-hook-pairs`
(`scripts/check-kernel-hook-pairs.mjs`, wired into the ESLint job) requires every
`kernel:*` hook dispatched in `packages/core/src` to be named in a test title in
**both** `kernel.test.ts` and `lite-kernel.test.ts`, and fails naming the hook
and the side that lacks it. A fifth lifecycle hook can no longer arrive paired on
one kernel only.

Also pinned, deliberately unchanged: `kernel:shutdown` has two dispatch paths
with different flavours on both kernels — the kernel's own teardown isolates,
while a plugin calling `ctx.trigger('kernel:shutdown')` by hand propagates.
Nothing in the repo triggers it by hand today, so this is dormant; it is now a
documented fact with a named test on each side rather than a surprise found at
teardown.
