// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13823 — `api/RouteCoverageReport` (the aggregated startup report — `timestamp`
// / `adapter` / `summary { total, implemented, stub, planned }` / `entries[]`)
// whose docblock said adapters SHOULD emit it as startup health diagnostics and
// warn on every endpoint with `handlerStatus !== 'implemented'`. No adapter,
// dispatcher or registrar ever constructed one — zero constructors in
// objectstack, objectui (pinned sha) or cloud — so it was a shape with no
// producer, and the status it aggregated had no reader. Route 3 (whole-def
// removal, no carrier key, no D2 conversion). Route readiness that IS measured
// is unchanged: the discovery payload's per-service `status` / `handlerReady`
// (`api/discovery.zod.ts`) and the CI-asserted route ledger
// (`packages/runtime/src/route-ledger.ts`). See
// `18.api__RestApiEndpoint__handlerStatus.ts` for the retirement record.
export const entry = 'api/RouteCoverageReport';
