// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — maintainer ruling 2026-09-02 ("ruled B"):
// a duration-shaped `z.number()` key carries its unit in its NAME, and no
// existing offender is grandfathered. `ApiEndpoint.cacheTtl` said "Response
// cache TTL in seconds" in prose and nothing else, on the same authorable
// surface where `rateLimit.windowMs` spells its unit. Renamed to
// `cacheTtlSeconds`; the value is unchanged and the key stays GET-only.
// Tombstoned with `retiredKey()` — the shape is not `.strict()`, so a bare
// deletion would strip the old key in silence, and the unknown-key error could
// not carry the rename. This is the ONE key of this card's twelve that gets a
// D2 CONVERSION rather than a semantic entry: `apis:` is a stack collection
// (`stack.zod.ts` — `apis: z.array(ApiEndpointSchema)`) and an `api` is a
// registered metadata kind stored as a row, so the conversion chain has a seam
// that sees it. `api-endpoint-cache-ttl-to-cache-ttl-seconds` rewrites it,
// retired from the load path (no alias window). Registered under 18 for the
// launch-window reason its neighbours state.
export const entry = 'api/ApiEndpoint:cacheTtl';
