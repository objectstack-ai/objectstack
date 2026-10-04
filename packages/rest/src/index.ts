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
export { runImport } from '@objectstack/core';
export type {
    ImportAction,
    ImportRowResult,
    ImportProgress,
    ImportRunSummary,
    ImportUndoLog,
    ImportProtocolLike,
    ImportProtocolRequest,
    RunImportOptions,
} from '@objectstack/core';
export { coerceRow } from '@objectstack/core';
export type { CoerceContext, RefResolver } from '@objectstack/core';
export { buildFieldMetaMap } from './export-format.js';
export type { ExportFieldMeta } from './export-format.js';

// Query-parameter MULTIPLICITY — the repo's ONE rule for a single-valued
// parameter supplied more than once (commit 293476148 / #6877), published so the doors
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

// [#20193] THE per-caller read gate of one `/meta/:type/:name` document — the
// ADR-0046 §6.7 docs audience, the app nav filter (`requiredPermissions`, the
// ADR-0045 §3 publish gate, the docs-audience entry arm) and the ADR-0057 D10
// service gates — published so the runtime dispatcher's `/meta` domain, the
// only answer on a host that mounts just the `${prefix}/*` catch-all, asks the
// SAME gate `RestServer` asks instead of a second resolver
// (`meta-item-read-gate.ts`'s header is the authority).
//
// What travels is the decision and nothing transport-shaped: each caller hands
// in its own I/O (`MetaItemReadGateSources`) and writes the DATA verdict
// (`MetaItemReadVerdict`) on its own wire, in its own envelope — the same split
// `repeatedQueryParamMessage` above makes.
//
// [#20237] …and its LIST twin, for `GET /meta/:type` — the doc and book
// audience prunes, the app nav filter and the dashboard widget gate — over the
// same ports. The judge answers the pruned ITEMS; each caller rewraps them in
// its own list envelope.
//
// [#20320] …and everything else the two transports' `/meta` reads must answer
// alike: the list route's whole post-read chain (`createMetaListAnswer` — the
// `api` served-set face, the list gate, `?id=`, `?object=`, the doc locale
// collapse and slim, the object mask over the transport's masker, the translation
// `translateMetaList`), the one locale parse it reads (`metaRequestLocale`),
// the anonymous gates'
// `public`-audience predicate (`isPublicAudienceRead`) and the stored-version
// doors' policy (`STORED_VERSION_DOOR_POLICY`, which `?state=draft` runs).
//
// [#20408] …and the item read's and the book tree's: the item route's whole
// post-read chain (`createMetaItemAnswer` — absence, the item gate, the doc
// locale collapse, the object mask and its `private, no-store`, and the body
// `translateMetaEnvelope` builds: the translation and `sortability`), the one
// projection every object-schema exit applies (`projectMetaObjectSchema`), the
// `GET /meta/book/:name/tree` answer (`createMetaBookTreeAnswer`), the list's
// unknown-type refusal (`refuseUnknownMetaListType`) and the organization a
// caller's `/meta` request is scoped to — the VETTED one on its execution
// context (`metaCallerOrganizationId`, and `metaReadOrganizationId` for a read
// of one type).
//
// [#20478] …and the layered view's, on both of its spellings: its post-read
// chain (`createMetaLayeredAnswer` — the per-caller gate on every layer under
// the stored-version doors' policy, the object mask and its cache posture), the
// deprecated `?layers=` flag's parse (`wantsMetaItemLayers`) and the headers it
// is served under (`metaItemLayersDeprecationHeaders`). The read itself is each
// transport's, scoped by `metaReadOrganizationId`.
//
// [#21087] …and the type-level read admission both transports ask at their
// `/meta` entry, before any store read (`metaTypeReadRefusal` over
// `META_TYPE_READ_CAPABILITIES`): a datasource-family type is read under the
// capability its own door requires.
//
// [#21124] …and its write-side twin (`metaTypeWriteRefusal` over
// `META_TYPE_WRITE_CAPABILITIES`), asked at the same two entries before any
// store write: a datasource definition is written under the capability the
// datasource admin door requires.
export {
    createMetaBookTreeAnswer,
    createMetaItemAnswer,
    createMetaItemReadGate,
    createMetaLayeredAnswer,
    createMetaListReadGate,
    createMetaListAnswer,
    isPublicAudienceRead,
    META_TYPE_READ_CAPABILITIES,
    META_TYPE_WRITE_CAPABILITIES,
    metaCallerOrganizationId,
    metaItemLayersDeprecationHeaders,
    metaReadOrganizationId,
    metaRequestLocale,
    metaTypeReadRefusal,
    metaTypeWriteRefusal,
    projectMetaObjectSchema,
    refuseUnknownMetaListType,
    STORED_VERSION_DOOR_POLICY,
    translateMetaEnvelope,
    translateMetaList,
    wantsMetaItemLayers,
} from './meta-item-read-gate.js';
export type {
    MetaBookTreeAnswer,
    MetaBookTreeSources,
    MetaItemAnswer,
    MetaItemAnswerSources,
    MetaItemReadGateSources,
    MetaItemReadRefusal,
    MetaItemReadVerdict,
    MetaItemRequest,
    MetaLayeredAnswer,
    MetaLayeredRequest,
    MetaListAnswer,
    MetaListAnswerSources,
    MetaListRequest,
    MetaListTranslationSources,
    MetaPublicReadRoute,
    MetaReadGateCaller,
    MetaReadGatePolicy,
    MetaRequestHttp,
    MetaTypeReadRefusal,
    MetaTypeWriteRefusal,
} from './meta-item-read-gate.js';
