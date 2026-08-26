// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #12428 — ADR-0049 enforce-or-remove, one symbol over from #12340 (PR #12425)
// in the same file and on the same per-key test. `HotReloadManager.startWatching`
// contained NO watcher: a guard plus `logger.info('File watching started',
// { patterns })` above an in-source note saying real watching "would require
// chokidar or similar / This is a placeholder for the integration point".
// `watchHandles` was only ever read, deleted, iterated and cleared and NEVER
// set, so `stopWatching`'s cleanup branch and the teardown loop over its keys
// were structurally UNREACHABLE rather than merely untaken — measured with a
// firing positive control (`reloadTimers.set` resolves a real writer in the
// same file and the same scan; `watchHandles.set` resolves nothing anywhere).
// `watchPatterns` therefore had no reader that ACTED on it, and #12340's
// silence was at least at DEBUG level where this one claimed success at INFO.
//
// Neither of ADR-0049's other two states was available: ENFORCE would build for
// a caller that does not exist (no runtime composes `HotReloadManager` — only
// its own unit test and `core/examples/phase2-integration.ts`), and
// EXPERIMENTAL requires a roadmap, where a scan of every planning doc returned
// ZERO hits for hot-reload file watching against 145 control hits in the same
// files. Real watching lives where it is implemented: `chokidar` is a
// dependency of `@objectstack/metadata`, `@objectstack/metadata-fs` and
// `@objectstack/cli`, never of `@objectstack/core`.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look — the same grading #12340 used one
// day earlier in this module.
//
// Tombstoned with `retiredKey()` in `HotReloadConfigSchema` (the surface
// baseline line carries `[RETIRED]`). Deliberately NO D2 conversion: the chain
// walks a normalized STACK, and `HotReloadConfig` is not an authorable surface
// — no metadata-type binding, stack collection or manifest embed ever carried
// it, and nothing in the tree parses `HotReloadConfigSchema` outside its own
// unit test — so a conversion would be a transform with no seam that ever
// runs. The D3 semantic entry `hot-reload-watch-placeholder-retired` is the
// declaration, and the registration-time refusal in
// `HotReloadManager.registerPlugin` is the door for the audience that exists.
export const entry = 'kernel/HotReloadConfig:watchPatterns';
