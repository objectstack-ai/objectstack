---
"@objectstack/metadata": patch
---

fix(metadata): an unreadable file is no longer announced as `data: null` (#5228)

`NodeMetadataManager.handleFileEvent()` — the chokidar handler behind
`watch: true` — wrapped its re-read in a `try/catch` that logged
"Failed to load changed file" and returned without announcing. That `catch` was
**unreachable for the failure it was written to catch**. `load()` is
`(await loadDiagnosed(...)).data`, and `loadDiagnosed` (ADR-0110 D3)
deliberately absorbs a loader throw: it records the message in `errors[]` and
answers `{ data: null, degraded: true }`. `FilesystemLoader.load()` does throw
on an unparseable file — the throw simply died one frame below the handler, so
the `catch` never ran and the `logger.error` inside it never printed once.

What went out instead was a watch event carrying `data: null`, which is the wire
shape of "this metadata legitimately holds nothing". A file the loader could not
read and a file the author had emptied reached every subscriber in exactly the
same shape — the miss/outage distinction ADR-0110 D3 exists to preserve, erased
at the one call site that had picked the variant which throws it away.

The handler now reads through `loadDiagnosed` and splits on `degraded`:

- **Degraded** (a loader threw and none answered — an unreadable or unparseable
  file): take the road the dead `catch` meant to take. Log `filePath`, the
  metadata type and name, and `loadDiagnosed`'s `errors[]`, and announce
  nothing. A developer who breaks a metadata file now gets told; before, the
  event claimed the definition had been emptied and nothing was logged.
- **Clean miss** (`data: null`, no loader threw — the file is gone or
  legitimately empty): unchanged, announced exactly as before.
- **Deleted** events never read, so a deletion can never be degraded and is
  always announced.

Cache invalidation is unaffected and deliberately runs **before** the read, so
the read's verdict can never decide whether the caches are dropped. #5218's
contract holds in full: an unreadable file is still a real change to the stored
set (`loadMany` skips it), so `listCache` and the `registry` entry still go, and
the `api` endpoint index still rebuilds — `invalidateListCache` is that index's
first invalidation seam (#5089), so suppressing the announcement costs it
nothing.

No in-repo subscriber loses invalidation or reload correctness: the endpoint
index is covered by the seam above, `ObjectQLPlugin`'s `subscribe('object', …)`
answers events by re-reading (an unreadable file yields nothing to re-read
either way), and the email-template bridge falls through `event.data ?? get(...)`
to the same empty result. One behaviour does change for the dev HMR/SSE stream:
a file left permanently unparseable no longer wakes the Studio, which keeps
showing the last known-good definition until the next event instead of watching
it vanish.
