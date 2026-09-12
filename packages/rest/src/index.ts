// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// REST Server
export { RestServer } from './rest-server.js';
// The protocol slice the REST layer consumes (ADR-0076 D9 / #2462 A1.5)
export type { RestProtocol } from './rest-server.js';

// Route Management
export { RouteManager, RouteGroupBuilder } from './route-manager.js';
export type { RouteEntry } from './route-manager.js';
// What `RestServer.getRoutes()` answers with (#5822): every route mounted for
// this boot, RouteManager's and the direct-mount registrars' alike, each
// carrying the `source` that says which.
export type { MountedRoute } from './rest-server.js';
export type { DirectMountedRoute, MountedRouteSource } from './direct-mount.js';

// REST API Plugin
export { createRestApiPlugin } from './rest-api-plugin.js';
export type { RestApiPluginConfig } from './rest-api-plugin.js';

// Bulk-import building blocks (#2766 V2) — shared with the identity import
// endpoint in plugin-auth so it accepts payloads byte-identical to the
// generic /data/:object/import routes and reuses the same row engine.
// [#5563] The meta-envelope shape predicate that used to be exported here is
// gone: `GET /meta/:type/:name` answers exactly one body shape now — the
// spec-declared `{ type, name, item, … }` envelope — so there is no shape
// question left to ask at runtime, and reading `.item` is unconditionally
// correct. Removal + migration are written up in the changeset.
export {
    prepareImportRequest,
    parseCsvToRows,
    parseXlsxToRows,
} from './import-prepare.js';
export type { PreparedImport, PrepareImportResult } from './import-prepare.js';
export { runImport } from './import-runner.js';
export type {
    ImportAction,
    ImportRowResult,
    ImportProgress,
    ImportRunSummary,
    ImportUndoLog,
    ImportProtocolLike,
    ImportProtocolRequest,
    RunImportOptions,
} from './import-runner.js';
export { coerceRow } from './import-coerce.js';
export type { CoerceContext, RefResolver } from './import-coerce.js';
export { buildFieldMetaMap } from './export-format.js';
export type { ExportFieldMeta } from './export-format.js';

// Query-parameter MULTIPLICITY — the repo's ONE rule for a single-valued
// parameter supplied more than once (#6307 / #6877), published so the doors
// OUTSIDE this package can answer it with that one implementation instead of a
// second copy that drifts (#17672). `query-multiplicity.ts`'s header is the
// authority on the rule; what belongs here is which half travels.
//
// `repeatedQueryParamMessage` is the portable half and the one the dispatcher's
// `/packages` domain calls: it is a pure function of two primitives, so a
// caller in any package gets the same sentence and no transport assumptions
// ride along with it.
//
// ⚠️ `refuseRepeatedQueryParams` is the `res`-shaped gate, for a consumer that
// has a response object to write — this package's own handlers, and any sibling
// mounting handlers of that shape. It is NOT usable from a runtime dispatcher
// domain: the body it writes is the bare ADR-0112 `{ error: { code, message } }`
// and that surface's envelope needs the `success` / `httpStatus` siblings
// `@objectstack/runtime`'s `buildApiError` adds (measured on #17672 — the gate's
// body fails `BaseResponseSchema` with `success is missing, must be a boolean`).
// ⛔ A dispatcher domain takes the message and builds its own body.
export { refuseRepeatedQueryParams, repeatedQueryParamMessage } from './query-multiplicity.js';
