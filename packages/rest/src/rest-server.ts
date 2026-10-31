// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    IHttpServer, isAuthGateAllowlisted,
    // [commit 6a180e42d] Re-raise a permission-store OUTAGE through the fail-closed nets
    // below instead of degrading it into an anonymous/denied answer.
    rethrowAuthzStoreUnavailable,
    // [#13476] Raised HERE too, at the data-engine seam: an engine that cannot
    // be RESOLVED leaves the caller's permissions equally undetermined, so it
    // takes the same loud answer rather than the quiet 403 it used to wear.
    AuthzStoreUnavailableError,
    // [ruling record 6227928430, letter A] The ONE request-to-ExecutionContext
    // composition `computeExecCtx` calls, and the shape of the tenancy wiring
    // it hands over: [#13906 / #16013] the composition classifies the
    // `tenancy` read on BOTH wirings (the REGISTRY's own "never registered"
    // brand absorbs the supported no-tenancy composition, never message text,
    // #13905; every other rejection stays loud). ⛔ The two wirings themselves
    // are NOT the composition's — see `computeExecCtx`.
    resolveRequestExecutionContext,
    type TenancyServiceResolver,
    effectiveTenancyPosture,
    // The registry's "never registered" brand, asked directly by the public
    // form doors' tenancy read (see `registerFormEndpoints`).
    isServiceNotRegisteredError,
    // [#23367] The API-key lifecycle's branded refusal.
    isApiKeyLifecycleRefusalError, type ApiKeyLifecycleRefusalError,
    shouldDenyAnonymous, ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS,
    // Managing API keys is a signed-in-session act: the one rule
    // `enforceApiAccess` asks beside the exposure decision, shared with the
    // runtime dispatcher's per-object gate.
    apiKeyManagementCredentialRefusal,
    // `isAudienceBindingSuggestionStatus` and `unknownAudienceBindingSuggestionStatusMessage`,
    // the suggested-binding `?status=` vocabulary (#7678), moved with `registerSecurityEndpoints`'
    // body to `security-routes.ts` (#23050 slice 6).
    // `omitInternalFieldsFromWriteResponse`, the cross-object batch's update-arm
    // write-response rules, moved with that door to `batch-routes.ts` (#23050 slice 2).
} from '@objectstack/core';
import {
    // `isMcpServerEnabled`, the flag half of the `/discovery` document's `mcp` advertisement,
    // moved with `registerDiscoveryEndpoints`' body to `discovery-routes.ts` (#23050 slice 7).
    // `looksLikeInternalErrorLeak`, `declaresServerFault` and `INTERNAL_ERROR_MESSAGE`, the
    // analytics dataset door's fault-withhold reads, moved with that door to
    // `analytics-routes.ts` (#23050 slice 5).
    // `strandedDecisionDetails`, the stranded-decision carrier's recogniser
    // half, moved with `handleApprovalError` to `approvals-routes.ts` (#23050 slice 3).
    // [#20061] The thrown `VALIDATION_FAILED` + `fields[]` shape every catch in
    // this file already maps to `400` — see `readDeclaredQueryNumber` below.
    validationFailure,
} from '@objectstack/types';
import {
    allowPerfDisclosure,
    isPerfDisclosurePrincipal,
    OBSERVABILITY_METRICS_SERVICE,
} from '@objectstack/observability';
// [ADR-0106 / #3682] Metadata-plane FLS. One projection, one fingerprint,
// shared with the runtime `/metadata` dispatcher — see
// `@objectstack/metadata-core`'s `object-schema-fls.ts` for why the normalizer
// lives there rather than beside either set of exits.
import {
    ObjectSchemaMaskEvaluationError,
    applyObjectSchemaMask,
    isObjectSchemaMaskExempt,
    isObjectSchemaMaskingEnabled,
    // `relateObjectSchemaMaskPosture`, read only by the published read's mask, moved with that
    // door to `meta-item-history-routes.ts` (#23050 slice 13e).
    resolveObjectSchemaMaskPosture,
    OBJECT_SCHEMA_MASK_NOT_APPLICABLE,
    // `foldVisibilityFingerprintIntoEtag`, `normalizeIfNoneMatch` and
    // `resolveObjectSchemaRuntimeView`, read only by the item read's conditional
    // answer, moved with that body to `meta-item-read-routes.ts` (#23050 slice 13b).
    type ObjectSchemaMaskPosture,
    // [#12702 · ADR-0131 D6] Which callers a `/meta` item write door admits:
    // `manage_metadata` (or `isSystem`). One predicate for every `/meta` item
    // write door on both transports — never a REST-local restatement. Since
    // the per-organization overlay axis retired, no `/meta` door carries an
    // organization into a metadata write or read: every write lands
    // environment-wide and every read resolves environment → code.
    metaWriteCapabilityVerdict,
    type MetaWriteCapabilityVerdict,
    // [ADR-0131 D3 · D12 items 7–8] The walled refusal the same four doors ask
    // next, for every type they write.
    walledCatalogWriteVerdict,
    // Which form candidates the anonymous form doors serve — the one rule the
    // metadata protocol also judges organization-scoped `view` writes by.
    anonymousFormIntakeCandidates,
    // `anonymousFormIntakeWithdrawnIn` (whether another body of the same view name withdraws a
    // candidate), read only by the anonymous form doors, moved with `registerFormEndpoints`'
    // body to `form-routes.ts` (#23050 slice 11).
    // [#21476] Whether such a form can take intake on this posture, and why not
    // — the one predicate the runtime authoring gate's advisory reads too.
    anonymousFormIntakePosture,
    anonymousFormIntakeUnavailability,
    anonymousFormIntakeUnavailableMessage,
    anonymousFormObjectName,
    anonymousFormSharingPath,
    // [#21476] `objectFieldVisibilityFingerprint`, the ADR-0106 fingerprint the admin
    // read folds the reason into — and [#22639] the list views the read gate
    // withheld — read only by the item read and its intake-reason helper, moved with
    // them to `meta-item-read-routes.ts` (#23050 slice 13b).
} from '@objectstack/metadata-core';
import { RouteManager, type RouteEntry } from './route-manager.js';
// [#6877] Query-parameter multiplicity. `IHttpRequest.query` declares
// `string | string[]`; the array arm is real (`NodeHttpServer` produces it,
// measured over a socket on #6878) and this file used it as a string at ~50
// read points. Each handler below declares WHICH of its parameters are
// single-valued; genuinely multi-valued ones (`select`, `expand`, `objects`,
// `fields`, `searchFields`, `approverId`) are deliberately never listed.
// `assertFilterParamSuppliedOnce` (#7390), the `/data` list's filter-slot arity rule, read only
// by that door, moved with `registerCrudEndpoints`' body to `crud-routes.ts` (#23050 slice 12).
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
// `refuseUnknownQueryParams`, the other half of the same discipline (a parameter a route does
// not KNOW is refused rather than dropped; see `query-allowlist.ts`), read only by the
// published read, moved with that door to `meta-item-history-routes.ts` (#23050 slice 13e).
import type { DirectMountedRoute, MountedRouteSource } from './direct-mount.js';
import { RestServerConfig, RestApiConfigParsed } from '@objectstack/spec/api';
// `standardErrorCodeForHttpStatus` (#11683), the catalog's floor for a required `code`, read
// only by the security-explain family's classified-refusal arm, moved with that body to
// `security-routes.ts` (#23050 slice 6).
// [#11637] The DECLARED contract for `config.api`, imported as a VALUE rather
// than a type. Both hops into this package were casts, so this schema had
// never run on any deployment path — see `parseDeclaredApiConfig` below.
import {
    RestApiConfigSchema,
    CrudEndpointsConfigSchema,
    MetadataEndpointsConfigSchema,
    BatchEndpointsConfigSchema,
    RouteGenerationConfigSchema,
} from '@objectstack/spec/api';
import { z } from 'zod';
import { DataProtocol, MetadataProtocol } from '@objectstack/spec/api';
// [#20061 / #20062 / #20139] The DECLARED request schemas the three
// query-reading doors parse their numeric parameters through — see
// `readDeclaredQueryNumber` below — all moved with their doors: the change log's
// and the audit trail's (`HistoryMetaItemRequestSchema`, `AuditMetaItemRequestSchema`)
// to `meta-item-history-routes.ts` (#23050 slice 13d), and `ListImportJobsRequestSchema`
// to `data-action-routes.ts` (#23050 slice 1).
// [#23183] The app item read's package-id key, spelled once in the spec — see
// `fetchCurrentMetaDocument`, whose doors stay by-name.
import { isAppPackageIdKey } from '@objectstack/spec/api';
// [commit 2a29caa53] Declared request shapes for the meta-read doors below — imported so
// each door's request literal is compiled against the spec contract instead of
// being smuggled past it with `as any` (see `TransportScopedMetaRequest`).
import type {
    GetMetaItemsRequest,
    GetMetaItemRequest,
    // `GetMetaItemCachedRequest`, the item read's cached-path request, moved with that
    // body to `meta-item-read-routes.ts` (#23050 slice 13b).
    GetMetaItemLayeredRequest,
    // `PublishMetaItemRequest`, `AuditMetaItemRequest` and `HistoryMetaItemRequest`, the
    // publish's, the audit trail's and the change log's declared requests, moved with those
    // doors to `meta-item-history-routes.ts` (#23050 slice 13d).
    // `SaveMetaItemRequest` and `DeleteMetaItemRequest`, the item save's and the reset's
    // declared requests, moved with those doors to `meta-item-write-routes.ts` (#23050
    // slice 13c).
} from '@objectstack/spec/api';
// `GetUiViewRequest`, the UI view door's declared request, moved with that door to
// `ui-routes.ts` (#23050 slice 10).
// [#15866] The five data request types (`FindDataRequest`, `GetDataRequest`, `CreateDataRequest`,
// `UpdateDataRequest`, `DeleteDataRequest`), which every CRUD door's literal is compiled against
// through `ServerScopedDataRequest`, moved with `registerCrudEndpoints`' body to `crud-routes.ts`
// (#23050 slice 12).
// The four bulk request types (`BatchDataRequest`, `CreateManyDataRequest`,
// `UpdateManyDataRequest`, `DeleteManyDataRequest`) moved with their doors to
// `batch-routes.ts` (#23050 slice 2).
// `ErrorCode` (#8073), the closed vocabulary the security-explain family's one refusal
// emitter types its `code` as, moved with that body to `security-routes.ts` (#23050 slice 6).
// [#10235] The per-column sortability projection the object read serves on its
// envelope (2026-08-23 ruling, option A): computed HERE, at the one seam every
// single-item read path rebuilds its body through, from the spec's own storage
// predicates — so the signal the grid reads cannot drift from what the runtime
// doors (#6994/#7095) refuse.
// `PUBLIC_FORM_SERVER_MANAGED_FIELDS`, read only by the anonymous form doors, moved with
// `registerFormEndpoints`' body to `form-routes.ts` (#23050 slice 11).
// `canonicalMetaUrlType`, read only by the published read's code-store fallback, moved with
// that door to `meta-item-history-routes.ts` (#23050 slice 13e).
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
// `stripReadDecorations`, read only by the analytics dataset door, moved with that door to
// `analytics-routes.ts` (#23050 slice 5).
// [#20193] THE per-caller read gate of a `/meta/:type/:name` document, and the
// docs-audience and app-nav gates it is built from — one implementation, which
// this server and the runtime dispatcher's `/meta` domain both call. The
// private helpers below that still have a caller here keep their names as
// one-line delegates into it.
//
// [#20237] …and THE per-caller LIST gate of `GET /meta/:type`
// (`createMetaListReadGate`), which the list route below calls whole. The
// delegates only that route called (`filterAppForUser`,
// `filterDashboardForUser`, `resolveRegisteredServices`,
// `resolveNavServability`, `resolveNavDocAudience`, `fetchAudienceBooks`,
// `docCorpusOf`) went with it: a delegate with no caller is a second place to
// read a rule that nothing runs.
//
// [#20408] The book-tree route's own two (`audienceBooksOf`,
// `resolveDocsAudience`) went the same way when its whole answer moved to
// `createMetaBookTreeAnswer`, which the runtime dispatcher serves too.
import * as metaReadGate from './meta-item-read-gate.js';
import type {
    MetaItemReadGateSources,
    MetaItemReadRefusal,
    MetaReadGateAudienceSources,
    MetaReadGateCaller,
    MetaReadGateListSource,
    MetaReadGatePolicy,
} from './meta-item-read-gate.js';
// [#20237] The server-side app filter, by name, at the path ADR-0056's
// verification table cites for it (`rest-server.ts#filterAppForUser`, row 18):
// the one implementation is `meta-item-read-gate.ts`'s, and this re-export is
// where that pointer lands — one hop from it. It is NOT on the package barrel
// (`index.ts` names this file's exports one by one). Re-anchoring the ADR row
// to the implementation is a governed-surface edit, so it is left to the
// maintainer; this line goes when that row moves.
export { filterAppForUser } from './meta-item-read-gate.js';
// [#23072] What the by-name `/meta` doors read beside the query decision both
// transports ask (`metaItemQueryRefusal`) — see the re-export above the sets.
import {
    // `META_ITEM_LAYERS_PARAMS` is read only by the `/layers` door, which moved to
    // `meta-item-read-routes.ts` (#23050 slice 13b); the re-export below still names it.
    // `META_ITEM_SAVE_PARAMS` is read only by the item save, which moved to
    // `meta-item-write-routes.ts` (#23050 slice 13c); the re-export below still names it.
    // `META_ITEM_PUBLISHED_PARAMS` is read only by the `/published` door, which moved to
    // `meta-item-history-routes.ts` (#23050 slice 13e); the re-export below still names it.
    META_ITEM_MEMBER_PARAM,
    // `metaMemberSelector`, the member selector's one reading, is read by the history
    // family's `?member=` doors, which moved to `meta-item-history-routes.ts` (#23050
    // slice 13d), and [#26699] by `serveMetaItemLayered` below, through `metaReadGate`.
} from './meta-item-read-gate.js';
// [#22141] `metaSaveRequestOptions`, the `PUT /meta/:type/:name` door's precondition and
// lifecycle mapping, moved with that door to `meta-item-write-routes.ts` (#23050 slice 13c).
import type { ISecurityService } from '@objectstack/spec/contracts';
import {
    resolveEffectiveApiMethods,
    effectiveOperationsArray,
    apiExposureDenialReason,
    isApiOperationAllowed,
    API_PRIMITIVES,
    DATA_ACTION_TO_API_OPERATION,
} from '@objectstack/spec/data';
// [#8013] The SHARED envelope writer (#3973), aliased. [#9098] The alias no
// longer exists to dodge a NAME collision — the local responder this used to
// collide with is `sendThrownError` now — it marks the ENVELOPE DIALECT, which
// is the difference that actually matters and the one still open. This one
// emits the declared, NESTED `{ success: false, error: { code, message } }` for
// a refusal the handler DECIDED; `sendDeclaredFault` emits the same refusal in
// this package's FLAT `{ error, code }` dialect, whose convergence onto the
// nested position is held by the `check:route-envelope` ratchet (⚠️ NOT #7035,
// which closed on 2026-08-10 with PR #7293 after converging this file's three
// `/meta` 501 handlers only). Both type `code` to the closed ADR-0112
// vocabulary rather than `string`, so the choice between them is about POSITION
// only, never strictness — and since #9232 that is true of THROWN codes at both
// doors too, not just of the two typed author-side responders.
// Adding a call site here moves no `check:route-envelope` count:
// the body literal lives in `@objectstack/types` (the pinned `SHARED_BUILDER`),
// and this file is audited `dialectOnly` for the two non-conforming dialects it
// still emits — which this deliberately is not.
import { sendError as sendEnvelopeError } from '@objectstack/types';

/**
 * The protocol slice the REST layer actually consumes (ADR-0076 D9 / #2462
 * A1.5): wire-normalized data CRUD plus the metadata control plane — not the
 * full `ObjectStackProtocol` union. Server-only extensions (drafts, history,
 * diagnostics, clone, …) are feature-detected via runtime casts and so don't
 * widen this contract.
 *
 * [#24535] One server-only extension is declared here, OPTIONAL, so it widens
 * nothing a protocol must provide either: `getMetaItemForExecution`, the
 * by-name read without the serving decorations
 * (`ObjectStackProtocolImplementation.getMetaItemForExecution`). The REST
 * API-exposure gate feature-detects it ({@link RestServer.enforceApiAccess});
 * a protocol without it is asked `getMetaItem`, as before. ⛔ No door serves
 * what it returns.
 *
 * [#25783] …and its LIST twin, `getMetaItemsForExecution`, equally optional:
 * the object list every gate reads only to learn each object's `enable`
 * ({@link RestServer.metaListSource}). A protocol without it is asked
 * `getMetaItems`, as before. ⛔ No door serves what it returns either.
 */
export type RestProtocol = DataProtocol & MetadataProtocol & {
    getMetaItemForExecution?: MetadataProtocol['getMetaItem'];
    getMetaItemsForExecution?: MetadataProtocol['getMetaItems'];
};

// [#23050 slice 10] `TransportScopedMetaRequest`, the meta doors' request envelope, moved to
// `ui-routes.ts` with the UI view door's body, its first reader outside this file: exporting
// it from here changed the published `dist/*.d.ts` by one line, and a second copy is not an
// option. [#23050 slice 13a] It moved on, verbatim, to `meta-collection-routes.ts` (imported
// below), the module of the first `/meta` groups the split took out of this file.

// [#23050 slice 1] `ServerScopedDataRequest`, the data doors' request envelope, moved to
// `data-action-routes.ts`: exporting it from this file for that module changed the published
// `dist/*.d.ts` by one line, and a second copy is not an option. Its last reader here, the CRUD
// doors' body, moved to `crud-routes.ts` (#23050 slice 12), which imports it from there.

import {
    buildFieldMetaMap,
    headerLabel,
    formatRowCells,
    exportContentDisposition,
    isCsvTextColumn,
    markCsvTextCell,
    type ExportBooleanWords,
    type ExportFieldMeta,
} from './export-format.js';
// [#23050 slice 1] The data-action routes' body moved to its own module — see its header.
import { registerDataActionEndpoints, type DataActionRouteHost } from './data-action-routes.js';
// [#27627] The record page payload route — see its module header.
import { registerRecordPageEndpoints, type RecordPageRouteHost } from './record-page-routes.js';
// [#27627] The app metadata bundle route — see its module header.
import { registerMetaAppBundleRoute, type MetaAppBundleRouteHost } from './meta-app-bundle-routes.js';
// [#23050 slice 2] The batch routes' body moved to its own module — see its header.
import { registerBatchEndpoints, type BatchRouteHost } from './batch-routes.js';
// [#23050 slice 3] The approval routes' body moved to its own module — see its header.
import { registerApprovalsEndpoints, type ApprovalsRouteHost } from './approvals-routes.js';
// [#23050 slice 4] The record-sharing and sharing-rule routes' bodies moved to one module — see its header.
import {
    registerSharingEndpoints,
    registerSharingRuleEndpoints,
    type SharingRouteHost,
    type SharingRuleRouteHost,
} from './sharing-routes.js';
// [#23050 slice 5] The analytics dataset route's body moved to its own module — see its header.
// `datasetSelectionRefusal`, that door's selection parse (#17551), moved with it.
import { registerAnalyticsEndpoints, type AnalyticsRouteHost } from './analytics-routes.js';
// [#23050 slice 6] The security-explain and suggested-binding routes' bodies moved to one module — see its header.
import {
    registerSecurityEndpoints,
    registerSecurityExplainEndpoints,
    type SecurityExplainRouteHost,
    type SecurityRouteHost,
} from './security-routes.js';
// [#23050 slice 7] The discovery and OpenAPI routes' bodies moved to one module — see its header.
import {
    registerDiscoveryEndpoints,
    registerOpenApiEndpoints,
    type DiscoveryRouteHost,
    type OpenApiRouteHost,
} from './discovery-routes.js';
// [#23050 slice 8] The email route's body moved to its own module — see its header.
import { registerEmailEndpoints, type EmailRouteHost } from './email-routes.js';
// [#23050 slice 9] The global search route's body moved to its own module — see its header.
import { registerSearchEndpoints, type SearchRouteHost } from './search-routes.js';
// [#23050 slice 10] The UI view route's body moved to its own module — see its header.
import { registerUiEndpoints, type UiRouteHost } from './ui-routes.js';
// [#23050 slice 11] The public form routes' body moved to its own module — see its header.
import { registerFormEndpoints, type FormRouteHost } from './form-routes.js';
// [#23050 slice 12] The CRUD routes' body moved to its own module — see its header.
import { registerCrudEndpoints, type CrudRouteHost } from './crud-routes.js';
// [#23050 slice 13a] The `/meta` type list, whole-store maintenance and per-type list
// groups moved to their own module — see its header. That module is also the home of the
// meta doors' request envelope `TransportScopedMetaRequest` and of `MetaRouteScope`.
import {
    registerMetaCollectionRoutes,
    type MetaCollectionRouteHost,
    type MetaRouteScope,
    type TransportScopedMetaRequest,
} from './meta-collection-routes.js';
// [#23050 slice 13b] The `/meta` per-item reads (`/references`, `/layers`, the book tree
// and the item read) moved to their own module — see its header.
import { registerMetaItemReadRoutes, type MetaItemReadRouteHost } from './meta-item-read-routes.js';
// [#23050 slice 13c] The `/meta` per-item writes (the item save and the reset) moved to
// their own module — see its header.
import { registerMetaItemWriteRoutes, type MetaItemWriteRouteHost } from './meta-item-write-routes.js';
// [#23050 slice 13d] The `/meta` history family (the change log, the audit trail, the
// publish, the rollback and the version comparison) moved to its own module — see its header.
// [#23050 slice 13e] The published read joined it there, as that module's second function.
import {
    registerMetaItemHistoryRoutes,
    registerMetaItemPublishedRoute,
    type MetaItemHistoryRouteHost,
    type MetaItemPublishedRouteHost,
} from './meta-item-history-routes.js';
// [#23050 slice 13e] The `/meta` object state-machine read moved to its own module — see its
// header.
import { registerMetaObjectStateRoute, type MetaObjectStateRouteHost } from './meta-object-state-routes.js';
import { loadExcelJs, type Worksheet } from './xlsx-module.js';
// [#18386] `?template=true` on the export door: the import template's column
// rule, request reading and workbook. See the module header.
import {
    buildImportTemplateWorkbook,
    describeTemplateColumns,
    resolveTemplateProjection,
    templateColumns,
    templateText,
    type TemplateProjectionSource,
} from './import-template.js';
// `enrichOpenApiWithEndpoints` (#5040 E6), `buildBuiltinPaths` (#5588) and
// `selectServedEndpoints` (#5224), read only by the OpenAPI document's handler, moved with
// `registerOpenApiEndpoints`' body to `discovery-routes.ts` (#23050 slice 7).
import {
    isEndpointMatchAuthority,
    type EndpointMatchAuthority,
} from './served-endpoints.js';

import { logError, logWarn } from './log.js';
// [commit 8664a2c99] The ADR-0112 error/fault-classification prologue — how a thrown thing
// becomes an HTTP answer — was module-level code sitting ahead of this class for
// historical reasons and now lives in its own module. A move, not a redesign:
// same functions, same wire answers, and `mapDataError` re-exported below so the
// surface `./rest-server.js` has always offered is byte-identical.
import {
    mapDataError,
    // `sandboxBusinessMessage`, `boundedDeclaredUserMessage` and `declaredServerFaultAnswer`,
    // read only by the analytics dataset door, moved with that door to `analytics-routes.ts`
    // (#23050 slice 5).
    // `classifiedRefusalAnswer`, `nestedRefusalEnvelope` and `sandboxFaultAnswer`, read only
    // by the two security families' refusal and fault arms, moved with those bodies to
    // `security-routes.ts` (#23050 slice 6).
    // `boundedDeclaredRefusalMessage` and `declaredHttpStatus`, read only by the
    // `/references` door's declared-refusal re-dresser, moved with it to
    // `meta-item-read-routes.ts` (#23050 slice 13b).
    // `sendThrownError`, the OpenAPI document's catch-all answer, moved with
    // `registerOpenApiEndpoints`' body to `discovery-routes.ts` (#23050 slice 7).
    sendDeclaredFault,
    sendFieldVisibilityFault,
    // `handleRouteError`, read only by the object state-machine read's and the published read's
    // catches, moved with those doors to `meta-object-state-routes.ts` and
    // `meta-item-history-routes.ts` (#23050 slice 13e).
    // `thrownAnswerIsBareNotFound`: the item read's catch moved to `meta-item-read-routes.ts`
    // (#23050 slice 13b) and the diff door's to `meta-item-history-routes.ts` (#23050
    // slice 13d); the event doors' refusal here still reads it (#24210).
    thrownAnswerIsBareNotFound,
    // `logUnexpectedRouteError` and `applyDroppedFieldsHeader`, read only by the CRUD doors' catches
    // and their two write answers, moved with `registerCrudEndpoints`' body to `crud-routes.ts`
    // (#23050 slice 12).
    // `isExpectedRouteError`, read only by the public form submit door's catch, moved with
    // `registerFormEndpoints`' body to `form-routes.ts` (#23050 slice 11).
} from './error-response.js';
export { mapDataError };



/**
 * The ADR-0114 D3 mapper — Zod issue codes → the closed `FieldErrorCode`
 * catalog, with the #5014 union-branch expansion — lived here module-locally
 * until #8124 moved it to `@objectstack/spec` (`api/zod-issues-to-fields.ts`),
 * beside the catalog it is total over. The move exists because
 * `@objectstack/types`' `fieldsFromZodIssues` (the helper the runtime domain
 * routes emit through) was still passing `issue.code` through raw, and `types`
 * cannot import this package to share the compliant copy — the dependency
 * arrow points rest → types, never back. One implementation of D3's table in
 * the repo; a second is the drift the ADR exists to prevent.
 *
 * Re-exported unchanged: this module's routes call it exactly as before, and
 * `zod-field-codes.test.ts` / `zod-union-fields.test.ts` keep pinning the
 * shared implementation to the wire contract this transport always had.
 */
import { zodIssuesToFields } from '@objectstack/spec/api';
export { zodIssuesToFields };

/** Extra context for a gate check: import `writeMode` precision / bulk∧child. */
interface ApiAccessOpts {
    writeMode?: string;
    bulkChild?: string;
}

/**
 * [#15416] The operation to NAME in a `method-not-allowed` refusal.
 *
 * The message and the `allowed` array are ONE envelope and have to agree. They
 * stopped agreeing wherever the gate judged a CONJUNCTION: `deleteMany` is
 * `bulk ∧ delete`, and an `insert` import is `import` refined to `create`. An
 * object granting `bulk` and `update` but not `delete` was therefore refused
 * with `API operation 'bulk' is not allowed` beside an `allowed` array that
 * CONTAINS `bulk` — the refusal named the conjunct that PASSED.
 *
 * That is worse than a vague message, because the envelope is read as a
 * DISCRIMINATOR rather than as decoration: a declaration re-widened to
 * create/update can still 405 for an unrelated reason, so only the set proves
 * WHICH gate answered. A set contradicting its own message is specific and
 * wrong, and a later reader concludes either that the verb is still open or
 * that the gate closed the composite — both false.
 *
 * ## Why this probes instead of re-spelling the derivation
 *
 * The failing conjunct is found by asking the spec's OWN decision function,
 * never by copying its table here: widen the declared whitelist by the missing
 * primitives — smallest combination first — and the widening that clears the
 * refusal names what the refusal was about. `isApiOperationAllowed` stays the
 * single source of truth, so a future refinement (another `writeMode`, another
 * derived verb) is tracked with no second spelling to drift away from it. The
 * search is monotone and runs only on the 405 path, over six primitives.
 *
 * Returns `undefined` when the name is already truthful — the operation as
 * named is absent from the effective set, so there is no contradiction and the
 * existing message is left exactly as it was.
 */
function deniedConjunctName(
    enable: any,
    eff: ReturnType<typeof resolveEffectiveApiMethods>,
    canonical: string,
    opts?: ApiAccessOpts,
): string | undefined {
    // The contradiction IS the trigger: only rewrite a name the envelope's own
    // `allowed` array contradicts.
    if (!eff.operations.has(canonical as any)) return undefined;

    const granted = API_PRIMITIVES.filter((p) => eff.primitives.has(p));
    const missing = API_PRIMITIVES.filter((p) => !eff.primitives.has(p));
    const clears = (extra: readonly string[]): boolean =>
        isApiOperationAllowed(
            resolveEffectiveApiMethods({ ...(enable ?? {}), apiMethods: [...granted, ...extra] }),
            canonical,
            opts,
        );

    for (const p of missing) if (clears([p])) return p;
    // Two conjuncts can be missing at once (`upsert` needs create AND update).
    // Naming either one is truthful and neither is in `allowed`; name the first
    // in the enum's own order so the message is deterministic.
    for (let i = 0; i < missing.length; i += 1) {
        for (let j = i + 1; j < missing.length; j += 1) {
            if (clears([missing[i]!, missing[j]!])) return missing[i];
        }
    }
    return undefined;
}

/**
 * Pure per-object API-exposure check: given an object's `enable` block, decide
 * whether `operation` is denied on the *external* REST surface (ADR-0049 /
 * #1889 / #3391). Returns the `{ status, body }` to send, or `null` when
 * allowed. Shared by the single-record routes (`enforceApiAccess`) and the
 * cross-object batch route so both honour the SAME gate.
 *
 * #3391: the decision comes from the spec's single derivation source of truth
 * (`resolveEffectiveApiMethods` / `isApiOperationAllowed`), so the three-state
 * whitelist (`undefined` unrestricted / `[]` deny-all / subset) and the derived
 * verbs (import⊆create∨update, export⊆list, bulk∧child, …) are resolved
 * identically everywhere. The 405 body's `allowed` array is the EFFECTIVE
 * operation set (enum-ordered), the single "effective" channel the frontend
 * consumes — never the raw whitelist.
 *
 * [#7912] The two-step ORDER those primitives compose into — `apiEnabled`
 * first and independently, the whitelist second — is now the spec's
 * `apiExposureDenialReason`, and this function is its ENVELOPE half: it turns
 * the reason into the 404/405 body this surface sends. The extraction is what
 * lets the nav-servability prune below (and the authoring-time lint that warns
 * about the same entry) reach the identical verdict without a second spelling
 * of the order to drift from this one.
 */
export function apiAccessDenialFromEnable(
    enable: any,
    objectName: string,
    operation: string,
    opts?: ApiAccessOpts,
): { status: number; body: Record<string, unknown> } | null {
    // Canonicalization stays HERE: `operation` arrives as a runtime action name
    // on this surface, while the spec helper's contract is a canonical
    // `ApiOperation`.
    const canonical = DATA_ACTION_TO_API_OPERATION[operation] ?? operation;
    const reason = apiExposureDenialReason(enable, canonical, opts);
    if (!reason) return null;
    if (reason === 'api-disabled') {
        return {
            status: 404,
            body: {
                error: `Object '${objectName}' is not exposed via the API`,
                code: 'OBJECT_API_DISABLED',
                object: objectName,
            },
        };
    }
    // [#15416] Name the conjunct that actually FAILED, not the composite the
    // route gated under; `deniedConjunctName` returns `undefined` when the
    // requested name is already absent from `allowed` and nothing needs saying
    // differently.
    const eff = resolveEffectiveApiMethods(enable);
    const named = deniedConjunctName(enable, eff, canonical, opts) ?? operation;
    return {
        status: 405,
        body: {
            error: `API operation '${named}' is not allowed on object '${objectName}'`,
            code: 'OBJECT_API_METHOD_NOT_ALLOWED',
            object: objectName,
            allowed: effectiveOperationsArray(eff),
        },
    };
}

/**
 * [#7527] The closed query-parameter set of `GET {basePath}/approvals/requests`.
 *
 * Measured from the handler's own reads, not from the card or the docs: the
 * five filters (`object`, `recordId`, `status`, `approverId`, `submitterId`),
 * the free-text `q`, the paging pair (`limit`, `offset`), and the snake_case
 * alias spellings the handler honours for the three camelCase filters. A name
 * outside this set is refused with a located `400` instead of being dropped.
 *
 * Exported so the pin tests assert against THIS array rather than a
 * hand-copied second list that can drift away from what the route accepts.
 */
export const APPROVAL_REQUEST_LIST_PARAMS: readonly string[] = [
    'object',
    'recordId', 'record_id',
    'status',
    'approverId', 'approver_id',
    'submitterId', 'submitter_id',
    'q',
    'limit', 'offset',
];

/**
 * [#7606] The closed query-parameter set of `GET {basePath}/data/:object/:id`.
 *
 * **Measured**, at `registerCrudEndpoints`' read-record handler, from the ONE
 * line that reads the query — `const { select, expand } = req.query || {}`.
 * The handler destructures exactly these two names and forwards nothing else,
 * so every other parameter on this route is dropped in the fullest sense: it
 * never reaches `getData` at all.
 *
 * ⚠️ The accepted names deliberately EXCLUDE the CANONICAL spelling of one
 * slot. The spec's alias table (`RPC_QUERY_ALIAS_SLOTS`) declares the fields
 * slot as canonical `fields` with alias `select`, and the expand slot as
 * canonical `expand` with alias `populate` — but this route folds no aliases,
 * so `fields` / `populate` are not synonyms for anything this handler reads.
 * Putting them in the allowlist unfolded would advertise a capability the
 * handler does not implement — the declared-≠-enforced trap in the other
 * direction, and strictly worse than refusing them: a caller sending
 * `?fields=title` would pass recognition, then silently get back the FULL
 * record because nothing downstream of the gate consumes the name. Refusing
 * them instead makes the gap self-reporting — the located `400` names
 * `select` / `expand` as what this route accepts.
 *
 * **[#8039] Settled by maintainer ruling, 2026-08-12 — record, not an open
 * question.** Three shapes were on the table for the mismatch between this
 * route's two names and the spec's alias table: (1) fold
 * `RPC_QUERY_ALIAS_SLOTS` onto this route, so `fields` / `populate` start
 * working here too; (2) keep this narrow set, but refuse the alias-table
 * spellings loudly instead of dropping them; (3) keep + document as-is. The
 * ruling took **option 2**, which is exactly what `refuseUnknownQueryParams`
 * below already does — `fields` and `populate` are refused the same way any
 * other unrecognised name is, naming `select` / `expand` as the accepted
 * pair. ⛔ **Option 1 was explicitly rejected** and stays rejected here:
 * folding the alias table onto this ONE route is surface expansion on a
 * public route with no measured pull behind it, and doing it for this route
 * alone would leave every other data route's ingress inconsistent in the
 * opposite direction. The only thing that changes this: a ruling that
 * declares `RPC_QUERY_ALIAS_SLOTS` universal across ALL data routes, landed
 * as one card applying the fold everywhere at once — never a quiet widening
 * of this route's set in isolation.
 */
export const DATA_RECORD_READ_PARAMS: readonly string[] = ['select', 'expand'];

/**
 * [#7606] The closed query-parameter set of `GET {basePath}/data/:object/export`.
 *
 * **Measured** from the export handler's own reads of `q = req.query ?? {}`,
 * every one of them: the output controls (`format`, `header`), the paging pair
 * (`limit`, and `page` — which on this route is the streaming CHUNK size, not
 * a page number), the row-selection axes (`filter`, `search`, `searchFields`,
 * `orderby`) and the column selection (`fields`).
 *
 * ⚠️ …and `locale`, **which the handler body never mentions**. It is read one
 * frame down, by `extractLocale` behind the `translateMetaItem` call that
 * localises the header row — the "anything middleware reads" clause of the
 * measuring rule, and the single name on this route that a read of the handler
 * alone gets wrong. Omitting it would 400 every `?locale=zh-CN` export that
 * works today, turning localised column headers into an outage: precisely the
 * silent-widening-traded-for-a-loud-incident failure the policy warns about,
 * committed by the change meant to prevent it. The measurement is only
 * finished when the helpers the handler calls have been read too.
 *
 * `fields` and `searchFields` are in this set but are deliberately absent from
 * the route's sibling multiplicity declaration: both read their array arm on
 * purpose (columns are genuinely a list). Recognition and arity are separate
 * questions and a name can be answered differently by each.
 *
 * ⚠️ Dropping `limit` from this array would convert a silent-widening bug into
 * a loud export outage — the preservation half of
 * `rest-server-closed-query-params.test.ts` exists to make that impossible to
 * land, and pins `locale` by name for the reason above.
 *
 * [#18386] …and `template`, the mode switch: `template=true` answers an xlsx
 * IMPORT template (`./import-template.ts`) instead of the data. It is read by
 * `readTemplateMode`, which also refuses the row parameters above on a
 * template request, since a template has no rows for them to select. It also
 * switches the door's gates: a template request is judged by the IMPORT door's
 * (the object's import exposure and the caller's create permission), not by
 * the export's — a template carries no records to egress ([#20896] ruling A).
 */
export const DATA_EXPORT_PARAMS: readonly string[] = [
    'format', 'header',
    'limit', 'page',
    'filter', 'search', 'searchFields', 'orderby',
    'fields',
    'locale',
    'template',
];

/**
 * [#7606] The closed query-parameter set of `GET {basePath}/search`.
 *
 * **Measured** from the cross-object search handler: the term under both
 * spellings it honours (`q`, and the `query` fallback the very next line
 * reads), the object scope (`objects`), and the two result caps (`limit`,
 * `perObject`). A dropped `?objects=` here is the widening case in its purest
 * form — the search silently fans out across every object instead of the one
 * the caller named.
 */
export const GLOBAL_SEARCH_PARAMS: readonly string[] = [
    'q', 'query', 'objects', 'limit', 'perObject',
];

// [#22877 · #23072] The member selector's name (`META_ITEM_MEMBER_PARAM`), its
// one reading (`metaMemberSelector`), the item read's closed set
// (`META_ITEM_READ_PARAMS`) and the save, `/layers` and `/published` sets
// (`META_ITEM_SAVE_PARAMS`, `META_ITEM_LAYERS_PARAMS`,
// `META_ITEM_PUBLISHED_PARAMS`) live in `./meta-item-read-gate.ts`, beside the
// by-name doors' query decision both transports ask (`metaItemQueryRefusal`,
// ruling 6138588561). Imported for the doors below, which read them by the
// names they always did, and re-exported from here unchanged.
export {
    META_ITEM_MEMBER_PARAM,
    META_ITEM_READ_PARAMS,
    META_ITEM_SAVE_PARAMS,
    META_ITEM_LAYERS_PARAMS,
    META_ITEM_PUBLISHED_PARAMS,
} from './meta-item-read-gate.js';

/**
 * [#22877] The closed set of `DELETE {metaPath}/:type/:name` (the reset).
 * **Measured**: `state` (the draft discard) and `dropStorage` (the opt-in
 * table teardown); the OCC pin and the actor ride headers and the session.
 * Plus {@link META_ITEM_MEMBER_PARAM}. [#23165, ADR-0048] Plus `package`, the
 * row the delete removes, read through {@link metaItemPackageBinding} as the
 * other doors of the item read it: a delete naming no package of an item two
 * packages hold is refused `409`, and naming the package is its remedy.
 */
export const META_ITEM_RESET_PARAMS: readonly string[] = ['state', 'dropStorage', 'package', META_ITEM_MEMBER_PARAM];

/**
 * [#22877] The closed set of `GET {metaPath}/:type/:name/history`.
 * **Measured**: the paging pair `sinceSeq` and `limit`, each read through its
 * declaration (`readDeclaredQueryNumber`); the authoring-door and per-caller
 * refusals read the session, not the query. Plus {@link META_ITEM_MEMBER_PARAM}.
 */
export const META_ITEM_HISTORY_PARAMS: readonly string[] = ['sinceSeq', 'limit', META_ITEM_MEMBER_PARAM];

/**
 * [#22877] The closed set of `POST {metaPath}/:type/:name/publish`.
 * **Measured**: `package` (the draft's package binding,
 * `metaItemPackageBinding`); the message rides the body, the actor the
 * session. Plus {@link META_ITEM_MEMBER_PARAM}.
 */
export const META_ITEM_PUBLISH_PARAMS: readonly string[] = ['package', META_ITEM_MEMBER_PARAM];

/**
 * [#22877] The closed set of `POST {metaPath}/:type/:name/rollback`.
 * **Measured**: `toVersion`, the query fallback after the body's `toVersion` /
 * `version`; the message rides the body, the actor the session. Plus
 * {@link META_ITEM_MEMBER_PARAM}.
 */
export const META_ITEM_ROLLBACK_PARAMS: readonly string[] = ['toVersion', META_ITEM_MEMBER_PARAM];

// [#23072] The by-name `/meta` doors OUTSIDE ruling 6116165299's list, each
// with the closed set measured from its own read points (AGENTS.md route rule
// 5). None carries {@link META_ITEM_MEMBER_PARAM}: the protocol request behind
// each declares no member selector, so `?member=` is refused with the located
// 400 like any other name the door does not read — never dropped, which
// answered the canonical member (or, on `PUT`, wrote the body's) to a request
// that named another. `PUT`'s, `/layers`' and `/published`' sets are re-exported
// above, from the module the runtime dispatcher's copies of those doors read.

/**
 * [#23072] The closed set of `GET {metaPath}/:type/:name/references`: EMPTY.
 * **Measured**: the handler reads no query parameter, and neither does the
 * helper it calls (`resolveProtocol` reads the route, the hostname and the
 * `X-Environment-Id` header); `findReferencesToMeta` is asked of the type and
 * the name alone. A reference names an item, never one member of a bundle, so
 * the reverse sweep has no member to select.
 */
export const META_ITEM_REFERENCES_PARAMS: readonly string[] = [];

/**
 * [#23072] The closed set of `GET {metaPath}/:type/:name/audit`.
 * **Measured**: `limit`, read through its declaration
 * (`AuditMetaItemRequestSchema.limit`, `readDeclaredQueryNumber`); the
 * authoring-door and per-caller refusals read the session.
 */
export const META_ITEM_AUDIT_PARAMS: readonly string[] = ['limit'];

/**
 * [#23072] The closed set of `GET {metaPath}/:type/:name/diff`.
 * **Measured**: the two bounds under both spellings the door honours — `from`
 * and `to`, and the `fromVersion` / `toVersion` the door falls back to when the
 * short name is absent — each read through `readDeclaredQueryNumber`. The same
 * four names the door's multiplicity guard declares; the authoring-door and
 * per-caller refusals read the session.
 */
export const META_ITEM_DIFF_PARAMS: readonly string[] = ['from', 'fromVersion', 'to', 'toVersion'];

/**
 * [#20062 / #20139] The reading of a numeric query parameter on a door whose
 * request has no declared schema: a whole number, and nothing about range.
 * Every such parameter in this file counts or addresses whole things — rows
 * (`GET /data/:object/export` `limit`; `GET /search` `limit` / `perObject`;
 * `GET /approvals/requests` `limit` / `offset`) or history versions
 * (`GET /meta/:type/:name/diff` `from` / `to`). Range stays each door's own
 * business — the export route's `Math.max(1, …)` floor and 50000 cap,
 * `searchAll`'s `[1, 100]` / `[1, 25]` clamps, the approvals service's
 * `[1, 200]` — because no card this closes takes a position on bounds; it only
 * refuses a value the door cannot read as a whole number at all. The same rule
 * `@objectstack/runtime`'s `parseIntegerParam` applies without `bounds`, which
 * this package cannot import (runtime depends on rest).
 */
export const UNDECLARED_WHOLE_NUMBER_PARAM = z.number().int().optional();

/**
 * [#20061 / #20062] Read ONE numeric query parameter against the door's own
 * declared schema for it, and refuse — never substitute — what that schema
 * refuses.
 *
 * The defect this closes is the bare coercion: `Number(q.limit)` does not
 * fail, it INVENTS a value and the door serves it. Measured on four published
 * doors, each answering `200`: `GET /data/import/jobs` turned `?limit=0` into
 * its 50-row default and clamped `?limit=500` to 200 against a declaration of
 * `min(1).max(200)`; `GET /data/:object/export` turned `?limit=abc` into a
 * ONE-row export; `GET /meta/:type/:name/history` dropped it and returned the
 * whole change log; `GET /search` handed `NaN` to `searchAll`, whose overall
 * cap then never triggered.
 *
 * ## How a query string meets a `z.number()` declaration
 *
 * A query string carries no types, so the declared schema cannot parse it
 * directly — and `Number()` alone is the defect. The one coercion made here is
 * the faithful one: a non-blank string whose `Number()` is not `NaN` is parsed
 * AS that number (`'50'` → 50, `'1.5'` → 1.5, `'Infinity'` → Infinity), and
 * everything else — `'abc'`, a blank string, a structured value — is handed to
 * the schema AS IT CAME, so the declaration refuses it by type rather than
 * after `Number()` has already invented a `0` or a `NaN` for it. The schema,
 * not this function, decides what is legal: `int()`, `min()` / `max()` and
 * zod's own refusal of non-finite numbers all apply exactly as declared, and an
 * absent parameter meets the schema's own `.default()` / `.optional()`.
 *
 * ## The empty string — the one per-door judgement
 *
 * `?limit=` is present-but-empty, and what it means is decided from what the
 * door answered for it before, exactly as `parseEnumParam` (runtime
 * `query-param.ts`) decides the same spelling: where the old answer already
 * WAS the absent answer (import jobs' `Number('') || 50`, search's falsy
 * guard), it stays absent (`emptyIsAbsent: true`) so a defensible answer does
 * not become a new `400`; where the old answer was an invented `0` — a
 * one-row export, a zero-event history — refusing it strictly improves on it.
 *
 * ## The refusal
 *
 * THROWN as `validationFailure` (`@objectstack/types`), never written here:
 * every door that calls this sends the throw through `handleRouteError` /
 * `mapDataError`, which answer `400` with the data surface's
 * `VALIDATION_FAILED` + `fields[]` envelope — the same shape the
 * declared-schema body doors in this file answer. A door whose own catch maps
 * something else (`GET /approvals/requests` answers every throw
 * `500 APPROVAL_REQUEST_LIST_FAILED`) catches the read itself and hands it to
 * `handleRouteError`. `fields[].code` comes from `zodIssuesToFields`, so it is
 * the ADR-0114 D3 catalog member for the failed constraint (`invalid_type`,
 * `min_value`, `max_value`), with `field` naming the parameter.
 *
 * Call it AFTER `refuseRepeatedQueryParams` has run for `param`: that gate
 * refuses a repeated occurrence and unwraps a one-element array, so what
 * reaches this function is a single string or nothing.
 *
 * ## The census that keeps the family closed
 *
 * [#20139] `rest-server-query-number-census.test.ts` finds every numeric
 * coercion in this file (`Number(…)`, `parseInt` / `parseFloat`, unary `+`)
 * and fails on any it has not classified: this function's own `Number(raw)`, a
 * value that is not a request query value, or a ledgered exemption with its
 * reason. A new bare `Number(req.query.x)` therefore reddens its PR instead of
 * reopening the family one door at a time.
 */
export function readDeclaredQueryNumber(
    queryParams: Record<string, unknown> | undefined,
    param: string,
    declared: z.ZodType<number | undefined>,
    opts: { readonly emptyIsAbsent: boolean },
): number | undefined {
    const raw = queryParams?.[param];
    let input: unknown = raw;
    if (raw === undefined || raw === null || (raw === '' && opts.emptyIsAbsent)) {
        input = undefined;
    } else if (typeof raw === 'string' && raw.trim() !== '') {
        const coerced = Number(raw);
        if (!Number.isNaN(coerced)) input = coerced;
    }
    const parsed = declared.safeParse(input);
    if (parsed.success) return parsed.data;
    const fields = zodIssuesToFields(
        parsed.error.issues.map((issue) => ({ ...issue, path: [param, ...issue.path] })),
        { [param]: input },
    );
    throw validationFailure(
        `Invalid \`${param}\` query parameter: ${fields[0]?.message ?? 'not a readable number'}`,
        fields,
    );
}

/**
 * [#16674] Which `services.*` slot each `routes.*` key is the address OF.
 *
 * `/discovery` states the same fact twice -- `routes.X` (the flat convenience
 * map) and `services.Y.route` (the per-slot entry) -- and the discovery handler
 * (in `discovery-routes.ts` since #23050 slice 7, which imports this table)
 * rewrites only the first half to the paths this server actually mounts.
 * Measured on this file's own composition harness with
 * `crud: { dataPrefix: '/objects' }`: `routes.data` answered `/api/v1/objects`
 * while `services.data.route` still answered `/api/v1/data`, a path with
 * nothing mounted on it -- one document, one deployment, two different data
 * addresses (AGENTS.md "Route & surface ownership" #4: a machine-readable
 * surface must not lie, and it must not lie to itself either).
 *
 * The mirror this table drives is deliberately a PROJECTION of the finished
 * `routes` map, never a second computation of the same paths -- the producer
 * learned that in #14646 ("two derivations of one fact is how `routes` and
 * `services` drift"), and re-deriving `${realBase}${dataPrefix}` here would
 * re-open the very gap this closes, one key over.
 *
 * Read each pair as *the address of one thing*, never as "these names look
 * alike": `notifications` maps to the `notification` slot because that is the
 * spelling difference the producer's own `serviceToRouteKey` carries, and
 * `storage` names TWO slots because `file-storage` is the deprecated v17 alias
 * the producer mirrors VERBATIM off the canonical row (#9683) -- updating only
 * the canonical one would turn a byte-equal copy into a second opinion.
 *
 * Route keys with no slot behind them are absent on purpose, not by oversight:
 * `packages` (the `package` service is deliberately NOT a `CoreServiceName`
 * slot, so there is no `services.package` entry to mirror onto, #6633),
 * `datasources`, `email`, `mcp` and `discovery` (surfaces this server mounts
 * itself, which the protocol's service map never described), and `approvals`
 * (declared in `ApiRoutesSchema`, emitted by neither producer). `services.search`
 * is the mirror image: a slot that declares a route with no `ApiRoutesSchema`
 * key to follow. `discovery-services-route-follows-mount.test.ts` holds this
 * table complete against the producer, so a newly routed slot fails that pin
 * instead of silently opting out of the mirror.
 */
export const DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS: Readonly<Record<string, readonly string[]>> = {
    data: ['data'],
    metadata: ['metadata'],
    ui: ['ui'],
    auth: ['auth'],
    analytics: ['analytics'],
    automation: ['automation'],
    ai: ['ai'],
    i18n: ['i18n'],
    notifications: ['notification'],
    realtime: ['realtime'],
    storage: ['storage', 'file-storage'],
};

/** Platform object backing async import jobs (see sys-import-job.object.ts). */
export const IMPORT_JOB_OBJECT = 'sys_import_job';
/** Cap on per-row results persisted on the job (failures first). */
const IMPORT_JOB_RESULTS_CAP = 500;
/** Undo (logical rollback) is only recorded for jobs at or under this row
 *  count — larger jobs skip the undo log to bound the stored before-snapshots. */
export const IMPORT_JOB_UNDO_MAX_ROWS = 5_000;

/** Generate a sortable-ish, collision-resistant import job id. */
export function newImportJobId(): string {
    return `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Cap a results list to {@link IMPORT_JOB_RESULTS_CAP}, keeping failures first. */
export function capImportResults(results: Array<{ ok: boolean }>): { items: any[]; truncated: boolean } {
    if (results.length <= IMPORT_JOB_RESULTS_CAP) return { items: results, truncated: false };
    const failures = results.filter(r => !r.ok);
    const successes = results.filter(r => r.ok);
    const items = [...failures, ...successes].slice(0, IMPORT_JOB_RESULTS_CAP);
    return { items, truncated: true };
}

/** Parse the persisted undo log (json column may arrive as object or string). */
export function parseUndoLog(raw: any): { created: string[]; updated: Array<{ id: string; before: Record<string, any> }> } | undefined {
    if (!raw) return undefined;
    let v = raw;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return undefined; } }
    if (!v || typeof v !== 'object') return undefined;
    const created = Array.isArray(v.created) ? v.created.map(String) : [];
    const updated = Array.isArray(v.updated)
        ? v.updated.filter((u: any) => u && u.id != null).map((u: any) => ({ id: String(u.id), before: u.before ?? {} }))
        : [];
    return { created, updated };
}

/** True when a job can still be undone: it wrote data (undo log present with
 *  entries), hasn't already been reverted, and finished in a terminal state. */
export function importJobUndoable(row: any): boolean {
    if (row?.reverted_at) return false;
    const status = String(row?.status ?? '');
    if (status !== 'succeeded' && status !== 'cancelled') return false;
    const log = parseUndoLog(row?.undo_log);
    return !!log && (log.created.length > 0 || log.updated.length > 0);
}

/**
 * The canonical ISO-8601 spelling of a timestamp column read back through the
 * engine's record read door, for a DTO field whose contract declares a string.
 *
 * [#13994] The input domain is what a DRIVER materialises into such a column,
 * and it is dialect-dependent — measured, not guessed:
 *
 *  - **JS `Date`** — `driver-mongodb` stamps `new Date()` and BSON round-trips
 *    it. On `driver-sql` the CLIENT layer still materialises `timestamptz` /
 *    `DATETIME(3)` as a `Date` on purpose — those are instants, and
 *    `SqlDriver.withPostgresCalendarDayAsText` still leaves the parser alone in
 *    as many words ([ADR-0053 D-F2]) — but that is no longer what leaves the
 *    read door. Since #13973 ([ADR-0053 D-F1]) `formatOutput`'s two timestamp
 *    repairs — the `AUDIT_TIMESTAMP_COLUMNS` pass and the
 *    `normalizeSqliteDatetimeOutput` pass over `datetimeFields` — both run on
 *    EVERY dialect, so the driver folds that `Date` at its own read boundary.
 *    ⚠️ Exactly one `Date` shape still arrives here from `driver-sql`: an
 *    INVALID `Date`, which has no canonical text to fold to and is handed
 *    through unchanged by design ([ADR-0053 D-F3], `isoFromValidDate`). That
 *    residue is what keeps this arm live rather than dead — see the #14078
 *    section below, which is the arm that absorbs it.
 *  - **`string`, already canonical ISO-8601 UTC** — `driver-sql` on every
 *    dialect (SQLite and its `driver-turso` / `driver-sqlite-wasm` siblings
 *    have always stored the text; Postgres and MySQL are folded to it at the
 *    read door), and `driver-memory`. Passed through unchanged, so a canonical
 *    row is a fixed point.
 *  - **anything else** a host stamps into the column — rendered as before.
 *
 * Why this is not `String(v)`: on a `Date`, `String` runs
 * `Date.prototype.toString`, which drops milliseconds and bakes in the PROCESS
 * timezone with no `Z` — `"Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard
 * Time)"` where the contract promises `"2026-08-30T10:19:25.947Z"`. That value
 * is not `Date.parse`-safe for a client doing strict ISO parsing, and it moves
 * with the server's zone. SQLite hands back canonical text, so `String()` was
 * an identity there and every development environment stayed green — the same
 * camouflage that made the OCC seam a production bug (#13382).
 *
 * Why not simply DELETE the `String()` and let `JSON.stringify` serialise the
 * bare `Date` through `toJSON()`: that emits the right text but changes the
 * value's static type from `string` to `string | Date`, widening a declared
 * contract that three independent declarations spell as `string` —
 * `ImportJobProgressSchema` / `ImportJobSummarySchema`
 * (`@objectstack/spec`, `z.string()`, "ISO 8601"), the `ImportJobProgress`
 * the client SDK returns, and objectui's `ImportJobProgressInfo`. The
 * declaration is right; the emitted value was wrong. This makes the value what
 * the declaration already says.
 *
 * ## [#14078] The `Date` arm is TOTAL — an Invalid `Date` renders as text
 *
 * Ruled **B** by the maintainer (2026-09-02): every copy of this spelling
 * guards on `Number.isNaN(value.getTime())`, all five arms in ONE change,
 * because a guard on some arms and not others re-opens the drift the single
 * spelling closed. Reachability is MEASURED, not assumed (landed as commit
 * `3ecb7dc1a`): mysql2 3.23.1 returns a module constant literally named
 * `INVALID_DATE` for a zero `DATETIME`, and postgres-date 1.0.7 builds
 * `new Date(NaN)` for every year in 275760..294276 — years Postgres itself
 * stores. Unguarded, `value.toISOString()` raises `RangeError: Invalid time
 * value`, so `GET /api/v1/data/import/jobs/:jobId` answers **500** on a job
 * row the operator cannot identify from the error.
 *
 * The terminal value is chosen **per call site**, and this one's is the
 * VISIBLE TEXT `"Invalid Date"`, reached by letting the Invalid `Date` fall
 * into the `String(value ?? '')` arm — the "rendered as before" branch this
 * docblock already describes, and the spelling the #13994 repair replaced.
 * Why not `undefined`, the answer the `metadata-protocol` / `metadata` copies
 * take: this function returns `string` because its four call sites are the
 * DTO's last step, `ImportJobProgressSchema.createdAt` is required, and all
 * four fields are declared plain `z.string()` (`packages/spec/src/api/
 * export.zod.ts`) rather than `z.string().datetime()` — so the text passes the
 * contract and reaches the operator watching the import job, which is the
 * ruling's "required and an operator reads it". ⛔ And NOT a blanket `''`: a
 * silent blank is the shape that hides the producer's bug.
 *
 * Same three branches as the two landed normalisers in
 * `@objectstack/metadata-protocol` — `auditMetaItem`'s `occurredAt` in
 * `protocol.ts` and `canonicalIsoInstant` in `sys-metadata-repository.ts`
 * (#13997) — ONE spelling repo-wide for this repair, deliberately not a new
 * variant. The only difference from `canonicalIsoInstant` is its nullish arm,
 * and that difference is forced by the call sites: it returns `undefined` so
 * each caller's own `?? <default>` chain keeps its meaning, whereas the four
 * sites here are the DTO's last step and the required `createdAt` field's
 * absent-value spelling — `''` — is folded in, exactly as the `String(row?.
 * created_at ?? '')` it replaces produced.
 */
function canonicalIsoStamp(value: unknown): string {
    if (typeof value === 'string') return value;
    // [#14078] The `Date` arm is TOTAL: an Invalid `Date` fails the guard and
    // falls into the "rendered as before" arm below, which is `String(value)`
    // — exactly the visible text `"Invalid Date"` this repair's predecessor
    // served. See the docblock's Invalid-`Date` paragraph for why the text and
    // not `undefined` here.
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    return String(value ?? '');
}

/** Map a persisted `sys_import_job` row to the ImportJobProgress DTO. */
export function importJobToProgress(row: any): Record<string, any> {
    const total = Number(row?.total_rows ?? 0);
    const processed = Number(row?.processed_rows ?? 0);
    return {
        undoable: importJobUndoable(row),
        ...(row?.reverted_at ? { revertedAt: canonicalIsoStamp(row.reverted_at) } : {}),
        jobId: String(row?.id ?? ''),
        object: String(row?.object_name ?? ''),
        status: String(row?.status ?? 'pending'),
        dryRun: !!row?.dry_run,
        writeMode: String(row?.write_mode ?? 'insert'),
        total,
        processed,
        created: Number(row?.created_count ?? 0),
        updated: Number(row?.updated_count ?? 0),
        skipped: Number(row?.skipped_count ?? 0),
        errors: Number(row?.error_count ?? 0),
        percentComplete: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : (processed > 0 ? 100 : 0),
        ...(row?.error ? { error: String(row.error) } : {}),
        ...(row?.started_at ? { startedAt: canonicalIsoStamp(row.started_at) } : {}),
        ...(row?.completed_at ? { completedAt: canonicalIsoStamp(row.completed_at) } : {}),
        createdAt: canonicalIsoStamp(row?.created_at),
    };
}

/** Map a persisted `sys_import_job` row to the ImportJobSummary DTO (list). */
export function importJobToSummary(row: any): Record<string, any> {
    const p = importJobToProgress(row);
    return {
        jobId: p.jobId, object: p.object, status: p.status,
        total: p.total, processed: p.processed,
        created: p.created, updated: p.updated, skipped: p.skipped, errors: p.errors,
        createdAt: p.createdAt,
        undoable: p.undoable,
        ...(p.completedAt ? { completedAt: p.completedAt } : {}),
        ...(p.revertedAt ? { revertedAt: p.revertedAt } : {}),
    };
}

/**
 * Escape a single value into an RFC-4180 CSV cell. Values containing
 * commas, quotes, CR, or LF are wrapped in double-quotes with embedded
 * quotes doubled. `null` / `undefined` become an empty cell. Objects and
 * arrays are serialised as compact JSON so nested data round-trips
 * without flattening surprises.
 *
 * [#25078] `textCell` says whether the column is a TEXT column under the CSV
 * text-cell rule (`isCsvTextColumn`, `./export-format.ts`, decided by the
 * field's declared type). A string value in a text column is written through
 * `markCsvTextCell` BEFORE the quoting below; every other value — a number,
 * a boolean, a `Date`, serialised JSON, or a string in a numeric, boolean,
 * date or datetime column — is written exactly as before.
 */
function formatCsvCell(value: any, textCell: boolean): string {
    if (value === null || value === undefined) return '';
    let s: string;
    if (typeof value === 'string') s = textCell ? markCsvTextCell(value) : value;
    else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') s = String(value);
    // [#14078] Total `Date` arm. An Invalid `Date` renders as `String(value)`,
    // which is exactly the visible text `Invalid Date` — the cell an operator
    // reads and can report. ⛔ Not the `JSON.stringify` arm below: `toJSON()`
    // answers `null` for an Invalid `Date`, so the bad row would arrive as the
    // silent blank the ruling forbids. Both CSV paths land here: the formatted
    // path's `formatDate` returns the value UNCHANGED when `toDate` rejects it
    // (`export-format.ts`), so this arm is the terminal for the raw path and
    // the field-metadata path alike.
    else if (value instanceof Date) s = Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
    else { try { s = JSON.stringify(value); } catch { s = String(value); } }
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/**
 * Serialise a list of rows to RFC-4180 CSV text. Caller supplies the ordered
 * list of field names and a (possibly empty) field-metadata map. With metadata,
 * the header row uses field labels and cell values are formatted to readable
 * display values (lookup names, select labels, yes / no words, formatted
 * dates). With an empty map the cells carry the raw, un-formatted values.
 *
 * [#25078] On both paths every header label and every string cell of a text
 * column passes through the CSV text-cell rule (`markCsvTextCell`,
 * `./export-format.ts`), which `parseCsvToRows` reverses on import. On the raw
 * path every column is a text column; with metadata, a column declared
 * numeric, boolean, date or datetime is not (`isCsvTextColumn`).
 *
 * `timezone` (#8373) is the caller's business timezone, used to render
 * `datetime` cells in the same clock the UI shows; absent, they render in UTC.
 * `booleanWords` (#24945) are the words of the caller's language that a boolean
 * cell is written as (`ExportBooleanWords` in `./export-format.ts`).
 */
export function rowsToCsv(
    fields: string[],
    rows: Array<Record<string, any>>,
    includeHeader: boolean,
    metaMap: Map<string, ExportFieldMeta>,
    timezone?: string,
    booleanWords?: ExportBooleanWords,
): string {
    const lines: string[] = [];
    const textColumns = fields.map((f) => isCsvTextColumn(metaMap.get(f)));
    if (includeHeader) lines.push(fields.map(f => formatCsvCell(headerLabel(f, metaMap), true)).join(','));
    for (const row of rows) {
        lines.push(
            formatRowCells(row, fields, metaMap, timezone, booleanWords)
                .map((cell, i) => formatCsvCell(cell, textColumns[i]))
                .join(','),
        );
    }
    return lines.join('\r\n') + (lines.length > 0 ? '\r\n' : '');
}

/**
 * Bridge exceljs' streaming workbook writer onto the chunked HTTP response.
 *
 * exceljs writes to a Node stream; we pipe a PassThrough's `data` events into
 * `res.write` (which the hono server encodes — strings via TextEncoder, binary
 * Buffers/Uint8Arrays enqueued verbatim) so the xlsx bytes stream straight to
 * the client without buffering the whole workbook in memory. `useStyles:false`
 * keeps the writer lean for large (20k+ row) exports.
 *
 * Returns the worksheet to append rows to and a `finalize()` that commits the
 * workbook and resolves once the last byte has been flushed and the response
 * ended. Dynamically imported so `node:stream` / `exceljs` stay out of the
 * module's static graph.
 */
export async function createXlsxStream(res: any, useStyles = false): Promise<{
    ws: Worksheet;
    finalize: () => Promise<void>;
}> {
    const { PassThrough } = await import('node:stream');
    const ExcelJS = await loadExcelJs();

    const passthrough = new PassThrough();
    const done = new Promise<void>((resolve, reject) => {
        passthrough.on('data', (chunk: Buffer) => { res.write(chunk); });
        passthrough.on('end', () => { try { res.end(); } catch { /* swallow */ } resolve(); });
        passthrough.on('error', reject);
    });

    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: passthrough, useStyles });
    const ws = wb.addWorksheet('Export');

    return {
        ws,
        finalize: async () => {
            await ws.commit();
            await wb.commit();
            await done;
        },
    };
}

/**
 * Structural subset of `KernelManager` that RestServer needs in order to
 * resolve a per-project protocol at request time. Typed locally to avoid
 * an @objectstack/runtime → @objectstack/rest → @objectstack/runtime
 * package cycle.
 */
export interface RestKernelManager {
    getOrCreate(environmentId: string): Promise<{
        getServiceAsync<T = unknown>(name: string): Promise<T>;
    }>;
}

/**
 * Normalized REST Server Configuration
 * All nested properties are required after normalization
 */
type NormalizedRestServerConfig = {
    api: {
        version: string;
        basePath: string;
        apiPath: string | undefined;
        enableCrud: boolean;
        enableMetadata: boolean;
        enableUi: boolean;
        enableBatch: boolean;
        enableDiscovery: boolean;
        enableOpenApi: boolean;
        enableSearch: boolean;
        enableProjectScoping: boolean;
        projectResolution: 'required' | 'optional' | 'auto';
        // [commit 53cbad9f7] The PARSED shape, not the authored one: this block is
        // built from `RestApiConfigSchema`'s output, so a `documentation` the
        // caller wrote arrives with its OWN declared inner defaults applied
        // (`.title`). [#20295] `documentation.enabled` and the whole
        // `responseFormat` block are `retiredKey()` tombstones now — the parse
        // REFUSES them at construction, so neither is carried here and
        // neither is re-defaulted.
        documentation: RestApiConfigParsed['documentation'];
    };
    crud: {
        operations: {
            create: boolean;
            read: boolean;
            update: boolean;
            delete: boolean;
            list: boolean;
        };
        dataPrefix: string;
    };
    metadata: {
        prefix: string;
        enableCache: boolean;
        /**
         * [ADR-0106 D8] Per-caller FLS masking of served object schemas.
         * Default **on**; `false` opts a deployment out of the metadata-plane
         * mask entirely (the data plane is unaffected either way).
         */
        maskObjectFields: boolean;
        /**
         * [#15542 / #15854] One switch per FACE, each gating exactly what its
         * name states — `types` the type list, `items` the per-type list,
         * `item` the whole per-item face (reads, `PUT`, `DELETE` and the
         * history family), `maintenance` the whole-store operations
         * (`/diagnostics`, `/_drafts`, `POST /_migrate-stored`). The radius of
         * each is pinned route by route in
         * `rest-config-mount-table.pin.test.ts`.
         */
        endpoints: {
            types: boolean;
            items: boolean;
            item: boolean;
            maintenance: boolean;
        };
    };
    batch: {
        maxBatchSize: number;
        enableBatchEndpoint: boolean;
        operations: {
            createMany: boolean;
            updateMany: boolean;
            deleteMany: boolean;
        };
    };
    /**
     * [commit b3a63d32c] Every key of `RouteGenerationConfigSchema` is a `retiredKey()`
     * tombstone (ADR-0049 enforce-or-remove — nothing here ever read
     * `includeObjects` / `excludeObjects` / `nameTransform` / `overrides`; the
     * liveness census recorded in commit a3d5724c8). The sub-object is still PARSED, so an authored key is
     * refused at construction with its prescription rather than stripped, but
     * nothing is threaded: per-object exposure is the object's own
     * `enable.apiEnabled` / `enable.apiMethods`, enforced by `enforceApiAccess`.
     */
    routes: Record<string, never>;
};

/**
 * The DECLARED contract of each `RestServerConfig` sub-object this seam parses,
 * keyed by the sub-object's name — the table `normalizeConfig` runs before it
 * builds anything (#11637 for `api`, #11984 for the four siblings).
 *
 * `api` is the one entry with a subtraction: its retired `requireAuth`
 * tombstone is `.omit()`ed because this seam does not own that key's posture
 * (see {@link RestServer.parseDeclaredApiConfig}). The four siblings carry no
 * tombstone of their own and are taken whole. ⛔ `RestServerConfigSchema` — the
 * whole-config schema — is deliberately NOT in this table: its `openApi31`
 * tombstone (#4579) is a `retiredKey()` whose parse REFUSES the key, while
 * #3963 chose warn-and-ignore for a retired REST config key. Parsing per
 * sub-object leaves that tombstone unexecuted, which keeps the posture a
 * maintainer would have to flip on purpose.
 *
 * Built on first use, not at module load: every schema here is a `lazySchema`
 * Proxy whose whole point is deferring allocation until someone parses, and
 * calling `.omit()` at module top level would resolve `RestApiConfigSchema` on
 * every import of this file. Cached because `.omit()` allocates a fresh schema
 * and a `RestServer` is constructed per boot (and per test).
 */
function buildDeclaredSubConfigSchemas() {
    return {
        api: RestApiConfigSchema.omit({ requireAuth: true }),
        crud: CrudEndpointsConfigSchema,
        metadata: MetadataEndpointsConfigSchema,
        batch: BatchEndpointsConfigSchema,
        routes: RouteGenerationConfigSchema,
    };
}
type DeclaredSubConfigSchemas = ReturnType<typeof buildDeclaredSubConfigSchemas>;
type DeclaredSubConfigName = keyof DeclaredSubConfigSchemas;
/**
 * [commit 53cbad9f7] The parsed `api` sub-object, which `normalizeConfig` now BUILDS
 * FROM. Taken off the table's own entry rather than off `RestApiConfigParsed`,
 * so it is the post-`.omit()` shape: the retired `requireAuth` tombstone is
 * absent here exactly as it is absent from the schema this seam runs.
 */
type DeclaredApiConfigParsed = z.output<DeclaredSubConfigSchemas['api']>;
let declaredSubConfigSchemasCache: DeclaredSubConfigSchemas | undefined;
function declaredSubConfigSchemas(): DeclaredSubConfigSchemas {
    return (declaredSubConfigSchemasCache ??= buildDeclaredSubConfigSchemas());
}

/**
 * The exported name of each declared schema, for the refusal text: the
 * prescription is the payload, and an operator reading a boot failure must be
 * able to find the rule that refused them without reading our source.
 */
const DECLARED_SUB_CONFIG_SCHEMA_NAMES: Record<DeclaredSubConfigName, string> = {
    api: 'RestApiConfigSchema',
    crud: 'CrudEndpointsConfigSchema',
    metadata: 'MetadataEndpointsConfigSchema',
    batch: 'BatchEndpointsConfigSchema',
    routes: 'RouteGenerationConfigSchema',
};

/**
 * Run one sub-object's DECLARED contract and return the parsed output —
 * defaults applied, unknown keys stripped (every schema in the table is a
 * non-strict `z.object()`). Throws on a value the schema rejects, naming the
 * sub-object and every failing key with zod's own issue text. This is a
 * construction-time refusal, not an HTTP envelope: nothing has been mounted
 * yet, and the operator reading the boot log is the audience.
 *
 * An absent sub-object parses as `{}` — exactly what the `?? {}` in front of
 * the old casts read — so the schema's defaults fill it.
 *
 * `rationale` lets a caller append a paragraph the issues justify (the
 * `api.version` mount rationale) and ONLY then: appending it unconditionally
 * was measured to send an operator to a line of their config they never wrote.
 */
function parseDeclaredSubConfig<T extends z.ZodType>(
    name: DeclaredSubConfigName,
    schema: T,
    value: unknown,
    rationale?: (issues: ReadonlyArray<z.core.$ZodIssue>) => string,
): z.output<T> {
    const result = schema.safeParse(value ?? {});
    if (result.success) return result.data;

    const details = result.error.issues
        .map((issue) => `  - ${name}.${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
    throw new Error(
        `REST API configuration is invalid: \`${name}\` does not satisfy `
        + `\`${DECLARED_SUB_CONFIG_SCHEMA_NAMES[name]}\` (@objectstack/spec/api), the schema that declares it.\n`
        + details
        + (rationale?.(result.error.issues) ?? ''),
    );
}

/**
 * Minimal env registry shape consumed by the REST server for hostname →
 * environmentId resolution and `X-Environment-Id` header validation on unscoped
 * routes. Mirrors the surface of `EnvironmentDriverRegistry` defined in
 * `@objectstack/service-cloud`.
 */
export interface RestEnvRegistry {
    resolveByHostname(hostname: string): Promise<{ environmentId: string } | null | undefined>;
    /**
     * Look up a project by id. Returns a truthy value (typically an
     * `IDataDriver`) when the project exists and is bound, `null` when
     * unknown. The REST server only uses the truthiness; it does not
     * touch the driver itself (the actual driver is loaded later via
     * `KernelManager.getOrCreate(environmentId)`).
     */
    resolveById?(environmentId: string): Promise<unknown | null>;
}

/**
 * Request → environment resolution seam (ADR-0076 D11 step ④, #2462).
 *
 * When the host registers a `kernel-resolver` service (the ADR-0006 seam the
 * HTTP dispatcher already consumes), `RestApiPlugin` wraps it in this shape so
 * the REST server resolves a request's environment through the SAME strategy
 * as the dispatcher — one answer per host for "which environment does this
 * request belong to" — instead of the REST server's own parallel
 * hostname/header chain.
 *
 * Contract: a normal return is FINAL — `undefined` means the resolver decided
 * the request is unscoped (e.g. a control-plane route), and the legacy
 * built-in chain must NOT second-guess it. Only a thrown error falls back to
 * the legacy chain, so a misbehaving resolver degrades to pre-seam behavior
 * instead of taking down REST routing.
 *
 * **Cost.** Answering this question must not acquire a kernel. `RestApiPlugin`
 * builds the adapter over the host's `kernel-resolver` and prefers its
 * environment-only member (`KernelResolver.resolveEnvironment`, ADR-0006) for
 * exactly that reason: asking the kernel-ACQUISITION method for an id bought a
 * kernel and discarded it, and on a cold or wedged environment that discard is
 * a full waiter window — after which {@link RestServer.resolveProtocol} opens
 * a second one to acquire the kernel for real. Measured on a live host with a
 * 20s `waiterTimeoutMs`: 42s to a 503 on REST-owned routes against 21s on
 * dispatcher-owned ones. A host that implements only `resolveKernel` still
 * works, and still pays twice.
 */
export interface RestRequestEnvResolver {
    resolveRequestEnvironmentId(req: unknown): Promise<string | undefined>;
}

/**
 * One route this server knows is mounted, and how it got there (#5822).
 *
 * `RouteEntry` plus `source`: `route-manager` for the routes this server
 * registered itself, `direct-mount` for the ones a bypassing registrar mounted
 * on the same host server and reported through
 * {@link RestServer.recordDirectMountedRoutes}. Both are equally mounted and
 * equally documented; the column exists because the route ledger audits them
 * per source, and because a debugging reader deserves to know which registrar
 * to look in.
 */
export interface MountedRoute extends RouteEntry {
    readonly source: MountedRouteSource;
}

/**
 * Reach a HOST-WIRED provider seam so that a SYNCHRONOUS throw and a REJECTED
 * promise reach the SAME answer.
 *
 * ## Why this exists
 *
 * `provider(environmentId).catch(() => undefined)` attaches its handler to the
 * promise the call RETURNS, so the handler can only ever see a *rejection*. A
 * provider that throws BEFORE returning a promise — an ordinary non-`async`
 * function, which the seam's own type (`(environmentId?: string) =>
 * Promise<T>`) does not and cannot prevent a host from wiring — throws while
 * the expression is still being evaluated, so there is no promise to attach to
 * and the `.catch` is never reached. The throw escapes to
 * {@link RestServer.computeExecCtx}'s outer `catch`, which discards the ENTIRE
 * execution context, identity included.
 *
 * Measured at one and the same seam (`settingsServiceProvider`), on a real
 * `RestServer` with a real `registerPackageRoutes`, both callers holding a
 * valid session and identical grants — the fault differing ONLY in how the
 * provider fails:
 *
 * | `settingsServiceProvider` | `GET /api/v1/packages` (before) |
 * |:--|:--|
 * | `async () =>` throws (a rejecting promise) | **200** — caller keeps `manage_metadata` + `studio.access` |
 * | `() =>` throws (synchronous)               | **401 UNAUTHENTICATED** |
 *
 * ⇒ the wire answer was decided by whether the host happened to declare its
 * provider `async`. That is the defect: not which of the two answers is right,
 * but that one fault had two.
 *
 * ## What this normalisation does and does NOT decide
 *
 * It makes the SYNCHRONOUS path agree with the path the `.catch` already
 * defines — absorb, resolve `undefined`, let the caller degrade. It does NOT
 * touch `computeExecCtx`'s outer `catch`, and it does not re-decide whether a
 * post-identity fault SHOULD discard identity; that is a behaviour change on a
 * public door and is deliberately left unruled here.
 *
 * ⚠️ Absorbing here cannot weaken the loud path commit 6a180e42d built, but the reason is
 * no longer "one construction site" — [#13476] added a SECOND one, at the
 * data-engine seam below ({@link wiredEngineOrLoud}). The invariant that
 * matters is narrower and is what this helper actually needs: no branded
 * outage is ever CONSTRUCTED INSIDE a `seamOrUndefined` call, and none is in
 * flight through one. `tryFind`'s (`@objectstack/core`'s
 * `resolve-authz-context.ts`) is reached from `resolveAuthzContext`, which
 * this helper never wraps; `wiredEngineOrLoud`'s is raised by a DIFFERENT
 * helper, deliberately, precisely because this one would swallow it.
 * ⛔ Do not route the data-engine seam back through this helper to "make the
 * seams uniform" — uniformity there IS the defect #13476 repaired.
 *
 * ⚠️ `call` is invoked SYNCHRONOUSLY (an async function body runs to its first
 * `await` synchronously), so this changes when a provider *fails*, never when
 * it is *called* — deliberately not `Promise.resolve().then(call)`, which
 * would defer every provider by a microtask for no gain.
 *
 * ⛔ Not for the seams that carry NO `.catch` at all — `kernelManager
 * .getOrCreate()` and `authService.getApi()` lose the context in BOTH
 * directions, so they are already symmetric and giving them a swallow would be
 * a new policy rather than a normalisation.
 */
export async function seamOrUndefined<T>(call: () => T | PromiseLike<T>): Promise<T | undefined> {
    try {
        return await call();
    } catch {
        return undefined;
    }
}

/**
 * Reach the DATA-ENGINE seam keeping "no engine is wired" and "the engine
 * could not be resolved" two facts instead of one value.
 *
 * ## The defect this exists to end [#13476]
 *
 * The engine used to be resolved through {@link seamOrUndefined}, so a seam
 * that FAILED and a seam that was never WIRED both handed `resolveAuthzContext`
 * the same `undefined`. The resolver then took `tryFind`'s `!ql` guard —
 * correctly, for its own contract, because "no engine is wired" is a supported
 * embedder shape that must keep resolving to an empty-but-valid envelope — and
 * the package door answered **403 FORBIDDEN**: "Reading packages requires the
 * `studio.access` or `setup.access` capability." Measured on a real
 * `RestServer` with a real `registerPackageRoutes`, that answer was identical
 * to the one an embedder with no data plane gets, and one of the two is a lie:
 *
 * | wiring | before | after |
 * |:--|:--|:--|
 * | healthy engine granting the capabilities | 200 | 200 |
 * | no engine wired at all (supported shape) | 403 | 403 — unchanged |
 * | the engine cannot be RESOLVED            | **403** | **503** |
 *
 * ⭐ This is COVERAGE of the already-ruled class commit 6a180e42d landed, not a new trade-off.
 * That ruling (2026-08-30, verbatim 「第一批其余同意」) settled the DIRECTION — a
 * permission-store read that fails must fail LOUD rather than resolve as an
 * authenticated principal holding zero capabilities. `tryFind` implemented it
 * for a read that was ISSUED and threw. An engine that cannot be resolved never
 * issues a read at all, so the ruling's landing point could not see it, and it
 * was the LAST surviving member of that disguise on this door. The answer is
 * the same one the ruling chose, for the same reason: nothing was read, so no
 * capability judgement was ever reached.
 *
 * ⚠️ The direction is CONSERVATIVE in both readings — the unknown was already
 * answered as a REFUSAL (403) and is now answered as the outage it is (503).
 * Nothing that was refused becomes served; this repair moves no route from
 * refused to allowed.
 *
 * ## What decides WHICH fact this is
 *
 * The caller passes the wiring fact SEPARATELY, as `wired`, instead of leaving
 * it to be inferred from the resolved value — inferring it from the value is
 * the collapse itself. A seam that is not wired is never called; a seam that IS
 * wired and then fails is the outage.
 *
 * ⛔ A provider that RESOLVES `undefined` still means "no engine", quietly and
 * unchanged: that is the seam contract (`(environmentId?) => Promise<engine |
 * undefined>`) declaring absence, not failing. Only a THROW or a REJECTION is
 * the outage — which is why this helper, like {@link seamOrUndefined}, invokes
 * `call` synchronously so a non-`async` provider that throws before returning a
 * promise reaches the same answer as one that rejects (commit add6a1b1c).
 *
 * ⚠️ RESIDUE, deliberately not repaired here and filed separately — do not
 * read this helper as covering it. The KERNEL branch of the seam resolves
 * through `kernel.getServiceAsync('objectql')`, which rejects with a bare
 * `Error` BOTH when the service was never registered (the supported no-data-
 * plane shape) and when it was registered and failed to construct. Those two
 * facts are not distinguishable at this transport, so making that branch loud
 * would refuse service to a correctly-configured embedder. Separating them
 * needs the SERVICE REGISTRY to stop conflating them, which is a
 * `@objectstack/core` contract change and its own card.
 */
export async function wiredEngineOrLoud<T>(
    wired: boolean,
    call: () => T | PromiseLike<T>,
): Promise<T | undefined> {
    if (!wired) return undefined;
    try {
        return await call();
    } catch (err) {
        // The engine is the store the grants live in. It was wired, it was
        // asked, and it did not answer — so the permissions were never
        // determined. `cause` keeps the driver's own diagnostic, which is the
        // part an operator actually needs.
        throw new AuthzStoreUnavailableError('objectql', err);
    }
}

// [#15685] `notImplementedRefusalAnswer`, the `/meta/:type/:name/references` door's re-dresser of
// a protocol-raised, declared `501 NOT_IMPLEMENTED` refusal into the nested envelope that door
// publishes, moved with its one caller to `meta-item-read-routes.ts` (#23050 slice 13b). Its
// docblock moved with it: the defect it closes and its three conditions are there.

/**
 * [#18066] THE one absence answer `GET /meta/:type/:name` gives — a single
 * emitter, so the several conditions that mean "you get nothing" cannot answer
 * several different bodies.
 *
 * ⭐ Byte-identity is the POINT here, not tidiness. #8013 partitioned this
 * route's refusals deliberately: an app that EXISTS and whose
 * `requiredPermissions` the caller lacks reports `403 PERMISSION_DENIED`,
 * while an unpublished app (ADR-0045 §3, "externally unobservable"), an app
 * gated by an absent optional service (ADR-0057 D10) and a name with nothing
 * behind it must be INDISTINGUISHABLE — extending the denial to them "would
 * make every app name on the platform enumerable", which is the unruled change
 * that card fenced off. Two hand-built bodies for two of those three arms is
 * that fence held by coincidence; one emitter makes it structural.
 *
 * The condition this closes was the LOUDEST of the three and the one that got
 * away. The uncached arm reached its 404 only from INSIDE `if (isAppType &&
 * visible)`, where `visible` is the document — so for a name that resolves to
 * nothing the gate was skipped whole and the envelope fell through to
 * `res.json`, answering `200` with the declared envelope MINUS its `item`
 * member. Two in-repo declarations already said otherwise, and this restores
 * what they declare rather than deciding anything new:
 *
 *  - `GetMetaItemResponseSchema` (the route's own `responseSchema`, see
 *    `rest-route-ledger.ts`) makes `item` a required member. Measured on this
 *    tree with the body a real server sent: `safeParse({ type: 'app', name:
 *    'no_such_app_xyz', lock: 'none', editable: true, deletable: true,
 *    resettable: false })` fails `invalid_type` / `expected: 'nonoptional'` at
 *    `item`. ⚠️ The producer's in-process return passes that same parse —
 *    `item` is PRESENT holding `undefined`, and `z.unknown()` admits that — so
 *    the contract broke at `JSON.stringify`, which drops the member. A probe
 *    written against the object rather than the wire bytes sees nothing wrong.
 *  - The CACHED arm of this same route already answers this condition `404
 *    RESOURCE_NOT_FOUND`: `getMetaItemCached` throws
 *    `metadataItemNotFoundError` on a falsy `item`. `app`, `dashboard`, `doc`,
 *    `book`, `?state=draft`, `?preview=draft`, `?package=` and every
 *    `enableCache: false` deployment are diverted around it, so which arm a
 *    request took decided whether absence was an error — the #5563 defect
 *    class, one member over.
 *
 * ⛔ Not `sendEnvelopeError`, which the 403 beside it uses: that builder adds
 * `success: false`, and an absence answer that carries a key the unpublished
 * app's answer does not is the enumeration signal all over again. The nested
 * `error.code` accessor is the same one objectui#4252 reads on both.
 */
export function sendMetaItemAbsent(res: any): void {
    res.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Metadata item not found or access denied.' },
    });
}

/**
 * [#23492] What a `/data` write door does with the optimistic-concurrency
 * token it read — the body's `expectedVersion` (`PATCH`) or `?expectedVersion`
 * (`DELETE`), else `If-Match` — before the protocol is asked. One of three:
 *
 *  - ABSENT: the spelling consulted is `undefined` or `null`. The body key or
 *    the query name falls through to `If-Match`, and no `If-Match` either is
 *    the legal unguarded write.
 *  - JUDGED: a string with something in it. The door forwards it, and the
 *    protocol compares it (`409 CONCURRENT_UPDATE` on a mismatch; the
 *    quoted-empty tag `""` is the protocol's own `400`,
 *    `MalformedVersionTokenError`).
 *  - REFUSED `400 VALIDATION_FAILED`: anything else the caller put in a token
 *    position — an empty or blank string, a number, a boolean, an array, an
 *    object. It can never carry a version, so it is the protocol's ruled
 *    answer to `""` (maintainer decision #20 ①: a token shape that can never
 *    carry a version is refused, neither read as "no token" nor answered
 *    `409`), given here because the protocol never sees these: it reads a
 *    blank string as no token.
 *
 * [#23517] A number is in the refused set, no longer judged as its string.
 * `UpdateDataRequestSchema.expectedVersion` declares a string, and the door
 * forwarded `String(5)`, so the request gate below only ever parsed the
 * coerced copy and a token the contract never admits was answered `409` as if
 * it were a stale version. Only a body token can be a number: `If-Match` and
 * `?expectedVersion` are strings by transport, so the `DELETE` and every
 * header token are unaffected.
 *
 * What it replaces is a truthiness test. The door forwarded a token only when
 * it was truthy, and `bodyVersion ?? If-Match` reads `If-Match` only when the
 * body key is nullish, so `expectedVersion: ''` or `false` — not nullish, not
 * truthy — hid a stale `If-Match`, and the write ran unguarded with a `200`.
 * `?expectedVersion=` did the same to a `DELETE`, and an empty `If-Match`
 * alone, the caller asking for a guard and sending nothing to judge, ran
 * unguarded too.
 *
 * Returns the refusal's sentence, or `undefined` when the token is absent or
 * judged. Both doors build the refusal with the one constructor,
 * `validationFailure(sentence, [])` (`@objectstack/types`), and render it with
 * their own classifier: this file THROWS it into the route's catch
 * (`mapDataError`, the envelope the protocol's `""` refusal gets here), and the
 * dispatcher hands it to `deps.errorFromThrown` and RETURNS the answer (a throw
 * out of `dispatch()` reaches a `createHonoApp` host's catch-all, which reads
 * only `statusCode` and would answer `500`). The runtime dispatcher's `/data`
 * domain carries this function statement for statement (`versionTokenRefusal`
 * in `packages/runtime/src/domains/data.ts`), so the two doors answer every
 * token alike; `data-update-expected-version.test.ts` and
 * `data-delete-expected-version.test.ts` hold them to it.
 */
export function versionTokenRefusal(token: unknown, spelling: string): string | undefined {
    if (token === undefined || token === null) return undefined;
    if (typeof token === 'string' && token.trim() !== '') return undefined;
    const shape = typeof token === 'string' ? 'empty'
        : Array.isArray(token) ? 'an array'
        : typeof token === 'object' ? 'an object'
        : `the ${typeof token} \`${String(token)}\``;
    return `${spelling} is ${shape}, which can never carry a version, so it is refused rather than read as `
        + 'no token. Send the version you read as a string (the record\'s `updated_at`), or omit both '
        + 'expectedVersion and If-Match to perform an unguarded write.';
}

/**
 * [#20338] May this caller read PENDING metadata — a `sys_metadata` row in
 * `state: 'draft'`, unpublished authoring work? THE question every door that
 * asks the protocol for draft content asks first.
 *
 * ONE predicate, never a second rule: `isObjectSchemaMaskExempt`, the check
 * `GET /meta/_drafts` has asked since #6599 — a system caller, or any holder of
 * `studio.access`, `setup.access` or `manage_metadata`. Three texts declared
 * this gate before any door but `_drafts` enforced it: the maintainer ruling
 * recorded in commit 2a29caa's changeset, whose card no longer resolves
 * (「declaration ≠ authorization … draft access stays admin-gated upstream」),
 * ADR-0106 D4 (「draft/preview reads are admin-gated upstream already」) and
 * ADR-0037's Risks row (「confirm/add a builder/admin role gate on the
 * dispatcher reads」).
 *
 * What a door answers a caller this does not admit: NOT a refusal. It answers
 * what it answers without the draft switch — the published version, pruned for
 * that caller as the plain read prunes it, and for a name with nothing
 * published that door's own absence — so the answer is byte-identical to a read
 * that never named the switch and says nothing about whether a draft exists.
 * `?preview=draft` already degrades to the published value when there is no
 * draft; a caller who may not see drafts is answered the same way.
 * `/meta/_drafts` alone refuses (403): it lists drafts and nothing else, so it
 * has no published answer to fall back to.
 *
 * Builders are untouched: whoever this admits reads exactly what they read
 * before (whole for an author on `?state=draft`, #20290; pruned per caller
 * otherwise). The runtime dispatcher's `/meta` domain asks the same predicate
 * through its own copy of this delegation. Every draft switch in this file is
 * ledgered in `meta-draft-read-door-census.test.ts`, which also holds this
 * function to a bare delegation.
 */
export function mayReadPendingDrafts(caller: unknown): boolean {
    return isObjectSchemaMaskExempt(caller);
}

/**
 * Was this execution context's credential validated by a DIFFERENT
 * environment's auth service than the environment the request resolved to?
 * The comparison `enforceAuth` makes on every route behind it.
 *
 * Both sides are stamped by `RestServer.computeExecCtx`: `__environmentId`
 * (the resolved environment) and `__authEnvironmentId` (the environment whose
 * auth service accepted the caller). `undefined` and `'platform'` are not
 * environments — a control-plane request has nothing to own — and a context
 * without the `__environmentId` key was not produced by that method, so
 * neither is judged.
 */
function credentialAnchoredElsewhere(context: unknown): boolean {
    if (!context || typeof context !== 'object' || !('__environmentId' in context)) return false;
    const { __environmentId: resolved, __authEnvironmentId: anchored } = context as {
        __environmentId?: unknown;
        __authEnvironmentId?: unknown;
    };
    if (resolved === undefined || resolved === 'platform') return false;
    return anchored !== resolved;
}

/**
 * [#22128] The ONE reading of `?package=` on the `/meta/:type/:name` item doors
 * — the read (`GET`), the save (`PUT`) and the publish
 * (`POST …/publish`): the package the request names, or `undefined` when it
 * names none. `all` is the metadata list's "show everything" scope and the
 * empty value states nothing, so both name no package: the save writes the
 * env-local overlay (its draft inheriting the package of the item's active
 * row, #11087) and the publish keeps its historical match-any-package draft
 * resolution. A non-string value is not forwarded either.
 *
 * One function because the read's `version` is the token the save at the same
 * address compares against: a read that forwarded the literal `all` resolved
 * that token at a package no save writes, so it served `null` beside a row the
 * save then judged, and a client that pinned `If-None-Match: *` on that `null`
 * was refused. ⛔ Never a third inline copy at a door: the save and publish
 * doors each carried one, and the read door had none.
 *
 * [#22188] …and on every other `/meta` door that reads `?package=`: the
 * layered read, the list, the book tree and the diagnostics sweep, which each
 * forwarded `all` to the store as a package id no item is bound to (the
 * layered read answered `404`, the list `[]`). Without `?package=`, the list
 * already spans every package and the env-local overlay, so "no package" is
 * the list's "show everything". Exported from the package entry, and the
 * runtime dispatcher's `/meta` domain reads `?package=` through it on its own
 * copies of these doors, so the two transports cannot read `all` differently.
 * The item read's cache bypass (`packageScoped`) is not a second reading: it
 * asks whether the raw parameter is present to pick the uncached arm, and that
 * arm asks this function.
 */
export function metaItemPackageBinding(raw: unknown): string | undefined {
    return typeof raw === 'string' && raw !== '' && raw !== 'all' ? raw : undefined;
}

/**
 * [#23546] The capabilities that admit a caller to the AUTHORING TRAIL —
 * `GET /meta/:type/:name/history`, `/audit` and `/diff` — beside `isSystem`.
 *
 * Both are platform-scoped: plugin-security's `PLATFORM_ADMIN_ONLY_CAPABILITIES`
 * lists them, and no organization administrator holds either by role.
 * `setup.access` is left out on purpose. Organization administrators hold it,
 * and under a wall it handed each organization's administrator the
 * environment-wide trail of every item: who saved it, when, and the superseded
 * bodies. No organization authors that trail (ADR-0131 C5), and the data door
 * on the same three tables already refuses them
 * (`requiredPermissions: ['studio.access']`, ADR-0131 D7).
 */
const AUTHORING_TRAIL_READ_CAPABILITIES: readonly string[] = ['studio.access', 'manage_metadata'];

/**
 * [#23546] May this caller read the AUTHORING TRAIL of a metadata item — its
 * version history, its audit rows and the diff of its stored versions? The
 * admission {@link refuseNonAuthoringCaller} asks, and nothing else asks it.
 *
 * A system caller, or a holder of one of
 * {@link AUTHORING_TRAIL_READ_CAPABILITIES}, read from `systemPermissions`
 * exactly as `isObjectSchemaMaskExempt` reads it.
 *
 * It is a strict subset of {@link mayReadPendingDrafts}: it admits nobody the
 * draft predicate refuses, and it refuses the `setup.access`-only caller the
 * draft predicate admits. The draft switches (`GET /meta/_drafts`,
 * `?state=draft`, `?preview=draft`) keep `mayReadPendingDrafts`, unchanged.
 * `meta-history-diff-authoring-door.test.ts` holds the two predicates to that
 * relation, caller by caller.
 */
function mayReadAuthoringTrail(caller: unknown): boolean {
    if (!caller || typeof caller !== 'object') return false;
    const ctx = caller as { isSystem?: unknown; systemPermissions?: unknown };
    if (ctx.isSystem === true) return true;
    return Array.isArray(ctx.systemPermissions)
        && ctx.systemPermissions.some((p) => typeof p === 'string' && AUTHORING_TRAIL_READ_CAPABILITIES.includes(p));
}

/**
 * [#20378 · #20441] THE AUTHORING-DOOR REFUSAL — ruling 5865708652 (letter B),
 * carried to `/audit` by triage's grade 5871509797. Sends it and answers `true`
 * when {@link mayReadAuthoringTrail} does not admit `caller`; answers `false`,
 * sending nothing, when it does. The `refuseRepeatedQueryParams` convention:
 * `if (refuseNonAuthoringCaller(ctx, res, …)) return;`.
 *
 * The item-scoped doors that read an AUTHORING LOG ask it first, before the
 * protocol is resolved, before the query is parsed and before any item or
 * event is read: `/history` and `/diff` read `sys_metadata_history`, and
 * `/audit` reads `sys_metadata_audit`. Both logs record a DRAFT save exactly
 * as they record an active one, so they have no published-only answer to fall
 * back to, and a caller the trail does not admit is refused in
 * `GET /meta/_drafts`'s shape: 403 `FORBIDDEN`, the same nested envelope. The
 * answer is the same for an item that exists, one that does not and a
 * draft-only one, so the door is no existence oracle.
 *
 * [#23546] The admission is {@link mayReadAuthoringTrail}, no longer
 * {@link mayReadPendingDrafts}: the trail drops `setup.access`, and the draft
 * switches keep it.
 *
 * `reading` names THE DOOR and never drafts: a refusal worded about drafts
 * would read as "this item has one". This is ONE function so the three doors
 * cannot drift apart in their predicate, status, code or envelope; only the
 * door's own name differs between them.
 *
 * [#23050 slice 13d] Exported because those three doors moved to
 * `meta-item-history-routes.ts`, which imports it from here: it stays beside
 * {@link mayReadAuthoringTrail}, the admission it asks, rather than taking a
 * second home.
 */
export function refuseNonAuthoringCaller(caller: unknown, res: any, reading: string): boolean {
    if (mayReadAuthoringTrail(caller)) return false;
    res.status(403).json({
        error: {
            code: 'FORBIDDEN',
            message: `${reading} requires an authoring capability (studio.access or manage_metadata); `
                + 'setup.access, which organization administrators hold, does not admit the authoring trail.',
        },
    });
    return true;
}

/**
 * [#20156] What the per-caller read gate of `GET /meta/:type/:name` answers for
 * ONE document — see {@link RestServer.metaItemReadGate}, the one place it is
 * decided.
 *
 *  - `serve` — send `document`: the input, or the input minus what this
 *    caller may not read (the app nav filter, the dashboard widget gate).
 *  - `refuse` — send nothing of the document; `send` writes the refusal the
 *    plain read gives this caller (its status, its code, its emitter).
 */
type MetaReadVerdict =
    | { kind: 'serve'; document: any }
    | { kind: 'refuse'; send: (res: any) => void };

// [#21476] The intake-availability predicate, its posture reader, the object a
// form submits into, where its `sharing` sits and the reason it states all live
// in `@objectstack/metadata-core` (`anonymous-form-intake.ts`): both doors, the
// admin read below and the runtime authoring gate's save/publish advisory read
// them from there, so none of the three can disagree with another.

/**
 * [#21476] Put the admin read's intake reasons in `_diagnostics.warnings`, where
 * a derived view warning already goes (`stampRenameWarning`). A declared read
 * decoration, so a GET then PUT round trip never stores it.
 */
export function stampAnonymousFormIntakeWarnings(
    document: any,
    warnings: ReadonlyArray<{ path: string; message: string }>,
): any {
    if (warnings.length === 0 || !document || typeof document !== 'object') return document;
    const prior = document._diagnostics;
    const diagnostics: Record<string, any> = prior && typeof prior === 'object' ? { ...prior } : { valid: true };
    diagnostics.warnings = [...(Array.isArray(prior?.warnings) ? prior.warnings : []), ...warnings];
    return { ...document, _diagnostics: diagnostics };
}

// [#21476] `anonymousFormIntakeFingerprint`, those reasons' ETag dimension, moved with its one
// caller (the item read's intake-reason fold) to `meta-item-read-routes.ts` (#23050 slice 13b).

/**
 * RestServer
 * 
 * Provides automatic REST API endpoint generation for ObjectStack.
 * Generates standard RESTful CRUD endpoints, metadata endpoints, and batch operations
 * based on the configured protocol provider.
 * 
 * Features:
 * - Automatic CRUD endpoint generation (GET, POST, PUT, PATCH, DELETE)
 * - Metadata API endpoints (/meta)
 * - Batch operation endpoints (/batch, /createMany, /updateMany, /deleteMany)
 * - Discovery endpoint
 * - Configurable path prefixes
 * 
 * @example
 * const restServer = new RestServer(httpServer, protocolProvider, {
 *   api: {
 *     version: 'v1',
 *     basePath: '/api'
 *   },
 *   crud: {
 *     dataPrefix: '/data'
 *   }
 * });
 * 
 * restServer.registerRoutes();
 */
export class RestServer {
    private protocol: RestProtocol;
    private config: NormalizedRestServerConfig;
    private routeManager: RouteManager;
    /**
     * Routes mounted on the SAME host server by a registrar that bypasses
     * `RouteManager`, as reported by the composition step that called it
     * (#5822). Facts, not intentions: a registrar the boot never called
     * contributes nothing here, so `getRoutes()` and the OpenAPI document stay
     * silent about it. See `direct-mount.ts`.
     */
    private readonly directMountedRoutes: MountedRoute[] = [];
    private kernelManager?: RestKernelManager;
    private envRegistry?: RestEnvRegistry;
    /**
     * Host-injected request→environment resolver (ADR-0076 D11 step ④). When
     * present it is the AUTHORITY for unscoped-route environment resolution;
     * the legacy `envRegistry` chain below only runs when this is absent or
     * throws. See {@link RestRequestEnvResolver}.
     */
    private requestEnvResolver?: RestRequestEnvResolver;
    /**
     * Short-TTL cache for `hostname → environmentId` (P1-4). `resolveByHostname`
     * is a control-plane lookup (typically a DB query) that otherwise runs on
     * *every* unscoped request; caching it — including negative results, so
     * unknown hosts don't hammer the registry — removes that per-request cost.
     * The TTL is short so a newly-bound hostname becomes routable quickly.
     */
    private readonly hostnameCache = new Map<string, { value: { environmentId: string } | null; expiresAt: number }>();
    private readonly hostnameCacheTtlMs = 30_000;
    /**
     * Request-scoped memoization for `resolveExecCtx`. A single HTTP request
     * resolves the SAME execution context (identity + RBAC/RLS + localization)
     * many times — the data operation itself, app-nav RBAC filtering, dashboard
     * widget gating, the auth gate, etc. Each resolution is ~16 sequential
     * queries (the `resolveAuthzContext` aggregation plus localization), so a
     * request that resolves twice pays for duplicate authz and repeated
     * localization. Keyed by the per-request `req` object (a `WeakMap`, so the
     * entry is collected with the request — naturally request-scoped, no TTL,
     * no cross-request leak) and the input `environmentId`. We cache the
     * in-flight Promise so concurrent callers share one resolution.
     */
    private readonly execCtxMemo = new WeakMap<object, Map<string, Promise<any | undefined>>>();
    /**
     * [#7912] De-duplication keys for the nav-servability prune log — one line
     * per `app|entry|object|reason` per process. See
     * {@link resolveNavServability}: a console session re-fetches `/meta/app`
     * on every navigation, so an unthrottled warning would bury its own first
     * occurrence. Process-lifetime by design (the set is bounded by the number
     * of dead nav entries authored, not by traffic).
     */
    private readonly navPruneLogged = new Set<string>();
    private defaultEnvironmentIdProvider?: () => string | undefined;
    private authServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private objectQLProvider?: (environmentId?: string) => Promise<any | undefined>;
    /**
     * [#15256 — maintainer ruling 2026-09-04, decision 1A] The lone local
     * kernel's `tenancy` service, on the SINGLE-KERNEL wiring — the seam that
     * made {@link computeExecCtx}'s posture `undefined` on every deployment the
     * open core builds, so both posture-conditional API-key refusals were
     * gated off and an ex-member's org-stamped key read AND wrote another
     * organization's rows (measured twice: objectstack#15163 on the framework,
     * cloud#1982 with the real `@objectstack/organizations`).
     *
     * Wired by `rest-api-plugin` in the same SHAPE as
     * {@link authServiceProvider} — a provider closure over the lone kernel —
     * but with `objectQLProvider`'s CLASSIFICATION, because decision 1 option A
     * governs what its faults mean: only the branded not-registered rejection
     * may resolve quietly, and every other rejection must stay loud. See the
     * posture block in `computeExecCtx`.
     */
    private tenancyServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private emailServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private sharingServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private approvalsServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private sharingRulesServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private i18nServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private analyticsServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private settingsServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    /** [ADR-0090] `security` service resolver — used by the
     *  /security/suggested-bindings (D5/D9) and /security/explain (D6)
     *  routes (plugin-security). */
    private securityServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    /** Sync probe: is a kernel service registered? Single-env path for nav
     *  capability gates (ADR-0057 D10) — resolveExecCtx sets no kernel in
     *  single-kernel deployments, so this prevents the gate failing open. */
    private serviceExistsProvider?: (name: string) => boolean;
    /**
     * [#5224] `metadata` service resolver — the endpoint matcher behind
     * `IMetadataService.matchEndpoint`, and therefore the ONE authority on
     * which declared `api` route the runtime actually serves. Read by the two
     * machine-readable endpoint faces (`GET /meta/api`, `GET /openapi.json`)
     * so neither announces a declaration that answers 404.
     */
    private metadataServiceProvider?: (environmentId?: string) => Promise<unknown>;
    /**
     * One-shot latch for the "no matcher wired" degradation notice below, so a
     * host that never wired {@link metadataServiceProvider} says so once per
     * server rather than once per request.
     */
    private warnedMissingEndpointAuthority = false;
    /**
     * In-flight async import jobs the caller has asked to cancel. The worker
     * checks membership at each progress boundary and stops cooperatively. This
     * is process-local (single-node); the persisted `sys_import_job.status` is
     * the durable source of truth a restarted/other node reads.
     */
    private readonly cancelledImportJobs = new Set<string>();

    constructor(
        server: IHttpServer,
        protocol: RestProtocol,
        config: RestServerConfig = {},
        kernelManager?: RestKernelManager,
        envRegistry?: RestEnvRegistry,
        defaultEnvironmentIdProvider?: () => string | undefined,
        authServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        objectQLProvider?: (environmentId?: string) => Promise<any | undefined>,
        emailServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        sharingServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        /**
         * RETIRED slot (#20102) — this position carried the saved-report
         * service provider, whose `/reports` routes were retired with the
         * saved-report stack. The slot is kept, typed `undefined`, because
         * every later parameter is positional: removing it would silently
         * re-bind each argument after it (the #15256 hazard) at every call
         * site that passes one. Pass `undefined`; passing a provider is a
         * compile error.
         */
        _retiredReportsServiceProvider?: undefined,
        approvalsServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        sharingRulesServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        i18nServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        analyticsServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        settingsServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        serviceExistsProvider?: (name: string) => boolean,
        securityServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        requestEnvResolver?: RestRequestEnvResolver,
        metadataServiceProvider?: (environmentId?: string) => Promise<unknown>,
        /**
         * [#15256] Appended LAST on purpose: 135 files construct a
         * `RestServer`, and inserting the parameter beside its sibling
         * providers would silently re-bind every positional argument after it.
         */
        tenancyServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
    ) {
        this.protocol = protocol;
        this.config = this.normalizeConfig(config);
        this.routeManager = new RouteManager(server);
        this.kernelManager = kernelManager;
        this.envRegistry = envRegistry;
        this.defaultEnvironmentIdProvider = defaultEnvironmentIdProvider;
        this.authServiceProvider = authServiceProvider;
        this.objectQLProvider = objectQLProvider;
        this.emailServiceProvider = emailServiceProvider;
        this.sharingServiceProvider = sharingServiceProvider;
        this.approvalsServiceProvider = approvalsServiceProvider;
        this.sharingRulesServiceProvider = sharingRulesServiceProvider;
        this.i18nServiceProvider = i18nServiceProvider;
        this.analyticsServiceProvider = analyticsServiceProvider;
        this.settingsServiceProvider = settingsServiceProvider;
        this.serviceExistsProvider = serviceExistsProvider;
        this.securityServiceProvider = securityServiceProvider;
        this.requestEnvResolver = requestEnvResolver;
        this.metadataServiceProvider = metadataServiceProvider;
        this.tenancyServiceProvider = tenancyServiceProvider;
    }

    /**
     * Resolve the endpoint matcher for this request — the authority the two
     * machine-readable endpoint faces consult before announcing anything
     * (#5224).
     *
     * Same lookup chain as {@link resolveProtocol}: the per-request kernel when
     * one is resolvable (a multi-tenant host must ask the REQUEST's own
     * matcher, or one environment's declarations would describe another's
     * URLs), else the single-kernel provider `rest-api-plugin` wires.
     *
     * Returns `undefined` when nothing in the chain can answer — including when
     * the resolved occupant of the `metadata` slot carries no `matchEndpoint`,
     * which is a legal shape (the contract method is optional). Callers must
     * decide what an ABSENT authority means for their surface rather than
     * having a verdict invented here; see the call sites.
     */
    private async resolveEndpointMatchAuthority(
        environmentId?: string,
        req?: any,
    ): Promise<EndpointMatchAuthority | undefined> {
        let envId: string | undefined;
        try {
            // Shared resolution entry point (ADR-0076 D11 step 4), the same one
            // `resolveProtocol` / `resolveI18nService` use — so the face reads
            // the matcher of the environment whose items it just enumerated.
            envId = await this.resolveRequestEnvironmentId(environmentId, req);
        } catch { /* fall through to the single-kernel provider */ }

        if (envId && envId !== 'platform' && this.kernelManager) {
            try {
                const kernel = await this.kernelManager.getOrCreate(envId);
                const svc = await kernel.getServiceAsync<unknown>('metadata');
                if (isEndpointMatchAuthority(svc)) return svc;
            } catch { /* fall through */ }
        }
        if (this.metadataServiceProvider) {
            try {
                const svc = await this.metadataServiceProvider(envId);
                if (isEndpointMatchAuthority(svc)) return svc;
            } catch { /* an unreachable provider is an ABSENT authority */ }
        }
        return undefined;
    }

    /**
     * Resolve the `metadata` service for this request — the whole occupant of
     * the slot, unfiltered.
     *
     * The same two-step chain {@link resolveEndpointMatchAuthority} walks
     * (per-request kernel, then the single-kernel provider `rest-api-plugin`
     * wires), separated out because that method narrows its answer to the ONE
     * capability it needs and returns `undefined` for a service that lacks it.
     * A caller after a different optional member (`getPublished`, #7526) must
     * not have "the service is absent" and "the service does not do that"
     * collapsed into one answer before it sees them.
     *
     * `undefined` means nothing in the chain answered. Deciding what an absent
     * service means for a given surface is the call site's business.
     */
    private async resolveMetadataService(environmentId?: string, req?: any): Promise<unknown | undefined> {
        let envId: string | undefined;
        try {
            envId = await this.resolveRequestEnvironmentId(environmentId, req);
        } catch { /* fall through to the single-kernel provider */ }

        if (envId && envId !== 'platform' && this.kernelManager) {
            try {
                const kernel = await this.kernelManager.getOrCreate(envId);
                const svc = await kernel.getServiceAsync<unknown>('metadata');
                if (svc) return svc;
            } catch { /* fall through */ }
        }
        if (this.metadataServiceProvider) {
            try {
                const svc = await this.metadataServiceProvider(envId);
                if (svc) return svc;
            } catch { /* an unreachable provider is an absent service */ }
        }
        return undefined;
    }

    /**
     * Say — once per server — that no endpoint matcher is reachable, so the
     * endpoint faces cannot promise they describe only served routes.
     *
     * Loud rather than silent (AGENTS.md, Route & surface ownership Rule 3):
     * without the authority these surfaces fall back to enumerating what is
     * STORED, which is exactly the pre-#5224 behaviour and exactly the state
     * that can advertise a route answering 404. Reported at `error` because the
     * consequence is a contract face that may lie, and the remedy is a wiring
     * change the operator can make.
     */
    private notifyMissingEndpointAuthority(surface: string): void {
        if (this.warnedMissingEndpointAuthority) return;
        this.warnedMissingEndpointAuthority = true;
        logError(
            `[REST] no endpoint matcher is reachable (no \`metadata\` service with \`matchEndpoint\`), so ${surface} ` +
                `cannot narrow declared \`api\` items to the ones this runtime actually serves. It is enumerating ` +
                `what is STORED instead, which may advertise routes that answer 404. Wire the metadata service ` +
                `into the REST server (rest-api-plugin does this) to restore the guarantee.`,
        );
    }

    /**
     * Cached wrapper around `envRegistry.resolveByHostname` (P1-4). Returns the
     * cached result while fresh; on a miss it queries the registry and caches the
     * outcome (positive *and* negative) for {@link hostnameCacheTtlMs}. Registry
     * errors are not cached so a transient control-plane blip self-heals on the
     * next request.
     */
    private async resolveHostnameCached(host: string): Promise<{ environmentId: string } | null | undefined> {
        const now = Date.now();
        const hit = this.hostnameCache.get(host);
        if (hit && hit.expiresAt > now) return hit.value;
        const result = (await this.envRegistry!.resolveByHostname(host)) ?? null;
        this.hostnameCache.set(host, { value: result, expiresAt: now + this.hostnameCacheTtlMs });
        return result;
    }

    /**
     * Resolve the environment a request targets. THE single entry point for
     * every unscoped-route environment decision (protocol, i18n, exec-ctx,
     * analytics, …) so they can never disagree about which kernel a request
     * belongs to.
     *
     * Chain: explicit id → host-injected {@link RestRequestEnvResolver}
     * (ADR-0076 D11 step ④ — the dispatcher's ADR-0006 `kernel-resolver`
     * strategy; its normal return, including `undefined`, is final) → legacy
     * built-in chain (tenant hostname → `X-Environment-Id` header) → single-
     * project default. Returns undefined for control-plane requests.
     */
    private async resolveRequestEnvironmentId(environmentId?: string, req?: any): Promise<string | undefined> {
        if (environmentId) return environmentId;
        // 1. Host-injected resolver seam. Where wired (cloud runtime), this is
        //    the SAME strategy instance the HTTP dispatcher uses, so REST and
        //    dispatcher routes always agree on a request's environment —
        //    including the session-driven fallbacks the legacy chain below
        //    never had. Normal returns are final; only a throw degrades to
        //    the legacy chain.
        if (req && this.requestEnvResolver) {
            try {
                return await this.requestEnvResolver.resolveRequestEnvironmentId(req);
            } catch { /* resolver failure → legacy chain */ }
        }
        if (req && this.envRegistry && this.kernelManager) {
            const host = this.extractHostname(req);
            if (host) {
                try {
                    const result = await this.resolveHostnameCached(host);
                    if (result?.environmentId) return result.environmentId;
                } catch {
                    // fall through to next strategy
                }
            }
            // 2. `X-Environment-Id` request header → environmentId. Lets clients
            //    explicitly target a project when the URL is unscoped and
            //    no hostname binding exists (e.g. a single shared origin
            //    serving multiple compiled bundles via OS_PROJECT_ARTIFACTS).
            //    We validate the id through the env registry to avoid
            //    routing to a non-existent kernel.
            if (typeof this.envRegistry.resolveById === 'function') {
                const headerVal = this.extractProjectIdHeader(req);
                if (headerVal) {
                    try {
                        const driver = await this.envRegistry.resolveById(headerVal);
                        if (driver) return headerVal;
                    } catch {
                        // fall through to default fallback
                    }
                }
            }
        }
        // 3. Single-project default fallback. Registered by
        //    `createSingleEnvironmentPlugin()` so bare `/api/v1/data/...` URLs
        //    (no `/environments/<id>` prefix, no hostname mapping, no header)
        //    resolve to the lone project's kernel rather than the control
        //    plane.
        if (this.defaultEnvironmentIdProvider) {
            try {
                const def = this.defaultEnvironmentIdProvider();
                if (def) return def;
            } catch { /* fall through */ }
        }
        return undefined;
    }

    /**
     * Resolve the protocol that serves this request — and THE single
     * kernel-acquisition point on the path a REST-owned route takes to answer.
     *
     * Two steps, deliberately of different kinds: {@link
     * resolveRequestEnvironmentId} answers *which environment* (cheap, and
     * kernel-free wherever the host implements `resolveEnvironment` — see
     * {@link RestRequestEnvResolver}), then `getOrCreate` acquires that
     * environment's kernel. Anything that collapses them back together
     * re-creates the double waiter window: the env question routed through a
     * kernel-acquisition API, paid for, discarded, then paid again here.
     *
     * **This `getOrCreate` fails closed and must keep doing so.** A genuinely
     * unavailable kernel rejects here, the rejection propagates to the route's
     * `handleRouteError`, and the caller gets the host's declared 503 — never a
     * response served against no kernel. Removing the first (wasted) window
     * shortened the wait to that 503; it did not, and must not, turn it into a
     * success.
     *
     * Special case: `environmentId === 'platform'` is a reserved virtual id used
     * by Studio to address the control plane through the regular environment
     * URL shape (`/environments/platform/...`). It is NOT a row in the projects
     * table, so we must never call `KernelManager.getOrCreate('platform')`.
     * Instead, return the control-plane protocol directly. This lets Studio
     * (and any other client) speak a single, uniform URL family without
     * duplicating route logic for the platform surface.
     */
    private async resolveProtocol(environmentId?: string, req?: any): Promise<RestProtocol> {
        if (environmentId === 'platform') return this.protocol;
        const envId = await this.resolveRequestEnvironmentId(environmentId, req);
        if (!envId || !this.kernelManager) return this.protocol;
        const kernel = await this.kernelManager.getOrCreate(envId);
        return kernel.getServiceAsync<RestProtocol>('protocol');
    }

    /**
     * Resolve the i18n service for the request's project (or control plane
     * when no project id is in scope). Returns `undefined` when no service is
     * registered, so callers can short-circuit and skip translation rather
     * than failing.
     *
     * Mirrors `resolveProtocol`'s lookup chain: explicit `environmentId` from the
     * route → kernel-managed `i18n` service. Control-plane / unscoped
     * requests intentionally return `undefined` because the platform kernel
     * does not own per-app translation bundles.
     */
    private async resolveI18nService(environmentId?: string, req?: any): Promise<any | undefined> {
        if (environmentId === 'platform') return undefined;
        // Shared resolution entry point (D11④) — previously this method
        // hand-copied the hostname/header/default chain; now every consumer
        // gets the one answer from resolveRequestEnvironmentId.
        environmentId = await this.resolveRequestEnvironmentId(environmentId, req);
        // Multi-tenant kernel lookup first; falls back to the single-kernel
        // provider supplied by RestApiPlugin in dev / standalone mode.
        if (environmentId && this.kernelManager) {
            try {
                const kernel = await this.kernelManager.getOrCreate(environmentId);
                const svc = await kernel.getServiceAsync<any>('i18n');
                if (svc) return svc;
            } catch { /* fall through */ }
        }
        if (this.i18nServiceProvider) {
            try {
                return await this.i18nServiceProvider(environmentId);
            } catch { return undefined; }
        }
        return undefined;
    }

    /**
     * [#23367, ruling A] The API-key lifecycle refusal a request's identity
     * resolution raised (revoked, expired, inactive), kept beside the REQUEST
     * by {@link computeExecCtx}'s catch so {@link enforceAuth} can answer it.
     * The resolution itself still answers "no context", exactly as for any
     * identity fault: every door that never reaches `enforceAuth` keeps the
     * fail-closed answer it has always given a dead key, and the one that does
     * now says which state and which date. Weak, so it lives no longer than
     * the request object.
     */
    private readonly apiKeyLifecycleRefusals = new WeakMap<object, ApiKeyLifecycleRefusalError>();

    /**
     * Reject anonymous requests with HTTP 401 — unconditionally (#3963: the
     * `api.requireAuth` opt-out is retired). Returns `true` if the response was
     * sent and the caller should stop
     * processing. Returns `false` to continue.
     *
     * The check is intentionally narrow: only `context?.userId` counts as
     * "authenticated". `isSystem` flags are never set on inbound HTTP
     * requests (they're internal-only), so they cannot bypass this gate.
     *
     * [#23367] A request whose API key its own lifecycle refused resolves no
     * context either, and is answered here with the refusal's `403`, code and
     * located message instead of the generic 401.
     */
    private enforceAuth(req: any, res: any, context: any): boolean {
        // ADR-0069 — authentication-policy gate (password expiry, enforced MFA).
        // Independent of the anonymous-deny: a gated session (carrying `authGate`) is
        // blocked from protected resources, while the core allow-list keeps auth
        // + remediation reachable. Runs before the anonymous check.
        const gate = context?.authGate;
        // Exemption requires a REAL, non-empty path — mirrors the sibling seam
        // (`shouldDenyAnonymous`, core/src/security/anonymous-deny.ts:122).
        //
        // ⚠️ `isAuthGateAllowlisted(undefined)` USED to return `true` (it treated
        // "no path" as allow-listed). Passed the raw value, a request whose
        // `path` was absent or empty read as allow-listed on EVERY route, so the
        // gate did not fire for a session policy says must be blocked —
        // fail-OPEN by omission. No shipped transport reaches here without a
        // `path` (the hono adapter sets it at all three request-construction
        // sites), so this was the default being made safe, not a live bypass
        // being closed (#7432).
        //
        // [#7898] The predicate itself is fail-closed at the source now, so this
        // guard and it agree and this seam's behaviour is unchanged. ⛔ The guard
        // stays: it is what keeps this seam's answer independent of what the
        // predicate does with a falsy argument, and `rest-auth-gate.test.ts`
        // still turns red without it.
        const pathExempt =
            typeof req?.path === 'string' && req.path.length > 0 && isAuthGateAllowlisted(req.path);
        if (gate && req?.method !== 'OPTIONS' && !pathExempt) {
            res.status(403).json({ error: { code: gate.code, message: gate.message } });
            return true;
        }
        // Shared anonymous-deny decision (#2567). Pass no `path`: the REST
        // control-plane routes are registered WITHOUT `enforceAuth`, so this
        // seam only ever guards data/meta — deny unconditionally when anonymous,
        // exactly as before (the allowlist is reserved for a future umbrella
        // seam). `isSystem` is never set on inbound HTTP, so it cannot bypass.
        if (shouldDenyAnonymous({
            userId: context?.userId,
            isSystem: context?.isSystem,
            method: req?.method,
        })) {
            const lifecycle = req && typeof req === 'object' ? this.apiKeyLifecycleRefusals.get(req) : undefined;
            if (lifecycle) {
                res.status(lifecycle.status).json({ error: { code: lifecycle.code, message: lifecycle.message } });
                return true;
            }
            res.status(ANONYMOUS_DENY_STATUS).json(ANONYMOUS_DENY_BODY);
            return true;
        }
        // The credential must belong to the environment the request resolved
        // to. `computeExecCtx` can validate a caller against the DEFAULT
        // environment's auth service when the resolved environment's kernel
        // carries none, so a session minted there would otherwise authenticate
        // a request aimed at another environment (ADR-0006: a token is not
        // replayable across environments). Both sides are stamped by
        // `computeExecCtx`; a context it did not produce carries neither and
        // is not judged here. The refusal is the anonymous-deny response,
        // byte for byte — see `enforceEnvironmentOwnership` for why a distinct
        // status would rebuild an environment-existence oracle.
        if (credentialAnchoredElsewhere(context)) {
            res.status(ANONYMOUS_DENY_STATUS).json(ANONYMOUS_DENY_BODY);
            return true;
        }
        return false;
    }

    /**
     * [commit cc837dbfe] Refuse a request whose RESOLVED environment is not one the CALLER
     * holds — the comparison this server did not have.
     *
     * ## The defect this closes, and why the anonymous gate alone did not
     *
     * `GET /api/v1/ui/view/:object/:type` mounts UNSCOPED as well as scoped, and
     * on the unscoped mount the environment is named by the REQUEST: the bound
     * hostname, else the `X-Environment-Id` header. Both were honoured with no
     * identity resolved at all, so an ANONYMOUS caller received another
     * environment's UI view — object label plus every field's name / label /
     * type / required — and the route doubled as an object-existence oracle for
     * whatever environment it named. Measured in commits 889ec5b42 (identity) and
     * 3d10755f0 (tenancy).
     *
     * Adding `resolveExecCtx` + `enforceAuth` was measured NOT to be the repair
     * (it was the rejected option B of the 2026-08-30 ruling): it stops the
     * anonymous caller and nothing else, because an AUTHENTICATED caller could
     * still name a foreign environment and nothing downstream ever compared the
     * environment that was RESOLVED with the environment the caller is entitled
     * to. That comparison is this method.
     *
     * ## What "entitled to" means here, mechanically
     *
     * There was no ownership predicate in this package to reuse — searched
     * before writing one — and `ExecutionContext` carries no environment field,
     * so the fact had to come from where identity is established.
     * {@link computeExecCtx} validates the caller against an auth service it
     * looks up in a KERNEL, and it records which environment that kernel belongs
     * to on `__authEnvironmentId`. A credential is good for the environment
     * whose auth service accepted it; if the request resolved to a different
     * environment, the caller is not entitled to what is about to be served.
     *
     * That difference is not hypothetical — `computeExecCtx`'s second branch
     * produces it: when the resolved environment's kernel carries no `auth`
     * service, the lookup falls back to the DEFAULT environment's, and a session
     * minted there then authenticates a request naming another environment.
     *
     * Two refusable shapes, both handled:
     *
     *  1. **Named but not served.** The caller named an environment through
     *     `X-Environment-Id` and the chain resolved a DIFFERENT one — which is
     *     what an unresolvable id does today: `resolveRequestEnvironmentId`
     *     swallows the `envRegistry.resolveById` miss and falls through to the
     *     default environment, answering 200 with THAT environment's view. Two
     *     200s with different bytes is how a caller with no credential tells a
     *     real environment id from an invented one. Refused here rather than
     *     answered — the ruling's 「信号化拒绝」, and ⛔ never a silent fallback.
     *  2. **Anchored elsewhere.** The credential was validated in an environment
     *     other than the one resolved. `enforceAuth` makes this same comparison
     *     on every route behind it, from the context's own `__environmentId`;
     *     it is repeated here against the environment this seam was handed, so
     *     the two halves of this guard stay one call.
     *
     * ## ⚠️ Why the refusal is the ANONYMOUS-DENY response, verbatim
     *
     * Deliberate, and the reason is the oracle rather than tidiness. A caller
     * naming a REAL foreign environment already receives 401 from
     * {@link enforceAuth} — their session is not valid in that environment, so
     * no context resolves there. Answering the two cases above with anything
     * else (403, or a 404 of this seam's own) would leave "this environment id
     * exists" distinguishable from "it does not" by the status alone, which is
     * the same oracle one layer up. One shape, byte-identical, for every way a
     * caller can fail to be entitled to the environment it named.
     *
     * ⚠️ The cost is diagnosability, and it is named rather than discovered: an
     * operator whose environment genuinely lacks an `auth` service sees the
     * anonymous 401, not a wiring error. That is the same trade the sibling
     * seams already make (`computeExecCtx` answers a faulting resolver and a
     * genuinely anonymous caller identically, #12537).
     *
     * `undefined` and `'platform'` are NOT environments: a control-plane boot
     * resolves no environment, so there is nothing to own and the anonymous
     * floor above is the whole gate. A caller that NAMED one anyway (case 1)
     * is still refused.
     *
     * @returns `true` when the response was sent and the caller must stop.
     */
    private enforceEnvironmentOwnership(
        req: any,
        res: any,
        environmentId: string | undefined,
        context: any,
    ): boolean {
        // 1. Named through the header, but the chain served something else.
        const named = this.extractProjectIdHeader(req);
        const namedButNotServed = named !== undefined && named !== environmentId;

        // 2. The credential is anchored in a different environment.
        const scopesAnEnvironment = environmentId !== undefined && environmentId !== 'platform';
        const anchoredElsewhere =
            scopesAnEnvironment && (context as any)?.__authEnvironmentId !== environmentId;

        if (namedButNotServed || anchoredElsewhere) {
            res.status(ANONYMOUS_DENY_STATUS).json(ANONYMOUS_DENY_BODY);
            return true;
        }
        return false;
    }

    /**
     * The by-name OBJECT read the `/data` doors make, or `undefined` for a
     * protocol with no by-name read. Answers the protocol's `{ item, … }`
     * envelope. Same env-scoped request shape the list read sends
     * (`metaListSource`).
     *
     * [#24535] On the protocol's EXECUTION face where it has one: the reader
     * serves no byte of the item (the exposure gate reads `enable`; the NOT NULL
     * relabel that read a field's `label` retired with #24768), and the served face's
     * decoration was a full diagnostic `safeParse` of the object's definition on
     * every `/data` request. Same sources, overlay cache and governance either
     * way; a protocol without it is asked `getMetaItem`.
     */
    private objectItemReader(
        p: RestProtocol,
        environmentId: string | undefined,
    ): ((name: string) => Promise<unknown>) | undefined {
        const byName = typeof p.getMetaItemForExecution === 'function'
            ? p.getMetaItemForExecution
            : typeof p.getMetaItem === 'function' ? p.getMetaItem : undefined;
        if (!byName) return undefined;
        return (name) => {
            const itemRequest: TransportScopedMetaRequest<GetMetaItemRequest> = {
                type: 'object',
                name,
                ...(environmentId ? { environmentId } : {}),
            };
            return byName.call(p, itemRequest);
        };
    }

    /**
     * Enforce object-level API exposure (ObjectSchema `enable.apiEnabled` /
     * `enable.apiMethods`) on the REST data surface — the *external* API boundary
     * only. Internal callers (hooks, flows, raw objectql) are unaffected, which is
     * the point: `apiEnabled` controls automatic API exposure, not data access.
     *
     * - `enable.apiEnabled === false` → object hidden from the API (404, so its
     *   existence isn't revealed).
     * - `enable.apiMethods` (non-empty whitelist) → unlisted operations rejected (405).
     *
     * Default-allow: objects with no `enable` block (or `apiEnabled` unset/true and
     * no `apiMethods` whitelist) behave exactly as before — no regression. A
     * metadata-read failure does not block (the data call itself needs the same
     * metadata and will surface the error). Returns `true` when the request was
     * blocked (response already sent).
     *
     * ## Unknown objects (#3770)
     *
     * An object this gate cannot find in metadata is passed through — there is no
     * declared exposure policy to enforce on it, so there is nothing for this gate
     * to decide. What CLOSES it is downstream, and it is worth naming precisely
     * because the previous note here named the wrong thing ("let the data path
     * 404" — a fallback that did not exist):
     *
     *  1. `protocol.assertObjectRegistered` (#3770) rejects every data entry point
     *     for an object absent from the schema registry with 404
     *     `OBJECT_NOT_FOUND`, BEFORE the engine turns the name into a table name.
     *     That is the real 404, and unlike the old assumption it does not depend
     *     on a driver happening to error on a missing table — which is why an
     *     unregistered object whose physical table DID exist used to be served.
     *  2. plugin-security's `getObjectSecurityMeta` (#3545) reports an
     *     `unresolved` posture for the same object, and the engine middleware,
     *     `canExport` and `getReadableFields` fail CLOSED on it.
     *
     * Neither is a reason to widen this gate: (1) is the existence answer and (2)
     * is the authorization answer. Do not relax the pass-through on the assumption
     * that some other layer 404s — verify which one, as #3770 did.
     *
     * See ADR-0049 (#1889): shipping a non-enforcing `apiEnabled` is false security.
     */
    private async enforceApiAccess(
        req: any,
        res: any,
        p: RestProtocol,
        environmentId: string | undefined,
        operation: string,
        /**
         * The request's resolved context, as the route already holds it (the
         * one it handed `enforceAuth`). Required, so a route cannot ask this
         * gate without it: the API-key management rule below reads which
         * credential admitted the caller off it (`__admittedBy`).
         */
        context: unknown,
        opts?: ApiAccessOpts,
    ): Promise<boolean> {
        const objectName = req?.params?.object;
        if (!objectName) return false;
        // [#24031] The ONE object this gate judges, read by name — never the
        // whole object list, whose decoration diagnosed every object on every
        // request. A protocol with no by-name read is asked the list.
        const obj = await this.loadObjectItem(p, environmentId, objectName);
        // [#3770] Unknown object → no declared exposure policy to enforce here;
        // the data path's registry gate 404s it. See the doc comment above.
        if (!obj) return false;
        const denial = apiAccessDenialFromEnable(obj.enable, objectName, operation, opts);
        if (denial) {
            res.status(denial.status).json(denial.body);
            return true;
        }
        // A write to `sys_api_key` from a principal an API key admitted is
        // refused `403 PERMISSION_DENIED`: changing a key is a signed-in-session
        // act, the answer `/keys` gives (`apiKeyManagementCredentialRefusal`,
        // `@objectstack/core`, whose docblock carries the rule). Asked after the
        // exposure verdict, so an operation the object does not expose keeps its
        // `405`, and here because every data route of this server passes this
        // gate. `__admittedBy` is the credential the shared resolver told
        // `computeExecCtx`, on the context the route hands in.
        const credentialRefusal = apiKeyManagementCredentialRefusal({
            object: objectName,
            operation,
            credential: (context as { __admittedBy?: 'api_key' | 'session' } | undefined)?.__admittedBy,
        });
        if (credentialRefusal) {
            const mapped = mapDataError(credentialRefusal, objectName);
            res.status(mapped.status).json(mapped.body);
            return true;
        }
        return false;
    }

    /**
     * [#3939] Enforce the configured batch-size cap on a bulk write route.
     * Returns `true` when a response was sent (the caller must return).
     *
     * The cap was declared in three places in `batch.zod.ts` (`.max(200)` on
     * `BatchUpdateRequestSchema` / `UpdateManyRequestSchema` /
     * `DeleteManyRequestSchema`, plus "max 200" in the docs) and enforced in
     * exactly one route — the cross-object `/batch`, which checked the
     * CONFIGURED `maxBatchSize` rather than the hardcoded 200. Every per-object
     * bulk route accepted an unbounded list.
     *
     * That went from nuisance to real with #3897: `deleteMany` now deletes per
     * id by primary key (so `deleteBehavior` cascades run and each row gets its
     * own result), which turns a 10k-id body into 10k sequential engine
     * round-trips inside one request instead of one statement.
     *
     * The cap is `RestServerConfig.batch.maxBatchSize` (1..1000, default 200),
     * so it lives here and the schemas carry shape only: one place decides it,
     * and it is the place that holds the constructed config.
     *
     * Reachability: EMBEDDER-ONLY (#15543, #16801). ⛔ It is NOT deployment
     * policy — this docblock said exactly that until #16801, and no shipped
     * boot path makes it true. A `RestServerConfig` is the ARGUMENT a host
     * passes when it constructs the server, and there is exactly ONE door:
     * `createRestApiPlugin({ api })` (`packages/rest/src/rest-api-plugin.ts`),
     * whose `start()` is the only non-test site that reaches
     * `new RestServer(...)`. Neither shipped boot path opens it with a `batch`
     * config — `os serve` (`packages/cli/src/commands/serve.ts`) forwards
     * exactly two keys out of the stack config's `api:` block
     * (`api.enableProjectScoping`, `api.projectResolution`), and the dev plugin
     * (`packages/plugins/plugin-dev/src/dev-plugin.ts`) calls
     * `createRestApiPlugin()` with no config at all. ⇒ A CLI-started
     * deployment always gets the schema default of 200, and no flag, config
     * file or CLI option moves it.
     *
     * This is the recorded posture, not a gap awaiting a fix, and it is written
     * the same way on the spec side — the `BatchEndpointsConfigSchema` docblock
     * and the WHO CAN WRITE THIS CONFIG header in
     * `packages/spec/src/api/rest-server.zod.ts`, plus the per-key REACHABILITY
     * row in `packages/spec/liveness/batch_endpoints.json`. Keep the two
     * wordings together: threading a `batch` config through a boot path would
     * be a NEW authorable key, which the spec-side siblings were denied for
     * want of measured demand, so reversing that is its own decision and
     * ⛔ not a docblock's to take.
     */
    private enforceBatchSize(res: any, count: number, max: number, object?: string): boolean {
        if (count <= max) return false;
        res.status(400).json({
            error: `Batch too large: ${count} records (max ${max})`,
            code: 'BATCH_TOO_LARGE',
            count,
            max,
            ...(object ? { object } : {}),
        });
        return true;
    }

    /**
     * [#3544] Enforce the USER-LEVEL export axis on a bulk-egress route, after
     * {@link enforceApiAccess} has cleared the object-level one. Returns `true`
     * when a response was sent (the caller must return).
     *
     * The two gates answer different questions and so carry different statuses:
     * `enforceApiAccess` is about the OBJECT ("does this object expose export at
     * all" → 405), this one is about the CALLER ("may YOU export it" → 403).
     *
     * It has to exist as its own check because `export ⊆ list`: the export route
     * streams through `findData`, which the engine middleware sees as a plain
     * `find` and gates on `allowRead`. Nothing downstream ever looks at
     * `allowExport`, so without this the bit would only hide the client's Export
     * button while `curl` still drained the table — declared, not enforced
     * (AGENTS.md Prime Directive #10).
     *
     * Fail stance mirrors the deployment's own posture. No security service (no
     * `plugin-security`, so no permission sets exist anywhere) → allow, matching
     * every other permission gate here and `/me/permissions`' documented
     * fail-open. Service PRESENT but unable to answer → fail CLOSED: it resolves
     * permission sets to decide, and a resolution failure must never read as a
     * grant (ADR-0049).
     */
    private async enforceExportPermission(
        req: any,
        res: any,
        environmentId: string | undefined,
        objectName: string,
        context: any,
    ): Promise<boolean> {
        const security = await this.resolveSecurityService(environmentId, req);
        if (!security || typeof security.canExport !== 'function') return false;
        let allowed: boolean;
        try {
            allowed = await security.canExport(objectName, context);
        } catch {
            allowed = false; // access-narrowing answer → a throw is a denial
        }
        if (allowed) return false;
        res.status(403).json({
            code: 'EXPORT_NOT_PERMITTED',
            error: `Export is not permitted on object '${objectName}' for this user`,
            object: objectName,
        });
        return true;
    }

    /**
     * [#20896] The gates `GET …/export?template=true` answers behind: the IMPORT
     * door's, never the export's. Returns `true` when a response was sent (the
     * caller must return).
     *
     * A template carries no records — the columns this caller may write, one
     * example row of placeholder values and an instructions sheet — so the
     * export axis, which segregates a bulk copy of DATA, has nothing to guard
     * on it. It belongs to the import it is filled in for: whoever may import
     * may download it, and nobody else (ruling A on #20896).
     *
     *  1. The OBJECT half is the import door's own first gate, the same call
     *     `POST …/import` makes before it parses a file:
     *     {@link enforceApiAccess} for `import`, which the spec derives as
     *     `create ∨ update` (404 when the object is not exposed, 405 when it
     *     exposes neither). Its second, precise gate is not asked: that one
     *     needs the write mode a request body names, and a template request
     *     names none. Nor does a mode shape the template — its columns are
     *     `templateColumns` over the security service's `getWritableFields`,
     *     which takes no operation.
     *  2. The CALLER half is the create permission — the verdict the engine's
     *     security middleware reaches on every row the import door writes, and
     *     answers there as a `PERMISSION_DENIED` row. The import door never
     *     asks it before a write; this door writes nothing, so it asks the
     *     security service for that same verdict: `explain` for `create`, the
     *     contract's own "would the middleware allow this operation?" bottom
     *     line, computed by the enforcement walk rather than re-derived here
     *     from permission sets.
     *
     * Fail stance, as {@link enforceExportPermission}'s: no security service,
     * or one without `explain`, → allow (no permission sets exist to deny
     * with); `explain` throwing → deny, never read as a grant. One direction is
     * stricter than a write: `explain` denies a caller whose permission sets
     * resolve EMPTY, where the middleware skips its CRUD gate — reachable only
     * on a deployment that configures no baseline set at all, and in the closed
     * direction.
     */
    private async enforceImportTemplateGates(
        req: any,
        res: any,
        p: RestProtocol,
        environmentId: string | undefined,
        objectName: string,
        context: any,
    ): Promise<boolean> {
        if (await this.enforceApiAccess(req, res, p, environmentId, 'import', context)) return true;
        const security = await this.resolveSecurityService(environmentId, req);
        if (!security || typeof security.explain !== 'function') return false;
        let allowed: boolean;
        try {
            const decision = await security.explain({ object: objectName, operation: 'create' }, context);
            allowed = decision?.allowed === true;
        } catch {
            allowed = false; // access-narrowing answer → a throw is a denial
        }
        if (allowed) return false;
        // Built through the SHARED envelope (`{ success: false, error: { code,
        // message, details } }`), not in the flat sibling-`code` dialect the
        // export gate above still answers in — `check:route-envelope` ratchets
        // that dialect down and refuses a new body in it.
        sendEnvelopeError(
            res, 403, 'PERMISSION_DENIED',
            `Creating records on object '${objectName}' is not permitted for this user, `
                + 'so its import template is not served',
            { details: { object: objectName } },
        );
        return true;
    }

    /**
     * The ONE object the API-exposure gate judges for `name`, or `undefined`
     * when no object is behind it — `loadObjectItem` in
     * `./meta-item-read-gate.ts` (fail OPEN and logged, #3545), over this
     * protocol's by-name read where it has one ({@link objectItemReader}),
     * else its list read.
     *
     * [#27899] The one read of every data door's exposure gate:
     * `enforceApiAccess` asks it for the route's `:object`, the cross-object
     * batch route for each op's object. The by-name read resolves a legacy
     * `ns__short` object from its short name as the data door's
     * `registry.getObject` does, so both doors judge the object the data call
     * then serves; the batch route used to key the object LIST by declared
     * name instead, and the list carries no such resolution.
     */
    private async loadObjectItem(
        p: RestProtocol,
        environmentId: string | undefined,
        name: string,
    ): Promise<any | undefined> {
        const listSource = this.metaListSource(p, environmentId);
        const getObjectItem = this.objectItemReader(p, environmentId);
        return metaReadGate.loadObjectItem(
            getObjectItem ? { ...listSource, getObjectItem } : listSource,
            name,
        );
    }

    /**
     * Resolve the request's execution context (RBAC/RLS/FLS) by looking up
     * the better-auth session via the project's `auth` service. Returns
     * `undefined` for anonymous requests so callers can pass `context` as-is
     * to the protocol layer (the SecurityPlugin treats undefined as anon).
     */
    private async resolveExecCtx(environmentId: string | undefined, req: any): Promise<any | undefined> {
        // Request-scoped memoization — see `execCtxMemo`. The same `req` flows
        // unchanged through every handler call, so its identity keys the memo;
        // the input `environmentId` is part of the key because one host can route
        // multiple environments. Anonymous (`undefined`) resolutions are cached
        // too so repeat callers don't re-run getSession. Fall back to a direct
        // resolve when there is no object to key on.
        if (!req || typeof req !== 'object') return this.computeExecCtx(environmentId, req);
        const key = environmentId ?? '\u0000default';
        let perReq = this.execCtxMemo.get(req);
        if (!perReq) { perReq = new Map(); this.execCtxMemo.set(req, perReq); }
        const cached = perReq.get(key);
        if (cached) return cached;
        const pending = this.computeExecCtx(environmentId, req);
        perReq.set(key, pending);
        return pending;
    }

    /**
     * [#7033 / #7023] Resolve a caller's execution context for a DIRECT-MOUNT
     * package route (`@objectstack/rest`'s `registerPackageRoutes`), which does
     * not run inside a `registerXxxEndpoints` handler and so cannot reach the
     * private {@link resolveExecCtx} on its own. The package gate reads the
     * SAME identity/RBAC resolution the `/meta` REST gate does — never a second
     * source — so the two capability cohorts cannot drift. `environmentId` comes
     * from the scoped route param (`/environments/:environmentId/packages`) when
     * present, `undefined` for the unscoped mount.
     *
     * ## [#12537] What the `.catch(() => undefined)` below MEANS downstream
     *
     * The swallow used to be undocumented at both of this door's swallow sites
     * — the nearby prose explained why the wrapper exists and what an ABSENT
     * resolver means, never what a FAILING one means. Measured rather than
     * inferred, every claim below carrying a same-shaped positive control, in
     * `package-door-execctx-fault-reading.test.ts`:
     *
     *  - The packages gate (`package-routes.ts`) reads `undefined` as the
     *    ANONYMOUS SUBJECT — it touches the context through optional chaining
     *    only, so an absent context is a subject whose every field is absent,
     *    not a branch. On every wire-reachable method the anonymous floor
     *    decides and REFUSES (401 `UNAUTHENTICATED`); with that floor isolated,
     *    the capability clause reads the same `undefined` as a subject holding
     *    the EMPTY capability set and refuses again (403 `FORBIDDEN`).
     *    ⇒ neither a SKIPPED evaluation nor a fall-through to a DEFAULT or
     *    SYSTEM subject — both of which would answer 200. The swallow fails
     *    CLOSED; ⛔ it is not a permission-adjacent fail-open.
     *  - ⭐ This `.catch` is the SECOND net, not the first. {@link computeExecCtx}
     *    wraps its whole body in `try { … } catch { return undefined; }`, so a
     *    production resolve RESOLVES with `undefined` on a fault instead of
     *    rejecting — this `.catch` has nothing to catch on that path, and the
     *    fault-to-anonymous conversion happens one level down.
     *  - What the swallow costs is DIAGNOSABILITY, not permission: a faulting
     *    resolver, an unwired resolver and a genuinely anonymous caller are ONE
     *    answer, byte-identical on the wire.
     *
     * ⛔ Whether any of that should CHANGE is not settled here — un-swallowing
     * was explicitly not ruled (#12537, 2026-08-29). This records the reading
     * so the next reader inherits a measurement instead of an argument.
     */
    resolvePackageRouteExecutionContext(req: any): Promise<any | undefined> {
        const environmentId = req?.params?.environmentId ?? undefined;
        return this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
    }

    /**
     * [#7749] The acting identity recorded on a metadata WRITE — the single
     * producer for every `/meta` route that stamps an `actor` (save, delete,
     * publish, rollback, compound save, and — since #23068, which retired the
     * route-name label it stamped inline — `POST /_migrate-stored`).
     *
     * ## What was wrong
     *
     * All five sites resolved the actor inline as
     *
     * ```
     * req.headers['x-actor'] ?? req.headers['X-Actor'] ?? req.user?.id ?? req.userId
     * ```
     *
     * and NOTHING on this transport ever sets `req.user` or `req.userId` —
     * this server resolves identity through {@link resolveExecCtx} (better-auth
     * → `resolveAuthzContext`), which puts it on the returned ExecutionContext,
     * never back onto the raw request. So a bearer-authenticated admin's PUT
     * yielded `undefined`, and the protocol's own defaults took over: the audit
     * row recorded the sentinel `'system'` (`recordMetadataAudit`:
     * `actor ?? 'system'`) and the history row recorded `NULL` (#4556:
     * `actor ?? null`). The trail could not answer "who changed this" for any
     * client that did not know to hand-set a non-standard header.
     *
     * The two dead limbs are not widened here with a third — that would leave
     * the same "a value everything reads and nothing writes" shape one level
     * down. They are replaced by the identity resolution this server actually
     * performs, the SAME one the route's own `manage_metadata` capability gate
     * reads a few lines earlier, so the caller a write is ATTRIBUTED to can
     * never drift from the caller it was AUTHORIZED against. `resolveExecCtx`
     * is memoized per request, so the three routes that already resolved a
     * context for their gate pay nothing extra for this.
     *
     * ## Precedence — ruled on #7941: the authenticated identity wins
     *
     * `X-Actor` used to outrank the authenticated identity, as the expression
     * above read. That ordering was masked while the other limbs were always
     * `undefined`; fixing the producer made it load-bearing, and it meant any
     * caller already holding `manage_metadata` could sign somebody else's name
     * to a metadata write — `sys_metadata_audit.actor` and
     * `sys_metadata_history.recorded_by` would name that other person.
     *
     * Maintainer ruling (2026-08-12, re-confirmed 2026-08-15), premised on a
     * consumer census coming back empty: **the header limb is removed, not
     * reordered.** The recorded actor is the identity the request was actually
     * authorized as — the SAME `resolveExecCtx` the route's own
     * `manage_metadata` gate reads a few lines earlier — so attribution can
     * never drift from authorization, and the audit trail answers "who changed
     * this" rather than "who claimed to".
     *
     * The census (`objectstack` + `objectui`, all paths) found no caller that
     * sets the header: `objectui`'s `MetadataClient` can send it via an
     * optional `options.actor`, but nothing in that repo ever passes one. So
     * the ruling's conditional carve-out — keep honouring the header for
     * genuine machine/system callers that have no authenticated user — is
     * deliberately NOT taken: the census did not show that shape exists, and a
     * limb nothing produces is the "declared but never written" shape
     * Prime Directive #10 exists to keep out. A delegation path, if one is ever
     * genuinely needed, is option C on #7941 (an explicit impersonation
     * capability), not an ambient header.
     *
     * Note this does not disturb the platform's REAL impersonation: that is
     * session-level (better-auth admin plugin, `sys_session.impersonated_by`),
     * so `resolveExecCtx` already resolves to the impersonated user and an
     * impersonated metadata write is still attributed to them.
     *
     * Anonymous / internal writes are unaffected: no resolved principal → no
     * context → `undefined` → the protocol's `'system'` / `NULL` defaults still
     * apply. A machine write is never stamped with a real user.
     */
    private async resolveMetaWriteActor(
        environmentId: string | undefined,
        req: any,
    ): Promise<string | undefined> {
        // [#7941] No header limb, by ruling. `X-Actor` on the request is
        // ignored outright — it is not consulted for user principals, and not
        // as a fallback for unauthenticated ones either, so there is no shape
        // in which a caller can choose the name the audit row records.
        const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
        const userId = (ctx as any)?.userId;
        return typeof userId === 'string' && userId ? userId : undefined;
    }

    /**
     * Canonical SINGULAR form of the `:type` path segment.
     *
     * The metadata routes accept either spelling — the protocol's `getMetaItems`
     * normalizes singular↔plural and serves both — and Prime Directive #3 makes
     * PLURAL the canonical REST spelling (`/api/v1/meta/books`). So every gate
     * keyed on the type must compare against the normalized form. The three
     * ADR-0046 §6.7 audience gates below each tested `req.params.type === 'book'`
     * literally, which meant `GET /meta/books` served the list with the gate
     * never running: a `{ permissionSet }`-gated book (an *Admin Guide*) came
     * back to a caller who does not hold the set, and an `org` book came back to
     * an anonymous reader on a publicly-served deployment. Same route, gate
     * enforced on one spelling of it.
     *
     * Calling this at each gate is NOT the durable form — commit 83a3b1f2e proved it.
     * Eight days after #3984, the single-item read's cache-branch condition
     * still excluded `doc`/`book` by literal comparison, so the plural read
     * skipped the branch that holds the gate and the same authorization hole
     * came back on the same route. The handlers therefore normalize ONCE at
     * the top (`const metaType = RestServer.metaTypeSingular(req.params.type)`)
     * and every gate reads that local: a gate added later has no raw param in
     * scope to compare against.
     */
    private static metaTypeSingular(type: unknown): string {
        const t = typeof type === 'string' ? type : '';
        return PLURAL_TO_SINGULAR[t] ?? t;
    }

    /**
     * [#9488] Refuse a `GET /meta/:type` LIST whose `:type` segment names no
     * metadata type — `refuseUnknownMetaListType` in `./meta-item-read-gate.ts`,
     * whose docblock carries the rule: the union of the static spelling contract
     * and the live type set, fail-open on an unreadable listing, and a THROWN
     * refusal so the route's `handleRouteError` shapes it. [#20408] Moved there,
     * unchanged, so the runtime dispatcher's `/meta` list refuses the same
     * segments instead of listing an empty collection.
     */
    private async refuseUnknownMetaListType(p: any, urlType: unknown): Promise<void> {
        return metaReadGate.refuseUnknownMetaListType(p, urlType);
    }

    /**
     * [#3963] Is this request a READ of the audience-gated book/doc surface —
     * the one metadata surface whose own declaration (`book.audience`) can
     * authorize an anonymous caller?
     *
     * Used by the `/meta` umbrella gate to grant an anonymous caller
     * REACHABILITY of these three routes, so `audience: 'public'` works on a
     * secure-by-default deployment instead of only on one that opened its whole
     * data plane. Authorization stays with the handler's §6.7 gate, which admits
     * `'public'` only.
     *
     * The predicate is keyed on the REGISTERED route path plus the normalized
     * `:type` param — not on `req.path` string-matching — so a route added later
     * cannot accidentally fall inside it, and the plural spelling cannot fall
     * outside it (#3984).
     *
     * [#20320] The decision is `isPublicAudienceRead` in
     * `./meta-item-read-gate.ts`, the ONE predicate the runtime dispatcher's
     * `/meta` anonymous gate asks too; this method only names which of those
     * route shapes the registered path is.
     */
    private static isPublicAudienceRead(
        entry: Readonly<Record<string, unknown>>,
        req: { method?: unknown; params?: Record<string, unknown> },
    ): boolean {
        const path = typeof entry?.path === 'string' ? entry.path : '';
        return metaReadGate.isPublicAudienceRead(
            req?.method ?? entry?.method,
            // `GET /meta/book/:name/tree` — the type segment is literal there.
            path.endsWith('/book/:name/tree') ? 'book-tree'
                : /\/:type\/:name$/.test(path) ? 'item'
                    : /\/:type$/.test(path) ? 'list'
                        : undefined,
            req?.params?.type,
        );
    }

    /** Heavy path behind `resolveExecCtx` — resolve identity + RBAC/RLS + localization. */
    private async computeExecCtx(environmentId: string | undefined, req: any): Promise<any | undefined> {
        try {
            // For multi-tenant hosts (objectos), incoming requests on unscoped
            // URLs like `/api/v1/data/:object` arrive with `environmentId === undefined`.
            // Resolve through the shared entry point (D11④) so getSession()
            // finds the right per-project auth service — the same answer the
            // route's protocol resolver got. Without this, hostname-routed
            // requests fall through to defaultEnvironmentIdProvider/
            // authServiceProvider (neither of which is wired in objectos) and
            // every authenticated user sees 401.
            environmentId = await this.resolveRequestEnvironmentId(environmentId, req);
            // Look up the auth service in the right kernel. For unscoped
            // single-environment apps the kernelManager will hand us the lone
            // tenant kernel; for multi-environment hosts we use the resolved
            // environmentId.
            let authService: any;
            let kernel: any;
            // [commit cc837dbfe] WHICH environment's auth service actually validated this
            // caller — the fact an ownership check needs and the one this method
            // used to compute and drop. Three branches below can answer, and the
            // SECOND of them answers for a DIFFERENT environment than the one the
            // request resolved to; see `enforceEnvironmentOwnership`.
            let authEnvironmentId: string | undefined;
            if (environmentId && environmentId !== 'platform' && this.kernelManager) {
                kernel = await this.kernelManager.getOrCreate(environmentId);
                authService = await seamOrUndefined(() => kernel.getServiceAsync('auth'));
                if (authService) authEnvironmentId = environmentId;
            }
            if (!authService && this.defaultEnvironmentIdProvider && this.kernelManager) {
                try {
                    const def = this.defaultEnvironmentIdProvider();
                    if (def) {
                        kernel = await this.kernelManager.getOrCreate(def);
                        authService = await seamOrUndefined(() => kernel.getServiceAsync('auth'));
                        // ⚠️ The CROSS-ENVIRONMENT branch. The request resolved to
                        // `environmentId`, but the credential is being checked
                        // against `def`'s auth service — so a session minted in the
                        // default environment authenticates a request naming
                        // another one. Recorded truthfully rather than as
                        // `environmentId`; that difference IS the ownership fact.
                        if (authService) authEnvironmentId = def;
                    }
                } catch { /* fall through */ }
            }
            // Single-kernel deployment fallback — no kernelManager, but
            // the plugin wired an `authServiceProvider` that hits the
            // local kernel directly.
            if (!authService && this.authServiceProvider) {
                authService = await seamOrUndefined(() => this.authServiceProvider!(environmentId));
                // The provider is asked FOR this environment and answers for it
                // (`rest-api-plugin` wires it to the lone local kernel), so the
                // credential is anchored where the request resolved.
                if (authService) authEnvironmentId = environmentId;
            }
            if (!authService) return undefined;
            // [ruling record 6227928430, letter A] From here to the context is
            // the ONE request-to-ExecutionContext composition
            // (`resolveRequestExecutionContext`, @objectstack/core), called once
            // below with this door's differences as its named parameters. What
            // stays in this method is this door's own: the environment and the
            // auth service above, the headers, the engine and the tenancy wiring
            // below, and what the context carries out of here.
            //
            // The auth service may be the AuthManager wrapper (`getApi()`) or the
            // raw better-auth instance (`.api`); the composition reads either.

            // better-auth's `getSession` requires a Web `Headers` instance
            // (it calls `headers.get('cookie')`). Adapter req.headers may
            // already be one, or a plain object — normalize.
            const rawHeaders: any = req?.headers;
            let headers: any;
            if (rawHeaders && typeof rawHeaders.get === 'function') {
                headers = rawHeaders;
            } else if (rawHeaders && typeof rawHeaders === 'object') {
                headers = new (globalThis as any).Headers();
                for (const [k, v] of Object.entries(rawHeaders)) {
                    if (Array.isArray(v)) v.forEach((x) => headers.append(k, String(x)));
                    else if (v != null) headers.set(k, String(v));
                }
            } else {
                return undefined;
            }

            // Resolve the data engine for this scope (handed to the composition below).
            //
            // [#13476] The PROVIDER branch reaches the seam through
            // `wiredEngineOrLoud`, so "no engine is wired" and "the engine could
            // not be resolved" stop arriving at `resolveAuthzContext` as the same
            // `undefined`. The wiring fact is the provider's PRESENCE — asked
            // here, once — and never inferred from what it returned.
            //
            // ⚠️ The KERNEL branch deliberately still absorbs. Not an oversight
            // and not symmetry for its own sake: `getServiceAsync` rejects the
            // same way for a service that was never registered as for one that
            // failed to construct, so the two facts are not separable at this
            // transport and making it loud would refuse every embedder running a
            // kernel with no data plane. See `wiredEngineOrLoud`'s RESIDUE note.
            const ql: any = kernel
                ? await seamOrUndefined(() => kernel.getServiceAsync('objectql'))
                : await wiredEngineOrLoud(
                    Boolean(this.objectQLProvider),
                    () => this.objectQLProvider!(environmentId),
                );

            // [#8287] The EFFECTIVE tenancy posture, from the kernel's `tenancy`
            // service — the same source plugin-security reconciles for the Layer 0
            // wall, so API-key admission and the wall agree.
            //
            // [#13906 — maintainer ruling 2026-09-02, decision 1 option A] The
            // facts this seam used to answer with one `undefined` are now kept
            // apart. Measured on a real `ObjectKernel` with a healthy `isolated`
            // tenancy and an EX-MEMBER's org-stamped API key, the wiring
            // differing ONLY in the tenancy service's health:
            //
            // | `tenancy` service              | before | after |
            // |:--|:--|:--|
            // | healthy, wall-enforcing        | 401 refused | 401 — unchanged |
            // | never registered (supported)   | 200 served  | 200 — unchanged |
            // | registered and FAILED to build | **200 served** | **503** |
            //
            // ⇒ the direction here was PERMISSIVE, and that is what makes this
            // card's family different from its siblings: a tenancy service that
            // could not be CONSTRUCTED skipped the Layer 0
            // `organization_membership_ended` refusal (and its
            // `organization_required` sibling), so a FAILURE read as "this check
            // does not apply". #13476 and #13904 answered an unknown with a
            // REFUSAL; this one answered it with ADMISSION.
            //
            // The classification is the REGISTRY's, never message text — the
            // same discriminator the shipped `objectQLProvider` already uses one
            // layer down (`isServiceNotRegisteredError`, #13905): "never
            // registered" is branded and stays quiet; every other rejection (a
            // factory that threw, a scoped registration resolved without a scope
            // id, a circular service dependency) is unbranded, and the set is
            // closed with a LOUD default.
            //
            // ⚠️ The WIRING fact is taken from `kernel`'s PRESENCE, asked here
            // once, and never inferred from what the read returned — the #13476
            // discipline. Without that guard the single-kernel provider path
            // (where `kernel` is `undefined`) would raise a `TypeError` from the
            // dereference and every embedder on that wiring would take the loud
            // answer.
            //
            // [#15256 — maintainer ruling 2026-09-04, decision 1A] ⭐ CORRECTED.
            // This paragraph used to end by asserting that the single-kernel
            // path carried no posture at all, and that its half of the #13906
            // ruling (option B′) was handled by a startup refusal over in
            // `rest-api-plugin.ts`. Both halves of that were FALSE on this tree:
            // B′ was WITHDRAWN on 2026-09-04, `rest-api-plugin.ts` never carried
            // such a refusal, and so this file documented a p0 seam as covered
            // when nothing covered it. ⛔ Do not reintroduce a startup refusal
            // here in any form.
            //
            // That sentence is PARAPHRASED above rather than quoted, on purpose:
            // a verbatim copy goes on answering the greps that look for the
            // withdrawn remedy, and it already caused this seam to be re-read as
            // unrepaired once. The pin that forbids the phrase returning lives in
            // `execctx-authz-input-seam-reachability.test.ts`.
            //
            // What is true now: the single-kernel branch below DERIVES the
            // posture, from a provider `rest-api-plugin` wires to the lone local
            // kernel's `tenancy` service — the same way this method already
            // obtains `authService`. Measured consequence of its absence, on this
            // exact wiring under a healthy `isolated` posture, with an API key
            // stamped with an organization its owner had left:
            //
            // | wiring                          | before | after |
            // |:--|:--|:--|
            // | ex-member's org-stamped key     | **GET 200 / POST 201, row lands in the other org** | **401 / 401** |
            // | organization-less key           | **GET 200 total 0 (silent) / POST 403** | **401** |
            // | CURRENT member's key (control)  | 200 / 201 | 200 / 201 — unchanged |
            // | no credential (control)         | 401 | 401 — unchanged |
            //
            // ⚠️ The ASYNC ACCESSOR's presence is part of the wiring fact, for
            // the same reason the shipped `objectQLProvider` splits on it: a
            // `KernelBase`-shaped host (`LiteKernel`) has no `getServiceAsync`
            // at all, so dereferencing it would raise a `TypeError` — unbranded,
            // and therefore LOUD — turning "this host shape has no async
            // registry" into an outage. Such a host also has no service
            // factories (`registerServiceFactory` throws "not supported"), so
            // absence is the only fault it could report anyway. It keeps the
            // previous quiet answer, unchanged.
            //
            // [#16013] The CLASSIFICATION is one shared function, not two
            // hand-written copies: the composition hands the `tenancy` thunk
            // built below to `classifyAdmissionTenancyPosture`, which answers
            // quiet `undefined` for the branded "never registered" (the
            // supported no-tenancy composition, no posture-conditional refusal)
            // and raises `AuthzStoreUnavailableError('tenancy', err)` for every
            // other rejection — the same loud answer `wiredEngineOrLoud` gives
            // the engine seam, carried to the door by the same nets, because
            // the posture is an authorization INPUT and admission was never
            // decided. ⛔ The WIRING branch is NOT shared and must not become
            // so: which of the two wirings may be asked is this file's fact
            // alone, for the reason spelled out in the `else if` below. No
            // wiring here, no thunk: the composition then reads no posture.
            let tenancy: TenancyServiceResolver | undefined;
            if (kernel && typeof kernel.getServiceAsync === 'function') {
                tenancy = () => kernel.getServiceAsync('tenancy') as any;
            } else if (this.tenancyServiceProvider) {
                // [#15256 / 1A] The SINGLE-KERNEL branch — the wiring every
                // deployment the open core builds actually runs, and the one
                // that carried no posture at all. Reached only when no `kernel`
                // was bound above, exactly as `authServiceProvider` is: the
                // kernelManager branches already read the per-environment
                // kernel's own `tenancy` service, and asking twice would let a
                // provider bound to the LOCAL kernel answer for a request that
                // resolved to another environment.
                //
                // Same classification as the branch above, and it is the whole
                // reason this is not `seamOrUndefined`: decision 1 option A
                // governs BOTH halves of this seam, so "never registered" stays
                // quiet (the supported no-tenancy composition) and every other
                // rejection is the outage it is. The provider re-raises
                // unbranded rejections for precisely that reason — see
                // `rest-api-plugin.ts`.
                tenancy = () => this.tenancyServiceProvider!(environmentId) as any;
            }
            // [#23287, ruling C′ item 3 · #23367] The auth service's per-user
            // posture computation and its API-key lifecycle policy reach the
            // shared resolver from `authService` itself, inside the composition:
            // ONE judgment for every face, this one included. Identity, the
            // role/permission/RLS aggregation, the localization and the envelope
            // are the composition's; each parameter below is this door's answer
            // from before the composition existed (its docblock tables them).
            let admittedBy: 'api_key' | 'session' | undefined;
            const base = await resolveRequestExecutionContext({
                headers,
                ql,
                authService,
                tenancy,
                // [commit f586f1a89] The FAIL-CLOSED default entry: no resolved
                // principal → no context → `enforceAuth` answers 401. The runtime
                // face takes the guest entry; the divergence is named API, not
                // drift. An anonymous request reads no localization and no gate.
                anonymous: 'fail-closed',
                // ADR-0069 — this face CARRIES the gate, and its consumer is
                // `enforceAuth` (403 `{ code, message }`). [#23287] A key is judged
                // by its owner's posture, decided at the shared key-admission
                // seam, whatever cookie rides beside it; the request's own session
                // is read again only while a gate feature is active (a cheap sync
                // probe, zero cost when off). [#13906 — maintainer ruling
                // 2026-09-02, decision 2 option B] fails closed in exactly one
                // window:
                //
                // | gate wiring                         | answer |
                // |:--|:--|
                // | INACTIVE (the common, correct case) | admitted |
                // | ACTIVE, healthy re-read, gated user | 403 code + message |
                // | `isAuthGateActive()` THROWS         | admitted: a probe that faults never declared a gate |
                // | ACTIVE, re-read FAILS               | 503: a declared enforcement never vanishes silently |
                authGate: 'reread-when-active',
                credentials: 'api-key-and-session',
                // Without a session read this door authenticates nobody, the
                // API-key door included.
                sessionApi: 'required',
                // [#22258] The request's own session, under the in-process read
                // rule: this request answers with its OWN response, so a request
                // carrying a session cookie reads without renewal (only
                // `/get-session`, which re-issues the cookie, renews it).
                session: 'request',
                // The reference localization from this door's settings provider;
                // a provider that throws or rejects reads as no service.
                localization: {
                    settings: () => (this.settingsServiceProvider
                        ? seamOrUndefined(() => this.settingsServiceProvider!(environmentId))
                        : undefined),
                },
                // [#3957] The request's OWN locale wins over the workspace
                // default; the precedence lives in the shared assembler.
                requestLocale: this.extractLocale(req),
                // A NAMED divergence (commit f586f1a89): this transport has never
                // carried the better-auth session bearer, and
                // `ExecutionContext.accessToken` is a PUBLISHED hook surface
                // (`session.accessToken`, hook.zod.ts). Widening it to a second
                // transport is a product decision, not a refactor.
                accessToken: 'withhold',
                // OAuth access tokens are honoured on the `/mcp` door alone
                // (`acceptOAuthAccessToken`), precisely so coarse tool-family
                // scopes cannot ride onto REST — so `principalKind: 'agent'`,
                // `onBehalfOf` and `oauthScopes` are not representable here.
                oauth: undefined,
                // Which credential admitted the caller, kept on THIS request for
                // `enforceApiAccess`'s API-key management rule. The ADR-0069 gate
                // is still enforced off the envelope, at `enforceAuth`.
                onAdmission: (admission) => { admittedBy = admission.credential; },
            });
            if (!base) return undefined;

            const execCtx = {
                ...base,
                // Internal: resolved kernel so the nav-serving path can probe
                // requiresService capability gates (ADR-0057 D10). NOT an
                // authorization input — never read by RLS/permission logic, and
                // NOT an `ExecutionContext` field — hence the cast, which now
                // covers this key and `__authEnvironmentId` below.
                __kernel: kernel,
                // [commit cc837dbfe] Internal: the environment whose auth service actually
                // validated this caller — the left-hand side of the ownership
                // comparison at the UI-view seam and in `enforceAuth`. ⚠️ Unlike
                // `__kernel` this one IS an authorization input, at two readers
                // in this file (`enforceEnvironmentOwnership` and
                // `credentialAnchoredElsewhere`); it is deliberately NOT an
                // `ExecutionContext` field, because it describes how the context
                // was OBTAINED rather than what the principal may do, and nothing
                // downstream of this transport may branch on it.
                __authEnvironmentId: authEnvironmentId,
                // Internal: the environment this request RESOLVED to — the
                // right-hand side of the same comparison, read by
                // `enforceAuth` (`credentialAnchoredElsewhere`) on every route
                // behind it. Same status as `__authEnvironmentId`: not an
                // `ExecutionContext` field, nothing downstream branches on it.
                __environmentId: environmentId,
                // Internal: which credential admitted this caller (`'api_key'` |
                // `'session'`), as the shared resolver told this door through
                // `onAdmission` above. An authorization input at ONE reader,
                // `enforceApiAccess` (managing API keys is a signed-in-session
                // act, `apiKeyManagementCredentialRefusal`); not an
                // `ExecutionContext` field, nothing downstream branches on it.
                __admittedBy: admittedBy,
            } as any;

            // [#2408 / #3361] Open the per-request `Server-Timing` disclosure gate
            // for an admin/service principal — the REST-server analog of the runtime
            // dispatcher's `timedResolveExecutionContext`. This is the SOLE gate-opener
            // on the `os serve`/`dev` data + metadata routes (which the RestServer
            // owns, shadowing the Hono plugin's CRUD): without it the documented
            // admin-gated `X-OS-Debug-Timing` path never emits on the standard server.
            // A no-op when perf-tuning is off or already global (no ambient gate), and
            // the memoized resolve runs once per request so the gate opens exactly once.
            if (isPerfDisclosurePrincipal(execCtx)) allowPerfDisclosure();

            return execCtx;
        } catch (err) {
            // [commit 6a180e42d] The FIRST net, and the one that actually fires: every
            // seam below this resolves with `undefined` rather than rejecting,
            // so a blanket swallow here decides the answer for the whole
            // server. A permission-store OUTAGE must not be laundered into
            // "no context" — that only swaps the 403 disguise for the 401 one
            // (measured: with `tryFind` loud but this net untouched, the
            // package door answered 401, byte-identical to a genuine anonymous
            // caller). Every OTHER fault still fails closed exactly as before.
            //
            // [#23367, ruling A] A key its own lifecycle refused (revoked,
            // expired, inactive) resolves no context too — so every door keeps
            // its fail-closed answer — and is remembered beside the request
            // for `enforceAuth`, which answers its `403` and code.
            if (isApiKeyLifecycleRefusalError(err) && req && typeof req === 'object') {
                this.apiKeyLifecycleRefusals.set(req, err);
                return undefined;
            }
            return rethrowAuthzStoreUnavailable(err);
        }
    }

    /**
     * [#20156 · #20193] THE read gate of one `/meta/:type/:name` document, for
     * the plain read and every door beside it — `createMetaItemReadGate` in
     * `./meta-item-read-gate.ts`, the ONE implementation both transports call
     * (the runtime dispatcher's `/meta` item read asks it too). Its docblock
     * carries the gates, per type, and their history; ⛔ a gate is added
     * there, never here.
     *
     * This transport supplies its I/O ({@link metaItemReadGateSources}) and
     * writes a refusal on its own wire ({@link sendMetaReadRefusal}) — the
     * plain read's refusal, byte for byte, whichever door asked.
     */
    private metaItemReadGate(
        environmentId: string | undefined,
        req: any,
        p: RestProtocol,
        metaType: string,
        name: string,
        documents: readonly any[],
        policy: MetaReadGatePolicy,
    ): (document: any) => Promise<MetaReadVerdict> {
        const judge = metaReadGate.createMetaItemReadGate(
            this.metaItemReadGateSources(environmentId, req, p, policy.app === 'author-exempt'),
            metaType, name, documents, policy,
        );
        return async (document) => {
            const verdict = await judge(document);
            if (verdict.kind === 'serve') return verdict;
            const { refusal } = verdict;
            return { kind: 'refuse', send: (res: any) => RestServer.sendMetaReadRefusal(res, refusal) };
        };
    }

    /**
     * [#20193] Write the shared gate's refusal on THIS transport's wire — the
     * emitters the plain read has always used for each:
     *
     *  - `absent` — {@link sendMetaItemAbsent}, byte-identical to the
     *    nothing-behind-the-name answer (#18066, ADR-0045 §3);
     *  - `app-permission` — the ADR-0112 standard envelope through the shared
     *    `sendError` (`@objectstack/types`), `{ success: false, error: { code,
     *    message } }`, the `body.error.code` objectui#4252 branches on (#8013);
     *  - `audience-permission` — [#22639] a list view's or a dashboard's own
     *    `requiredPermissions`: the app's whole refusal, so the same emitter;
     *  - `docs-audience` — {@link sendDeclaredFault}, `401 UNAUTHENTICATED` /
     *    `403 PERMISSION_DENIED` (ADR-0046 §6.7).
     */
    private static sendMetaReadRefusal(res: any, refusal: MetaItemReadRefusal): void {
        switch (refusal.reason) {
            case 'absent':
                sendMetaItemAbsent(res);
                return;
            case 'app-permission':
            case 'audience-permission':
                sendEnvelopeError(res, refusal.status, refusal.code, refusal.message);
                return;
            case 'docs-audience':
                sendDeclaredFault(res, { code: refusal.code, message: refusal.message, status: refusal.status });
                return;
        }
    }

    /**
     * [#20193] This transport's I/O, as the shared read gate takes it: the
     * caller from {@link resolveExecCtx} (an authz-store outage re-raised,
     * never read as anonymous), the protocol's list read, the security service
     * provider, the service probe, and this instance's prune-log dedupe.
     *
     * `withItemWriteVerdict` — [#20156] the door's policy honours the author
     * exemption, so the caller carries its `mayWriteItem` (see
     * {@link metaReadAudienceSources}).
     *
     * [#7557, #24210] `isItemOfDisabledPackage`, the layered chain's owner
     * step: the plain read serves no `item` and its kept envelope `packageId`
     * is one the engine registry's `isPackageDisabled` answers for, the owner
     * `/published` asks about. The engine is
     * reached through {@link wiredEngineOrLoud}: none wired withholds nothing,
     * as before; one that cannot be resolved is the loud outage, never "not
     * withheld".
     */
    private metaItemReadGateSources(
        environmentId: string | undefined,
        req: any,
        p: RestProtocol,
        withItemWriteVerdict = false,
    ): MetaItemReadGateSources {
        return {
            ...this.metaReadAudienceSources(environmentId, req, withItemWriteVerdict),
            ...this.metaListSource(p, environmentId),
            serviceProbe: (caller) => this.serviceProbeFor((caller as any)?.__kernel),
            navPruneLogged: this.navPruneLogged,
            isItemOfDisabledPackage: async ({ type, name, packageId }) => {
                if (typeof p.getMetaItem !== 'function') return false;
                const ql = await wiredEngineOrLoud(
                    Boolean(this.objectQLProvider),
                    () => this.objectQLProvider!(environmentId),
                );
                const registry = (ql as any)?.registry;
                if (typeof registry?.isPackageDisabled !== 'function') return false;
                const itemRequest: TransportScopedMetaRequest<GetMetaItemRequest> = {
                    type,
                    name,
                    ...(packageId ? { packageId } : {}),
                    ...(environmentId ? { environmentId } : {}),
                };
                const envelope = await p.getMetaItem(itemRequest) as { item?: unknown; packageId?: unknown } | undefined;
                return envelope?.item == null && registry.isPackageDisabled(envelope?.packageId) === true;
            },
        };
    }

    /**
     * [#20193] The caller half of {@link metaItemReadGateSources}.
     *
     * [#20156] `withItemWriteVerdict`: the caller also carries
     * `mayWriteItem`, THIS transport's save-door admission of `:type/:name`
     * ({@link metaSaveVerdict}, the one spelling `PUT /meta/:type/:name`
     * asks), for a door whose policy honours ruling 5856774816's author
     * exemption. Only there: a pure verdict over the context this read has
     * already resolved (memoised per request) and the static type registry, so
     * it costs no read — but a door that does not honour it is not handed one.
     * The context is COPIED, never written: the same memoised object serves
     * every other consumer of this request.
     */
    private metaReadAudienceSources(
        environmentId: string | undefined,
        req: any,
        withItemWriteVerdict = false,
    ): MetaReadGateAudienceSources {
        let withVerdict: MetaReadGateCaller | undefined;
        return {
            resolveCaller: async () => {
                const caller = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                if (!withItemWriteVerdict || !caller) return caller;
                return (withVerdict ??= {
                    ...caller,
                    mayWriteItem: RestServer.metaSaveVerdict(caller).allowed,
                });
            },
            resolveSecurityService: async () => (
                this.securityServiceProvider ? this.securityServiceProvider(environmentId) : undefined
            ),
        };
    }

    /**
     * [#20193] The list half of {@link metaItemReadGateSources}: one
     * `getMetaItems` read of a whole type, env-scoped, `undefined` when this
     * protocol has no list read at all.
     *
     * [#25783] The `object` list on the protocol's EXECUTION face where it has
     * one: its readers — the nav-servability gate on `/meta/app` and the
     * by-name exposure gate's list fallback — read each object's `enable` and
     * serve none of it, and the served face diagnosed
     * every object of the registry on every such request (a full schema
     * `safeParse` each). Same sources, merge and governance either way; the
     * `book` and `doc` lists stay on the served face, unchanged.
     */
    private metaListSource(p: RestProtocol, environmentId: string | undefined): MetaReadGateListSource {
        return {
            listMetaItems: (type) => {
                const listRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                    type,
                    ...(environmentId ? { environmentId } : {}),
                };
                if (type === 'object' && typeof p.getMetaItemsForExecution === 'function') {
                    return p.getMetaItemsForExecution(listRequest);
                }
                return p.getMetaItems?.(listRequest);
            },
        };
    }

    /**
     * [#20156] The CURRENT document of `:type/:name`, fetched the way the plain
     * read's uncached arm fetches it — same request shape, environment → code
     * (ADR-0131 D6: no organization) — for a door that
     * serves no document of its own (`/history` and `/audit` serve events,
     * `/diff` a comparison) and so judges the item the plain read would judge.
     * `undefined` when nothing is behind the name.
     *
     * [#23183] …by NAME. These doors read their own data (events, the diff)
     * under the literal `:name`, so the document they judge is that name's.
     * The app item read's package-id key (ADR-0048 §3.1,
     * `GetMetaItemRequestSchema.name`) is the plain read's arm, not theirs: the
     * protocol would answer it with the package's app under the APP's name,
     * which is not the item these doors read. Such a key is answered as no
     * current document, exactly as it was before the arm existed: no app name
     * is in the package-id grammar, so nothing is stored under it.
     *
     * [#7557, #24210] …and THROWS the plain read's absence (`404
     * RESOURCE_NOT_FOUND`) when the plain read withholds an item that is
     * there: a disabled package's item, which the by-name read answers as
     * absent while its layers still resolve. Answered as no current document,
     * it took these doors past their per-caller gate (events served ungated, a
     * view's or dashboard's diff served ungated). The layered read, which keeps
     * serving every layer, tells it apart from a deleted item, whose layers are
     * all null: that one keeps its answer, `undefined`.
     */
    private async fetchCurrentMetaDocument(
        req: any,
        p: RestProtocol,
    ): Promise<any | undefined> {
        if (isAppPackageIdKey(RestServer.metaTypeSingular(req.params.type), req.params.name)) return undefined;
        const currentRequest: GetMetaItemRequest = {
            type: req.params.type,
            name: req.params.name,
        };
        const envelope = await p.getMetaItem(currentRequest) as Record<string, any>;
        const current = envelope?.item ?? undefined;
        if (current !== undefined || typeof (p as any).getMetaItemLayered !== 'function') return current;
        const layered = await (p as any).getMetaItemLayered(currentRequest);
        if (layered?.effective != null) {
            throw Object.assign(new Error('Metadata item not found or access denied.'), {
                code: 'RESOURCE_NOT_FOUND',
                status: 404,
            });
        }
        return undefined;
    }

    /**
     * [#20156] The refusal an EVENT door (`/history`, `/audit`) owes: the plain
     * read's, when the plain read would refuse this caller the item whole.
     * Events carry no body, so there is nothing to prune — a caller the plain
     * read serves (whole or in part) is served the events, and an item with no
     * current document has no gate to answer (its events are served as before).
     *
     * Only the types {@link metaItemReadGate} judges per caller are fetched at
     * all, so every other type's door is untouched: no extra read, no new
     * failure mode. Answers the refusal to send, or `undefined` to go on.
     *
     * [#7557, #24210] A withheld item's absence (a disabled package's item,
     * which {@link fetchCurrentMetaDocument} throws) is answered in the plain
     * read's own body, {@link sendMetaItemAbsent}, recognised as the plain
     * read's catch recognises it ({@link thrownAnswerIsBareNotFound}), not in
     * the classification door's flat one.
     */
    private async eventDoorRefusal(
        environmentId: string | undefined,
        req: any,
        p: RestProtocol,
    ): Promise<((res: any) => void) | undefined> {
        const metaType = RestServer.metaTypeSingular(req.params.type);
        const policy: MetaReadGatePolicy = { arms: 'per-caller', app: 'gate' };
        if (!RestServer.gatesPerCaller(metaType)) return undefined;
        let current: any;
        try {
            current = await this.fetchCurrentMetaDocument(req, p);
        } catch (error: any) {
            if (thrownAnswerIsBareNotFound(error)) return sendMetaItemAbsent;
            throw error;
        }
        if (current == null) return undefined;
        const verdict = await this.metaItemReadGate(
            environmentId, req, p, metaType, req.params.name, [current], policy,
        )(current);
        return verdict.kind === 'refuse' ? verdict.send : undefined;
    }

    /**
     * [#20156] The two versions a `diffMetaItem` answer compares, rebuilt over
     * the CURRENT document so {@link metaItemReadGate} can judge each side.
     *
     * The answer is top-level (`diffShallow`): every key that differs arrives
     * with its whole value on the side(s) that carry it — `added` on `to`,
     * `removed` on `from`, `changed` on both — and every key it does NOT report
     * is equal on the two sides. Those are taken from the current document,
     * which is exact whenever `to` is the current version (the default), and
     * otherwise the plain read's own inputs: a gate input a version shares with
     * the other side is judged at its current value. A diff discloses both
     * sides, so both are judged, and the current document beside them.
     */
    private static diffSides(
        current: Record<string, any>,
        diff: any,
    ): { from: Record<string, any>; to: Record<string, any> } {
        const from: Record<string, any> = { ...current };
        const to: Record<string, any> = { ...current };
        const entries = (bucket: unknown): any[] => (Array.isArray(bucket) ? bucket : []);
        for (const e of entries(diff?.added)) { if (typeof e?.path === 'string') { to[e.path] = e.value; delete from[e.path]; } }
        for (const e of entries(diff?.removed)) { if (typeof e?.path === 'string') { from[e.path] = e.value; delete to[e.path]; } }
        for (const e of entries(diff?.changed)) { if (typeof e?.path === 'string') { from[e.path] = e.from; to[e.path] = e.to; } }
        return { from, to };
    }

    /**
     * [#20156] A `diffMetaItem` answer whose EMITTED values are read off the
     * two sides as {@link metaItemReadGate} served them ({@link diffSides}
     * rebuilt, then judged): `added` from `to`, `removed` from `from`,
     * `changed` from both. For a side the gate serves as given this is the
     * answer unchanged; for an app side it serves pruned (ruling 5856774816:
     * a caller who may open the app but not write it), the entries the plain
     * read withholds from that caller leave with neither value.
     *
     * The comparison stays the protocol's, over the stored bodies, and no
     * entry is added or dropped — only values are substituted. That is the
     * redaction precedent one frame down (`diffMetaItem`: diff raw, emit the
     * projected values, ruling 5299845282 option B) and the ADR-0106 mask
     * beside this call, so the three projections of one answer agree on its
     * shape.
     */
    private static diffEmittedFrom(
        diff: any,
        from: Record<string, any>,
        to: Record<string, any>,
    ): any {
        if (!diff || typeof diff !== 'object') return diff;
        const emit = (bucket: unknown, project: (e: any) => any): unknown => (Array.isArray(bucket)
            ? bucket.map((e) => (typeof e?.path === 'string' ? project(e) : e))
            : bucket);
        return {
            ...diff,
            ...('added' in diff ? { added: emit(diff.added, (e) => ({ ...e, value: to[e.path] })) } : {}),
            ...('removed' in diff ? { removed: emit(diff.removed, (e) => ({ ...e, value: from[e.path] })) } : {}),
            ...('changed' in diff
                ? { changed: emit(diff.changed, (e) => ({ ...e, from: from[e.path], to: to[e.path] })) }
                : {}),
        };
    }

    /**
     * [#20156] Does {@link metaItemReadGate} judge this type per caller? The
     * question a door serving no document of its own asks before it fetches the
     * current one — a type the answer is no for costs that door no extra read
     * and no new failure mode. `app` always is: an app the plain read refuses
     * WHOLE is refused on every door, to an author as to anyone (ruling
     * 5856774816), and a non-author is served it pruned.
     *
     * [#22639] So are `view` and `dashboard`, for the same reason: a list view
     * or a dashboard whose own `requiredPermissions` the caller does not all
     * hold is refused whole on every door, author or not, and a view
     * container is served pruned. (A dashboard's widget gate still answers per
     * deployment and stays off these doors.) `object` is not here: its
     * per-caller arm never refuses, and every door this question serves is an
     * authoring door, open only to callers ADR-0106 D4 serves the schema whole.
     */
    private static gatesPerCaller(metaType: string): boolean {
        return metaType === 'book' || metaType === 'doc' || metaType === 'app'
            || RestServer.gatesOnItsOwnKey(metaType);
    }

    /**
     * [#22639] The types whose per-caller gate reads nothing but the item's own
     * `requiredPermissions` — a list view and a dashboard (ruling 6095014058,
     * letter A). `/diff` judges them when a current document exists, and with
     * none serves the diff as before, the event doors' rule.
     */
    private static gatesOnItsOwnKey(metaType: string): boolean {
        return metaType === 'view' || metaType === 'dashboard';
    }

    /**
     * [#20156] The policy of the doors that serve STORED versions for authoring
     * — the layered view (`/layers`, `?layers=`), `/diff` and [#20290] the
     * plain read's `?state=draft` branch (the pending draft row, which Studio's
     * designers merge over the layered view and save back). One constant, so
     * they cannot come to disagree about the `app` row.
     *
     * `app: 'author-exempt'` — ruling 5856774816 (letter B, confirmed
     * 5856866273): a caller who may write the app ({@link metaSaveVerdict},
     * carried on the caller as `mayWriteItem`) reads the full stored version,
     * and every other caller who may open the app reads exactly what the plain
     * read gives them, pruned. See `MetaReadGatePolicy.app`.
     *
     * [#20320] The constant itself is `STORED_VERSION_DOOR_POLICY` in
     * `./meta-item-read-gate.ts`, which the runtime dispatcher's `?state=draft`
     * read runs too; this name is kept so every door here reads it unchanged.
     */
    private static readonly STORED_VERSION_DOOR_POLICY: MetaReadGatePolicy = metaReadGate.STORED_VERSION_DOOR_POLICY;

    /**
     * [ADR-0131 D3 · D12 items 7–8] The walled refusal for one `/meta` write:
     * the shared `walledCatalogWriteVerdict` (`@objectstack/metadata-core`),
     * asked by this transport's four item write doors (save, reset, publish,
     * rollback) after {@link metaSaveVerdict}'s capability gate, and by
     * `POST /meta/_migrate-stored` after its own, for every type
     * (ruling A on #23231: the catalog is no longer a special case, so this
     * method no longer pre-filters on it). The posture is read through
     * {@link resolveAnonymousFormTenancy}, the wiring that mirrors
     * `resolveProtocol`, so the posture judged and the protocol that writes
     * always come from the same kernel; a `tenancy` service that is registered
     * and cannot answer raises `AuthzStoreUnavailableError` (the door's 503),
     * never a permit.
     */
    private async walledCatalogRefusal(
        type: string,
        ctx: any,
        environmentId: string | undefined,
        req: any,
    ): Promise<MetaWriteCapabilityVerdict> {
        return walledCatalogWriteVerdict({
            type,
            tenancyPosture: effectiveTenancyPosture(await this.resolveAnonymousFormTenancy(environmentId, req)),
            isSystem: ctx?.isSystem === true,
            callerPosture: ctx?.posture,
        });
    }

    /**
     * [#12702 · #20156] May this caller SAVE `:type/:name`? The admission of
     * `PUT /meta/:type/:name`, spelled ONCE: that door asks it, and so does the
     * stored-version read doors' author exemption (ruling 5856774816, item 1:
     * 「whoever can save it must see it whole, or a save drops entries
     * silently」). A second spelling of the question at the read doors could
     * drift from the door it stands for — an exempt reader the save refuses, or
     * a saver the exemption prunes, which is the silent drop itself.
     *
     * The whole admission is this verdict: the save door refuses on nothing
     * else about the CALLER before `saveMetaItem` (whose own refusals judge the
     * item, the same for every admitted caller). Since ADR-0131 D6 the verdict
     * reads the caller alone: no type and no organization enters it.
     */
    private static metaSaveVerdict(ctx: any): MetaWriteCapabilityVerdict {
        return metaWriteCapabilityVerdict({
            isSystem: ctx?.isSystem === true,
            systemPermissions: ctx?.systemPermissions,
            operation: 'save',
        });
    }

    /**
     * [ADR-0057 D10] This transport's service-existence probe. Prefer the
     * per-request kernel (multi-env, resolved via kernelManager). Fall back to
     * the single-env service-existence provider — in single-kernel deployments
     * resolveExecCtx never sets a kernel, so without this the gate would fail
     * open. `null` when neither can be asked.
     */
    private serviceProbeFor(kernel: any): ((name: string) => Promise<boolean>) | null {
        if (kernel && typeof kernel.getServiceAsync === 'function') {
            return async (name) => { try { return (await kernel.getServiceAsync(name)) != null; } catch { return false; } };
        }
        if (this.serviceExistsProvider) {
            const exists = this.serviceExistsProvider;
            return async (name) => { try { return exists(name) === true; } catch { return false; } };
        }
        return null;
    }

    /**
     * Build a `TranslationBundle` (`Record<locale, TranslationData>`) from an
     * `II18nService` instance. Returns `undefined` when no locales are
     * registered so callers can avoid translation work. [#20320]
     * `translationBundleOf` in `./meta-item-read-gate.ts`, which the runtime
     * dispatcher's list translation asks too.
     */
    private buildTranslationBundle(i18n: any): any | undefined {
        return metaReadGate.translationBundleOf(i18n);
    }

    /**
     * [#8284] The packaged (code-layer) base declaration of an OBJECT, for the
     * localization boundary — `translateObject`'s
     * `TranslateDocumentOptions.packagedBase`.
     *
     * The i18n catalog is keyed by object name and is the packaged translation
     * of the packaged declaration, so it must yield to any scalar that has
     * been authored on top of that declaration: a code-shipped
     * `objectExtensions` label, and the tenant's own Studio rename — which
     * answered `200` and then appeared on neither of the two reads a writable
     * form derives from (maintainer ruling 2026-08-13; the comparison itself
     * lives in `@objectstack/spec/system`, which is where the rule belongs —
     * this method only hands it the value it cannot see).
     *
     * `undefined` on every uncertainty, and that is contractual rather than
     * defensive: the spec-side rule reads absence as "no baseline known" and
     * falls back to the pre-#8284 `catalog ?? document`, so a host whose
     * protocol predates this method (or a partial protocol double) keeps
     * exactly the behaviour it has today instead of losing its translations.
     *
     * Feature-detected because `RestProtocol` is the ADR-0076 D9 wire slice
     * and server-only extensions are detected via runtime casts rather than
     * widening it — the same shape `getMetaItemLayered` is consumed with.
     */
    private packagedObjectBase(p: any, type: string, name: unknown): unknown {
        // [#20320] `packagedObjectBaseOf` in `./meta-item-read-gate.ts`, which
        // the runtime dispatcher's list translation asks too.
        return metaReadGate.packagedObjectBaseOf(p, type, name);
    }

    /**
     * Parse the highest-priority locale from an `Accept-Language` header.
     * Falls back to a `?locale=` query parameter, then to the i18n service's
     * default locale. Returns `undefined` when no preference is expressed
     * (callers will then return untranslated metadata).
     *
     * [#6877] One of the read points that was ALREADY safe: a repeated
     * `?locale=` falls to the i18n default rather than into the array arm.
     * Left as a guard rather than converted to the refusal gate because this
     * helper is shared by ~10 routes and has no `res` — refusing here would
     * need every caller to thread one through, for a parameter whose worst
     * case is falling back to the default locale. Recorded so the asymmetry
     * reads as a decision.
     *
     * [#20320] `metaRequestLocale` in `./meta-item-read-gate.ts`, the one parse
     * the runtime dispatcher's `/meta` list reads its locale with too.
     */
    private extractLocale(req: any, i18n?: any): string | undefined {
        return metaReadGate.metaRequestLocale({ headers: req?.headers, query: req?.query }, i18n);
    }

    /**
     * [#14882] The `ResolveOptions` every metadata-document translation in
     * this server hands `@objectstack/spec/system`: the request's locale, the
     * deployment's DECLARED fallback chain, and [#15711] the deployment's
     * DEFAULT locale. This is the single seam; every resolver call in this
     * file spreads it, so a rule about which locale answers lives in the
     * resolvers (`packages/spec`) and this seam only threads declarations.
     *
     * The resolvers walk `requested locale → fallbackChain → authored label`
     * for a NON-default request, and answer `requested locale → authored
     * label` for a request that names `defaultLocale` (the authored label IS
     * the default locale's text — ruled on #15711). A caller that declares
     * no chain gets no chain: the resolver's own default is `[]`, not `en`.
     *
     * Every seam here used to pass none, so the stack's `i18n.fallbackLocale`
     * never reached the chain: a `zh-CN` workspace that shipped a courtesy
     * `en` bundle served `Entry Sheet` to a `zh-CN` request, ahead of its own
     * authored `填报单`, because `en` was consulted before the authored label.
     *
     * The chain is read from the i18n service — `getFallbackLocale()`, the
     * locale its own `t()` falls back to, which `I18nServicePlugin` receives
     * as `fallbackLocale || defaultLocale || 'en'` from the stack config — so
     * a bundle label and a `t()` message agree on which locale comes second.
     * The default locale is read from `getDefaultLocale()`, the same accessor
     * `extractLocale` already answers a header-less request from, so the
     * request that falls to the default and the rule that recognises the
     * default read one value. Both are feature-detected like
     * `getPackagedObjectBase` (both methods are optional on `II18nService`;
     * the core in-memory fallback declares neither): a service that does not
     * declare a fallback gets NO chain, and one that does not declare a
     * default gets NO default — the serving layer threads a declaration, it
     * never invents one, and it never answers `'en'` on a provider's behalf.
     *
     * With `defaultLocale` threaded, a stack declaring `defaultLocale:
     * 'zh-CN'` with a reflexive `fallbackLocale: 'en'` serves its authored
     * `填报单` to a `zh-CN` request and its `en` bundle to every other one —
     * the contract question this docblock once refused to answer on its own
     * (#14882 left it to #15711, which ruled it).
     *
     * [#20320] `metaTranslateOptions` in `./meta-item-read-gate.ts`, which the
     * runtime dispatcher's list translation spreads too.
     */
    private static translateOptionsFor(
        i18n: any,
        locale: string,
    ): { locale: string; fallbackChain?: string[]; defaultLocale?: string } {
        return metaReadGate.metaTranslateOptions(i18n, locale);
    }

    /**
     * An `II18nService.t`-compatible lookup for the request's environment, or
     * `undefined` when no i18n service is registered. Handed to the import
     * runner so its own messages resolve a deployment's `validation.field.*`
     * overrides — the engine gets the same hook via `ObjectQLPlugin` (#3957).
     */
    private async resolveMessageTranslator(
        environmentId: string | undefined,
        req: any,
    ): Promise<((key: string, locale: string, params?: Record<string, unknown>) => string) | undefined> {
        const i18n = await this.resolveI18nService(environmentId, req);
        if (!i18n || typeof i18n.t !== 'function') return undefined;
        return (key, locale, params) => i18n.t(key, locale, params);
    }

    /**
     * Translate a single metadata **document** (view or action) when an i18n
     * service is registered for the request's project and the requested
     * locale yields a match. Falls through unchanged for unsupported types
     * or missing translations.
     *
     * Takes the document, never the `getMetaItem` envelope (#5563): nav/field
     * labels live on the document, so translating an envelope's top level
     * (which has no `navigation`) would leave the menu untranslated. Route
     * handlers that hold an envelope go through
     * {@link translateMetaEnvelope} instead of asking, at runtime, which shape
     * they were handed.
     */
    private async translateMetaItem(req: any, type: string, environmentId: string | undefined, item: any, i18nService?: any): Promise<any> {
        // [commit 2443bb4c4] Normalize HERE, not at the call sites. `isTranslatableMetaType`
        // reads `TRANSLATABLE_METADATA_TYPES`, which is DERIVED from
        // `METADATA_DOCUMENT_TRANSLATORS`' keys — and those are singular-only,
        // matching `translateMetadataDocument`'s "Canonical metadata type string". The
        // `/meta` handlers hand this helper the RAW `:type` path segment, and
        // Prime Directive #3 makes PLURAL the canonical REST spelling, so the
        // documented spelling missed the set and the whole localization was
        // skipped: same route, same document, `?locale=zh-CN`, only the
        // spelling differing —
        //
        //     singular "app"  :: label = "XLABELX"  ← translated
        //     plural   "apps" :: label = "Setup"    ← raw English
        //
        // This is #3984's family (per-type judgements seeing only the singular)
        // landing on the i18n predicate instead of on a gate. It folds at the
        // HELPER rather than at the four call sites for the reason commit 83a3b1f2e proved
        // the hard way: a normalization the callers own is one a later caller
        // forgets. The helper owns "does this type translate", so it owns the
        // spelling that question is asked in. `metaTypeSingular` leaves an
        // unmapped type untouched, so nothing that was untranslatable becomes
        // translatable — the set is unchanged, only the spellings that reach it.
        //
        // [#20408] The translation itself is `translateMetaDocument` in
        // `./meta-item-read-gate.ts` — the runtime dispatcher's item read asks
        // it too. The cached read path resolves the i18n service up-front (to
        // build a locale-aware ETag) and passes it here, so the potentially
        // registry-hitting lookup is not repeated.
        return metaReadGate.translateMetaDocument(
            this.metaItemTranslationSources(environmentId, req, i18nService),
            RestServer.metaTypeSingular(type),
            item,
        );
    }

    /**
     * Translate the document inside a `GET /meta/:type/:name` response
     * envelope and hand the envelope back with that document in place.
     *
     * This is the ONE place the single-item read paths rebuild their response
     * body, so every one of them — cached, non-cached, compound-name — answers
     * the spec's `GetMetaItemResponseSchema` shape (#5563). `envelope` supplies
     * the identity and the ADR-0008 OCC carriers (`lock`, `provenance`, …);
     * `document` is the (possibly RBAC-filtered, possibly locale-collapsed)
     * metadata document that belongs under `item`.
     */
    private async translateMetaEnvelope(
        req: any,
        type: string,
        environmentId: string | undefined,
        envelope: Record<string, any>,
        document: any,
        i18nService: any,
        runtimeDocument: unknown,
    ): Promise<any> {
        // [#10235] The per-column sortability projection, served beside the
        // document whenever the document IS an object schema, computed from the
        // caller's runtime view of the FINAL document (post ADR-0106 masking;
        // [#22250] `runtimeDocument`, `resolveObjectSchemaRuntimeView`) and never
        // inside `item`. [#20408] Both halves are `translateMetaEnvelope` in
        // `./meta-item-read-gate.ts` — the runtime dispatcher's item read answers
        // the same body through it.
        return metaReadGate.translateMetaEnvelope(
            this.metaItemTranslationSources(environmentId, req, i18nService),
            RestServer.metaTypeSingular(type),
            envelope,
            document,
            runtimeDocument,
        );
    }

    /**
     * [#20408] This transport's I/O for an item translation: the request's i18n
     * service (or the one a caller already resolved — the cached arm's, which
     * keyed its ETag on the locale), its protocol for the #8284 packaged object
     * base, and {@link extractLocale} over this request.
     */
    private metaItemTranslationSources(
        environmentId: string | undefined,
        req: any,
        i18nService?: any,
    ): metaReadGate.MetaListTranslationSources {
        return {
            resolveI18nService: async () => (i18nService !== undefined ? i18nService : this.resolveI18nService(environmentId, req)),
            resolveProtocol: () => this.resolveProtocol(environmentId, req).catch(() => undefined),
            requestLocale: (i18n) => this.extractLocale(req, i18n),
        };
    }

    /**
     * [#20408] This transport's I/O for THE item chain
     * (`createMetaItemAnswer` in `./meta-item-read-gate.ts`): the per-caller
     * gate's ports for the door's policy ({@link metaItemReadGateSources} —
     * with the caller's `mayWriteItem` when the policy honours the author
     * exemption, as {@link metaItemReadGate} builds them), {@link extractLocale},
     * and the body through {@link translateMetaEnvelope}, handed the RAW
     * segment exactly as the plain read always called it.
     *
     * [#27627] `type` is that segment, `req.params.type` unless the door
     * names it: the app metadata bundle answers several types on one request
     * whose path has no `:type`, and hands each member's own.
     */
    private metaItemAnswerSources(
        environmentId: string | undefined,
        req: any,
        p: RestProtocol,
        policy: MetaReadGatePolicy,
        type: string = req.params.type,
    ): metaReadGate.MetaItemAnswerSources {
        return {
            ...this.metaItemReadGateSources(environmentId, req, p, policy.app === 'author-exempt'),
            requestLocale: (i18n) => this.extractLocale(req, i18n),
            // [#21476] The uncached arm's share of the public-form intake
            // reason the cached arm states (`GET /meta/:type/:name`).
            translateEnvelope: async (envelope, document, runtimeDocument) =>
                this.translateMetaEnvelope(
                    req, type, environmentId, envelope as Record<string, any>,
                    RestServer.metaTypeSingular(type) === 'view'
                        ? stampAnonymousFormIntakeWarnings(
                            document, await this.anonymousFormIntakeWarnings(environmentId, req, p, document),
                        )
                        : document,
                    undefined,
                    runtimeDocument,
                ),
        };
    }

    /**
     * Serve the three-layer diagnostic projection (`code` / `overlay` /
     * `effective`) declared by `GetMetaItemLayeredResponseSchema`.
     *
     * ONE implementation behind TWO entry points (#5882): the canonical
     * `GET /meta/:type/:name/layers`, and the deprecated
     * `GET /meta/:type/:name?layers=true` it replaces. Extracted rather than
     * duplicated precisely because the deprecation window's promise is that the
     * old spelling answers *the same body* — two copies would let that stop
     * being true without anything failing.
     *
     * [#20478] …and behind two TRANSPORTS: everything after the store read is
     * `createMetaLayeredAnswer` in `./meta-item-read-gate.ts` — THE per-caller
     * gate on every layer under the stored-version doors' policy (#20156,
     * ruling 5856774816: whole for whoever may write the item, pruned as the
     * plain read prunes it for everyone else) and the ADR-0106 mask on every
     * layer with its cache posture — which the runtime dispatcher serves both
     * spellings through too. ⛔ A step is added there, never here. The read
     * stays this transport's, environment → code like the dispatcher's
     * layered read (ADR-0131 D6: no organization).
     *
     * Not translated and not cached, both deliberately: this is a diagnostic
     * view of what is STORED at each layer, so locale-collapsing it (or serving
     * it from the published-value cache) would misreport the thing being
     * diagnosed.
     */
    private async serveMetaItemLayered(
        req: any,
        res: any,
        environmentId: string | undefined,
        p: any,
        maskPosture: ObjectSchemaMaskPosture,
    ): Promise<void> {
        // ADR-0048 — thread `?package=` so the layered (Studio editor) view is
        // package-scoped; the editor passes the edited item's owning package,
        // not the studio app's.
        //
        // [#6877] ONE owning package, so repetition is refused rather than
        // resolved: `?package=a&package=b` used to reach
        // `getMetaItemLayered({ packageId: ['a','b'] })`. Gated in the helper,
        // not in its two callers, so both entry points answer identically.
        if (refuseRepeatedQueryParams(req, res, ['package'])) return;
        // [#22188] Read through {@link metaItemPackageBinding}: `all` names no package.
        const layeredPackageId = metaItemPackageBinding(req.query?.package);
        // [ADR-0131 D6] No organization: the per-organization overlay axis is
        // retired, so the layered read is environment → code — the row every
        // `/meta` write now lands in. A legacy organization-scoped row is not
        // served here; its promotion to the environment layer is ADR-0131 C7's.
        // [commit 2a29caa53] This door never carried an `as any`, but `p: any` meant its
        // request literal was never checked either — the same blind spot with
        // a different spelling. Typing the literal (spec shape + the
        // transport-level `environmentId`, see `TransportScopedMetaRequest`)
        // makes an undeclared key a compile error here too.
        //
        // [#26699] The bundle member selector, through its one reading: `/layers`
        // carries it in its closed set, and the protocol judges its value. The
        // deprecated `?layers=` spelling never reaches here with one (rule 3 of
        // `metaItemQueryRefusal` refuses it first), so its request is unchanged.
        const layeredRequest: TransportScopedMetaRequest<GetMetaItemLayeredRequest> = {
            type: req.params.type,
            name: req.params.name,
            ...(layeredPackageId ? { packageId: layeredPackageId } : {}),
            ...metaReadGate.metaMemberSelector(req.query),
            ...(environmentId ? { environmentId } : {}),
        };
        const layered = await p.getMetaItemLayered(layeredRequest);
        // [#20156 · #20478] THE per-caller gate on every layer, then the mask —
        // the shared chain. The stored-version doors honour the author
        // exemption, so the caller carries this transport's save-door
        // admission (`metaItemReadGateSources(…, true)`).
        const answer = await metaReadGate.createMetaLayeredAnswer(
            this.metaItemReadGateSources(environmentId, req, p, true),
            {
                metaType: RestServer.metaTypeSingular(req.params.type),
                name: req.params.name,
                ...(layeredPackageId ? { packageId: layeredPackageId } : {}),
                maskPosture,
            },
        )(layered);
        switch (answer.kind) {
            case 'refuse':
                RestServer.sendMetaReadRefusal(res, answer.refusal);
                return;
            case 'mask-fault':
                sendFieldVisibilityFault(res, answer.object);
                return;
            case 'serve':
                if (answer.cacheControl) res.header('Cache-Control', answer.cacheControl);
                res.json(answer.layered);
                return;
        }
    }

    /**
     * [ADR-0106 D2/D4/D6/D7/D8] Build this request's object-schema masker — a
     * per-object-name posture resolver whose caller context and `security`
     * service are resolved ONCE.
     *
     * Every exit that serves object schemas (single cached, single uncached,
     * layered, compound-name, and the list read) goes through the returned
     * function, so "which outlets mask" is one decision rather than five
     * (ADR-0106 D5 — "every schema-serving outlet, or the mask is decoration").
     *
     * Answers the not-applicable passthrough for every non-`object` type, so a
     * call site can stand unconditionally at an exit that serves all types.
     * `metaType` must be the NORMALIZED type (`/meta/objects/x` is the canonical
     * plural spelling; a gate comparing the raw param is a gate the canonical
     * spelling walks past — #3984 / commit 83a3b1f2e).
     *
     * The returned function REJECTS with {@link ObjectSchemaMaskEvaluationError}
     * on D6 tier 3 — the security service threw. Call sites answer 5xx via
     * {@link sendFieldVisibilityFault}; they must never fall back to the
     * unmasked body.
     */
    private async resolveObjectMasker(
        environmentId: string | undefined,
        req: any,
        metaType: string,
    ): Promise<(objectName: string) => Promise<ObjectSchemaMaskPosture>> {
        if (metaType !== 'object' || !this.config.metadata.maskObjectFields) {
            const fixed: ObjectSchemaMaskPosture = metaType !== 'object'
                ? OBJECT_SCHEMA_MASK_NOT_APPLICABLE
                : { kind: 'passthrough', reason: 'disabled' };
            return async () => fixed;
        }
        // Resolved ONCE per request, not once per item: the list read asks the
        // same caller about every object it serves.
        const context = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
        const security = await this.resolveSecurityService(environmentId, req);
        const telemetry = {
            warn: (message: string, meta: Record<string, unknown>) => logWarn(message, meta),
            counter: (name: string, labels: Record<string, string>) => {
                // Best-effort: the D6 middle tier must be OBSERVABLE, but a
                // deployment without a metrics registry still serves the read.
                // The structured warn above is the floor.
                try {
                    (context as any)?.__kernel?.getService?.(OBSERVABILITY_METRICS_SERVICE)?.counter?.(name, labels);
                } catch { /* metrics are never load-bearing */ }
            },
        };
        return (objectName: string) => resolveObjectSchemaMaskPosture({
            objectName,
            context,
            security: security as any,
            enabled: true,
            telemetry,
        });
    }

    /**
     * Apply {@link resolveObjectMaskPosture}'s verdict to one served document
     * (ADR-0106 D1/D3).
     *
     * Returns `null` after answering 5xx when the projection would leave the
     * schema with no fields at all — `getReadableFields` answers `[]` only where
     * its own posture read failed closed (#3545), and D6 rules an empty-fields
     * `200` out ("silently wrong UI **and** cacheable poison").
     *
     * [#21884] Hand it the posture related to `document`
     * (`relateObjectSchemaMaskPosture`) wherever the document can carry
     * actions: an action param reading another object through `objectOverride`
     * is judged against that object, and an unrelated posture withholds it.
     */
    private maskObjectDocument<T>(
        res: any,
        posture: ObjectSchemaMaskPosture,
        objectName: string,
        document: T,
    ): { document: T; fingerprint: string } | null {
        const masked = applyObjectSchemaMask(document, posture);
        if (masked.emptied) {
            sendFieldVisibilityFault(res, objectName);
            return null;
        }
        return { document: masked.document, fingerprint: masked.fingerprint };
    }

    /**
     * Translate a list of metadata documents using `translateMetaItem`.
     *
     * Normalizes the `:type` spelling for the same reason, and on the same
     * terms, as {@link translateMetaItem} — see the note there (commit 2443bb4c4). The
     * list route is one of the three that hands this the raw path segment, and
     * splitting the fix (list normalized, single-item not) would trade one
     * missing translation for the far harder "the list is localized but the
     * detail page it links to is not".
     *
     * [#20320] The translation is `translateMetaList` in
     * `./meta-item-read-gate.ts` — the last step of the list chain both
     * transports run, reached here through {@link metaListAnswerSources}; this
     * method folds the spelling and hands in this transport's I/O.
     */
    private async translateMetaItems(req: any, type: string, environmentId: string | undefined, items: any): Promise<any> {
        return metaReadGate.translateMetaList(
            this.metaListTranslationSources(environmentId, req),
            RestServer.metaTypeSingular(type),
            items,
        );
    }

    /**
     * [#20320] This transport's I/O for the list translation: the request's
     * i18n service, its protocol (for the #8284 packaged object base, resolved
     * only for an `object` list) and {@link extractLocale} over this request.
     */
    private metaListTranslationSources(
        environmentId: string | undefined,
        req: any,
    ): metaReadGate.MetaListTranslationSources {
        return {
            resolveI18nService: () => this.resolveI18nService(environmentId, req),
            resolveProtocol: () => this.resolveProtocol(environmentId, req).catch(() => undefined),
            requestLocale: (i18n) => this.extractLocale(req, i18n),
        };
    }

    /**
     * [#20320] This transport's I/O for THE list chain
     * (`createMetaListAnswer` in `./meta-item-read-gate.ts`): the per-caller
     * gate's ports ({@link metaItemReadGateSources}), {@link extractLocale},
     * the translation through {@link translateMetaItems} (handed the RAW
     * segment, exactly as the list route always called it), the #5224
     * endpoint matcher and its one-shot absence notice, and [#20408] this
     * transport's object-schema masker ({@link resolveObjectMasker}) — the
     * chain applies it, and hands the route the `private, no-store` an
     * undetermined posture owes (it used to be set here, inside the port, so
     * the dispatcher's port could, and did, leave it out). A D6 tier-3 fault is
     * handed back, never sent here: the route answers it.
     */
    private metaListAnswerSources(
        environmentId: string | undefined,
        req: any,
        p: RestProtocol,
    ): metaReadGate.MetaListAnswerSources {
        return {
            ...this.metaItemReadGateSources(environmentId, req, p),
            requestLocale: (i18n) => this.extractLocale(req, i18n),
            translateList: (_metaType, items) => this.translateMetaItems(req, req.params.type, environmentId, items),
            resolveEndpointMatcher: () => this.resolveEndpointMatchAuthority(environmentId, req),
            notifyMissingEndpointMatcher: (surface) => this.notifyMissingEndpointAuthority(surface),
            resolveObjectMasker: () => this.resolveObjectMasker(environmentId, req, 'object'),
        };
    }

    /**
     * Translate the `entries` payload returned by `getMetaTypes()` — applies
     * the active locale to each entry's `label`, `description`, the
     * nested `form` layout (section labels, field labels, helpText,
     * placeholders) and the derived JSON `schema` (a `title` per node the
     * bundle names — the only channel that reaches a repeater row's column
     * headers, #16458) via the `metadataForms.<type>` translation namespace.
     *
     * No-ops when no i18n service / locale / matching bundle entry exists,
     * so this is safe to call unconditionally from the `/meta` handler.
     */
    private async translateMetaTypesResponse(req: any, environmentId: string | undefined, payload: any): Promise<any> {
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entries)) return payload;
        const i18n = await this.resolveI18nService(environmentId, req);
        const bundle = this.buildTranslationBundle(i18n);
        if (!bundle) return payload;
        const locale = this.extractLocale(req, i18n);
        if (!locale) return payload;
        const {
            resolveMetadataTypeLabel,
            resolveMetadataTypeDescription,
            resolveMetadataFormLabels,
            resolveMetadataFormSchemaTitles,
        } = await import('@objectstack/spec/system');
        const opts = RestServer.translateOptionsFor(i18n, locale);
        const entries = payload.entries.map((entry: any) => {
            if (!entry || typeof entry !== 'object' || typeof entry.type !== 'string') return entry;
            const next: any = { ...entry };
            next.label = resolveMetadataTypeLabel(bundle, entry.type, entry.label ?? entry.type, opts);
            const desc = resolveMetadataTypeDescription(bundle, entry.type, entry.description, opts);
            if (desc !== undefined) next.description = desc;
            if (entry.form) {
                next.form = resolveMetadataFormLabels(entry.form, entry.type, bundle, opts);
            }
            if (entry.schema && typeof entry.schema === 'object') {
                next.schema = resolveMetadataFormSchemaTitles(entry.schema, entry.type, bundle, opts);
            }
            return next;
        });
        return { ...payload, entries };
    }

    /**
     * Pull the request hostname (without port) from a Node-style `req` or
     * a Fetch-style request wrapper. Returns undefined when no Host header
     * is available.
     */
    private extractHostname(req: any): string | undefined {
        const headers = req?.headers;
        let host: string | undefined;
        if (headers) {
            if (typeof headers.get === 'function') {
                host = headers.get('host') ?? undefined;
            } else {
                host = headers.host ?? headers.Host;
            }
        }
        if (!host && typeof req?.hostname === 'string') host = req.hostname;
        if (!host && typeof req?.url === 'string') {
            // Fetch-style requests expose the hostname via `req.url` even
            // when the (forbidden) `Host` header has been stripped by the
            // runtime. This branch keeps hostname-routing working when
            // tests build a `Request` object through `app.fetch(...)`.
            try {
                host = new (globalThis as any).URL(req.url).host;
            } catch { /* ignore */ }
        }
        if (!host) return undefined;
        return String(host).split(':')[0].toLowerCase();
    }

    /**
     * Pull the `X-Environment-Id` header from a Node- or Fetch-style request.
     * Header names are case-insensitive; we probe both casings to cover
     * adapters that don't normalize headers (e.g. raw Node http).
     */
    private extractProjectIdHeader(req: any): string | undefined {
        const headers = req?.headers;
        if (!headers) return undefined;
        let val: unknown;
        if (typeof headers.get === 'function') {
            val = headers.get('x-environment-id') ?? headers.get('X-Environment-Id');
        } else {
            val = headers['x-environment-id'] ?? headers['X-Environment-Id'];
        }
        if (Array.isArray(val)) val = val[0];
        if (typeof val !== 'string') return undefined;
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    
    /**
     * Run the DECLARED contract for `config.api` — the parse this seam used to
     * skip. Throws on a configuration `RestApiConfigSchema` rejects.
     *
     * [#11637] `RestApiConfigSchema` (`@objectstack/spec/api`) constrains this
     * object, most load-bearingly:
     *
     *     version: z.string().regex(...).default('v1')
     *
     * `version` is spliced into `getApiBasePath()` and therefore into the mount
     * of EVERY route this server registers. Nothing ran that regex on any
     * deployment path: both hops in are casts (`config.api as any` in
     * `rest-api-plugin.ts`, then `as Partial<RestApiConfig>` below), and the
     * kernel's `PluginConfigValidator` could not have covered it either — the
     * plugin declares no `configSchema`, `PluginLoader` calls its own
     * `validatePluginConfig(metadata)` with NO config argument and returns
     * early ("config validation postponed"), and `createRestApiPlugin` closes
     * over its config so the kernel never receives it to validate. `??` was the
     * only guard left, and `??` substitutes `null`/`undefined` only: `''`
     * walked straight past it and mounted the whole API at `/api//`, and
     * `'v1/beta'` spliced an extra path segment into every route.
     *
     * [commit 53cbad9f7] The parsed output is CONSUMED — `normalizeConfig` builds the
     * `api` block from what this returns. It was VALIDATE-ONLY from #11637
     * until then, for two measured reasons that have both since expired:
     *
     *  - `enableSearch` USED to be the silent-strip trap here: it was read
     *    below through `as any` and declared nowhere in `packages/spec`, so
     *    this non-strict `z.object()` stripped it and consuming the parsed
     *    output would have turned search back ON for a deployment that turned
     *    it off (the ADR-0104 class `shared/retired-key.ts` exists to
     *    prevent). #11983 gave it a declared seat
     *    (`RestApiConfigSchema.enableSearch`, default `true`), so the parse
     *    preserves it.
     *
     *  - `api.projectResolution` was `.omit()`ed until #12450 withdrew it.
     *
     *    ⇒ Re-measured by commit 53cbad9f7 on the landed tree, because the discard is
     *    only safe to remove if the key diff is EMPTY: the 14 keys
     *    `normalizeConfig` reads and the 14 `RestApiConfigSchema` declares
     *    after the `.omit()` are the same 14, in both directions. So the
     *    non-strict parse cannot strip anything the runtime honours, and the
     *    schema's `.default()`s ARE the defaults — one source, not the two
     *    that a `??` chain here duplicated key for key.
     *
     *    The one measured behaviour delta is bounded and named: a
     *    `documentation` or `responseFormat` object the caller WRITES now
     *    arrives carrying its own declared inner defaults, where the `??`
     *    chain copied the authored object through untouched. Both keys have
     *    zero read sites outside this block (the census commit 53cbad9f7 took), so nothing
     *    observes it today — but it is a real change to this structure's
     *    contents and belongs in the record rather than in a reader's surprise.
     *
     *    [#20295] Two of those keys then left under ADR-0049
     *    enforce-or-remove: `responseFormat` (the whole block) and
     *    `documentation.enabled` are `retiredKey()` tombstones, so this parse
     *    REFUSES them at construction with their prescription — the
     *    `crud.patterns` posture, NOT `requireAuth`'s `.omit()` below, because
     *    no boot path or shipped config writes either (measured in this repo,
     *    in objectui at its pin and in cloud) and nothing chose
     *    warn-and-ignore for them. The key diff stays empty with the
     *    tombstones counted on the schema side only: `normalizeConfig` reads
     *    13 keys, the schema declares those 13 plus the `responseFormat`
     *    tombstone, which parses to nothing and is not threaded.
     *
     *  - the retired `api.requireAuth` key is STILL `.omit()`ed rather than enforced.
     *    #3963 retired it with a deliberate warn-and-ignore posture
     *    (`rest-api-plugin.ts`: "is IGNORED"), chosen in a world where nothing
     *    parsed this config; converting that into a boot failure is that
     *    decision's to make, not this seam's, and 96 in-repo fixtures still
     *    pass the key. `.omit()` is typed against the shape, so the day the
     *    tombstone ages out of `packages/spec` this line fails `tsc` — the
     *    drift cannot go silent.
     *
     *  - `api.projectResolution` USED to be `.omit()`ed here too, for a
     *    DIFFERENT reason, and it was the one CI caught: the declared enum is
     *    `z.enum(['required', 'optional', 'auto'])`, and the value this
     *    platform shipped was `'none'` — produced by `@objectstack/runtime`'s
     *    standalone stack and forwarded by `os serve` straight into this config
     *    (`apiConfig.projectResolution ?? 'auto'` — `'none'` is not nullish, so
     *    it passed through). Three packages disagreed about this key's
     *    vocabulary, silently, for exactly as long as nothing ran the schema.
     *    Parsing it THEN would not have settled the disagreement, only turned
     *    every `os serve` boot into a crash — so it was filed as #11999 rather
     *    than decided here.
     *
     *    [#11999 / PR #12444] settled it at the producer: the runtime migrated
     *    onto the declared `'auto'`. `'none'` read as "no scoping at all" and
     *    got `'auto'`'s behaviour by fallthrough anyway, because every reader
     *    that acts on the key is gated on `enableProjectScoping` first — but
     *    the discovery handler below copies the value into
     *    `discovery.scoping.resolution` UNCONDITIONALLY, and `DiscoverySchema`
     *    declares that field as the same three-member enum, so shipping
     *    `'none'` published a payload the platform's own schema rejects.
     *
     *    [#12450] withdrew the exemption: the key is parsed here now, so an
     *    undeclared strategy is refused at construction instead of being
     *    stripped as an unknown key (this `z.object()` is non-strict) and
     *    taking `'auto'`'s branch in silence. ⛔ Do not re-add it to the
     *    `.omit()` to make some config boot — a strategy outside the enum is
     *    wrong where it is WRITTEN, not where it is read.
     *
     * The sibling sub-objects (`crud`, `metadata`, `batch`, `routes`) went
     * through the same door in [#11984], one narrowing later — parsed by
     * `parseDeclaredSubConfig` from the same table, and their parsed output
     * CONSUMED. The asymmetry with `api` is measured, not stylistic: for each
     * of the four, every key `normalizeConfig` reads is one its schema
     * declares (the key diff is empty), and none carries a tombstone, so a
     * consumed parse cannot strip anything the runtime honours. [commit 53cbad9f7] `api`
     * went through the same door last, separately measured rather than ridden
     * on the siblings: the asymmetry is gone and all five now build from their
     * parsed output.
     */
    private parseDeclaredApiConfig(api: unknown): DeclaredApiConfigParsed {
        return parseDeclaredSubConfig('api', declaredSubConfigSchemas().api, api, (issues) => (
            // The `version` rationale is appended only when `version` is what
            // failed. Measured during #11637's own ablation: a
            // `projectResolution` refusal printed the whole "an empty version
            // mounts the entire API at /api//" paragraph, which reads as a
            // diagnosis of a key the operator did not write — worse than no
            // rationale, because it sends them to the wrong line of their config.
            issues.some((issue) => issue.path[0] === 'version')
                ? '\nThis is refused at construction because `api.version` becomes a path segment in '
                  + 'EVERY route this server mounts (`getApiBasePath()` = `apiPath ?? '
                  + '`${basePath}/${version}``) — an empty version mounts the entire API at `/api//`, '
                  + 'and one carrying `/` splices an extra segment into every route.'
                : ''
        ));
    }

    /**
     * Normalize configuration with defaults
     */
    private normalizeConfig(config: RestServerConfig): NormalizedRestServerConfig {
        // [#11637 / commit 53cbad9f7] `api`: parsed AND consumed. #11637 ran the declared
        // contract here but discarded its output, leaving the block below to be
        // built from a cast over the raw input through a `??` chain that
        // duplicated `RestApiConfigSchema`'s defaults key for key — ELEVEN
        // literals in `packages/rest` restating the eleven top-level
        // `z.default(...)`s in `packages/spec`, with nothing pinning that the
        // two stayed equal. (Eleven, measured on both sides by commit 53cbad9f7; the
        // filing card said twelve, having counted the `config.api ?? {}` that
        // guards the whole object rather than a per-key default.)
        // Commit 53cbad9f7 folded the chain onto the parse after re-measuring the key
        // diff empty in both directions (see `parseDeclaredApiConfig`), so the
        // schema is now the single source of these defaults. The cast is gone
        // with it: the parsed output is already typed.
        const api = this.parseDeclaredApiConfig(config.api);
        // [#11984] The four siblings: parsed AND consumed. Each used to be
        // `(config.<sub> ?? {}) as Partial<...>`, so `batch.maxBatchSize: 0`
        // was the live batch cap (`0` is not nullish) and
        // `routes.nameTransform: 'snake_case'` sat in this config as if it were
        // declared. The parsed output is safe to build from because, per
        // sub-object, every key read below is one its schema declares
        // (measured key by key — the diff is empty for all four), so the
        // non-strict parse cannot strip anything the runtime honours, and the
        // schema's `.default()`s ARE the defaults: one source, not two.
        const schemas = declaredSubConfigSchemas();
        const crud = parseDeclaredSubConfig('crud', schemas.crud, config.crud);
        const metadata = parseDeclaredSubConfig('metadata', schemas.metadata, config.metadata);
        const batch = parseDeclaredSubConfig('batch', schemas.batch, config.batch);
        const routes = parseDeclaredSubConfig('routes', schemas.routes, config.routes);

        return {
            // Keys listed rather than spread: `NormalizedRestServerConfig`
            // declares `documentation` as REQUIRED (possibly `undefined`)
            // while the schema declares it `.optional()`, so a spread would
            // not satisfy this type — and listing them is also what makes the
            // empty key diff readable at the seam it protects. [#20295] The
            // retired `responseFormat` tombstone is deliberately NOT listed:
            // the parse above refuses it, so there is nothing to forward and
            // no default to re-apply.
            api: {
                version: api.version,
                basePath: api.basePath,
                apiPath: api.apiPath,
                enableCrud: api.enableCrud,
                enableMetadata: api.enableMetadata,
                enableUi: api.enableUi,
                enableBatch: api.enableBatch,
                enableDiscovery: api.enableDiscovery,
                enableOpenApi: api.enableOpenApi,
                enableSearch: api.enableSearch,
                enableProjectScoping: api.enableProjectScoping,
                projectResolution: api.projectResolution,
                documentation: api.documentation,
            },
            crud: {
                // Per key, not per object: since ADR-0122 `crud.operations` is the
                // AUTHOR state, so a caller may enable three of the five and leave the
                // rest to the schema's own per-key `.default(true)` — which the parse
                // above applies whenever the object is PRESENT. The `??` here covers
                // the one case the schema leaves open: `operations` itself is
                // `.optional()`, so an absent object arrives as `undefined`, not as
                // five defaults.
                operations: {
                    create: crud.operations?.create ?? true,
                    read: crud.operations?.read ?? true,
                    update: crud.operations?.update ?? true,
                    delete: crud.operations?.delete ?? true,
                    list: crud.operations?.list ?? true,
                },
                // `patterns` / `objectParamStyle` are tombstones since commit b3a63d32c —
                // refused by the parse above, never threaded.
                dataPrefix: crud.dataPrefix,
            },
            metadata: {
                prefix: metadata.prefix,
                enableCache: metadata.enableCache,
                // `cacheTtl` is a tombstone since commit b3a63d32c (`enableCache` selects the
                // protocol's cached read path, which takes no TTL).
                // [ADR-0106 D8] Default ON — masking is the platform default and
                // ships with the current major. The key has a declared seat
                // (`MetadataEndpointsConfigSchema.maskObjectFields` in
                // `packages/spec`), so this is a typed read.
                // `isObjectSchemaMaskingEnabled` also honours the
                // `OS_ALLOW_UNMASKED_OBJECT_METADATA` escape hatch, which is the
                // knob the runtime `/metadata` dispatcher shares (it has no REST
                // config to read).
                maskObjectFields: isObjectSchemaMaskingEnabled(metadata.maskObjectFields),
                // `endpoints` is `.optional()` like `crud.operations` above: the
                // `??` is for the absent object; the parse fills a present one.
                endpoints: {
                    types: metadata.endpoints?.types ?? true,
                    items: metadata.endpoints?.items ?? true,
                    item: metadata.endpoints?.item ?? true,
                    // [#15542] The whole-store family's own switch. Default ON,
                    // like its three siblings: an embedder who authored only
                    // `items: false` before keeps `/diagnostics`, `/_drafts` and
                    // the `POST /_migrate-stored` door, which used to leave with
                    // that switch — the compatibility cost the ruling priced.
                    maintenance: metadata.endpoints?.maintenance ?? true,
                    // `schema` is a tombstone since commit b3a63d32c: it gated a route that
                    // does not exist.
                },
            },
            batch: {
                maxBatchSize: batch.maxBatchSize,
                enableBatchEndpoint: batch.enableBatchEndpoint,
                // `operations` is `.optional()` — same shape as `crud.operations`.
                operations: {
                    createMany: batch.operations?.createMany ?? true,
                    updateMany: batch.operations?.updateMany ?? true,
                    deleteMany: batch.operations?.deleteMany ?? true,
                    // `upsertMany` is a tombstone since commit b3a63d32c: there is no upsertMany
                    // route to gate (upsert is an operation type of the generic batch
                    // endpoint). So is `defaultAtomic`: atomicity is the per-request
                    // `options.atomic` (ADR-0119 D4).
                },
            },
            // [commit b3a63d32c] Parsed for the refusal, threaded as nothing — every key of
            // the sub-object is a tombstone (see the type above). `routes` is kept
            // as a key so the normalized shape still has one seat per sub-object.
            routes: routes as Record<string, never>,
        };
    }
    
    /**
     * The full API base path — THE base for this deployment's REST surface.
     *
     * [commit fec784863] Public because it is the single source of truth, not merely a
     * convenience: `rest-api-plugin.ts` threads this very value into the
     * direct-mount registrars (`packages.*`, `datasources/:name/external/*`)
     * so those nine routes mount under the same prefix as everything the
     * RouteManager registers. It used to recompute `${basePath}/${version}`
     * for itself, which silently dropped `apiPath` — the two expressions
     * agree only while `apiPath` is unset, so a deployment that set it got
     * two API prefixes at once: 83 routes under `{apiPath}` and 9 left behind
     * at `/api/v1`, invisible to `{apiPath}/openapi.json` (whose section is
     * filtered to this base) and to `/discovery`.
     *
     * The fix is the SHARING, not the expression: do not copy the `??` chain
     * to a second site — copying it is precisely how the divergence happened.
     * Call this.
     */
    getApiBasePath(): string {
        const { api } = this.config;
        return api.apiPath ?? `${api.basePath}/${api.version}`;
    }

    /**
     * Get the project-scoped base path for a given unscoped base.
     * Example: `/api/v1` → `/api/v1/environments/:environmentId`.
     */
    private getScopedBasePath(basePath: string): string {
        return `${basePath}/environments/:environmentId`;
    }

    /**
     * Register all REST API routes
     *
     * When `enableProjectScoping` is true, routes are registered under
     * `/api/v1/environments/:environmentId/...`. The `projectResolution` strategy
     * controls whether unscoped legacy routes remain available:
     *   - `required` → only scoped routes registered.
     *   - `optional` / `auto` → both scoped and unscoped routes registered.
     */
    registerRoutes(): void {
        const basePath = this.getApiBasePath();
        const { enableProjectScoping, projectResolution } = this.config.api;

        const registerForBase = (bp: string) => {
            if (this.config.api.enableDiscovery) {
                this.registerDiscoveryEndpoints(bp);
            }
            if (this.config.api.enableOpenApi) {
                this.registerOpenApiEndpoints(bp);
            }
            if (this.config.api.enableMetadata) {
                this.registerMetadataEndpoints(bp);
            }
            if (this.config.api.enableUi) {
                this.registerUiEndpoints(bp);
            }
            if (this.config.api.enableSearch) {
                this.registerSearchEndpoints(bp);
            }
            this.registerEmailEndpoints(bp);
            // Public (anonymous) form endpoints — opt-in via FormView.sharing.
            // Registered BEFORE the greedy `/data/:object` matcher so the
            // `/forms/:slug` and `/forms/:slug/submit` paths can't be
            // shadowed by a literal object named "forms".
            this.registerFormEndpoints(bp);
            // Capability routes (sharing rules, approvals) live at
            // the top of the API surface (`/api/v1/{capability}/...`) rather
            // than under `/data/`, so they don't collide with the greedy
            // CRUD `/:object` matcher and don't pretend to be records on a
            // single object.
            this.registerSharingEndpoints(bp);
            this.registerSharingRuleEndpoints(bp);
            // The saved-report `/reports` family was retired (#20102): no
            // route answers there, so every path under it is the standard
            // unmounted-route 404.
            this.registerApprovalsEndpoints(bp);
            this.registerAnalyticsEndpoints(bp);
            this.registerSecurityEndpoints(bp);
            this.registerSecurityExplainEndpoints(bp);
            // Data-action routes (e.g. GET /data/:object/export, POST
            // /data/:object/import) use static-literal action segments that
            // MUST be registered BEFORE the greedy GET /data/:object/:id
            // matcher in registerCrudEndpoints — the router is first-match-wins
            // with no specificity sorting (see route-manager.ts), so otherwise
            // a request to `.../export` is captured by `:id` and "export" is
            // treated as a record id (404 RECORD_NOT_FOUND). This mirrors the
            // /meta/:type/:name/references-before-/meta/:type/:name convention.
            // Safe in the other direction too: registerDataActionEndpoints has
            // no greedy 2-segment `:object/:id` routes (only literal actions and
            // deeper `:id/clone`, `:id/shares` paths), so it cannot shadow any
            // CRUD literal.
            this.registerDataActionEndpoints(bp);
            // [#27627] `POST /data/:object/:id/page` — a deeper literal under
            // `:id`, like `:id/clone`, so it shadows no CRUD route either way.
            this.registerRecordPageEndpoints(bp);
            if (this.config.api.enableCrud) {
                this.registerCrudEndpoints(bp);
            }
            if (this.config.api.enableBatch) {
                this.registerBatchEndpoints(bp);
            }
        };

        if (enableProjectScoping) {
            const scopedBase = this.getScopedBasePath(basePath);
            if (projectResolution === 'required') {
                // Strict: only scoped routes
                registerForBase(scopedBase);
            } else {
                // 'optional' | 'auto' — keep both so legacy callers keep working
                registerForBase(basePath);
                registerForBase(scopedBase);
            }
        } else {
            registerForBase(basePath);
        }
    }
    
    /**
     * Is `/mcp` actually serveable — i.e. is the MCP service registered with
     * the shape `handleMcpRequest` needs?
     *
     * `true`/`false` are answers; `null` means "could not probe". The route
     * itself is served by the runtime dispatcher (`domains/mcp.ts`), which
     * 501s on `!mcp || typeof mcp.handleHttpRequest !== 'function'` — so this
     * probe exists to keep our `/discovery` from advertising a route that
     * would 501 (#4024).
     *
     * Same two probe paths as {@link resolveRegisteredServices} (ADR-0057
     * D10): the per-request kernel for multi-env hosts, else the single-env
     * `serviceExistsProvider` — which `rest-api-plugin` always wires. Via the
     * kernel we can check the SHAPE; the single-env provider answers existence
     * only, which is the dominant case (the dispatcher's own service-aware
     * discovery covers the wrong-shape case).
     *
     * [#9120] The first of those two paths goes through
     * {@link resolveRequestEnvironmentId} — THE shared entry point, like every
     * other consumer that needs the request's environment. It used to re-derive
     * one here (`params.environmentId`, else `defaultEnvironmentIdProvider`),
     * which is the same chain minus the host's ADR-0006 `kernel-resolver` seam
     * and the legacy hostname / `X-Environment-Id` steps. On a hostname-routed
     * multi-tenant host neither of the two inputs it read is present — the
     * `/discovery` route is unscoped, and the default provider is
     * `createSingleEnvironmentPlugin`'s wiring — so the probe fell through to
     * `serviceExistsProvider` and answered for the HOST kernel: `routes.mcp`
     * advertised for an environment whose route 501s, or withheld from one that
     * would have served it. `resolveRegisteredServices` was never exposed to
     * this because its kernel arrives as `ctx.__kernel`, set downstream of the
     * shared entry point — so routing through it is what makes the parity this
     * doc-comment claims actually hold. Single-environment boots are unaffected:
     * the default provider is step 3 of the shared chain.
     */
    private async probeMcpServeable(req: any): Promise<boolean | null> {
        try {
            // An unsubstituted route pattern is the ABSENCE of an id, not an id.
            // The shared entry point short-circuits on any truthy explicit
            // value, so the placeholder must be normalised away before it — or
            // `getOrCreate(':environmentId')` would go looking for a kernel
            // named after the pattern.
            const routeParam: string | undefined = req?.params?.environmentId;
            const environmentId = await this.resolveRequestEnvironmentId(
                routeParam === ':environmentId' ? undefined : routeParam,
                req,
            );
            if (environmentId && environmentId !== 'platform' && this.kernelManager) {
                const kernel: any = await this.kernelManager.getOrCreate(environmentId);
                if (kernel && typeof kernel.getServiceAsync === 'function') {
                    const svc: any = await kernel.getServiceAsync('mcp').catch(() => undefined);
                    return typeof svc?.handleHttpRequest === 'function';
                }
            }
            if (this.serviceExistsProvider) return this.serviceExistsProvider('mcp') === true;
        } catch { /* fall through to "cannot probe" */ }
        return null;
    }

    /**
     * Register discovery endpoints
     */
    private registerDiscoveryEndpoints(basePath: string): void {
        // [#23050 slice 7] The body moved to `discovery-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `DiscoveryRouteHost`, and that module's header for why
        // `config` is a getter).
        const readConfig = () => this.config;
        const host: DiscoveryRouteHost = {
            get config() { return readConfig(); },
            routeManager: this.routeManager,
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            probeMcpServeable: (...a) => this.probeMcpServeable(...a),
            getDirectMountRouteBases: (...a) => this.getDirectMountRouteBases(...a),
            getMountedEmailRouteBase: (...a) => this.getMountedEmailRouteBase(...a),
        };
        registerDiscoveryEndpoints.call(host, basePath);
    }

    /**
     * The served OpenAPI `info`: the bundled artifact's, with the identity
     * members the host authored in `api.documentation` laid over it (#20294,
     * ruling B on #20359 — ADR-0049 enforce-or-remove, the ENFORCE half).
     *
     * - Nothing authored (no block, `{}`, or only unset members) answers
     *   `bundled` ITSELF, so the served block is byte-identical to the
     *   artifact's — #11646's whole-block invariant, now the unset case.
     * - Anything authored answers a NEW object and never writes into
     *   `bundled`, which is the cached artifact's own `info`: a write there
     *   would serve one request's overlay to every later request.
     * - `title`, `description` and `termsOfService` overlay key by key.
     * - `contact` and `license` REPLACE the bundled object whole: a member the
     *   host left out is absent, never inherited, so `license: { name: 'MIT' }`
     *   is not published at the bundled Apache-2.0 URL.
     * - `version` is never read. It is a `retiredKey()` tombstone the
     *   construction-time parse refuses, and `info.version` stays the
     *   artifact's — the protocol version (#11646).
     *
     * Pure: its only inputs are its two arguments. The overlaid members are a
     * closed list on purpose — the parsed block carries nothing else live, and
     * a spread of it would publish whatever a later schema member meant for
     * something other than `info`.
     */
    private static overlayDocumentationInfo(
        bundled: Record<string, unknown> | undefined,
        documentation: NormalizedRestServerConfig['api']['documentation'],
    ): Record<string, unknown> | undefined {
        if (!documentation) return bundled;
        const authored: Record<string, unknown> = {};
        if (documentation.title !== undefined) authored.title = documentation.title;
        if (documentation.description !== undefined) authored.description = documentation.description;
        if (documentation.termsOfService !== undefined) authored.termsOfService = documentation.termsOfService;
        if (documentation.contact !== undefined) authored.contact = { ...documentation.contact };
        if (documentation.license !== undefined) authored.license = { ...documentation.license };
        if (Object.keys(authored).length === 0) return bundled;
        return { ...bundled, ...authored };
    }

    /**
     * Register the OpenAPI 3.1 document.
     *
     *   GET <basePath>/openapi.json   → enriched OpenAPI document
     *
     * [#25104] Its HTML viewer page (`GET <basePath>/docs`) is retired: nothing
     * read it, and the API origin serves no HTML viewer.
     *
     * Enrichment at request time:
     *   - servers[0].url           — derived from the request's Host header
     *   - paths                    — the BUILT-IN route section, produced here
     *                                from this server's own mounted routes and
     *                                REPLACING whatever the static artifact
     *                                carried (#5588, see below)
     *   - paths                    — `{object}` placeholders expanded into
     *                                one concrete path per registered object
     *                                from the protocol's discovery metadata
     *   - paths                    — one entry per declared `api` endpoint
     *                                (#5040 E6, see openapi-endpoints.ts)
     *
     * This package is the SOLE owner of the route (ADR-0076, proven by the
     * real boot in #5078), which is why the endpoint documentation joins this
     * pipeline instead of a `generateOpenApi` on some metadata service — that
     * would have been the second owner ADR-0076 forbids. The dispatcher's
     * probe for such a method was deleted in the same change.
     *
     * #5588 extended that ownership to the built-in routes themselves. The
     * static artifact's built-in section was written against a literal `/api`
     * base and a real boot found 0 of its 10 operations reachable — wrong
     * prefix, `PUT` where the server answers `PATCH`, two paths nobody serves.
     * A static artifact cannot get this right in principle, because `apiPath`
     * is per-deployment configuration. So the section is produced HERE, from
     * `routeManager.getAll()`, and the incoming `paths` are DISCARDED rather
     * than merged — a merge with a wrong section republishes the wrong
     * section, and the spec-side generator is still emitting one until #5744
     * (leg 2) removes it. See `openapi-builtin-paths.ts` for the coverage rule.
     *
     * The base spec is loaded lazily from @objectstack/spec/openapi.json
     * (shipped pre-generated by spec's build pipeline) so we don't pay
     * the cost of regenerating on every request, and a missing or
     * malformed file degrades to a stub instead of crashing. What survives
     * from it is what `packages/spec` genuinely owns: `components.schemas`,
     * `info`, `securitySchemes` (and the document-level `security`) — with
     * one addition to `info` since #20294: the publisher's identity members
     * the host authored in `api.documentation` are laid over it, see
     * {@link RestServer.overlayDocumentationInfo}. `info.version` stays the
     * artifact's.
     */
    private registerOpenApiEndpoints(basePath: string): void {
        // [#23050 slice 7] The body moved to `discovery-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `OpenApiRouteHost`, and that module's header for why
        // `config` is a getter and why the private static
        // `overlayDocumentationInfo` is handed over too).
        const readConfig = () => this.config;
        const host: OpenApiRouteHost = {
            get config() { return readConfig(); },
            routeManager: this.routeManager,
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
            loadOpenApiSpec: (...a) => this.loadOpenApiSpec(...a),
            getRoutes: (...a) => this.getRoutes(...a),
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            resolveEndpointMatchAuthority: (...a) => this.resolveEndpointMatchAuthority(...a),
            notifyMissingEndpointAuthority: (...a) => this.notifyMissingEndpointAuthority(...a),
            overlayDocumentationInfo: (...a) => RestServer.overlayDocumentationInfo(...a),
        };
        registerOpenApiEndpoints.call(host, basePath);
    }

    /**
     * Lazily load the OpenAPI spec JSON shipped by @objectstack/spec.
     * Cached after first read. Resilient to missing files / parse errors
     * so a degraded environment still boots.
     */
    private _openApiSpecCache: any | null | undefined = undefined;
    private async loadOpenApiSpec(): Promise<any | null> {
        if (this._openApiSpecCache !== undefined) return this._openApiSpecCache;
        try {
            // @ts-ignore — node built-in, no @types/node in this package
            const mod: any = await import('module');
            const requireFn = mod.createRequire((import.meta as any).url);
            const pkgJsonPath: string = requireFn.resolve('@objectstack/spec/package.json');
            // @ts-ignore
            const pathMod: any = await import('path');
            // @ts-ignore
            const fsMod: any = await import('fs');
            const specPath = pathMod.join(pathMod.dirname(pkgJsonPath), 'json-schema', 'openapi.json');
            const raw = await fsMod.promises.readFile(specPath, 'utf-8');
            this._openApiSpecCache = JSON.parse(raw);
            return this._openApiSpecCache;
        } catch (err: any) {
            logError('[REST] Failed to load OpenAPI spec:', err?.message ?? err);
            this._openApiSpecCache = null;
            return null;
        }
    }
    
    /**
     * Register the metadata routes behind the SAME anonymous-deny gate the
     * `/data` routes use.
     *
     * `registerMetadataEndpoints` builds ~17 `/meta/*` routes but — unlike the
     * `/data` handlers — never calls {@link enforceAuth}: its handlers assumed
     * the anonymous-deny rejected anonymous callers "upstream", yet nothing
     * upstream covers `/meta`, so an anonymous caller could read object / field
     * schemas. On a tenant-less runtime host those are SYSTEM-object schemas and
     * the host is publicly reachable — a real leak.
     *
     * Rather than add the gate to every handler (and have the next new route
     * forget it — the exact failure mode that caused this), wrap the route
     * registrar for the duration of registration so every meta route, present
     * and future, inherits it. An authenticated user passes exactly as on
     * `/data`; the one exception is the declaration-derived public-book read
     * (#3963), handled just below.
     */
    private registerMetadataEndpoints(basePath: string): void {
        const realRouteManager = this.routeManager;
        const guardedRouteManager = {
            register: (entry: { handler: unknown; [k: string]: unknown }) => {
                const inner = entry.handler;
                if (typeof inner !== 'function') return realRouteManager.register(entry as any);
                return realRouteManager.register({
                    ...entry,
                    handler: async (req: any, res: any) => {
                        // `req.params.environmentId` is present only on the
                        // scoped `/environments/:id/meta/...` variant — mirrors
                        // the `isScoped ? req.params.environmentId : undefined`
                        // each `/data` handler derives.
                        const environmentId = req?.params?.environmentId;
                        const context = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                        // [#3963] `audience: 'public'` is a DECLARED capability, so it
                        // must not depend on a deployment flipping its whole data plane
                        // open. An anonymous read of the
                        // book/doc surface skips the anonymous-deny and is authorized
                        // instead by the ADR-0046 §6.7 audience gate inside the handler
                        // — the same declaration-derived shape ADR-0056 Option A chose
                        // for public form submission (`publicFormGrant`).
                        //
                        // Deliberately narrow, in three independent ways:
                        //  1. only when NO context resolved. An authenticated caller
                        //     still goes through `enforceAuth` unchanged, so the
                        //     ADR-0069 auth-policy gate (expired password, enforced
                        //     MFA) keeps applying to a gated session's book reads;
                        //  2. only GET, and only the book/doc routes (see
                        //     {@link isPublicAudienceRead}) — `/meta/object` stays 401
                        //     for anonymous, which is the whole point of the umbrella
                        //     gate;
                        //  3. the handler still decides. `audienceAllows` returns true
                        //     for `'public'` ONLY; `org` and `{ permissionSet }` books
                        //     require `caller.authenticated`, and unresolvable holdings
                        //     fail closed. This grants REACHABILITY, not authorization.
                        const anonymousPublicRead = !context?.userId
                            && RestServer.isPublicAudienceRead(entry, req);
                        if (!anonymousPublicRead && this.enforceAuth(req, res, context)) return;
                        // [#21087] The type-level read admission — a read of a
                        // datasource-family type is admitted on the capability
                        // that type's own door requires. Asked HERE, for the same
                        // reason the anonymous deny is: every `/meta` route,
                        // present and future, inherits it, and it runs before any
                        // handler reads the store, so a refused caller is told
                        // the same thing whether or not the name exists. The
                        // decision is `metaTypeReadRefusal` in
                        // `./meta-item-read-gate.ts`, the one the runtime
                        // dispatcher's `/meta` entry asks too; this seam only
                        // writes it, in the ADR-0112 envelope the plain read's
                        // other `403 PERMISSION_DENIED` (an app the caller may
                        // not open) is written in.
                        const typeRefusal = metaReadGate.metaTypeReadRefusal(req?.method, req?.params?.type, context);
                        if (typeRefusal) {
                            sendEnvelopeError(res, typeRefusal.status, typeRefusal.code, typeRefusal.message);
                            return;
                        }
                        // [#21124] …and its write-side twin: a write of a
                        // datasource definition is admitted on the capability
                        // the datasource admin door requires for the same
                        // create / update / remove. Asked here, before the
                        // door's own authoring admission resolves the protocol,
                        // so a refused caller writes nothing and is told the
                        // same thing whether or not the name exists. The verb
                        // judged is the ROUTE's declared one (`RouteEntry.method`
                        // is required) — the door being entered. The decision
                        // is `metaTypeWriteRefusal`, which the runtime
                        // dispatcher's `/meta` entry asks too.
                        const writeRefusal = metaReadGate.metaTypeWriteRefusal(
                            entry.method,
                            req?.params?.type,
                            context,
                        );
                        if (writeRefusal) {
                            sendEnvelopeError(res, writeRefusal.status, writeRefusal.code, writeRefusal.message);
                            return;
                        }
                        return (inner as (rq: any, rs: any) => unknown)(req, res);
                    },
                } as any);
            },
        } as unknown as RouteManager;
        this.routeManager = guardedRouteManager;
        try {
            this.registerMetadataEndpointsInner(basePath);
        } finally {
            this.routeManager = realRouteManager;
        }
    }

    /**
     * The metadata route table itself — every `{basePath}{metadata.prefix}/…`
     * route, in one body so that they share one registration order.
     *
     * ⚠️ **`this.routeManager` is not the real route manager while this
     * runs.** {@link registerMetadataEndpoints} swaps in a wrapping registrar
     * for exactly the duration of this call and restores it in a `finally`,
     * so every `register(...)` below is handed a handler already wrapped in
     * the anonymous-deny gate. That swap is why this body is a separate
     * method rather than inlined — it needs a call boundary to scope it to.
     * Two consequences when editing here: a route added below inherits the
     * gate for free (the point — the next new route cannot forget it), and a
     * route that must NOT be gated cannot simply be added below. It belongs
     * outside the swap, with its own reason written down.
     *
     * **`basePath` decides both mount and shape, and this body runs once per
     * base.** `registerRoutes` calls it for the unscoped base (`/api/v1`) and
     * for the environment-scoped one (`/api/v1/environments/:environmentId`)
     * per `enableProjectScoping` / `projectResolution`, so every route below
     * is mounted up to twice. `isScoped` is derived from that string and from
     * nothing else, and it alone decides whether a handler reads
     * `req.params.environmentId` or passes `undefined`. Keep per-call state
     * local: the two passes share this method, not their routes.
     *
     * What actually mounts is gated further by `metadata.endpoints.types` /
     * `.items` / `.item` / `.maintenance` — the routes below are the maximum,
     * not a guarantee.
     *
     * Families, in registration order: the type list (`/meta`, and its
     * `/meta/types` spelling) → whole-store operations (`/diagnostics`,
     * `/_drafts`, `/_migrate-stored`) → the per-type list (`/:type`) → the
     * book tree (`/book/:name/tree`) → the per-item read/write
     * (`/:type/:name`) with its sub-resources (`references`, `layers`,
     * `history`, `audit`, `diff`, `publish`, `rollback`, `published`, and the
     * object FSM read `state/:field`).
     *
     * **[#15542 / #15854] One switch per FAMILY, and the families above are
     * exactly the switches.** The taxonomy in the paragraph above predates the
     * switch surface by a while, and the two disagreed in both directions: the
     * whole-store family rode `endpoints.items` (a switch whose `describe()`
     * named the per-type list, so closing a listing read silently disarmed the
     * `POST /_migrate-stored` write door), while the per-item family's own
     * `PUT`, `DELETE` and history sub-resources rode nothing but
     * `api.enableMetadata` (so closing the per-item surface left its writes
     * mounted). Now: `types` → the type list; `items` → `/:type` alone;
     * `maintenance` → the whole-store family; `item` → the whole per-item
     * face, book tree included, reads and writes alike.
     *
     * Two consequences when adding a route here:
     *  1. **Pick its switch deliberately.** A route added inside an existing
     *     `if` block inherits that block's switch by position alone, which is
     *     how the drift above accumulated. The per-item family's gate is
     *     spelled as {@link registerPerItemRoute} at its later members for
     *     exactly this reason — the gate travels with the registration rather
     *     than with a brace several hundred lines up.
     *  2. **Extend the pin in the same PR.** Every switch's radius is asserted
     *     route by route in `rest-config-mount-table.pin.test.ts`, in both
     *     directions, so a new mount reddens it. That redness is the review
     *     prompt, not an obstacle: add the route to the switch's row.
     *
     * ⚠️ `GET {metaPath}/object/:name/state/:field` is deliberately in NO
     * per-family switch and answers to `api.enableMetadata` alone. It is the
     * object FSM read, addressed by object name rather than by `:type/:name`,
     * and the ruling that drew these four radii does not name it. Moving it
     * under a switch is a decision, not a tidy-up.
     *
     * [commit 7986d973f] The compound-name twins spelled `/:type/:section/:name` used to
     * close that list. They are RETIRED (stage 3, commit 7986d973f): every item is
     * addressed through the single-segment `/:type/:name`, with the name
     * percent-encoded by the caller.
     *
     * One ordering fact is still load-bearing rather than cosmetic. Matching
     * is first-match-wins, so a literal-prefixed route must stay ABOVE the
     * `:type`-parameterised route it shares a SEGMENT COUNT with — the
     * collisions that implies are pinned by
     * `meta-route-registration-order.test.ts`, and dropping below the line is
     * how `/meta/types` once answered as an empty metadata type.
     *
     * The SECOND ordering fact retired with the twins, and it is worth knowing
     * that it is gone rather than merely absent: `/:type/:section/:name` was a
     * three-segment CATCH-ALL that shadowed every literal three-segment
     * sibling (`/history`, `/audit`, `/diff`, `/published`, `/layers`), so
     * those had to be registered above it. Nothing shadows them now. The
     * twin-parity obligation retired with it too — a gate or an org scope
     * added to the single door no longer has a second door to be added to,
     * which is exactly the defect family (#6603/#7019, #8805, #7035, #11095,
     * #11712) the retirement closes at the source.
     */
    private registerMetadataEndpointsInner(basePath: string): void {
        const { metadata } = this.config;
        const metaPath = `${basePath}${metadata.prefix}`;
        const isScoped = basePath.includes('/environments/:environmentId');

        /**
         * [#15542 / #15854] Register a route only when the per-item switch —
         * `metadata.endpoints.item` — is on. Its radius is the WHOLE per-item
         * face: `GET` / `PUT` / `DELETE {metaPath}/:type/:name`, the
         * `/references` and `/layers` reads, the history family (`/history`,
         * `/audit`, `/diff`, `/published`, `/publish`, `/rollback`) and the
         * book tree. The first four of those are inside the `if` block that
         * moved with them to `meta-item-read-routes.ts`; every later member
         * goes through this call, which reaches `meta-item-write-routes.ts` and
         * `meta-item-history-routes.ts` in `scope` (#23050 slices 13b–13e).
         *
         * A call rather than one more `if` block, for two reasons that are not
         * cosmetic:
         *  1. **No single brace pair contains exactly the right set.** The
         *     later members are registered by three calls below, in two
         *     modules, with `GET {metaPath}/object/:name/state/:field` —
         *     deliberately NOT part of this face — registered between the last
         *     two of them.
         *  2. **A gate that travels with its registration cannot be inherited
         *     or shed by moving a route past a brace**, which is exactly how
         *     this switch came to gate four reads and none of its own writes:
         *     `PUT` and `DELETE` were registered below the block's closing
         *     brace and answered to `api.enableMetadata` alone.
         *
         * ⚠️ Reads `this.routeManager` at CALL time, deliberately.
         * {@link registerMetadataEndpoints} swaps the anonymous-deny wrapping
         * registrar in for the duration of this method and restores it in a
         * `finally`, so a reference captured at definition time would register
         * past that gate.
         */
        const registerPerItemRoute = (entry: Parameters<RouteManager['register']>[0]): void => {
            if (metadata.endpoints.item === false) return;
            this.routeManager.register(entry);
        };

        // [#23050 slice 13a] The four head bindings above, handed to each moved
        // `/meta` group as ONE parameter, built once here per base. See
        // `MetaRouteScope` (`meta-collection-routes.ts`) for what each binding is
        // and why all four stay in this head.
        const scope: MetaRouteScope = { metadata, metaPath, isScoped, registerPerItemRoute };

        // [#23050 slice 13a] The type list, the whole-store maintenance family and
        // the per-type list (`GET {metaPath}`, `/types`, `/diagnostics`, `/_drafts`,
        // `POST /_migrate-stored` and `GET /:type`) moved to
        // `meta-collection-routes.ts`, and are registered HERE so they keep their
        // place in the order. This literal hands that body every member it reads
        // (see `MetaCollectionRouteHost`). It is built inside this method on
        // purpose: the umbrella has swapped the route manager for its wrapping
        // registrar for exactly the duration of this call, so the value captured
        // here is the gated one. Read that module's header before moving it.
        const collectionHost: MetaCollectionRouteHost = {
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            translateMetaTypesResponse: (...a) => this.translateMetaTypesResponse(...a),
            routeManager: this.routeManager,
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            walledCatalogRefusal: (...a) => this.walledCatalogRefusal(...a),
            resolveMetaWriteActor: (...a) => this.resolveMetaWriteActor(...a),
            refuseUnknownMetaListType: (...a) => this.refuseUnknownMetaListType(...a),
            metaListAnswerSources: (...a) => this.metaListAnswerSources(...a),
            metaTypeSingular: (...a) => RestServer.metaTypeSingular(...a),
        };
        registerMetaCollectionRoutes.call(collectionHost, scope);

        // [#23050 slice 13b] The per-item reads (`GET {metaPath}/:type/:name/references`,
        // `/layers`, `GET {metaPath}/book/:name/tree` and `GET {metaPath}/:type/:name`),
        // with the per-item switch's `if` that gated them, moved to
        // `meta-item-read-routes.ts`, and are registered HERE so they keep their place in
        // the order: after the per-type list, above the item writes below. This literal
        // hands that body every member it reads (see `MetaItemReadRouteHost`), built
        // inside this method for the same reason as the one above: the route manager it
        // captures is the umbrella's wrapping registrar. Read that module's header before
        // moving it.
        const itemReadHost: MetaItemReadRouteHost = {
            routeManager: this.routeManager,
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            metaTypeSingular: (...a) => RestServer.metaTypeSingular(...a),
            resolveObjectMasker: (...a) => this.resolveObjectMasker(...a),
            serveMetaItemLayered: (...a) => this.serveMetaItemLayered(...a),
            metaReadAudienceSources: (...a) => this.metaReadAudienceSources(...a),
            extractLocale: (...a) => this.extractLocale(...a),
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            resolveI18nService: (...a) => this.resolveI18nService(...a),
            metaItemReadGate: (...a) => this.metaItemReadGate(...a),
            maskObjectDocument: (...a) => this.maskObjectDocument(...a),
            anonymousFormIntakeWarnings: (...a) => this.anonymousFormIntakeWarnings(...a),
            translateMetaEnvelope: (...a) => this.translateMetaEnvelope(...a),
            STORED_VERSION_DOOR_POLICY: RestServer.STORED_VERSION_DOOR_POLICY,
            metaItemAnswerSources: (...a) => this.metaItemAnswerSources(...a),
            sendMetaReadRefusal: (...a) => RestServer.sendMetaReadRefusal(...a),
        };
        registerMetaItemReadRoutes.call(itemReadHost, scope);

        // [#27627] The app metadata bundle (`GET {metaPath}/app/:appId/bundle`), in
        // `meta-app-bundle-routes.ts`: every member is the item read's own answer,
        // so it registers beside the item reads, through the per-item registrar
        // (their switch, inside this umbrella). A deeper literal under `:name`
        // than any per-item sub-resource, so it shadows none of them.
        const appBundleHost: MetaAppBundleRouteHost = {
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            resolveObjectMasker: (...a) => this.resolveObjectMasker(...a),
            metaItemAnswerSources: (...a) => this.metaItemAnswerSources(...a),
            metaListSource: (...a) => this.metaListSource(...a),
            sendMetaReadRefusal: (...a) => RestServer.sendMetaReadRefusal(...a),
        };
        registerMetaAppBundleRoute.call(appBundleHost, scope);

        // [#23050 slice 13c] The per-item writes (`PUT` and `DELETE {metaPath}/:type/:name`,
        // the item save and the reset) moved to `meta-item-write-routes.ts`, and are
        // registered HERE so they keep their place in the order: after the per-item reads,
        // above the history family below. They still register through the per-item
        // registrar this head declares, which reaches that module in `scope` as the one
        // closure it is and reads the route manager when it is called, during this call.
        // This literal hands that body every other member it reads (see
        // `MetaItemWriteRouteHost`); it carries no route manager, because that body
        // registers nothing on one itself. Read that module's header before moving it.
        const itemWriteHost: MetaItemWriteRouteHost = {
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            metaSaveVerdict: (...a) => RestServer.metaSaveVerdict(...a),
            walledCatalogRefusal: (...a) => this.walledCatalogRefusal(...a),
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            resolveMetaWriteActor: (...a) => this.resolveMetaWriteActor(...a),
        };
        registerMetaItemWriteRoutes.call(itemWriteHost, scope);

        // [#23050 slice 13d] The history family (`GET {metaPath}/:type/:name/history`,
        // `/audit`, `POST /publish`, `POST /rollback` and `GET /diff`) moved to
        // `meta-item-history-routes.ts`, and is registered HERE so it keeps its place in
        // the order: after the per-item writes, above the object FSM read below. Like the
        // writes, it still registers through the per-item registrar this head declares,
        // which reaches that module in `scope` as the one closure it is and reads the
        // route manager when it is called, during this call. This literal hands that body
        // every other member it reads (see `MetaItemHistoryRouteHost`): the class's
        // methods as closures, its private statics as closures on the class, and
        // `STORED_VERSION_DOOR_POLICY` by value; it carries no route manager, because that
        // body registers nothing on one itself. Read that module's header before moving it.
        const itemHistoryHost: MetaItemHistoryRouteHost = {
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            eventDoorRefusal: (...a) => this.eventDoorRefusal(...a),
            walledCatalogRefusal: (...a) => this.walledCatalogRefusal(...a),
            resolveMetaWriteActor: (...a) => this.resolveMetaWriteActor(...a),
            metaTypeSingular: (...a) => RestServer.metaTypeSingular(...a),
            resolveObjectMasker: (...a) => this.resolveObjectMasker(...a),
            gatesPerCaller: (...a) => RestServer.gatesPerCaller(...a),
            fetchCurrentMetaDocument: (...a) => this.fetchCurrentMetaDocument(...a),
            gatesOnItsOwnKey: (...a) => RestServer.gatesOnItsOwnKey(...a),
            diffSides: (...a) => RestServer.diffSides(...a),
            metaItemReadGate: (...a) => this.metaItemReadGate(...a),
            STORED_VERSION_DOOR_POLICY: RestServer.STORED_VERSION_DOOR_POLICY,
            diffEmittedFrom: (...a) => RestServer.diffEmittedFrom(...a),
            maskObjectDocument: (...a) => this.maskObjectDocument(...a),
        };
        registerMetaItemHistoryRoutes.call(itemHistoryHost, scope);

        // [#23050 slice 13e] Both host literals below hand on the class's engine provider
        // FIELD, which both moved doors read at request time, as a getter onto this server:
        // the batch registrar's shape. This one arrow is what both getters read.
        const readObjectQLProvider = () => this.objectQLProvider;

        // [#23050 slice 13e] The object state-machine read
        // (`GET {metaPath}/object/:name/state/:field`) moved to `meta-object-state-routes.ts`,
        // and is registered HERE so it keeps its place in the order: after the history family,
        // above the published read below. It is in no per-family switch and registers on the
        // route manager itself, so this literal hands that body the route manager by value
        // (see `MetaObjectStateRouteHost`), built inside this method for the same reason as
        // the first one above: the manager it captures is the umbrella's wrapping registrar.
        // Read that module's header before moving it.
        const objectStateHost: MetaObjectStateRouteHost = {
            routeManager: this.routeManager,
            get objectQLProvider() { return readObjectQLProvider(); },
            resolveProtocol: (...a) => this.resolveProtocol(...a),
        };
        registerMetaObjectStateRoute.call(objectStateHost, scope);

        // [#23050 slice 13e] The published read (`GET {metaPath}/:type/:name/published`)
        // moved to `meta-item-history-routes.ts`, beside the history family, and is registered
        // HERE so it keeps its place in the order: after the object state-machine read, the
        // last `/meta` route. Like the history family, it still registers through the per-item
        // registrar this head declares, which reaches that module in `scope` as the one closure
        // it is and reads the route manager when it is called, during this call. This literal
        // hands that body every other member it reads (see `MetaItemPublishedRouteHost`): the
        // class's methods as closures, its private static as a closure on the class, and the
        // engine provider as a getter; it carries no route manager, because that body
        // registers nothing on one itself. Read that module's header before moving it.
        const itemPublishedHost: MetaItemPublishedRouteHost = {
            metaTypeSingular: (...a) => RestServer.metaTypeSingular(...a),
            resolveObjectMasker: (...a) => this.resolveObjectMasker(...a),
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            metaItemReadGate: (...a) => this.metaItemReadGate(...a),
            maskObjectDocument: (...a) => this.maskObjectDocument(...a),
            get objectQLProvider() { return readObjectQLProvider(); },
            resolveMetadataService: (...a) => this.resolveMetadataService(...a),
        };
        registerMetaItemPublishedRoute.call(itemPublishedHost, scope);

        // ── RETIRED: the compound `/:type/:section/:name` arities ──────────
        //
        // `GET` and `PUT /meta/:type/:section/:name` were mounted here until
        // commit 7986d973f (stage 3 of the maintainer-ruled retirement of
        // compound-name addressing, 2026-08-25). Both folded `section` and
        // `name` back into one slash-bearing key (`views/all_leads`) that the
        // protocol layer then treated as a single opaque string — the section
        // half was never stored, filtered or enumerated, so it was addressing
        // syntax and nothing else.
        //
        // Stage 1 (commit 311433f6b) declared the item-name grammar and refuses every
        // slash-bearing name at the publish door, which is what makes this a
        // removal of dead addressing rather than of a capability: no name
        // reachable only through these arities can be created any more.
        //
        // Callers address every item through the single-segment twins
        // (`GET`/`PUT /meta/:type/:name`), percent-encoding the name — which
        // the SDK now does everywhere. A pre-grammar residue row spelled with
        // a slash still reads, writes and deletes through those twins, because
        // `%2F` matches the single-segment pattern and Hono decodes the
        // parameter back to the stored spelling (measured, not assumed).
        //
        // These were also the three-segment CATCH-ALL that shadowed every
        // literal sibling (`/history`, `/audit`, `/diff`, `/published`), which
        // is why the registration order below them was load-bearing; with the
        // catch-all gone that hazard is gone with it.
    }

    /**
     * Register UI endpoints
     *
     * ## [commit cc837dbfe] This registrar's one route is identity- AND ownership-gated
     *
     * It used to be the single route in this server's table that resolved NO
     * identity: it went straight from `resolveProtocol` to `getUiView`, so it
     * answered 200 to an anonymous caller, byte-identically to an entitled one,
     * having called `resolveExecCtx` zero times — while all 52 identity-touching
     * siblings answered 401. Because the unscoped mount lets the REQUEST name
     * its environment (bound hostname, else `X-Environment-Id`), that made
     * another environment's object metadata anonymously readable and turned the
     * route into an object-existence oracle for any environment a caller could
     * name.
     *
     * Maintainer ruling, 2026-08-30 (option C): the seam must require that the
     * RESOLVED environment belong to the caller — identity resolution PLUS an
     * ownership check — on BOTH naming channels, and an `envRegistry.resolveById`
     * validation failure must be a signalled refusal, ⛔ never a silent fallback
     * to the default environment. ⛔ Anonymous-deny alone was explicitly the
     * rejected option B.
     *
     * The order below is the ruling, step by step, and it is load-bearing:
     * resolve the environment ONCE through the shared entry point, resolve
     * identity IN that environment, refuse anonymity, then compare. Resolving
     * identity before the environment is decided would authenticate the caller
     * somewhere other than where the answer comes from, which is the very
     * mismatch {@link enforceEnvironmentOwnership} exists to catch.
     */
    private registerUiEndpoints(basePath: string): void {
        // [#23050 slice 10] The body moved to `ui-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `UiRouteHost`, and that module's header for why no
        // member is a getter).
        const host: UiRouteHost = {
            routeManager: this.routeManager,
            resolveRequestEnvironmentId: (...a) => this.resolveRequestEnvironmentId(...a),
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
            enforceEnvironmentOwnership: (...a) => this.enforceEnvironmentOwnership(...a),
            resolveProtocol: (...a) => this.resolveProtocol(...a),
        };
        registerUiEndpoints.call(host, basePath);
    }
    
    /**
     * Register CRUD endpoints for data operations
     */
    private registerCrudEndpoints(basePath: string): void {
        // [#23050 slice 12] The body moved to `crud-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `CrudRouteHost`, and that module's header for why no
        // member is a getter).
        const host: CrudRouteHost = {
            config: this.config,
            routeManager: this.routeManager,
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
            enforceApiAccess: (...a) => this.enforceApiAccess(...a),
        };
        registerCrudEndpoints.call(host, basePath);
    }
    
    /**
     * Register object-specific action endpoints that don't fit the
     * generic CRUD shape — domain operations where the protocol does its
     * own orchestration and we just need a thin HTTP route.
     *
     * POST {basePath}/data/:object/:id/clone — record clone (gated by
     * `enable.clone`). This is object-agnostic by design: it works for any
     * authored object regardless of namespace, unlike a hardcoded
     * per-object route would.
     */
    private registerDataActionEndpoints(basePath: string): void {
        // [#23050 slice 1] The body moved to `data-action-routes.ts`. This
        // literal hands it every member it reads — the list IS its dependency
        // on this class (see `DataActionRouteHost` for why each entry is shaped
        // the way it is).
        const host: DataActionRouteHost = {
            config: this.config,
            routeManager: this.routeManager,
            cancelledImportJobs: this.cancelledImportJobs,
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
            enforceApiAccess: (...a) => this.enforceApiAccess(...a),
            enforceImportTemplateGates: (...a) => this.enforceImportTemplateGates(...a),
            enforceExportPermission: (...a) => this.enforceExportPermission(...a),
            translateMetaItem: (...a) => this.translateMetaItem(...a),
            resolveMessageTranslator: (...a) => this.resolveMessageTranslator(...a),
            resolveSecurityService: (...a) => this.resolveSecurityService(...a),
            resolveI18nService: (...a) => this.resolveI18nService(...a),
            extractLocale: (...a) => this.extractLocale(...a),
            answerImportTemplate: (...a) => this.answerImportTemplate(...a),
        };
        registerDataActionEndpoints.call(host, basePath);
    }

    /**
     * [#27627] `POST {basePath}/data/:object/:id/page` — the record page
     * payload: the record, its related lists' counts and first rows, its field
     * projection, access verdicts and approval state in one request, each part
     * the answer of the read it replaces (`record-page-routes.ts`).
     */
    private registerRecordPageEndpoints(basePath: string): void {
        const readApprovalsServiceProvider = () => this.approvalsServiceProvider;
        const host: RecordPageRouteHost = {
            config: this.config,
            routeManager: this.routeManager,
            get approvalsServiceProvider() { return readApprovalsServiceProvider(); },
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
            enforceApiAccess: (...a) => this.enforceApiAccess(...a),
            resolveSecurityService: (...a) => this.resolveSecurityService(...a),
            loadObjectItem: (p, environmentId, name) => {
                const listSource = this.metaListSource(p, environmentId);
                const getObjectItem = this.objectItemReader(p, environmentId);
                return metaReadGate.loadObjectItem(getObjectItem ? { ...listSource, getObjectItem } : listSource, name);
            },
        };
        registerRecordPageEndpoints.call(host, basePath);
    }

    /**
     * [#18386] `GET {basePath}/data/:object/export?template=true` — the IMPORT
     * template: an xlsx workbook with a header row of the columns an import can
     * write, one example row, dropdowns for the closed value domains, and an
     * instructions sheet. No data is read.
     *
     * It runs behind the IMPORT door's gates, not the export's
     * ({@link enforceImportTemplateGates}, [#20896] ruling A) — the object's
     * `import` exposure ({@link enforceApiAccess}) and the caller's create
     * permission — because it carries no records, only what an importer needs
     * to fill in; a caller may hold one door and not the other, and the export
     * permission ({@link enforceExportPermission}) neither admits nor refuses a
     * template. It runs after the route's query-string gates as well.
     *
     * Columns: an explicit `?fields=` is honoured as asked; otherwise
     * `templateColumns` over the object as this caller reads it, narrowed by
     * `resolveTemplateProjection` — the security service's WRITE projection,
     * or its read projection when it has none, which `X-Export-Template-Projection`
     * and a note on the instructions sheet then state. A security service that
     * is present but answers neither fails the request rather than answering an
     * unnarrowed header.
     */
    private async answerImportTemplate(
        req: any,
        res: any,
        p: RestProtocol,
        environmentId: string | undefined,
        objectName: string,
        context: any,
        q: Record<string, any>,
    ): Promise<void> {
        let explicitFields: string[] | undefined;
        if (typeof q.fields === 'string' && q.fields.length > 0) {
            explicitFields = q.fields.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else if (Array.isArray(q.fields)) {
            explicitFields = q.fields.filter((s: any) => typeof s === 'string' && s.length > 0);
        }

        // The object as the export reads it (registry first, `getObjectSchema`
        // as the last resort), localized to the request — but NOT best-effort:
        // a template without the schema has no columns to offer.
        let schema: any = undefined;
        if (typeof (p as any).getMetaItem === 'function') {
            const found: any = await (p as any).getMetaItem({ type: 'object', name: objectName });
            schema = found?.item;
        }
        if (!schema && typeof (p as any).getObjectSchema === 'function') {
            schema = await (p as any).getObjectSchema(objectName, environmentId);
        }
        if (!schema || typeof schema !== 'object') {
            const missing: any = new Error(`Object '${objectName}' was not found, so it has no import template.`);
            missing.code = 'OBJECT_NOT_FOUND';
            missing.status = 404;
            throw missing;
        }
        schema = await this.translateMetaItem(req, 'object', environmentId, schema);

        let permitted: ReadonlySet<string> | undefined;
        let projection: TemplateProjectionSource = 'none';
        if (!explicitFields || explicitFields.length === 0) {
            const security = await this.resolveSecurityService(environmentId, req);
            const answer = await resolveTemplateProjection(security, objectName, context);
            if (answer.source === 'unanswered') {
                // Declared 5xx: a fault, sanitised and logged — never read
                // as "no such object" by the message heuristics.
                throw Object.assign(
                    new Error('The security service gave no field projection, so the import template '
                        + 'cannot tell which columns this caller may write.'),
                    { status: 500, code: 'INTERNAL_ERROR' },
                );
            }
            if (answer.source !== 'none') permitted = answer.permitted;
            projection = answer.source;
        }
        const fields = templateColumns(schema, { explicitFields, permitted });

        // A reference column names the object it points at by that object's
        // label, when it can be read; otherwise by its name.
        const referenceLabels = new Map<string, string>();
        const metaMap = buildFieldMetaMap(schema);
        for (const f of fields) {
            const target = metaMap.get(f)?.reference;
            if (!target || referenceLabels.has(target)) continue;
            let label = target;
            try {
                const found: any = typeof (p as any).getMetaItem === 'function'
                    ? await (p as any).getMetaItem({ type: 'object', name: target })
                    : undefined;
                const translated: any = found?.item
                    ? await this.translateMetaItem(req, 'object', environmentId, found.item)
                    : undefined;
                if (typeof translated?.label === 'string' && translated.label.trim().length > 0) label = translated.label;
            } catch { /* the target's name stands in for its label */ }
            referenceLabels.set(target, label);
        }

        const i18n = await this.resolveI18nService(environmentId, req).catch(() => undefined);
        const locale = this.extractLocale(req, i18n);
        const columns = describeTemplateColumns(schema, fields, { locale, referenceLabels });
        const workbook = await buildImportTemplateWorkbook(columns, { locale, projection });
        const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

        const timezone = typeof context?.timezone === 'string' && context.timezone ? String(context.timezone) : undefined;
        const objectLabel = typeof schema.label === 'string' && schema.label.length > 0 ? schema.label : objectName;
        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.header('Content-Disposition', exportContentDisposition(
            `${objectName}-template`, `${objectLabel}-${templateText(locale).filenameSuffix}`, 'xlsx', timezone,
        ));
        res.header('X-Export-Format', 'xlsx');
        res.header('X-Export-Template', 'true');
        res.header('X-Export-Template-Projection', projection);
        res.header('Cache-Control', 'no-store');
        res.write(bytes);
        res.end();
    }

    /**
     * [#3547] Resolve the environment's `security` service — the ENVIRONMENT's
     * kernel service first (its evaluator / FieldMasker are bound to that
     * kernel's data engine), the host provider as the single-kernel fallback.
     * Mirrors the resolver in registerSecurityExplainEndpoints. Returns
     * `undefined` when no security service is reachable (no plugin-security /
     * single-kernel without a provider), so callers degrade gracefully.
     *
     * Typed as a PARTIAL {@link ISecurityService}: an implementation may omit a
     * method it cannot honour, so every call site must keep feature-detecting
     * (`typeof svc.x === 'function'`) rather than assume the full surface.
     */
    private async resolveSecurityService(
        environmentId?: string,
        req?: any,
    ): Promise<Partial<ISecurityService> | undefined> {
        try {
            const envId = await this.resolveRequestEnvironmentId(environmentId, req);
            if (envId && envId !== 'platform' && this.kernelManager) {
                const kernel = await this.kernelManager.getOrCreate(envId);
                const svc = await kernel.getServiceAsync<any>('security').catch(() => undefined);
                if (svc) return svc;
            }
        } catch { /* fall back to the host provider */ }
        if (!this.securityServiceProvider) return undefined;
        try { return await this.securityServiceProvider(environmentId); }
        catch { return undefined; }
    }

    /**
     * Register global cross-object search endpoint (M10.5).
     * GET {basePath}/search?q=acme&objects=lead,account&limit=20&perObject=5
     */
    private registerSearchEndpoints(basePath: string): void {
        // [#23050 slice 9] The body moved to `search-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `SearchRouteHost`, and that module's header for why no
        // member is a getter).
        const host: SearchRouteHost = {
            routeManager: this.routeManager,
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
        };
        registerSearchEndpoints.call(host, basePath);
    }

    /**
     * Register email endpoints (M11.B1 / M10.7).
     *
     * POST {basePath}/email/send — send a transactional email via the
     * `IEmailService` provider registered by EmailServicePlugin. Returns
     * 501 when no provider is wired so deployments without email
     * configured fail cleanly.
     *
     * The caller must hold `manage_platform_settings`; `sentBy` is always the
     * authenticated caller, `from` is bounded to the configured sender,
     * `headers` must be a plain string-valued map, `organizationId` is the
     * caller's active organization and `identityMail` is not the caller's to
     * set — each refused `403 PERMISSION_DENIED` otherwise (`email-routes.ts`
     * header, "Who may send, and as whom").
     *
     * Request body:
     *   {
     *     to: "a@b.com" | ["a@b.com", { name, address }],
     *     from?: ..., cc?: ..., bcc?: ..., replyTo?: ...,
     *     subject: string,
     *     text?: string, html?: string,  // at least one required
     *     attachments?: [{ filename, content, contentType?, cid? }],
     *     headers?: { [name]: value },
     *     relatedObject?: string, relatedId?: string,
     *   }
     */
    private registerEmailEndpoints(basePath: string): void {
        // [#23050 slice 8] The body moved to `email-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `EmailRouteHost`, and that module's header for why
        // `emailServiceProvider` is a getter).
        const readEmailServiceProvider = () => this.emailServiceProvider;
        const host: EmailRouteHost = {
            routeManager: this.routeManager,
            get emailServiceProvider() { return readEmailServiceProvider(); },
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
        };
        registerEmailEndpoints.call(host, basePath);
    }

    /**
     * [#21331 · #21476] The `tenancy` service an anonymous form request reads,
     * or `undefined` in the supported no-tenancy composition. Which
     * organization it answers, and why it fails closed: the comment above
     * `resolveFormBySlug` in {@link registerFormEndpoints}.
     */
    private async resolveAnonymousFormTenancy(environmentId: string | undefined, req: any): Promise<any | undefined> {
        try {
            const envId = environmentId === 'platform'
                ? undefined
                : await this.resolveRequestEnvironmentId(environmentId, req);
            if (envId && this.kernelManager) {
                const kernel: any = await this.kernelManager.getOrCreate(envId);
                return typeof kernel?.getServiceAsync === 'function'
                    ? await kernel.getServiceAsync('tenancy')
                    : undefined;
            }
            if (this.tenancyServiceProvider) return await this.tenancyServiceProvider(environmentId);
            return undefined;
        } catch (err) {
            if (isServiceNotRegisteredError(err)) return undefined;
            throw new AuthzStoreUnavailableError('tenancy', err);
        }
    }

    /**
     * The object schemas an anonymous form request reads (#21331): the
     * environment's, as every object read is (ADR-0131 D6). They carry the
     * columns the registry injects, `organization_id` among them.
     */
    private async readFormObjectDefinitions(
        p: RestProtocol,
        environmentId: string | undefined,
    ): Promise<any[]> {
        const objectsRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
            type: 'object',
            ...(environmentId ? { environmentId } : {}),
        };
        const r: any = await p.getMetaItems(objectsRequest);
        return Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
    }

    /**
     * [#21476] The administrator's read of a `view`: one warning per open
     * public form that cannot take intake on this deployment, located at that
     * form's `sharing` and naming why. Asked through the SAME predicate, the
     * same tenancy read and the same object read as both anonymous doors
     * (`registerFormEndpoints`), so the reason is shown exactly when the doors
     * answer not-found. A view with no open public form reads nothing.
     */
    private async anonymousFormIntakeWarnings(
        environmentId: string | undefined,
        req: any,
        p: RestProtocol,
        view: unknown,
    ): Promise<Array<{ path: string; message: string }>> {
        if (!view || typeof view !== 'object' || typeof (p as any).getMetaItems !== 'function') return [];
        const candidates = anonymousFormIntakeCandidates(view);
        if (candidates.length === 0) return [];
        const tenancy = await this.resolveAnonymousFormTenancy(environmentId, req);
        const posture = anonymousFormIntakePosture(tenancy);
        let objects: Promise<any[]> | undefined;
        const readObjects = (): Promise<any[]> => (objects ??= this.readFormObjectDefinitions(p, environmentId));
        const warnings: Array<{ path: string; message: string }> = [];
        for (const candidate of candidates) {
            const object = anonymousFormObjectName(view, candidate.form);
            if (!object) continue;
            const unavailable = await anonymousFormIntakeUnavailability(
                object,
                posture,
                async () => (await readObjects()).find((o: any) => o?.name === object),
            );
            if (!unavailable) continue;
            warnings.push({
                path: anonymousFormSharingPath(view as Record<string, any>, candidate),
                message: anonymousFormIntakeUnavailableMessage(candidate.slug, unavailable),
            });
        }
        return warnings;
    }

    /**
     * Register public (anonymous) form endpoints.
     *
     * Public forms are opt-in: a `FormView` becomes accessible to anonymous
     * visitors only when `sharing.enabled === true`, `sharing.allowAnonymous
     * === true` AND a `sharing.publicLink` slug is configured
     * (`anonymousFormIntakeCandidates`, `@objectstack/metadata-core`). A form
     * whose bound object cannot take an anonymous submission on this
     * deployment's posture is not offered either
     * ({@link anonymousFormIntakeUnavailability}): both routes answer it exactly
     * as they answer a withdrawn form. Two routes are registered:
     *
     *   GET  {basePath}/forms/:slug          → resolved form spec
     *   POST {basePath}/forms/:slug/submit   → INSERT record (no auth required),
     *                                          answering `{ id }` only (#22437)
     *
     * Both routes bypass `enforceAuth` even though anonymous-deny is on for the
     * deployment (e.g. ObjectOS multi-tenant). The submit is authorized by the
     * form's own declaration (ADR-0056 Option A): it hands the engine a
     * `publicFormGrant` scoped to the form's target object, and the
     * SecurityPlugin admits on that grant alone, before any permission set
     * resolves. It admits the create and the read-back (`find` / `findOne` /
     * `count`) on that object only, refuses every other operation and object,
     * and strips the server-managed anchors (`PUBLIC_FORM_SERVER_MANAGED_FIELDS`)
     * from the payload; the route's allow-list of the form's declared fields is
     * the first net. No deployment configures anything for this, and the grant
     * never falls open: it admits the same operations whether or not a
     * `guest_portal` set is registered.
     *
     * The submit's context also names `guest_portal` in `permissions`. That
     * name admits nothing. Where a deployment registers a set under it, the
     * SecurityPlugin resolves that set as the caller's for the grant's result
     * masker over what the grant hands back (ADR-0138 records the name); the
     * submit answers the created id only (#22437).
     *
     * The matched FormView's parent ViewSchema is found by scanning
     * `protocol.getMetaItems({ type: 'view' })`. For each entry we inspect
     * `form.sharing`, every entry in `formViews` and a flattened form item's
     * `config.sharing`; the first open FormView whose `sharing.publicLink`
     * matches `/forms/:slug` (or just `:slug`) wins. The response carries the matched form view under `form` and
     * the inferred target object, matching what the frontend's
     * `mapViewSpecToEmbeddableConfig` expects.
     */
    private registerFormEndpoints(basePath: string): void {
        // [#23050 slice 11] The body moved to `form-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `FormRouteHost`, and that module's header for why no
        // member is a getter and why the private static `translateOptionsFor`
        // is handed over too).
        const host: FormRouteHost = {
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            resolveAnonymousFormTenancy: (...a) => this.resolveAnonymousFormTenancy(...a),
            readFormObjectDefinitions: (...a) => this.readFormObjectDefinitions(...a),
            routeManager: this.routeManager,
            resolveI18nService: (...a) => this.resolveI18nService(...a),
            buildTranslationBundle: (...a) => this.buildTranslationBundle(...a),
            extractLocale: (...a) => this.extractLocale(...a),
            translateOptionsFor: (...a) => RestServer.translateOptionsFor(...a),
            packagedObjectBase: (...a) => this.packagedObjectBase(...a),
        };
        registerFormEndpoints.call(host, basePath);
    }

    /**
     * ADR-0021 — analytics dataset preview/query endpoint.
     *
     *   POST {basePath}/analytics/dataset/query
     *   body: { dataset?: <inline Dataset>, datasetName?: string, selection: DatasetSelection }
     *
     * Compiles the dataset (an inline draft for Studio preview, or a saved one
     * by name) and runs the selection through the analytics service's
     * `queryDataset`, threading the request ExecutionContext so tenant/RLS
     * scoping (ADR-0021 D-C) applies. Returns 501 when no analytics service
     * (or one without `queryDataset`) is configured, so a deployment without
     * `@objectstack/service-analytics` fails cleanly.
     */
    private registerAnalyticsEndpoints(basePath: string): void {
        // [#23050 slice 5] The body moved to `analytics-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `AnalyticsRouteHost`, and that module's header for why
        // `kernelManager` and `analyticsServiceProvider` are getters).
        const readKernelManager = () => this.kernelManager;
        const readAnalyticsServiceProvider = () => this.analyticsServiceProvider;
        const host: AnalyticsRouteHost = {
            routeManager: this.routeManager,
            get kernelManager() { return readKernelManager(); },
            get analyticsServiceProvider() { return readAnalyticsServiceProvider(); },
            resolveRequestEnvironmentId: (...a) => this.resolveRequestEnvironmentId(...a),
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            translateMetaItem: (...a) => this.translateMetaItem(...a),
        };
        registerAnalyticsEndpoints.call(host, basePath);
    }

    /**
     * [ADR-0090 D6] Access-explanation endpoint — the REST face of the
     * explain engine (framework#2696).
     *
     *   GET  {basePath}/security/explain?object=…&operation=…&userId=…
     *   POST {basePath}/security/explain   body: { object, operation, userId?,
     *                                              recordId? | recordIds? }
     *
     * [#8326] `recordIds` (max 200, exclusive with `recordId`) is the batch
     * form of the record-grained question: one `(object, operation)` pair
     * answered per record in one round trip — `records[i]` answers
     * `recordIds[i]`; each entry is the verdict the singular form returns for
     * that id (see `ExplainRequestSchema`'s TSDoc for the full contract).
     *
     * Delegates to the security service's `explain(request, callerContext)`
     * (`SecurityPlugin.explainAccessForCaller`) — the same code paths the
     * enforcement middleware runs, so the report is explained by
     * construction. Caller authorization lives in the SERVICE, not here:
     * explaining ANOTHER user requires `manage_users` or a delegated
     * `adminScope` covering that user (D12); the service's
     * `PermissionDeniedError` maps to 403. The route itself only insists on
     * an authenticated caller (an access report is sensitive even about
     * oneself, and the anonymous `guest` posture is not this endpoint's
     * business) and returns 501 when no security service exposing `explain`
     * is mounted (a deployment without `@objectstack/plugin-security`).
     */
    private registerSecurityExplainEndpoints(basePath: string): void {
        // [#23050 slice 6] The body moved to `security-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `SecurityExplainRouteHost`, and that module's header for why
        // `kernelManager` and `securityServiceProvider` are getters).
        const readKernelManager = () => this.kernelManager;
        const readSecurityServiceProvider = () => this.securityServiceProvider;
        const host: SecurityExplainRouteHost = {
            routeManager: this.routeManager,
            get kernelManager() { return readKernelManager(); },
            get securityServiceProvider() { return readSecurityServiceProvider(); },
            resolveRequestEnvironmentId: (...a) => this.resolveRequestEnvironmentId(...a),
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
        };
        registerSecurityExplainEndpoints.call(host, basePath);
    }

    /**
     * Register record-level sharing endpoints (M11.C17).
     *
     * Surfaces `ISharingService` over HTTP so the UI can list, create
     * and revoke per-record grants without going through ObjectQL. The
     * three routes mirror the share-management drawer in Salesforce /
     * ServiceNow:
     *
     *   GET    {basePath}/data/:object/:id/shares
     *   POST   {basePath}/data/:object/:id/shares
     *   DELETE {basePath}/data/:object/:id/shares/:shareId
     *
     * All three resolve via `sharingServiceProvider`; routes return 501
     * when no sharing service is configured so a deployment without the
     * `@objectstack/plugin-sharing` plugin fails cleanly.
     */
    private registerSharingEndpoints(basePath: string): void {
        // [#23050 slice 4] The body moved to `sharing-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `SharingRouteHost`, and that module's header for why
        // `sharingServiceProvider` is a getter).
        const readSharingServiceProvider = () => this.sharingServiceProvider;
        const host: SharingRouteHost = {
            config: this.config,
            routeManager: this.routeManager,
            get sharingServiceProvider() { return readSharingServiceProvider(); },
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
        };
        registerSharingEndpoints.call(host, basePath);
    }

    /**
     * Register sharing-rule endpoints (M10.17). Mirrors the existing
     * sharing endpoints but operates on `sys_sharing_rule` rows.
     *
     *   GET    {basePath}/sharing/rules?object=&activeOnly=
     *   POST   {basePath}/sharing/rules
     *   GET    {basePath}/sharing/rules/:idOrName
     *   DELETE {basePath}/sharing/rules/:idOrName
     *   POST   {basePath}/sharing/rules/:idOrName/evaluate
     *
     * Returns 501 when no sharing-rule service is configured.
     */
    private registerSharingRuleEndpoints(basePath: string): void {
        // [#23050 slice 4] The body moved to `sharing-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `SharingRuleRouteHost`, and that module's header for why
        // `sharingRulesServiceProvider` is a getter).
        const readSharingRulesServiceProvider = () => this.sharingRulesServiceProvider;
        const host: SharingRuleRouteHost = {
            routeManager: this.routeManager,
            get sharingRulesServiceProvider() { return readSharingRulesServiceProvider(); },
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
        };
        registerSharingRuleEndpoints.call(host, basePath);
    }

    /**
     * Register the security admin endpoints (ADR-0090 D5/D9) — suggested
     * audience bindings. A package permission set declaring `isDefault: true`
     * is an install-time SUGGESTION to give it to every signed-in member;
     * these routes surface the suggestions and let a `manage_metadata` holder
     * (under a wall, the platform operator) decide each once for the whole
     * deployment. The `security` service (plugin-security) does the real
     * gating on all three, and an accept takes effect: the `everyone` anchor's
     * definition is re-derived with the set (#22801 → A) — never auto-bound.
     *
     *   GET  {basePath}/security/suggested-bindings?status=&packageId=
     *   POST {basePath}/security/suggested-bindings/:id/confirm
     *   POST {basePath}/security/suggested-bindings/:id/dismiss
     *
     * Routes return 501 when the `security` service is not registered
     * (deployment without plugin-security). Typed service errors carry their
     * HTTP status (403 permission / 404 not found / 409 state).
     *
     * ## One envelope for every refusal these three routes make (#7981)
     *
     * Every arm below answers the ADR-0112 D5 body — `{ error: { code,
     * message } }`, semantic code nested, HTTP status on the transport — and
     * emits it through the ONE `respondError` helper, so the three cannot
     * drift apart again. Before this they answered three mutually
     * incompatible shapes on routes a single client calls in sequence:
     * `{ error: { code, message } }` from the validation refusals,
     * `{ code, message }` from the 501, and `{ code, error: '<string>' }`
     * from the thrown-service-error arm — the bare-string `error` dialect
     * #7035 (PR #7293) retired from this file's `/meta` 501s. So `error.code`
     * read `undefined` on exactly the arm carrying the typed 403/404/409
     * codes a consumer is most likely to branch on.
     */
    private registerSecurityEndpoints(basePath: string): void {
        // [#23050 slice 6] The body moved to `security-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `SecurityRouteHost`, and that module's header for why
        // `securityServiceProvider` is a getter).
        const readSecurityServiceProvider = () => this.securityServiceProvider;
        const host: SecurityRouteHost = {
            routeManager: this.routeManager,
            get securityServiceProvider() { return readSecurityServiceProvider(); },
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
        };
        registerSecurityEndpoints.call(host, basePath);
    }

    /**
     * Register approval endpoints (ADR-0019: approval as a flow node).
     *
     * Approval is no longer a standalone process engine — a flow's Approval
     * node opens a request and suspends the run; a decision resumes it. There
     * are no process-authoring or submit routes anymore.
     *
     * Routes (all under {basePath}/approvals):
     *   GET    /requests                        — list (filters: status, object, recordId, approverId, submitterId)
     *   GET    /requests/:id                    — get request
     *   POST   /requests/:id/approve            — record an approve decision (resumes the flow)
     *   POST   /requests/:id/reject             — record a reject decision (resumes the flow)
     *   GET    /requests/:id/actions            — audit trail
     *
     * Returns 501 when `approvalsServiceProvider` is unset so deployments
     * without `@objectstack/plugin-approvals` fail cleanly.
     */
    private registerApprovalsEndpoints(basePath: string): void {
        // [#23050 slice 3] The body moved to `approvals-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `ApprovalsRouteHost`, and that module's header for why
        // `approvalsServiceProvider` is a getter).
        const readApprovalsServiceProvider = () => this.approvalsServiceProvider;
        const host: ApprovalsRouteHost = {
            routeManager: this.routeManager,
            get approvalsServiceProvider() { return readApprovalsServiceProvider(); },
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
        };
        registerApprovalsEndpoints.call(host, basePath);
    }

    /**
     * Register batch operation endpoints
     */
    private registerBatchEndpoints(basePath: string): void {
        // [#23050 slice 2] The body moved to `batch-routes.ts`. This literal
        // hands it every member it reads — the list IS its dependency on this
        // class (see `BatchRouteHost`, and that module's header for why
        // `objectQLProvider` alone is a getter).
        const readObjectQLProvider = () => this.objectQLProvider;
        const host: BatchRouteHost = {
            config: this.config,
            routeManager: this.routeManager,
            protocol: this.protocol,
            get objectQLProvider() { return readObjectQLProvider(); },
            resolveProtocol: (...a) => this.resolveProtocol(...a),
            resolveExecCtx: (...a) => this.resolveExecCtx(...a),
            enforceAuth: (...a) => this.enforceAuth(...a),
            enforceApiAccess: (...a) => this.enforceApiAccess(...a),
            enforceBatchSize: (...a) => this.enforceBatchSize(...a),
            loadObjectItem: (...a) => this.loadObjectItem(...a),
        };
        registerBatchEndpoints.call(host, basePath);
    }

    
    /**
     * Get the route manager
     */
    getRouteManager(): RouteManager {
        return this.routeManager;
    }

    /**
     * Record routes a bypassing registrar mounted on this server's host
     * `IHttpServer` (#5822).
     *
     * Called by the composition step that invoked the registrar
     * (`mountAndRecordDirectRoutes`), with the array the registrar returned —
     * which is the array it iterated to mount, so this records what happened
     * rather than what was intended. Nothing here re-derives, re-checks or
     * re-orders that fact; a registrar that was never called reports nothing,
     * which is how "not mounted ⇒ not enumerable" survives.
     */
    recordDirectMountedRoutes(routes: readonly DirectMountedRoute[]): void {
        for (const route of routes) {
            this.directMountedRoutes.push({ ...route, source: 'direct-mount' });
        }
    }

    /**
     * [#6633] The advertised bases for the direct-mount surfaces, derived from
     * the RECORDED mounts themselves — never recomputed from config.
     *
     * This is the load-bearing half of the mounted ⇒ advertised parity
     * (ADR-0076 D12): the registrars mount at whatever base the plugin threads
     * in (since commit fec784863 that is `getApiBasePath()`), the recorder keeps the
     * very arrays they iterated to mount (#5822), and this method projects the
     * advertised `routes.packages` / `routes.datasources` out of those arrays.
     * One expression, two consumers — a future change that moves the mount
     * moves the advertisement with it, and a change that touches only one side
     * goes red on the parity pin
     * (`discovery-advertised-direct-mounts.parity.test.ts`).
     *
     * @param scopedEnvironmentId when the discovery response being built is
     *   served from the environment-scoped mount, the resolved environment id
     *   (or the `:environmentId` placeholder when unresolved); `undefined` for
     *   the unscoped mount.
     */
    getDirectMountRouteBases(scopedEnvironmentId?: string): { packages?: string; datasources?: string } {
        const SCOPED_SEGMENT = '/environments/:environmentId';
        let packagesUnscoped: string | undefined;
        let packagesScoped: string | undefined;
        let datasources: string | undefined;
        for (const { method, path } of this.directMountedRoutes) {
            // [#14503] The package registrar mounts ONE route,
            // `POST {base}/packages/publish`, under the family base; the base
            // is that recorded path minus its `/publish` segment — recognised,
            // never rebuilt. (It used to be keyed on the registrar's own
            // `GET {base}/packages` copy of the list route, removed by #14503:
            // the dispatcher's `/packages` domain is the family's single
            // implementation, and REST's contribution to the family is publish.)
            const publishAt = path.endsWith('/packages/publish') && method === 'POST'
                ? path.length - '/publish'.length
                : -1;
            if (publishAt > 0) {
                const base = path.slice(0, publishAt);
                if (path.includes(SCOPED_SEGMENT)) packagesScoped = base;
                else packagesUnscoped = base;
            }
            // Every federation route sits under
            // `{base}/datasources/:name/external/…`; the advertised base is
            // `{base}/datasources`.
            const extAt = path.indexOf('/datasources/:name/external/');
            if (extAt >= 0 && datasources === undefined) {
                datasources = `${path.slice(0, extAt)}/datasources`;
            }
        }
        // A scoped discovery response advertises the scoped packages mount when
        // one is recorded (with the caller's environment id substituted, the
        // same move the `data`/`metadata` overrides make); the unscoped mount
        // is the answer everywhere else. No cross-over in the unscoped case:
        // advertising a `:environmentId` pattern to an unscoped caller would be
        // a URL nothing can consume.
        const packages = scopedEnvironmentId !== undefined
            ? (packagesScoped?.replace(':environmentId', scopedEnvironmentId) ?? packagesUnscoped)
            : packagesUnscoped;
        return { packages, datasources };
    }

    /**
     * [#6714] The advertised base for the email surface, projected from the
     * RECORDED route registrations — never recomputed from config.
     *
     * Same mounted ⇒ advertised discipline as {@link getDirectMountRouteBases}
     * (ADR-0076 D12), over the other recording: `registerEmailEndpoints`
     * registers `POST {base}/email/send` through the RouteManager, so the
     * RouteManager's table — the very rows the registrar wrote to mount — is
     * the mount fact this method projects. A future change that moves the
     * email mount moves the advertisement with it, and a change that touches
     * only one side goes red on the parity pin
     * (`discovery-advertised-direct-mounts.parity.test.ts`).
     *
     * @param scopedEnvironmentId when the discovery response being built is
     *   served from the environment-scoped mount, the resolved environment id
     *   (or the `:environmentId` placeholder when unresolved); `undefined` for
     *   the unscoped mount.
     * @returns the advertised `routes.email` base (`{mountBase}/email` — the
     *   consumer appends `/send`), or `undefined` when no email route is
     *   recorded for this boot.
     */
    getMountedEmailRouteBase(scopedEnvironmentId?: string): string | undefined {
        const SCOPED_SEGMENT = '/environments/:environmentId';
        const SEND_SUFFIX = '/email/send';
        let unscoped: string | undefined;
        let scoped: string | undefined;
        for (const { method, path } of this.routeManager.getAll()) {
            // The email registrar's send route (`POST {base}/email/send`) IS
            // the surface: the advertised base is the recorded path minus the
            // `/send` leaf — recognised, never rebuilt.
            if (method !== 'POST' || !path.endsWith(SEND_SUFFIX)) continue;
            const base = path.slice(0, -'/send'.length);
            if (path.includes(SCOPED_SEGMENT)) scoped = base;
            else unscoped = base;
        }
        // Same scoped/unscoped selection as the packages projection above: a
        // scoped discovery response advertises the scoped mount when one is
        // recorded (environment id substituted), the unscoped mount answers
        // everywhere else, and an unscoped caller is never handed a
        // `:environmentId` pattern nothing can consume.
        return scopedEnvironmentId !== undefined
            ? (scoped?.replace(':environmentId', scopedEnvironmentId) ?? unscoped)
            : unscoped;
    }

    /**
     * Get all routes mounted for this boot — the whole surface this server
     * knows about, RouteManager's table and the recorded direct mounts alike.
     *
     * This is the introspection seam: the OpenAPI built-in section
     * (`buildBuiltinPaths`), the route-ledger conformance guard and every
     * debugging reader ask exactly this one question. Before #5822 it answered
     * only for `routeManager`, so nine mounted routes — eight of them SDK
     * capabilities — were invisible to all three.
     */
    getRoutes(): MountedRoute[] {
        return [
            ...this.routeManager.getAll().map((route): MountedRoute => ({ ...route, source: 'route-manager' })),
            ...this.directMountedRoutes,
        ];
    }
}
