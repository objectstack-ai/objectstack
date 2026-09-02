// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13823 — ADR-0049 enforce-or-remove on `RestApiEndpointSchema.handlerStatus`
// (maintainer ruling 2026-09-01, director decision batch #27, verbatim
// 「同意」: remove). The key (`implemented` / `stub` / `planned`) was declared
// as a handler-readiness marker whose docstring promised that a `stub` handler
// "returns 501 Not Implemented", and NOTHING read it: the only identifier hits
// outside `skills/**` and tests were the declaration, its re-declaration on
// `RouteCoverageEntrySchema` and a docblock saying adapters SHOULD warn on it.
// The 501 it described has a different cause — every
// `DispatcherErrorCode.enum.NOT_IMPLEMENTED` site (`runtime/src/
// endpoint-executor.ts` ×3, `runtime/src/api-mapping.ts`,
// `runtime/src/api-endpoint-step.ts`) is the declarative-endpoint executor
// refusing a target or mapping it cannot serve, none consulting the key — so
// `handlerStatus: 'stub'` got an ordinarily served route and reported its
// progress to nobody. Tombstoned with `retiredKey()`: `RestApiEndpointSchema`
// is a non-strict `z.object`, so a bare deletion would be a silent strip
// (#3733, ADR-0104). The value enum it was typed with and the two report
// shapes that re-declared it leave whole — `api/HandlerStatus`,
// `api/RouteCoverageEntry`, `api/RouteCoverageReport` in
// `RETIRED_DEFS_BY_MAJOR[18]`.
//
// Registered here but NOT in `src/conversions/registry.ts`, the
// `kernel/Manifest:loading` reasoning: nothing in the tree parses
// `RestApiEndpointSchema` outside its own unit tests — a REST API plugin's
// route registration is not a stack collection member (`PLURAL_TO_SINGULAR`
// has no entry for it) and nothing stores one as a `sys_metadata` row — so a
// MetadataConversion would be a transform with no seam that ever runs. The
// prescription reaches authors through the tombstone plus the D3 semantic
// entry `rest-api-endpoint-handler-status-retired`. ENFORCE (mounting a 501
// stub for `stub` / `planned`) was excluded by the same ruling as a zero-pull
// new capability, not a repair.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #11846 / #12428 grading).
export const entry = 'api/RestApiEndpoint:handlerStatus';
