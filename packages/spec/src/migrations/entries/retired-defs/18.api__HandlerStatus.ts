// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13823 — `api/HandlerStatus` (the `implemented` / `stub` / `planned` enum)
// left with its two carriers: `RestApiEndpoint.handlerStatus` is tombstoned
// in this same major (`RETIRED_KEYS_BY_MAJOR[18]`) and
// `RouteCoverageEntry.handlerStatus` left with that def (`api/RouteCoverageEntry`
// below), so the enum had no remaining consumer — and an exported value
// schema with no consumer reads as a capability (#3950, the `ui/ThemeMode`
// rule). Measured before removal: zero readers of the enum or the key in
// objectstack, objectui (pinned sha) or cloud. See
// `18.api__RestApiEndpoint__handlerStatus.ts` for the retirement record.
export const entry = 'api/HandlerStatus';
