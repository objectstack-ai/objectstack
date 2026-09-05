// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `CacheTier.ttl` said "Default TTL
// in seconds" in prose and nothing else, on a tier whose sibling `maxSize` is a
// size in MB: two bare numbers side by side, neither naming its unit at the
// authoring site. Renamed to `ttlSeconds`; the value and the 300 default are
// unchanged. Tombstoned with `retiredKey()` — `CacheTierSchema` is a plain
// `z.object()`, so a bare deletion would strip the old key in silence. No D2
// conversion: `stack.zod.ts` declares no `cache` collection and a cache tier is
// never a stored metadata row, so the conversion chain has no seam that sees it.
// See `system-cache-durations-unit-in-key`.
export const entry = 'system/CacheTier:ttl';
