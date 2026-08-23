---
"@objectstack/metadata-fs": patch
---

`FileSystemRepository.close()` now terminates every live `watch()` iterator
instead of leaving it parked (#11127). A consumer holding a `for await` over
`watch()` at shutdown never saw its loop end — on a repository that was already
gone.

`close()` retired the chokidar watcher and the resync sweep and stopped there.
It never reached the event broker, and the broker had no teardown of its own:
`subscribe`/`unsubscribe` add to and delete from a plain `Set`, and nothing else
emptied it. Each iterator parks its pending `next()` on a `waiter` that only two
things can settle — a broker `push`, or the iterator's own terminator, which ran
from `iterator.return()`/`throw()` and from nowhere else. After `close()` the
chokidar source was gone so no `push` could arrive, and the subscriber was still
registered with nothing left to run its terminator.

Unlike the sibling defect in `SysMetadataRepository` (#11021) this was not
filter-dependent: there was no drain attempt at all, so every subscription shape
hung, `watch({})` included. Measured before the fix: nine cases —
`watch({org}, seq)`, `watch({org})`, `watch({})`, a ref-exact filter, a watcher
over the real chokidar watcher, a watcher with no pull outstanding, four
concurrent watchers, and the `return()`-symmetry comparison — were all still
unsettled 2s after `close()`. `MetadataManager.startRepositoryWatch()`, which
awaits `iter.next()` in a loop, is exactly the shape that hung.

The broker now holds each subscription's terminator next to its event sink, and
`close()` runs every terminator — the same routine the consumer's own
`iterator.return()` runs, so a parked `next()` settles with `{ done: true }` and
no value, and so does every later one. Shutdown is deliberately **not** delivered
as an event: a synthetic drain event is subject to the very filters `watch()`
applies to real ones, and delivering an event has never ended an iterator
(invariant 8, `@objectstack/metadata-core`'s `repository.ts`).

One narrower path is closed with it. `watch()` returns a deferred iterable whose
subscriber registers only once the eager log read resolves, so a `close()`
landing inside that window swept a broker the subscription had not yet joined —
the same forever-parked shape by a different route. `watch()` now carries the
close generation it was opened under, and a subscription that arrives after a
shutdown terminates on arrival.

Invariant 8 named `FileSystemRepository` as its one known non-conformance. With
this change the invariant has no declared exceptions, and its text says so.
