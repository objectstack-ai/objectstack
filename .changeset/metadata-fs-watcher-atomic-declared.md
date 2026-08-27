---
"@objectstack/metadata-fs": patch
---

fix(metadata-fs): declare `startWatcher()`'s chokidar `atomic` option explicitly (#12696)

`FileSystemRepository.startWatcher()` constructed its chokidar watcher with
`usePolling: true` but never passed `atomic`, leaving it to inherit chokidar's
default. That default is unconditionally `true` in the installed version
(chokidar 5.0.0): the defaults literal assigns `atomic: true` *before* the
caller's options are spread in, so chokidar's own default-correction
(`if (opts.atomic === undefined) opts.atomic = !opts.usePolling`) can never
fire — it only runs when `atomic` is literally `undefined` after the merge,
which it never is. The comment beside that correction ("Editor atomic write
normalization enabled by default with fs.watch") reads as "off under
polling"; the actual resolved behaviour was on regardless.

This change passes `atomic: true` explicitly at the call site, with a comment
explaining why. **Patch, not a behaviour change**: verified at runtime
(constructing a watcher the way `startWatcher()` does and reading back
`watcher.options.atomic`) that the resolved value is identical before and
after — `true` either way, today. The only thing that changes is that the
value is now DECLARED rather than inherited from an upstream branch that
cannot execute, so a future chokidar release that fixes the ordering (making
the correction real) cannot silently flip this repository's watcher to
`atomic: false` under polling and change behaviour with no diff to review.

Not addressed here (see #12696): whether `atomic: true` (the 100ms
unlink-coalescing deferral and the `DOT_RE` editor-temp-file matcher it turns
on) is actually the right value. No evidence surfaced that either has ever
affected a run; flipping it to `false` is a deliberate behaviour change to a
live delivery path that needs its own reverse verification, and is out of
scope for this card.
