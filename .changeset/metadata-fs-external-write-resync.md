---
"@objectstack/metadata-fs": patch
---

fix(metadata-fs): an external write reaches subscribers even when the watcher's single delivery attempt is lost — content-keyed reconciliation behind the poll (#9339)

`FileSystemRepository`'s watcher gave an externally-written file **exactly one**
chance to be noticed, and losing it was permanent and silent. Under
`usePolling`, chokidar re-reads a directory only when its stat *strictly*
advances; an external write advances the type directory's mtime once, so poll
#2..#N compare an unchanged stat and can never rediscover the file. Measured on
#9339 with a fault-injection harness: with that single read suppressed, fifteen
further poll ticks never find the file — a 20s deadline and a 200s deadline buy
the same one attempt. That is the structural reason behind #7282's empirical
finding that the event is *"never delivered, not slow"*, and why widening the
deadline (#7208) and lowering `interval` were both spent before they were tried.

**At least six independent one-shot gates sit on that attempt**, spanning three
layers — the kernel timestamp (the directory mtime does not strictly advance),
chokidar's readdir throttle and readdir snapshot, and chokidar's emit gates
(`_throttle('add')`, a stale `_pendingWrites` entry, the `awaitWriteFinish`
ENOENT early return). Each produces a byte-identical observable: no event, ever,
for that path. They are indistinguishable at the point of failure, which is why
#7282's close — picked from that family — covered one member and reopened.

**The fix does not name a member.** A bounded, content-keyed reconciliation
sweep runs alongside the watcher and compares what is on disk against `heads`,
the index that already defines what the repository believes it holds, publishing
any divergence through the *same* handler the watcher feeds. Its only premise is
that the bytes on disk stopped matching the index, so it is robust across all six
by construction — and equally across a seventh nobody has found.

- **Cadence** — one pass over `<root>/<type>/*.json` every 2s (twice the poll
  interval), the same walk `start()` already performs once. Sweeps are chained
  rather than intervalled, so they can never overlap or stack behind a slow
  disk; the timer is `unref`ed and is retired by `close()`; and it is armed only
  alongside the watcher, so a `disableWatch` repository pays nothing.
- **Exactly-once is preserved.** Suppression stays content-keyed (`#7335`): the
  sweep republishes nothing the watcher already delivered, and recognises this
  repository's own `put()` by content rather than by a clock.
- **Events are indistinguishable from the fast path** — same `op`,
  `parentHash`, `source: 'fs'` and actor, because they are produced by the same
  code. A subscriber cannot be made to care which path noticed.
- **A recovered path is re-armed** with the watcher through the seam `put()`
  already uses, so a loss upstream of chokidar's `_handleFile` does not leave
  the file dependent on the sweep forever.
- `put()`'s existing direct registration (#7336) is unchanged, as are
  `usePolling`, `interval`, and `awaitWriteFinish`.

⚠️ **Bound on the claim.** The six gates are *forced fault injections*, not the
CI mechanism, which was never identified and may be a seventh. What is measured
is that the fix converts **six of six** forced one-shot gates from permanent
loss to delivery (3/3 runs each), where all six returned an empty event list
before it. That is not the same statement as "the flake is fixed".
