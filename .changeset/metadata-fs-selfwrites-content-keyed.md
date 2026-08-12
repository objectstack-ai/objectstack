---
"@objectstack/metadata-fs": patch
---

fix(metadata-fs): stop suppressing self-writes on a wall clock, so a poll tick can no longer swallow an external edit (#7335)

`FileSystemRepository` suppressed the watcher event its own `put()`/`delete()`
was about to produce by adding the path to a `selfWrites` Set and clearing it on
a fixed `setTimeout(…, 200)`. `handleFsChange` then dropped **any** event for a
path in that Set, without ever reading what the watcher had observed.

Under `usePolling: true, interval: 1000` chokidar compares state once per tick,
so our own write and an external edit landing between two ticks are delivered as
a **single** event carrying the *external* content. Dropping that on a timer
destroyed the only notification the external edit would ever produce — the edit
was silently lost, and nothing later recovered it. The realistic trigger is a
`git checkout` or an editor save arriving while the process writes the same item:
the dev-mode authoring loop.

**Measured.** The filing recorded 0/360 instrumented iterations reaching the
window and called it derived rather than observed. That was a sampling artefact:
the delivery lag of a self-write event is
`(interval - (writeTime mod interval)) + awaitWriteFinish`, so a *fixed*
pre-edit sleep phase-locks the poll and pins the lag outside the window
(measured: 519–585 ms across 25 runs). Randomising the sleep so the lag samples
`[0, interval)` uniformly, 40 runs:

| delivery lag | runs | external edit |
|--------------|------|---------------|
| < 200 ms     |    7 | **swallowed** |
| > 200 ms     |   33 | delivered     |

A perfect split on the wall-clock boundary — the mechanism, observed.

**The fix removes the pre-check rather than re-keying it**, because the
content-keyed suppression it was shadowing already existed one step further
down and needs no timer:

- `add`/`change` — `currentHead === hash` drops the event when the bytes on disk
  are the bytes we last published. `put()` sets that head in the same
  continuation as its `rename`, and `awaitWriteFinish` holds any event for a
  further `stabilityThreshold`, so the index is never late.
- `unlink` — `!currentHead` drops the event when the index already agrees the
  item is gone.

`delete()` additionally now retires the head **before** it unlinks rather than
after. `awaitWriteFinish` debounces only `add`/`change`, so that face gets no
stability cushion between the disk mutation and the event it produces; ordering
the index update first makes the downstream check a total suppression rather
than a race against the poll callback. A failed `unlink` restores the head
before rethrowing, so the error path is unchanged.

No API or configuration change; the repository publishes strictly more of the
external edits it was always meant to report.

One pre-existing limit is now documented rather than altered: identity is judged
on what round-trips through the file, so a spec whose in-memory form does not
(a `Date`, which canonicalises to `{}` in memory but to an ISO string once
written and re-read) is republished as an external `update`. Such a spec already
fails `put().version === get().hash` independently of the watcher, and the
200 ms window never covered it either — it expired some 360 ms before the event
it would have had to catch.
