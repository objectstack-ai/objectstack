// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13823 — `api/RouteCoverageEntry` (one declared endpoint's coverage row:
// `path` / `method` / `category` / `handlerStatus` / `service` /
// `healthCheckPassed`) left whole with `api/RouteCoverageReport`, the only
// shape that embedded it. Nothing ever constructed or parsed one — zero
// constructors in objectstack, objectui (pinned sha) or cloud — so the
// `handlerStatus` it re-declared was carried outward by nobody. Route 3
// (whole-def removal, no carrier key, no D2 conversion); see
// `18.api__RestApiEndpoint__handlerStatus.ts` for the retirement record.
export const entry = 'api/RouteCoverageEntry';
