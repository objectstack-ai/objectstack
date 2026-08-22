---
"@objectstack/metadata-protocol": patch
---

`SysMetadataRepository.close()` now terminates every live `watch()` iterator
instead of broadcasting a synthetic drain event (#11021). A consumer holding a
`for await` over `watch()` at shutdown could hang forever, and the hang was
worst for the subscription shapes most likely to be in use.

Shutdown was modelled as a metadata event — `{ seq: -1, ref: { org: '', type:
'view', name: '_close' } }` — pushed through the same dispatch closure real
events pass, followed by clearing the watcher registry. Both of that closure's
guards reject it:

- `matchesFilter` drops it for any subscription naming an `org` (the synthetic
  ref's org is the empty string), a `type` other than `view`, or a `name` —
  `MetadataCache.start()` with any non-empty `watchFilter` is exactly that
  shape;
- the `since` drop-filter drops it for every numeric-`since` subscription,
  since `-1 <= since` holds against every real seq.

Dropped and then unsubscribed, nothing could settle the parked promise. Measured
before the fix: `watch({org:'system'}, seq)` and `watch({org:'system'})` were
both still unsettled 500ms after `close()`. The empty-filter case looked drained
and was not — it received the synthetic event as a *real* one (a `view` named
`_close`, deleted, at seq -1, which `MetadataManager` turns into a cache
invalidation and re-emits to Studio's HMR stream) and then hung on the next pull
anyway, because delivering an event does not end an iterator.

`close()` now runs each subscription's terminator — the same routine the
consumer's own `iterator.return()` runs — so a parked `next()` settles with
`{ done: true }` and no value, and so does every later one. Consumers no longer
need to recognise a shutdown event, because there is no longer one to recognise;
nothing in the repo ever named the `_close` sentinel.

The contract this repairs was unstated, which is why the two defensible repair
shapes were both arguable. It is stated now: invariant 8 in
`packages/metadata-core/src/repository.ts` ("shutdown terminates; it does not
emit") says what a repository-level `close()` owes a pending iterator, and
records the one measured non-conformance among today's implementations
(`FileSystemRepository`, filed as #11127).
