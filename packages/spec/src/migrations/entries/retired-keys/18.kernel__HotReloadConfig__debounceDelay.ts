// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478).
// `HotReloadConfig.debounceDelay` said "Debounce delay before reloading
// (milliseconds)" in a source JSDoc and "Wait time after change detection before
// reload" in the `.describe()` the reference pages publish, so the published
// channel named no unit at all and the reference-page reader got a bare 1000.
// Renamed to `debounceDelayMs`, the plain suffix rather than a shortened form:
// this is the only debounce-shaped key spelling in the repo (5 key-position
// occurrences, all this key and its fixtures; no `debounceMs` variant anywhere),
// while the Delay-plus-Ms pairing is already attested (`maxDelayMs`,
// `initialDelayMs`, `retryDelayMs`, `delayMs`) — so there was no competing family
// spelling to choose between. The value and the 1000 default are unchanged.
// Tombstoned with `retiredKey()`: `HotReloadConfigSchema` is not `.strict()`, so
// a bare deletion would silently strip the key and hand `setTimeout` no delay.
// No D2 conversion: not a stack collection member, not a stored row —
// `HotReloadConfig` is a library parameter a host passes to `HotReloadManager` in
// TypeScript, the same reading `hot-reload-watch-placeholder-retired` recorded
// for this def. See `kernel-health-check-and-hot-reload-durations-unit-in-key`.
export const entry = 'kernel/HotReloadConfig:debounceDelay';
