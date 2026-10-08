// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    IHttpServer, resolveAuthzContext, resolveLocalizationContext, isAuthGateAllowlisted,
    // [commit 6a180e42d] Re-raise a permission-store OUTAGE through the fail-closed nets
    // below instead of degrading it into an anonymous/denied answer.
    rethrowAuthzStoreUnavailable,
    // [#13476] Raised HERE too, at the data-engine seam: an engine that cannot
    // be RESOLVED leaves the caller's permissions equally undetermined, so it
    // takes the same loud answer rather than the quiet 403 it used to wear.
    AuthzStoreUnavailableError,
    // [#13906 / #16013] The ONE classification the tenancy seam applies on
    // BOTH of its wirings: the REGISTRY's own "never registered" brand absorbs
    // the supported no-tenancy composition (never message text, #13905) while
    // every other rejection stays loud. ⛔ The two wirings themselves are NOT
    // the helper's — see `computeExecCtx`.
    classifyAdmissionTenancyPosture,
    // The registry's "never registered" brand, asked directly by the public
    // form doors' tenancy read (see `registerFormEndpoints`).
    isServiceNotRegisteredError,
    assembleExecutionContext, normalizeAuthGate, type AuthGate,
    shouldDenyAnonymous, ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS,
    // [#7678] ADR-0090 D5/D9 suggested-binding `?status=` vocabulary — the one
    // owner, shared with the runtime dispatcher's `/security` domain.
    isAudienceBindingSuggestionStatus, unknownAudienceBindingSuggestionStatusMessage,
    // The write-response rules (credential-class mask, `internal` omit) for
    // the cross-object batch's direct-engine update arm.
    omitInternalFieldsFromWriteResponse,
} from '@objectstack/core';
import {
    isMcpServerEnabled,
    looksLikeInternalErrorLeak,
    declaresServerFault,
    INTERNAL_ERROR_MESSAGE,
    // [#13807] The recogniser half of the stranded-decision carrier — see
    // `handleApprovalError` below. Constructor and reader share one module in
    // `@objectstack/types` because the producer is a PLUGIN and rest cannot
    // import one.
    strandedDecisionDetails,
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
    foldVisibilityFingerprintIntoEtag,
    isObjectSchemaMaskExempt,
    isObjectSchemaMaskingEnabled,
    normalizeIfNoneMatch,
    relateObjectSchemaMaskPosture,
    resolveObjectSchemaMaskPosture,
    OBJECT_SCHEMA_MASK_NOT_APPLICABLE,
    type ObjectSchemaMaskPosture,
    // [#8805] The organization a metadata WRITE carries, given the caller's
    // active one — the SAME predicate the runtime `/metadata` dispatcher calls
    // (`domains/meta.ts`), not a REST-local restatement of it. See the module's
    // own header for why the decision belongs to the caller and why it lives in
    // `metadata-core`.
    organizationIdForMetaRead,
    organizationIdForMetaWrite,
    // [#12702] The capability half of the same decision, from the same home:
    // `manage_metadata` as before, plus `manage_org_presentation` for
    // org-overridable types written org-scoped to the caller's own active
    // organization. One predicate for every `/meta` item write door on both
    // transports — never a REST-local restatement.
    metaWriteCapabilityVerdict,
    type MetaWriteCapabilityVerdict,
    // Which form candidates the anonymous form doors serve — the one rule the
    // metadata protocol also judges organization-scoped `view` writes by.
    anonymousFormIntakeCandidates,
    anonymousFormIntakeWithdrawnIn,
    // [#21476] Whether such a form can take intake on this posture, and why not
    // — the one predicate the runtime authoring gate's advisory reads too.
    anonymousFormIntakePosture,
    anonymousFormIntakeUnavailability,
    anonymousFormIntakeUnavailableMessage,
    anonymousFormObjectName,
    anonymousFormSharingPath,
    // [#21476] The ADR-0106 fingerprint the admin read folds the reason into.
    objectFieldVisibilityFingerprint,
} from '@objectstack/metadata-core';
import { RouteManager, type RouteEntry } from './route-manager.js';
// [#6877] Query-parameter multiplicity. `IHttpRequest.query` declares
// `string | string[]`; the array arm is real (`NodeHttpServer` produces it,
// measured over a socket on #6878) and this file used it as a string at ~50
// read points. Each handler below declares WHICH of its parameters are
// single-valued; genuinely multi-valued ones (`select`, `expand`, `objects`,
// `fields`, `searchFields`, `approverId`) are deliberately never listed.
// [#7390] The filter slot is the one arity judgement the shared normalizer
// structurally cannot make (a filter AST IS an array), so the querystring
// ingress — the only layer that knows it is one — makes it instead.
import { refuseRepeatedQueryParams, assertFilterParamSuppliedOnce } from './query-multiplicity.js';
// [#7527] The other half of the same discipline: a parameter this route does
// not KNOW is refused rather than dropped. See `query-allowlist.ts` for why an
// ignored filter is the one wrong answer a caller cannot detect.
import { refuseUnknownQueryParams } from './query-allowlist.js';
import type { DirectMountedRoute, MountedRouteSource } from './direct-mount.js';
import { RestServerConfig, RestApiConfigParsed } from '@objectstack/spec/api';
// [#11683] The catalog's own floor for "a required `code` and no more specific
// one" — see its use in `registerSharingEndpoints`, where the nested ADR-0112
// envelope declares `code` REQUIRED while the flat classification it re-dresses
// legitimately carries none.
import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
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
// [#20061 / #20062 / #20139] The DECLARED request schemas three query-reading
// doors parse their numeric parameters through — see `readDeclaredQueryNumber`
// below.
import {
    ListImportJobsRequestSchema,
    HistoryMetaItemRequestSchema,
    AuditMetaItemRequestSchema,
} from '@objectstack/spec/api';
// [commit 2a29caa53] Declared request shapes for the meta-read doors below — imported so
// each door's request literal is compiled against the spec contract instead of
// being smuggled past it with `as any` (see `TransportScopedMetaRequest`).
import type {
    GetMetaItemsRequest,
    GetMetaItemRequest,
    GetMetaItemCachedRequest,
    GetMetaItemLayeredRequest,
    PublishMetaItemRequest,
    AuditMetaItemRequest,
    HistoryMetaItemRequest,
    SaveMetaItemRequest,
    DeleteMetaItemRequest,
    GetUiViewRequest,
} from '@objectstack/spec/api';
// [#15866] The same discipline for the DATA doors. Every literal these routes
// assemble is now compiled against the declared request type through
// `ServerScopedDataRequest` below, so a member the contract does not declare is
// a compile error at the call site instead of a payload no schema has seen.
import type {
    FindDataRequest,
    GetDataRequest,
    CreateDataRequest,
    UpdateDataRequest,
    DeleteDataRequest,
    BatchDataRequest,
    CreateManyDataRequest,
    UpdateManyDataRequest,
    DeleteManyDataRequest,
} from '@objectstack/spec/api';
// [#8073] The closed ADR-0112 error vocabulary, so the explain family's single
// refusal emitter types its `code` parameter as the vocabulary rather than as
// `string` — an invented code is a compile error at the call site instead of a
// runtime surprise on whichever arm a test happens to drive.
import type { ErrorCode } from '@objectstack/spec/api';
// The async-import row ceiling has exactly one definition, in the spec, whose
// TSDoc is its public statement (commit a92b1793c). rest is the only enforcer, so it reads
// that export rather than re-declaring the literal beside a "mirrors spec" comment.
import { IMPORT_JOB_MAX_ROWS } from '@objectstack/spec/api';
// [#10235] The per-column sortability projection the object read serves on its
// envelope (2026-08-23 ruling, option A): computed HERE, at the one seam every
// single-item read path rebuilds its body through, from the spec's own storage
// predicates — so the signal the grid reads cannot drift from what the runtime
// doors (#6994/#7095) refuse.
import { PUBLIC_FORM_SERVER_MANAGED_FIELDS } from '@objectstack/spec/security';
import { PLURAL_TO_SINGULAR, canonicalMetaUrlType } from '@objectstack/spec/shared';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
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
 */
export type RestProtocol = DataProtocol & MetadataProtocol;

/**
 * [commit 2a29caa53] Typed TRANSPORT envelope for the meta-read doors.
 *
 * `environmentId` is the multi-kernel routing key, and it is OUT of the
 * protocol request shape **by explicit maintainer decision** (ruling recorded
 * 2026-08-18, landed as commit 2a29caa53): `resolveProtocol(environmentId)` selects the target
 * kernel *before* the protocol call, and the implementation's parameter types
 * (`@objectstack/metadata-protocol`) never read it off the request — the spec
 * schemas (`protocol.zod.ts`) record the same exclusion schema-side. The doors
 * here still spread it into the outgoing payload (long-standing wire shape,
 * deliberately unchanged by the ruling), so this alias declares that one
 * transport-level member on top of the declared request type. The point is
 * what it makes the compiler do: every OTHER key in a door's request literal
 * is now checked against the spec contract — an undeclared member is a compile
 * error at the call site, not a cast-and-hope. Never add protocol members
 * here; a key that belongs to the request belongs in the spec schema.
 *
 * [commit 45862a53d] The same typing now covers the NON-door `getMetaItems` helper call
 * sites in this file (the object, book, doc, view and dataset listings). Two
 * spellings those sites carry deliberately SURVIVE the tightening, because
 * retiring either would change behaviour rather than typing:
 *
 *   - The OPTIONAL CALL (`getMetaItems?.(…)`) and the
 *     `typeof … === 'function'` guards. `getMetaItems` is a REQUIRED
 *     `MetadataProtocol` member, so these are not feature detection in the
 *     type sense — but a host may occupy the protocol slot with an object
 *     that does not implement the whole surface, which is the measured reason
 *     they exist (`metaTypeIsLive` documents the same deliberate spelling for
 *     `getMetaTypes`). Retiring one turns a tolerated absence into a
 *     `TypeError`.
 *   - The RESULT handling. `getMetaItems` is declared to return
 *     `{ type, items }`, while these sites also tolerate the bare-array shape
 *     older hosts and stubs return (see `metaItemsArray`), so the response
 *     stays runtime-shaped on purpose.
 *
 * The REQUEST is what is fully typeable today, and the request is what is
 * typed — which is the whole point: an undeclared key in one of these
 * literals is now a compile error instead of a cast-and-hope.
 */
type TransportScopedMetaRequest<R> = R & { environmentId?: string };

/**
 * [#15866] The DATA doors' sibling of {@link TransportScopedMetaRequest}, and
 * the reason it is a SECOND alias rather than a widening of the first: the data
 * routes layer on TWO server-side members, and only one of them is the meta
 * doors' transport key.
 *
 *   - `environmentId` — identical to the meta case and covered by the same
 *     ruling (2026-08-18, commit 2a29caa53): `resolveProtocol(environmentId)` picks the
 *     target kernel BEFORE the call, `@objectstack/metadata-protocol`'s data
 *     methods never read it off the request, and `protocol.zod.ts` records the
 *     exclusion schema-side. The doors still spread it (long-standing wire
 *     shape), so it is declared here rather than smuggled past the compiler.
 *   - `context` — the SERVER-DERIVED execution context from
 *     {@link RestServer.resolveExecCtx}. The implementation genuinely reads it
 *     (`findData`/`getData`/`createData`/`updateData`/`deleteData` all declare
 *     `context?: any` and forward it so the RBAC/RLS middleware can enforce),
 *     so unlike `environmentId` it IS consumed — but it still must not join the
 *     request schema, because that schema is the catalog's published
 *     `requestSchema` and a CALLER-supplied `context` is a privilege escalation:
 *     `metadata-protocol.findData` deletes any inbound `context` unconditionally
 *     for exactly that reason (`if (opCtx.context?.isSystem) return next()`
 *     skips the whole RLS/FLS/CRUD chain). Declared-here is what keeps it
 *     server-only AND compiled.
 *
 * ⛔ Never add a third member here to make a literal fit. A key a caller may
 * send belongs in the spec schema; a key the door invents belongs in neither.
 * What this buys is the guard #15866 was filed for: a field ADDED to
 * `DeleteDataRequestSchema` / `UpdateDataRequestSchema` (and their siblings)
 * as REQUIRED now reddens this file at build, naming the door that would
 * otherwise have gone on not sending it.
 *
 * ⚠️ Scope of the restored check, stated so it is not overread: these handlers
 * declare `req: any`, so every key sourced from `req` is `any` on the way in.
 * What the compiler regains here is the KEY SET — an undeclared member (TS2353)
 * and a missing required member (TS2739/TS2741) — not the value types of keys
 * read off the request bag.
 *
 * ⭐ [#16337] The one slot this alias could NOT cover is now covered too, and
 * the helper that covered for it is gone. #15866 left three server-built
 * `findData` literals — the import-job listing, the export chunk loop and the
 * public reference picker — speaking the UNDECLARED wire dialect (`$filter`,
 * `$top`, `$skip`, `$orderby`, `$expand`, `filters`, `select`, `sort`) and
 * routed them through a `wireDialectQuery` helper that cast the `query` member
 * to `FindDataRequest['query']`. All three now build the CANONICAL QueryAST
 * (`object`, `where`, `orderBy`, `limit`, `offset`, `fields`, `expand`), so the
 * `query` slot compiles against the declared contract like every other member
 * and the helper has been retired with this card.
 *
 * ⚠️ The rewrite is a spelling change ONLY, and that is measurable rather than
 * asserted: `@objectstack/metadata-protocol`'s `findData` folds every alias
 * spelling onto the canonical key by the spec's own table
 * (`RPC_QUERY_ALIAS_SLOTS`) and moves the value verbatim, so both dialects
 * reach `engine.find` as the same option bag. `rest-server-canonical-query-ast
 * .test.ts` drives the before/after pairs through the real normalizer and
 * asserts that equality, so a future edit that changes the option bag while
 * still compiling reddens there.
 *
 * ⛔ Server-built means server-built: the wire aliases stay accepted at the
 * HTTP door for CALLERS. Declaring them there is #16066's spec half and is not
 * this file's business.
 */
type ServerScopedDataRequest<R> = R & { environmentId?: string; context?: unknown };

import {
    buildFieldMetaMap,
    referenceFieldNames,
    headerLabel,
    formatRowCells,
    formatRowForJson,
    cellFontColor,
    exportContentDisposition,
    type ExportFieldMeta,
} from './export-format.js';
import { runImport } from '@objectstack/core';
import { prepareImportRequest } from './import-prepare.js';
// [#17551] The `POST …/analytics/dataset/query` door parse — the half of the
// analytics family this route never had. See the module header for the
// measurement that decides its shape.
import { datasetSelectionRefusal } from './analytics-selection-door.js';
import { loadExcelJs, type Worksheet } from './xlsx-module.js';
// [#18386] `?template=true` on the export door: the import template's column
// rule, request reading and workbook. See the module header.
import {
    buildImportTemplateWorkbook,
    describeTemplateColumns,
    readTemplateMode,
    resolveTemplateProjection,
    templateColumns,
    templateText,
    type TemplateProjectionSource,
} from './import-template.js';
import { enrichOpenApiWithEndpoints } from './openapi-endpoints.js';
import { buildBuiltinPaths } from './openapi-builtin-paths.js';
import {
    isEndpointMatchAuthority,
    selectServedEndpoints,
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
    sandboxBusinessMessage,
    classifiedRefusalAnswer,
    boundedDeclaredUserMessage,
    boundedDeclaredRefusalMessage,
    declaredHttpStatus,
    declaredServerFaultAnswer,
    sendThrownError,
    sendDeclaredFault,
    sendFieldVisibilityFault,
    handleRouteError,
    thrownAnswerIsBareNotFound,
    logUnexpectedRouteError,
    isExpectedRouteError,
    applyDroppedFieldsHeader,
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
const UNDECLARED_WHOLE_NUMBER_PARAM = z.number().int().optional();

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
function readDeclaredQueryNumber(
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
 * below rewrites only the first half to the paths this server actually mounts.
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
const IMPORT_JOB_OBJECT = 'sys_import_job';
/** Cap on per-row results persisted on the job (failures first). */
const IMPORT_JOB_RESULTS_CAP = 500;
/** Undo (logical rollback) is only recorded for jobs at or under this row
 *  count — larger jobs skip the undo log to bound the stored before-snapshots. */
const IMPORT_JOB_UNDO_MAX_ROWS = 5_000;

/** Generate a sortable-ish, collision-resistant import job id. */
function newImportJobId(): string {
    return `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Cap a results list to {@link IMPORT_JOB_RESULTS_CAP}, keeping failures first. */
function capImportResults(results: Array<{ ok: boolean }>): { items: any[]; truncated: boolean } {
    if (results.length <= IMPORT_JOB_RESULTS_CAP) return { items: results, truncated: false };
    const failures = results.filter(r => !r.ok);
    const successes = results.filter(r => r.ok);
    const items = [...failures, ...successes].slice(0, IMPORT_JOB_RESULTS_CAP);
    return { items, truncated: true };
}

/** Parse the persisted undo log (json column may arrive as object or string). */
function parseUndoLog(raw: any): { created: string[]; updated: Array<{ id: string; before: Record<string, any> }> } | undefined {
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
function importJobUndoable(row: any): boolean {
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
function importJobToProgress(row: any): Record<string, any> {
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
function importJobToSummary(row: any): Record<string, any> {
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
 */
function formatCsvCell(value: any): string {
    if (value === null || value === undefined) return '';
    let s: string;
    if (typeof value === 'string') s = value;
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
 * display values (lookup names, select labels, 是/否, formatted dates). With an
 * empty map the output is byte-identical to the raw, un-formatted behaviour.
 *
 * `timezone` (#8373) is the caller's business timezone, used to render
 * `datetime` cells in the same clock the UI shows; absent, they render in UTC.
 */
function rowsToCsv(
    fields: string[],
    rows: Array<Record<string, any>>,
    includeHeader: boolean,
    metaMap: Map<string, ExportFieldMeta>,
    timezone?: string,
): string {
    const lines: string[] = [];
    if (includeHeader) lines.push(fields.map(f => formatCsvCell(headerLabel(f, metaMap))).join(','));
    for (const row of rows) {
        lines.push(formatRowCells(row, fields, metaMap, timezone).map(formatCsvCell).join(','));
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
async function createXlsxStream(res: any, useStyles = false): Promise<{
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
async function seamOrUndefined<T>(call: () => T | PromiseLike<T>): Promise<T | undefined> {
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
async function wiredEngineOrLoud<T>(
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

/**
 * [#15685] The `/meta/:type/:name/references` door's PROTOCOL-RAISED refusal,
 * re-dressed in the ADR-0112 NESTED envelope that door's other refusal exit
 * already publishes. Answers `undefined` for everything else, so the caller
 * keeps `handleRouteError` for the rest.
 *
 * ## The defect this closes
 *
 * The door can refuse in two ways and, measured on one boot, the two answers
 * agreed on neither the envelope nor the message:
 *
 * ```
 * A  protocol-raised, unanswerable TARGET type (#9327)
 *    501 {"error":"Internal server error","code":"NOT_IMPLEMENTED"}
 * B  the resolved kernel has no `findReferencesToMeta` at all (#9326)
 *    501 {"error":{"code":"NOT_IMPLEMENTED","message":"protocol.findReferencesToMeta() is not available in this kernel"}}
 * ```
 *
 * Two facts are lost on A, and both of them are the operator's:
 *
 *  1. **The PRESCRIPTION.** A's message is not decoration — `findReferencesToMeta`
 *     says so in as many words ("The message is prescriptive per ADR-0110 D3:
 *     it names the answerable question"). It tells the operator what to ask
 *     INSTEAD: `Ask the owning object instead: GET /api/v1/meta/object/<owner>/references`.
 *     That sentence is what keeps "the question was never asked" from being
 *     read as "nothing depends on this item" — the whole of ADR-0110 D3
 *     (#8896), in front of an operator whose next click is a delete, because
 *     the admin "Used by" panel renders its empty case as "Nothing in the
 *     metadata graph points at this item. Safe to delete." On the wire the
 *     sentence was replaced by "Internal server error".
 *  2. **The `code`'s POSITION.** `body.error.code` reads on B and `undefined`
 *     on A. This door's own comment on the B branch warns against precisely
 *     that dialect ("never the bare-string or sibling-`code` dialects, which
 *     make `body.error.code` read `undefined`") — so the route was violating
 *     its own written rule at its other exit, reached by a different path.
 *
 * ## Why the repair is HERE and not at the relay
 *
 * A reaches the wire through `handleRouteError` → {@link declaredServerFaultAnswer},
 * which keeps `status` and `code` and replaces the prose with
 * `INTERNAL_ERROR_MESSAGE`. That arm is correct and argued for a server FAULT
 * (#11718, #5582) — a fault message may carry driver internals, and withholding
 * it is the point. What it cannot see is that a producer-declared 5xx might be
 * a deliberate REFUSAL whose message is authored FOR the caller. Teaching it
 * that distinction would change platform-wide behaviour for every
 * producer-declared 5xx at every door; that is a maintainer's decision and is
 * handed back as its own finding, not taken here. This arm is the bounded half:
 * ONE door, re-dressing ONE refusal in the dialect it already publishes.
 *
 * ⛔ It is therefore NOT a general "5xx prose is relayed now" rule, and the
 * three conditions below are what keep it from becoming one.
 *
 * ## The three conditions, and why each is exactly this narrow
 *
 *  - **`501`**, read through {@link declaredHttpStatus} so both declaration
 *    spellings (`status` / `statusCode`, #7525) reach the same verdict rather
 *    than through a fourth local opinion about which field declares a status.
 *  - **`code === 'NOT_IMPLEMENTED'`**, the literal this route already publishes
 *    on its B exit. Matching the LITERAL rather than "any declared code" is
 *    also how the #9232 vocabulary narrowing is honoured by CONSTRUCTION: an
 *    unregistered producer spelling can never reach this exit, so no second
 *    copy of `thrownCodeFields`' demotion rule is needed and no new door ships
 *    an un-narrowed code. ⚠️ The cost is stated rather than hidden: a future
 *    SECOND refusal code on this route would fall back to the flat fault answer
 *    until whoever adds it comes here. That is a visible, one-line extension,
 *    not a silent gap.
 *  - **A DECLARED refusal.** [#16146] This was "a non-empty message", and it
 *    was this arm's own opinion about which producer-declared 5xx keeps its
 *    prose — the very question the relay could not answer when this was
 *    written. It can now: the director seat ruled the distinction a
 *    producer-side declaration on the published ADR-0112 envelope (decision
 *    batch #58, 2026-09-06, option C) and the producer sets it
 *    (`findReferencesToMeta`, `metadata-protocol`). So the condition is
 *    {@link boundedDeclaredRefusalMessage} — the shared relay's own answer,
 *    bound and all — and this route holds no refusal/fault opinion of its own
 *    any more.
 *
 * ## [#16146] What was RETIRED here, and the one half that could not be
 *
 * The ruling says to retire this route-local patch once the relay handles
 * `/references`, and its PROSE half is retired exactly as ruled: the sentence
 * now reaches the wire because the relay keeps it at EVERY door, the bound is
 * the shared one rather than this arm's unbounded pass-through, and deleting
 * the call below would change no message on this route.
 *
 * ⚠️ What deleting it WOULD change is the ENVELOPE, and that is a different
 * decision. This function also re-dresses the answer into the NESTED ADR-0112
 * envelope this door's B exit publishes; the relay is flat
 * (`{ error, code }` through `handleRouteError`), so removing this arm would
 * put `body.error.code` back to `undefined` on the A exit and re-open the
 * SECOND half of the defect #15685 measured and pinned positionally in
 * `rest-server-meta-references-refusal-envelope.test.ts`. Envelope POSITION is
 * owned by the `check:route-envelope` ratchet and is explicitly a separate
 * line from vocabulary (ADR-0112's #9232 amendment says so in as many words),
 * so it is not folded into a prose ruling. What remains here is therefore a
 * pure position adapter over the shared answer — ⛔ not a second withhold arm,
 * and ⛔ not a place to add a refusal rule.
 *
 * ⛔ And it does not re-derive `REFERENCE_SITES.unanswerableTargetTypes` to
 * decide whether the target was answerable. That set, its canonical-type fold
 * and its refusal all belong to `findReferencesToMeta`; a second copy at the
 * transport is the tolerant-consumer direction, and it would drift the moment
 * the set changed. The route reads what the protocol DECLARED, which is what a
 * transport is for.
 */
function notImplementedRefusalAnswer(
    error: any,
): { status: number; body: { error: { code: string; message: string } } } | undefined {
    if (declaredHttpStatus(error) !== 501) return undefined;
    if (error?.code !== 'NOT_IMPLEMENTED') return undefined;
    const message = boundedDeclaredRefusalMessage(error);
    if (message === undefined) return undefined;
    return { status: 501, body: { error: { code: 'NOT_IMPLEMENTED', message } } };
}

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
function sendMetaItemAbsent(res: any): void {
    res.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Metadata item not found or access denied.' },
    });
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
function mayReadPendingDrafts(caller: unknown): boolean {
    return isObjectSchemaMaskExempt(caller);
}

/**
 * [#22114] The ADR-0008 pin `PUT /meta/:type/:name` reads off its request
 * headers: `parentVersion` for `saveMetaItem` — the `If-Match` token (ETag-style
 * quotes stripped), `null` for `If-None-Match: *` ("no row of this lifecycle
 * is here", the first-write pin the protocol has always declared), or
 * `undefined` for neither (unpinned, last-write-wins, as before) — or the
 * sentence of a `400` for a pin that cannot be honoured.
 *
 * `If-None-Match` is read on this route from the day it lands with a CLOSED
 * value set, `*` alone (AGENTS.md 〈Route & surface ownership〉 rule 5's reason,
 * one carrier over): a header read for the values it knows and dropped
 * otherwise would write a caller unguarded who asked for a guard. Measured
 * before it landed: no first-party client sends `If-None-Match` on a `PUT`
 * (the SDK sends it only on its cached `GET`, objectui's ETag hook has no
 * caller), and nothing on this path read it. Two refusals, both `400`:
 *
 *  - a value other than `*` — an entity-tag list asks "write unless the head is
 *    one of these", a condition no `/meta` client has and this door does not
 *    evaluate;
 *  - `If-None-Match` beside `If-Match` — the pair can never hold (RFC 9110
 *    §13.2.2 evaluates both: `If-Match` true needs a current row, `*` true
 *    needs none), and a `409` would send the caller round a re-read that
 *    serves a token it would pair with `*` again.
 */
function metaSavePreconditionPin(headers: Record<string, unknown> | undefined):
    | { ok: true; parentVersion?: string | null }
    | { ok: false; message: string } {
    const ifMatch = headers?.['if-match'] ?? headers?.['If-Match'];
    const ifNoneMatch = headers?.['if-none-match'] ?? headers?.['If-None-Match'];
    if (ifNoneMatch !== undefined) {
        if (ifMatch !== undefined) {
            return {
                ok: false,
                message: 'Send If-Match or If-None-Match, not both. If-Match: <version> saves only over that '
                    + 'version; If-None-Match: * saves only where no row of this lifecycle exists. A row '
                    + 'cannot both exist and not exist, so this pair can never be honoured.',
            };
        }
        if (typeof ifNoneMatch !== 'string' || ifNoneMatch.trim() !== '*') {
            return {
                ok: false,
                message: 'If-None-Match on this route takes "*" alone (save only if no row of this lifecycle '
                    + 'exists). To pin a save to the version you read, send it as If-Match: <version>.',
            };
        }
        return { ok: true, parentVersion: null };
    }
    if (typeof ifMatch === 'string') return { ok: true, parentVersion: ifMatch.replace(/^"|"$/g, '') };
    return { ok: true };
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
 */
function metaItemPackageBinding(raw: unknown): string | undefined {
    return typeof raw === 'string' && raw !== '' && raw !== 'all' ? raw : undefined;
}

/**
 * [#20378 · #20441] THE AUTHORING-DOOR REFUSAL — ruling 5865708652 (letter B),
 * carried to `/audit` by triage's grade 5871509797. Sends it and answers `true`
 * when {@link mayReadPendingDrafts} does not admit `caller`; answers `false`,
 * sending nothing, when it does. The `refuseRepeatedQueryParams` convention:
 * `if (refuseNonAuthoringCaller(ctx, res, …)) return;`.
 *
 * The item-scoped doors that read an AUTHORING LOG ask it first, before the
 * protocol is resolved, before the query is parsed and before any item or
 * event is read: `/history` and `/diff` read `sys_metadata_history`, and
 * `/audit` reads `sys_metadata_audit`. Both logs record a DRAFT save exactly
 * as they record an active one, so they have no published-only answer to fall
 * back to, and a caller who may not read pending drafts is refused as
 * `GET /meta/_drafts` refuses them: 403 `FORBIDDEN`, the same nested
 * envelope. The answer is the same for an item that exists, one that does
 * not and a draft-only one, so the door is no existence oracle.
 *
 * `reading` names THE DOOR and never drafts: a refusal worded about drafts
 * would read as "this item has one". This is ONE function so the three doors
 * cannot drift apart in their predicate, status, code or envelope; only the
 * door's own name differs between them.
 */
function refuseNonAuthoringCaller(caller: unknown, res: any, reading: string): boolean {
    if (mayReadPendingDrafts(caller)) return false;
    res.status(403).json({
        error: {
            code: 'FORBIDDEN',
            message: `${reading} requires an authoring capability (studio.access, setup.access or manage_metadata).`,
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

/** [#21331] The organization an anonymous form request reads the form in (`defaultOrgId()`). */
async function anonymousFormOrganization(tenancy: any): Promise<string | undefined> {
    if (!tenancy || typeof tenancy.defaultOrgId !== 'function') return undefined;
    const organizationId = await tenancy.defaultOrgId();
    return typeof organizationId === 'string' && organizationId ? organizationId : undefined;
}

/**
 * [#21476] Put the admin read's intake reasons in `_diagnostics.warnings`, where
 * a derived view warning already goes (`stampRenameWarning`). A declared read
 * decoration, so a GET then PUT round trip never stores it.
 */
function stampAnonymousFormIntakeWarnings(
    document: any,
    warnings: ReadonlyArray<{ path: string; message: string }>,
): any {
    if (warnings.length === 0 || !document || typeof document !== 'object') return document;
    const prior = document._diagnostics;
    const diagnostics: Record<string, any> = prior && typeof prior === 'object' ? { ...prior } : { valid: true };
    diagnostics.warnings = [...(Array.isArray(prior?.warnings) ? prior.warnings : []), ...warnings];
    return { ...document, _diagnostics: diagnostics };
}

/** [#21476] Those reasons' ETag dimension; empty when there is none (the ADR-0106 D3 fold). */
function anonymousFormIntakeFingerprint(warnings: ReadonlyArray<{ path: string; message: string }>): string {
    return objectFieldVisibilityFingerprint(warnings.map((w) => JSON.stringify([w.path, w.message])));
}

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
     * Reject anonymous requests with HTTP 401 — unconditionally (#3963: the
     * `api.requireAuth` opt-out is retired). Returns `true` if the response was
     * sent and the caller should stop
     * processing. Returns `false` to continue.
     *
     * The check is intentionally narrow: only `context?.userId` counts as
     * "authenticated". `isSystem` flags are never set on inbound HTTP
     * requests (they're internal-only), so they cannot bypass this gate.
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
     *     other than the one resolved.
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
        opts?: ApiAccessOpts,
    ): Promise<boolean> {
        const objectName = req?.params?.object;
        if (!objectName) return false;
        const items = await this.loadObjectItems(p, environmentId);
        const obj = items.find((o: any) => o?.name === objectName);
        // [#3770] Unknown object → no declared exposure policy to enforce here;
        // the data path's registry gate 404s it. See the doc comment above.
        if (!obj) return false;
        const denial = apiAccessDenialFromEnable(obj.enable, objectName, operation, opts);
        if (denial) {
            res.status(denial.status).json(denial.body);
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
        if (await this.enforceApiAccess(req, res, p, environmentId, 'import')) return true;
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
     * Load the object metadata items for the current protocol/environment,
     * coerced to a plain array — `loadObjectItems` in
     * `./meta-item-read-gate.ts` (fail OPEN and logged, #3545). Shared by
     * `enforceApiAccess` (one object), the cross-object batch route (all ops,
     * fetched once) and the nav-servability gate.
     */
    private async loadObjectItems(p: RestProtocol, environmentId: string | undefined): Promise<any[]> {
        return metaReadGate.loadObjectItems(this.metaListSource(p, environmentId));
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
     * publish, rollback, compound save).
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
            // The auth service may be the AuthManager wrapper (which exposes
            // `getApi()`) or the raw better-auth instance (which exposes
            // `.api` directly). Normalize to the raw API object.
            let api: any = authService.api;
            if (!api && typeof authService.getApi === 'function') {
                api = await authService.getApi();
            }
            if (!api?.getSession) return undefined;

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

            // Resolve the data engine for this scope (shared by the resolver below).
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

            // Delegate ALL identity + role/permission/RLS aggregation to the SINGLE
            // shared resolver (`resolveAuthzContext`, @objectstack/core) — the same one
            // the runtime dispatcher uses, so the REST and dispatcher entry points can
            // never drift on authorization. (This path previously kept its own copy that
            // silently omitted sys_user_position / sys_position_permission_set / platform_admin /
            // ai_seat — see the resolver's module doc.)
            const getSession = async (h: any) => {
                try { return await api.getSession({ headers: h }); } catch { return undefined; }
            };
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
            // [#16013] The CLASSIFICATION below is one shared function, not two
            // hand-written copies: `classifyAdmissionTenancyPosture` answers
            // quiet `undefined` for the branded "never registered" (the
            // supported no-tenancy composition, no posture-conditional refusal)
            // and raises `AuthzStoreUnavailableError('tenancy', err)` for every
            // other rejection — the same loud answer `wiredEngineOrLoud` gives
            // the engine seam, carried to the door by the same nets, because
            // the posture is an authorization INPUT and admission was never
            // decided. ⛔ The WIRING branch is NOT shared and must not become
            // so: which of the two wirings may be asked is this file's fact
            // alone, for the reason spelled out in the `else if` below.
            let tenancyPosture;
            if (kernel && typeof kernel.getServiceAsync === 'function') {
                tenancyPosture = await classifyAdmissionTenancyPosture(
                    () => kernel.getServiceAsync('tenancy') as any,
                );
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
                tenancyPosture = await classifyAdmissionTenancyPosture(
                    () => this.tenancyServiceProvider!(environmentId) as any,
                );
            }
            const authz = await resolveAuthzContext({ ql, headers, getSession, tenancyPosture });
            // [commit f586f1a89] The anonymous contract IS the shared assembler's default
            // entry: no resolved principal → no context → 401. Taken early here
            // only so an anonymous request does not pay for the localization and
            // auth-gate reads it would never use; `assembleExecutionContext`
            // below re-affirms the same rule.
            if (!authz.userId) return undefined;

            const settings = this.settingsServiceProvider
                ? await seamOrUndefined(() => this.settingsServiceProvider!(environmentId))
                : undefined;
            const localization = await resolveLocalizationContext({
                ql,
                settings,
                tenantId: authz.tenantId,
                userId: authz.userId,
            });

            // ADR-0069 — authentication-policy gate posture. Only when a gate
            // feature is active (cheap sync check) do we re-read the session for
            // its `user.authGate` (computed in customSession). enforceAuth() then
            // blocks protected resources for a gated user. Zero cost when off.
            //
            // [#7280] Normalized through the shared `normalizeAuthGate` instead
            // of copied verbatim: the session user crosses an external boundary
            // as `any`, and `ExecutionContext.authGate` now DECLARES the shape
            // (`{ code, message }`), so this is where the declaration is met —
            // a gate with a blank message no longer rides into a 403 body as
            // `undefined`.
            //
            // [#13906 — maintainer ruling 2026-09-02, decision 2 option B] The
            // gate is best-effort NO LONGER in one precisely measured window:
            // `isAuthGateActive()` answered `true` AND the gate's session
            // re-read then FAILED. Measured before the repair, same fixture,
            // the wiring differing only in how the gate faulted:
            //
            // | gate wiring                        | before | after |
            // |:--|:--|:--|
            // | INACTIVE (the common, correct case)| admitted | admitted — unchanged |
            // | ACTIVE, healthy re-read, gated user| 403 code+message | 403 — unchanged |
            // | `isAuthGateActive()` THROWS        | admitted | admitted — unchanged |
            // | ACTIVE, re-read FAILS              | **admitted** | **503** |
            //
            // ⇒ an enforcement the deployment DECLARED active used to vanish
            // with no wire trace, deep-equal to gate-off. A declared promise
            // that disappears silently is the fail-OPEN this card measured.
            //
            // ⛔ The probe-throws row stays absorbed DELIBERATELY, and it is the
            // narrowness the ruling asked for: a host whose probe faults never
            // answered `true`, so it never declared a gate, and refusing on it
            // would block deployments that never asked for one.
            let authGate: AuthGate | undefined;
            let gateActive = false;
            try {
                gateActive = typeof authService.isAuthGateActive === 'function'
                    && authService.isAuthGateActive() === true;
            } catch {
                gateActive = false;
            }
            if (gateActive) {
                let gatedSession: any;
                try {
                    // ⛔ NOT the `getSession` closure above, and not its
                    // `.catch(() => undefined)`: both convert a THROW into the
                    // same `undefined` a gate-less user produces, which is
                    // precisely the collapse being repaired. A session that
                    // RESOLVES carrying no gate is not a failure — that user is
                    // simply not gated, and still admits.
                    gatedSession = await api.getSession({ headers });
                } catch (err) {
                    throw new AuthzStoreUnavailableError('auth_gate', err);
                }
                authGate = normalizeAuthGate(gatedSession?.user) ?? undefined;
            }

            // [commit f586f1a89 — maintainer ruling 2026-08-08, Option A] The assembly of
            // the ExecutionContext itself is now the SINGLE shared one
            // (`assembleExecutionContext`, @objectstack/core), the same module
            // the runtime / MCP dispatcher assembles through. Before this, the
            // step AFTER `resolveAuthzContext` was two hand-written copies and
            // the copies drifted: #6071 (this face never set `principalKind`,
            // so every enforcement judgment reading it was silently never-true
            // here) and commit 8e13ca876 / #6551 (a dropped `accessible_org_ids` produced
            // real 403s on the share-link faces). The field set is closed by
            // type there, so a new `ExecutionContext` field cannot land on one
            // face and miss another.
            //
            // This face takes the FAIL-CLOSED DEFAULT entry — no resolved
            // principal → no context → `enforceAuth` answers 401. The runtime
            // face takes the explicit guest entry instead. Both behaviours are
            // unchanged; the divergence is now named API rather than drift.
            const base = assembleExecutionContext({
                authz,
                // OAuth access tokens are honoured on the `/mcp` door alone
                // (`acceptOAuthAccessToken`), precisely so coarse tool-family
                // scopes cannot ride onto REST — so `principalKind: 'agent'`,
                // `onBehalfOf` and `oauthScopes` are not representable here.
                oauth: undefined,
                localization,
                // [#3957] The request's OWN locale wins over the workspace
                // default; the precedence itself lives in the shared assembler.
                requestLocale: this.extractLocale(req),
                // A NAMED divergence, deliberately preserved (commit f586f1a89): this
                // transport has never carried the better-auth session bearer on
                // the envelope, and `ExecutionContext.accessToken` is a
                // PUBLISHED hook surface (`session.accessToken`, hook.zod.ts).
                // Widening it to a second transport is a product decision, not
                // a refactor — so REST withholds it on the record.
                accessToken: undefined,
                // [ADR-0069 / #7280] This face DOES carry the gate: its consumer
                // is ten lines up (`enforceAuth` → 403 `{ code, message }`). It
                // used to be spread on AFTER assembly behind an `as any`, which
                // is precisely how it stayed outside the closed field set; it is
                // a declared `ExecutionContext` field and an assembler input now.
                authGate,
            });
            // Unreachable: the anonymous early-return above already took this
            // branch. Kept because the shared entry — not this method — is the
            // authority on what an anonymous request yields.
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
                // comparison at the UI-view seam. ⚠️ Unlike `__kernel` this one IS
                // an authorization input, at exactly one reader
                // (`enforceEnvironmentOwnership`); it is deliberately NOT an
                // `ExecutionContext` field, because it describes how the context
                // was OBTAINED rather than what the principal may do, and nothing
                // downstream of this transport may branch on it.
                __authEnvironmentId: authEnvironmentId,
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
     *  - `docs-audience` — {@link sendDeclaredFault}, `401 UNAUTHENTICATED` /
     *    `403 PERMISSION_DENIED` (ADR-0046 §6.7).
     */
    private static sendMetaReadRefusal(res: any, refusal: MetaItemReadRefusal): void {
        switch (refusal.reason) {
            case 'absent':
                sendMetaItemAbsent(res);
                return;
            case 'app-permission':
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
                    mayWriteItem: RestServer.metaSaveVerdict(caller, req.params.type).allowed,
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
     */
    private metaListSource(p: RestProtocol, environmentId: string | undefined): MetaReadGateListSource {
        return {
            listMetaItems: (type) => {
                const listRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                    type,
                    ...(environmentId ? { environmentId } : {}),
                };
                return p.getMetaItems?.(listRequest);
            },
        };
    }

    /**
     * [#20156] The CURRENT document of `:type/:name`, fetched the way the plain
     * read's uncached arm fetches it — same request shape, same org partition
     * ({@link organizationIdForMetaRead} over the folded type) — for a door that
     * serves no document of its own (`/history` and `/audit` serve events,
     * `/diff` a comparison) and so judges the item the plain read would judge.
     * `undefined` when nothing is behind the name.
     */
    private async fetchCurrentMetaDocument(
        environmentId: string | undefined,
        req: any,
        p: RestProtocol,
    ): Promise<any | undefined> {
        const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
        const organizationId = organizationIdForMetaRead(
            // [folded-type commit 26f3588fb] (the original card no longer
            // resolves) FOLDED, not raw — see the PUT door's org-scope comment.
            canonicalMetaUrlType(req.params.type), ctx?.tenantId,
        );
        const currentRequest: GetMetaItemRequest = {
            type: req.params.type,
            name: req.params.name,
            ...(organizationId ? { organizationId } : {}),
        };
        const envelope = await p.getMetaItem(currentRequest) as Record<string, any>;
        return envelope?.item ?? undefined;
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
     */
    private async eventDoorRefusal(
        environmentId: string | undefined,
        req: any,
        p: RestProtocol,
    ): Promise<((res: any) => void) | undefined> {
        const metaType = RestServer.metaTypeSingular(req.params.type);
        const policy: MetaReadGatePolicy = { arms: 'per-caller', app: 'gate' };
        if (!RestServer.gatesPerCaller(metaType)) return undefined;
        const current = await this.fetchCurrentMetaDocument(environmentId, req, p);
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
     * and no new failure mode. `dashboard` is never judged per caller (its gate
     * answers per deployment). `app` always is: an app the plain read refuses
     * WHOLE is refused on every door, to an author as to anyone (ruling
     * 5856774816), and a non-author is served it pruned.
     */
    private static gatesPerCaller(metaType: string): boolean {
        return metaType === 'book' || metaType === 'doc' || metaType === 'app';
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
     * item and the scope, the same for every admitted caller). `rawType` is
     * the URL segment, folded here at the boundary ([folded-type commit
     * 26f3588fb] — see the PUT door's org-scope comment) so the verdict and
     * the door's scope decision read one spelling; the organization is the
     * context's `tenantId`, the very value `organizationIdForMetaWrite`
     * threads.
     */
    private static metaSaveVerdict(ctx: any, rawType: string): MetaWriteCapabilityVerdict {
        return metaWriteCapabilityVerdict({
            isSystem: ctx?.isSystem === true,
            systemPermissions: ctx?.systemPermissions,
            canonicalType: canonicalMetaUrlType(rawType),
            activeOrganizationId: ctx?.tenantId,
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
        i18nService?: any,
    ): Promise<any> {
        // [#10235] The per-column sortability projection, served beside the
        // document whenever the document IS an object schema, computed from the
        // FINAL document (post ADR-0106 masking) and never inside `item`.
        // [#20408] Both halves are `translateMetaEnvelope` in
        // `./meta-item-read-gate.ts` — the runtime dispatcher's item read answers
        // the same body through it.
        return metaReadGate.translateMetaEnvelope(
            this.metaItemTranslationSources(environmentId, req, i18nService),
            RestServer.metaTypeSingular(type),
            envelope,
            document,
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
     */
    private metaItemAnswerSources(
        environmentId: string | undefined,
        req: any,
        p: RestProtocol,
        policy: MetaReadGatePolicy,
    ): metaReadGate.MetaItemAnswerSources {
        return {
            ...this.metaItemReadGateSources(environmentId, req, p, policy.app === 'author-exempt'),
            requestLocale: (i18n) => this.extractLocale(req, i18n),
            // [#21476] The uncached arm's share of the public-form intake
            // reason the cached arm states (`GET /meta/:type/:name`).
            translateEnvelope: async (envelope, document) =>
                this.translateMetaEnvelope(
                    req, req.params.type, environmentId, envelope as Record<string, any>,
                    RestServer.metaTypeSingular(req.params.type) === 'view'
                        ? stampAnonymousFormIntakeWarnings(
                            document, await this.anonymousFormIntakeWarnings(environmentId, req, p, document),
                        )
                        : document,
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
     * stays this transport's, scoped by `metaReadOrganizationId`, the one
     * answer the dispatcher's layered read asks.
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
        const layeredPackageId = req.query?.package || undefined;
        // [#9454] State the ORG scope, exactly as the `/published` overlay read
        // already does. Without it the layered view resolved the env-wide row
        // only, so an author who had just saved an org overlay opened Studio to
        // `overlay: null` and the code layer — the write receipted as live, the
        // editor reporting it absent. This is the DIAGNOSTIC view of what is
        // stored per layer, so an unstated scope does not merely miss a row: it
        // misreports the very thing being diagnosed.
        // ⚠️ NOT a new org-resolution seam — `resolveExecCtx` is memoised per
        // request (WeakMap keyed by `req`), the same result 40+ handlers here
        // already share. Registry-gated via `organizationIdForMetaRead` so a
        // non-overridable type keeps reading env-wide (see that predicate for
        // why naming the org unconditionally would resurrect #6190's phantoms).
        const layeredCtx = await this.resolveExecCtx(environmentId, req)
            .catch(rethrowAuthzStoreUnavailable);
        // [folded-type commit 26f3588fb] (the original card no longer
        // resolves) FOLDED, not raw — see the PUT door's org-scope comment for
        // the measurement. [#20478] Asked of `metaReadOrganizationId` (the
        // same fold over the vetted `tenantId`), the one answer the runtime
        // dispatcher's layered read asks too.
        const layeredOrganizationId = metaReadGate.metaReadOrganizationId(req.params.type, layeredCtx);
        // [commit 2a29caa53] This door never carried an `as any`, but `p: any` meant its
        // request literal was never checked either — the same blind spot with
        // a different spelling. Typing the literal (spec shape + the
        // transport-level `environmentId`, see `TransportScopedMetaRequest`)
        // makes an undeclared key a compile error here too.
        const layeredRequest: TransportScopedMetaRequest<GetMetaItemLayeredRequest> = {
            type: req.params.type,
            name: req.params.name,
            ...(layeredPackageId ? { packageId: layeredPackageId } : {}),
            ...(environmentId ? { environmentId } : {}),
            ...(layeredOrganizationId ? { organizationId: layeredOrganizationId } : {}),
        };
        const layered = await p.getMetaItemLayered(layeredRequest);
        // [#20156 · #20478] THE per-caller gate on every layer, then the mask —
        // the shared chain. The stored-version doors honour the author
        // exemption, so the caller carries this transport's save-door
        // admission (`metaItemReadGateSources(…, true)`).
        const answer = await metaReadGate.createMetaLayeredAnswer(
            this.metaItemReadGateSources(environmentId, req, p, true),
            { metaType: RestServer.metaTypeSingular(req.params.type), name: req.params.name, maskPosture },
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
        const isScoped = basePath.includes('/environments/:environmentId');
        const discoveryHandler = async (req: any, res: any) => {
                try {
                    // [#9292] The document describes the environment the REQUEST
                    // names, not the control plane this server was constructed
                    // against. `this.protocol` is the host's; ~30 sibling
                    // handlers in this file obtain theirs from
                    // `resolveProtocol(environmentId, req)`, and `/discovery` —
                    // the surface SDKs, codegen and AI clients read (AGENTS.md
                    // "Route & surface ownership" #4) — was the one that did not.
                    //
                    // Measured on a two-kernel host before the fix: the scoped
                    // route `/environments/<id>/discovery` served the HOST's
                    // document to every environment, so two environments with
                    // genuinely different kernels received byte-identical
                    // `capabilities`, `services` and `locale`. Everything below
                    // this line composes over `discovery`, so the whole document
                    // followed the wrong kernel — not only the two capability
                    // keys derived from `engine.transaction` and `searchAll`,
                    // but every `services` slot, `locale` (from the kernel's own
                    // i18n service) and the route keys this handler does not
                    // itself overwrite (`analytics`, `automation`, `ai`, `i18n`,
                    // `notifications`, `realtime`, `storage`) — an environment's
                    // real surfaces missing, the host's advertised in their place.
                    //
                    // The unscoped route reaches the same resolution and keeps
                    // its control-plane answer where one is correct: with no
                    // environment in scope `resolveProtocol` falls through to
                    // `this.protocol`, so a control-plane boot is unchanged
                    // while a single-environment boot (step 3, the default
                    // provider) and a hostname-routed host now answer for the
                    // kernel that actually serves the request.
                    //
                    // The placeholder normalisation is `probeMcpServeable`'s,
                    // for its reason (#9120): an unsubstituted route pattern is
                    // the ABSENCE of an id, not an id, and the shared entry
                    // point short-circuits on any truthy explicit value — so
                    // `getOrCreate(':environmentId')` would go looking for a
                    // kernel named after the pattern.
                    const routeParam: string | undefined = req.params?.environmentId;
                    const environmentId = isScoped && routeParam !== ':environmentId'
                        ? routeParam
                        : undefined;
                    const protocol = await this.resolveProtocol(environmentId, req);
                    const discovery = await protocol.getDiscovery();

                    // [#11292] `version` is the PRODUCER's, and is deliberately
                    // NOT overwritten here. `DiscoverySchema` declares the field
                    // under "System Identity", grouped with `name` and
                    // `environment` — the "what server is this" question, settled
                    // by the #10993 ruling, landed by commits 98ea3443f and 376c70f98.
                    //
                    // This line used to read `discovery.version =
                    // this.config.api.version`, which is a different fact
                    // entirely: `normalizeConfig()` defaults it to `'v1'` and the
                    // SAME value builds the mounted path (`${basePath}/${version}`
                    // → `/api/v1`), so `GET /api/v1/discovery` answered with the
                    // path segment the caller had just typed to get there. On the
                    // one producer most clients actually hit, the identity field
                    // carried no identity.
                    //
                    // It also masked the producer. `getDiscovery()` derives the
                    // value from `OS_RUNTIME_VERSION` (commit 376c70f98) — the same stamp
                    // `/health` and the runtime dispatcher's own `/discovery`
                    // read (#10993, commit 98ea3443f) — so after #11297 this overwrote a
                    // value that already AGREED with the other producer, turning
                    // one answer back into two dialects of one field.
                    //
                    // The API-version fact is not lost: every entry in `routes`
                    // below is prefixed with the mounted base path, which is
                    // built from `api.version`. It is recoverable from the same
                    // document, in the field that means it.

                    // Substitute the resolved environmentId into the advertised routes so
                    // clients can consume them verbatim (e.g. /api/v1/environments/abc/data).
                    const realBase = isScoped
                        ? basePath.replace(':environmentId', req.params?.environmentId ?? ':environmentId')
                        : basePath;

                    if (discovery.routes) {
                        // Ensure routes match the actual mounted paths
                        if (this.config.api.enableCrud) {
                            discovery.routes.data = `${realBase}${this.config.crud.dataPrefix}`;
                        }

                        if (this.config.api.enableMetadata) {
                            discovery.routes.metadata = `${realBase}${this.config.metadata.prefix}`;
                        }

                        if (this.config.api.enableUi) {
                            discovery.routes.ui = `${realBase}/ui`;
                        }

                        // MCP (Streamable HTTP) is a default-on core capability —
                        // advertise it unless OS_MCP_SERVER_ENABLED=false opts the
                        // env out, so the objectui Integrations page surfaces the
                        // connect card. The /mcp route is mounted bare (not
                        // project-scoped), so point at the unscoped base. This
                        // `/discovery` (served by @objectstack/rest) is separate
                        // from the dispatcher's getDiscoveryInfo — both must
                        // advertise `mcp` on the same terms.
                        //
                        // Enabled is NOT the same as serveable (#4024). The flag
                        // alone used to gate this, on the reasoning that `os serve`
                        // auto-loads plugin-mcp from the same flag. But that
                        // lockstep belongs to the CLI: `@objectstack/rest` has no
                        // `@objectstack/mcp` dependency, mounts no /mcp route and
                        // performs no auto-load, so an embedder that skips
                        // plugin-mcp had `mcp` advertised here while the route
                        // 501'd — the `declared ≠ enforced` failure #3369 forbids.
                        // A `null` probe means we genuinely cannot tell; keep the
                        // old flag-only answer there rather than hiding a working
                        // endpoint (fail-open, ADR-0057 D10) — the dispatcher's own
                        // discovery is service-aware and stays authoritative.
                        const mcpServeable = await this.probeMcpServeable(req);
                        if (isMcpServerEnabled() && mcpServeable !== false) {
                            const unscopedBase = isScoped
                                ? basePath.replace(/\/(environments|projects)\/:environmentId$/, '')
                                : basePath;
                            discovery.routes.mcp = `${unscopedBase}/mcp`;
                        } else {
                            delete discovery.routes.mcp;
                        }

                        // Align auth route with the versioned base path if present.
                        // Auth is a control-plane concern, so use the unscoped base.
                        //
                        // [#16538] The strip names BOTH spellings, exactly as the MCP
                        // sibling above does. It used to name only the retired
                        // `/projects/:environmentId`, while `isScoped` — the condition
                        // guarding this very branch — keys on `/environments/:environmentId`
                        // alone. So the replace could never match where it ran: it returned
                        // `basePath` unchanged and a scoped `/discovery` advertised
                        // `/api/v1/environments/:environmentId/auth`, keeping both the scope
                        // this comment says to drop and a literal, unsubstituted route
                        // parameter. Pinned in `discovery-per-request-protocol.test.ts`.
                        if (discovery.routes.auth) {
                            const unscopedBase = isScoped
                                ? basePath.replace(/\/(environments|projects)\/:environmentId$/, '')
                                : basePath;
                            discovery.routes.auth = `${unscopedBase}/auth`;
                        }

                        // [#6633] Direct-mount surfaces — the mounted ⇒ advertised
                        // half of ADR-0076 D12. `routes.packages` and
                        // `routes.datasources` are PROJECTIONS of the recorded
                        // direct mounts (#5822): the advertised base is read off
                        // the very route arrays the registrars iterated to mount,
                        // so advertisement and mounting derive from one fact and
                        // cannot drift. Since commit fec784863 those registrars mount at
                        // this server's own `getApiBasePath()` — the single
                        // base — so an `apiPath` deployment advertises
                        // `{apiPath}/packages` and `{apiPath}/datasources`.
                        // That move landed with NO edit in this block, which is
                        // exactly the property #6633 was built to provide.
                        //
                        // A boot that mounted nothing advertises nothing: the
                        // protocol's service-presence `packages` entry is
                        // deleted rather than left to promise a 404 — this
                        // server knows the mount fact, which is strictly better
                        // knowledge than service presence. [#14503] The package
                        // registrar's ONE route (`POST {base}/packages/publish`)
                        // mounts on every boot since #7563, so `routes.packages`
                        // is advertised on every boot at THIS server's base; the
                        // family's reads and delete are served by the runtime
                        // dispatcher's `/packages` domain, the single
                        // implementation. (While the base was keyed on the
                        // registrar's own `GET {base}/packages` copy — never
                        // mounted on a stock boot, where the `package` service
                        // registers after this plugin starts — a stock boot
                        // advertised no `routes.packages` at all.)
                        const direct = this.getDirectMountRouteBases(
                            isScoped ? (req.params?.environmentId ?? ':environmentId') : undefined,
                        );
                        if (direct.packages) discovery.routes.packages = direct.packages;
                        else delete discovery.routes.packages;
                        if (direct.datasources) discovery.routes.datasources = direct.datasources;
                        else delete discovery.routes.datasources;

                        // [#6714] Email surface — same mounted ⇒ advertised
                        // discipline, over the RouteManager recording:
                        // `registerEmailEndpoints` registers
                        // `POST {base}/email/send` at THIS server's base (it
                        // follows `apiPath`), and the advertisement is a
                        // projection of that recorded row — never recomputed —
                        // so the SDK's `getRoute('email')` follows the real
                        // mount instead of the `/api/v1` convention the client
                        // used to hard-code (a live 404 on any `apiPath`
                        // deployment). Not mounted ⇒ not advertised.
                        const emailBase = this.getMountedEmailRouteBase(
                            isScoped ? (req.params?.environmentId ?? ':environmentId') : undefined,
                        );
                        if (emailBase) discovery.routes.email = emailBase;
                        else delete discovery.routes.email;

                        // [#16674] Bring the OTHER half of the document in line
                        // with the same mounted paths. Everything above rewrites
                        // `discovery.routes.*`; `discovery.services.*.route` is
                        // the same address stated per slot, and it was never
                        // brought along -- so a deployment that moved a prefix
                        // got a document that contradicted itself, and the
                        // `services` half pointed at a path with nothing on it.
                        //
                        // A PROJECTION of the finished `routes` map, key by key
                        // (`DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS` above), so the
                        // two halves cannot state different answers whatever a
                        // future substitution does to `routes`. The three guards
                        // are what keep a DEFAULT deployment byte-identical --
                        // the whole point of the fix is that it moves only the
                        // values that are already wrong:
                        //
                        //   1. only a slot the producer actually emitted, and
                        //   2. only one that already declares a `route` -- a
                        //      route-less slot (`cache`/`queue`/`job`, an
                        //      unmounted `realtime` channel) must not GAIN a
                        //      route key here: "no HTTP surface" is a fact this
                        //      handler does not get to overwrite (#4318, D12),
                        //      and inventing the key would also reorder the
                        //      entry for every reader diffing the document;
                        //   3. only from a route key that survived the pass --
                        //      a deleted or absent `routes.X` leaves the slot
                        //      alone rather than blanking it. Withdrawing an
                        //      advertisement is the ADR-0076 D12 question
                        //      #4318 owns, not this card's.
                        //
                        // On a stock boot every write here assigns the string
                        // that was already there, which is why the default
                        // document does not move by a byte.
                        const advertisedServices = discovery.services as
                            | Record<string, { route?: string } | undefined>
                            | undefined;
                        if (advertisedServices) {
                            const mountedRoutes = discovery.routes as unknown as Record<string, unknown>;
                            for (const [routeKey, slots] of Object.entries(DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS)) {
                                const mounted = mountedRoutes[routeKey];
                                if (typeof mounted !== 'string' || mounted.length === 0) continue;
                                for (const slot of slots) {
                                    const entry = advertisedServices[slot];
                                    if (!entry || typeof entry.route !== 'string') continue;
                                    entry.route = mounted;
                                }
                            }
                        }
                    }

                    // Cross-object atomic batch capability (#3298). `declared ===
                    // enforced`: advertise it only when THIS server actually mounts
                    // the `/batch` route (`api.enableBatch`, gated in
                    // registerBatchEndpoints) AND the runtime engine can honour a
                    // transaction (the protocol derived that from `engine.transaction`).
                    // AND-ing the two keeps us from advertising an endpoint that would
                    // 404 (batch disabled) or 501 (engine without `transaction()`), so
                    // a client can safely drop its non-atomic fallback on `true`.
                    const caps = ((discovery as any).capabilities ??= {}) as Record<
                        string,
                        { enabled: boolean; description?: string }
                    >;
                    const runtimeSupportsTx = !!caps.transactionalBatch?.enabled;
                    caps.transactionalBatch = {
                        enabled: runtimeSupportsTx && this.config.api.enableBatch !== false,
                        description:
                            'Atomic cross-object batch endpoint (POST {basePath}/batch): all-or-nothing '
                            + 'create/update/delete across objects in one transaction, with intra-batch '
                            + '{ $ref: <opIndex> } parent references (ADR-0034).',
                    };

                    // [#7541] Global search — the same two-layer AND, for the
                    // same reason. The protocol answered whether IT can serve a
                    // search (`typeof searchAll === 'function'`, the predicate
                    // `registerSearchEndpoints` 501s on); this server answers
                    // whether it MOUNTED the route at all (`api.enableSearch`,
                    // the flag gated in registerRoutes). A deployment that opts
                    // out gets a 404, so advertising the protocol's `true`
                    // unqualified would re-open the declared ≠ enforced gap one
                    // layer up from the one this issue closed. Neither half is a
                    // fallback for a wrong bit: each layer states the fact only
                    // it knows, and `enabled` is their conjunction.
                    //
                    // The flag is the NORMALIZED boolean (defaulted in
                    // `normalizeConfig`, declared seat in
                    // `RestApiConfigSchema.enableSearch` since #11983) — the
                    // same field the mount in `registerRoutes` reads, so the
                    // two cannot be edited apart.
                    caps.search = {
                        enabled: !!caps.search?.enabled && this.config.api.enableSearch,
                    };

                    // Attach scoping metadata so clients can detect dual-mode routing.
                    (discovery as any).scoping = {
                        enabled: this.config.api.enableProjectScoping,
                        resolution: this.config.api.projectResolution,
                        scoped: isScoped,
                        environmentId: isScoped ? req.params?.environmentId : undefined,
                    };

                    res.json(discovery);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            };

        // Register at basePath (e.g. /api/v1)
        this.routeManager.register({
            method: 'GET',
            path: basePath,
            handler: discoveryHandler,
            metadata: {
                summary: 'Get API discovery information',
                tags: ['discovery'],
            },
        });

        // Register at basePath/discovery (e.g. /api/v1/discovery)
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/discovery`,
            handler: discoveryHandler,
            metadata: {
                summary: 'Get API discovery information',
                tags: ['discovery'],
            },
        });
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
     * Register OpenAPI 3.1 spec + interactive docs viewer.
     *
     *   GET <basePath>/openapi.json   → enriched OpenAPI document
     *   GET <basePath>/docs           → Scalar-rendered HTML (CDN, no dep)
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
        const isScoped = basePath.includes('/environments/:environmentId');

        const openApiHandler = async (req: any, res: any) => {
            try {
                const spec = await this.loadOpenApiSpec();
                if (!spec) {
                    res.status?.(503);
                    res.json({
                        error: { code: 'OPENAPI_UNAVAILABLE', message: 'OpenAPI spec is not bundled with this runtime.' },
                    });
                    return;
                }

                // Clone shallowly so per-request mutations (server URL,
                // expanded paths) don't bleed into the cached base spec.
                let enriched: any = { ...spec, servers: [...(spec.servers ?? [])] };

                // 1) Override servers[0] with the actual request origin so
                //    "Try it" works straight from the docs viewer.
                const host = req.headers?.host ?? req.headers?.['host'];
                const proto = (req.headers?.['x-forwarded-proto'] as string)
                    || (req.protocol as string)
                    || 'http';
                if (host) {
                    enriched.servers = [
                        { url: `${proto}://${host}`, description: 'Current server' },
                        ...(spec.servers ?? []),
                    ];
                }

                // 2) Produce the built-in route section from this server's own
                //    route table and DISCARD whatever the static artifact
                //    carried (#5588, maintainer ruling C). Every row here is a
                //    route the router will match: same table, read at request
                //    time, so the prefix follows `apiPath`, the verbs are the
                //    registered ones, and a route that is not mounted cannot be
                //    described. `getRoutes()` is the whole surface — since
                //    #5822 that includes the direct-mount registrars' routes,
                //    but only the ones this boot actually mounted and reported.
                //    The filtering to THIS base (and away from the project-
                //    scoped mirror, which gets its own document) is
                //    `buildBuiltinPaths`'s.
                const builtin = buildBuiltinPaths(this.getRoutes(), basePath);
                enriched.paths = builtin.paths;
                // The tag list describes that same section, so it is produced
                // with it rather than inherited from the artifact — otherwise a
                // document whose operations carry rest's tags would advertise
                // spec's (`CRUD`/`Metadata`/`Discovery`, which nothing uses).
                enriched.tags = builtin.tags;

                // Metadata-driven enrichment (steps 3 and 4) reads through one
                // resolved protocol, but each step carries its own `try`: they
                // describe different surfaces, and a failure to enumerate one
                // must not silently blank the other.
                let protocol: RestProtocol | undefined;
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    protocol = await this.resolveProtocol(environmentId, req);
                } catch {
                    // Enrichment is best-effort — never fail the spec serve.
                }

                // 3) Expand `{object}` path placeholders into concrete
                //    routes for every registered data object. Falls back
                //    silently if discovery isn't available. Since #5588 the
                //    templates it expands are the real ones (`/api/v1/data/
                //    {object}` and its siblings), not the phantom `/api/
                //    {object}`.
                try {
                    const items = await protocol?.getMetaItems?.({ type: 'object' }).catch(() => null) as any;
                    const objects: string[] = Array.isArray(items?.items)
                        ? items.items.map((i: any) => i?.name).filter(Boolean)
                        : Array.isArray(items)
                          ? items.map((i: any) => i?.name).filter(Boolean)
                          : [];
                    if (objects.length > 0 && enriched.paths) {
                        const expanded: Record<string, unknown> = {};
                        for (const [p, def] of Object.entries(enriched.paths)) {
                            if (p.includes('{object}')) {
                                // Keep the template under x-template for tooling
                                // that wants the generic shape, and emit one
                                // concrete copy per registered object.
                                expanded[p] = { ...(def as object), 'x-template': true };
                                for (const obj of objects) {
                                    expanded[p.replace('{object}', obj)] = def;
                                }
                            } else {
                                expanded[p] = def;
                            }
                        }
                        enriched.paths = expanded;
                    }
                } catch {
                    // Enrichment is best-effort — never fail the spec serve.
                }

                // 4) Fold in the endpoints declared as `api` metadata (#5040
                //    E6). Same enumeration root as the `{object}` expansion
                //    above — this document is the ONE documentation face for
                //    `/openapi.json`, which this package alone serves (#5078,
                //    ADR-0076): declared endpoints join it here rather than
                //    growing a second generator somewhere else.
                //
                //    Since the E7 flip a non-empty `apis:` publishes, so this
                //    enumeration returns real declarations on a deployment that
                //    has them and the document grows a path entry per endpoint.
                //    Where nothing is declared the enumeration is empty and
                //    `enrichOpenApiWithEndpoints` hands `enriched` straight
                //    back, byte for byte.
                try {
                    const apiResult = await protocol?.getMetaItems?.({ type: 'api' });
                    const apiItems: unknown[] = Array.isArray((apiResult as any)?.items)
                        ? (apiResult as any).items
                        : Array.isArray(apiResult) ? apiResult as unknown[] : [];
                    const endpointLogger = {
                        error: (message: string, meta?: unknown) =>
                            meta === undefined ? logError(message) : logError(message, meta),
                    };

                    // [#5224] Enumerated is not served. This document is what
                    // SDKs, codegen and AI clients build clients FROM, so it
                    // describes only the declarations the endpoint matcher will
                    // actually answer — asked of the matcher itself, the sole
                    // holder of that verdict. A stored row the matcher cannot
                    // see used to arrive here and be published as a real path,
                    // `security: []` and all, while every request to it 404'd.
                    let documentable: unknown[] = apiItems;
                    const authority = apiItems.length > 0
                        ? await this.resolveEndpointMatchAuthority(
                            isScoped ? req.params?.environmentId : undefined,
                            req,
                        )
                        : undefined;
                    if (apiItems.length > 0 && !authority) {
                        this.notifyMissingEndpointAuthority('GET /openapi.json');
                    } else if (authority) {
                        // The matcher's OWN parsed endpoint is documented, not
                        // the stored JSON: schema defaults are materialized on
                        // it (most importantly `authRequired`), so the document
                        // describes the value the runtime acts on rather than a
                        // re-parse of the same row on a second code path.
                        documentable = (await selectServedEndpoints(apiItems, authority, endpointLogger))
                            .map((s) => s.endpoint);
                    }

                    enriched = enrichOpenApiWithEndpoints(enriched, documentable, endpointLogger);
                } catch (err: any) {
                    // A store that cannot be read must not take the document
                    // down with it — but say so, because a silently endpoint-
                    // less document looks exactly like a correct one.
                    logError('[REST] openapi.json endpoint enrichment skipped:', err?.message ?? err);
                }

                // 5) `info`: the artifact's, with the publisher's identity laid
                //    over it (#20294, ruling B on #20359). `packages/spec`
                //    produces the block (`build-openapi.ts`, pinned by
                //    `openapi-self-consistency.test.ts`); the host may sign it
                //    with the identity members of `api.documentation` —
                //    `title`, `description`, `termsOfService`, and `contact` /
                //    `license` each replaced whole. Nothing authored serves the
                //    artifact's `info` byte for byte, so the served document and
                //    the published `@objectstack/spec/openapi.json` export still
                //    state the same fact about every field nobody signed
                //    (#11646's invariant, now the unset case). The same closure
                //    serves this base and its environment-scoped twin, so both
                //    doors carry the overlay. The helper returns a NEW object:
                //    `enriched.info` is still the cached artifact's own `info`
                //    here (the clone above is shallow), and writing into it
                //    would leak one request's overlay into every later one.
                //
                //    `info.version` is NOT publisher identity, and nothing here
                //    writes it: it stays the artifact's — the protocol version
                //    (#11646) — and `api.documentation.version` is a retired
                //    tombstone the construction-time parse already refused. The
                //    API version identifier this deployment declares
                //    (`api.version`, which `normalizeConfig` defaults to `'v1'`)
                //    lives where it is observable, in the mount
                //    `${basePath}/${version}` -> `/api/v1`. The runtime version
                //    is answered by `{basePath}/discovery` and `/health`, derived
                //    from `OS_RUNTIME_VERSION` (#10993, commit 376c70f98, #11292). OpenAPI
                //    3.1 defines this field as "the version of the OpenAPI
                //    document (which is distinct from the OpenAPI Specification
                //    version or the API implementation version)" — the document
                //    being served IS the artifact, so its version is the
                //    artifact's.
                enriched.info = RestServer.overlayDocumentationInfo(enriched.info, this.config.api.documentation);

                res.json(enriched);
            } catch (error: any) {
                logError('[REST] openapi.json error:', error);
                sendThrownError(res, error);
            }
        };

        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/openapi.json`,
            handler: openApiHandler,
            metadata: {
                summary: 'OpenAPI 3.1 specification (machine-readable)',
                tags: ['openapi'],
            },
        });

        // Scalar HTML viewer — single inline page that loads the spec from
        // the sibling /openapi.json endpoint. No build-time bundling, no
        // server-side render cost.
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/docs`,
            handler: async (req: any, res: any) => {
                // Resolve the openapi.json URL relative to the current
                // request so the docs page works for any host / scoped
                // base path (e.g. /api/v1 vs /api/v1/environments/abc).
                const reqPath: string = req.path || req.url || `${basePath}/docs`;
                // Strip the trailing /docs to get the API base.
                const apiBase = reqPath.replace(/\/docs\/?$/, '');
                const specUrl = `${apiBase}/openapi.json`;
                const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ObjectStack API Docs</title>
</head>
<body>
<script id="api-reference" data-url="${specUrl}"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;
                if (res.setHeader) res.setHeader('content-type', 'text/html; charset=utf-8');
                if (res.send) res.send(html);
                else if (res.body) res.body = html;
                else res.json?.(html);
            },
            metadata: {
                summary: 'Interactive API docs (Scalar viewer)',
                tags: ['openapi'],
            },
        });
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
         * book tree. The first four of those are inside the `if` block further
         * down; every later member goes through this call.
         *
         * A call rather than one more `if` block, for two reasons that are not
         * cosmetic:
         *  1. **No single brace pair contains exactly the right set.** The
         *     later members are spread across ~1200 lines with
         *     `GET {metaPath}/object/:name/state/:field` — deliberately NOT
         *     part of this face — sitting among them.
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

        // GET /meta - List all metadata types
        //
        // Also mounted at `/meta/types`, the spelling the dispatcher's `/meta`
        // branch has always implemented (`parts[0] === 'types'`) and the
        // spelling `route-ledger.ts` has always declared. ONE handler, two
        // paths, deliberately: the dispatcher's two branches return the same
        // `protocol.getMetaTypes()` body, so a second REST handler would be a
        // second thing to keep true.
        if (metadata.endpoints.types !== false) {
            const listMetaTypes = async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const types = await p.getMetaTypes();
                    const translated = await this.translateMetaTypesResponse(req, environmentId, types);
                    res.header('Vary', 'Accept-Language');
                    res.json(translated);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            };
            this.routeManager.register({
                method: 'GET',
                path: metaPath,
                handler: listMetaTypes,
                metadata: {
                    summary: 'List all metadata types',
                    tags: ['metadata'],
                },
            });

            // GET /meta/types — REGISTERED BEFORE `/meta/:type`, and that is
            // the entire fix (#7526).
            //
            // The branch existed in the dispatcher and the row existed in the
            // ledger; the REST mount is a THIRD place and nobody wrote it here.
            // So `/meta/types` fell into the `:type` catch-all below and
            // answered `{"type":"types","items":[]}` — byte-shaped like
            // `/meta/zzz_not_a_type`, a 200 no client can tell from "that type
            // is empty". Hono is first-match-wins (MEASURED, not assumed —
            // `plugin-hono-server`'s `mounted-route-introspection.test.ts`
            // registers a literal and a `:param` sibling in both orders and
            // pins that the later one never runs), so moving this below
            // `/meta/:type` silently re-breaks it — the same shape that already
            // put `diagnostics` / `_drafts` / `_migrate-stored` above it. The
            // order is pinned by `meta-route-registration-order.test.ts`.
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/types`,
                handler: listMetaTypes,
                metadata: {
                    summary: 'List all metadata types (explicit `/types` spelling)',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/diagnostics - Cross-type spec-validation sweep
        //
        // Returns every metadata entry that fails its registered Zod
        // schema, scoped to the environment (and optionally org /
        // package) of the request. Powers the Studio governance
        // dashboard and `os doctor`-style CLI checks.
        //
        // Registered BEFORE `/meta/:type` so the `diagnostics` segment
        // is not captured as a `:type` parameter.
        //
        // [#15542] First of the three WHOLE-STORE operations, and they share
        // one switch of their own — `metadata.endpoints.maintenance`. They
        // used to ride `endpoints.items`, whose declared meaning is the
        // per-type list, so closing a listing read silently took this sweep,
        // `/_drafts` and the `POST /_migrate-stored` write door with it.
        if (metadata.endpoints.maintenance !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/diagnostics`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).getMetaDiagnostics !== 'function') {
                            res.status(501).json({
                                error: { code: 'NOT_IMPLEMENTED', message: 'protocol.getMetaDiagnostics() is not available in this kernel' },
                            });
                            return;
                        }
                        // [#6877] All three narrow the diagnostics query to ONE
                        // value each; the `as string` casts are exactly the
                        // laundering that kept `tsc` silent about the array arm.
                        if (refuseRepeatedQueryParams(req, res, ['severity', 'type', 'package'])) return;
                        const severityParam = (req.query?.severity as string | undefined) ?? 'error';
                        const severity = severityParam === 'warning' ? 'warning' : 'error';
                        const diagnosticsType = (req.query?.type as string | undefined) || undefined;
                        // [#13753, #15622] STATE THE ORG PARTITION — on BOTH
                        // arms. They differ only in whether the fold happens
                        // HERE or is left entirely to the callee.
                        //
                        // `getMetaDiagnostics` reads each swept type through
                        // `getMetaItems({ type: t, organizationId })`.
                        //
                        // ⚠️ [commit 96326040f] `getMetaItems` NOW APPLIES THE REGISTRY GATE
                        // ITSELF — `organizationIdForMetaRead(request.type,
                        // request.organizationId)`, one statement after it folds the
                        // type through `canonicalizeMetaRequestType`. That is the
                        // ONE inner gate this call site now sits above; the sibling
                        // gate in the same file guards `getMetaItem` (the singular
                        // overlay read, commit d5cbb44f3), which this arm never reaches.
                        //
                        // ⛔ Until commit 96326040f this comment said `getMetaItems` applied NO
                        // registry gate of its own and the scope was therefore
                        // decided HERE, per type, by the caller. That sentence is
                        // FALSE on today's tree — do not reintroduce it, and do not
                        // reason from it.
                        //
                        // ⇒ The `?type=` arm is exactly one type
                        // (`targetTypes = [request.type]`), so the predicate
                        // over that one type IS the request's whole scope and
                        // the answer is correct by construction. That is the
                        // arm Studio's per-type directory drill-down uses, and
                        // it is the arm #13753 repaired.
                        //
                        // ── WHY THE FOLD IS DOUBLED, AND STAYS DOUBLED (commit abf9101f1) ──
                        //
                        // The VALUE is redundant, and measured to be. Both sites fold
                        // the identical string through the identical map — here
                        // `canonicalMetaUrlType`, inside `getMetaItems` the same
                        // function reached through `canonicalizeMetaRequestType` →
                        // `canonicalMetaType` — so `f(t, f(t, o)) === f(t, o)` and the
                        // inner application is the algebraic no-op. MEASURED: replace
                        // this predicate with a raw `diagnosticsCtx?.tenantId` and
                        // `rest-server-meta-read-org-scope.test.ts` stays GREEN IN FULL
                        // (30/30 at that revision; the file has grown since);
                        // the inner gate re-folds it, phantom control included.
                        //
                        // ⭐ It is KEPT anyway, and the reason is TRUST DOMAIN rather
                        // than value. `getMetaDiagnostics` is not a member of
                        // `MetadataProtocol` at all — not required, not optional —
                        // which is why it is reached through the `(p as any)` cast and
                        // why the 501 above exists. The inner gate therefore belongs
                        // to ONE implementation of an UNDECLARED extension, while this
                        // predicate sits on the REST boundary and holds for every
                        // `RestProtocol` a host can mount. Delete it and a REST door's
                        // tenant scope becomes a function of which kernel is mounted —
                        // and no pin can see that happen, because the harness boots the
                        // bundled implementation. Defence in depth, on a seam the type
                        // system does not cover.
                        //
                        // ── [#15622] THE UNTYPED SWEEP FORWARDS THE
                        // ORGANIZATION TOO, and passes it RAW ───────────────
                        //
                        // ⛔ This arm used to be a RECORDED GAP, left env-wide
                        // on this argument: `targetTypes` is then the whole
                        // registry — five `allowOrgOverride: true` types and
                        // every other declared type together — while the
                        // request carries ONE `organizationId`, and one org id
                        // could not express a per-type scope from here without
                        // a fan-out per overridable type plus a REST-side
                        // re-aggregation of `total`/`stats`/`scannedTypes`.
                        //
                        // ⚠️ Commit 96326040f DISSOLVED THAT OBSTACLE (commit abf9101f1 recorded
                        // it, #15622 acted on it). `getMetaDiagnostics` does
                        // not spend the organization once: it loops `for (const
                        // t of targetTypes)` calling `getMetaItems({ type: t,
                        // organizationId, … })`, and the FIRST thing
                        // `getMetaItems` does with that organization is
                        // `organizationIdForMetaRead(request.type, …)` on its
                        // OWN folded type. So one `organizationId` handed to
                        // this arm is already narrowed PER TYPE by the callee —
                        // the org for the five overridable types, `undefined`
                        // for every other, phantoms of non-overridable types
                        // dropped. That is precisely the scope the paragraph
                        // above said one id could not say. No fan-out, no
                        // REST-side re-aggregation, no second owner of the
                        // sweep's arithmetic: `stats` / `total` /
                        // `scannedTypes` are untouched by the gate.
                        //
                        // ⭐ RULED that the gap CLOSES rather than being
                        // re-recorded. A governance summary whose whole job is
                        // surfacing problems, and which structurally cannot see
                        // a class of them WHILE ITS OWN drill-down can, issues a
                        // false all-clear — since #13753 repaired the `?type=`
                        // arm, this summary undercounts relative to the screen
                        // you reach by clicking into it. An org-scoped caller
                        // now sees items THEIR OWN organization authored, on the
                        // five overridable types only, which for a governance
                        // report is the correct set.
                        //
                        // ⛔ RAW, and deliberately NOT pre-folded with
                        // `organizationIdForMetaRead(...)` the way the `?type=`
                        // arm folds above. There is no single type to fold on
                        // here, and folding on any one of them would suppress
                        // the organization for EVERY type at once. The per-type
                        // decision belongs to the callee's loop. Identical in
                        // shape to the `/references` door below, whose
                        // narrowness control measured the same callee gate; both
                        // halves are pinned in
                        // `rest-server-meta-read-org-scope.test.ts`, where ONE
                        // request shows an overridable type's org-authored row
                        // present and a planted pre-#6190 phantom on a
                        // NON-overridable type absent.
                        //
                        // ⚠️ ADR-0131 D6/D7 retires the per-organization
                        // metadata partition in v18 (#15206, C5), so this
                        // behaviour has ONE MAJOR to live and reverts to
                        // environment-wide when the partition goes. An existing
                        // value handed to an existing parameter: no new
                        // parameter, response field, status code or contract
                        // surface. ⛔ Nothing is to be built on it.
                        //
                        // ⚠️ NOT a new org-resolution seam: `resolveExecCtx` is
                        // memoised per request (WeakMap keyed by `req`), the
                        // same result 40+ handlers here already share. It is now
                        // resolved for BOTH arms — which is why this reads as a
                        // statement rather than a ternary: the LOCALLY CAUGHT
                        // continuation-line spelling is the one the sibling
                        // doors use and the one `execctx-consumer-census`
                        // reads, and a third layout would be invisible to it.
                        // This door does not sit behind the shared anonymous
                        // floor, so it decides an authz-store outage for itself
                        // rather than laundering it into an org-unscoped 200 —
                        // and the untyped arm now shares that, deliberately.
                        const diagnosticsCtx = await this.resolveExecCtx(environmentId, req)
                            .catch(rethrowAuthzStoreUnavailable);
                        const diagnosticsOrganizationId: string | undefined = diagnosticsType
                            ? organizationIdForMetaRead(
                                // [commit 26f3588fb] FOLDED, not raw — see the PUT door's
                                // org-scope comment for the measurement. The
                                // protocol keeps receiving the caller's own
                                // spelling (it normalises, and refuses an
                                // unrecognised one with its own 400); only the
                                // scope decision reads the canonical singular.
                                canonicalMetaUrlType(diagnosticsType), diagnosticsCtx?.tenantId,
                            )
                            // [#15622] The whole-registry arm — raw, per above.
                            : diagnosticsCtx?.tenantId;
                        const result = await (p as any).getMetaDiagnostics({
                            type: diagnosticsType,
                            severity,
                            packageId: (req.query?.package as string | undefined) || undefined,
                            // SPREAD, never `organizationId: x ?? null` — the
                            // implementation declares `organizationId?: string`
                            // (optional plain string, not nullable), and a
                            // `null` would travel into `getMetaItems` as an
                            // explicit env-partition statement rather than as
                            // "unstated".
                            ...(diagnosticsOrganizationId ? { organizationId: diagnosticsOrganizationId } : {}),
                        });
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'List metadata entries that fail spec validation',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/_drafts - Pending DRAFT items (ADR-0033)
        //
        // Surfaces draft-state metadata that the active-only `/meta/:type`
        // list hides, so the console can show a "pending changes" view and
        // draft-aware package contents (a just-built app package no longer
        // looks empty). Optionally narrowed by `?packageId=` and/or `?type=`.
        //
        // Registered BEFORE `/meta/:type` so the `_drafts` segment is not
        // captured as a `:type` parameter.
        //
        // [#15542] Whole-store operation — `metadata.endpoints.maintenance`.
        if (metadata.endpoints.maintenance !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/_drafts`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        // [ADR-0106 D5(4) / #6599] `_drafts` is an AUTHORING
                        // surface — the console's pending-changes view and
                        // draft-aware package reads — not a general read. A
                        // pending object draft carries its full `fields` map, so
                        // serving it unfiltered leaks every hidden field's
                        // label, type, options, formula and `requiredPermissions`
                        // to any authenticated caller, which is the disclosure
                        // ADR-0106 closes one route over. The other `/meta`
                        // exits MASK per field; this one GATES per caller, on the
                        // SAME `systemPermissions` judgement D4 uses for its
                        // read exemption (`isObjectSchemaMaskExempt`) — a caller
                        // who could not see a field on `/meta/object` has no
                        // authoring reason to see the draft that carries it. The
                        // gate is intentionally independent of the D8 field-mask
                        // escape hatch: opting out of per-field masking is not
                        // consent to expose pending drafts to non-authors.
                        //
                        // Gate FIRST — before resolving the protocol — so an
                        // unauthorized caller cannot use the 501-vs-200 answer to
                        // probe which kernels support drafts (same posture as
                        // `_migrate-stored` below).
                        //
                        // [#20338] Asked through {@link mayReadPendingDrafts},
                        // the one question every draft door in this file asks.
                        const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                        if (!mayReadPendingDrafts(ctx)) {
                            res.status(403).json({
                                error: {
                                    code: 'FORBIDDEN',
                                    message: 'Reading pending metadata drafts requires an authoring capability (studio.access, setup.access or manage_metadata).',
                                },
                            });
                            return;
                        }
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).listDrafts !== 'function') {
                            res.status(501).json({
                                error: { code: 'NOT_IMPLEMENTED', message: 'protocol.listDrafts() is not available in this kernel' },
                            });
                            return;
                        }
                        // [#6877] Both narrow the draft list to one package /
                        // one type; an array reached `listDrafts` untouched.
                        if (refuseRepeatedQueryParams(req, res, ['packageId', 'type'])) return;
                        // [#11087] Read in the CALLER'S org scope, symmetric with
                        // the save route (`saveMetaItem`'s `organizationId:
                        // ctx?.tenantId`, below): a draft saved by a session
                        // carrying an active org lands in that org's overlay
                        // scope, and this route used to read with NO org —
                        // `getOverlayRepo(null)` sees only env-wide
                        // (`organization_id IS NULL`) rows, so every org-scoped
                        // draft was invisible to the pending-changes surfaces
                        // while single reads (which thread the ctx) and the
                        // publisher (which resolves each draft's own scope)
                        // saw it fine — the write-org/read-null split behind
                        // cloud#1593. With the org threaded, the repository's
                        // own `$or` contract surfaces BOTH the caller's org
                        // overlay and env-wide drafts.
                        const result = await (p as any).listDrafts({
                            packageId: (req.query?.packageId as string | undefined) || undefined,
                            type: (req.query?.type as string | undefined) || undefined,
                            organizationId: ctx?.tenantId ?? undefined,
                        });
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'List pending draft metadata items',
                    tags: ['metadata'],
                },
            });
        }

        // POST /meta/_migrate-stored — rewrite stored sys_metadata rows into
        // today's canonical shape (ADR-0087; #4327 / #4454 / #4498).
        //
        // The server-side form of `os migrate meta --stored`. The CLI form
        // needs shell access to the deployment's database, which a hosted
        // operator does not have — so without this route the stored-metadata
        // chain has no finish line on a managed deployment, only the per-read
        // conversion that runs forever. Flow rows are covered here for free:
        // `migrateStoredMetadata` resolves the automation engine from the
        // services registry (#4498), and a server always has a live one.
        //
        // Registered BEFORE `/meta/:type` so the leading-underscore segment is
        // not captured as a `:type` parameter (same reason as `_drafts`).
        //
        // [#15542] Whole-store operation — `metadata.endpoints.maintenance`.
        // This is the WRITE door the card was filed about: it used to be
        // unmounted by `endpoints.items: false`, a switch declared as "list
        // items of type".
        if (metadata.endpoints.maintenance !== false) {
            this.routeManager.register({
                method: 'POST',
                path: `${metaPath}/_migrate-stored`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        // Gate FIRST — before resolving the protocol — so an
                        // unauthorized caller cannot use the 501 vs 200 answer
                        // to probe which kernels can be migrated.
                        //
                        // This rewrites every eligible row in the deployment,
                        // so unlike the single-item `PUT /meta/:type/:name` it
                        // demands an explicit capability rather than only a
                        // session. `manage_metadata` is ADR-0066 D1's authoring
                        // capability, and a canonicalization rewrite is
                        // authoring; `isSystem` bypasses, matching every other
                        // capability gate on the platform.
                        //
                        // [#12702] Deliberately NOT `metaWriteCapabilityVerdict`:
                        // an install-wide stored-metadata rewrite is env-wide by
                        // definition, so `manage_org_presentation`'s "org-scoped
                        // to the caller's own active organization" condition can
                        // never hold here. `manage_metadata`-only, unchanged —
                        // do not copy the item doors' acceptance in.
                        const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                        const held = new Set<string>(
                            Array.isArray(ctx?.systemPermissions) ? ctx!.systemPermissions : [],
                        );
                        if (!ctx?.isSystem && !held.has('manage_metadata')) {
                            res.status(403).json({
                                error: {
                                    code: 'FORBIDDEN',
                                    message: 'Rewriting stored metadata requires the `manage_metadata` capability.',
                                },
                            });
                            return;
                        }
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).migrateStoredMetadata !== 'function') {
                            res.status(501).json({
                                error: {
                                    code: 'NOT_IMPLEMENTED',
                                    message: 'protocol.migrateStoredMetadata() is not available in this kernel',
                                },
                            });
                            return;
                        }
                        const rawTypes = (req.body as any)?.types;
                        const types = Array.isArray(rawTypes)
                            ? rawTypes.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
                            : [];
                        // Preview by default — `apply` must be explicitly true,
                        // the same posture the CLI takes. A caller who sends an
                        // empty body gets a report and no writes.
                        const report = await (p as any).migrateStoredMetadata({
                            apply: (req.body as any)?.apply === true,
                            ...(types.length > 0 ? { types } : {}),
                            // Attributed to the caller: this writes history +
                            // audit rows, and "who ran the migration" is the
                            // question those rows exist to answer.
                            actor: ctx?.userId
                                ? `${ctx.userId} (POST ${metadata.prefix}/_migrate-stored)`
                                : `POST ${metadata.prefix}/_migrate-stored`,
                        });
                        res.json(report);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Rewrite stored metadata rows into the canonical protocol shape',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/:type - List items of a type
        //
        // [#15542] The whole of `metadata.endpoints.items` — this one mount,
        // and nothing else, which is what its `describe()` has always said.
        if (metadata.endpoints.items !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type`,
                handler: async (req: any, res: any) => {
                    try {
                        // [#6877] Five single-valued parameters on this list
                        // route, declared together at the top so the gate cannot
                        // be missed by whichever branch reads its parameter
                        // several hundred lines down: `?object=` (the view
                        // switcher's `String(req.query.object)`, which turned
                        // `['a','b']` into the object name `'a,b'` — a name no
                        // view has, so the switcher silently emptied) and
                        // `?include=` (repeated, it stopped equalling
                        // `'content'`, so a caller who asked for doc bodies got
                        // the slimmed list back with a 200).
                        //
                        // [#7566] `?id=` joined them when the app branch below
                        // started honouring it. It is declared HERE, with the
                        // rest, rather than beside the filter that reads it, for
                        // the reason this block exists: a filter that arrives as
                        // `['crm','account']` and is compared against one app
                        // name matches nothing, and an empty app list is exactly
                        // the plausible-looking wrong answer #7566 was filed
                        // against. Refused, not resolved — see
                        // `query-multiplicity.ts` for why picking one of two
                        // conflicting intents is worse than a 400.
                        if (refuseRepeatedQueryParams(req, res, ['package', 'preview', 'object', 'include', 'id'])) return;
                        const packageId = req.query?.package || undefined;
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        // [#9488] …and BEFORE any listing work: a `:type` that
                        // names no metadata type is refused here rather than
                        // served as a real-but-empty collection, which the write
                        // door has refused since #8421. See
                        // {@link refuseUnknownMetaListType} for the union it
                        // consults, why the static verdict alone is the wrong
                        // rule on a READ door, and why it throws instead of
                        // building a body.
                        await this.refuseUnknownMetaListType(p, req.params?.type);
                        // [#9454] The scoped listing is the second door the
                        // card measured absent (`?object=` unchanged after a
                        // runtime PUT). `getMetaItems` unions the env-wide and
                        // org scopes under org-wins precedence — but only when
                        // the caller names an org; unnamed, it returns the
                        // env-wide partition alone and the author's new item is
                        // simply not in the list. Same memoised `resolveExecCtx`
                        // and same registry gate as every other read door here.
                        const listCtx = await this.resolveExecCtx(environmentId, req)
                            .catch(rethrowAuthzStoreUnavailable);
                        // [folded-type commit 26f3588fb] (the original card no
                        // longer resolves) FOLDED, not raw — see the PUT door's
                        // org-scope comment for the measurement. [#20408] Asked of
                        // `metaReadOrganizationId`, the one answer the runtime
                        // dispatcher's list asks too.
                        const listOrganizationId = metaReadGate.metaReadOrganizationId(req.params.type, listCtx);
                        // ADR-0033/0037 draft-overlay preview: `?preview=draft`
                        // overlays pending drafts on the active list, exactly as
                        // the runtime dispatcher's /metadata/:type route does —
                        // the console's draft preview (Live Canvas) reads THIS
                        // route, so dropping the flag here silently renders the
                        // published-only world.
                        //
                        // [#20338] …for a caller who may read drafts. Anyone
                        // else is answered the list as if the switch were
                        // absent — {@link mayReadPendingDrafts} says why that,
                        // and not a refusal. Declared WITH its admission so no
                        // later branch of this handler can read the switch past it.
                        const previewDrafts = typeof req.query?.preview === 'string'
                            && req.query.preview.toLowerCase() === 'draft'
                            && mayReadPendingDrafts(listCtx);
                        // [commit 2a29caa53] Typed against the spec request shape plus the
                        // transport-level `environmentId` — the `as any` this
                        // literal used to carry is retired now that the spec
                        // declares `previewDrafts` (and `organizationId`, #9726).
                        const listRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                            type: req.params.type,
                            packageId,
                            ...(previewDrafts ? { previewDrafts: true } : {}),
                            ...(environmentId ? { environmentId } : {}),
                            ...(listOrganizationId ? { organizationId: listOrganizationId } : {}),
                        };
                        const items = await p.getMetaItems(listRequest);

                        // [#20320] Everything this route does to the list after
                        // the read — the #5224 `api` served-set face, THE
                        // per-caller list gate (#20237), `?id=` for apps (#7566),
                        // `?object=` for views, the ADR-0046 doc locale collapse
                        // and content slim, the ADR-0106 object mask and the
                        // translation step — is ONE chain,
                        // `createMetaListAnswer` in `./meta-item-read-gate.ts`,
                        // which the runtime dispatcher's `/meta` list branch
                        // calls too. Its docblock carries each step's rule and
                        // their order; ⛔ a list step is added there, never here
                        // (`meta-list-projection-parity.test.ts` in
                        // `@objectstack/runtime` derives its census from this
                        // handler and fails on one added here). `getMetaItems`
                        // answers a bare array or the `{ type, items }` envelope;
                        // the chain answers the same shape.
                        //
                        // `previewDrafts` is handed in ADMITTED — the one
                        // declaration above — and the chain never re-reads it.
                        const answer = await metaReadGate.createMetaListAnswer(
                            this.metaListAnswerSources(environmentId, req, p),
                            { metaType: RestServer.metaTypeSingular(req.params.type), query: req.query, previewDrafts },
                        )(items);
                        if (!answer.ok) {
                            sendFieldVisibilityFault(res, answer.object);
                            return;
                        }
                        // [ADR-0106 D6 tier 2] The chain's cache posture — an
                        // undetermined field visibility serves the list
                        // `private, no-store`, exactly as this route always has.
                        if (answer.cacheControl) res.header('Cache-Control', answer.cacheControl);
                        res.header('Vary', 'Accept-Language');
                        res.json(answer.data);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'List metadata items of a type',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/:type/:name - Get specific item
        //
        // [#15542 / #15854] The first four members of the per-item face. The
        // rest of it — `PUT`, `DELETE` and the history family — is registered
        // below this block's closing brace and goes through
        // {@link registerPerItemRoute}, which carries the SAME switch. ⛔ The
        // brace is not the radius: read the pin table in
        // `rest-config-mount-table.pin.test.ts` for what `item` gates.
        if (metadata.endpoints.item !== false) {
            // Phase 3a-references: /meta/:type/:name/references must be
            // registered BEFORE /meta/:type/:name so the more-specific
            // path wins under any first-match router strategy.
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type/:name/references`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).findReferencesToMeta !== 'function') {
                            // [#9326 / ADR-0110 D3] A MISS and a FAULT are
                            // different facts, and this branch is the second
                            // one: the resolved protocol cannot compute the
                            // reference graph AT ALL, so the question was never
                            // asked. Answering `{ references: [] }` reported it
                            // as the first — "nothing depends on this item" —
                            // and the admin "Used by" panel renders that empty
                            // case as "Nothing in the metadata graph points at
                            // this item. Safe to delete.", shown to an operator
                            // about to delete something.
                            //
                            // Refusing HERE rather than asserting at assembly is
                            // deliberate. `findReferencesToMeta` is not a member
                            // of `RestProtocol` (= `DataProtocol &
                            // MetadataProtocol`) — it is an ADR-0076 D9
                            // server-only extension, which is why it is reached
                            // through a runtime cast at all. So a host that
                            // implements the DECLARED contract exactly is a
                            // CONFORMING deployment that lands here with no type
                            // error, and a boot-time assertion would promote an
                            // undeclared optional extension into a required one
                            // — a `packages/spec` contract decision, not a
                            // route one. What the route owes is that an
                            // unanswerable question comes back unanswered.
                            //
                            // Envelope per #7035: the ADR-0112 NESTED
                            // `{ error: { code, message } }` that the sibling
                            // `/meta` 501 refusals converged on — never the
                            // bare-string or sibling-`code` dialects, which make
                            // `body.error.code` read `undefined`.
                            res.status(501).json({
                                error: {
                                    code: 'NOT_IMPLEMENTED',
                                    message: 'protocol.findReferencesToMeta() is not available in this kernel',
                                },
                            });
                            return;
                        }
                        // ── [#13753] STATE THE ORG PARTITION — and pass it
                        // RAW, which is the whole of the decision ───────────
                        //
                        // The admin "Used by" panel renders its empty case as
                        // "Nothing in the metadata graph points at this item.
                        // Safe to delete." (objectui `metadata-admin/i18n.ts`),
                        // shown to an operator about to delete something. With
                        // no organization stated, the sweep read the env
                        // partition only: an org-scoped `view` referencing the
                        // item was invisible and the panel issued a false
                        // clearance — the ADR-0110 D3 harm this route's own 501
                        // refusal (#9326) exists to prevent, delivered by the
                        // door after the protocol had refused to deliver it.
                        //
                        // ⛔ NOT pre-gated with `organizationIdForMetaRead(
                        // canonicalMetaUrlType(req.params.type), ...)`, the way
                        // the sibling `/meta` doors gate. Here `req.params.type`
                        // is the TARGET, and `findReferencesToMeta` spends the
                        // organization on the SOURCES: it resolves
                        // `REFERENCE_SITES.byTarget.get(target)`, groups the
                        // sites by `fromType` and reads each through
                        // `getMetaItems({ type: matcher.fromType, ... })`. The
                        // target's own registry flag therefore says nothing
                        // about the types actually read, and gating on it would
                        // suppress the organization for exactly the `object` /
                        // `flow` / `app` deletes this card is about — the card's
                        // own false clearance, left standing by a change that
                        // looks like its repair.
                        //
                        // ⭐ And RAW is not the unconditional tenant that
                        // predicate exists to prevent, because since commit 96326040f
                        // `getMetaItems` applies it ITSELF, to its OWN
                        // `request.type`, after the fold. The per-SOURCE-type
                        // decision is already the callee's: an overridable
                        // source (`view`, `dashboard`, `report`, `translation`,
                        // `email_template`) honours the organization, every
                        // other source drops it and stays env-wide, so no
                        // pre-#6190 phantom row is resurrected into a
                        // destructive-action clearance. `request.organizationId`
                        // has exactly ONE use inside `findReferencesToMeta` —
                        // that `getMetaItems` spread — so passing it raw carries
                        // no other consequence. Both halves are pinned in
                        // `rest-server-meta-read-org-scope.test.ts`, the second
                        // as the narrowness control.
                        //
                        // ⚠️ ADR-0131 D6/D7 retires the per-organization
                        // metadata partition in v18 (#15206, C5), so this is a
                        // repair inside a mechanism being removed: an existing
                        // value handed to an existing parameter, no new contract
                        // surface. ⛔ Nothing is to be built on it.
                        //
                        // The same memoised resolution the sibling read doors
                        // share, in the same locally-caught spelling: this door
                        // does not sit behind the shared anonymous floor, so it
                        // decides an authz-store outage for itself rather than
                        // laundering it into an org-unscoped 200.
                        const referencesCtx = await this.resolveExecCtx(environmentId, req)
                            .catch(rethrowAuthzStoreUnavailable);
                        // [#15685] The protocol's OWN refusal is re-answered in
                        // the nested envelope the branch above already uses —
                        // see {@link notImplementedRefusalAnswer} for why the
                        // repair is here and how narrow it is. The catch is
                        // scoped to the protocol call ALONE, so what this arm
                        // can re-dress is mechanically the set of things
                        // `findReferencesToMeta` raised: neither
                        // `resolveProtocol` nor the `resolveExecCtx` seam above
                        // can reach it, whatever they declare.
                        let result: unknown;
                        try {
                            result = await (p as any).findReferencesToMeta({
                                type: req.params.type,
                                name: req.params.name,
                                // SPREAD, never `organizationId: x ?? null` — the
                                // implementation declares `organizationId?: string`
                                // (optional plain string, not nullable), and it
                                // forwards on truthiness.
                                ...(referencesCtx?.tenantId ? { organizationId: referencesCtx.tenantId } : {}),
                                ...(environmentId ? { environmentId } : {}),
                            });
                        } catch (raised: any) {
                            const refusal = notImplementedRefusalAnswer(raised);
                            // Anything else is the outage it always was — the
                            // 503 `getMetaItems` raises for a `sys_metadata`
                            // failure (#8896) still propagates to the terminal
                            // below, message-withheld and logged, unchanged.
                            if (refusal === undefined) throw raised;
                            res.status(refusal.status).json(refusal.body);
                            return;
                        }
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'List metadata items that reference this item',
                    tags: ['metadata'],
                },
            });

            // [#5882] GET /meta/:type/:name/layers — the three-layer diagnostic
            // projection as its OWN resource. Registered BEFORE
            // /meta/:type/:name for the same first-match reason as
            // /references above. [commit 7986d973f] It also used to have to precede the
            // compound `/:type/:section/:name`, which would otherwise capture
            // this path with section=<name>, name="layers"; that catch-all is
            // retired, so only the /references-style reason remains.
            //
            // This path exists because the projection used to be reachable only
            // as `GET /meta/:type/:name?layers=true` — the same route answering
            // a SECOND, undeclared body shape depending on a query flag, while
            // `packages/spec` declared one `responseSchema` for it. The ruled
            // fix (maintainer, 2026-08-06) was one path per response shape,
            // deliberately NOT teaching the route declaration to express
            // "two shapes chosen by a flag": that would add a primitive every
            // future tool has to understand, and conditional response selection
            // is exactly where codegen and AI-written clients go wrong.
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type/:name/layers`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        // [ADR-0106 D2/D5] The dedicated path is its own
                        // schema-serving outlet — it resolves the caller's
                        // field-visibility posture exactly like the plain meta
                        // read does, with the NORMALIZED type (#3984 / commit 83a3b1f2e).
                        const layeredMetaType = RestServer.metaTypeSingular(req.params.type);
                        let maskPosture: ObjectSchemaMaskPosture;
                        try {
                            maskPosture = await (await this.resolveObjectMasker(environmentId, req, layeredMetaType))(req.params.name);
                        } catch (maskError: any) {
                            if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                                sendFieldVisibilityFault(res, req.params.name);
                                return;
                            }
                            throw maskError;
                        }
                        if (typeof (p as any).getMetaItemLayered !== 'function') {
                            // A dedicated path cannot fall through to the plain
                            // read the way the `?layers=` flag did — answering
                            // the merged `{ type, name, item }` envelope here
                            // would be answering a different resource with a
                            // shape this path never declares.
                            res.status(501).json({
                                error: 'Layered metadata view not supported by protocol implementation',
                                code: 'NOT_IMPLEMENTED',
                            });
                            return;
                        }
                        await this.serveMetaItemLayered(req, res, environmentId, p, maskPosture);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Get a metadata item as its three layers (code / overlay / effective)',
                    tags: ['metadata'],
                },
            });

            // ADR-0046 §6 — GET /meta/book/:name/tree
            // Resolve a book spine against the docs that exist *now* into a
            // rendered tree (membership is DERIVED, never stored — §6.2.1). An
            // unknown name is treated as a package id and resolved against the
            // implicit per-package book (§6.4). Anonymous requests only see a
            // book whose `audience` is `public` (§6.7 read-layer gating).
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/book/:name/tree`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const prot = await this.resolveProtocol(environmentId, req);
                        // [#6877] One package scopes the book lookup.
                        if (refuseRepeatedQueryParams(req, res, ['package'])) return;
                        const packageId = req.query?.package || undefined;
                        // [#20408] The route's whole answer is
                        // `createMetaBookTreeAnswer` in `./meta-item-read-gate.ts`
                        // — the book and doc reads, THE `DocsAudience` (#19790: one
                        // resolution, four doors), the §6.7 gate on the book's own
                        // audience, the doc locale collapse and the tree narrowed
                        // per caller — which the runtime dispatcher serves this
                        // route through too. ⛔ A step is added there, never here.
                        const answer = await metaReadGate.createMetaBookTreeAnswer(
                            {
                                ...this.metaReadAudienceSources(environmentId, req),
                                listTreeInput: (type, scopedPackageId) => {
                                    const request: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                                        type,
                                        ...(scopedPackageId ? { packageId: scopedPackageId } : {}),
                                        ...(environmentId ? { environmentId } : {}),
                                    };
                                    return prot.getMetaItems(request);
                                },
                                requestLocale: (i18n) => this.extractLocale(req, i18n),
                            },
                            { name: req.params.name, packageId },
                        );
                        if (!answer.ok) {
                            const { code, message, status } = answer.refusal;
                            sendDeclaredFault(res, { code, message, status });
                            return;
                        }
                        res.json(answer.tree);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Resolve a documentation book spine into its rendered tree (ADR-0046 §6)',
                    tags: ['metadata'],
                },
            });

            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type/:name`,
                handler: async (req: any, res: any) => {
                    try {
                        // [#6877] Declared at the top for the same reason #3984
                        // normalizes `:type` here: this handler reads its query
                        // parameters from four different branches hundreds of
                        // lines apart (`?layers=`, `?state=`, `?preview=`,
                        // `?package=`), and a per-branch gate is one a new branch
                        // inherits by accident rather than by construction.
                        if (refuseRepeatedQueryParams(req, res, ['layers', 'state', 'preview', 'package'])) return;
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);

                        // [#3984 / commit 83a3b1f2e] Normalize the `:type` segment ONCE,
                        // here at the top, and let every gate below read THIS
                        // value. The route serves both spellings and Prime
                        // Directive #3 makes the plural one canonical
                        // (`/meta/books/:name`), so any gate comparing the raw
                        // param is a gate the canonical spelling walks past.
                        //
                        // #3984 ruled this shape for exactly that reason ("每个
                        // handler 顶部归一一次,后续所有闸门都用归一后的值"), and
                        // commit 83a3b1f2e is why the ruling is written into the code
                        // rather than trusted to memory: eight days after
                        // #3984 landed, the cache-branch condition below still
                        // excluded `doc`/`book` by LITERAL comparison, so
                        // `GET /meta/books/:name` took the cached branch and
                        // the §6.7 audience gate — which lives in the uncached
                        // branch — never ran at all. Measured on the real
                        // server, one `{ permissionSet }`-gated book, one
                        // signed-in caller holding no set:
                        //
                        //     singular "book"  :: cachedCalls=0 status=[403]
                        //     plural   "books" :: cachedCalls=1 status=[]  ← full body served
                        //
                        // A new per-type gate added below inherits the
                        // normalization by default now; there is no raw param
                        // in scope for it to compare against by accident.
                        const metaType = RestServer.metaTypeSingular(req.params.type);

                        // [ADR-0106 D2/D5] Resolve the caller's field-visibility
                        // posture ONCE, here, before any fetch — every exit
                        // below (layered, cached, uncached) projects through
                        // THIS value. Resolving per-branch is how an outlet gets
                        // forgotten; resolving before the fetch is what makes
                        // D3's `fetch → mask → send` ordering structural rather
                        // than a convention.
                        let maskPosture: ObjectSchemaMaskPosture;
                        try {
                            maskPosture = await (await this.resolveObjectMasker(environmentId, req, metaType))(req.params.name);
                        } catch (maskError: any) {
                            if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                                sendFieldVisibilityFault(res, req.params.name);
                                return;
                            }
                            throw maskError;
                        }

                        // Phase 3a-layered-get: opt-in 3-state view when client
                        // asks for `?layers=true` (or any non-empty value).
                        // Skips the cache path entirely — layered view is a
                        // diagnostic endpoint, not on the hot read path.
                        //
                        // [#5563 → #5882] DEPRECATED SPELLING. This flag makes one
                        // route answer a SECOND resource representation — three
                        // layers side by side (`code` / `overlay` / `effective`),
                        // where `effective` is what the plain read returns — while
                        // the route declares a single `responseSchema`. #5563
                        // converged the ordinary read and left this half open
                        // because collapsing the layers into
                        // `GetMetaItemResponseSchema`'s single `item` would delete
                        // the diagnostic outright.
                        //
                        // #5882 closed it the other way (maintainer ruling, 2026-08-06):
                        // the projection is now its own path,
                        // `GET /meta/:type/:name/layers`, declared by
                        // `GetMetaItemLayeredResponseSchema`. One path, one shape.
                        //
                        // This branch stays for a deprecation window so existing
                        // callers (Studio's metadata editor) are not broken by the
                        // move. It answers the IDENTICAL body — same helper, not a
                        // copy — and advertises the successor in the response
                        // headers, so a client can discover the migration without
                        // reading the changelog. Delete this branch (and the
                        // headers with it) once the callers have moved.
                        //
                        // [#20478] The flag's parse (`wantsMetaItemLayers`) and its
                        // headers (`metaItemLayersDeprecationHeaders`: RFC 9745
                        // `Deprecation` + RFC 8288 `Link` to the successor) are the
                        // ones the runtime dispatcher's item read asks too, so the
                        // deprecated spelling is one answer on both transports.
                        //
                        // [#20508] The `Link` names the path THIS request arrived
                        // on (`IHttpRequest.path`), read the way the dispatcher
                        // reads its request URL (`requestedItemPath`, runtime
                        // `domains/meta.ts`): parsed as a URL path, without its
                        // trailing slash. ⛔ Never `metaPath` — on the
                        // environment-scoped mount that is the route TEMPLATE, and
                        // the successor read `/environments/:environmentId/…/layers`,
                        // a path no client can request. The parse is what keeps the
                        // path a valid URI reference: the Hono adapter hands over a
                        // `decodeURI`'d path (`lead%20all` arrives as `lead all`),
                        // and the parse percent-encodes it again. A request with no
                        // path names no successor: `Deprecation` alone, as the
                        // helper prescribes for a transport that cannot say where
                        // it serves the item.
                        const wantLayered = metaReadGate.wantsMetaItemLayers(req.query);
                        if (wantLayered && typeof (p as any).getMetaItemLayered === 'function') {
                            const requestPath: unknown = req.path;
                            const deprecation = metaReadGate.metaItemLayersDeprecationHeaders(
                                typeof requestPath === 'string' && requestPath.startsWith('/')
                                    ? new URL(`http://rest-server.invalid${requestPath}`).pathname.replace(/\/+$/, '') || undefined
                                    : undefined,
                            );
                            for (const [header, value] of Object.entries(deprecation)) res.header(header, value);
                            await this.serveMetaItemLayered(req, res, environmentId, p, maskPosture);
                            return;
                        }

                        // Check if cached version is available.
                        // For `app` metadata we skip the cache path so the
                        // per-user RBAC filter below can apply without
                        // corrupting shared ETags across admin vs member
                        // viewers of the same app schema. Drafts also
                        // bypass cache: the cache is keyed on the
                        // published checksum and drafts are out-of-band.
                        const isAppType = metaType === 'app';
                        // [#20338] The caller, resolved ABOVE the two draft
                        // switches because each is admitted per caller; the
                        // #9454 org resolution below reads the same value.
                        // Memoised per request — not a new seam.
                        const readCtx = await this.resolveExecCtx(environmentId, req)
                            .catch(rethrowAuthzStoreUnavailable);
                        // [#20338] Both draft switches are declared WITH their
                        // admission ({@link mayReadPendingDrafts}). A caller who
                        // may not read drafts is answered this read as if
                        // neither switch were present — the published item,
                        // pruned as the plain read prunes it, or its absence —
                        // and no later branch re-reads `?state=` past the gate
                        // (the uncached arm used to parse it a second time).
                        const isDraftRead = typeof req.query?.state === 'string'
                            && req.query.state.toLowerCase() === 'draft'
                            && mayReadPendingDrafts(readCtx);
                        // ADR-0033/0037 — `?preview=draft` overlays a pending
                        // draft on the active item (draft wins, falls back to
                        // active). Must also bypass the cache: ETags are keyed
                        // on the published checksum, so a cached 304 would pin
                        // the preview to the stale published world.
                        const previewDrafts = typeof req.query?.preview === 'string'
                            && req.query.preview.toLowerCase() === 'draft'
                            && mayReadPendingDrafts(readCtx);
                        // ADR-0048 — a `?package=` read is package-scoped
                        // (prefer-local). The cached path keys ETags on
                        // type+name only and does NOT thread `packageId` into
                        // `getMetaItemCached`, so two installed packages shipping
                        // the same type/name would share one cache entry and the
                        // scope hint would be silently dropped. Bypass the cache
                        // when a package scope is requested so the disambiguating
                        // `getMetaItem(type, name, packageId)` path runs.
                        const packageScoped = typeof req.query?.package === 'string'
                            && req.query.package.length > 0;
                        // `doc` and `book` bypass the shared cache: their §6.7
                        // audience gate is per-caller, and a shared ETag would
                        // leak gated content across viewers.
                        //
                        // [commit 83a3b1f2e] That sentence was already here while the
                        // exclusion beneath it compared the RAW param against
                        // the literals `'doc'` / `'book'`, so the canonical
                        // plural spelling took the cached branch and shipped
                        // the gated body. The exclusion is not incidental
                        // tidying — it is the stated security invariant above,
                        // and it now reads the normalized `metaType`.
                        //
                        // The bypass exists only to make the per-caller gate in
                        // the uncached branch reachable ({@link metaItemReadGate},
                        // whose `book` / `doc` arm is the §6.7 gate). [#20156]
                        // A type that gate judges and this exclusion misses is
                        // served ungated from the cache: the census in
                        // `meta-alternate-door-read-gates.test.ts` drives this
                        // read with a cached protocol method present, so that
                        // miss reddens its plain-read row.
                        //
                        // [#5881] `dashboard` bypasses it too, and the reason is
                        // NOT the one above — worth writing down, because the
                        // obvious reading says a dashboard needn't bypass at all.
                        // Its ADR-0057 D10 widget gate (`filterDashboardForUser`,
                        // below) is per-DEPLOYMENT — it asks which optional kernel
                        // services are registered — never per-caller, so there is
                        // no cross-viewer leak to avoid. What rules out sharing
                        // the cached path is the validator itself: the ETag is
                        // `simpleHash(locale + JSON.stringify(item))` over the
                        // UNFILTERED document (metadata-protocol `getMetaItemCached`),
                        // so it cannot express the gate dimension at all, and
                        // `notModified` is decided inside the protocol before this
                        // layer could re-judge it. Gating the cached body would
                        // therefore ship a filtered body under a validator that
                        // identifies the unfiltered one.
                        //
                        // That mismatch is not academic, because the two have
                        // different lifetimes. Within one boot the registered-service
                        // set is fixed (`Kernel.use()` throws once bootstrap has
                        // started, and no deregistration API exists), so the gate
                        // verdict is stable per process — but `Cache-Control:
                        // private, no-cache` means the client STORES the body and
                        // revalidates, and that stored body outlives the process.
                        // A redeploy that turns the optional service off does not
                        // change the document, so the ETag is unchanged, every
                        // revalidation answers 304, and the stale unfiltered body
                        // stands: the dead tile D10 exists to prevent, now cached
                        // indefinitely. Bypassing costs nothing to weigh against
                        // that — `getMetaItemCached` delegates to `getMetaItem`,
                        // so the server does identical work either way and only
                        // the 304's saved body bytes are given up.
                        //
                        // Compared on the NORMALIZED type, like every other
                        // exclusion in this condition (`/meta/dashboards/x` is
                        // the canonical plural spelling under Prime Directive
                        // #3, and an exclusion it could be spelled around would
                        // not be an exclusion). The `doc` / `book` literals
                        // that stood at the end of this condition had exactly
                        // that hole; commit 83a3b1f2e closed it.
                        const isDashboardType = metaType === 'dashboard';
                        // ADR-0046 §6.7 — the two audience-gated types, excluded
                        // from the cache so {@link metaItemReadGate} judges them.
                        const isAudienceGatedType = metaType === 'book' || metaType === 'doc';
                        // [#9454] ONE org resolution for BOTH arms of the fork
                        // below, computed ABOVE it on purpose. `view` takes the
                        // cached arm; `dashboard` bypasses it via
                        // `isDashboardType` and takes the uncached arm. A scope
                        // threaded into only one arm fixes exactly ONE of the
                        // five org-overridable types while the receipt keeps
                        // claiming success for the rest — the half-fix this
                        // card's pin exists to forbid. Hoisting it makes the
                        // two arms incapable of disagreeing about scope.
                        // ⚠️ NOT a new seam: memoised per request, and this
                        // handler resolves the same context again further down.
                        // [#20338] `readCtx` is resolved above the draft switches.
                        // [folded-type commit 26f3588fb] (the original card no
                        // longer resolves) FOLDED, not raw — see the PUT door's
                        // org-scope comment for the measurement. [#20408] Asked of
                        // `metaReadOrganizationId`, the one answer the runtime
                        // dispatcher's item read asks too.
                        const readOrganizationId = metaReadGate.metaReadOrganizationId(req.params.type, readCtx);
                        if (metadata.enableCache && p.getMetaItemCached && !isAppType && !isDashboardType && !isDraftRead && !previewDrafts && !packageScoped && !isAudienceGatedType) {
                            // [ADR-0106 D3] When a projection applies, the
                            // protocol is NOT allowed to judge the conditional
                            // request: `getMetaItemCached` hashes the UNFILTERED
                            // document, so a `304` decided there would pin this
                            // caller to a body no mask ever touched — the same
                            // validator-vs-served-body mismatch #5881 recorded
                            // for the dashboard gate. The comparison moves below,
                            // against the fingerprinted ETag, which is the one
                            // that identifies what we are actually sending.
                            const maskApplies = maskPosture.kind !== 'passthrough';
                            // [#21476] Same move for a `view`: its body can carry
                            // the public-form intake reason, which derives from
                            // the posture and the bound object, and the
                            // protocol's validator hashes neither. With no reason
                            // the folded ETag is byte-identical, so a view's
                            // `304` answers exactly as before.
                            const intakeFolds = metaType === 'view';
                            const cacheRequest = {
                                ifNoneMatch: (maskApplies || intakeFolds) ? undefined : (req.headers['if-none-match'] as string),
                                ifModifiedSince: req.headers['if-modified-since'] as string,
                            };

                            // Resolve the response locale up-front and fold it
                            // into the cache key. The body is translated below
                            // (`translateMetaItem`) *after* this validator runs,
                            // so without a locale-aware ETag a language switch
                            // would return a stale-locale 304 (issue #1319).
                            const cacheI18n = await this.resolveI18nService(environmentId, req);
                            const cacheLocale = this.extractLocale(req, cacheI18n);

                            // [commit 2a29caa53] Typed request — `as any` retired. The
                            // cached read carries NO draft-visibility members
                            // on purpose: this branch is unreachable when a
                            // draft switch is ADMITTED (`previewDrafts` /
                            // `isDraftRead` true — the fork above bypasses the
                            // cache for both), and the implementation's
                            // `getMetaItemCached` signature declares neither.
                            // [#20320] The query PARAMETER still reaches here:
                            // a caller `mayReadPendingDrafts` does not admit
                            // sends `?state=draft` / `?preview=draft` and is
                            // answered this arm, the plain read's (#20338).
                            const cachedRequest: TransportScopedMetaRequest<GetMetaItemCachedRequest> = {
                                type: req.params.type,
                                name: req.params.name,
                                cacheRequest,
                                ...(cacheLocale ? { locale: cacheLocale } : {}),
                                ...(environmentId ? { environmentId } : {}),
                                // [#9454] The cached door is the `view` arm, and
                                // it used to hard-code a two-key delegation to
                                // `getMetaItem` — it could not express an org at
                                // all, so this threading is paired with a widened
                                // signature in `metadata-protocol`. The org also
                                // enters the ETag there, so the validator states
                                // the scope rather than inheriting it.
                                ...(readOrganizationId ? { organizationId: readOrganizationId } : {}),
                            };
                            const result = await p.getMetaItemCached(cachedRequest);

                            if (result.notModified) {
                                res.status(304).send();
                                return;
                            }

                            // [ADR-0106 D1/D3] fetch → mask → send. The shared
                            // cache still stores ONE full schema per (type,
                            // name, locale, environment) — no caller dimension
                            // in the key — and what varies per caller is this
                            // projection plus the validator below.
                            let cachedDocument: any = result.data;
                            let visibilityFingerprint = '';
                            if (maskPosture.kind === 'project') {
                                // [#21884] Related to the fetched document: its `objectOverride` params name other objects.
                                const related = await relateObjectSchemaMaskPosture(maskPosture, cachedDocument);
                                const masked = this.maskObjectDocument(res, related, req.params.name, cachedDocument);
                                if (!masked) return;
                                cachedDocument = masked.document;
                                visibilityFingerprint = masked.fingerprint;
                            }
                            // [#21476] The administrator's read names why an open
                            // public form is not offered on this posture.
                            let intakeFingerprint = '';
                            if (intakeFolds) {
                                const warnings = await this.anonymousFormIntakeWarnings(environmentId, req, p, cachedDocument);
                                cachedDocument = stampAnonymousFormIntakeWarnings(cachedDocument, warnings);
                                intakeFingerprint = anonymousFormIntakeFingerprint(warnings);
                            }

                            // [ADR-0106 D6 tier 2] Visibility undetermined →
                            // the body is unmasked, so it must not be stored or
                            // revalidated under a SHARED validator: a later 304
                            // would hand this body to a caller whose projection
                            // did resolve. No ETag, no Last-Modified, no-store.
                            if (maskPosture.kind === 'undetermined') {
                                res.header('Cache-Control', 'private, no-store');
                                res.header('Vary', 'Accept-Language');
                                res.json(await this.translateMetaEnvelope(
                                    req, req.params.type, environmentId,
                                    { type: metaType, name: req.params.name },
                                    cachedDocument, cacheI18n,
                                ));
                                return;
                            }

                            // Set cache headers
                            if (result.etag) {
                                // [ADR-0106 D3] Fold the caller's field-visibility
                                // fingerprint into the shared validator. An
                                // unrestricted caller denies nothing → the
                                // fingerprint is empty → the ETag is byte-identical
                                // to the pre-ADR one. A cohort shares 304s; a
                                // permission change moves the fingerprint and
                                // self-invalidates the stale 304.
                                const value = foldVisibilityFingerprintIntoEtag(
                                    foldVisibilityFingerprintIntoEtag(result.etag.value, visibilityFingerprint),
                                    intakeFingerprint,
                                );
                                const etagValue = result.etag.weak
                                    ? `W/"${value}"`
                                    : `"${value}"`;
                                res.header('ETag', etagValue);
                                if ((maskApplies || intakeFolds) && normalizeIfNoneMatch(req.headers['if-none-match']) === value) {
                                    res.status(304).send();
                                    return;
                                }
                            }
                            if (result.lastModified) {
                                res.header('Last-Modified', new Date(result.lastModified).toUTCString());
                            }
                            if (result.cacheControl) {
                                // `max-age` is a placeholder directive in the
                                // array; its real value is appended from the
                                // `maxAge` field. Strip the bare token before
                                // joining so the two never collide into the
                                // malformed `public, max-age, max-age=3600`.
                                const parts: string[] = result.cacheControl.directives
                                    .filter((d: string) => d !== 'max-age');
                                if (result.cacheControl.maxAge != null) {
                                    parts.push(`max-age=${result.cacheControl.maxAge}`);
                                }
                                res.header('Cache-Control', parts.join(', '));
                            }

                            res.header('Vary', 'Accept-Language');
                            // [#5563] `getMetaItemCached` hands back the metadata
                            // document with the envelope already stripped
                            // (`result.data`; it does `const item = result?.item`
                            // internally). This branch is the DEFAULT — `enableCache`
                            // defaults to `true` — so leaving it unwrapped made the
                            // one shape `packages/spec` declares for this route the
                            // one a default deployment could never obtain. Rebuild
                            // the declared envelope here, in the REST layer that
                            // owns the response contract.
                            //
                            // `type` is folded to the canonical singular exactly as
                            // `metadata-protocol` folds it (#4432), so `/meta/objects/x`
                            // and `/meta/object/x` cannot answer two different `type`
                            // values across a configuration switch. The cached read
                            // carries no `lock` — it is the fast published-value path
                            // and never consulted the lock resolver; a caller that
                            // needs the ADR-0008 OCC carriers reads the uncached path.
                            // [#22114] That includes `version`, the read's token. Its
                            // ETag above stays the CACHE validator and is not the token:
                            // the validator varies by locale (#1319), by the caller's
                            // field visibility (ADR-0106 D3) and by the served bytes
                            // (`getMetaItemCached`, #16525), none of which moves the
                            // stored row's version, and an item with no stored row has
                            // a validator but no version at all.
                            const cachedEnvelope = {
                                type: metaType,
                                name: req.params.name,
                            };
                            res.json(await this.translateMetaEnvelope(
                                req, req.params.type, environmentId, cachedEnvelope, cachedDocument, cacheI18n,
                            ));
                        } else {
                            // Non-cached version
                            // [#22128] The save door's reading of `?package=`
                            // ({@link metaItemPackageBinding}): the served
                            // `version` is resolved at the address that save
                            // writes, so `all` names no package here either.
                            const packageId = metaItemPackageBinding(req.query?.package);
                            // [commit 2a29caa53] Typed against the spec request shape —
                            // the `as any` this literal used to carry is
                            // retired now that the spec declares `state` and
                            // `previewDrafts` (and `organizationId`, #9726).
                            // No transport envelope: this door does not thread
                            // `environmentId` (the kernel was already resolved
                            // above), so the plain declared shape suffices.
                            const itemRequest: GetMetaItemRequest = {
                                type: req.params.type,
                                name: req.params.name,
                                packageId,
                                // [#20338] The ADMITTED switches declared above,
                                // never `req.query` re-read here.
                                ...(isDraftRead ? { state: 'draft' as const } : {}),
                                ...(previewDrafts ? { previewDrafts: true } : {}),
                                // [#9454] The uncached arm — `dashboard`'s route
                                // (`isDashboardType`), and every read the cache
                                // exclusions divert here. Same hoisted scope as
                                // the cached arm above, by construction.
                                ...(readOrganizationId ? { organizationId: readOrganizationId } : {}),
                            };
                            const envelope = await p.getMetaItem(itemRequest) as Record<string, any>;

                            // [#20408] Everything this read does to the envelope
                            // after the store read is ONE chain,
                            // `createMetaItemAnswer` in `./meta-item-read-gate.ts`,
                            // which the runtime dispatcher's `/meta` item read calls
                            // too. Its docblock carries each step's rule and their
                            // order — [#18066] absence judged BEFORE the gate (a name
                            // with nothing behind it can never become #8013's `403`),
                            // [#20156] THE per-caller read gate, the ADR-0046 doc
                            // locale collapse, the [ADR-0106 D1/D5(1)] mask under the
                            // posture resolved above (this uncached exit serves
                            // `?state=draft`, `?preview=draft`, `?package=` and every
                            // `enableCache: false` deployment, so a mask living only
                            // in the cached arm would be walked past by a query
                            // parameter), and the body: the translation and #10235's
                            // `sortability`. ⛔ An item step is added there, never
                            // here (`meta-list-projection-parity.test.ts` in
                            // `@objectstack/runtime` derives its census from this
                            // handler and fails on one added here).
                            //
                            // The gate's policy is this read's: every arm and the app
                            // PRUNED, to every caller, its authors included
                            // (read-to-display is per user) — save [#20290] the
                            // `?state=draft` branch, which serves a STORED version
                            // (the pending draft row) and so reads under the
                            // stored-version doors' policy
                            // ({@link STORED_VERSION_DOOR_POLICY}): Studio's designers
                            // merge this answer over the layered view and save it
                            // back, so whoever may save the app reads its draft
                            // whole, every other caller pruned per caller (ruling
                            // 5856774816), and no per-DEPLOYMENT gate. [#20338] "Every
                            // other caller" is every other caller who may READ
                            // drafts: one who may not never reaches this branch
                            // (`isDraftRead` is false for them).
                            const readPolicy: MetaReadGatePolicy = isDraftRead
                                ? RestServer.STORED_VERSION_DOOR_POLICY
                                : { arms: 'all', app: 'gate' };
                            const answer = await metaReadGate.createMetaItemAnswer(
                                this.metaItemAnswerSources(environmentId, req, p, readPolicy),
                                { metaType, name: req.params.name, policy: readPolicy, maskPosture },
                            )(envelope);
                            if (answer.kind === 'refuse') {
                                // `absent` is {@link sendMetaItemAbsent}, byte for byte.
                                RestServer.sendMetaReadRefusal(res, answer.refusal);
                                return;
                            }
                            if (answer.kind === 'mask-fault') {
                                sendFieldVisibilityFault(res, answer.object);
                                return;
                            }
                            // [ADR-0106 D6 tier 2] Visibility undetermined → the
                            // body is unmasked, so it must not be stored or
                            // revalidated under a shared validator.
                            if (answer.cacheControl) res.header('Cache-Control', answer.cacheControl);
                            res.header('Vary', 'Accept-Language');
                            res.json(answer.envelope);
                        }
                    } catch (error: any) {
                        // [#18402] THE one absence answer, whichever arm
                        // produced it — the last half of #18066.
                        //
                        // #18066 gave this route a single absence EMITTER
                        // ({@link sendMetaItemAbsent}) and reached it from the
                        // two conditions that RETURN nothing. The conditions
                        // that THROW one were left on the classification door
                        // below, which renders the flat `{ error: '<message>',
                        // code }` — so `body.error.code`, the accessor #8013
                        // settled on and objectui#4252 reads, was `undefined`
                        // on exactly those. Which one a caller got was decided
                        // by two things it cannot see:
                        //
                        //  - `metadata.enableCache` (default TRUE). The cached
                        //    arm's `getMetaItemCached` THROWS
                        //    `metadataItemNotFoundError` on a falsy `item`; the
                        //    uncached arm resolves item-less and returns. One
                        //    request, one missing name, two envelopes, chosen
                        //    by a server setting — the #7035 failure class.
                        //  - which protocol implementation is mounted. The
                        //    in-repo `metadata-protocol` resolves item-less
                        //    from `getMetaItem`, but a protocol that throws the
                        //    miss instead reached the same flat door
                        //    (pinned in `rest-meta-outage-vs-miss.test.ts`).
                        //
                        // Recognised by the ANSWER this repo's own
                        // classification door would have given — see
                        // {@link thrownAnswerIsBareNotFound}, which asks that
                        // door rather than re-reading the error, so this fork
                        // and the `handleRouteError` it forks away from cannot
                        // drift apart about what a caught value means.
                        //
                        // ⛔ NOT "the status is 404", and that narrowing was
                        // measured rather than assumed. `NO_DRAFT` is a 404 on
                        // THIS route — the Studio designer's `?state=draft`
                        // probe, pinned byte-for-byte two files over — and it
                        // says the item IS there and its draft is not.
                        // Answering it as absence would tell a designer the
                        // object does not exist, which is #5532's flattening
                        // reintroduced by the repair for a sibling of it. Same
                        // reasoning excludes a producer-declared code the
                        // ledger does not know: ADR-0112 keeps that spelling in
                        // `declaredCode`, and converting would delete it.
                        //
                        // ⭐ It STRENGTHENS the ADR-0045 §3 property rather
                        // than merely preserving it. The unpublished app and
                        // the service-gated one answer through the emitter, so
                        // an absence that kept the thrown dialect was a
                        // response pair that told them apart — by envelope
                        // shape, and by the producer's `Metadata item
                        // <type>/<name> not found` prose where the emitter says
                        // one fixed sentence. Four arms, one body now; the
                        // byte-identity is pinned in
                        // `meta-item-absent-404.test.ts` §2 and §5.
                        //
                        // ⛔ NOT a convergence of the flat dialect itself. The
                        // audience gate's `sendDeclaredFault` 401/403 beside
                        // this, and the door in `error-response.ts`, still
                        // answer flat: that position is the live ratchet
                        // #9559 owns repo-wide (`check:route-envelope`), and
                        // converting two of its four emissions here would mint
                        // a new divergence — the same refusal answering two
                        // shapes depending on which ROUTE served it.
                        if (thrownAnswerIsBareNotFound(error)) {
                            sendMetaItemAbsent(res);
                            return;
                        }
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Get specific metadata item',
                    tags: ['metadata'],
                },
            });
        }

        // PUT /meta/:type/:name - Save metadata item
        // We always register this route, but return 501 if protocol doesn't support it
        // This makes it discoverable even if not implemented
        registerPerItemRoute({
            method: 'PUT',
            path: `${metaPath}/:type/:name`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [#6603] Authoring capability gate — the SAME mechanism
                    // `POST /meta/_migrate-stored` uses next door, deliberately
                    // not a second way of demanding the same capability.
                    //
                    // Two independent reasons, either sufficient:
                    //
                    //  1. **The ADR-0106 round-trip.** D1 removes an unreadable
                    //     field WHOLE from a served object schema, and this
                    //     route persists the body it is handed. So a non-exempt
                    //     caller's ordinary GET → edit a label → PUT used to
                    //     store the schema back MINUS the fields masked out of
                    //     their own read — silent deletion of fields they were
                    //     never allowed to see, with nothing in the exchange
                    //     saying so. Refusing the write is the write-side answer
                    //     the masking needs: it makes "whoever may write a
                    //     schema is whoever sees all of it" an enforced
                    //     invariant instead of a coincidence, rather than
                    //     teaching `saveMetaItem` that absent means keep (which
                    //     would make field DELETION inexpressible for everyone).
                    //  2. It closes a hole that predates masking entirely: any
                    //     authenticated session could clobber any metadata item.
                    //
                    // Gate FIRST — before the protocol is resolved — so an
                    // unauthorized caller cannot use the 501-vs-200 answer to
                    // probe which kernels implement saving, and so nothing is
                    // written before the refusal. `manage_metadata` is
                    // ADR-0066 D1's authoring capability and saving a metadata
                    // item is authoring; `isSystem` bypasses, matching every
                    // other capability gate on the platform.
                    //
                    // [#12702] The gate is the shared `metaWriteCapabilityVerdict`
                    // (`@objectstack/metadata-core`, beside the org-scope
                    // predicate this door already runs): beside `manage_metadata`
                    // it admits `manage_org_presentation`, ONLY for a type whose
                    // registry entry declares `allowOrgOverride: true` AND a
                    // session with an active organization — `ctx.tenantId`, the
                    // very value `organizationIdForMetaWrite` threads below, so
                    // an admitted write can only land org-scoped in the caller's
                    // own partition: never env-wide, never another org's.
                    //
                    // [#20156] Asked through {@link metaSaveVerdict}, the ONE
                    // spelling the stored-version read doors' author exemption
                    // asks too (ruling 5856774816): whoever this door admits
                    // reads the stored version whole there, whatever the plain
                    // read withholds from them — so what they save back is
                    // everything that was stored.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                    {
                        const verdict = RestServer.metaSaveVerdict(ctx, req.params.type);
                        if (!verdict.allowed) {
                            res.status(403).json({
                                error: {
                                    code: 'FORBIDDEN',
                                    message: verdict.message,
                                },
                            });
                            return;
                        }
                    }
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!p.saveMetaItem) {
                        // [#7035] ADR-0112 envelope: the semantic code lives at
                        // `error.code`, NOT as a sibling of `error`. This site
                        // used to answer `{ error: '<msg>', code: 'NOT_IMPLEMENTED' }`
                        // while `POST /meta/_migrate-stored` a few hundred lines
                        // up answered the nested shape for the same condition,
                        // so a client reading `err.error.code` got `undefined`
                        // here — and `undefined` takes the "no code" branch, not
                        // an error branch. `NOT_IMPLEMENTED` is unchanged: it is
                        // already the standard-catalog code ADR-0112 maps 501 to
                        // (`spec/src/api/errors.zod.ts` — the catalog member and
                        // `standardErrorCodeForHttpStatus(501)`).
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'Save operation not supported by protocol implementation',
                            },
                        });
                        return;
                    }

                    // Accept both `{ ...itemFields }` (bare) and `{ metadata: {...} }`
                    // / `{ item: {...} }` envelope shapes. Studio and direct API
                    // callers historically use either; ADR-0005 settles on
                    // unwrapping to a single payload before persistence.
                    const body = req.body ?? {};
                    const item = (body && typeof body === 'object' && 'metadata' in body)
                        ? (body as any).metadata
                        : (body && typeof body === 'object' && 'item' in body)
                            ? (body as any).item
                            : body;

                    // Opt-in OCC under ADR-0008 PR-10d.3: callers (Studio,
                    // CLI) may set `If-Match` to the version token a receipt
                    // served, to enforce that the overlay row has not advanced
                    // since they last read it. A `null`/empty body or no header
                    // preserves the legacy last-write-wins behaviour. [#21207]
                    // The token is the crypto provider's keyed digest of the
                    // stored content hash, never the hash itself; the protocol
                    // compares it in that form, so it passes through here as sent.
                    // [#22114] The item read serves the same token as `version`,
                    // and `If-None-Match: *` pins a save that expects no row —
                    // see {@link metaSavePreconditionPin}.
                    const pin = metaSavePreconditionPin(req.headers);
                    if (!pin.ok) {
                        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: pin.message } });
                        return;
                    }
                    const parentVersion = pin.parentVersion;
                    // [#7749 producer, #7941 precedence] The request's authenticated
                    // identity — one producer, shared by every `/meta` write (see
                    // resolveMetaWriteActor). `X-Actor` is not consulted.
                    const actor = await this.resolveMetaWriteActor(environmentId, req);
                    // Phase 3a-destructive: `?force=true` opts past the
                    // destructive-change safety check. Accept any truthy
                    // string ('true', '1', 'yes') for resilience.
                    //
                    // [#6877] THE sharp one on this surface. The `typeof` ternary
                    // below falls to `!!forceRaw` for anything that is not a
                    // string, and a non-empty array is truthy — so
                    // `?force=false&force=false`, a caller repeating an explicit
                    // OPT-OUT, turned the destructive-change guard ON. An
                    // inversion, on a destructive verb, reported as 200.
                    if (refuseRepeatedQueryParams(req, res, ['force', 'package', 'mode'])) return;
                    const forceRaw = req.query?.force;
                    const force = typeof forceRaw === 'string'
                        ? ['true', '1', 'yes', 'on'].includes(forceRaw.toLowerCase())
                        : !!forceRaw;

                    // Software-package binding (Studio package authoring).
                    // `?package=<id>` binds the saved row to that package
                    // (sys_metadata.package_id). 'all'/empty = env-local overlay
                    // ({@link metaItemPackageBinding}, the item read's too).
                    const packageId = metaItemPackageBinding(req.query?.package);

                    // [#8805] THE WRITE-SIDE ORGANIZATION. Until this landed the
                    // door passed none, so `recordMetadataAudit` stamped
                    // `organization_id: null` on EVERY row a REST-authored
                    // metadata write produced (`entry.organizationId ?? null`).
                    // Composed with #8803's scoped read — own-org rows PLUS
                    // env-wide ones, a limb that is required, not optional —
                    // that made every REST-authored audit row readable by every
                    // tenant, carrying its `actor`, `note`, `lock_state` and
                    // `request_id`. The read half could not close it: the rows
                    // were genuinely unscoped, so no filter could separate them.
                    //
                    // Two measurements decided the SHAPE, and neither is
                    // obvious from the defect:
                    //
                    //  1. The organization must NOT be threaded unconditionally.
                    //     `saveMetaItem`'s `organizationId` is one value feeding
                    //     two things — the `sys_metadata` partition the row
                    //     lands in AND the audit row — and the protocol REFUSES
                    //     an org-scoped write of a type the registry declares
                    //     `allowOrgOverride: false` (`NOT_OVERRIDABLE`, 403;
                    //     `orgScopedWriteRefusal`, the #6190 ruling). Passing
                    //     `ctx.tenantId` raw would turn every `PUT /meta/object/*`
                    //     from a tenant-admin session into a 403 — trading a
                    //     disclosure for an outage. `organizationIdForMetaWrite`
                    //     is the registry-derived predicate that answers this,
                    //     and it is the DISPATCHER's own: this door now behaves
                    //     identically to its `/metadata` twin for the same
                    //     request, which is the whole point.
                    //  2. So a non-overridable type still audits env-wide — and
                    //     that is correct rather than residue. Its WRITE is
                    //     env-wide (#6190 option A: the runtime stops minting
                    //     rows boot never reads), so an env-wide audit row is
                    //     the truthful scope for it, symmetric with what the
                    //     `/published` route's comment argues further down this
                    //     file. `null` stays reserved for writes that really are
                    //     environment-wide.
                    //
                    // ⚠️ NOT a new org-resolution seam — the thing the
                    // `/published` comment forbids. `ctx` is the SAME
                    // `resolveExecCtx` result the capability gate above already
                    // resolved (memoised per request, called in 40+ handlers
                    // here); no `resolveActiveOrganizationId` is minted, exactly
                    // as #8803 did for the audit READ on the sibling route.
                    // `computeExecCtx` assembles `tenantId` from the shared
                    // `resolveAuthzContext` — an API key's principal tenant,
                    // else the session's `activeOrganizationId`, which is the
                    // very field the dispatcher twin reads.
                    //
                    // [commit 26f3588fb] The type is FOLDED before the scope decision,
                    // never the raw URL spelling. Storage folds `:type`
                    // through `META_URL_TO_SINGULAR` — the COMPLETE map —
                    // while `declaresOrgOverride` tolerates only the
                    // manifest-collection spellings (incomplete by design;
                    // see its header). Measured on `origin/main` for the two
                    // registry-derived spellings, `translations` and
                    // `email_templates`: the raw segment read and wrote
                    // ENV-WIDE where the singular twin was org-scoped — one
                    // item, two partitions, addressed by spelling (#4432 /
                    // #7894's defect one layer down). Folding HERE keeps the
                    // scope decision and the storage fold answering one
                    // question, which is what `metadata-url-spelling.ts`
                    // mandates: folding happens at the boundary and only
                    // there; the layers below read the canonical singular.
                    const organizationId = organizationIdForMetaWrite(
                        canonicalMetaUrlType(req.params.type), ctx?.tenantId,
                    );
                    // [#12004] The `as any` cast this call carried came off
                    // when `SaveMetaItemRequestSchema` caught up with the
                    // members this door sends. `saveMetaItem` is a REQUIRED
                    // protocol member, so unlike the publish door's old cast
                    // (member existence, TS2339) this one was load-bearing on
                    // REQUEST SHAPE alone: the schema declared only
                    // `{ type, name, item }`, and removing the cast surfaced
                    // TS2353 on every other key. The literal is now compiled
                    // against the spec contract through the commit 2a29caa53
                    // `TransportScopedMetaRequest` wrapper — `environmentId`
                    // is the transport-level routing key that wrapper layers
                    // on, ⛔ never a protocol key; every other key here is
                    // checked against the declared request, so an undeclared
                    // member is a compile error instead of a payload member no
                    // contract has ever seen.
                    const saveRequest: TransportScopedMetaRequest<SaveMetaItemRequest> = {
                        type: req.params.type,
                        name: req.params.name,
                        item,
                        organizationId,
                        // [commit d806081dd] This door answers with an ADR-0112 error
                        // envelope that carries the refusal's `issues[]`
                        // structurally beside the message (`sendError` threads a
                        // top-level `issues`), so `saveMetaItem`'s 422 renders
                        // its findings as a headline here instead of restating
                        // the per-key prose a console would then show twice.
                        // Server-stated: this object is built field by field
                        // from named `req` values and never spreads the body, so
                        // a client cannot smuggle a face in.
                        writeFace: 'meta-envelope',
                        ...(environmentId ? { environmentId } : {}),
                        ...(parentVersion !== undefined ? { parentVersion } : {}),
                        ...(actor ? { actor } : {}),
                        ...(force ? { force: true } : {}),
                        ...(packageId ? { packageId } : {}),
                        ...((typeof req.query?.mode === 'string'
                            && req.query.mode.toLowerCase() === 'draft')
                            ? { mode: 'draft' } : {}),
                    };
                    const result = await p.saveMetaItem(saveRequest);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Save specific metadata item',
                tags: ['metadata'],
            },
        });

        // DELETE /meta/:type/:name - Reset metadata item to artifact default
        // Removes a customization overlay row from sys_metadata (ADR-0005).
        // Returns 200 even when no overlay existed (idempotent reset).
        registerPerItemRoute({
            method: 'DELETE',
            path: `${metaPath}/:type/:name`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [#7019] Same gate, same mechanism as the `PUT` twins —
                    // but the argument for it is NOT the ADR-0106 round trip,
                    // and saying so matters. Nothing is masked here and nothing
                    // is round-tripped: this route discards a customization
                    // overlay outright, so before this gate an authenticated
                    // session holding no authoring capability at all could
                    // reset any customized metadata item in the deployment to
                    // its artifact default — and with `?dropStorage=true`, drop
                    // the object's physical table with it.
                    //
                    // It belongs with the two PUTs because deleting a
                    // customization is authoring it (ADR-0066 D1), and because
                    // the fix is the same four lines — not because it is the
                    // same argument.
                    //
                    // Gate FIRST — before the protocol is resolved — so the
                    // 501-vs-200 answer leaks no kernel capability, and, the
                    // point here, so the refusal happens with the overlay row
                    // still intact. A gate that answers 403 after
                    // `deleteMetaItem` has run would still be the bug.
                    // `isSystem` bypasses, as everywhere else.
                    //
                    // [#12702] Same shared verdict as the PUT door. On THIS
                    // verb the org condition is also what bounds the blast
                    // radius: an admitted org-presentation reset threads the
                    // caller's own organization, and `orgId` selects the
                    // overlay repository — so the only row such a caller can
                    // discard is their own org's overlay, never the env-wide
                    // one (see the [#8805] comment below). `?dropStorage=true`
                    // is `object`-only, and `object` is not org-overridable,
                    // so the org capability can never reach it.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                    {
                        const verdict = metaWriteCapabilityVerdict({
                            isSystem: ctx?.isSystem === true,
                            systemPermissions: ctx?.systemPermissions,
                            canonicalType: canonicalMetaUrlType(req.params.type),
                            activeOrganizationId: ctx?.tenantId,
                            operation: 'reset',
                        });
                        if (!verdict.allowed) {
                            res.status(403).json({
                                error: {
                                    code: 'FORBIDDEN',
                                    message: verdict.message,
                                },
                            });
                            return;
                        }
                    }
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!p.deleteMetaItem) {
                        // [#7035] ADR-0112 envelope. This site was the worst of
                        // the three shapes: a BARE STRING `error`, with no code
                        // at all — so neither `err.error.code` nor `err.code`
                        // resolved, and `err.error.message` read `undefined`
                        // too. `NOT_IMPLEMENTED` is the standard-catalog code
                        // for 501 (ADR-0112; `standardErrorCodeForHttpStatus`).
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'Reset operation not supported by protocol implementation',
                            },
                        });
                        return;
                    }
                    // Mirror saveMetaItem's OCC + actor plumbing (ADR-0008
                    // PR-10d wiring): `If-Match` pins the expected current
                    // version so concurrent edits get a 409 instead of a
                    // silent reset; the request's authenticated identity flows
                    // into the history tombstone row (#7749 producer; #7941
                    // dropped the `X-Actor` limb that used to outrank it).
                    const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                    const parentVersion = typeof ifMatchHeader === 'string'
                        ? ifMatchHeader.replace(/^"|"$/g, '')
                        : undefined;
                    // [#7749 producer, #7941 precedence] The request's authenticated
                    // identity — one producer, shared by every `/meta` write (see
                    // resolveMetaWriteActor). `X-Actor` is not consulted.
                    const actor = await this.resolveMetaWriteActor(environmentId, req);

                    // [#6877] `?state=` and the destructive `?dropStorage=`
                    // both fail SAFE on an array today (the comparisons stop
                    // matching), but "the wrong answer happens to be the
                    // conservative one" is not a rule a caller can rely on and
                    // is not what the request asked for.
                    if (refuseRepeatedQueryParams(req, res, ['state', 'dropStorage'])) return;
                    const stateParam = typeof req.query?.state === 'string'
                        && req.query.state.toLowerCase() === 'draft'
                        ? 'draft' as const
                        : undefined;

                    // `?dropStorage=true` also tears down the object's physical
                    // table (object + active only). Used by the "discard a
                    // previewed object" flow so a publish-to-preview leaves no
                    // orphan table. Destructive — opt-in, defaults off.
                    const dropStorage = req.query?.dropStorage === 'true' || req.query?.dropStorage === '1';

                    // [#8805] Same write-side organization as the `PUT` twins —
                    // and on this verb it is not only the audit row. `orgId`
                    // selects the overlay repository, so it decides WHICH row a
                    // reset destroys. Once a `view` authored here lands
                    // org-scoped, a delete that passed no organization would
                    // reach past the caller's own overlay and reset the ENV-WIDE
                    // row instead — one tenant's "reset to default" blanking the
                    // item for every other tenant and the control plane, which
                    // is the failure `restoreArtifactRegistryView` records having
                    // already been paid for once. The two halves have to move
                    // together. `ctx` is the capability gate's own
                    // `resolveExecCtx` result, resolved above.
                    const organizationId = organizationIdForMetaWrite(
                        // [commit 26f3588fb] FOLDED, not raw — see the PUT door's
                        // org-scope comment for the measurement.
                        canonicalMetaUrlType(req.params.type), ctx?.tenantId,
                    );
                    // [#11679] The `(p as any)` cast this call carried came off
                    // when `DeleteMetaItemRequestSchema` caught up with the
                    // eight members this door sends. Unlike the publish door's
                    // cast (member existence, TS2339), this one was load-bearing
                    // on REQUEST SHAPE: the member was declared all along, but
                    // the schema declared only `{ type, name }`, so removing the
                    // cast surfaced TS2353 on six keys. The literal is now
                    // compiled against the spec contract through the commit 2a29caa53
                    // `TransportScopedMetaRequest` wrapper — `environmentId` is
                    // the transport-level routing key that wrapper layers on,
                    // ⛔ never a protocol key; every other key here is checked
                    // against the declared request, so an undeclared member is a
                    // compile error instead of a payload member no contract has
                    // ever seen. The 501 guard above stays: the member is
                    // declared OPTIONAL, and the guard is what narrows it to
                    // callable here.
                    const deleteRequest: TransportScopedMetaRequest<DeleteMetaItemRequest> = {
                        type: req.params.type,
                        name: req.params.name,
                        organizationId,
                        ...(environmentId ? { environmentId } : {}),
                        ...(parentVersion !== undefined ? { parentVersion } : {}),
                        ...(actor ? { actor } : {}),
                        ...(stateParam ? { state: stateParam } : {}),
                        ...(dropStorage ? { dropStorage: true } : {}),
                    };
                    const result = await p.deleteMetaItem(deleteRequest);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Reset metadata item to artifact default (deletes customization overlay)',
                tags: ['metadata'],
            },
        });

        // GET /meta/:type/:name/history — durable change-log for one item.
        // Returns the sys_metadata_history events that the Studio "History"
        // tab renders as an audit timeline. Overlay-only metadata types
        // (view/dashboard/report/email_template) return real events;
        // non-overlay types return `{ events: [] }` (the legacy raw-engine
        // path does not record history).
        registerPerItemRoute({
            method: 'GET',
            path: `${metaPath}/:type/:name/history`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [#20378] AN AUTHORING DOOR — ruling 5865708652 (letter B).
                    // `sys_metadata_history` is the authoring commit log
                    // (ADR-0067), and a DRAFT save appends a row to it exactly
                    // as an active save does, with nothing on the row to tell
                    // the two apart — so this log, served to a caller who may
                    // not read pending drafts, lists unpublished authoring work
                    // (ADR-0106 D4: 「draft/preview reads are admin-gated
                    // upstream」). The caller is asked
                    // {@link mayReadPendingDrafts} FIRST, and one it does not
                    // admit is refused exactly as `GET /meta/_drafts` refuses
                    // (403 `FORBIDDEN`, the same nested envelope): before the
                    // protocol is resolved (no 501-vs-200 probe), before the
                    // query is parsed, before any item or event is read. The
                    // answer is therefore one and the same for an item that
                    // exists, one that does not and a draft-only one — the door
                    // is no existence oracle — and it carries no item or
                    // version detail. The message names THIS door, never
                    // drafts: a refusal worded about drafts would read as
                    // "this item has one". Whoever it admits reads exactly what
                    // they read before, the per-caller refusal below included.
                    //
                    // Ruling 5856774816 (#20156) item 2 is narrowed for this
                    // door and `/diff` only: `/layers` and `?layers=true` read
                    // the active row and keep the pruned plain-read answer.
                    //
                    // `historyCtx` is this door's one caller resolution; the org
                    // partition below reads the same value. The refusal is
                    // {@link refuseNonAuthoringCaller}, shared with `/diff` and
                    // `/audit` (#20441) so the three cannot drift apart.
                    const historyCtx = await this.resolveExecCtx(environmentId, req)
                        .catch(rethrowAuthzStoreUnavailable);
                    if (refuseNonAuthoringCaller(historyCtx, res, 'Reading a metadata item\'s version history')) return;
                    const p = await this.resolveProtocol(environmentId, req);
                    // The cast came off when `MetadataProtocol` declared
                    // `historyMetaItem` (#12005 — the commit cccbe51bf pattern, exactly
                    // as #11678 de-cast the audit twin below). The member is
                    // declared OPTIONAL, so this truthiness guard is not just
                    // feature detection: it is what narrows the member to
                    // callable at the call site. Same guard semantics as
                    // before, minus the cast.
                    if (!p.historyMetaItem) {
                        res.status(501).json({
                            error: 'History query not supported by protocol implementation',
                        });
                        return;
                    }
                    // [#6877] `Number(['1','2'])` is `NaN`, which the
                    // `Number.isFinite` spreads below drop — so a repeated
                    // `?limit=` silently returned the UNLIMITED history instead
                    // of the page the caller asked for.
                    if (refuseRepeatedQueryParams(req, res, ['sinceSeq', 'limit'])) return;
                    // [#20139] `sinceSeq` is parsed through its DECLARATION
                    // (`HistoryMetaItemRequestSchema.sinceSeq`, `z.number().optional()`),
                    // the way `limit` is just below: `?sinceSeq=abc` used to be `NaN`,
                    // dropped by the spread below, and answered with the log read from
                    // the START; `?sinceSeq=` became `Number('')` = 0, a cursor the
                    // repository applies (`event_seq <= 0` rows skipped) that the
                    // caller never sent. Both are refused now; any finite number is
                    // still forwarded exactly as before.
                    const sinceSeq = readDeclaredQueryNumber(req.query, 'sinceSeq',
                        HistoryMetaItemRequestSchema.shape.sinceSeq, { emptyIsAbsent: false });
                    // [#20062] `limit` is parsed through its DECLARATION
                    // (`HistoryMetaItemRequestSchema.limit`, `z.number().optional()`),
                    // not coerced: `?limit=abc` used to be `NaN`, dropped by the
                    // spread below, and answered with the WHOLE change log; `?limit=`
                    // became `Number('')` = 0, a zero-event answer. Both are refused
                    // now. The declaration carries no `int()` and no bounds, so any
                    // finite number is still forwarded exactly as before.
                    const limit = readDeclaredQueryNumber(req.query, 'limit',
                        HistoryMetaItemRequestSchema.shape.limit, { emptyIsAbsent: false });
                    // [#20156] The plain read's refusal, where it refuses this
                    // caller the item whole: a change log of a doc the caller
                    // may not read, or of an app they may not open, discloses
                    // who changed it, when and why — and an unpublished app's
                    // log contradicts ADR-0045 §3's "externally unobservable".
                    // See {@link eventDoorRefusal}.
                    {
                        const refusal = await this.eventDoorRefusal(environmentId, req, p);
                        if (refusal) {
                            refusal(res);
                            return;
                        }
                    }
                    // [#13406] STATE THE ORG PARTITION. `sys_metadata_history`
                    // is a per-org log — `SysMetadataRepository.history()`
                    // filters `organization_id = this.organizationId` by strict
                    // equality (no `$or`), and `event_seq` is documented as a
                    // "Per-organization monotonic event log cursor". So a door
                    // that names no organization does not read "everything": it
                    // reads the ENV partition (`organizationId ?? null` in
                    // `historyMetaItem`), and an item whose overlay was authored
                    // org-scoped answered `{ events: [] }` while its log was
                    // full. The write door that produced those rows has stated
                    // the org since #8805; only the read door had not.
                    //
                    // ⭐ `organizationIdForMetaRead`, NOT the audit twin's raw
                    // `ctx?.tenantId ?? null`, and the difference is measured
                    // rather than stylistic. `auditMetaItem` reads with
                    // `$or: [{organization_id: org}, {organization_id: null}]`,
                    // so naming an org there can only ADD rows. This door's
                    // repository does strict equality, so a raw tenant id would
                    // ask the org partition for the history of a type whose
                    // rows land ENV-WIDE — every `allowOrgOverride: false` type
                    // that is still runtime-writable (`object`, `hook`, `page`,
                    // `app`, `dataset`), because `organizationIdForMetaWrite`
                    // deliberately writes those env-wide (#6190). That would
                    // turn a working read into `{ events: [] }` for them: the
                    // card's own defect, newly minted one type family over.
                    // Gating the read on the same registry predicate the WRITE
                    // uses is what makes the two sides incapable of drifting —
                    // the reasoning `organizationIdForMetaRead` was written for.
                    //
                    // ⚠️ NOT a new org-resolution seam: `historyCtx` is the
                    // caller resolved at the head of this door (#20378), and
                    // `resolveExecCtx` is memoised per request (WeakMap keyed by
                    // `req`), the same result the audit twin and 40+ handlers
                    // here already share.
                    const historyOrganizationId = organizationIdForMetaRead(
                        // [commit 26f3588fb] FOLDED, not raw — see the PUT door's
                        // org-scope comment for the measurement.
                        canonicalMetaUrlType(req.params.type), historyCtx?.tenantId,
                    );
                    // Typed through `TransportScopedMetaRequest` like the
                    // reset door above, NOT as a plain `HistoryMetaItemRequest`
                    // like the audit door below: this door still spreads the
                    // transport-level `environmentId` (long-standing wire
                    // shape, deliberately unchanged — the ruling commit 2a29caa53 landed keeps
                    // it out of the protocol schema, and the implementation
                    // never reads it), so the wrapper is what layers that one
                    // member on. Every OTHER key is compiled against the spec
                    // contract — an undeclared member here is now TS2353
                    // instead of a payload member no contract has ever seen.
                    //
                    // ⛔ [#13406] `organizationId` is SPREAD, never written as
                    // `organizationId: x ?? null`. `HistoryMetaItemRequestSchema`
                    // declares it `z.string().optional()` — optional plain
                    // string, NOT nullable, mirroring the implementation's
                    // `organizationId?: string` — and the spec's own describe
                    // text names the asymmetry against the audit twin, which
                    // declares `string | null`. Copying the audit door's
                    // expression here is a **TS2322** compile error, measured:
                    // `error TS2322: Type 'string | null' is not assignable to
                    // type 'string | undefined'`. It is also a no-op at runtime
                    // (`null ?? null` is `null`).
                    //
                    // ⚠️ TS2322, NOT the TS2353 the paragraph directly above
                    // names, and the difference is the whole point: TS2353 is
                    // the UNDECLARED-member code, and `organizationId` IS
                    // declared — so this is an assignability failure, not an
                    // unknown-property one. This comment said TS2353 when it
                    // landed, copied from its neighbour nine lines up, which is
                    // correct in ITS context and wrong here. Comment drift by
                    // adjacency; named so the next reader standing in the same
                    // spot does not repeat it.
                    //
                    // ⚠️ And the guard is WEAKER one door over, not stronger:
                    // the `/diff` twin reaches `diffMetaItem` through
                    // `(p as any)`, so `?? null` there reddens with NOTHING and
                    // is a silent runtime no-op. Do not generalise "the
                    // compiler catches this" from here to that door.
                    const historyRequest: TransportScopedMetaRequest<HistoryMetaItemRequest> = {
                        type: req.params.type,
                        name: req.params.name,
                        ...(environmentId ? { environmentId } : {}),
                        ...(historyOrganizationId ? { organizationId: historyOrganizationId } : {}),
                        // Both already finite or absent — the declared parses above
                        // refuse anything else, so no `Number.isFinite` drop is left here.
                        ...(sinceSeq !== undefined ? { sinceSeq } : {}),
                        ...(limit !== undefined ? { limit } : {}),
                    };
                    const result = await p.historyMetaItem(historyRequest);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'List durable history events for a metadata item',
                tags: ['metadata'],
            },
        });

        // GET /meta/:type/:name/audit — ADR-0010 §3.6 / Phase 4.1.
        // Compliance trail for the metadata-protection layer: returns
        // recent sys_metadata_audit rows (save/publish/rollback/delete/
        // reset attempts, both allowed and denied) so Studio's "审计
        // 日志 / Audit log" tab can show who tried what and whether
        // a lock blocked it. Empty array on environments where the
        // table is not yet provisioned. An AUTHORING door (#20441): a
        // caller without an authoring capability is refused 403.
        registerPerItemRoute({
            method: 'GET',
            path: `${metaPath}/:type/:name/audit`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [#20441] AN AUTHORING DOOR — ruling 5865708652 (letter B),
                    // carried to this door by triage's grade 5871509797.
                    // `saveMetaItem` appends a success row to
                    // `sys_metadata_audit` for EVERY save, a draft save
                    // included, and `auditMetaItem` serves its `note: 'draft'`,
                    // its actor and its time. So this trail, served to a caller
                    // who may not read pending drafts, disclosed that an item
                    // had unpublished authoring work, who saved it and when —
                    // and for an item with nothing published, that it exists at
                    // all, where the plain read answers `404` (ADR-0045 §3).
                    // ADR-0106 D4: 「draft/preview reads are admin-gated
                    // upstream」.
                    //
                    // The trail has no published-only answer to fall back to:
                    // withholding only the draft-save rows would hand a member
                    // a pruned log that reads as a true, complete one, the
                    // shape the ruling measured wrong. So the caller is asked
                    // {@link mayReadPendingDrafts} FIRST and refused by
                    // {@link refuseNonAuthoringCaller} — the refusal `/history`
                    // and `/diff` give, and `GET /meta/_drafts`'s shape — before
                    // the protocol is resolved (no 501-vs-200 probe), before the
                    // query is parsed, and before any item or event is read.
                    // Whoever it admits reads exactly what they read before,
                    // the per-caller refusal and the org scope below included.
                    //
                    // `auditCtx` is this door's one caller resolution; the org
                    // scope below reads the same value.
                    const auditCtx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                    if (refuseNonAuthoringCaller(auditCtx, res, 'Reading a metadata item\'s audit trail')) return;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (typeof p.auditMetaItem !== 'function') {
                        // [#9426 / ADR-0110 D3] A MISS and a FAULT are different
                        // facts, and this branch is the second one: the resolved
                        // protocol cannot read an audit trail AT ALL, so the
                        // question was never asked. Answering `{ events: [] }`
                        // reported it as the first — "the trail WAS read and this
                        // item has no entries" — on a COMPLIANCE surface, where
                        // Studio's 审计日志 / Audit log tab renders the empty case
                        // as *nobody touched this item*. That is precisely the
                        // claim a compliance reader must not be given on false
                        // pretenses.
                        //
                        // ⚠️ This is NOT the unprovisioned-table condition this
                        // route's header comment describes. That one lives one
                        // layer down, inside
                        // `ObjectStackProtocolImplementation.auditMetaItem`,
                        // which catches a failed read and returns `{ events: [] }`
                        // after a `console.warn` — a path that requires the method
                        // to EXIST and to be CALLED. The two are separate frames
                        // in separate packages, and this branch returns BEFORE the
                        // call, so refusing here leaves the unprovisioned-table
                        // answer exactly as it was.
                        //
                        // Refusing HERE rather than asserting at assembly is
                        // deliberate, and is the reasoning PR #9425 landed one
                        // route over. `auditMetaItem` is a declared OPTIONAL
                        // member of `MetadataProtocol` (the #11006-pattern
                        // catch-up that retired this door's `(p as any)` casts;
                        // it was an undeclared ADR-0076 D9 server-only
                        // extension before that). A host without the verb is
                        // therefore a CONFORMING deployment that lands here
                        // with no type error, and a boot-time assertion would
                        // promote a declared-optional member into a required
                        // one — a `packages/spec` contract decision, not a
                        // route one. The guard is also what narrows the member
                        // to callable below.
                        //
                        // Envelope per #7035: the ADR-0112 NESTED
                        // `{ error: { code, message } }` the sibling `/meta` 501
                        // refusals converged on — never the bare-string or
                        // sibling-`code` dialects, which make `body.error.code`
                        // read `undefined` and which `check:route-envelope`
                        // counts, shrink-only, on this file.
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'protocol.auditMetaItem() is not available in this kernel',
                            },
                        });
                        return;
                    }
                    // [#6877] Same `Number(...)` → `NaN` → dropped-limit shape as
                    // the history twin above.
                    if (refuseRepeatedQueryParams(req, res, ['limit'])) return;
                    // [#20139] Parsed through its DECLARATION
                    // (`AuditMetaItemRequestSchema.limit`, `z.number().optional()`),
                    // the history twin's reading: `?limit=abc` used to be `NaN`,
                    // dropped by the spread below, and answered with the producer's
                    // default 100 events; `?limit=` became `Number('')` = 0, which the
                    // implementation clamps to ONE event. Both are refused now; any
                    // finite number is still forwarded, and the implementation's own
                    // `[1, 500]` clamp is unchanged.
                    const limit = readDeclaredQueryNumber(req.query, 'limit',
                        AuditMetaItemRequestSchema.shape.limit, { emptyIsAbsent: false });
                    // [#20156] The history twin's gate, for the same reason: the
                    // audit trail of an item the plain read refuses this caller
                    // is refused with the plain read's answer. See
                    // {@link eventDoorRefusal}.
                    {
                        const refusal = await this.eventDoorRefusal(environmentId, req, p);
                        if (refusal) {
                            refusal(res);
                            return;
                        }
                    }
                    // [#8747] SCOPE THE READ. Without an organization this
                    // route returned every tenant's audit rows for a
                    // `(type, name)` — measured, not inferred — and it carried
                    // no capability gate then (unlike its `PUT` twin, which
                    // gates on `manage_metadata`), so the cohort was any
                    // authenticated principal of any tenant, on the published
                    // SDK surface. [#20441] It carries the authoring-door gate
                    // now, and the scope still matters: that gate admits a
                    // builder of ONE organization, never a reader of another's
                    // trail, so the tenant separation stays this scope's job.
                    //
                    // The organization comes from `resolveExecCtx`, which this
                    // file already calls in 40+ handlers including the `PUT`
                    // twin — `computeExecCtx` assembles `tenantId` from the
                    // shared `resolveAuthzContext` (an API key's principal
                    // tenant, else the session's `activeOrganizationId`).
                    //
                    // ⚠️ This deliberately does NOT mint the seam the
                    // `/published` route's comment forbids further down this
                    // file: no `resolveActiveOrganizationId`, no new org
                    // plumbing in `packages/rest`. It reads a field the
                    // execution context already carries. `?? null` keeps the
                    // fail-closed direction — an unresolved organization reads
                    // env-wide rows, never everyone's.
                    //
                    // `environmentId` is GONE from this payload, and that is a
                    // deletion of dead weight rather than a behaviour change:
                    // `auditMetaItem`'s request type never declared it and its
                    // body never read it. Environment scoping is unaffected
                    // because it comes from WHICH protocol `resolveProtocol`
                    // hands back — the same reasoning the `/published` route
                    // states below — not from the request payload. It is still
                    // read on the two lines that need it.
                    //
                    // `auditCtx` is the caller resolved at the head of this door
                    // (#20441), not a second resolution.
                    //
                    // The `(p as any)` casts this door carried came off when
                    // `MetadataProtocol` declared `auditMetaItem` (the commit cccbe51bf
                    // pattern, same as the publish door below): the literal is
                    // now compiled against the spec contract, so an undeclared
                    // key here is a compile error (TS2353) instead of a payload
                    // member no contract has ever seen. Plain
                    // `AuditMetaItemRequest` rather than the
                    // `TransportScopedMetaRequest` wrapper on purpose: this
                    // door stopped sending `environmentId` when #8747 scoped
                    // the read (see the note above), so there is no
                    // transport-level member left to layer on.
                    const auditRequest: AuditMetaItemRequest = {
                        type: req.params.type,
                        name: req.params.name,
                        organizationId: auditCtx?.tenantId ?? null,
                        // Already finite or absent — the declared parse above
                        // refuses anything else.
                        ...(limit !== undefined ? { limit } : {}),
                    };
                    const result = await p.auditMetaItem(auditRequest);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'List protection-audit events for a metadata item',
                tags: ['metadata'],
            },
        });

        // POST /meta/:type/:name/publish — promote the pending draft
        // overlay to live. 404 `NO_DRAFT` when nothing to publish.
        registerPerItemRoute({
            method: 'POST',
            path: `${metaPath}/:type/:name/publish`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [commit b5378550e] Authoring capability gate — the SAME four lines the
                    // `PUT` / `DELETE` / `_migrate-stored` doors carry, deliberately
                    // not a second way of demanding the same capability.
                    //
                    // Promotion is authoring. `promoteDraftForPublish` flips the
                    // `sys_metadata` row `state: 'draft'` → `'active'`, and
                    // ADR-0027 (E)(5) defines sealing a publish as exactly that
                    // flip — so this door decides which body is LIVE. Measured
                    // before the gate: an authenticated principal holding no
                    // authoring capability at all reached `publishMetaItem` and
                    // got 200, i.e. it could take a draft somebody else authored
                    // and make it the live overlay. The `/meta` umbrella already
                    // refused ANONYMOUS here (401, `registerMetadataEndpoints`),
                    // so this closes the authenticated-but-uncapable cohort — the
                    // one the four sibling doors close and these two did not.
                    //
                    // ⛔ Not a publish-specific capability: `manage_metadata` is
                    // ADR-0066 D1's authoring capability and the same one the save
                    // door demands, so no caller who can author a draft is newly
                    // refused (measured: the save→publish loop's own first step is
                    // already gated on it). Splitting author from publisher would
                    // need a DIFFERENT declared capability and is a product call.
                    //
                    // Gate FIRST — before the protocol is resolved — so an
                    // unauthorized caller cannot use the 501-vs-200 answer to probe
                    // which kernels implement publishing, and so nothing is promoted
                    // before the refusal. `isSystem` bypasses, matching every other
                    // capability gate on the platform.
                    //
                    // [#12702] Same shared verdict as the save door, because
                    // promotion is the second half of the save→publish loop: a
                    // caller admitted to author an org-scoped draft must be able
                    // to promote it, and the SAME conditions bound what a
                    // promotion can reach — `promoteDraftForPublish` resolves
                    // the draft through `getOverlayRepo(orgId)`, so an admitted
                    // org-presentation publish promotes only the caller's own
                    // org partition.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                    {
                        const verdict = metaWriteCapabilityVerdict({
                            isSystem: ctx?.isSystem === true,
                            systemPermissions: ctx?.systemPermissions,
                            canonicalType: canonicalMetaUrlType(req.params.type),
                            activeOrganizationId: ctx?.tenantId,
                            operation: 'publish',
                        });
                        if (!verdict.allowed) {
                            res.status(403).json({
                                error: {
                                    code: 'FORBIDDEN',
                                    message: verdict.message,
                                },
                            });
                            return;
                        }
                    }
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!p.publishMetaItem) {
                        res.status(501).json({
                            error: 'Publish operation not supported by protocol implementation',
                        });
                        return;
                    }
                    // [#7749 producer, #7941 precedence] The request's authenticated
                    // identity — one producer, shared by every `/meta` write (see
                    // resolveMetaWriteActor). `X-Actor` is not consulted.
                    const actor = await this.resolveMetaWriteActor(environmentId, req);
                    const body = (req.body && typeof req.body === 'object') ? req.body : {};
                    const message = typeof body.message === 'string' ? body.message : undefined;

                    // [commit 9e04c3e35] Software-package binding for the PROMOTION —
                    // `?package=<id>`, deliberately the SAME wire spelling and the
                    // same normalisation the `PUT` door states it with a few
                    // hundred lines up, not a second dialect for one value.
                    //
                    // Why this door needed it at all. #9612 taught the runtime
                    // publish gate to narrow `objects` to the written item's
                    // package closure, but only when the caller can NAME the
                    // package. Three write doors reach that gate; `saveMetaItem`
                    // and `publishPackageDrafts` both name one, and this one —
                    // the single-item draft→active promotion — named nothing. So
                    // every HTTP-driven promotion, which is precisely Studio's
                    // designer save→publish loop on every edit, handed the gate
                    // the whole tenant. The protocol half was already built and
                    // waiting: `promoteDraftForPublish` declares
                    // `packageId?: string | null` and threads it into both the
                    // gate and `repo.promoteDraft`. Only the caller was mute.
                    //
                    // ⚠️ THE SHARP EDGE, and the reason this is a conditional
                    // spread rather than a plain key. `promoteDraftForPublish`
                    // forwards to `repo.promoteDraft` with
                    // `...('packageId' in request ? { packageId: request.packageId ?? null } : {})`
                    // — it branches on the KEY BEING PRESENT, not on the value,
                    // because `null` is a meaningful scope there (pin the lookup
                    // to the UNBOUND row) while an absent key means "match any
                    // package", the historical resolution. Writing
                    // `packageId: packageId` here would therefore put a
                    // present-and-`undefined` key on every publish that names no
                    // package, coercing it to `null` downstream and pinning the
                    // lookup to unbound rows — so a draft authored under a package
                    // would stop being found and the door would answer `no_draft`.
                    // That is a silent outage on the untouched path, produced by a
                    // change that reads like it only ADDS an option. The key must
                    // be ABSENT when the caller states nothing.
                    //
                    // ⛔ Not read off the draft row either — see
                    // `promoteDraftForPublish`'s own warning: `rowToItem` projects
                    // `sys_metadata` into a `MetadataItem`, which carries no
                    // package id, so a read from there is `undefined` on every
                    // path — narrowing that never fires while looking like it
                    // does. Widening `MetadataItem` is a `packages/spec` contract
                    // change and stays filed rather than taken here.
                    if (refuseRepeatedQueryParams(req, res, ['package'])) return;
                    const packageId = metaItemPackageBinding(req.query?.package);

                    // [#8805] The publish half of the same organization, and it
                    // is REQUIRED for the `PUT` fix to be usable rather than a
                    // separate improvement: `promoteDraftForPublish` resolves the
                    // draft through `getOverlayRepo(orgId)`, so once a draft
                    // authored through `PUT ?mode=draft` lands org-scoped, a
                    // publish carrying no organization looks in the env-wide
                    // partition, finds nothing, and answers `no_draft` — the
                    // Studio designer's save→publish loop, broken. Scoping the
                    // save without scoping the publish is not a smaller change,
                    // it is a broken one.
                    //
                    // [commit b5378550e] The context is now the one the capability gate above
                    // already resolved, so the caller a publish is SCOPED to can
                    // never drift from the caller it was AUTHORIZED against — the
                    // same single-resolution shape the `PUT` door carries.
                    // `resolveExecCtx` is memoised per request and called in 40+
                    // handlers in this file (see the `/published` comment's seam
                    // warning, which stands).
                    const organizationId = organizationIdForMetaWrite(
                        // [commit 26f3588fb] FOLDED, not raw — see the PUT door's
                        // org-scope comment for the measurement.
                        canonicalMetaUrlType(req.params.type), ctx?.tenantId,
                    );
                    // [#11145] The `(p as any)` cast this call carried came off
                    // when `MetadataProtocol` declared `publishMetaItem` (commit cccbe51bf,
                    // maintainer ruling 2026-08-22, option B). What the cast was
                    // load-bearing FOR is recorded because it is counter-intuitive
                    // and was measured, not assumed: deleting it while the member
                    // was undeclared answered
                    //   `TS2339: Property 'publishMetaItem' does not exist on
                    //    type 'RestProtocol'`
                    // — NOT a `TS2353` about an unknown key. The cast was feature
                    // detection for an ADR-0076 D9 server-only extension, so only
                    // declaring the member could retire it; widening the
                    // implementation's own request type in
                    // `@objectstack/metadata-protocol` (which this package
                    // deliberately does not depend on) never could, and commit 490879ad0
                    // measured exactly that.
                    //
                    // What replaces it is the point of the exercise, not a
                    // side effect: the literal below is compiled against the spec
                    // contract through the commit 2a29caa53 `TransportScopedMetaRequest`
                    // wrapper, so an undeclared key here is a COMPILE ERROR
                    // (`TS2353`, measured) instead of a payload member no contract
                    // has ever seen. `environmentId` is the transport-level
                    // routing key that wrapper layers on — ⛔ never a protocol
                    // key; a key that belongs on the request belongs in the spec
                    // schema.
                    //
                    // The 501 feature-detection guard above STAYS. The member is
                    // declared OPTIONAL (ADR-0076 D9 promotion is additive to a
                    // shipped contract, and a kernel may not implement the
                    // promotion door at all), and that same guard is what narrows
                    // it to callable here.
                    const publishRequest: TransportScopedMetaRequest<PublishMetaItemRequest> = {
                        type: req.params.type,
                        name: req.params.name,
                        organizationId,
                        ...(environmentId ? { environmentId } : {}),
                        ...(actor ? { actor } : {}),
                        ...(message ? { message } : {}),
                        ...(packageId ? { packageId } : {}),
                    };
                    const result = await p.publishMetaItem(publishRequest);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Publish the pending draft overlay (promotes draft → active)',
                tags: ['metadata'],
            },
        });

        // POST /meta/:type/:name/rollback — restore a historical version
        // as the new live overlay. Body: { toVersion: <number>, message? }.
        registerPerItemRoute({
            method: 'POST',
            path: `${metaPath}/:type/:name/rollback`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [commit b5378550e] Authoring capability gate — the same four lines as
                    // the sibling doors, and the sharper half of this pair.
                    // `rollbackMetaItem` restores a CALLER-SUPPLIED `toVersion` as
                    // the new live row, so without this gate it is a mechanism for
                    // reverting security hardening: a permission set as it stood
                    // before it was tightened, a validation rule from before it
                    // existed, a layout from before field-level security. Measured
                    // before the gate: an authenticated principal holding no
                    // authoring capability reached `rollbackMetaItem` and got 200.
                    //
                    // It is also the door with the least behind it. Publish at
                    // least re-runs `assertRuntimeAuthoringRules` on the promoted
                    // draft (#4463 D1); rollback runs no content gate at all — its
                    // only refusals are TYPE-level (`isOverlayAllowed` →
                    // `NOT_OVERRIDABLE`) and the ADR-0010 lock. Neither reads the
                    // caller, so nothing downstream was ever answering "may this
                    // principal press this button".
                    //
                    // Gate FIRST — before the protocol is resolved — so 403-vs-501
                    // leaks no kernel capability and nothing is restored before the
                    // refusal. `isSystem` bypasses, as everywhere else.
                    //
                    // [#12702] Same shared verdict as the sibling doors. The
                    // org condition bounds this verb too: `rollbackMetaItem`
                    // resolves the row AND its history through the organization
                    // (see the [#8805] comment below), so an admitted
                    // org-presentation rollback restores only a version of the
                    // caller's own org overlay — the env-wide row and its
                    // history stay out of reach.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                    {
                        const verdict = metaWriteCapabilityVerdict({
                            isSystem: ctx?.isSystem === true,
                            systemPermissions: ctx?.systemPermissions,
                            canonicalType: canonicalMetaUrlType(req.params.type),
                            activeOrganizationId: ctx?.tenantId,
                            operation: 'rollback',
                        });
                        if (!verdict.allowed) {
                            res.status(403).json({
                                error: {
                                    code: 'FORBIDDEN',
                                    message: verdict.message,
                                },
                            });
                            return;
                        }
                    }
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!(p as any).rollbackMetaItem) {
                        res.status(501).json({
                            error: 'Rollback operation not supported by protocol implementation',
                        });
                        return;
                    }
                    // [#6877] The `Number(...)` below already refuses an array
                    // — but as `INVALID_REQUEST` "'toVersion' (positive integer)
                    // is required", which tells a caller who supplied two valid
                    // integers that they supplied none. Refusing the multiplicity
                    // by name says what actually happened.
                    if (refuseRepeatedQueryParams(req, res, ['toVersion'])) return;
                    const body = (req.body && typeof req.body === 'object') ? req.body : {};
                    const toVersionRaw = body.toVersion ?? body.version ?? req.query?.toVersion;
                    const toVersion = Number(toVersionRaw);
                    if (!Number.isFinite(toVersion) || toVersion < 1) {
                        res.status(400).json({
                            error: `'toVersion' (positive integer) is required`,
                            code: 'INVALID_REQUEST',
                        });
                        return;
                    }
                    // [#7749 producer, #7941 precedence] The request's authenticated
                    // identity — one producer, shared by every `/meta` write (see
                    // resolveMetaWriteActor). `X-Actor` is not consulted.
                    const actor = await this.resolveMetaWriteActor(environmentId, req);
                    const message = typeof body.message === 'string' ? body.message : undefined;
                    // [#8805] The rollback half. Same argument as publish, one
                    // step sharper: `rollbackMetaItem` resolves the row AND its
                    // history through the organization, so an unscoped rollback
                    // of an org-scoped item restores the env-wide body over the
                    // env-wide row — a write to a partition the caller never
                    // named, audited as `null`. See the `PUT` door above.
                    //
                    // [commit b5378550e] `ctx` is the one the capability gate above resolved,
                    // so scope and authorization read the same identity.
                    const organizationId = organizationIdForMetaWrite(
                        // [commit 26f3588fb] FOLDED, not raw — see the PUT door's
                        // org-scope comment for the measurement.
                        canonicalMetaUrlType(req.params.type), ctx?.tenantId,
                    );
                    const result = await (p as any).rollbackMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        toVersion,
                        organizationId,
                        ...(environmentId ? { environmentId } : {}),
                        ...(actor ? { actor } : {}),
                        ...(message ? { message } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Restore the body at the given history version as the new live row',
                tags: ['metadata'],
            },
        });

        // GET /meta/:type/:name/diff?from=N&to=M — structural diff
        // between two historical versions (or one version vs current).
        registerPerItemRoute({
            method: 'GET',
            path: `${metaPath}/:type/:name/diff`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [#20378] AN AUTHORING DOOR — ruling 5865708652 (letter B),
                    // the `/history` twin's gate on the same log. A diff reads
                    // stored versions out of `sys_metadata_history`, where a
                    // DRAFT save is recorded exactly as an active save, so
                    // `?from=`/`?to=` naming a draft save — or the default
                    // range, once a draft is pending — served unpublished
                    // content to a caller who may not read drafts. The version
                    // store cannot tell a draft version from a published one,
                    // so there is no exact published-only answer to fall back
                    // to: the `/meta/_drafts` shape, not the draft switches'
                    // "answer as if absent". The caller is asked
                    // {@link mayReadPendingDrafts} FIRST, and one it does not
                    // admit is refused exactly as `GET /meta/_drafts` refuses
                    // (403 `FORBIDDEN`, the same nested envelope): before the
                    // protocol is resolved, before the query is parsed, before
                    // the mask posture, the current document or any version is
                    // read — one answer for an item that exists, one that does
                    // not and a draft-only one, with no item or version detail,
                    // so the door is no existence oracle. The message names THIS
                    // door, never drafts. Whoever it admits reads exactly what
                    // they read before: every per-caller gate below, and ruling
                    // 5856774816's author exemption, still apply to them.
                    //
                    // Ruling 5856774816 (#20156) item 2 is narrowed for this
                    // door and `/history` only: `/layers` and `?layers=true`
                    // read the active row and keep the pruned plain-read answer.
                    //
                    // `diffCtx` is this door's one caller resolution; the org
                    // partition below reads the same value. The refusal is
                    // {@link refuseNonAuthoringCaller}, shared with `/history`
                    // and `/audit` (#20441) so the three cannot drift apart.
                    const diffCtx = await this.resolveExecCtx(environmentId, req)
                        .catch(rethrowAuthzStoreUnavailable);
                    if (refuseNonAuthoringCaller(diffCtx, res, 'Comparing a metadata item\'s stored versions')) return;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!(p as any).diffMetaItem) {
                        res.status(501).json({
                            error: 'Diff operation not supported by protocol implementation',
                        });
                        return;
                    }
                    // [#6877] A repeated `?from=` became `NaN`, the spreads below
                    // omitted the bound, and the door quietly diffed a different
                    // pair of versions and answered 200.
                    if (refuseRepeatedQueryParams(req, res, ['from', 'fromVersion', 'to', 'toVersion'])) return;
                    // [#20139] The same drop for a SINGLE unreadable value: the
                    // `parseV` helper that stood here answered `undefined` for
                    // `?from=abc` (and `Infinity`), so `diffMetaItem` substituted
                    // "the version before `to`" — or, for `?to=abc`, the CURRENT
                    // body — and the door answered 200 with a comparison nobody
                    // asked for; `?from=1.5` was forwarded and diffed against a
                    // version that cannot exist. No request schema is declared for
                    // this door, so a version reads as a whole number. The name the
                    // caller used is the one read (and the one a refusal names):
                    // `from` / `to` win over `fromVersion` / `toVersion` exactly as
                    // the old `??` had it, and an empty value stays absent, as
                    // `parseV('')` already answered.
                    const fromParam = req.query?.from != null ? 'from' : 'fromVersion';
                    const toParam = req.query?.to != null ? 'to' : 'toVersion';
                    const fromVersion = readDeclaredQueryNumber(req.query, fromParam,
                        UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: true });
                    const toVersion = readDeclaredQueryNumber(req.query, toParam,
                        UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: true });
                    // [#20156] A diff discloses BOTH versions' values — for a
                    // doc its `content`, for an app its `navigation`, for an
                    // object its `fields` — so it owes the plain read's
                    // per-caller answer for each side. Resolved in the plain
                    // read's order: the ADR-0106 mask posture BEFORE any fetch
                    // (D2/D3), then the current document, which a type the gate
                    // judges here must have — the plain read answers its
                    // absence, and there is no gate input to judge the versions
                    // against.
                    const diffMetaType = RestServer.metaTypeSingular(req.params.type);
                    let diffMaskPosture: ObjectSchemaMaskPosture;
                    try {
                        diffMaskPosture = await (await this.resolveObjectMasker(environmentId, req, diffMetaType))(req.params.name);
                    } catch (maskError: any) {
                        if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                            sendFieldVisibilityFault(res, req.params.name);
                            return;
                        }
                        throw maskError;
                    }
                    const diffGated = RestServer.gatesPerCaller(diffMetaType);
                    const diffCurrent = diffGated
                        ? await this.fetchCurrentMetaDocument(environmentId, req, p)
                        : undefined;
                    if (diffGated && diffCurrent == null) {
                        sendMetaItemAbsent(res);
                        return;
                    }
                    // [#13406] STATE THE ORG PARTITION — the history twin's
                    // omission, on the door that reads the SAME table. See the
                    // history door above for why the predicate is
                    // `organizationIdForMetaRead` and not the audit twin's raw
                    // `ctx?.tenantId ?? null`; both arguments carry over
                    // unchanged, because `diffMetaItem` reads
                    // `sys_metadata_history` with the identical strict-equality
                    // `where` (`organization_id: orgId`, no `$or`) and derives
                    // `orgId` from the identical `request.organizationId ?? null`.
                    //
                    // Version identity is the second reason the partition is
                    // strict rather than unioned here, and it is sharper on this
                    // door than on `/history`: `version` is a PER-(org,type,name)
                    // lineage counter, so an org revision 1 and an env revision 1
                    // both exist. `?from=1&to=2` unioned across partitions would
                    // have two candidate bodies per bound and would answer a diff
                    // between revisions of two different lineages — a well-formed
                    // 200 that is simply not the comparison anyone asked for.
                    //
                    // ⚠️ This door reaches `diffMetaItem` through `(p as any)`,
                    // so — unlike the history twin — the compiler checks NOTHING
                    // about this literal; measured, not assumed. The omit-spread
                    // is therefore load-bearing by RUNTIME contract alone: the
                    // implementation declares `organizationId?: string` and does
                    // `request.organizationId ?? null`, so an `?? null` copied
                    // from the audit door would type-check here and still be a
                    // silent no-op — the exact fix-shaped-non-fix this card is.
                    //
                    // `diffCtx` is the caller resolved at the head of this door
                    // (#20378), not a second resolution.
                    const diffOrganizationId = organizationIdForMetaRead(
                        // [commit 26f3588fb] FOLDED, not raw — see the PUT door's
                        // org-scope comment for the measurement.
                        canonicalMetaUrlType(req.params.type), diffCtx?.tenantId,
                    );
                    const result = await (p as any).diffMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        ...(environmentId ? { environmentId } : {}),
                        ...(diffOrganizationId ? { organizationId: diffOrganizationId } : {}),
                        ...(fromVersion !== undefined ? { fromVersion } : {}),
                        ...(toVersion !== undefined ? { toVersion } : {}),
                    });
                    // [#20156] Judge the current document and both sides, with
                    // ONE judge (one books read, one holdings resolution): a
                    // side the caller may not read is not served beside one
                    // they may. `per-caller`, the stored-version doors' policy —
                    // see `MetaReadGatePolicy`.
                    //
                    // [#20156] And each side is EMITTED as the gate serves it:
                    // ruling 5856774816 — a caller who may write an app reads
                    // both sides whole, and any other caller who may open it
                    // reads each side pruned, exactly as the plain read prunes
                    // it ({@link diffEmittedFrom}).
                    let served: any = result;
                    if (diffGated) {
                        const { from, to } = RestServer.diffSides(diffCurrent, result);
                        const judge = this.metaItemReadGate(
                            environmentId, req, p, diffMetaType, req.params.name, [diffCurrent, from, to],
                            RestServer.STORED_VERSION_DOOR_POLICY,
                        );
                        const sides: any[] = [];
                        for (const side of [diffCurrent, from, to]) {
                            const verdict = await judge(side);
                            if (verdict.kind === 'refuse') {
                                verdict.send(res);
                                return;
                            }
                            sides.push(verdict.document);
                        }
                        served = RestServer.diffEmittedFrom(result, sides[1], sides[2]);
                    }
                    // [ADR-0106 D5(4)] The object mask on the one key it
                    // projects, `fields`, in every bucket and on both sides —
                    // the redaction precedent one frame down (the stored bodies
                    // are compared raw, the EMITTED values are the projected
                    // ones), so a field the caller may not read is not served
                    // as a diff value either.
                    if (diffMaskPosture.kind === 'project' && served && typeof served === 'object') {
                        let faulted = false;
                        const maskFields = (value: unknown): unknown => {
                            if (faulted || !value || typeof value !== 'object' || Array.isArray(value)) return value;
                            const masked = this.maskObjectDocument(res, diffMaskPosture, req.params.name, { fields: value });
                            if (!masked) { faulted = true; return value; }
                            return (masked.document as { fields: unknown }).fields;
                        };
                        const onFields = (e: any, keys: readonly string[]) =>
                            (e && e.path === 'fields'
                                ? { ...e, ...Object.fromEntries(keys.map((k) => [k, maskFields(e[k])])) }
                                : e);
                        const bucket = (list: unknown, keys: readonly string[]) =>
                            (Array.isArray(list) ? list.map((e) => onFields(e, keys)) : list);
                        served = {
                            ...(served as Record<string, unknown>),
                            added: bucket((served as any).added, ['value']),
                            removed: bucket((served as any).removed, ['value']),
                            changed: bucket((served as any).changed, ['from', 'to']),
                        };
                        // `maskObjectDocument` already answered the ADR-0106 D6
                        // 5xx: a side projected to NO fields is never served.
                        if (faulted) return;
                    } else if (diffMaskPosture.kind === 'undetermined') {
                        res.header('Cache-Control', 'private, no-store');
                    }
                    res.json(served);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Diff two metadata versions (from/to query params; to defaults to the active version, from to the nearest earlier version whose body differs)',
                tags: ['metadata'],
            },
        });

        // GET /meta/object/:name/state/:field?from=:state — ADR-0020 D3.3
        // legal-next-state introspection. [#7526]
        //
        // Ledgered since #3563 (`route-ledger.ts`, `meta.getLegalNextStates`)
        // and implemented in the dispatcher's `/meta` branch — but REST's ~17
        // `/meta` routes topped out at THREE path segments and this one needs
        // four, so no registration here could ever deliver it and it answered
        // Hono's `notFound`, byte-identical to an unmounted path.
        //
        // SINGULAR ONLY, and the SDK calls this path (#9180 step 2): the
        // `/meta` type segment is always singular, so the plural twin that
        // used to be registered beside this one is retired here.
        //
        // What the retirement does NOT touch, because it is a different
        // mechanism: the plural was a DECLARED registration, never a
        // `META_URL_TO_SINGULAR` fold tolerance. This mount matches on a
        // LITERAL segment, so no request for it ever reached the fold — the
        // boundary's accept set for `/meta/:type/...` is unchanged, which is
        // what the 2026-08-17 re-weigh (item 3) requires of this step.
        //
        // [commit 7986d973f] The four-segment collision this comment used to describe is
        // GONE with the compound `/:type/:section/:name/published` twin. That
        // twin captured `/meta/object/x/state/published` as "the published
        // version of the compound name object/x/state", and only the literal
        // `object`/`state` segments winning kept the FSM reading — a field
        // literally named `published` was the ambiguity. With the twin retired
        // no other route matches four segments, so this mount is now the only
        // reading of that path rather than the preferred one.
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/object/:name/state/:field`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const name = String(req.params?.name ?? '');
                    const field = String(req.params?.field ?? '');
                    // [#6877 shape] `?from=` narrows to ONE current state;
                    // an array would reach `legalNextStates` as a
                    // stringified pair and match no transition key.
                    if (refuseRepeatedQueryParams(req, res, ['from'])) return;
                    const from = req.query?.from !== undefined ? String(req.query.from) : undefined;
                    // [#15405] The engine seam, reached the way its SIBLING at
                    // `computeExecCtx` already reaches it — `wiredEngineOrLoud`
                    // — so "no engine is wired" and "the engine WAS wired and
                    // could not be resolved" stay two facts instead of one
                    // `undefined`. The retired spelling this replaces:
                    //
                    //     this.objectQLProvider(environmentId).catch(() => undefined)
                    //
                    // ⚠️ That `.catch` was DEAD CODE until #13904. The shipped
                    // provider used to be `try { … } catch { return undefined; }`
                    // and so could not reject at all; the collapse happened one
                    // layer earlier. #13904 made the provider re-raise PRECISELY
                    // so a consumer could see the outage — and this consumer, the
                    // slot's second and the one nobody enumerated, caught it
                    // straight back. A wired-and-failing engine and a
                    // never-registered one therefore both answered the
                    // `404 NOT_FOUND · "Object not found"` twelve lines below:
                    // this route lying about the cause during exactly the
                    // incident it would be consulted in.
                    //
                    // ⛔ NOT `seamOrUndefined`. That helper SWALLOWS, and
                    // swallowing at this seam IS the defect #13476 repaired —
                    // its own docblock forbids routing the data-engine seam
                    // back through it "to make the seams uniform".
                    //
                    // The wiring fact is the provider's PRESENCE, asked once and
                    // never inferred from what it returned, so an UNWIRED engine
                    // still reaches the 404 below byte-for-byte as before — and
                    // so does a provider that RESOLVES `undefined`, which is the
                    // seam contract declaring absence rather than failing.
                    // `wiredEngineOrLoud` also invokes the provider
                    // SYNCHRONOUSLY, so a host wiring a non-`async` provider —
                    // which the seam's declared type cannot prevent — reaches the
                    // same answer as one that rejects (commit add6a1b1c) instead of
                    // escaping past a `.catch` that never came into existence.
                    const ql = await wiredEngineOrLoud(
                        Boolean(this.objectQLProvider),
                        () => this.objectQLProvider!(environmentId),
                    );
                    const schema = (ql as any)?.registry?.getObject?.(name);
                    if (!schema) {
                        // `{ error: { code, message } }`, the envelope
                        // `BaseResponseSchema` declares — not the bare
                        // `{ error: 'string' }` the dispatcher branch this
                        // mirrors emits. `pnpm check:route-envelope`
                        // ratchets both non-conforming shapes DOWN only, so
                        // a new route arrives conforming or not at all.
                        res.status(404).json({
                            error: { code: 'NOT_FOUND', message: 'Object not found' },
                        });
                        return;
                    }
                    // Dynamic import, matching the dispatcher branch this
                    // mirrors: `@objectstack/objectql` is a devDependency
                    // here, so a deployment serving REST without the data
                    // engine must degrade rather than fail to load.
                    let legalNextStates:
                        | ((s: { validations?: unknown[] } | null | undefined, f: string, c: string) => string[] | null)
                        | undefined;
                    try {
                        ({ legalNextStates } = await import('@objectstack/objectql'));
                    } catch {
                        legalNextStates = undefined;
                    }
                    if (typeof legalNextStates !== 'function') {
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'State-machine introspection is not available in this runtime',
                            },
                        });
                        return;
                    }
                    // Three answer values — `next: null`, `next: []` (a
                    // declared dead end), and the legal-next list — the same
                    // answer the dispatcher gives, because a UI asking "where
                    // can this record go" must tell those apart. But `null`
                    // is overloaded across TWO input conditions: no FSM
                    // governs the field, or the caller omitted `?from=` (no
                    // `from` => no transition table to answer with), which
                    // the line below folds onto the same `null` without
                    // consulting the rule. A UI therefore cannot read `null`
                    // as "no state machine" unless it passed a `from`.
                    const next = from === undefined ? null : legalNextStates(schema, field, from);
                    res.json({ object: name, field, from: from ?? null, next });
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'List the legal next states declared by an object field\'s state machine',
                tags: ['metadata'],
            },
        });

        // GET /meta/:type/:name/published — ADR-0033 published snapshot. [#7526]
        //
        // Ledgered since #3563 (`meta.getPublished`) and implemented in the
        // dispatcher, but never mounted here — so the request fell into the
        // compound-name route below with `section=:name, name='published'`,
        // which answered a protection-envelope stub. Identical before and
        // after publish, identical for a name that does not exist: a route
        // that structurally could not 404.
        //
        // ONE arity since commit 7986d973f (stage 3 of the maintainer-ruled
        // retirement of compound-name addressing, 2026-08-25). This route used
        // to be mounted twice — the second registration was
        // `/:type/:section/:name/published`, folding `section` and `name` back
        // into one slash-bearing key so the SDK's
        // `getPublished('lead', 'views/all_leads')` could reach it.
        //
        // Stage 1 (commit 311433f6b) declared the item-name grammar and refuses every
        // slash-bearing name at the publish door, so no name reachable ONLY
        // through that arity can exist any more. What remains addressable is a
        // pre-grammar residue row, and it is reachable HERE: a percent-encoded
        // `%2F` matches this single-segment pattern and Hono decodes the
        // parameter back to `views/all_leads` (measured, not assumed), which is
        // the spelling the SDK now sends for every name. So the compound arity
        // was removed WITHOUT removing the capability — D1's "any stored junk
        // name remains listable and clearable" still holds through this door.
        {
            registerPerItemRoute({
                method: 'GET',
                path: `${metaPath}/:type/:name/published`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const type = String(req.params?.type ?? '');
                        // [commit 7986d973f] No `section` fold: this route has one arity.
                        // A percent-encoded slash arrives already decoded here,
                        // so a residue name reads exactly as it is stored.
                        const name = String(req.params?.name ?? '');
                        // [#8278] The AUTHORITATIVE published store is consulted
                        // first: the `state:'active'` `sys_metadata` overlay row.
                        // Mirrors the dispatcher fix (#8031 / PR #8254,
                        // `packages/runtime/src/domains/meta.ts`) onto the
                        // transport that actually serves the cloud runtime — the
                        // two doors answered the same question from two stores,
                        // and only one of them had been corrected.
                        //
                        // Two publish lifecycles write to two different places:
                        //
                        //   - `MetadataManager.publishPackage` snapshots a body
                        //     into the row-local `publishedDefinition` key of its
                        //     own in-memory registry — the ADR-0016-era package
                        //     publish, which is what `getPublished` below reads.
                        //   - `publishPackageDrafts` / `promoteDraft` flips the
                        //     artifact's `sys_metadata` row `state:'draft' →
                        //     'active'`. ADR-0027 (E)(5) defines sealing a publish
                        //     as exactly that flip, `SysMetadataRepository` names
                        //     `'active'` "the published, live overlay", and
                        //     ADR-0033 §2 routes EVERY runtime authoring write
                        //     into that same ADR-0027 draft — so promoting it is
                        //     what "published" means for anything authored at
                        //     runtime. Those items were absent from the registry
                        //     `getPublished` consults, so this route answered 404
                        //     about an item that IS published.
                        //
                        // `getMetaItemLayered` is the narrow primitive on purpose.
                        // Its overlay layer is a strict `state:'active'` lookup
                        // that never reads a draft, and it reports that layer
                        // SEPARATELY from the code layer — so a null overlay is
                        // positively "no runtime-published row" and falls through
                        // to the untouched `getPublished` path below, which keeps a
                        // code-published item resolving to byte-identical bytes.
                        // The broader `getMetaItem` would not do: it folds the code
                        // layer into its own answer, so this route could no longer
                        // tell the two stores apart.
                        //
                        // [#8805] SCOPED, and this reverses what this comment
                        // used to say. It read: "NO `organizationId`, and that
                        // is the ONE deliberate divergence from the dispatcher
                        // twin" — justified because omitting it read the
                        // env-wide row, "symmetric with what an org-less
                        // `publishPackageDrafts` writes, so this door resolves
                        // exactly the publishes this door can produce."
                        //
                        // That symmetry was the whole argument, and #8805's
                        // write-side fix is what ends it: `POST /meta/:type/
                        // :name/publish` now carries the caller's organization
                        // for `allowOrgOverride: true` types, so this door can
                        // now produce an ORG-SCOPED publish. Left unscoped, this
                        // read would answer 404 about a `view` the very same
                        // caller published a moment earlier through the very
                        // same transport — the #8278 defect this route exists to
                        // close, reopened one partition over. A statement that
                        // was true of the old write path is not evidence about
                        // the new one.
                        //
                        // ⚠️ Still NOT the forbidden seam. `packages/rest` mints
                        // no `resolveActiveOrganizationId` — the warning
                        // `package-routes.ts` echoes at its `deletePackage` call
                        // ("the dispatcher twin owns that seam") is about
                        // inventing org RESOLUTION here, and this reads
                        // `tenantId` off the execution context `resolveExecCtx`
                        // already resolves, exactly as #8803 did for the audit
                        // read. [commit e1d4f9e3f] The CALLEE gates: `getMetaItemLayered`
                        // resolves `organizationIdForMetaRead` AFTER its canonical
                        // fold, so the tenant goes over RAW. ⛔ Pre-gating HERE, on
                        // the unfolded `:type`, would be the defect commit 26f3588fb fixed. ⛔ And
                        // the old "fail-open in the safe direction" reading is the
                        // argument the predicate refutes: an org named on a type
                        // the registry does not declare overridable resurrects the
                        // phantoms #6190 stopped minting.
                        //
                        // Environment scoping still holds: it comes from WHICH
                        // protocol `resolveProtocol` hands back, not from the
                        // request payload (`getMetaItemLayered` declares no
                        // `environmentId` member).
                        // [#20156] This door serves ONE document, the same
                        // representation the plain read serves — so it answers
                        // exactly what the plain read answers this caller: every
                        // gate arm (`all`), a partly-withheld app PRUNED, and the
                        // ADR-0106 object mask, its posture resolved BEFORE the
                        // fetch (D2/D3's `fetch → mask → send`). It ran none of
                        // them, so a member the plain read refuses
                        // `crm_admin_runbook` read its body here, and an object's
                        // unreadable fields were served whole. Both exits below
                        // send through `servePublished`.
                        const publishedMetaType = RestServer.metaTypeSingular(type);
                        let publishedMaskPosture: ObjectSchemaMaskPosture;
                        try {
                            publishedMaskPosture = await (await this.resolveObjectMasker(environmentId, req, publishedMetaType))(name);
                        } catch (maskError: any) {
                            if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                                sendFieldVisibilityFault(res, name);
                                return;
                            }
                            throw maskError;
                        }
                        let publishedProtocol: any;
                        try {
                            publishedProtocol = await this.resolveProtocol(environmentId, req);
                        } catch { /* fall through to the code/package snapshot below */ }
                        const servePublished = async (document: any): Promise<void> => {
                            // The gate reads the protocol for its inputs (books,
                            // the doc corpus, the object registry). The swallowed
                            // resolution above is a fall-through for the SNAPSHOT;
                            // a gate input is never read as absent, so a type the
                            // gate judges resolves it again and lets it throw.
                            const gateProtocol: RestProtocol = publishedProtocol
                                ?? await this.resolveProtocol(environmentId, req);
                            const verdict = await this.metaItemReadGate(
                                environmentId, req, gateProtocol, publishedMetaType, name, [document],
                                { arms: 'all', app: 'gate' },
                            )(document);
                            if (verdict.kind === 'refuse') {
                                verdict.send(res);
                                return;
                            }
                            let served = verdict.document;
                            if (publishedMaskPosture.kind === 'project') {
                                const related = await relateObjectSchemaMaskPosture(publishedMaskPosture, served); // [#21884]
                                const masked = this.maskObjectDocument(res, related, name, served);
                                if (!masked) return;
                                served = masked.document;
                            } else if (publishedMaskPosture.kind === 'undetermined') {
                                res.header('Cache-Control', 'private, no-store');
                            }
                            res.json(served);
                        };
                        // [#20156] The overlay found is SERVED outside the
                        // `try` below: that `catch` classifies a failed overlay
                        // READ, and a gate fault raised while serving must reach
                        // `handleRouteError` as itself — never fall through to
                        // the snapshot as though no overlay existed.
                        let publishedOverlay: unknown;
                        if (typeof publishedProtocol?.getMetaItemLayered === 'function') {
                            try {
                                const publishedCtx = await this.resolveExecCtx(environmentId, req)
                                    .catch(rethrowAuthzStoreUnavailable);
                                const layered = await publishedProtocol.getMetaItemLayered({
                                    type,
                                    name,
                                    ...(publishedCtx?.tenantId
                                        ? { organizationId: publishedCtx.tenantId }
                                        : {}),
                                });
                                if (layered?.overlay !== undefined && layered?.overlay !== null) {
                                    // [#21002, #21986, ADR-0126 §2, ADR-0062 D4]
                                    // When the layered read put a code layer
                                    // over this stored row, this door serves
                                    // that effective layer, not the row. The
                                    // protocol decides it with one predicate,
                                    // `declinesStoredRow`, for both name
                                    // classes: a shipped flow name (the
                                    // loader's body; `flow` is Regime C,
                                    // "never an overlay read path") and a
                                    // code-defined datasource name (the code
                                    // definition; "code wins on collision").
                                    // The predicate is ASKED of its owner with
                                    // the answer's own `type` / `name`, never
                                    // re-derived here, so this door, the
                                    // by-name read, the list and
                                    // `getMetaItemLayered` read one rule. Every
                                    // other stored row is served exactly as
                                    // before — an `object` too, whose effective
                                    // layer differs from its row by folding, not
                                    // by this decision — and so is every row of a
                                    // protocol that brings no such predicate.
                                    const decliner: { declinesStoredRow?(type: string, name: unknown): boolean } = publishedProtocol;
                                    publishedOverlay = typeof decliner.declinesStoredRow === 'function'
                                        && decliner.declinesStoredRow(layered.type, layered.name)
                                        ? layered.effective
                                        : layered.overlay;
                                }
                            } catch (overlayError: any) {
                                // [#5532] The overlay read is NOT blanket-swallowed,
                                // and this is the second deliberate divergence from
                                // the dispatcher twin. `getMetaItemLayered` documents
                                // that it throws `503 SERVICE_UNAVAILABLE` ONLY when a
                                // read that would decide a layer did not happen; the
                                // benign "table not provisioned yet" case genuinely
                                // means "no overlay row" and returns normally with
                                // `overlay: null`. So a throw here is an availability
                                // failure, and falling through would let it reach the
                                // client as `404 Not found` — an availability failure
                                // reported as an existence fact, which is exactly the
                                // #5532 defect this package pins in
                                // `rest-meta-outage-vs-miss.test.ts`. A declared
                                // status is re-thrown so `handleRouteError` renders
                                // the producer's own 503; anything undeclared (a
                                // third-party protocol throwing something shapeless)
                                // still falls through, so this cannot make the
                                // code-published path newly fail closed.
                                if (typeof overlayError?.status === 'number') throw overlayError;
                            }
                        }
                        if (publishedOverlay !== undefined) {
                            await servePublished(publishedOverlay);
                            return;
                        }

                        const svc = await this.resolveMetadataService(environmentId, req);
                        if (typeof (svc as any)?.getPublished !== 'function') {
                            // [#8297] Reached ONLY when the overlay consult above
                            // found nothing (a null `layered.overlay`) — so this is
                            // no longer "this kernel cannot answer /published" (the
                            // pre-#8278 reading); it is the narrower, rarer
                            // condition the message below actually states: nothing
                            // is runtime-published for this item, AND this kernel's
                            // metadata slot has no code/package store to fall back
                            // to (`getPublished` is optional on `IMetadataService`
                            // and unimplemented here). Status, `code`, and routing
                            // order are unchanged — only the prose was stale.
                            res.status(501).json({
                                error: {
                                    code: 'NOT_IMPLEMENTED',
                                    message: 'Nothing is runtime-published for this item, and this kernel has no code/package store (metadata.getPublished() is not available).',
                                },
                            });
                            return;
                        }
                        // [commit 26f3588fb] FOLDED here too — the smaller second site
                        // of the same class. The layered consult above folds
                        // internally (protocol boundary), but this fallback
                        // reads the code/package registry, which stores
                        // CANONICAL types; handed the raw segment it answered
                        // 404 for a recognised plural and 200 for the singular
                        // twin of the same code-published item.
                        const data = await (svc as any).getPublished(canonicalMetaUrlType(type), name);
                        // The 404 this route could never produce before. An
                        // item that exists but was never published still
                        // answers 200 with its current definition — that is
                        // `getPublished`'s documented fallback, and it is a
                        // different fact from "no such item".
                        if (data === undefined) {
                            res.status(404).json({
                                error: { code: 'NOT_FOUND', message: 'Not found' },
                            });
                            return;
                        }
                        await servePublished(data);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Get the published version of a metadata item',
                    tags: ['metadata'],
                },
            });
        }

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
        const uiPath = `${basePath}/ui`;
        const isScoped = basePath.includes('/environments/:environmentId');

        // GET /ui/view/:object/:type - Resolve view for object
        this.routeManager.register({
            method: 'GET',
            path: `${uiPath}/view/:object/:type`,
            handler: async (req: any, res: any) => {
                try {
                    const routeEnvironmentId = isScoped ? req.params?.environmentId : undefined;
                    // [commit cc837dbfe] THE environment decision for this request, taken
                    // once through the shared entry point and then reused — so
                    // the identity below, the ownership comparison and the
                    // protocol that answers cannot be about three different
                    // environments.
                    const environmentId = await this.resolveRequestEnvironmentId(routeEnvironmentId, req);
                    // A BARE site, deliberately, and the census in
                    // `execctx-consumer-census.test.ts` is what makes that a
                    // decision rather than an omission: the 52 sites whose very
                    // next statement is the shared anonymous floor carry no
                    // local `.catch`, because `computeExecCtx` already converts
                    // every fault except an authz-store outage into `undefined`
                    // and re-raises that one — which this handler's own
                    // `try/catch` turns into the declared fault response. A
                    // local `.catch(rethrowAuthzStoreUnavailable)` here would be
                    // behaviourally identical and would make this the only site
                    // that is both locally caught AND behind the floor, which is
                    // exactly the split that census asserts does not exist.
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    if (this.enforceEnvironmentOwnership(req, res, environmentId, context)) return;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (p.getUiView) {
                        const viewRequest: TransportScopedMetaRequest<GetUiViewRequest> = {
                            object: req.params.object,
                            type: req.params.type,
                            // [commit cc837dbfe] `routeEnvironmentId`, NOT the resolved id.
                            // The gate above changed WHO may reach the producer;
                            // it deliberately did not change WHAT the producer is
                            // told. This key has only ever been present on the
                            // scoped mount, and the shipped `getUiView` declares
                            // `{ object, type }` alone — widening the argument on
                            // the unscoped mount would be an unrelated behaviour
                            // change riding on a security fix.
                            ...(routeEnvironmentId ? { environmentId: routeEnvironmentId } : {}),
                        };
                        const view = await p.getUiView(viewRequest);
                        res.json(view);
                    } else {
                        res.status(501).json({ error: 'UI View resolution not supported by protocol implementation', code: 'NOT_IMPLEMENTED' });
                    }
                } catch (error: any) {
                    handleRouteError(res, error, req.params?.object);
                }
            },
            metadata: {
                summary: 'Resolve UI View for object',
                tags: ['ui'],
            },
        });
    }
    
    /**
     * Register CRUD endpoints for data operations
     */
    private registerCrudEndpoints(basePath: string): void {
        const { crud } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;
        const isScoped = basePath.includes('/environments/:environmentId');

        const operations = crud.operations;

        // GET /data/:object - List/query records
        if (operations.list) {
            this.routeManager.register({
                method: 'GET',
                path: `${dataPath}/:object`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'list')) return;
                        // [#6877] Still NOT arity-gated as a whole, for the
                        // reason it never was: this route hands the WHOLE query
                        // record to `findData`, whose normalizer
                        // (`metadata-protocol`) owns every parameter's arity — the
                        // `$`-alias table, the implicit field-equality bucket, and
                        // the `$select`/`$expand`/`$searchFields` params that are
                        // legitimately multi-valued. Declaring an arity list here
                        // would be this file guessing at another package's
                        // contract.
                        //
                        // [#7390] ONE slot is the exception, and structurally so
                        // rather than by taste. A filter AST *is* an array
                        // (`['status','=','open']`), so #7386's arity gate cannot
                        // read `Array.isArray` as evidence of repetition on the
                        // filter slot: the normalizer serves this querystring and
                        // `POST /data/:object/query`'s arbitrary-JSON body through
                        // one door and cannot tell them apart. THIS layer can — on
                        // a querystring an array is a repeated parameter and can be
                        // nothing else — so the filter slot's arity is judged here,
                        // and only here, leaving the normalizer free of a heuristic.
                        //
                        // Refused, never resolved (maintainer ruling 2026-08-11 on
                        // #7390): last-wins and AND-merge are each a silent choice
                        // between two intents a caller actually expressed. Before
                        // this line the common shape was answered with the WRONG
                        // diagnosis — `malformedFilterArrayError`, telling a caller
                        // whose filters were both well-formed to check their AST
                        // syntax — and the rarer `?filter=status&filter=%3D&filter=open`
                        // spelled a valid AST and returned 200 with a filter nobody
                        // expressed. It throws rather than responding so both keep
                        // the envelope this route's other filter refusals already
                        // use; see the helper for why.
                        assertFilterParamSuppliedOnce(req.query);
                        const listRequest: ServerScopedDataRequest<FindDataRequest> = {
                            object: req.params.object,
                            query: req.query,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.findData(listRequest);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Query records',
                    tags: ['data', 'crud'],
                },
            });
        }

        // GET /data/:object/:id - Get single record
        if (operations.read) {
            this.routeManager.register({
                method: 'GET',
                path: `${dataPath}/:object/:id`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        // [#6877] NOT gated, and this is a measured verdict
                        // rather than a name-based one: `GetDataRequest.select` /
                        // `.expand` are declared `z.array(z.string())`, and the
                        // consumer signature is
                        // `getData({ …, expand?: string | string[], select?: string | string[] })`
                        // — it splits the comma form itself and passes an array
                        // straight through. `?select=a&select=b` is therefore
                        // ALREADY correct end to end, and refusing it (or
                        // flattening it) would be the regression. The card listed
                        // this line under "array flows downstream"; measurement
                        // says the downstream was built for it.
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'get')) return;
                        // [#7606] Closed parameter set, AFTER the capability
                        // gates for the same reason #7527 put it there: which
                        // parameters a route understands is information, and a
                        // caller who may not read this object should not learn
                        // the shape of its ingress before being refused.
                        //
                        // This gate RESPONDS rather than throwing, which on this
                        // route is load-bearing and not a style choice: the catch
                        // below rewrites every 400 into a 404 (a bad id is a
                        // miss, not a malformed request). A refusal routed
                        // through it would reach the caller as "no such record"
                        // — the silent-drop defect wearing a different status.
                        if (refuseUnknownQueryParams(req, res, DATA_RECORD_READ_PARAMS)) return;
                        const { select, expand } = req.query || {};
                        const getRequest: ServerScopedDataRequest<GetDataRequest> = {
                            object: req.params.object,
                            id: req.params.id,
                            ...(select != null ? { select } : {}),
                            ...(expand != null ? { expand } : {}),
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.getData(getRequest);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status === 400 ? 404 : mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Get record by ID',
                    tags: ['data', 'crud'],
                },
            });
        }

        // POST /data/:object - Create record
        if (operations.create) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'create')) return;
                        // [#3899] The wire body IS the record. Validate the
                        // assembled protocol request (`CreateDataRequestSchema`,
                        // catalog `requestSchema`) so a non-record body — an
                        // array, a string, a number — answers 400 instead of
                        // reaching the engine as `data`. Per-field checks stay
                        // downstream (object metadata / validation rules); this
                        // gate is about the SHAPE the contract declares.
                        const { CreateDataRequestSchema } = await import('@objectstack/spec/api');
                        const createInput = { object: req.params.object, data: req.body ?? {} };
                        const parsedCreate = (CreateDataRequestSchema as any).safeParse(createInput);
                        if (!parsedCreate.success) {
                            res.status(400).json({
                                error: 'Invalid create request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedCreate.error?.issues, createInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        const createRequest: ServerScopedDataRequest<CreateDataRequest> = {
                            object: req.params.object,
                            data: req.body ?? {},
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.createData(createRequest);
                        // [#3431] Advertise fields the engine's create-side static-
                        // `readonly` strip dropped (`engine.insert`, relayed by
                        // `createData` as `droppedFields`) via the response header
                        // (body also carries `droppedFields`). Status stays 201.
                        applyDroppedFieldsHeader(res, result);
                        res.status(201).json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Create record',
                    tags: ['data', 'crud'],
                },
            });
        }

        // POST /data/:object/query — Spec-shape advanced query (QueryAST in body).
        // Supports server-side aggregation via { groupBy, aggregations, where, ... }
        // per spec/data/query.zod.ts. Mirrors what `client.data.query()` posts.
        // Returns FindDataResponse = { object, records, total? }.
        if (operations.list) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/query`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'list')) return;
                        // [#3899] Validate the QueryAST body against the declared
                        // contract (`FindDataRequestSchema`, catalog `requestSchema`).
                        // A malformed body used to be forwarded as-is — and since a
                        // dropped/mistyped clause does not narrow a query, it WIDENS
                        // it, `{"filter": …}` degraded into an unfiltered full read
                        // with a 200. The PATH object is written last (#3946) so a
                        // body `object` can neither dodge the `enforceApiAccess`
                        // gate above nor move the read. Validation only: the merged
                        // ORIGINAL body is forwarded, not the parse output, so the
                        // schema cannot inject defaults the engine did not receive
                        // before (the analytics-entry precedent, #3878).
                        const { FindDataRequestSchema } = await import('@objectstack/spec/api');
                        const rawQuery = req.body ?? {};
                        const query = (rawQuery && typeof rawQuery === 'object' && !Array.isArray(rawQuery))
                            ? { ...rawQuery, object: req.params.object }
                            : rawQuery; // non-object bodies go to the schema as-is and fail with `query: invalid_type`
                        const findInput = { object: req.params.object, query };
                        const parsedFind = (FindDataRequestSchema as any).safeParse(findInput);
                        if (!parsedFind.success) {
                            res.status(400).json({
                                error: 'Invalid query request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedFind.error?.issues, findInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        const queryRequest: ServerScopedDataRequest<FindDataRequest> = {
                            object: req.params.object,
                            query,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.findData(queryRequest);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Advanced query (QueryAST in body)',
                    tags: ['data', 'crud'],
                },
            });
        }

        // PATCH /data/:object/:id - Update record
        if (operations.update) {
            this.routeManager.register({
                method: 'PATCH',
                path: `${dataPath}/:object/:id`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // OCC: clients opt in by sending either the standard
                        // `If-Match` header or an `expectedVersion` field in
                        // the JSON body. Body wins when both are present
                        // (lets callers override per-request without
                        // touching headers). See ConcurrentUpdateError in
                        // packages/objectql/src/protocol.ts.
                        const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                        const bodyVersion = (req.body && typeof req.body === 'object')
                            ? (req.body as any).expectedVersion
                            : undefined;
                        const expectedVersion = bodyVersion ?? ifMatchHeader;
                        // Strip the meta field out of the data payload so it
                        // doesn't get written as a column.
                        let data = req.body;
                        if (data && typeof data === 'object' && 'expectedVersion' in (data as any)) {
                            const { expectedVersion: _drop, ...rest } = data as any;
                            data = rest;
                        }
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'update')) return;
                        // [#3899] Same gate as create: the wire body is the bare
                        // field patch (`expectedVersion` already stripped above),
                        // validated as the assembled `UpdateDataRequestSchema`
                        // request so a non-record body 400s instead of reaching
                        // the engine.
                        const { UpdateDataRequestSchema } = await import('@objectstack/spec/api');
                        const updateInput = {
                            object: req.params.object,
                            id: req.params.id,
                            data: data ?? {},
                            ...(expectedVersion ? { expectedVersion: String(expectedVersion) } : {}),
                        };
                        const parsedUpdateOne = (UpdateDataRequestSchema as any).safeParse(updateInput);
                        if (!parsedUpdateOne.success) {
                            res.status(400).json({
                                error: 'Invalid update request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedUpdateOne.error?.issues, updateInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        const updateRequest: ServerScopedDataRequest<UpdateDataRequest> = {
                            object: req.params.object,
                            id: req.params.id,
                            data: data ?? {},
                            ...(expectedVersion ? { expectedVersion: String(expectedVersion) } : {}),
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.updateData(updateRequest);
                        // [#3431] Advertise any LEGALLY-stripped write fields via
                        // the response header before serialising (the body also
                        // carries `droppedFields`). Status stays 200.
                        applyDroppedFieldsHeader(res, result);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Update record',
                    tags: ['data', 'crud'],
                },
            });
        }

        // DELETE /data/:object/:id - Delete record
        if (operations.delete) {
            this.routeManager.register({
                method: 'DELETE',
                path: `${dataPath}/:object/:id`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // OCC: same opt-in protocol as PATCH (`If-Match`
                        // header or `expectedVersion` query string). DELETE
                        // has no JSON body, so we only accept the header
                        // and a query parameter.
                        // [#6877] `String(['1','2'])` is `'1,2'` — an OCC token
                        // no row carries, so a repeated `?expectedVersion=` turned
                        // an optimistic-concurrency check into a guaranteed
                        // conflict on a DESTRUCTIVE verb.
                        if (refuseRepeatedQueryParams(req, res, ['expectedVersion'])) return;
                        const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                        const queryVersion = (req.query && typeof req.query === 'object')
                            ? (req.query as any).expectedVersion
                            : undefined;
                        const expectedVersion = queryVersion ?? ifMatchHeader;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'delete')) return;
                        const deleteRequest: ServerScopedDataRequest<DeleteDataRequest> = {
                            object: req.params.object,
                            id: req.params.id,
                            ...(expectedVersion ? { expectedVersion: String(expectedVersion) } : {}),
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.deleteData(deleteRequest);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Delete record',
                    tags: ['data', 'crud'],
                },
            });
        }
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
        const isScoped = basePath.includes('/environments/:environmentId');
        const { crud } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;

        // POST /data/:object/:id/clone — duplicate a record (gated by the
        // object's `enable.clone` capability, default on). Optional JSON body
        // `{ overrides?: {...} }` (or a bare field map) is applied on top of
        // the copied values, e.g. to set a new name or clear a unique field.
        // Distinct path segment (`/clone`) keeps it clear of the greedy
        // `/data/:object/:id` matchers.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/:id/clone`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'create')) return;
                    const cloneData = (p as any).cloneData;
                    if (typeof cloneData !== 'function') {
                        res.status(501).json({ code: 'NOT_IMPLEMENTED', error: 'Clone not supported by this protocol' });
                        return;
                    }
                    const body = req.body ?? {};
                    // Accept both `{ overrides: {...} }` and a bare field map so
                    // callers can POST overrides directly without nesting.
                    const overrides = (body && typeof body === 'object' && 'overrides' in body)
                        ? body.overrides
                        : body;
                    const result = await cloneData.call(p, {
                        object: req.params.object,
                        id: req.params.id,
                        ...(overrides && typeof overrides === 'object' ? { overrides } : {}),
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    });
                    res.status(201).json(result);
                } catch (error: any) {
                    // Clone's domain errors (CLONE_DISABLED/RECORD_NOT_FOUND)
                    // carry an explicit `.status`; `handleRouteError` resolves
                    // that passthrough itself and logs only genuine faults.
                    handleRouteError(res, error, req.params?.object);
                }
            },
            metadata: {
                summary: 'Clone a record (gated by enable.clone)',
                tags: ['data', 'clone'],
            },
        });

        // POST /data/:object/import  — bulk CSV/JSON ingestion (M10.9)
        //
        // Body shapes:
        //   { format: 'csv', csv: '...header,row,...', dryRun?: boolean, mapping?: {<csvCol>:<field>} }
        //   { format: 'json', rows: [...], dryRun?: boolean }
        //
        // Returns per-row outcome so a UI can present an import report.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/import`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const objectName = String(req.params.object || '');
                    if (!objectName) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'object is required' });
                        return;
                    }
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'import')) return;
                    const body = req.body ?? {};

                    // Parse + validate the payload (shared with the async job route).
                    // The synchronous path caps at 5k rows; larger files must use the
                    // async import-job endpoint.
                    const prep = await prepareImportRequest(body, {
                        p, objectName, environmentId, maxRows: 5000,
                        // Accept locale-translated option labels (what the localized
                        // export / import template contain) as select-cell synonyms.
                        localizeSchema: (schema: any) => this.translateMetaItem(req, 'object', environmentId, schema),
                    });
                    if (!prep.ok) {
                        if (prep.status === 413) prep.error += ' Use an async import job for larger files.';
                        res.status(prep.status).json({ code: prep.code, error: prep.error });
                        return;
                    }
                    const { rows, writeMode, dryRun } = prep.prepared;

                    // [#3391] Import gate — stage 2 (precise). Stage 1 above is a
                    // coarse `create ∨ update` check that 405s fully-closed objects
                    // BEFORE the (potentially large) CSV parse. Now that the write
                    // mode is known, re-gate precisely: insert→create, update→update,
                    // upsert→create∧update. Catches e.g. an object that grants only
                    // `create` receiving an update-mode import.
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'import', { writeMode })) return;

                    // Delegate the per-row coercion + upsert loop to the shared
                    // runner (also used by the async import-job worker).
                    const summary = await runImport({
                        p, objectName, environmentId, context, ...prep.prepared,
                        // #3957 — lets the row report resolve a deployment's
                        // `validation.field.*` message overrides.
                        translate: await this.resolveMessageTranslator(environmentId, req),
                    });

                    res.json({
                        object: objectName,
                        dryRun,
                        writeMode,
                        total: rows.length,
                        ok: summary.ok,
                        errors: summary.errors,
                        created: summary.created,
                        updated: summary.updated,
                        skipped: summary.skipped,
                        results: summary.results,
                    });
                } catch (error: any) {
                    handleRouteError(res, error, String(req.params?.object || ''));
                }
            },
            metadata: {
                summary: 'Bulk-import rows into an object (CSV or JSON, with optional dry-run)',
                tags: ['data', 'import'],
            },
        });

        // ── Asynchronous import jobs (P1) ──────────────────────────────────
        //
        // For files too large for the synchronous route (up to 50k rows), the
        // client POSTs the whole payload once; the server persists a
        // `sys_import_job`, responds immediately with a jobId, then processes
        // the batch in the background — updating progress on the job row as it
        // streams. Callers poll progress/results and list history. These routes
        // are registered inside registerDataActionEndpoints (before the greedy
        // CRUD `:object/:id`), so the literal `import/jobs` segments win.

        // Shared loader: fetch one job row by id. Used by the read routes, the
        // cancel route, and the background worker's durable cancellation checks.
        const loadImportJob = async (p: any, jobId: string, environmentId?: string, context?: any): Promise<any | undefined> => {
            // [#16337] The FOURTH server-built `findData` literal in this file,
            // and the one the card's three did not name — because nothing could
            // see it: `p` is `any`, so this call was type-checked by nothing at
            // all and its `$filter` / `$top` wire spellings cost no diagnostic.
            // Annotating the literal is what puts it back under the same
            // compiler check as its three siblings; canonicalising it is the
            // same mechanical rewrite (`$filter`→`where`, `$top`→`limit`).
            const jobLoadRequest: ServerScopedDataRequest<FindDataRequest> = {
                object: IMPORT_JOB_OBJECT,
                query: { object: IMPORT_JOB_OBJECT, where: { id: jobId }, limit: 1 },
                ...(environmentId ? { environmentId } : {}),
                ...(context ? { context } : {}),
            };
            const r = await p.findData(jobLoadRequest);
            const rows = Array.isArray(r?.records) ? r.records
                : Array.isArray(r?.data) ? r.data
                    : Array.isArray(r?.rows) ? r.rows
                        : Array.isArray(r) ? r : [];
            return rows[0];
        };

        // POST /data/:object/import/jobs — create an async import job.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/import/jobs`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const objectName = String(req.params.object || '');
                    if (!objectName) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'object is required' });
                        return;
                    }
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'import')) return;

                    const prep = await prepareImportRequest(req.body ?? {}, {
                        p, objectName, environmentId, maxRows: IMPORT_JOB_MAX_ROWS,
                        // Same round-trip i18n synonyms as the synchronous route.
                        localizeSchema: (schema: any) => this.translateMetaItem(req, 'object', environmentId, schema),
                    });
                    if (!prep.ok) {
                        if (prep.status === 413) prep.error += ` This is the async import ceiling; split the file into batches of ${IMPORT_JOB_MAX_ROWS}.`;
                        res.status(prep.status).json({ code: prep.code, error: prep.error });
                        return;
                    }
                    const prepared = prep.prepared;

                    // [#3391] Import gate — stage 2 (precise), see the synchronous
                    // route: now that writeMode is resolved, re-gate precisely
                    // (insert→create, update→update, upsert→create∧update).
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'import', { writeMode: prepared.writeMode })) return;

                    const jobId = newImportJobId();
                    const createdAt = new Date().toISOString();
                    const createdBy = String((context as any)?.userId ?? (context as any)?.user?.id ?? '') || undefined;
                    const jobRow: Record<string, any> = {
                        id: jobId,
                        object_name: objectName,
                        status: 'pending',
                        total_rows: prepared.rows.length,
                        processed_rows: 0,
                        created_count: 0,
                        updated_count: 0,
                        skipped_count: 0,
                        error_count: 0,
                        write_mode: prepared.writeMode,
                        dry_run: prepared.dryRun,
                        run_automations: prepared.runAutomations,
                        treat_as_historical: prepared.treatAsHistorical,
                        created_at: createdAt,
                        ...(createdBy ? { created_by: createdBy } : {}),
                    };

                    // Resolved NOW, while the request is still alive: the worker
                    // below runs after the 201 response, when `req` (and its
                    // headers) are no longer safe to read (#3957).
                    const messageTranslator = await this.resolveMessageTranslator(environmentId, req);

                    try {
                        // [ADR-0103] sys_import_job rows are engine-owned — the import
                        // worker owns their lifecycle, and the object is locked to
                        // ['get','list']. Persist system-elevated so the engine-owned
                        // write guard admits it; attribution is preserved because
                        // `created_by` is stamped explicitly on the row above.
                        const jobCreateRequest: ServerScopedDataRequest<CreateDataRequest> = { object: IMPORT_JOB_OBJECT, data: jobRow, context: { ...(context as any), isSystem: true }, ...(environmentId ? { environmentId } : {}) };
                        await p.createData(jobCreateRequest);
                    } catch (err: any) {
                        logError('[REST] Failed to persist import job:', err);
                        res.status(500).json({ code: 'IMPORT_JOB_CREATE_FAILED', error: 'Could not create import job' });
                        return;
                    }

                    // Respond immediately; process in the background.
                    res.status(201).json({ jobId, object: objectName, status: 'pending', total: prepared.rows.length, createdAt });

                    // Background worker. Fire-and-forget: it owns its own error
                    // handling and persists terminal state to the job row.
                    const patch = async (data: Record<string, any>) => {
                        try {
                            // [ADR-0103] engine-owned
                            const jobPatchRequest: ServerScopedDataRequest<UpdateDataRequest> = { object: IMPORT_JOB_OBJECT, id: jobId, data, context: { ...(context as any), isSystem: true }, ...(environmentId ? { environmentId } : {}) };
                            await p.updateData(jobPatchRequest);
                        } catch (err) {
                            logError('[REST] import job progress write failed:', err);
                        }
                    };
                    // Record undo instructions for small non-dry-run jobs so the
                    // import can be logically rolled back later.
                    const captureUndo = !prepared.dryRun && prepared.rows.length <= IMPORT_JOB_UNDO_MAX_ROWS;
                    void (async () => {
                        // Cancelled while still pending? Don't start (and don't let
                        // the 'running' patch below overwrite the durable 'cancelled').
                        if (this.cancelledImportJobs.has(jobId)) {
                            this.cancelledImportJobs.delete(jobId);
                            await patch({ status: 'cancelled', completed_at: new Date().toISOString() });
                            return;
                        }
                        await patch({ status: 'running', started_at: new Date().toISOString() });
                        try {
                            const summary = await runImport({
                                p, objectName, environmentId, context, ...prepared,
                                translate: messageTranslator,
                                captureUndo,
                                progressEvery: 200,
                                onProgress: (pr) => patch({
                                    processed_rows: pr.processed,
                                    created_count: pr.created,
                                    updated_count: pr.updated,
                                    skipped_count: pr.skipped,
                                    error_count: pr.errors,
                                }),
                                shouldCancel: async () => {
                                    if (this.cancelledImportJobs.has(jobId)) return true;
                                    // Durable fallback: the cancel route also writes
                                    // status='cancelled' to the job row, so a cancel
                                    // accepted by another process (or after a restart
                                    // dropped the in-memory flag) still stops the worker.
                                    try {
                                        const row = await loadImportJob(p, jobId, environmentId, context);
                                        return String(row?.status ?? '') === 'cancelled';
                                    } catch { return false; }
                                },
                            });
                            // A cancel that lands after the last checkpoint must still
                            // win the terminal state: the cancel route already marked
                            // the durable row 'cancelled', and a late 'succeeded' here
                            // would silently overwrite it (framework#2824). Counts stay
                            // truthful either way — they reflect what was written.
                            let finalStatus = summary.cancelled ? 'cancelled' : 'succeeded';
                            if (finalStatus === 'succeeded' && this.cancelledImportJobs.has(jobId)) finalStatus = 'cancelled';
                            if (finalStatus === 'succeeded') {
                                try {
                                    const row = await loadImportJob(p, jobId, environmentId, context);
                                    if (String(row?.status ?? '') === 'cancelled') finalStatus = 'cancelled';
                                } catch { /* keep succeeded */ }
                            }
                            await patch({
                                status: finalStatus,
                                processed_rows: summary.processed,
                                created_count: summary.created,
                                updated_count: summary.updated,
                                skipped_count: summary.skipped,
                                error_count: summary.errors,
                                results: capImportResults(summary.results),
                                completed_at: new Date().toISOString(),
                                ...(summary.undoLog ? { undo_log: summary.undoLog } : {}),
                            });
                        } catch (err: any) {
                            await patch({
                                status: 'failed',
                                error: String(err?.message ?? err).slice(0, 1000),
                                completed_at: new Date().toISOString(),
                            });
                        } finally {
                            this.cancelledImportJobs.delete(jobId);
                        }
                    })();
                } catch (error: any) {
                    handleRouteError(res, error, String(req.params?.object || ''));
                }
            },
            metadata: {
                summary: 'Create an asynchronous import job (large files, up to 50k rows)',
                tags: ['data', 'import'],
            },
        });

        // POST /data/import/jobs/:jobId/cancel — request cancellation.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/import/jobs/:jobId/cancel`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const jobId = String(req.params.jobId || '');
                    const row = await loadImportJob(p, jobId, environmentId, context);
                    if (!row) {
                        res.status(404).json({ code: 'NOT_FOUND', error: `No import job ${jobId}` });
                        return;
                    }
                    const status = String(row.status ?? '');
                    if (status === 'pending' || status === 'running') {
                        // Signal the in-process worker and mark the durable row.
                        this.cancelledImportJobs.add(jobId);
                        try {
                            // [ADR-0103] engine-owned
                            const jobCancelRequest: ServerScopedDataRequest<UpdateDataRequest> = { object: IMPORT_JOB_OBJECT, id: jobId, data: { status: 'cancelled', completed_at: new Date().toISOString() }, context: { ...(context as any), isSystem: true }, ...(environmentId ? { environmentId } : {}) };
                            await p.updateData(jobCancelRequest);
                        } catch { /* worker will still stop via the in-memory flag */ }
                    }
                    res.json({ success: true });
                } catch (error: any) {
                    handleRouteError(res, error, '');
                }
            },
            metadata: { summary: 'Cancel an in-flight import job', tags: ['data', 'import'] },
        });

        // POST /data/import/jobs/:jobId/undo — logical rollback of a finished
        // job: delete the records it created and restore the fields it updated
        // to their pre-import values (from the captured undo log).
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/import/jobs/:jobId/undo`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const jobId = String(req.params.jobId || '');
                    const row = await loadImportJob(p, jobId, environmentId, context);
                    if (!row) {
                        res.status(404).json({ code: 'NOT_FOUND', error: `No import job ${jobId}` });
                        return;
                    }
                    if (row.reverted_at) {
                        res.status(409).json({ code: 'ALREADY_REVERTED', error: 'This import has already been undone' });
                        return;
                    }
                    if (!importJobUndoable(row)) {
                        res.status(422).json({ code: 'NOT_UNDOABLE', error: 'This import cannot be undone (too large, still running, or nothing was written)' });
                        return;
                    }
                    const objectName = String(row.object_name ?? '');
                    const log = parseUndoLog(row.undo_log)!;
                    // Undo automations too: reversing writes shouldn't re-fire triggers.
                    // Skip the state machine as well (#3479): restoring a prior snapshot
                    // re-writes the row's earlier state, which need not be a legal
                    // transition from where it is now — an undo reinstates an established
                    // fact, it does not walk the FSM.
                    //
                    // For a historical import (#3493/#3549), the undo write must mirror
                    // the import's own write context: carry `preserveAudit` so restoring
                    // `u.before` re-writes the captured `updated_at`/`updated_by` (and any
                    // business `readonly` fields in the snapshot) verbatim, rather than
                    // stamping-now / stripping them. Without this, undoing a historical
                    // import would silently rewrite the audit timeline the import took
                    // pains to preserve. A normal import keeps the default (stamp/strip).
                    const writeCtx = {
                        ...(context ?? {}),
                        skipAutomations: true,
                        skipStateMachine: true,
                        ...(row.treat_as_historical ? { preserveAudit: true } : {}),
                    };
                    let deleted = 0, restored = 0, failed = 0;

                    // Delete created records first (they didn't exist before).
                    for (const id of log.created) {
                        try {
                            const undoDeleteRequest: ServerScopedDataRequest<DeleteDataRequest> = { object: objectName, id, context: writeCtx, ...(environmentId ? { environmentId } : {}) };
                            await p.deleteData(undoDeleteRequest);
                            deleted++;
                        } catch { failed++; }
                    }
                    // Restore the touched fields on updated records.
                    for (const u of log.updated) {
                        try {
                            const undoRestoreRequest: ServerScopedDataRequest<UpdateDataRequest> = { object: objectName, id: u.id, data: u.before, context: writeCtx, ...(environmentId ? { environmentId } : {}) };
                            await p.updateData(undoRestoreRequest);
                            restored++;
                        } catch { failed++; }
                    }

                    const undoStampRequest: ServerScopedDataRequest<UpdateDataRequest> = {
                        object: IMPORT_JOB_OBJECT, id: jobId,
                        data: { reverted_at: new Date().toISOString() },
                        context: { ...(context as any), isSystem: true }, // [ADR-0103] engine-owned
                        ...(environmentId ? { environmentId } : {}),
                    };
                    await p.updateData(undoStampRequest);
                    res.json({ success: true, jobId, object: objectName, deleted, restored, failed });
                } catch (error: any) {
                    handleRouteError(res, error, '');
                }
            },
            metadata: { summary: 'Undo (logically roll back) a finished import job', tags: ['data', 'import'] },
        });

        // GET /data/import/jobs/:jobId/results — progress + capped per-row report.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/import/jobs/:jobId/results`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const jobId = String(req.params.jobId || '');
                    const row = await loadImportJob(p, jobId, environmentId, context);
                    if (!row) {
                        res.status(404).json({ code: 'NOT_FOUND', error: `No import job ${jobId}` });
                        return;
                    }
                    const stored = row.results;
                    const items = Array.isArray(stored?.items) ? stored.items : Array.isArray(stored) ? stored : [];
                    res.json({ ...importJobToProgress(row), results: items, resultsTruncated: !!stored?.truncated });
                } catch (error: any) {
                    handleRouteError(res, error, '');
                }
            },
            metadata: { summary: 'Import job results (capped per-row report)', tags: ['data', 'import'] },
        });

        // GET /data/import/jobs/:jobId — live progress counters.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/import/jobs/:jobId`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const jobId = String(req.params.jobId || '');
                    const row = await loadImportJob(p, jobId, environmentId, context);
                    if (!row) {
                        res.status(404).json({ code: 'NOT_FOUND', error: `No import job ${jobId}` });
                        return;
                    }
                    res.json(importJobToProgress(row));
                } catch (error: any) {
                    handleRouteError(res, error, '');
                }
            },
            metadata: { summary: 'Import job progress', tags: ['data', 'import'] },
        });

        // GET /data/import/jobs — history list (newest first).
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/import/jobs`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    // [#6877] `?status=queued&status=running` dropped the filter
                    // entirely (the `typeof` guard), and a repeated `?limit=`
                    // fell back to the default page — both answered 200 with a
                    // row set the caller did not ask for.
                    if (refuseRepeatedQueryParams(req, res, ['object', 'status', 'limit', 'offset'])) return;
                    const q = req.query ?? {};
                    const filter: Record<string, any> = {};
                    if (typeof q.object === 'string' && q.object) filter.object_name = q.object;
                    if (typeof q.status === 'string' && q.status) filter.status = q.status;
                    // [#20061] Parsed through the DECLARED `ListImportJobsRequestSchema`
                    // (limit `int().min(1).max(200).default(50)`, offset
                    // `int().min(0).default(0)`) rather than clamped: `?limit=0` used to
                    // answer the 50-row default and `?limit=500` 200 rows, both `200`.
                    // Absent and empty keep the declared defaults, as they always did.
                    const limit = readDeclaredQueryNumber(q, 'limit',
                        ListImportJobsRequestSchema.shape.limit, { emptyIsAbsent: true });
                    const offset = readDeclaredQueryNumber(q, 'offset',
                        ListImportJobsRequestSchema.shape.offset, { emptyIsAbsent: true });
                    const jobsListRequest: ServerScopedDataRequest<FindDataRequest> = {
                        object: IMPORT_JOB_OBJECT,
                        // [#16337] Canonical QueryAST, not the wire dialect this
                        // literal used to speak (`$filter` / `$orderby` / `$top` /
                        // `$skip`). The normalizer folds those onto exactly these
                        // keys and the record sort form onto exactly this node
                        // list, so the option bag reaching `engine.find` is
                        // unchanged — pinned in `rest-server-canonical-query-ast.test.ts`.
                        query: {
                            object: IMPORT_JOB_OBJECT,
                            where: filter,
                            orderBy: [{ field: 'created_at', order: 'desc' }],
                            limit,
                            offset,
                        },
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const r: any = await p.findData(jobsListRequest);
                    const rows = Array.isArray(r?.records) ? r.records
                        : Array.isArray(r?.data) ? r.data
                            : Array.isArray(r?.rows) ? r.rows
                                : Array.isArray(r) ? r : [];
                    res.json({ jobs: rows.map(importJobToSummary) });
                } catch (error: any) {
                    handleRouteError(res, error, '');
                }
            },
            metadata: { summary: 'List import jobs (history)', tags: ['data', 'import'] },
        });

        // GET /data/:object/export  — streaming export (M10.21 / C.21)
        //
        // Query params:
        //   format=csv|json|xlsx (default: csv. json emits a JSON array, xlsx a workbook.)
        //   fields=a,b,c        (default: derive from object schema; falls back to keys of the first row)
        //   filter=<json>       ($filter as URL-encoded JSON, same shape as list endpoint)
        //   search=<term>       (full-text term, same semantics as the list endpoint's
        //                        $search; composes with `filter` rather than replacing it)
        //   searchFields=a,b    (optional ADR-0061 override for which fields `search` scans)
        //   orderby=field:desc  (optional ordering, mirrors $orderby semantics)
        //   header=false        (omit the header row for csv / xlsx; default true)
        //   limit=<n>           (default 10000, hard cap 50000)
        //   page=<n>            (driver chunk size, default 500, max 5000)
        //   template=true       (an xlsx IMPORT template instead of the data — see
        //                        `answerImportTemplate`; `false` or absent is the export)
        //
        // Values are formatted for readability from the object schema: lookup /
        // user fields resolve to a name (via injected $expand), select fields to
        // their option label, booleans to 是/否, dates to YYYY-MM-DD. When the
        // schema is unavailable the raw stored values stream through unchanged.
        //
        // [#8373] `datetime` cells render in the caller's BUSINESS timezone
        // (`ExecutionContext.timezone`), so the file agrees with the screen;
        // with no timezone resolved they render in UTC, as they always did.
        // `date` stays a timezone-naive calendar day (ADR-0053).
        //
        // A zero-row result still emits the header row when the column set is
        // authoritative (the security service's readable projection, or an explicit
        // `fields=`). The import template is `template=true`, not this. Without a
        // projection it stays headerless, so FLS-hidden column names never leak.
        //
        // Streams the response so 50k-row exports do not buffer in memory; the
        // xlsx path pipes exceljs' streaming writer straight onto the response.
        // Filename suggests `${objectLabel}-${YYYYMMDD}-${HHMMSS}.${ext}` for
        // browsers (localized label via RFC 5987 `filename*`, ASCII fallback
        // from the API name — see exportContentDisposition).
        //
        // xlsx only: select / radio cells are coloured with their option's
        // `color` as the font colour (white cell background) when the effective
        // limit is <= 10000. Larger exports drop styling for performance and set
        // `X-Export-Styles: dropped` (else `applied`); csv / json are unaffected.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/:object/export`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const objectName = String(req.params.object || '');
                    if (!objectName) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'object is required' });
                        return;
                    }
                    // [#20896] Which door's gates judge the request is decided by
                    // what the caller ASKED for: `template=true` asks for the
                    // import template, which the IMPORT door's gates judge (see
                    // `enforceImportTemplateGates`); everything else is the
                    // export, judged exactly as before. Only the `template`
                    // value is read here, so a template request that also names
                    // a row parameter is still one — and is refused 400 below,
                    // after these gates, as it was after the export's.
                    if (readTemplateMode({ template: req.query?.template }).kind === 'template') {
                        if (await this.enforceImportTemplateGates(req, res, p, environmentId, objectName, context)) return;
                    } else {
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'export')) return;
                        // [#3544] …then the USER-level one. The object may expose
                        // export while THIS caller's permission sets deny it.
                        if (await this.enforceExportPermission(req, res, environmentId, objectName, context)) return;
                    }
                    // [#6877] The worst measured outcome on this surface:
                    // `?limit=1&limit=2` → `Number([...])` is `NaN` → `NaN || 0`
                    // is `0` → `Math.max(1, 0)` is `1`, so the caller downloaded
                    // a ONE-ROW export with a 200 and no indication. `?filter=`
                    // was the second: an array passes `typeof … === 'object'`,
                    // so `['{…}','{…}']` was handed to `findData` as the filter.
                    //
                    // `fields` and `searchFields` are NOT listed — both already
                    // read the array arm on purpose (`Array.isArray(q.fields)`
                    // a few lines down), and columns are genuinely a list.
                    // [#7606] Recognition runs BEFORE arity, per the rule stated
                    // in `query-allowlist.ts`: "I do not know this parameter"
                    // outranks "this parameter I do know was supplied twice", so
                    // a request committing both errors is told the more
                    // fundamental one. Both gates answer the SAME envelope here
                    // (nested ADR-0112 `VALIDATION_ERROR`), so composing them
                    // adds no second dialect to this route — the divergence
                    // recorded in #8001 is between the LIST route's
                    // `INVALID_FILTER` and this one, and is left exactly as it
                    // was: `filter` is inside the closed set below, so a
                    // repeated `?filter=` still reaches the multiplicity gate
                    // and still answers what it answered before.
                    if (refuseUnknownQueryParams(req, res, DATA_EXPORT_PARAMS)) return;
                    if (refuseRepeatedQueryParams(req, res,
                        ['format', 'header', 'limit', 'page', 'filter', 'search', 'orderby', 'template'])) return;
                    const q = req.query ?? {};
                    // [#18386] `?template=true` answers the import template and
                    // returns before a single export header is set, so without it
                    // everything below runs exactly as it did before the mode
                    // existed.
                    const templateMode = readTemplateMode(q);
                    if (templateMode.kind === 'refused') {
                        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: templateMode.message } });
                        return;
                    }
                    if (templateMode.kind === 'template') {
                        await this.answerImportTemplate(req, res, p, environmentId, objectName, context, q);
                        return;
                    }
                    const fmtRaw = String(q.format ?? 'csv').toLowerCase();
                    const format: 'csv' | 'json' | 'xlsx' =
                        fmtRaw === 'json' ? 'json' : fmtRaw === 'xlsx' ? 'xlsx' : 'csv';
                    // Header row toggle (csv / xlsx). Default on; `header=false` omits it.
                    const includeHeader = String(q.header ?? 'true').toLowerCase() !== 'false';
                    const HARD_CAP = 50_000;
                    const MAX_CHUNK = 5_000;
                    // Styled xlsx (per-cell font colour from select options) is far
                    // heavier than a bare value dump, so cap it well below HARD_CAP;
                    // above this the export still succeeds, just without colours.
                    const STYLE_ROW_CAP = 10_000;
                    // [#20062] Read, not coerced: `?limit=abc` (and `?limit=`) used to
                    // become `Number(…) || 0` → `Math.max(1, 0)` → a ONE-row export
                    // answered `200`. No request schema is declared for this door, so
                    // the reading is "a whole number"; the floor and the cap below
                    // are this door's own and are unchanged.
                    const limitParam = readDeclaredQueryNumber(q, 'limit',
                        UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: false });
                    const requestedLimit = limitParam !== undefined ? Math.max(1, limitParam) : 10_000;
                    const limit = Math.min(requestedLimit, HARD_CAP);
                    // [#20139] Deliberately NOT read through `readDeclaredQueryNumber`
                    // — the one ledgered exemption of the family's census
                    // (`rest-server-query-number-census.test.ts`, which also pins
                    // why). `page` sets only the CHUNK size of the `findData` loop
                    // below: whatever it holds, readable or not, the export streams
                    // the same rows in the same order, so no value of it can widen or
                    // substitute the answer, and refusing one would turn a correct
                    // export into a `400`.
                    const chunkSize = Math.min(MAX_CHUNK, Math.max(50, q.page != null ? Number(q.page) || 500 : 500));
                    // Colour cells only for xlsx within the style cap; decided up
                    // front (before streaming) since we can't know the true row
                    // count until the stream drains.
                    const styled = format === 'xlsx' && limit <= STYLE_ROW_CAP;

                    let filter: any = undefined;
                    if (typeof q.filter === 'string' && q.filter.length > 0) {
                        try { filter = JSON.parse(q.filter); }
                        catch {
                            res.status(400).json({ code: 'INVALID_FILTER', error: 'filter must be JSON' });
                            return;
                        }
                    } else if (q.filter && typeof q.filter === 'object') {
                        filter = q.filter;
                    }

                    // Full-text term, same semantics as the list endpoint's `$search`.
                    // Without it this route could only ever mirror the FILTER half of a
                    // list, so a user who searched and then exported downloaded the
                    // unsearched superset — more rows than the screen showed, with
                    // nothing to indicate it. `$search` composes with `$filter` inside
                    // `findData`, so both halves apply.
                    const search = typeof q.search === 'string' && q.search.trim().length > 0
                        ? q.search.trim()
                        : undefined;
                    // ADR-0061 override for which fields the term scans. Only meaningful
                    // alongside `search`; ignored on its own, exactly as in findData.
                    let searchFields: string[] | undefined;
                    if (typeof q.searchFields === 'string' && q.searchFields.length > 0) {
                        searchFields = q.searchFields.split(',').map((s: string) => s.trim()).filter(Boolean);
                    } else if (Array.isArray(q.searchFields)) {
                        searchFields = q.searchFields.filter((s: any) => typeof s === 'string' && s.length > 0);
                    }
                    if (searchFields && searchFields.length === 0) searchFields = undefined;

                    let orderby: any = undefined;
                    if (typeof q.orderby === 'string' && q.orderby.length > 0) {
                        // Accept "field:dir,field2:dir" shorthand or a JSON object.
                        if (q.orderby.startsWith('{') || q.orderby.startsWith('[')) {
                            // [#4181] Same rule as `filter` two blocks up: a sort
                            // the server cannot parse is refused, not dropped.
                            // Lower stakes than a dropped filter (the row SET is
                            // unchanged, only its order), but a caller taking
                            // "latest N" via orderby+top silently got an
                            // arbitrary N.
                            try {
                                orderby = JSON.parse(q.orderby);
                            } catch {
                                res.status(400).json({ code: 'INVALID_REQUEST', error: 'orderby must be JSON' });
                                return;
                            }
                        } else {
                            const obj: Record<string, 'asc' | 'desc'> = {};
                            for (const part of q.orderby.split(',')) {
                                const [field, dir] = part.split(':').map((s: string) => s.trim());
                                if (field) obj[field] = dir?.toLowerCase() === 'desc' ? 'desc' : 'asc';
                            }
                            if (Object.keys(obj).length > 0) orderby = obj;
                        }
                    }

                    // Resolve fields: explicit param > schema fields > derived from first row.
                    let fields: string[] | undefined;
                    // Whether `fields` (the export columns) were derived from the object
                    // schema rather than an explicit `?fields=` request. Only schema-derived
                    // headers are narrowed to the FLS-readable set (#3391); an explicit
                    // request is honored as asked (values still masked to empty).
                    let fieldsFromSchema = false;
                    if (typeof q.fields === 'string' && q.fields.length > 0) {
                        fields = q.fields.split(',').map((s: string) => s.trim()).filter(Boolean);
                    } else if (Array.isArray(q.fields)) {
                        fields = q.fields.filter((s: any) => typeof s === 'string' && s.length > 0);
                    }

                    // Field metadata drives readable formatting (lookup names, select
                    // labels, 是/否, formatted dates) and the $expand that resolves
                    // references. Best-effort: when the schema is unavailable the export
                    // falls back to raw values, byte-identical to the un-formatted path.
                    let metaMap = new Map<string, ExportFieldMeta>();
                    // Localized object display label (e.g. 合同) — drives the
                    // suggested download filename below.
                    let objectLabel: string | undefined;
                    try {
                        // Field metadata comes from the same place `findData` resolves
                        // the object: `getMetaItem` is registry-first (DB fallback), so
                        // it returns the live `ObjectSchema` whose `fields` is an object
                        // map. The read hands back the envelope `{ type, name, item }`
                        // — one shape, unconditionally, since #5563 — so the schema
                        // document is read straight off `.item`. Legacy
                        // `getObjectSchema` is consulted as a last resort so existing
                        // test doubles keep working.
                        let schema: any = undefined;
                        if (typeof (p as any).getMetaItem === 'function') {
                            const res: any = await (p as any).getMetaItem({ type: 'object', name: objectName });
                            schema = res?.item;
                        }
                        if (!schema && typeof (p as any).getObjectSchema === 'function') {
                            schema = await (p as any).getObjectSchema(objectName, environmentId);
                        }
                        // Localize field labels to the request locale (Accept-Language /
                        // `?locale=`) the same way the metadata endpoints do, so the
                        // export header row matches the UI column headers instead of
                        // leaking the raw, untranslated `field.label` values.
                        schema = await this.translateMetaItem(req, 'object', environmentId, schema);
                        if (typeof schema?.label === 'string' && schema.label.length > 0) {
                            objectLabel = schema.label;
                        }
                        metaMap = buildFieldMetaMap(schema);
                        if (!fields || fields.length === 0) {
                            const names = [...metaMap.keys()];
                            if (names.length > 0) { fields = names; fieldsFromSchema = true; }
                        }
                    } catch { /* fall back to first-row derivation + raw values */ }

                    // Expand reference fields so lookup/user ids resolve to their record
                    // (and thus a name). Batched $in inside findData — no N+1.
                    const expandFields = referenceFieldNames(metaMap);

                    // [#8373] The clock every `datetime` cell below renders in.
                    // The business timezone is ALREADY on the context resolved
                    // at the top of this handler (`resolveLocalizationContext`'s
                    // platform-default → global → tenant cascade, assembled onto
                    // `ExecutionContext.timezone`) — the export formatter simply
                    // never asked for it, so every date/datetime column streamed
                    // UTC while the UI rendered the business zone. `undefined`
                    // keeps the historical UTC rendering, byte for byte.
                    const timezone = typeof (context as any)?.timezone === 'string' && (context as any).timezone
                        ? String((context as any).timezone)
                        : undefined;

                    // [#3547] Column projection ≡ list's field-level security — the
                    // LONG-TERM correct path. Ask the security service which fields the
                    // caller may READ under this context (the SAME field mask the read
                    // middleware applies, so it can never drift) and narrow the
                    // schema-derived header to that set BEFORE streaming. This replaces
                    // inferring readability from the first masked data chunk (#3498): it
                    // is immune to an all-readable-but-all-null column (which a driver may
                    // omit from every row) and to an empty result set (which left the
                    // masked-row inference with nothing to narrow). Explicit `?fields=`
                    // requests are honored as asked (fieldsFromSchema=false → untouched;
                    // values still masked to empty by the read path). When no security
                    // service is reachable (no plugin-security / single-kernel without a
                    // provider) the per-chunk masked-row inference below remains as the
                    // fallback, so there is zero regression.
                    let readableProjected = false;
                    if (fieldsFromSchema && fields && fields.length > 0) {
                        try {
                            const security = await this.resolveSecurityService(environmentId, req);
                            if (security && typeof security.getReadableFields === 'function') {
                                const readable = await security.getReadableFields(objectName, context);
                                if (Array.isArray(readable)) {
                                    const readableSet = new Set(readable);
                                    fields = fields.filter((f) => readableSet.has(f));
                                    readableProjected = true;
                                }
                            }
                        } catch { /* fall back to the masked-row inference below */ }
                    }

                    // Prepare streaming response. Set headers BEFORE first write.
                    if (format === 'csv') {
                        res.header('Content-Type', 'text/csv; charset=utf-8');
                    } else if (format === 'xlsx') {
                        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    } else {
                        res.header('Content-Type', 'application/json; charset=utf-8');
                    }
                    // [#8484] Same `timezone` the cells below render in — the
                    // filename's stamp and the file's contents must not read
                    // two different clocks. `undefined` keeps the historical
                    // process-local stamp (NOT UTC — see the function's doc).
                    res.header('Content-Disposition', exportContentDisposition(objectName, objectLabel, format, timezone));
                    res.header('X-Export-Format', format);
                    res.header('X-Export-Limit', String(limit));
                    // Signal whether select-option colours were applied. Only
                    // meaningful for xlsx; 'dropped' means the limit exceeded the
                    // style cap so the workbook is colourless but complete.
                    if (format === 'xlsx') res.header('X-Export-Styles', styled ? 'applied' : 'dropped');
                    res.header('Cache-Control', 'no-store');

                    let exported = 0;
                    let firstChunk = true;
                    let skip = 0;
                    if (format === 'json') res.write('[');
                    const xlsx = format === 'xlsx' ? await createXlsxStream(res, styled) : null;

                    while (exported < limit) {
                        const take = Math.min(chunkSize, limit - exported);
                        const findArgs: ServerScopedDataRequest<FindDataRequest> = {
                            object: objectName,
                            // [#16337] Canonical QueryAST. `expand` is spelled as
                            // the relation map the AST declares rather than as the
                            // comma list `$expand` accepted: the normalizer lowers
                            // that list to `{name: {object: name}}`, which is what
                            // this builds directly — same map, one fewer dialect.
                            // (The nested `object` naming the RELATION rather than
                            // its target is the normalizer's own lowering, kept
                            // byte-identical here on purpose.)
                            query: {
                                object: objectName,
                                ...(filter ? { where: filter } : {}),
                                ...(search ? { search } : {}),
                                ...(search && searchFields ? { searchFields } : {}),
                                ...(orderby ? { orderBy: orderby } : {}),
                                ...(expandFields.length > 0
                                    ? {
                                        expand: Object.fromEntries(
                                            expandFields.map((rel): [string, { object: string }] => [rel, { object: rel }]),
                                        ),
                                    }
                                    : {}),
                                limit: take,
                                offset: skip,
                            },
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result: any = await p.findData(findArgs);
                        // `findData` returns `{ object, records, total, hasMore }`;
                        // accept the legacy `data` / `rows` aliases and a bare array
                        // so test doubles and alternate protocols keep working.
                        const rows: any[] = Array.isArray(result?.records) ? result.records
                            : Array.isArray(result?.data) ? result.data
                                : Array.isArray(result?.rows) ? result.rows
                                    : Array.isArray(result) ? result : [];

                        if (rows.length === 0) break;

                        // Derive fields from the first row if schema lookup failed.
                        if ((!fields || fields.length === 0) && firstChunk) {
                            fields = Object.keys(rows[0] ?? {});
                        }

                        // [#3391] Column projection ≡ list's field-level security —
                        // FALLBACK path when the #3547 security-service projection above
                        // was unavailable (`!readableProjected`). The read middleware
                        // (FieldMasker) DELETES unreadable keys from each row, so a
                        // schema-derived header would still leak the *names* of FLS-hidden
                        // columns as empty cells. Narrow the schema-derived header to the
                        // keys actually present across the first masked chunk (their ∩
                        // with schema fields is implicit — `fields` already came from
                        // `metaMap.keys()`), so export headers match list's readable
                        // columns. Explicit `?fields=` requests are left untouched (values
                        // still masked to empty, as with list `$select`); a fully empty
                        // first chunk leaves the header as-is (same as today — no worse).
                        if (!readableProjected && fieldsFromSchema && firstChunk && fields && fields.length > 0) {
                            const readable = new Set<string>();
                            for (const row of rows) {
                                if (row && typeof row === 'object') {
                                    for (const k of Object.keys(row)) readable.add(k);
                                }
                            }
                            if (readable.size > 0) {
                                fields = fields.filter((f) => readable.has(f));
                            }
                        }

                        if (format === 'csv') {
                            const text = rowsToCsv(fields ?? [], rows, firstChunk && includeHeader, metaMap, timezone);
                            res.write(text);
                        } else if (format === 'xlsx') {
                            if (firstChunk && includeHeader) {
                                xlsx!.ws.addRow((fields ?? []).map((f) => headerLabel(f, metaMap))).commit();
                            }
                            const cols = fields ?? [];
                            for (const row of rows) {
                                const r = xlsx!.ws.addRow(formatRowCells(row, cols, metaMap, timezone));
                                if (styled) {
                                    cols.forEach((f, i) => {
                                        const argb = cellFontColor(row?.[f], metaMap.get(f));
                                        if (argb) r.getCell(i + 1).font = { color: { argb } };
                                    });
                                }
                                r.commit();
                            }
                        } else {
                            for (let i = 0; i < rows.length; i++) {
                                const prefix = (firstChunk && i === 0) ? '' : ',';
                                res.write(prefix + JSON.stringify(formatRowForJson(rows[i], metaMap, timezone)));
                            }
                        }
                        firstChunk = false;
                        exported += rows.length;
                        skip += rows.length;
                        if (rows.length < take) break;
                    }
                    // [#3547] Zero rows: still emit the header when the column set is
                    // AUTHORITATIVE. "Export columns don't depend on row content" is
                    // only true if it also holds at zero rows — and the readable
                    // projection above is derived from schema + context, so an empty
                    // result has an exact header to write (which also makes an empty
                    // export a usable import template). An explicit `?fields=` is
                    // authoritative for the same reason: the caller named the columns.
                    //
                    // Deliberately NOT emitted when the header is schema-derived and
                    // the projection was unavailable (`fieldsFromSchema &&
                    // !readableProjected`): the masked-row fallback has no rows to
                    // narrow with, so writing the full schema header would name
                    // FLS-hidden columns — precisely the leak #3391 closes. That path
                    // keeps today's headerless empty file.
                    if (
                        firstChunk && includeHeader && fields && fields.length > 0 &&
                        (readableProjected || !fieldsFromSchema)
                    ) {
                        if (format === 'csv') {
                            res.write(rowsToCsv(fields, [], true, metaMap));
                        } else if (format === 'xlsx') {
                            xlsx!.ws.addRow(fields.map((f) => headerLabel(f, metaMap))).commit();
                        }
                        // json has no header concept — the empty array is already correct.
                    }

                    if (format === 'json') {
                        res.write(']');
                        res.end();
                    } else if (format === 'xlsx') {
                        await xlsx!.finalize();
                    } else {
                        res.end();
                    }
                } catch (error: any) {
                    // Best-effort error envelope; if headers already sent the
                    // client receives a truncated stream which signals failure.
                    try { handleRouteError(res, error, String(req.params?.object || '')); }
                    catch { try { res.end(); } catch { /* swallow */ } }
                }
            },
            metadata: {
                summary: 'Streaming export of object rows (CSV, JSON, or XLSX)',
                tags: ['data', 'export'],
            },
        });
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
        const isScoped = basePath.includes('/environments/:environmentId');
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/search`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const searchAll = (p as any).searchAll;
                    if (typeof searchAll !== 'function') {
                        res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Search not supported by this protocol' });
                        return;
                    }
                    // [#6877] `String(['a','b'])` searched for the literal
                    // term `'a,b'`. `objects` is NOT listed: the next line reads
                    // its array arm deliberately — a cross-object search over a
                    // LIST of objects is the whole point of the parameter.
                    // [#7606] Recognition before arity, same order and same
                    // envelope as the export route — see `query-allowlist.ts`.
                    // A dropped `?objects=` is the widening case at its worst:
                    // the term fans out across every searchable object while the
                    // caller believes they scoped it to one.
                    if (refuseUnknownQueryParams(req, res, GLOBAL_SEARCH_PARAMS)) return;
                    if (refuseRepeatedQueryParams(req, res, ['q', 'query', 'limit', 'perObject'])) return;
                    const q = String(req.query?.q ?? req.query?.query ?? '');
                    const objectsParam = req.query?.objects;
                    const objects = typeof objectsParam === 'string'
                        ? objectsParam.split(',').map((s: string) => s.trim()).filter(Boolean)
                        : Array.isArray(objectsParam) ? objectsParam : undefined;
                    // [#20062] Read, not coerced: `?limit=abc` used to reach
                    // `searchAll` as `NaN`, and `hits.length >= NaN` is never true,
                    // so the overall cap was silently gone. No request schema is
                    // declared for this door, so the reading is "a whole number";
                    // `searchAll`'s own `[1, 100]` clamp is unchanged, and an empty
                    // `?limit=` stays absent as the old falsy guard had it.
                    const limit = readDeclaredQueryNumber(req.query, 'limit',
                        UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: true });
                    // [#20139] `perObject`, the same way: `?perObject=abc` reached
                    // `searchAll` as `NaN`, its `Math.max(1, Math.min(25, NaN))` is
                    // `NaN`, and the per-object cap was silently gone. Whole number;
                    // the `[1, 25]` clamp stays `searchAll`'s own, and an empty
                    // `?perObject=` stays absent as the old falsy guard had it.
                    const perObject = readDeclaredQueryNumber(req.query, 'perObject',
                        UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: true });
                    const result = await searchAll.call(p, {
                        q,
                        objects,
                        limit,
                        perObject,
                        ...(context ? { context } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    const mapped = mapDataError(error);
                    logUnexpectedRouteError(error, mapped);
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Global cross-object search',
                tags: ['search'],
            },
        });
    }

    /**
     * Register email endpoints (M11.B1 / M10.7).
     *
     * POST {basePath}/email/send — send a transactional email via the
     * `IEmailService` provider registered by EmailServicePlugin. Returns
     * 501 when no provider is wired so deployments without email
     * configured fail cleanly.
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
        const isScoped = basePath.includes('/environments/:environmentId');
        this.routeManager.register({
            method: 'POST',
            path: `${basePath}/email/send`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;

                    if (!this.emailServiceProvider) {
                        res.status(501).json({
                            code: 'NOT_IMPLEMENTED',
                            message: 'Email service is not configured on this deployment',
                        });
                        return;
                    }
                    // [#15405] `seamOrUndefined`, not the retired
                    // `.catch(() => undefined)`. That handler attaches to the
                    // promise the call RETURNS, so it can only ever see a
                    // REJECTION: a host wiring a non-`async` provider — which
                    // the seam's declared type cannot prevent, and
                    // `RestServer`'s constructor is the public wiring point —
                    // throws while the expression is still being evaluated, so
                    // there is no promise to attach to and the handler is never
                    // reached (commit add6a1b1c).
                    //
                    // ⚠️ NOT reachable from the SHIPPED wiring: the provider
                    // `rest-api-plugin.ts` hands over is declared `async`.
                    // Repaired because it is the same retired spelling at an
                    // embedder-reachable seam, ⛔ not on a claim of live impact.
                    //
                    // The ANSWER is deliberately unchanged — absorb to
                    // `undefined` and take the 501 below. ⛔ Unlike the engine
                    // seam, this one must NOT go loud: the
                    // `if (!this.emailServiceProvider)` guard above has already
                    // answered the wiring question, and "not configured" and
                    // "configured and unusable" both mean this deployment cannot
                    // send mail — one 501, no fact lost by folding them.
                    const emailService = await seamOrUndefined(() => this.emailServiceProvider!(environmentId));
                    if (!emailService || typeof emailService.send !== 'function') {
                        res.status(501).json({
                            code: 'NOT_IMPLEMENTED',
                            message: 'Email service is not configured on this deployment',
                        });
                        return;
                    }

                    const body = req.body ?? {};
                    if (!body || typeof body !== 'object') {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'JSON body required' });
                        return;
                    }
                    // Stamp sentBy from the authenticated context when caller didn't supply one.
                    const input = {
                        ...body,
                        ...(body.sentBy === undefined && (context as any)?.userId
                            ? { sentBy: (context as any).userId }
                            : {}),
                    };

                    try {
                        const result = await emailService.send(input);
                        if (result?.status === 'sent') {
                            res.status(200).json(result);
                        } else {
                            // failed / queued — still surface to client with 200 so clients can branch on status.
                            res.status(200).json(result);
                        }
                    } catch (err: any) {
                        // Validation errors from normalizeMessage are surfaced as 400.
                        const message = String(err?.message ?? err ?? 'send failed');
                        if (message.startsWith('VALIDATION_FAILED')) {
                            res.status(400).json({
                                code: 'VALIDATION_FAILED',
                                error: message.replace(/^VALIDATION_FAILED:\s*/, ''),
                            });
                            return;
                        }
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Email send unhandled error:', error);
                    res.status(500).json({
                        code: 'EMAIL_SEND_FAILED',
                        error: String(error?.message ?? error ?? 'send failed').slice(0, 500),
                    });
                }
            },
            metadata: {
                summary: 'Send a transactional email via the configured EmailService',
                tags: ['email'],
            },
        });
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
     * The object schemas an anonymous form request reads, in the organization
     * the form itself was resolved in (#21331). They carry the columns the
     * registry injects, `organization_id` among them.
     */
    private async readFormObjectDefinitions(
        p: RestProtocol,
        environmentId: string | undefined,
        organizationId: string | undefined,
    ): Promise<any[]> {
        const objectsRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
            type: 'object',
            ...(environmentId ? { environmentId } : {}),
            ...(organizationId ? { organizationId } : {}),
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
        const readObjects = (): Promise<any[]> => (objects ??= anonymousFormOrganization(tenancy)
            .then((organizationId) => this.readFormObjectDefinitions(p, environmentId, organizationId)));
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
     *   POST {basePath}/forms/:slug/submit   → INSERT record (no auth required)
     *
     * Both routes bypass `enforceAuth` even though anonymous-deny is on for the
     * deployment (e.g. ObjectOS multi-tenant). Security is delegated to the
     * `guest_portal` permission set carried on the execution context — the
     * SecurityPlugin enforces INSERT-only access to the target object. If
     * the deployment hasn't registered a `guest_portal` profile, the
     * security middleware falls open with `permissions: []` (no userId),
     * matching the existing anonymous-access semantics; deployers must
     * keep secure-by-default deployments paired with a `guest_portal`
     * profile (the CRM example does this) to enforce the INSERT-only
     * contract.
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
        const isScoped = basePath.includes('/environments/:environmentId');

        // Which form candidates are open to anonymous intake is ONE rule,
        // shared with the write-time judgement in `@objectstack/metadata-protocol`
        // (`anonymousFormIntakeCandidates`): `sharing.enabled === true`,
        // `sharing.allowAnonymous === true` and a `publicLink` naming the slug.
        //
        // A withdrawal is a kill switch: layering may only narrow anonymous
        // intake, never re-open it. A candidate is served only when no layer
        // beneath the read it is found in explicitly withdraws the same form
        // (`anonymousFormIntakeWithdrawnIn`: the same view name, matched by
        // slot or by slug, the link kept with a switch set to `false`).
        // Another view publishing the same slug is a different form and closes
        // nothing.
        const findPublicFormView = (
            views: any[],
            slug: string,
            layers: ReadonlyArray<ReadonlyArray<unknown>>,
        ): { view: any; form: any; object: string } | null => {
            for (const view of views ?? []) {
                if (!view || typeof view !== 'object') continue;
                for (const c of anonymousFormIntakeCandidates(view)) {
                    if (c.slug !== slug) continue;
                    if (layers.some((layer) => anonymousFormIntakeWithdrawnIn(layer, view, c))) continue;
                    const objectName = anonymousFormObjectName(view, c.form);
                    if (!objectName) continue;
                    return { view, form: c.form, object: objectName };
                }
            }
            return null;
        };

        // [#21331] WHICH organization's metadata an anonymous form request
        // reads. A public-form request carries no session, so it carries no
        // active organization, and `getMetaItems` without one merges only the
        // env-wide overlays. An administrator's edit of a packaged form is
        // saved as an overlay of THEIR organization, so that read missed every
        // such edit, including the one that withdraws the form from anonymous
        // intake. The editor showed the form closed while both doors kept
        // serving and accepting it.
        //
        // The answer is the tenancy service's `defaultOrgId()`: the
        // organization a single-posture deployment binds every principal to.
        // It is the organization the administrator's own session is in, and
        // the one the engine stamps on the row this request inserts. It is
        // `undefined` in two cases. Before any organization exists, no
        // organization overlay can exist either. A walled posture has no
        // install organization for an org-less request, so the env-wide state
        // governs there exactly as before.
        //
        // Asked ONCE per request, in `resolveFormBySlug`. Every door below
        // reads the form through that one resolution, so no door keeps its
        // own copy of "is this form public" — nor, since #21476, of "can it
        // take intake on this posture", which the same tenancy read answers.
        //
        // Fails CLOSED. A tenancy service that is registered but cannot be
        // reached raises `AuthzStoreUnavailableError`, the classification
        // `classifyAdmissionTenancyPosture` applies to the same seam. The
        // door then refuses instead of falling back to the env-wide read.
        // Only the registry's own "never registered" brand reads as the
        // supported no-tenancy composition. The wiring mirrors
        // `resolveProtocol`, so the tenancy service and the protocol always
        // come from the same kernel.
        const resolveFormBySlug = async (
            environmentId: string | undefined,
            req: any,
            slug: string,
        ): Promise<{ view: any; form: any; object: string; organizationId: string | undefined } | null> => {
            const p = await this.resolveProtocol(environmentId, req);
            if (typeof (p as any).getMetaItems !== 'function') return null;
            const tenancy = await this.resolveAnonymousFormTenancy(environmentId, req);
            const organizationId = await anonymousFormOrganization(tenancy);
            const viewsRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                type: 'view',
                ...(environmentId ? { environmentId } : {}),
                ...(organizationId ? { organizationId } : {}),
            };
            const listOf = (result: any): any[] => (Array.isArray(result?.items)
                ? result.items
                : Array.isArray(result)
                    ? result
                    : []);
            const items = listOf(await p.getMetaItems(viewsRequest));
            // The organization read prefers the organization's overlay of a
            // view over the env-wide one, so on its own it cannot see an
            // env-wide withdrawal that overlay disagrees with. Read the
            // env-wide layer too, and let its withdrawal of the same form close
            // it: an organization overlay can narrow intake, never re-open it.
            // (The read the form is found in holds only that view's own body,
            // which is open, so it withdraws nothing of its own.)
            const layers: any[][] = [];
            if (organizationId) {
                const envWideRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                    type: 'view',
                    ...(environmentId ? { environmentId } : {}),
                };
                layers.push(listOf(await p.getMetaItems(envWideRequest)));
            }
            const match = findPublicFormView(items, slug, layers);
            if (!match) return null;
            // [#21476] A form that cannot take intake on this posture is not
            // offered: `null` here IS the withdrawn form's answer on both
            // doors, so an anonymous caller learns nothing about the tenancy.
            const unavailable = await anonymousFormIntakeUnavailability(
                match.object,
                anonymousFormIntakePosture(tenancy),
                async () => (await this.readFormObjectDefinitions(p, environmentId, organizationId))
                    .find((o: any) => o?.name === match.object),
            );
            return unavailable ? null : { ...match, organizationId };
        };

        // GET /forms/:slug — resolve and return the public form spec
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/forms/:slug`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const slug = String(req.params?.slug ?? '').trim();
                    if (!slug) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'slug is required' });
                        return;
                    }
                    const match = await resolveFormBySlug(environmentId, req, slug);
                    if (!match) {
                        res.status(404).json({
                            code: 'FORM_NOT_FOUND',
                            error: `No public form configured at /forms/${slug}`,
                        });
                        return;
                    }
                    // Embed the target object's schema — limited to exactly the
                    // fields the form's sections DECLARE — so anonymous
                    // front-ends can render the form without a separate,
                    // auth-protected meta lookup.
                    //
                    // [#6601] "Exactly" is load-bearing and used not to be. The
                    // narrowing read `allowed.size === 0 || allowed.has(name)`,
                    // so a form with no sections (or sections declaring no
                    // fields) fell through to EVERY non-server-managed field of
                    // the object — published to an ANONYMOUS caller, with
                    // labels, types, picklist option values and formula
                    // expressions. A form created before its sections are wired
                    // is an ordinary authoring mid-state, so that was reachable
                    // without an exotic configuration, and this comment claimed
                    // the opposite. Publication is a DECLARATION now: declare no
                    // fields and nothing is published (AGENTS.md "Explicit
                    // composition over default magic").
                    //
                    // Do NOT reach for the submit handler as the backstop here.
                    // It enforces a field whitelist on WRITES, which cannot
                    // bound a READ disclosure — and when #6601 landed, its own
                    // accepted set still degenerated identically for a
                    // section-less form (`allowedFields.size === 0 ||`), so
                    // narrowing this schema to "what submit would accept" would
                    // have republished precisely the set being removed. #6920
                    // has since closed that write-side twin, so the two planes
                    // now agree — but they agree by each enforcing the
                    // declaration itself, NOT by one deferring to the other.
                    let objectSchema: any = null;
                    try {
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).getMetaItems === 'function') {
                            // [#21331] The same organization the form itself
                            // was resolved in, so the published field schema
                            // matches the form the caller was served.
                            const objectsRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                                type: 'object',
                                ...(environmentId ? { environmentId } : {}),
                                ...(match.organizationId ? { organizationId: match.organizationId } : {}),
                            };
                            const r: any = await p.getMetaItems(objectsRequest);
                            const items: any[] = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
                            const obj = items.find((o: any) => o?.name === match.object);
                            if (obj && obj.fields && typeof obj.fields === 'object') {
                                const allowed = new Set<string>();
                                for (const sec of match.form?.sections ?? []) {
                                    for (const f of sec?.fields ?? []) {
                                        if (typeof f === 'string') allowed.add(f);
                                        else if (f?.field) allowed.add(f.field);
                                    }
                                }
                                const fields: Record<string, any> = {};
                                for (const [name, def] of Object.entries(obj.fields)) {
                                    // [#3022] Server-managed anchors are never
                                    // renderable/writable on the anonymous form
                                    // surface — the submit route refuses them, so
                                    // don't advertise them here even when a form
                                    // (mis)declares one in a section.
                                    if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(name)) continue;
                                    // [#6601] Declared or not published. An empty
                                    // `allowed` yields an empty `fields`.
                                    if (!allowed.has(name)) continue;
                                    fields[name] = def;
                                }
                                objectSchema = { name: obj.name, label: obj.label, fields };
                                // Localize labels / help text / option labels so anonymous
                                // clients render in the visitor's preferred language. The
                                // form payload is otherwise un-translated (resolveFormBySlug
                                // returns the raw view spec), so we hydrate the schema here.
                                try {
                                    const i18n = await this.resolveI18nService(environmentId, req);
                                    const bundle = this.buildTranslationBundle(i18n);
                                    const locale = this.extractLocale(req, i18n);
                                    if (bundle && locale) {
                                        const { translateMetadataDocument } = await import('@objectstack/spec/system');
                                        // [#8284] Same rule as the two `/meta/object`
                                        // reads: the catalog yields to a scalar the
                                        // package's own extension or the tenant
                                        // authored. The public form must not be the
                                        // one surface still serving the packaged
                                        // string back at a tenant who renamed it.
                                        objectSchema = translateMetadataDocument('object', objectSchema, bundle, {
                                            ...RestServer.translateOptionsFor(i18n, locale),
                                            packagedBase: this.packagedObjectBase(p, 'object', objectSchema?.name),
                                        });
                                    }
                                } catch (e: any) {
                                    logError('[REST] Public form schema translation failed:', e);
                                }
                            }
                        }
                    } catch (e: any) {
                        logError('[REST] Public form schema load failed:', e);
                    }
                    // Anonymous public forms NEVER include a lookup, master-detail
                    // or user field. [#21180] This used to be an opt-in — a
                    // per-field picker block on the section entry kept the field
                    // and opened an anonymous record-search route for it. Ruling
                    // E on #21079 (comment 5933054144) retired the picker and
                    // deleted that route, so the strip below is now
                    // unconditional: no declaration can put record search on the
                    // internet through a public form.
                    const safeForm = (() => {
                        if (!match.form || !Array.isArray(match.form.sections)) return match.form;
                        const allow = (name: string): boolean => {
                            // [#3022] A declared server-managed anchor (e.g. a
                            // FormView listing `owner_id`) is a spec mistake —
                            // drop it from the rendered sections so the form
                            // never collects a value the submit route refuses.
                            if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(name)) return false;
                            const def = objectSchema?.fields?.[name];
                            const t = def?.type;
                            // `user` is a lookup specialized to sys_user — same risk as a
                            // raw lookup: surfacing it on an anonymous public form would
                            // expose unrestricted user search to the internet.
                            return t !== 'lookup' && t !== 'master_detail' && t !== 'user';
                        };
                        const sections = match.form.sections.map((sec: any) => {
                            const fields = (sec?.fields ?? []).filter((f: any) => {
                                const name = typeof f === 'string' ? f : f?.field;
                                if (!name) return false;
                                return allow(name);
                            });
                            return { ...sec, fields };
                        });
                        return { ...match.form, sections };
                    })();
                    res.header('Vary', 'Accept-Language');
                    res.json({
                        slug,
                        object: match.object,
                        label: match.view?.label ?? match.form?.label,
                        form: safeForm,
                        objectSchema,
                    });
                } catch (error: any) {
                    logError('[REST] Public form resolve error:', error);
                    res.status(500).json({
                        code: 'FORM_RESOLVE_FAILED',
                        error: String(error?.message ?? error ?? 'resolve failed').slice(0, 500),
                    });
                }
            },
            metadata: {
                summary: 'Resolve a public form spec by slug (anonymous)',
                tags: ['forms', 'public'],
            },
        });

        // POST /forms/:slug/submit — INSERT a record on the target object
        // with the `guest_portal` permission set attached.
        this.routeManager.register({
            method: 'POST',
            path: `${basePath}/forms/:slug/submit`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const slug = String(req.params?.slug ?? '').trim();
                    if (!slug) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'slug is required' });
                        return;
                    }
                    const match = await resolveFormBySlug(environmentId, req, slug);
                    if (!match) {
                        res.status(404).json({
                            code: 'FORM_NOT_FOUND',
                            error: `No public form configured at /forms/${slug}`,
                        });
                        return;
                    }

                    // Only allow the fields declared on the matched FormView.
                    // This prevents a public visitor from stuffing privileged
                    // columns (owner_id, status, internal_notes, …) into the
                    // row. Object hooks (`beforeInsert`) are still responsible
                    // for stamping server-side defaults — see the CRM
                    // `lead.hook.ts` / `case.hook.ts` for the canonical pattern.
                    const allowedFields = new Set<string>();
                    for (const section of match.form?.sections ?? []) {
                        for (const f of section?.fields ?? []) {
                            if (typeof f === 'string') allowedFields.add(f);
                            else if (f?.field) allowedFields.add(f.field);
                        }
                    }
                    // [#6920] A form that declares NO fields collects nothing, so
                    // it has nothing to accept — refuse instead of inserting.
                    //
                    // The filter below used to read
                    // `allowedFields.size === 0 || allowedFields.has(k)`, and that
                    // fall-through was not "accept every field of the object": it
                    // accepted every KEY THE CALLER SENT, minus the anchors and the
                    // three prototype keys — measured as
                    // `["email","internal_margin","internal_tier","not_even_a_field",
                    // "status","subject"]` on a `sections: []` form, `not_even_a_field`
                    // not being a field of the object at all. On an ANONYMOUS surface
                    // that is unbounded mass assignment across the target object, and
                    // the form created-before-its-sections-are-wired mid-state reaches
                    // it without anything exotic.
                    //
                    // Symmetric with #6601 on the read side of the same pair: declare
                    // it or it is not published / not accepted, one rule on both planes
                    // (AGENTS.md "Explicit composition over default magic"). Post-#6601
                    // such a form publishes `fields: {}`, so no legitimate client can
                    // even learn what to send here.
                    //
                    // REFUSAL, not a silent discard: dropping the keys would leave the
                    // `201` intact while swallowing data the caller believes it wrote —
                    // exactly the silence AGENTS.md's warn-vs-error rule forbids. The
                    // author's fix is to wire the sections, so the message says that;
                    // the code is the standard ADR-0112 catalog's generic 400
                    // (`HttpStatusErrorCodeMap[400]`), not a minted synonym, and the
                    // message names no object, field or slug — this reply is readable
                    // by anyone on the internet.
                    //
                    // NOTE the #3022 pin ('zero declared sections: business fields fall
                    // through, anchors do NOT') asserted this fall-through as intended.
                    // Re-judged by maintainer ruling 5229989845 (2026-08-09): the
                    // anchor half is preserved and still pinned; the fall-through half
                    // was the wrong invariant.
                    if (allowedFields.size === 0) {
                        res.status(400).json({
                            code: 'VALIDATION_ERROR',
                            error: 'This form declares no fields, so it cannot accept a submission. '
                                + "Wire the fields it collects into the form's sections and publish it again.",
                        });
                        return;
                    }
                    // [#3022] System-managed anchors (owner_id, organization_id,
                    // audit columns, id, …) are NEVER client-suppliable on this
                    // anonymous surface, even when a FormView explicitly declares
                    // one in a section (the insert-forge of #3004, with no
                    // credentials at all). The SecurityPlugin's publicFormGrant
                    // branch strips the same set at the data layer, so this filter
                    // and the engine boundary cannot drift.
                    const rawBody = (req.body && typeof req.body === 'object') ? req.body : {};
                    const filteredData: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(rawBody)) {
                        if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(k)) continue;
                        // JSON.parse yields `__proto__` as an OWN key; assigning it
                        // here would REPLACE filteredData's prototype and smuggle
                        // inherited anchors past every own-property check downstream.
                        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
                        if (allowedFields.has(k)) filteredData[k] = v;
                    }

                    // ADR-0056 (Option A): authorization DERIVED from the declared
                    // form — a narrow create grant scoped to exactly this form's target
                    // object. The SecurityPlugin honors `publicFormGrant` (create + the
                    // immediate read-back, that object ONLY), so public forms work under
                    // secure-by-default (anonymous-deny) WITHOUT a deployment-configured
                    // `guest_portal`. `guest_portal` + `anonymous` are kept for back-compat
                    // with object hooks (guest detection via falsy `ctx.user?.id`).
                    const context: any = {
                        publicFormGrant: { object: match.object },
                        permissions: ['guest_portal'],
                        anonymous: true,
                    };

                    const p = await this.resolveProtocol(environmentId, req);
                    const formCreateRequest: ServerScopedDataRequest<CreateDataRequest> = {
                        object: match.object,
                        data: filteredData,
                        ...(environmentId ? { environmentId } : {}),
                        context,
                    };
                    const result = await p.createData(formCreateRequest);
                    res.status(201).json(result);
                } catch (error: any) {
                    const mapped = mapDataError(error);
                    // Distinct message (this is not the "unhandled" channel),
                    // same shared verdict — see `isExpectedRouteError`.
                    if (!isExpectedRouteError(mapped.status, mapped.body)) {
                        logError('[REST] Public form submit error:', error);
                    }
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Submit an anonymous public form',
                tags: ['forms', 'public'],
            },
        });
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
        const isScoped = basePath.includes('/environments/:environmentId');
        // Resolve the ENVIRONMENT's analytics service first — its strategy
        // bridges are bound to the env kernel's own data engine. The host
        // provider (whose 'data' is the host kernel's engine) is only a
        // fallback: serving a tenant's dataset query from the host engine
        // reads the WRONG database and silently aggregates over nothing
        // (the staging "Total Spend: 0 on a populated table" incident).
        const resolveService = async (environmentId?: string, req?: any) => {
            try {
                const envId = await this.resolveRequestEnvironmentId(environmentId, req);
                if (envId && envId !== 'platform' && this.kernelManager) {
                    const kernel = await this.kernelManager.getOrCreate(envId);
                    const svc = await kernel.getServiceAsync<any>('analytics').catch(() => undefined);
                    if (svc) return svc;
                }
            } catch { /* fall back to the host service */ }
            if (!this.analyticsServiceProvider) return undefined;
            try { return await this.analyticsServiceProvider(environmentId); }
            catch { return undefined; }
        };

        this.routeManager.register({
            method: 'POST',
            path: `${basePath}/analytics/dataset/query`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;

                    const svc = await resolveService(environmentId, req);
                    if (!svc || typeof svc.queryDataset !== 'function') {
                        return res.status(501).json({
                            code: 'NOT_IMPLEMENTED',
                            message: 'Analytics dataset query is not available on this deployment (no analytics service with queryDataset).',
                        });
                    }

                    const body = req.body ?? {};
                    const selection = body.selection;
                    if (!selection || !Array.isArray(selection.measures) || selection.measures.length === 0) {
                        return res.status(400).json({
                            code: 'VALIDATION_FAILED',
                            message: 'body.selection.measures must be a non-empty array of measure names.',
                        });
                    }

                    // [PR #17548] …and every OTHER member of `selection` had no
                    // door at all, so a malformed one travelled into
                    // `dataset-executor` and was answered by whatever the face
                    // behind it happened to do with it — while the sibling
                    // routes (`/analytics/query`, `/analytics/sql`) lift the
                    // identical failure to a 400 at the entry. One family, two
                    // postures, decided by which door the client knocked on.
                    //
                    // [#17551, ruled] The parse is the WHOLE selection, against
                    // `DatasetSelectionSchema` — the one declaration of this
                    // wire shape, authored in `packages/spec` beside the
                    // sibling routes' own request body. ⛔ Never the siblings'
                    // schema: `selection` is a `DatasetSelection`, which
                    // carries no `cube` and has four members of its own, so
                    // `AnalyticsQueryRequestSchema` would 400 every real
                    // dashboard widget. PR #17548 could only door the seven
                    // members whose declarations coincided; the four that were
                    // left — `runtimeFilter`, `dateGranularity`, `compareTo`,
                    // `totals` — are what this closes. {@link datasetSelectionRefusal}
                    // carries both measurements.
                    //
                    // Validation-only: the caller's `selection` is what reaches
                    // `queryDataset` below, never a parse output.
                    const selectionRefusal = await datasetSelectionRefusal(selection);
                    if (selectionRefusal) {
                        return res.status(selectionRefusal.status).json(selectionRefusal.body);
                    }

                    // ADR-0037 P3 — draft data preview: the canvas / preview
                    // pages pass the flag so (a) the dataset lookup sees
                    // draft-overlaid definitions and (b) the selection runs
                    // over the pending seed draft's rows when one exists.
                    // [#6877] A repeated `?preview=draft&preview=draft` stopped
                    // equalling `'draft'`, so the Studio preview silently ran
                    // over PUBLISHED rows and looked like the draft had no data.
                    if (refuseRepeatedQueryParams(req, res, ['preview'])) return;
                    // [#20338] …for a caller who may read drafts: both halves
                    // serve unpublished work (a draft definition, a pending
                    // seed's rows). Anyone else runs over the published
                    // dataset and live rows, as if the flag were absent — a
                    // draft-only `datasetName` is this door's own 404 —
                    // {@link mayReadPendingDrafts} says why that, and not a refusal.
                    const previewDrafts = (body.previewDrafts === true || req.query?.preview === 'draft')
                        && mayReadPendingDrafts(context);

                    // Resolve the dataset definition: inline draft (Studio
                    // preview) or a saved dataset by name.
                    let dataset = body.dataset;
                    if (!dataset && body.datasetName) {
                        const p = await this.resolveProtocol(environmentId, req);
                        const datasetRequest: GetMetaItemsRequest = { type: 'dataset', previewDrafts };
                        const items: any = await p.getMetaItems?.(datasetRequest).catch(() => null);
                        const list = Array.isArray(items?.items) ? items.items : (Array.isArray(items) ? items : []);
                        dataset = list.find((d: any) => d?.name === body.datasetName);
                        if (!dataset) {
                            return res.status(404).json({ code: 'NOT_FOUND', message: `Dataset "${body.datasetName}" not found.` });
                        }
                        // [#14253] Localize the SAVED definition here, at the
                        // metadata boundary, the same way `/meta/:type` does.
                        //
                        // A dataset's dimension and measure `label`s are drawn
                        // on the dashboard — chart axes, legends, the caption
                        // under a metric tile — and they get there through the
                        // QUERY, not through `/meta/datasets`:
                        // `AnalyticsService` copies `dataset.measures[].label`
                        // onto `AnalyticsResult.fields[].label` ("for
                        // legends/KPIs"). So translating only the metadata read
                        // would have closed the door nobody draws through and
                        // left the one in the issue's screenshot open — the
                        // covered-at-one-door asymmetry this repo keeps paying
                        // for. Translating the DEFINITION carries through the
                        // existing enrichment untouched, so nothing downstream
                        // learns about bundles: the analytics service stays
                        // free of i18n, and there is no second resolution path.
                        //
                        // ⛔ The INLINE branch is deliberately not translated:
                        // a Studio preview posts a draft the designer is
                        // editing, which carries no saved name to address a
                        // bundle entry with, and overwriting a draft's copy
                        // would misreport what the designer is about to save.
                        dataset = await this.translateMetaItem(req, 'dataset', environmentId, dataset);
                    }
                    if (!dataset) {
                        return res.status(400).json({ code: 'VALIDATION_FAILED', message: 'Provide body.dataset (inline) or body.datasetName.' });
                    }

                    // A SERVED document is not a valid input to the schema that
                    // produced it: the read path stamps `_diagnostics` on every
                    // item `getMetaItems` returns, and since #4001
                    // `DatasetSchema` is CLOSED — so the parse below rejected
                    // our OWN annotation with `unrecognized_keys`, answering
                    // 400 "Invalid dataset definition." for every saved dataset,
                    // i.e. every widget on every dataset-bound dashboard. Same
                    // shape as the cold-boot flow bind (cloud#971).
                    //
                    // Stripped on BOTH branches, not just the `datasetName`
                    // read: the Studio dataset preview posts its draft INLINE,
                    // and that draft is the document the designer GET-loaded —
                    // decorations and all. A genuinely hand-authored draft
                    // never carries these keys, so the strip is a no-op there.
                    dataset = stripReadDecorations(dataset);

                    // Validate against the spec schema so a malformed draft
                    // yields a clean 400 instead of a runtime throw.
                    try {
                        const { DatasetSchema } = await import('@objectstack/spec/ui');
                        dataset = (DatasetSchema as any).parse(dataset);
                    } catch (verr: any) {
                        return res.status(400).json({
                            code: 'VALIDATION_FAILED',
                            message: 'Invalid dataset definition.',
                            detail: String(verr?.message ?? verr).slice(0, 1000),
                        });
                    }

                    const result = await svc.queryDataset(
                        dataset,
                        selection,
                        context ?? undefined,
                        previewDrafts ? { previewDrafts: true } : undefined,
                    );
                    res.json(result);
                } catch (error: any) {
                    const msg = String(error?.message ?? error ?? '');
                    // [#11588] The text addressed to the CALLER, which for a
                    // sandboxed hook refusal is the business message rather than
                    // the `hook '<name>' threw: Error: …` QuickJS debug wrapper
                    // sitting on `.message`. This route builds its envelope by
                    // hand and shares no branch with `classifyDataError`'s
                    // unwrap door or with `resolveErrorResponse`'s passthrough,
                    // so it shipped the wrapper on every hook refusal while the
                    // single-row `/data` routes served the author's sentence —
                    // one refusal, two wordings, decided by which face caught it.
                    // {@link sandboxBusinessMessage} is imported rather than
                    // re-derived precisely so a third answer cannot appear here.
                    //
                    // Deliberately scoped to what the CLIENT reads. `logError`
                    // below still receives the whole error, wrapper and all —
                    // that is the half the wrapper was written for. And
                    // `looksLikeInternalErrorLeak` below still reads the RAW
                    // `msg`: feeding it the unwrapped text could only make it
                    // withhold LESS, and a leak predicate must never be handed a
                    // narrower input than the one it was calibrated on.
                    //
                    // Neither arm's STATUS moves. ① keeps answering the declared
                    // 4xx and ③ keeps answering 500; only the sentence changes.
                    //
                    // [#11684] …and that last sentence was the defect report
                    // for the card below: leaving the status alone left an
                    // UNDECLARED sandbox refusal in ③, answering 500 where the
                    // `/data` door answers 400 for the identical throw. ①b now
                    // sits between the two arms and moves exactly that class.
                    // The sentence this line computes is unchanged.
                    const clientMsg = sandboxBusinessMessage(error) ?? msg;

                    // ── [#12710] The producer's marked sentence, resolved once ─
                    // Commit 79c46da90's `userMessage` channel is STATUS- and BRANCH-agnostic
                    // by construction: `withDeclaredUserMessage` applies it ONCE at
                    // the `/data` door's exit, over whatever envelope classification
                    // chose. This door has no such wrapper — it builds ①, ③a and ③b
                    // by hand — so the rule was applied at none of them, and one
                    // producer's sentence reached the client on `POST /data/:object`
                    // and vanished here for the identical throw (measured door to
                    // door in `analytics-fault-user-message.test.ts` §3).
                    //
                    // Resolved ONCE here rather than at each terminal so this door
                    // has a single answer to "is there a mark, and how long may it
                    // be": {@link boundedDeclaredUserMessage} is that pair
                    // (`declaredUserMessage`'s presence answer + #5423's bound)
                    // shared with the `/data` door rather than copied beside it,
                    // the same way the record-share family's two hand-built exits
                    // ask it (#12693).
                    //
                    // ⛔ Deliberately NOT spread onto ①b below. That arm re-dresses
                    // {@link classifiedRefusalAnswer}'s body, which already carries
                    // the mark, so a second application there would be one rule
                    // applied twice. Scope here is by ARM, not by door.
                    //
                    // ⛔ And riding it across the FAULT terminals ③a/③b does not
                    // re-open #5367/#5437/#5811. Those withhold prose the producer
                    // never addressed to the caller — driver text, a crash's
                    // `TypeError` — while this field exists on an error only
                    // because an author deliberately wrote caller-facing text onto
                    // it. The prose stays withheld byte for byte, neither the
                    // status nor the `code` moves, and an UNMARKED throw's envelope
                    // is byte-identical to before (pinned, §4).
                    const marked = boundedDeclaredUserMessage(error);
                    const markExtra = marked === undefined ? {} : { userMessage: marked };
                    // ── [#5352] ① The ADR-0112 envelope, read FIRST ──────────
                    // A thrown error that already carries `code` + a 4xx
                    // `status` has ANSWERED the classification question. This
                    // route used to discard both and re-derive the answer from
                    // the message text below, so every producer that took
                    // ADR-0112 seriously was punished for it: analytics'
                    // filter refusals (`INVALID_FILTER`/400 — a misspelled
                    // operator in a dashboard widget, #3948/#5240/#5325/#5334),
                    // the measure source-field gate (`INVALID_FIELD`/400,
                    // #4437) and the cube-existence gate (`CUBE_NOT_FOUND`/404,
                    // #3867) all landed as `500 ANALYTICS_QUERY_FAILED` — read
                    // by the author as "the platform is broken" and by ops
                    // alerting as a 5xx. The same mistakes answer 400 on
                    // `/data`; one condition must not get two wire shapes
                    // because a different face caught it.
                    //
                    // BOTH halves are required, deliberately. A 4xx status with
                    // no code would force this route to invent one, which is
                    // the consumer-side leniency ADR-0112 exists to remove — a
                    // producer that ships half an envelope has a bug of its own
                    // and should be found, not papered over here.
                    //
                    // 4xx ONLY: a 5xx-status error keeps going through the
                    // `ANALYTICS_QUERY_FAILED` envelope below, so an internal
                    // fault can never be re-labelled as the caller's fault (and
                    // keeps its `logError` line). [#5367] It also has its MESSAGE
                    // withheld there — declaring a server fault is declaring that
                    // the detail is the operator's, not the caller's.
                    const envelopeStatus = typeof error?.status === 'number' ? error.status : undefined;
                    const envelopeCode = typeof error?.code === 'string' && error.code.length > 0 ? error.code : undefined;
                    if (envelopeStatus !== undefined && envelopeStatus >= 400 && envelopeStatus < 500 && envelopeCode) {
                        return res.status(envelopeStatus).json({ code: envelopeCode, message: clientMsg.slice(0, 1000), ...markExtra });
                    }
                    // ── [#11684] ①b The refusal ① could not read ─────────────
                    // ① answers a refusal that declared BOTH halves of the
                    // envelope, spelled `status`. Two classified refusals fell
                    // past it into ③ and were reported to the caller as server
                    // faults:
                    //
                    //   - **An UNDECLARED sandboxed hook refusal.** A hook body
                    //     running `throw new Error('month-end close is in
                    //     progress')` — the most common shape an app author
                    //     writes — declares no `status` and no `code`, so ①
                    //     never opened. Measured: `500 ANALYTICS_QUERY_FAILED`
                    //     here against `400` with the same sentence on
                    //     `POST /data/:object`, i.e. one hook body, one
                    //     `throw`, two statuses decided by whether the caller
                    //     hit a dashboard tile or a list view.
                    //   - **The `statusCode` spelling** (#7525). ①'s read is
                    //     `error.status` alone, and `plugin-approvals`'
                    //     lifecycle hooks — plus `runtime`'s
                    //     `action-execution.ts` and `metadata-protocol` — spell
                    //     it `statusCode`. Same refusal, same declaration, 500.
                    //
                    // {@link classifiedRefusalAnswer} is the `/data` door's own
                    // classification, imported rather than re-derived for the
                    // same reason {@link sandboxBusinessMessage} above it is: a
                    // third local opinion at this boundary is precisely how the
                    // two faces came to disagree. It answers `undefined` for
                    // everything ③ still owns — a declared 5xx, a crashed body
                    // (#7543), a driver fault, anything unclassified — so ③'s
                    // reach is unchanged except for the two shapes named above.
                    //
                    // ⛔ This is NOT a widening of ①'s both-halves gate. That
                    // gate is #5352's ruling for producers that ship half an
                    // ADR-0112 envelope, it still stands, and the seam encodes
                    // it. What crosses here without a `code` is the SANDBOX
                    // limb, where "no code" is not half a declaration: the
                    // author declared the condition by reporting it, and
                    // `classifyDataError`'s unwrap door has answered that with
                    // 400 and the verbatim sentence since it existed
                    // (`hook-error-format.dogfood.test.ts`). Nothing is
                    // invented — a refusal that declared no code is answered
                    // with no code, exactly as `/data` answers it.
                    const refusal = classifiedRefusalAnswer(error);
                    if (refusal) {
                        const { error: refusalText, ...refusalFields } = refusal.body;
                        return res.status(refusal.status).json({
                            ...refusalFields,
                            message: String(refusalText ?? clientMsg).slice(0, 1000),
                        });
                    }
                    // ── ② … is GONE. The message-sniffing list is retired ────
                    // [#5367] `/analytics/dataset/query` used to classify six
                    // error families by matching hardcoded substrings of their
                    // message text, which made their HTTP status a property of
                    // their WORDING: rephrasing a message — no logic change, no
                    // test red, no gate red — moved the error from 400 to 500.
                    // Prime Directive #12 tolerates an accommodation like that
                    // only while it is declared, loud, tested AND removable on a
                    // schedule; #5352 shipped the first three and #5367 was the
                    // schedule. It is now paid off in full:
                    //
                    //   - FIVE families throw `datasetInvalidError`
                    //     (`DATASET_INVALID` / 400) from `service-analytics`'s
                    //     `dataset-refusal.ts` and are served by ① —
                    //     `dataset-compiler` (undeclared relationship path,
                    //     unsupported aggregate), `dataset-executor` (order key,
                    //     totals grouping), `native-sql-strategy` (join outside
                    //     the allowlist).
                    //   - The SIXTH — `read-scope-sql`'s ten fail-closed RLS
                    //     lowering refusals — was re-judged by the maintainer on
                    //     2026-08-06 and is now `READ_SCOPE_COMPILE_FAILED` /
                    //     **500**. Its inputs are an admin-authored policy and a
                    //     compiler-generated join alias, never the caller's, so
                    //     `400 DATASET_INVALID` both misattributed the fault and
                    //     echoed RLS policy field names back to the tenant. A
                    //     declared 5xx is 4xx-only-① 's business no longer, so it
                    //     falls to ③ BY DECLARATION.
                    //
                    // ⛔ Do not reintroduce a message test here. Give the refusal
                    // a `code`/`status` and the branches above and below serve it.
                    //
                    // ── ③ The 500 — and it does not ship internals ───────────
                    // [#5520] This route built its 5xx body by hand and echoed
                    // the message verbatim, so a driver error arrived here with
                    // the generated statement prefixed to it (knex's format is
                    // `<sql> - <cause>`) and the caller received the physical
                    // table and column names of the query:
                    //
                    //   {"code":"ANALYTICS_QUERY_FAILED","error":"SELECT bogus_dim AS
                    //    \"bogus_dim\", COUNT(*) … FROM \"crm_account\" GROUP BY
                    //    bogus_dim - no such column: bogus_dim"}
                    //
                    // The SIBLING analytics face never did: `/analytics/query`
                    // exits through `dispatcher-plugin.errorResponseBase`, which
                    // applies `looksLikeInternalErrorLeak` to any >=500 message
                    // (#3867) — which is why the same mistake read "Internal
                    // server error" there and dumped SQL here. One boundary
                    // property, one shared predicate; this is the application
                    // that was missing, not a new rule. Classification is
                    // untouched (still `500 ANALYTICS_QUERY_FAILED`), and the
                    // full text still reaches the operator through `logError`
                    // immediately below — the log line is now the only copy.
                    //
                    // [#5367] `looksLikeInternalErrorLeak` is a heuristic over
                    // SQL/driver PHRASING, and the read-scope refusals do not
                    // speak it: measured, all ten messages
                    // (`[read-scope-sql] unsafe field identifier "…"`, …) return
                    // FALSE from it, so retiring ② alone would have moved the RLS
                    // policy content from a 400 body to a 500 body instead of
                    // out of the response. Widening the heuristic to recognise
                    // them would be more message sniffing — the very thing #5367
                    // removes. So the withhold is DECLARED instead: a producer
                    // that says `status >= 500` with a `code` has declared a
                    // server fault, and a server fault's detail belongs in the
                    // log, not in the caller's body. That is a structural rule
                    // over the ADR-0112 envelope, not a guess about prose, and it
                    // leaves #5667's tiering intact for UNDECLARED 5xx errors —
                    // a bare `Error` still goes through the heuristic, so a
                    // self-authored fault ("no strategy can handle query …")
                    // stays readable.
                    //
                    // [#5811] That rule is no longer written here. The sibling
                    // face — `/analytics/query`, exiting through
                    // `dispatcher-plugin.errorResponseBase` — had the identical
                    // leak (measured: 11/11 read-scope messages echoed verbatim),
                    // so the criterion was promoted to `declaresServerFault` in
                    // `@objectstack/types`, beside the heuristic it complements,
                    // and both boundaries read it. #5808 deliberately left it
                    // in-line while there was one consumer; this is the second.
                    // The verdict here is unchanged in every case — the predicate
                    // is the same `status >= 500` + non-empty `code` test, reading
                    // the same two fields ① derives `envelopeStatus`/`envelopeCode`
                    // from.
                    logError('[REST] Analytics dataset query error:', error);
                    // ── [#11718] ③a A DECLARED 5xx is RELAYED, not collapsed ──
                    // Measured door-to-door: one producer-declared
                    // `{ status: 503, code: 'SERVICE_UNAVAILABLE' }` answered
                    // `503 SERVICE_UNAVAILABLE` on `POST /data/:object` and
                    // `500 ANALYTICS_QUERY_FAILED` here. #5582's argument is
                    // that `502`/`503` are `isExpectedDataStatus` LIFECYCLE
                    // outcomes — a proxy retries them and alerts differently —
                    // so collapsing them onto `500` destroys the declaration.
                    // That ruling landed one door over and never reached this
                    // one, because this arm built its 5xx body by hand.
                    //
                    // ⛔ This does NOT re-open #5352/#5367/#5811. Those rule the
                    // PROSE, and the prose is still withheld — byte-identical,
                    // `INTERNAL_ERROR_MESSAGE`, from the same shared arm — and
                    // the full text still reaches the operator through the
                    // `logError` line ABOVE this branch, which is deliberately
                    // placed first so a relayed status cannot buy a producer its
                    // way past the log. What moves is the CLASSIFICATION the
                    // producer declared and this route was overwriting.
                    //
                    // {@link declaredServerFaultAnswer} is `/data`'s own arm,
                    // imported for the reason {@link classifiedRefusalAnswer}
                    // above it is: a third local opinion at this boundary is how
                    // the two faces came to disagree in the first place. The
                    // SIBLING analytics face already agreed with `/data` —
                    // `/analytics/query` relays both halves through
                    // `dispatcher-plugin.errorResponseBase` (measured: a
                    // read-scope refusal reaches the client as `500`
                    // `READ_SCOPE_COMPILE_FAILED`, pinned in
                    // `analytics-query-read-scope-withhold.test.ts`) — so this
                    // face was the only one of three collapsing the declaration.
                    //
                    // ⚠️ Consequence, deliberate and named: a declared 5xx now
                    // carries the PRODUCER's code, so `read-scope-sql`'s ten
                    // fail-closed refusals answer `500 READ_SCOPE_COMPILE_FAILED`
                    // here instead of `500 ANALYTICS_QUERY_FAILED`. Their
                    // 2026-08-06 ruling is untouched in substance — a SERVER
                    // fault, `500`, policy content withheld — and the code they
                    // now carry is the one they declare and the one the sibling
                    // face has always shipped. `ANALYTICS_QUERY_FAILED` remains
                    // this route's answer for an UNDECLARED fault, below.
                    const declaredFault = declaredServerFaultAnswer(error);
                    if (declaredFault) {
                        return res.status(declaredFault.status).json({ ...declaredFault.body, ...markExtra });
                    }
                    // ── ③b The generic 500, for a fault nobody declared ──────
                    // `declaresServerFault` is kept in the withhold test rather
                    // than dropped as dead: it reads `error.status` alone and is
                    // not bounded above, so a nonsense `status: 700` with a code
                    // still reaches here (`declaredHttpStatus` requires < 600)
                    // and must keep the withhold it has had since #5367.
                    const outward = declaresServerFault(error) || looksLikeInternalErrorLeak(msg)
                        ? INTERNAL_ERROR_MESSAGE
                        : clientMsg.slice(0, 500);
                    res.status(500).json({ code: 'ANALYTICS_QUERY_FAILED', error: outward, ...markExtra });
                }
            },
            metadata: { summary: 'Run a semantic-layer dataset (preview/query)', tags: ['analytics'] },
        });
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
        const isScoped = basePath.includes('/environments/:environmentId');
        // Resolve the ENVIRONMENT's security service first (its resolver /
        // evaluator / RLS compiler are bound to the env kernel's own data
        // engine); the host provider is the single-kernel fallback.
        const resolveService = async (environmentId?: string, req?: any) => {
            try {
                const envId = await this.resolveRequestEnvironmentId(environmentId, req);
                if (envId && envId !== 'platform' && this.kernelManager) {
                    const kernel = await this.kernelManager.getOrCreate(envId);
                    const svc = await kernel.getServiceAsync<any>('security').catch(() => undefined);
                    if (svc) return svc;
                }
            } catch { /* fall back to the host service */ }
            if (!this.securityServiceProvider) return undefined;
            try { return await this.securityServiceProvider(environmentId); }
            catch { return undefined; }
        };

        /**
         * [#8073] The ONE refusal emitter for this route family — every arm of
         * both handlers goes through it, so "explain and my-delegable-scope
         * answer the same shape" is a property of the code rather than of
         * eight literals that happen to agree.
         *
         * Before this, the family carried BOTH dialects ADR-0112 D5 retires:
         * the 401/501/400/403 arms were flat `{ code, message }` and the two
         * 500s were `{ code, error: 'a bare string' }`, so `body.error.code` —
         * the one position D5 declares — read `undefined` on all six. #7035
         * (PR #7293) had already removed both from this file's `/meta`
         * refusals and #7981 (PR #8071) from `registerSecurityEndpoints`, the
         * immediately ADJACENT registrar: a client calling `explain` and then
         * `suggested-bindings` met two shapes inside one `security` family.
         *
         * Emitted through the SHARED builder (`sendError` from
         * `@objectstack/types`, imported as `sendEnvelopeError` — see the note
         * at the import). That is what makes this the reference shape by
         * construction rather than a ninth local literal agreeing with the
         * eight it replaced, and it types `code` to the closed vocabulary for
         * free.
         *
         * ⛔ Status codes are untouched: only the POSITION of `code` and
         * `message` moves. `detail` — the 400 arm's Zod-issue dump — moves to
         * `error.details`, the slot `ApiErrorSchema` actually declares for
         * structured context; as a top-level sibling it was undeclared.
         */
        const respondError = (
            res: any,
            status: number,
            code: ErrorCode,
            message: string,
            details?: unknown,
        ): void => sendEnvelopeError(
            res, status, code, message,
            details === undefined ? undefined : { details },
        );

        const handler = async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (!context?.userId) {
                    // The explain surface stays authenticated-only — it is an
                    // admin diagnosis tool. (Anonymous is already 401ed above.)
                    return respondError(
                        res, 401, 'UNAUTHORIZED',
                        'The access-explanation endpoint requires an authenticated caller.',
                    );
                }

                const svc = await resolveService(environmentId, req);
                if (!svc || typeof svc.explain !== 'function') {
                    return respondError(
                        res, 501, 'NOT_IMPLEMENTED',
                        'Access explanation is not available on this deployment (no security service with explain).',
                    );
                }

                // GET reads the request from the query string, POST from the
                // body — one contract (ExplainRequestSchema), two transports.
                //
                // [#6877] The other read point that was already safe, and for the
                // structural reason rather than by luck: every field goes through
                // `ExplainRequestSchema.safeParse` below, whose members are
                // `z.string()`, so an array is refused as `400 VALIDATION_FAILED`
                // by the schema itself. A schema at the boundary is the shape the
                // refusal gate is imitating, so there is nothing to add here.
                const src = req.method === 'GET' ? (req.query ?? {}) : (req.body ?? {});
                const { ExplainRequestSchema } = await import('@objectstack/spec/security');
                // [#8326] GET-transport normalization ONLY: a query string
                // cannot spell a one-element array (`?recordIds=a` parses to
                // the bare string), so a lone string is wrapped on GET. On
                // POST the body is JSON and can say what it means — a string
                // where the contract says array stays a 400, not a wrap.
                const rawRecordIds = req.method === 'GET' && typeof src.recordIds === 'string' && src.recordIds !== ''
                    ? [src.recordIds]
                    : src.recordIds;
                const parsed = (ExplainRequestSchema as any).safeParse({
                    object: src.object,
                    operation: src.operation ?? 'read',
                    ...(src.userId != null && src.userId !== '' ? { userId: src.userId } : {}),
                    // [C2 / ADR-0095] Optional record id — explains ONE concrete
                    // row at record granularity; omitted stays object-level.
                    ...(src.recordId != null && src.recordId !== '' ? { recordId: src.recordId } : {}),
                    // [#8326] Optional batch of record ids — the schema owns the
                    // cap (200), the min (1), and recordId/recordIds mutual
                    // exclusion, so every refusal is the one 400 below.
                    ...(rawRecordIds != null ? { recordIds: rawRecordIds } : {}),
                });
                if (!parsed.success) {
                    return respondError(
                        res, 400, 'VALIDATION_FAILED',
                        'Invalid explain request — expected { object: string, operation: read|create|update|delete|transfer|restore|purge, userId?: string, recordId?: string, recordIds?: string[] (max 200, exclusive with recordId) }.',
                        String(parsed.error?.message ?? '').slice(0, 1000),
                    );
                }

                const { recordIds, ...singularRequest } = parsed.data as { recordIds?: string[] } & Record<string, unknown>;
                if (!recordIds) {
                    // Singular / object-level — the pre-#8326 path, byte-identical.
                    const decision = await svc.explain(parsed.data, context);
                    return res.json(decision);
                }

                // [#8326] Batch form — transport amortization of the SINGULAR
                // evaluation, not a new semantic: the object-level trace is one
                // object-level explain, and each per-record verdict is the
                // singular record-grained explain for that id, relayed
                // verbatim. "Batch answer ≡ N singular answers" is therefore a
                // property of the construction, and the agreement test pins it
                // from staying that way by accident.
                const decision = await svc.explain(singularRequest, context);
                const verdictById = new Map<string, unknown>();
                for (const id of new Set(recordIds)) {
                    const single = await svc.explain({ ...singularRequest, recordId: id }, context);
                    // A service without record-grained support answers no
                    // record verdict; fail CLOSED (a hidden button beats a
                    // shown-then-403), with no decidedBy fabricated.
                    verdictById.set(id, single?.record ?? { recordId: id, visible: false });
                }
                // Ordering contract: records[i] answers recordIds[i] — same
                // order, same length, duplicates answered per position.
                res.json({ ...decision, records: recordIds.map((id) => verdictById.get(id)) });
            } catch (error: any) {
                const msg = String(error?.message ?? error ?? '');
                if (
                    error?.code === 'PERMISSION_DENIED' ||
                    error?.name === 'PermissionDeniedError' ||
                    msg.startsWith('[Security] Access denied')
                ) {
                    return respondError(res, 403, 'PERMISSION_DENIED', msg.slice(0, 1000));
                }
                // [#18253] The name asked about is not a declared object
                // (`ExplainObjectNotFoundError`, plugin-security `errors.ts`) —
                // a REFUSAL, not a fault, so it keeps its declared answer
                // instead of falling to the 500 below. 404 `OBJECT_NOT_FOUND`
                // is what this package already answers for an unregistered
                // object name (`mapDataError`, `error-response.ts`), emitted
                // here through this family's ONE refusal emitter so the body
                // is the same ADR-0112 D5 envelope every other arm sends.
                // Matched by `code`/`name`, exactly as the 403 arm above is:
                // `@objectstack/plugin-security` is not a dependency of this
                // package, and the thrown shape is the contract (#8016).
                if (error?.code === 'OBJECT_NOT_FOUND' || error?.name === 'ExplainObjectNotFoundError') {
                    return respondError(res, 404, 'OBJECT_NOT_FOUND', msg.slice(0, 1000));
                }
                // [#20603] A refusal the SERVICE classified: an ADR-0112 `code`
                // with a 4xx `status` (either spelling), or a sandboxed body's
                // business `throw`. It is the caller's answer, not this route's
                // fault. The measured producer is the explain engine answering
                // enforcement's own refusal, `INVALID_FILTER` / 400, for a
                // row-level filter the record matcher cannot evaluate: in a
                // record-grained explanation, and since #20604 in an
                // object-level one and for a `recordId` no row carries. The
                // find that explain describes answers 400 for the same filter.
                // This arm used to answer `500 EXPLAIN_FAILED`, so a client
                // read an outage where the platform meant "this policy cannot
                // be evaluated".
                //
                // The classification is {@link classifiedRefusalAnswer}, the
                // `/data` door's own, imported for the same reason the analytics
                // and record-share doors import it (#11684): a local list of
                // codes here would be a third opinion on a question that file
                // owns. It answers `undefined` for everything the 500 below
                // still owns: a declared 5xx, half an envelope (a code without
                // a status, #5352), a crashed sandbox body, an unclassified
                // fault. The 403 and 404 arms above keep running first,
                // because they also match refusals that declare no status.
                //
                // Re-dressed through this family's ONE emitter, as the
                // record-share family re-dresses it: `code` is required by the
                // nested envelope and the sandbox limb legitimately carries
                // none, so the catalog's status floor fills it. The message is
                // the classification's, which unwraps a sandbox wrapper and
                // applies the `/data` door's bound.
                //
                // ⛔ Scope: status, code and message. The classification's
                // `declaredCode` and `userMessage` siblings are not forwarded,
                // because this family's emitter has no slot for them (its fifth
                // argument is `details`) and no arm of the family forwards
                // them today. Adding that slot is a change to the whole family.
                const refusal = classifiedRefusalAnswer(error);
                if (refusal) {
                    const code = typeof refusal.body.code === 'string'
                        ? refusal.body.code as ErrorCode
                        : standardErrorCodeForHttpStatus(refusal.status);
                    return respondError(res, refusal.status, code, String(refusal.body.error ?? ''));
                }
                logError('[REST] Security explain error:', error);
                // The 500 arm keeps its 500-char cap: an unexpected fault's
                // message is not a contract, and truncating it stays a
                // sanitization step — only the position of the words moves.
                respondError(res, 500, 'EXPLAIN_FAILED', msg.slice(0, 500));
            }
        };

        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/security/explain`,
            handler,
            metadata: { summary: 'Explain why a principal can (or cannot) perform an operation on an object (ADR-0090 D6)', tags: ['security'] },
        });
        this.routeManager.register({
            method: 'POST',
            path: `${basePath}/security/explain`,
            handler,
            metadata: { summary: 'Explain why a principal can (or cannot) perform an operation on an object (ADR-0090 D6)', tags: ['security'] },
        });

        /**
         * [ADR-0090 D12 / ADR-0105 D8] What the CALLER may delegate.
         *
         *   GET {basePath}/security/my-delegable-scope
         *
         * The read half of the delegated-admin gate, shaped for a picker: the
         * business units the caller may place people into and the positions
         * they may assign. A scoped-invitation form narrows its options with
         * this instead of listing the whole tree and letting the user find the
         * boundary by being refused.
         *
         * Strictly SELF-scoped — no `userId` parameter, by design. The caller's
         * own resolved sets are the only input, so it discloses nothing beyond
         * the authority they already hold, and there is no "describe someone
         * else's authority" surface to authorize (unlike `explain`, which has
         * one and gates it). An authenticated caller is still required.
         */
        const delegableHandler = async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (!context?.userId) {
                    return respondError(
                        res, 401, 'UNAUTHORIZED',
                        'The delegable-scope endpoint requires an authenticated caller.',
                    );
                }

                const svc = await resolveService(environmentId, req);
                if (!svc || typeof svc.describeDelegableScope !== 'function') {
                    return respondError(
                        res, 501, 'NOT_IMPLEMENTED',
                        'Delegated administration is not available on this deployment (no security service with describeDelegableScope).',
                    );
                }

                res.json(await svc.describeDelegableScope(context));
            } catch (error: any) {
                const msg = String(error?.message ?? error ?? '');
                logError('[REST] Delegable scope error:', error);
                respondError(res, 500, 'DELEGABLE_SCOPE_FAILED', msg.slice(0, 500));
            }
        };

        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/security/my-delegable-scope`,
            handler: delegableHandler,
            metadata: {
                summary: "The caller's delegable scope: business units they may place into and positions they may assign (ADR-0090 D12 / ADR-0105 D8)",
                tags: ['security'],
            },
        });
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
        const { crud } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;
        const isScoped = basePath.includes('/environments/:environmentId');

        const resolveService = async (environmentId?: string) => {
            if (!this.sharingServiceProvider) return undefined;
            try { return await this.sharingServiceProvider(environmentId); }
            catch { return undefined; }
        };
        /**
         * [#8111] The ONE refusal emitter for the record-sharing family — the
         * 501, all five mapped verdicts and all three 500s go through it, so
         * "list, grant and revoke answer the same shape" is a property of the
         * code rather than of nine literals that happen to agree.
         *
         * Before this, the family carried BOTH dialects ADR-0112 D5 retires:
         * `respond501` was flat `{ code, message }` and every other arm was
         * `{ code, error: '<bare string>' }`, so `body.error.code` — the one
         * position D5 declares — read `undefined` on all nine. #7035
         * (PR #7293) had already removed both from this file's `/meta`
         * refusals, #7981 (PR #8071) from `registerSecurityEndpoints` and
         * #8073 (PR #8174) from the `/security/explain` pair.
         *
         * Emitted through the SHARED builder (`sendError` from
         * `@objectstack/types`, imported as `sendEnvelopeError` — see the note
         * at the import). That is what makes this the reference shape by
         * construction rather than a tenth local literal agreeing with the nine
         * it replaced, and it types `code` to the closed ADR-0112 vocabulary
         * for free.
         *
         * ⛔ Status codes are untouched and no code VALUE moves: only the
         * POSITION of `code` and `message` changes.
         */
        const respondError = (
            res: any,
            status: number,
            code: ErrorCode,
            message: string,
            // [#12510] The shared writer's OWN `extra` type, referenced rather
            // than restated: this wrapper decides POSITION (the nested D5
            // envelope), never which channels exist. A local `{ declaredCode?:
            // string }` would be a second, narrower declaration of a set
            // `sendError` already owns — the shape that silently stops
            // forwarding the next channel admitted there.
            extra?: Parameters<typeof sendEnvelopeError>[4],
        ): void => sendEnvelopeError(res, status, code, message, extra);

        const respond501 = (res: any) => respondError(
            res, 501, 'NOT_IMPLEMENTED',
            'Sharing service is not configured on this deployment',
        );
        /**
         * [#12693] The `extra` this family's TWO NON-CLASSIFIED exits owe a
         * producer that marked its refusal: the 500 fault terminal below, and
         * the ADR-0111 prefix arm inside {@link respondSharingError}.
         *
         * Neither reaches {@link classifiedRefusalAnswer} — the 500 terminal
         * because a declared server fault is deliberately not a refusal
         * (that function's own docblock rules it back to "the catching route's
         * own terminal", which is these three arms), the prefix arm because it
         * runs precisely when the classification answered `undefined`. So
         * neither holds a `refusal.body` to re-dress, and the one line the
         * classified arm uses (`refusal.body.userMessage`, #12669) is NOT
         * reusable here. What is reusable is the RULE, and
         * {@link boundedDeclaredUserMessage} is that rule asked of the raw
         * thrown error instead of the classification: `declaredUserMessage`'s
         * presence answer with #5423's bound applied, one definition, shared
         * with the `/data` door rather than copied beside it.
         *
         * Measured on `15bf9e859` before the repair, one producer per exit
         * through the real routes on both doors:
         *
         * ```text
         * throw { code: 'SHARE_STORE_DOWN', status: 503, userMessage: '…' }
         *   share door : 500 SHARES_LIST_FAILED        — no mark
         *   /data door : 503 SERVICE_UNAVAILABLE       — mark carried
         * throw Error('NOT_FOUND: no such record …') + userMessage
         *   share door : 404 NOT_FOUND                 — no mark
         *   /data door : 500 INTERNAL_ERROR            — mark carried
         * ```
         *
         * ⛔ The mark is the ONLY thing this adds, and the two doors' other
         * disagreements visible in that measurement stay exactly as they are:
         * the share family folds a declared 503 into its own 500 terminal, and
         * it interpolates the caught message where `/data` withholds 5xx prose
         * unconditionally (#5437). Both are deliberate and argued in
         * {@link sharingFaultMessage} and the #11683 docblock below; the
         * `/data` door's status for the prefix arm differs for a third
         * deliberate reason — the prefix idiom is this service's local
         * convention and no shared classifier can read it (ADR-0111).
         *
         * ⛔ Riding the mark across a FAULT terminal is not a re-opening of
         * #5437 either, and the reason is `withDeclaredUserMessage`'s, not a
         * second one: the withheld text is prose the producer never addressed
         * to the caller, while this field exists only because an author wrote
         * caller-facing text onto it. A genuine crash carries no mark and its
         * envelope is byte-identical to before.
         */
        const sharingDeclaredExtra = (
            error: any,
        ): { userMessage: string } | undefined => {
            const userMessage = boundedDeclaredUserMessage(error);
            return userMessage === undefined ? undefined : { userMessage };
        };
        // [ADR-0111] The service enforces authorization (D1/D4/D5/D7) and
        // signals the verdict via message prefixes, the plugin's established
        // error idiom — this maps them onto HTTP. Returns true when handled.
        //
        // [#8111] The prefix is a SERVER-INTERNAL service→REST derivation.
        // ⚠️ [#13095] This comment used to claim the MECHANISM guaranteed
        // that: "it is stripped below and never reaches the wire". That was
        // true of the prefix-idiom arm it was written about and FALSE for the
        // classified limb #11683 added beside it, which re-dresses
        // `resolveErrorResponse`'s answer — an answer that shipped the prefix
        // inside the sentence until the 2026-08-31 ruling converged that arm
        // onto the same declared-code-anchored strip. Even now the strip is
        // ANCHORED (it removes only a prefix restating the declared code), so
        // "never reaches the wire" is not a mechanism anyone may lean on.
        // What holds instead is MEASURED, not guaranteed: no consumer
        // branches on the prefix in the wire `error` text — censused at
        // #8111's claim and re-censused 2026-09-01 (objectstack + objectui:
        // zero wire readers; every `startsWith(CODE)` hit is this file's own
        // route mappings or an in-process producer-side check; `cloud` was
        // not reachable and is NOT measured). The prefix idiom itself stays
        // exactly as it is; #8111 moved only the response SHAPE.
        //
        // [#11683] …and it stays exactly as it is here too. What moved is that
        // the prefix read is no longer the FIRST question, and no longer the
        // only one. It is the ADR-0111 idiom for producers that declare
        // nothing else, and the census that made it safe to keep is still
        // true: every throw site in `plugin-sharing/src/sharing-service.ts`
        // (11 of them, re-censused at claim) is a bare `Error` carrying one of
        // these prefixes and NO `code`, NO `status`. Backward compatibility is
        // therefore not a courtesy — it is the only channel this service has.
        //
        // What it could never read is a refusal that DID declare itself, and
        // two of those reach these three catches today:
        //
        //   - `plugin-sharing`'s own write gate throws
        //     `{ code: 'FORBIDDEN', status: 403 }` (`sharing-plugin.ts`).
        //     `FORBIDDEN` is not one of the five, so a refusal that declared
        //     403 twice over was answered `500 SHARE_*_FAILED`.
        //   - A sandboxed hook on the `sys_record_share` write arrives with
        //     the QuickJS debug wrapper on `.message` and the business text on
        //     `.innerMessage`. The wrapper IS the prefix, so nothing matched
        //     and the wrapper was interpolated verbatim into the 500 — #11588's
        //     leak on a branch #11588 did not reach.
        //
        // Both are asked FIRST now, through {@link classifiedRefusalAnswer} —
        // the `/data` door's own classification, so this family cannot answer
        // a refusal differently from every other face that catches it. A
        // declaration outranking a message read is the whole point: this
        // route's defect was that classification was a property of how the
        // sentence happened to start.
        //
        // ⛔ The DIALECT does not move. #8111 converted these arms onto the
        // nested ADR-0112 D5 envelope and the `check:route-envelope` ratchet
        // only ticks down, so the classification is re-dressed through
        // `respondError` rather than sent by `handleRouteError` (which speaks
        // the flat dialect). Vocabulary and position stay two decisions.
        const respondSharingError = (res: any, error: any): boolean => {
            // A refusal the producer classified — answered exactly as `/data`
            // answers it. `undefined` for everything else, which falls to the
            // prefix idiom below and then to the caller's own 500 arm, both
            // unchanged.
            const refusal = classifiedRefusalAnswer(error);
            if (refusal) {
                // `code` is REQUIRED by the nested envelope, and the flat
                // classification legitimately carries none for an undeclared
                // sandbox refusal (ADR-0112 D4 governs the semantic-CODE
                // channel: the producer names the condition on the CODE axis,
                // so nothing is invented for the half it did not name; the ADR
                // rules no HTTP status here, and the phrase is
                // `error-response.ts`'s own prose rather than an ADR
                // quotation). The
                // catalog's own floor fills the required field —
                // `standardErrorCodeForHttpStatus`, whose docblock exists for
                // exactly this ("Total by construction: a producer can always
                // fill a required `code`") and which is the same derivation
                // `resolveThrownHttpError` applies at every other door. This
                // is the one place the two dialects genuinely differ: the flat
                // body may omit `code`, the nested one may not.
                //
                // [#12510] …and the producer's OWN spelling travels with it.
                // An UNREGISTERED thrown code is demoted by the shared rule to
                // a `declaredCode` sibling (ADR-0112 #9232) — the open,
                // author-authored channel `ApiErrorSchema` has declared since
                // #9106. This family used to drop it: the classification below
                // was already holding the demoted string and only `code` and
                // the message were re-dressed, so an app's spelling vanished
                // here while the flat `/data` door carried it. Nothing invalid
                // shipped — the closed `code` still carried the member the
                // status derives — which is exactly what made the loss silent
                // and one-directional: a consumer told by ADR-0112 to read
                // `declaredCode` found nothing at this door.
                //
                // ⛔ The reason that used to stand here said `sendError`'s
                // `extra` would not accept the field. That was true when it was
                // written and false since #11719 / `db8c288` (PR #12403) added
                // `declaredCode` to the writer's `Pick`. A stale sentence that
                // discourages a repair costs more than one that misdescribes a
                // mechanism, so it is recorded rather than merely deleted.
                //
                // ⛔ Read the CLASSIFICATION's field, never the resolver's raw
                // `thrown.declaredCode`. Presence MEANS demotion
                // (`ApiErrorSchema.declaredCode`'s documented invariant) and
                // the raw field is set for a REGISTERED spelling too —
                // measured: a producer throwing `{ code: 'RECORD_LOCKED',
                // status: 409 }` resolves with `declaredCode: 'RECORD_LOCKED'`
                // sitting beside an identical `code`, and forwarding that would
                // put two spellings of one fact on every registered refusal.
                // `refusal.body.declaredCode` is the answer AFTER
                // `demotedDeclaredCode` (`error-response.ts`'s
                // `thrownCodeFields`, the same one definition the dispatcher
                // door reads), so the invariant arrives with the value.
                //
                // ⭐ Why re-dress rather than re-resolve: this door asks
                // {@link classifiedRefusalAnswer} ONCE and re-dresses that one
                // answer, exactly as it does for `status`, `code` and the
                // message. Calling the resolver a second time here would be a
                // second answer to a question already asked — the shape that
                // let two `/api/v1/packages` doors drift apart (#12405). The
                // pair is carried, not recomputed: `code` and `declaredCode`
                // leave this door as the pair `thrownCodeFields` produced.
                const code = typeof refusal.body.code === 'string'
                    ? refusal.body.code as ErrorCode
                    : standardErrorCodeForHttpStatus(refusal.status);
                const declaredCode = typeof refusal.body.declaredCode === 'string'
                    ? refusal.body.declaredCode
                    : undefined;
                // [#12669] …and so does the sentence the producer addressed to
                // the CALLER. The flat `/data` door attaches it in
                // `withDeclaredUserMessage` (`error-response.ts`, commit 79c46da90) and
                // the one classification asked above is already holding the
                // result; this family dropped it at the same re-dress, with the
                // same one-directional silence — an author's own remedy text
                // reaching `/data` and vanishing here.
                //
                // ⛔ `userMessage` and `declaredCode` are NOT symmetric, and
                // the next reader will assume they are because they arrive on
                // the same line. `declaredCode` is read from the CLASSIFICATION
                // because presence there MEANS demotion — an invariant the raw
                // thrown field does not carry, which is the whole subject of
                // the paragraphs above (⛔ not restated here: #12510 owns that
                // derivation and one reason with two copies is this lane's own
                // recurring defect). `userMessage` has NO invariant left for a
                // caller to re-derive. `declaredUserMessage` already decided
                // PRESENCE — the field exists on an error only because its
                // producer deliberately wrote end-user text with no host state
                // onto it (an application hook, or a platform refusal carrying
                // static guidance such as the packaged-permission-set lock's;
                // platform and driver diagnostics never set it) — and
                // `truncateClientMessage` already applied #5423's bound to the
                // value. Reading `refusal.body.userMessage` IS the rule; there
                // is no second function to run it through, and running one
                // would be a second answer to a question the classification
                // has already answered.
                //
                // The `typeof` guard below is therefore not that invariant. It
                // is the same non-string floor `code` and `declaredCode` carry
                // two lines up: a producer may put anything on a thrown object,
                // and a number arriving in a string channel is the #3842 drift.
                //
                // ⛔ SCOPE: `userMessage` only. The producer's structured
                // context — the flat body's top-level `issues` — is the other
                // half of #12669 and is deliberately NOT forwarded here. The
                // nested envelope's channel for it is `ApiError.details`, so
                // mapping one onto the other is a SHAPE decision on a contract
                // field rather than a rename, and #12669 is open on it.
                const userMessage = typeof refusal.body.userMessage === 'string'
                    ? refusal.body.userMessage
                    : undefined;
                respondError(
                    res, refusal.status, code, String(refusal.body.error ?? ''),
                    {
                        ...(declaredCode !== undefined ? { declaredCode } : {}),
                        ...(userMessage !== undefined ? { userMessage } : {}),
                    },
                );
                return true;
            }
            const msg = String(error?.message ?? error ?? '');
            const map: Array<[ErrorCode, number]> = [
                ['VALIDATION_FAILED', 400],
                ['PERMISSION_DENIED', 403],
                ['NOT_FOUND', 404],
                ['CONFLICT', 409],
                ['SHARING_NOT_ENABLED', 422],
            ];
            for (const [code, status] of map) {
                if (msg.startsWith(code)) {
                    // [#12693] …and the producer's own sentence to the caller
                    // rides this arm too. ⛔ Only the sentence: the PREFIX
                    // read, the status it decides and the stripping below are
                    // untouched — see {@link sharingDeclaredExtra}.
                    respondError(
                        res, status, code,
                        msg.replace(new RegExp(`^${code}:\\s*`), ''),
                        sharingDeclaredExtra(error),
                    );
                    return true;
                }
            }
            return false;
        };
        /**
         * [#11683] The text the three 500 arms may put on the wire.
         *
         * The arms interpolate the caught error's own message, and that is
         * unchanged for every ordinary fault — `sharing-envelope.test.ts` pins
         * a plain `Error('boom')` arriving as `boom` and it still does.
         *
         * The one shape it withholds is a SANDBOX error that reached a 500 at
         * all, which after the classification above means one thing: a hook
         * body that CRASHED rather than refused (`isScriptFaultMessage`,
         * #7543). Its `.message` is the QuickJS debug wrapper and its
         * `.innerMessage` is a `TypeError: …` — the wrapper the card measured
         * leaking, wrapped around a runtime fault the caller must not read
         * either. `/data` answers that case `INTERNAL_ERROR_MESSAGE` through
         * {@link UNCLASSIFIED_FAULT}; this says the same sentence, so the leak
         * is closed on this family unconditionally rather than only for the
         * refusals the classification door catches.
         *
         * The full wrapper still reaches the operator: every caller logs the
         * whole error object immediately above its `respondError`.
         */
        const sharingFaultMessage = (error: any): string =>
            typeof error?.innerMessage === 'string' && error.innerMessage
                ? INTERNAL_ERROR_MESSAGE
                : String(error?.message ?? error).slice(0, 500);

        // GET — list shares on a record. [ADR-0111 D5] Management-gated in the
        // service: invisible record → 404, visible-but-not-manager → 403.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/:object/:id/shares`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const rows = await svc.listShares(req.params.object, req.params.id, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    if (respondSharingError(res, error)) return;
                    logError('[REST] List shares error:', error);
                    // The 500 arms keep their 500-char cap: an unexpected
                    // fault's message is not a contract, and truncating it
                    // stays a sanitization step — only the position moves.
                    respondError(
                        res, 500, 'SHARES_LIST_FAILED', sharingFaultMessage(error),
                        sharingDeclaredExtra(error),
                    );
                }
            },
            metadata: { summary: 'List per-record sharing grants', tags: ['sharing'] },
        });

        // POST — grant access. [ADR-0111 D1/D7] Authorization + posture live
        // in the service; this route only maps verdicts (403/404/422/400).
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/:id/shares`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    const input = {
                        object: req.params.object,
                        recordId: req.params.id,
                        recipientType: body.recipientType ?? body.recipient_type,
                        recipientId: body.recipientId ?? body.recipient_id,
                        accessLevel: body.accessLevel ?? body.access_level,
                        source: body.source,
                        sourceId: body.sourceId ?? body.source_id,
                        reason: body.reason,
                    };
                    const row = await svc.grant(input, context ?? {});
                    res.status(201).json(row);
                } catch (error: any) {
                    if (respondSharingError(res, error)) return;
                    logError('[REST] Grant share error:', error);
                    respondError(
                        res, 500, 'SHARE_GRANT_FAILED', sharingFaultMessage(error),
                        sharingDeclaredExtra(error),
                    );
                }
            },
            metadata: { summary: 'Grant a per-record share to a principal', tags: ['sharing'] },
        });

        // DELETE — revoke a share by id. [ADR-0111 D4] The URL's
        // (object, id) is forwarded as the revoke scope so a share id can only
        // be revoked through the record it belongs to; the service enforces
        // management authority and the manual-source rule (409).
        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/:object/:id/shares/:shareId`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    await svc.revoke(
                        req.params.shareId,
                        context ?? {},
                        { object: req.params.object, recordId: req.params.id },
                    );
                    res.status(204).end();
                } catch (error: any) {
                    if (respondSharingError(res, error)) return;
                    logError('[REST] Revoke share error:', error);
                    respondError(
                        res, 500, 'SHARE_REVOKE_FAILED', sharingFaultMessage(error),
                        sharingDeclaredExtra(error),
                    );
                }
            },
            metadata: { summary: 'Revoke a per-record share by id', tags: ['sharing'] },
        });
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
        // Sharing-rule routes live at the top of the API surface (e.g.
        // `/api/v1/sharing/rules`) — they administer rules across the whole
        // tenant rather than acting on a single CRUD object, so anchoring
        // them on `basePath` keeps them out of the `/data/:object` namespace
        // where greedy CRUD matchers would otherwise swallow them.
        const dataPath = basePath;
        const isScoped = basePath.includes('/environments/:environmentId');

        const resolveService = async (environmentId?: string) => {
            if (!this.sharingRulesServiceProvider) return undefined;
            try { return await this.sharingRulesServiceProvider(environmentId); }
            catch { return undefined; }
        };
        const respond501 = (res: any) => res.status(501).json({
            code: 'NOT_IMPLEMENTED',
            message: 'Sharing-rule service is not configured on this deployment',
        });
        const handleError = (err: any, res: any, defaultCode: string) => {
            const msg = String(err?.message ?? err ?? '');
            if (msg.startsWith('VALIDATION_FAILED')) {
                return res.status(400).json({ code: 'VALIDATION_FAILED', error: msg.replace(/^VALIDATION_FAILED:\s*/, '') });
            }
            // [ADR-0111 D6] The service gates every verb on `manage_sharing`
            // (enforced there so non-REST callers are covered too) — map its
            // verdict rather than burying it in a 500.
            if (msg.startsWith('PERMISSION_DENIED')) {
                return res.status(403).json({ code: 'PERMISSION_DENIED', error: msg.replace(/^PERMISSION_DENIED:\s*/, '') });
            }
            if (msg.startsWith('RULE_NOT_FOUND')) {
                return res.status(404).json({ code: 'RULE_NOT_FOUND', error: msg.replace(/^RULE_NOT_FOUND:?\s*/, '') });
            }
            // [ADR-0111 D7 / #8207] `POST .../evaluate` reconciles through
            // `SharingService.grant`, whose inertness guard now runs for the
            // evaluator's system context too. A rule pointed at an object no
            // sharing gate consults therefore refuses here instead of silently
            // materialising rows nothing reads — and the admin who asked for
            // the evaluation needs to be told WHICH object and WHY, not handed
            // an opaque 500. Same code→status pair the per-record shares routes
            // already publish (`respondSharingError`), so no new contract.
            //
            // ⚠️ Built through the SHARED `sendError` envelope, unlike the three
            // arms above it. Those are the flat dialect — `code` beside `error`
            // instead of inside it, so `body.error.code` reads `undefined` —
            // held down by the `check:route-envelope` ratchet, which only ticks
            // DOWN. A new arm copying its neighbours' shape is exactly what that
            // ratchet exists to stop, so this one answers the envelope
            // `BaseResponseSchema` declares. The asymmetry is the ratchet
            // working; converting the other three is outstanding envelope-
            // position work owned by that ratchet, not a rider on this card.
            //
            // ⚠️ Two card citations stood here and both were stale by the time
            // anyone read them: #7035 closed 2026-08-10 (PR #7293, three `/meta`
            // 501 handlers), and #8111 closed 2026-08-12 (PR #8212) having
            // converged the record-sharing family it named. The ratchet's own
            // baseline is the live owner of what is left; a closed card number
            // is not.
            if (msg.startsWith('SHARING_NOT_ENABLED')) {
                return sendEnvelopeError(
                    res, 422, 'SHARING_NOT_ENABLED',
                    msg.replace(/^SHARING_NOT_ENABLED:\s*/, ''),
                );
            }
            logError(`[REST] sharing-rule ${defaultCode}:`, err);
            return res.status(500).json({ code: defaultCode, error: msg.slice(0, 500) });
        };

        // LIST
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/sharing/rules`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    // [#6877] `object` reached `listRules` as an array; a
                    // repeated `?activeOnly=true` stopped matching and listed the
                    // INACTIVE rules too.
                    if (refuseRepeatedQueryParams(req, res, ['object', 'activeOnly'])) return;
                    const rows = await svc.listRules({
                        object: req.query?.object,
                        activeOnly: req.query?.activeOnly === 'true' || req.query?.activeOnly === true,
                    }, context ?? {});
                    res.json({ data: rows });
                } catch (err: any) { handleError(err, res, 'RULE_LIST_FAILED'); }
            },
            metadata: { summary: 'List sharing rules', tags: ['sharing'] },
        });

        // CREATE / UPSERT
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/sharing/rules`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    // Field-by-field pluck (not a schema parse): the authoring
                    // spec shape — CEL `condition` + `sharedWith{type,value}` —
                    // is not the runtime shape this endpoint takes, so unknown
                    // keys are dropped rather than rejected. [#3896] That made
                    // a typo (`criterias`) indistinguishable from "no criteria",
                    // which used to mean "share every record". `defineRule` now
                    // refuses a match-all criteria, so the typo surfaces as a
                    // 400 naming the field instead of a silent 201.
                    const input = {
                        name: body.name,
                        label: body.label,
                        description: body.description,
                        object: body.object ?? body.object_name,
                        criteria: body.criteria ?? body.criteria_json,
                        recipientType: body.recipientType ?? body.recipient_type,
                        recipientId: body.recipientId ?? body.recipient_id,
                        accessLevel: body.accessLevel ?? body.access_level,
                        active: body.active,
                    };
                    const row = await svc.defineRule(input, context ?? {});
                    res.status(201).json(row);
                } catch (err: any) { handleError(err, res, 'RULE_DEFINE_FAILED'); }
            },
            metadata: { summary: 'Create or upsert a sharing rule', tags: ['sharing'] },
        });

        // GET
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/sharing/rules/:idOrName`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const row = await svc.getRule(req.params.idOrName, context ?? {});
                    if (!row) return res.status(404).json({ code: 'RULE_NOT_FOUND' });
                    res.json(row);
                } catch (err: any) { handleError(err, res, 'RULE_GET_FAILED'); }
            },
            metadata: { summary: 'Get a sharing rule by id or name', tags: ['sharing'] },
        });

        // DELETE
        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/sharing/rules/:idOrName`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    await svc.deleteRule(req.params.idOrName, context ?? {});
                    res.status(204).end();
                } catch (err: any) { handleError(err, res, 'RULE_DELETE_FAILED'); }
            },
            metadata: { summary: 'Delete a sharing rule and its materialised grants', tags: ['sharing'] },
        });

        // EVALUATE
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/sharing/rules/:idOrName/evaluate`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const result = await svc.evaluateRule(req.params.idOrName, context ?? {});
                    res.json(result);
                } catch (err: any) { handleError(err, res, 'RULE_EVALUATE_FAILED'); }
            },
            metadata: { summary: 'Re-evaluate a sharing rule and reconcile grants', tags: ['sharing'] },
        });
    }

    /**
     * Register the security admin endpoints (ADR-0090 D5/D9) — suggested
     * audience bindings. A package permission set declaring `isDefault: true`
     * is an install-time SUGGESTION to bind it to the `everyone` position;
     * these routes surface pending suggestions and let a tenant admin resolve
     * them. The `security` service (plugin-security) does the real gating:
     * tenant-admin pre-check on all three, and confirm writes the binding
     * with the caller's execution context so the audience-anchor and
     * delegated-admin gates enforce it — never auto-bound, never system.
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
        const dataPath = basePath;
        const isScoped = basePath.includes('/environments/:environmentId');

        const resolveService = async (environmentId?: string) => {
            if (!this.securityServiceProvider) return undefined;
            try {
                const svc = await this.securityServiceProvider(environmentId);
                return svc && typeof svc.listAudienceBindingSuggestions === 'function' ? svc : undefined;
            } catch { return undefined; }
        };
        /**
         * The ONE refusal emitter for this route family (#7981) — every arm
         * goes through it, so "the three answer the same shape" is a property
         * of the code rather than of three literals that happen to agree.
         * `refuseRepeatedQueryParams` writes the identical body from
         * `query-multiplicity.ts`; that helper is shared with the whole file
         * and stays the reference point rather than being re-implemented here.
         */
        const respondError = (res: any, status: number, code: string, message: string) =>
            res.status(status).json({ error: { code, message } });
        const respond501 = (res: any) => respondError(
            res, 501, 'NOT_IMPLEMENTED', 'Security service is not configured on this deployment',
        );
        const handleError = (err: any, res: any, defaultCode: string) => {
            const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
            if (status !== 500) {
                // The typed arm: plugin-security's PermissionDeniedError (403),
                // SuggestionNotFoundError (404) and SuggestionStateError (409)
                // each carry `code` + `statusCode`. The status mapping is
                // unchanged — only the position of the code moves.
                return respondError(res, status, err?.code ?? defaultCode, String(err?.message ?? err));
            }
            logError(`[REST] suggested-bindings ${defaultCode}:`, err);
            // The 500 arm keeps its 500-char cap: an unexpected fault's message
            // is not a contract, and truncating it stays a sanitization step.
            return respondError(res, 500, defaultCode, String(err?.message ?? err).slice(0, 500));
        };

        // LIST (reconciles against installed packages / declared sets first)
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/security/suggested-bindings`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    // [#6877] Both are `String(array)` joins — `?status=a&status=b`
                    // filtered on the single status `'a,b'` and returned nothing.
                    if (refuseRepeatedQueryParams(req, res, ['status', 'packageId'])) return;
                    // [#7678] …and a single well-formed but UNKNOWN `?status=`
                    // did the same thing one layer on: the service's contract
                    // declares exactly three values, anything else matched no
                    // row, and the caller got 200 with an empty list — which
                    // reads as "there are no suggestions" rather than "your
                    // filter was not a status". The runtime dispatcher's twin of
                    // this route had refused it since #4127; this live route
                    // never did. Same predicate, imported — not a second copy of
                    // the vocabulary.
                    const status = req.query?.status ? String(req.query.status) : undefined;
                    if (status !== undefined && !isAudienceBindingSuggestionStatus(status)) {
                        // [#7981] Same body as before — emitted through the
                        // shared helper now, so this arm is the reference
                        // point by construction instead of by coincidence.
                        return respondError(
                            res, 400, 'VALIDATION_ERROR',
                            unknownAudienceBindingSuggestionStatusMessage(status),
                        );
                    }
                    const result = await svc.listAudienceBindingSuggestions(context ?? {}, {
                        status,
                        packageId: req.query?.packageId ? String(req.query.packageId) : undefined,
                    });
                    res.json({ data: result });
                } catch (err: any) { handleError(err, res, 'SUGGESTION_LIST_FAILED'); }
            },
            metadata: { summary: 'List suggested audience bindings (ADR-0090 D5/D9)', tags: ['security'] },
        });

        // CONFIRM — creates the anchor binding as the caller (gated write)
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/security/suggested-bindings/:id/confirm`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const result = await svc.confirmAudienceBindingSuggestion(context ?? {}, String(req.params.id));
                    res.json({ data: result });
                } catch (err: any) { handleError(err, res, 'SUGGESTION_CONFIRM_FAILED'); }
            },
            metadata: { summary: 'Confirm a suggested audience binding (creates the everyone/guest binding)', tags: ['security'] },
        });

        // DISMISS — records the admin's decline; nothing is bound
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/security/suggested-bindings/:id/dismiss`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const result = await svc.dismissAudienceBindingSuggestion(context ?? {}, String(req.params.id));
                    res.json({ data: result });
                } catch (err: any) { handleError(err, res, 'SUGGESTION_DISMISS_FAILED'); }
            },
            metadata: { summary: 'Dismiss a suggested audience binding', tags: ['security'] },
        });

        /**
         * [field report — rc→GA declared≠enforced surfacing] The sanctioned,
         * audited operator action: discard a stale `sys_metadata` overlay
         * shadowing a package-declared `sys_permission_set` (the
         * `overlay_shadow` diagnostic on the record — see
         * `permission-set-drift.ts`). Bound to `sys_permission_set`'s
         * "Discard Overlay" Setup action (`{id}` route param, same
         * convention as `/data/sys_permission_set/{id}`). Refuses (403) on a
         * set that is not currently package-declared — see
         * `permission-set-overlay-discard.ts`'s eligibility note — and 409s
         * when there is no active overlay to discard.
         *
         *   POST {basePath}/security/permission-sets/:id/discard-overlay
         */
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/security/permission-sets/:id/discard-overlay`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc || typeof svc.discardPermissionSetOverlay !== 'function') return respond501(res);
                    const result = await svc.discardPermissionSetOverlay(context ?? {}, String(req.params.id));
                    res.json({ data: result });
                // 'INTERNAL' (registered, generic — ADR-0112) is the default here
                // deliberately, not a bespoke `..._FAILED` code: this route's typed
                // errors (`PermissionSetNotFoundError` 404, `PermissionSetOverlayStateError`
                // 409, `PermissionDeniedError` 403) already carry their own registered
                // `code`, which `handleError`'s `status !== 500` arm reads ahead of this
                // default — this string is reached only by a genuinely unexpected fault,
                // and a NEW route-specific code for that arm is a `packages/spec` ledger
                // entry this change deliberately does not make.
                } catch (err: any) { handleError(err, res, 'INTERNAL'); }
            },
            metadata: { summary: 'Discard a stale environment overlay shadowing a package-declared permission set (ADR-0094)', tags: ['security'] },
        });
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
        // Approval routes live at the top of the API surface (e.g.
        // `/api/v1/approvals/requests/:id/approve`). Approvals are a
        // cross-cutting capability — a request is not a record on a single
        // CRUD object, so anchoring it on `basePath` (instead of
        // `${basePath}/data`) keeps the URL semantics honest.
        const dataPath = basePath;
        const isScoped = basePath.includes('/environments/:environmentId');

        const resolveService = async (environmentId?: string) => {
            if (!this.approvalsServiceProvider) return undefined;
            try { return await this.approvalsServiceProvider(environmentId); }
            catch { return undefined; }
        };
        const respond501 = (res: any) => res.status(501).json({
            code: 'NOT_IMPLEMENTED',
            message: 'Approvals service is not configured on this deployment',
        });
        const handleApprovalError = (res: any, err: any): boolean => {
            const msg = String(err?.message ?? err ?? '');
            const mapping: Array<[RegExp, number, string]> = [
                [/^VALIDATION_FAILED/, 400, 'VALIDATION_FAILED'],
                [/^DUPLICATE_REQUEST/, 409, 'DUPLICATE_REQUEST'],
                [/^INVALID_STATE/, 409, 'INVALID_STATE'],
                [/^THROTTLED/, 429, 'THROTTLED'],
                [/^FORBIDDEN/, 403, 'FORBIDDEN'],
                [/^REQUEST_NOT_FOUND/, 404, 'REQUEST_NOT_FOUND'],
                // #4420 — the request and its flow run disagree about whether
                // the work can still proceed. A conflict, like INVALID_STATE:
                // the row is fine, the run behind it is not.
                [/^RESUME_TARGET_LOST/, 409, 'RESUME_TARGET_LOST'],
                // The outcome IS recorded and its run is stranded — a genuine
                // server-side inconsistency, but named, so the client can say
                // which run needs an operator instead of showing a bare 500.
                [/^RESUME_FAILED/, 500, 'RESUME_FAILED'],
                // The write IS recorded and NOT rolled back, but the updated
                // row is invisible inside the caller's organization scope, so
                // the result envelope cannot be built. Same class as
                // RESUME_FAILED — a genuine server-side inconsistency, named
                // (commit 5b3ff63cc): read the request back with a system or
                // matching-organization context.
                [/^READ_BACK_FAILED/, 500, 'READ_BACK_FAILED'],
            ];
            // [#13807, maintainer ruling 2026-09-04 batch #37] The
            // machine-readable half of a stranded decision, when the service
            // attached one. The status code does NOT move — a recorded
            // decision whose run strands is still a failure and the ruling
            // upholds that — but the body stops being prose only: `finalized`
            // says the decision stands, `decision` / `runId` name what and
            // where, and `repairable` carries the engine's own `'stranded'`
            // discriminator through instead of dying at the door.
            //
            // Before this, a caller reading 500 had exactly one honest move —
            // assume the rejection did not happen — and it was the wrong one:
            // the row IS terminal and the record's mirrored status HAS moved.
            // An operator had to regex the run id out of a sentence.
            //
            // ⛔ Presence-gated, never synthesised. `strandedDecisionDetails`
            // returns `undefined` for any error that did not carry a complete
            // envelope, and this then answers exactly the body it always did —
            // a `RESUME_FAILED` from a caller with no decision to report must
            // not be dressed up as one.
            const stranded = strandedDecisionDetails(err);
            for (const [re, status, code] of mapping) {
                if (re.test(msg)) {
                    // [#13095] The strip is anchored to the CODE this row just
                    // answered — the same declared-code anchoring
                    // `withoutDeclaredCodePrefix` (error-response.ts) and
                    // `respondSharingError`'s prefix arm apply, converged here
                    // by the 2026-08-31 ruling. The blanket
                    // SCREAMING_SNAKE-colon regex that used to sit here
                    // (`/^[A-Z_]+:\s*/`) is exactly the shape #12975 rejected:
                    // it could eat a token the wire carries nowhere else (a
                    // message opening with a DIFFERENT capitalised word and a
                    // colon), where the anchored form can only ever remove a
                    // duplicate of the `code` already on the wire.
                    res.status(status).json({
                        code,
                        error: msg.replace(new RegExp(`^${code}:\\s*`), ''),
                        // Anchored to the code the envelope describes, for the
                        // same reason the strip above is: these four facts are
                        // about a recorded-decision-with-stranded-run and
                        // about nothing else.
                        ...(code === 'RESUME_FAILED' && stranded ? stranded : {}),
                    });
                    return true;
                }
            }
            return false;
        };

        // ── Requests ──────────────────────────────────────────────
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/approvals/requests`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) {
                        // No approvals plugin loaded — return empty list rather than 501
                        // so Console badge polls don't spam the error log on deployments
                        // that don't run an approvals workflow.
                        res.json({ data: [] });
                        return;
                    }
                    // [#7527] The closed parameter set for this route, measured
                    // from what the handler below actually reads. A name outside
                    // it is REFUSED, never dropped: `?assignedToMe=true` used to
                    // answer 200 with the whole list, and an ignored filter is
                    // indistinguishable from one that matched everything. Paging
                    // (`limit`/`offset`) and the snake_case alias spellings are
                    // in the set because the handler honours them — a whitelist
                    // built from the filters alone would break paging.
                    if (refuseUnknownQueryParams(req, res, APPROVAL_REQUEST_LIST_PARAMS)) return;
                    // [#6877] `approverId` / `approver_id` are the model case
                    // for the multi-valued side and are therefore NOT listed:
                    // the block immediately below reads their array arm ON
                    // PURPOSE. Everything else here narrows the list to one
                    // value and is declared single-valued.
                    if (refuseRepeatedQueryParams(req, res, [
                        'object', 'recordId', 'record_id', 'status',
                        'submitterId', 'submitter_id', 'q', 'limit', 'offset',
                    ])) return;
                    const q = req.query ?? {};
                    // `approverId` accepts a single id, a comma-separated
                    // list, or the param repeated (→ array). Normalise all
                    // three to a string[] so the Console can resolve "my
                    // pending approvals" across every identity (user id /
                    // email / role:<r>) in ONE request rather than looping.
                    const rawApprover = q.approverId ?? q.approver_id;
                    const approverIds = (Array.isArray(rawApprover) ? rawApprover : (rawApprover != null ? [rawApprover] : []))
                        .flatMap((s: any) => String(s).split(','))
                        .map((s: string) => s.trim())
                        .filter(Boolean);
                    // [#20139] Read, not coerced. `?limit=abc` (or `Infinity`) was
                    // `NaN`, dropped by an `isFinite` guard, and answered with the
                    // UNPAGED 500-row window and no `total` — a caller asking for a
                    // page got a different shape of answer; `?offset=abc` was dropped
                    // to the first page. `?limit=` / `?offset=` became `Number('')` =
                    // 0: a ONE-row page, or the service's 50-row paged mode the caller
                    // never asked for — so empty is refused here, not read as absent.
                    // No request schema is declared for this door, so both read as
                    // whole numbers; the service's own `[1, 200]` clamp is unchanged.
                    //
                    // Caught HERE, not by the catch below: that one answers every
                    // throw `500 APPROVAL_REQUEST_LIST_FAILED`, and a query value the
                    // door cannot read is the caller's `400`.
                    let limit: number | undefined;
                    let offset: number | undefined;
                    try {
                        limit = readDeclaredQueryNumber(q, 'limit',
                            UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: false });
                        offset = readDeclaredQueryNumber(q, 'offset',
                            UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: false });
                    } catch (refusal: any) {
                        handleRouteError(res, refusal);
                        return;
                    }
                    const listFilter = {
                        object: q.object,
                        recordId: q.recordId ?? q.record_id,
                        status: q.status,
                        approverId: approverIds.length ? approverIds : undefined,
                        submitterId: q.submitterId ?? q.submitter_id,
                        q: typeof q.q === 'string' ? q.q : undefined,
                        limit,
                        offset,
                    };
                    const rows = await svc.listRequests(listFilter, context ?? {});
                    // `total` only when the caller pages — counting costs a
                    // second query and unpaged callers don't need it.
                    if (listFilter.limit != null && typeof svc.countRequests === 'function') {
                        const total = await svc.countRequests(listFilter, context ?? {});
                        res.json({ data: rows, total });
                        return;
                    }
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List approval requests error:', error);
                    res.status(500).json({ code: 'APPROVAL_REQUEST_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List approval requests', tags: ['approvals'] },
        });

        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/approvals/requests/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const row = await svc.getRequest(req.params.id, context ?? {});
                    if (!row) {
                        res.status(404).json({ code: 'REQUEST_NOT_FOUND', error: `Approval request '${req.params.id}' not found` });
                        return;
                    }
                    res.json(row);
                } catch (error: any) {
                    logError('[REST] Get approval request error:', error);
                    res.status(500).json({ code: 'APPROVAL_REQUEST_GET_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Get an approval request by id', tags: ['approvals'] },
        });

        // Record a decision on a node-driven request. Both branches funnel
        // through the contract's `decide()`, which finalizes the request and
        // resumes the owning flow run down the matching `approve` / `reject`
        // edge.
        //
        // On the `actorId` these routes forward (#3800): it is a HINT, not the
        // acting identity. The service pins the actor to the authenticated
        // caller and accepts a body value only when it can prove the caller
        // holds that identity — a slot keyed by a `type:value` literal or by
        // the caller's email, which the Console legitimately sends. It is
        // forwarded rather than dropped for exactly those cases; naming anyone
        // else is `FORBIDDEN` at the service, never here.
        const decisionRoute = (decision: 'approve' | 'reject') => {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/approvals/requests/:id/${decision}`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const svc = await resolveService(environmentId);
                        if (!svc) return respond501(res);
                        const body = req.body ?? {};
                        try {
                            const out = await svc.decide(req.params.id, {
                                decision,
                                actorId: body.actorId ?? body.actor_id ?? context?.userId,
                                comment: body.comment,
                                attachments: body.attachments,
                                // #3447 P2: author-declared decision outputs — the
                                // service validates keys against the node's
                                // `decisionOutputs` whitelist before any write.
                                outputs: body.outputs,
                            }, context ?? {});
                            res.json(out);
                        } catch (err: any) {
                            if (handleApprovalError(res, err)) return;
                            throw err;
                        }
                    } catch (error: any) {
                        logError(`[REST] ${decision} approval error:`, error);
                        res.status(500).json({ code: `APPROVAL_${decision.toUpperCase()}_FAILED`, error: String(error?.message ?? error).slice(0, 500) });
                    }
                },
                metadata: { summary: `${decision[0].toUpperCase()}${decision.slice(1)} an approval request`, tags: ['approvals'] },
            });
        };
        decisionRoute('approve');
        decisionRoute('reject');

        // Recall — submitter withdraws a pending request. Mirrors the decision
        // routes' error mapping; the service enforces submitter-only access.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/approvals/requests/:id/recall`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc || typeof svc.recall !== 'function') return respond501(res);
                    const body = req.body ?? {};
                    try {
                        const out = await svc.recall(req.params.id, {
                            actorId: body.actorId ?? body.actor_id ?? context?.userId,
                            comment: body.comment,
                        }, context ?? {});
                        res.json(out);
                    } catch (err: any) {
                        if (handleApprovalError(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] recall approval error:', error);
                    res.status(500).json({ code: 'APPROVAL_RECALL_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Recall (withdraw) an approval request', tags: ['approvals'] },
        });

        // Send back for revision / resubmit (ADR-0044). Both move the flow (the
        // request finalizes `returned` and the run parks at a wait point; a
        // resubmit re-enters the approval node), so — like recall — they are
        // dedicated routes rather than thread interactions. The service enforces
        // access (send-back = a pending approver; resubmit = the submitter) and
        // returns the flow outcome (`autoRejected` / `resumed`) verbatim.
        const flowMoveRoute = (
            action: 'revise' | 'resubmit',
            invoke: (svc: any, id: string, body: any, context: any) => Promise<unknown>,
        ) => {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/approvals/requests/:id/${action}`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const svc = await resolveService(environmentId);
                        if (!svc) return respond501(res);
                        const body = req.body ?? {};
                        try {
                            const out = await invoke(svc, req.params.id, body, context ?? {});
                            res.json(out);
                        } catch (err: any) {
                            if (handleApprovalError(res, err)) return;
                            throw err;
                        }
                    } catch (error: any) {
                        logError(`[REST] ${action} approval error:`, error);
                        res.status(500).json({ code: `APPROVAL_${action.toUpperCase()}_FAILED`, error: String(error?.message ?? error).slice(0, 500) });
                    }
                },
                metadata: { summary: `${action} an approval request`, tags: ['approvals'] },
            });
        };
        flowMoveRoute('revise', (svc, id, body, context) => {
            if (typeof svc.sendBack !== 'function') throw new Error('VALIDATION_FAILED: revise is not supported');
            return svc.sendBack(id, {
                actorId: body.actorId ?? body.actor_id ?? context?.userId,
                comment: body.comment,
            }, context);
        });
        flowMoveRoute('resubmit', (svc, id, body, context) => {
            if (typeof svc.resubmit !== 'function') throw new Error('VALIDATION_FAILED: resubmit is not supported');
            return svc.resubmit(id, {
                actorId: body.actorId ?? body.actor_id ?? context?.userId,
                comment: body.comment,
            }, context);
        });

        // Thread interactions — reassign / remind / request-info / comment.
        // None of these move the flow; they update approver slots or the
        // audit thread. Registered generically: the service method enforces
        // the per-action permission (slot holder / submitter / participant).
        const threadRoute = (
            action: 'reassign' | 'remind' | 'request-info' | 'comment',
            invoke: (svc: any, id: string, body: any, context: any) => Promise<unknown>,
        ) => {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/approvals/requests/:id/${action}`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const svc = await resolveService(environmentId);
                        if (!svc) return respond501(res);
                        const body = req.body ?? {};
                        try {
                            const out = await invoke(svc, req.params.id, body, context ?? {});
                            res.json(out);
                        } catch (err: any) {
                            if (handleApprovalError(res, err)) return;
                            throw err;
                        }
                    } catch (error: any) {
                        logError(`[REST] ${action} approval error:`, error);
                        res.status(500).json({ code: `APPROVAL_${action.toUpperCase().replace('-', '_')}_FAILED`, error: String(error?.message ?? error).slice(0, 500) });
                    }
                },
                metadata: { summary: `${action} on an approval request`, tags: ['approvals'] },
            });
        };
        threadRoute('reassign', (svc, id, body, context) => {
            if (typeof svc.reassign !== 'function') throw new Error('VALIDATION_FAILED: reassign is not supported');
            return svc.reassign(id, {
                actorId: body.actorId ?? body.actor_id ?? context?.userId,
                to: body.to, from: body.from, comment: body.comment,
            }, context);
        });
        threadRoute('remind', (svc, id, body, context) => {
            if (typeof svc.remind !== 'function') throw new Error('VALIDATION_FAILED: remind is not supported');
            return svc.remind(id, {
                actorId: body.actorId ?? body.actor_id ?? context?.userId,
                comment: body.comment,
            }, context);
        });
        threadRoute('request-info', (svc, id, body, context) => {
            if (typeof svc.requestInfo !== 'function') throw new Error('VALIDATION_FAILED: request-info is not supported');
            return svc.requestInfo(id, {
                actorId: body.actorId ?? body.actor_id ?? context?.userId,
                comment: body.comment,
            }, context);
        });
        threadRoute('comment', (svc, id, body, context) => {
            if (typeof svc.comment !== 'function') throw new Error('VALIDATION_FAILED: comment is not supported');
            return svc.comment(id, {
                actorId: body.actorId ?? body.actor_id ?? context?.userId,
                comment: body.comment,
                attachments: body.attachments,
            }, context);
        });

        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/approvals/requests/:id/actions`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const rows = await svc.listActions(req.params.id, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List approval actions error:', error);
                    res.status(500).json({ code: 'APPROVAL_ACTIONS_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List actions (audit trail) for an approval request', tags: ['approvals'] },
        });
    }

    /**
     * Register batch operation endpoints
     */
    private registerBatchEndpoints(basePath: string): void {
        const { crud, batch } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;
        const isScoped = basePath.includes('/environments/:environmentId');

        const operations = batch.operations;
        // [#3939] One cap, read once, applied by every bulk route below via
        // {@link enforceBatchSize} — see that method for why it lives here and
        // not in the Zod schemas.
        const maxBatch = batch.maxBatchSize ?? 200;

        // POST /batch — cross-object transactional batch (issue #1604 / ADR-0034).
        // Runs heterogeneous create/update/delete across objects in ONE engine
        // transaction (commit all or roll back all). Intra-batch references: a
        // field value of `{ $ref: <earlier op index> }` resolves to that op's
        // created id, so a child can reference its parent (master-detail). The
        // request is validated against the spec contract, and each op is gated by
        // the SAME per-object API-exposure rules (enable.apiEnabled / apiMethods)
        // as the single-record routes before any transaction is opened.
        this.routeManager.register({
            method: 'POST',
            path: `${basePath}/batch`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    // [#18559] The engine seam, reached the way its two SIBLING
                    // consumers of this same slot already reach it —
                    // `wiredEngineOrLoud` — so "no engine is wired" and "the
                    // engine WAS wired and could not be resolved" stay two facts
                    // instead of being told apart only by accident. The retired
                    // spelling this replaces was a plain read:
                    //
                    //     this.objectQLProvider ? await this.objectQLProvider(environmentId) : undefined
                    //
                    // ⚠️ It did NOT re-collapse them — that is why this is not a
                    // regression and was not a blocker for #14251's decidable
                    // test. A rejection escaped the plain read, missed the 501
                    // arm below (which tests `!ql || typeof ql.transaction !==
                    // 'function'`, and a rejection never reaches it), and was
                    // caught by this handler's GENERIC outer catch
                    // (`handleRouteError`). So the two facts did differ on the
                    // wire — 500 INTERNAL_ERROR against 501 NOT_IMPLEMENTED —
                    // but through a catch-all that knows nothing about this
                    // seam, at a status this slot's other two consumers do not
                    // use for the same fact.
                    //
                    // ⭐ What decided it, measured on a real `RestServer` over a
                    // real `ObjectKernel` rather than argued: THIS DOOR ALREADY
                    // ANSWERS 503 on the single-kernel wiring. There
                    // `computeExecCtx` takes its PROVIDER branch, which is
                    // `wiredEngineOrLoud`, and raises before this line runs. The
                    // 500 was reachable only on the MULTI-KERNEL wiring, where
                    // the gate's kernel branch absorbs by design (see
                    // `wiredEngineOrLoud`'s RESIDUE note) and hands the engine
                    // question down to this line:
                    //
                    // | wiring, engine wired and FAILING | before | after |
                    // |:--|:--|:--|
                    // | single-kernel (gate raises first)| 503    | 503 — unchanged |
                    // | multi-kernel (gate absorbs)      | **500**| **503** |
                    //
                    // ⇒ the repair does not choose a new wire answer for this
                    // door; it removes a WIRING-DEPENDENT divergence, leaving
                    // the answer this door already gave on the composition the
                    // open core boots.
                    //
                    // ⛔ NOT `seamOrUndefined`. That helper SWALLOWS, and its own
                    // docblock forbids routing the data-engine seam back through
                    // it "to make the seams uniform".
                    //
                    // The wiring fact is the provider's PRESENCE, asked once and
                    // never inferred from what it returned, so both ABSENCE
                    // shapes reach the 501 below byte-for-byte as before: no
                    // provider wired at all, and a provider that RESOLVES
                    // `undefined`, which is the seam contract declaring absence
                    // rather than failing. `wiredEngineOrLoud` also invokes the
                    // provider SYNCHRONOUSLY, so a host wiring a non-`async`
                    // provider — which the seam's declared type cannot prevent —
                    // reaches the same answer as one that rejects (commit add6a1b1c).
                    const ql = await wiredEngineOrLoud(
                        Boolean(this.objectQLProvider),
                        () => this.objectQLProvider!(environmentId),
                    );
                    if (!ql || typeof ql.transaction !== 'function') {
                        // Typed like every other 501 on this server (clone/search,
                        // #4067) so a client can key on the code, not the prose.
                        res.status(501).json({ error: 'Transactional batch not supported by this runtime', code: 'NOT_IMPLEMENTED' });
                        return;
                    }

                    // Validate the request against the spec contract (Zod-First).
                    const { CrossObjectBatchRequestSchema } = await import('@objectstack/spec/api');
                    const parsed = (CrossObjectBatchRequestSchema as any).safeParse(req.body ?? {});
                    if (!parsed.success) {
                        res.status(400).json({ error: 'Invalid batch request', code: 'VALIDATION_FAILED', issues: parsed.error?.issues });
                        return;
                    }
                    const ops: Array<{ object: string; action: 'create' | 'update' | 'delete'; id?: string; data?: Record<string, any> }> = parsed.data.operations;
                    // All-or-nothing by construction: refuse a request that asks for
                    // non-atomic semantics rather than silently applying atomically
                    // (honest contract). Per-object partial batches use the
                    // POST /data/:object/batch route instead.
                    if (parsed.data.atomic === false) {
                        res.status(400).json({ error: 'Cross-object batch is always atomic; use POST /data/:object/batch for non-atomic per-object batches', code: 'BATCH_NOT_ATOMIC' });
                        return;
                    }
                    if (ops.length === 0) { res.json({ results: [] }); return; }
                    // [#3939] Same check, same envelope as every other bulk route
                    // now — this one used to be the only one that capped at all,
                    // and it answered without a `code` for clients to key on.
                    if (this.enforceBatchSize(res, ops.length, maxBatch)) return;

                    // update/delete need a target id — the schema can't express this
                    // conditionally, so surface it as a 400 up front.
                    for (const op of ops) {
                        if ((op.action === 'update' || op.action === 'delete') && op.id == null && op.data?.id == null) {
                            res.status(400).json({ error: `Operation '${op.action}' on '${op.object}' requires an id`, code: 'VALIDATION_FAILED' });
                            return;
                        }
                    }

                    // Enforce object-level API exposure (enable.apiEnabled /
                    // apiMethods) for EVERY op BEFORE opening the transaction — the
                    // batch write surface must honour the same per-object gate as the
                    // single-record routes (ADR-0049 / #1889). Metadata is fetched
                    // once; each distinct (object, action) is checked once.
                    const p = await this.resolveProtocol(environmentId, req);
                    const items = await this.loadObjectItems(p, environmentId);
                    if (items.length > 0) {
                        const byName = new Map<string, any>(items.map((o: any) => [o?.name, o]));
                        const checked = new Set<string>();
                        for (const op of ops) {
                            const key = `${op.object}\u0000${op.action}`;
                            if (checked.has(key)) continue;
                            checked.add(key);
                            const obj = byName.get(op.object);
                            if (!obj) continue; // unknown object → surfaced by the op inside the tx
                            // [#3391] Cross-object batch is a bulk surface: gate each op
                            // as `bulk ∧ child(op.action)` — the object must grant the
                            // `bulk` primitive AND the specific write it performs.
                            const denial = apiAccessDenialFromEnable(obj.enable, op.object, 'bulk', { bulkChild: op.action });
                            if (denial) { res.status(denial.status).json(denial.body); return; }
                        }
                    }

                    // Resolve `{ $ref: <opIndex> }` values against results collected
                    // so far. A ref MUST point at an earlier create whose id is known;
                    // anything else is a 400 (never a silent null FK).
                    const resolveRefs = (data: any, out: any[]): any => {
                        if (!data || typeof data !== 'object') return data;
                        const result: any = Array.isArray(data) ? [] : {};
                        for (const [k, v] of Object.entries(data)) {
                            if (v && typeof v === 'object' && '$ref' in (v as any)) {
                                const idx = (v as any).$ref;
                                const ref = typeof idx === 'number' ? out[idx] : undefined;
                                const refId = ref && (ref.id ?? ref._id);
                                if (refId == null) {
                                    const err: any = new Error(`Unresolved $ref ${JSON.stringify(idx)} on field '${k}' — must reference an earlier create in the same batch`);
                                    err.status = 400;
                                    err.code = 'BATCH_UNRESOLVED_REF';
                                    throw err;
                                }
                                result[k] = refId;
                            } else {
                                result[k] = v;
                            }
                        }
                        return result;
                    };

                    // [#3794] Write-observability on THIS surface too. The engine
                    // strips `readonly` / `readonlyWhen` writes silently, and every
                    // other write path already reports what it dropped (#3431/#3455)
                    // — but this one did not, and it is precisely the path the
                    // console's record form takes for a master-detail save. Result:
                    // a user edited a `readonlyWhen`-locked field, got "updated
                    // successfully", and the value never changed with nothing said
                    // (#3794 problem 2). Each event is tagged with its operation
                    // index, since `results` entries are bare record echoes with no
                    // envelope to hang a per-row list on.
                    const dropped: Array<DroppedFieldsEvent & { index: number }> = [];
                    const results = await ql.transaction(async (trxCtx: any) => {
                        const out: any[] = [];
                        for (const [index, op] of ops.entries()) {
                            const data = resolveRefs(op.data, out);
                            if (op.action === 'create') {
                                // [#3835] Go through the protocol's create ingress —
                                // the SAME one `POST /data/:object` uses — rather than
                                // calling `ql.insert` directly. When this was written the
                                // #3043 static-`readonly` strip lived at that ingress and
                                // a direct `ql.insert` bypassed it, so `readonly` meant
                                // two different things on two create paths. Since the
                                // maintainer ruling of 2026-09-03 (option C, #14147) the
                                // strip runs inside `engine.insert` for every non-system
                                // caller, so both routes are stripped identically, and the
                                // platform-object carve-out (a `sys_`/`managedBy` object's
                                // own guard must REJECT a forged value, not silently
                                // swallow it) is the engine's as well. The routing stands
                                // on what the ingress still owns: the #3770 object-
                                // existence gate, the #7823 `internal: true` response
                                // strip and the `droppedFields` relay — one create
                                // ingress, one response contract, and a future change to
                                // its policy covers the batch for free. `trxCtx` carries
                                // the caller's context (including `isSystem`) plus the
                                // open transaction, so the engine's strip decides exactly
                                // as it does on the single route and the insert still
                                // joins this transaction.
                                const batchCreateRequest: ServerScopedDataRequest<CreateDataRequest> = {
                                    object: op.object, data, context: trxCtx,
                                };
                                const created: any = await p.createData(batchCreateRequest);
                                for (const e of (created?.droppedFields ?? []) as DroppedFieldsEvent[]) {
                                    dropped.push({ ...e, index });
                                }
                                out.push(created?.record);
                            } else if (op.action === 'update') {
                                // Update needs no ingress detour for the WRITE half:
                                // the engine enforces both static `readonly` (#2948)
                                // and `readonlyWhen` (#3042) on its own update path,
                                // and reports them through this listener.
                                const onFieldsDropped = (e: DroppedFieldsEvent) => { dropped.push({ ...e, index }); };
                                const id = op.id ?? data?.id;
                                const updated = await ql.update(op.object, { ...data, id }, { context: trxCtx, onFieldsDropped });
                                // [#7823] …but the RESPONSE half moved to the ingress
                                // (A-prime ruling, 2026-08-13): the engine keeps its
                                // write results whole, so this direct-`ql.update`
                                // mouth applies the shared write-response rules
                                // itself (credential-class mask, then `internal`
                                // omit) before the row rides `results` out. Called
                                // from `@objectstack/core` directly — never through
                                // an optional protocol method, which a protocol
                                // without it would skip silently. FAIL CLOSED: with
                                // no registered schema to judge the fields by, only
                                // the id is echoed.
                                const updateSchema = (ql as any).registry?.getObject?.(op.object);
                                if (!updateSchema) {
                                    out.push(updated && typeof updated === 'object' ? { id: (updated as any).id ?? id } : updated);
                                } else {
                                    omitInternalFieldsFromWriteResponse(updateSchema, updated);
                                    out.push(updated);
                                }
                            } else { // 'delete'
                                out.push(await ql.delete(op.object, { where: { id: op.id }, context: trxCtx }));
                            }
                        }
                        return out;
                    }, context);

                    res.json({ results, ...(dropped.length > 0 ? { droppedFields: dropped } : {}) });
                } catch (error: any) {
                    // Log only genuine server faults; client 4xx (validation,
                    // unresolved ref, atomic rollback of a bad op) are expected.
                    // This site used to judge on `status >= 500` alone, which
                    // also swallowed the un-coded 400 `mapDataError` degrades an
                    // UNRECOGNISED error to — a handler `TypeError` inside a
                    // batch transaction vanished here. The shared predicate
                    // keeps that one loud while staying quiet on the coded 4xx.
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Cross-object transactional batch (atomic create/update/delete across objects)',
                tags: ['data', 'batch'],
            },
        });

        // POST /data/:object/batch - Generic batch endpoint
        if (batch.enableBatchEndpoint && this.protocol.batchData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/batch`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // [#3391] bulk ∧ child(body.operation) — the object must grant
                        // the `bulk` primitive AND the batched write kind.
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', { bulkChild: req.body?.operation })) return;
                        // [#3899] Validate against the declared contract
                        // (`BatchUpdateRequestSchema`, catalog `requestSchema`) —
                        // this route used to hand the body straight to the
                        // protocol, so `{ operation: 'updat', records: {} }`
                        // reached the engine as-is. Validation only: the ORIGINAL
                        // body is forwarded, not the parse output, so
                        // `BatchOptionsSchema`'s defaults (e.g. `atomic: true`)
                        // are not injected into a request that never sent them.
                        const { BatchUpdateRequestSchema } = await import('@objectstack/spec/api');
                        const batchInput = req.body ?? {};
                        const parsedBatch = (BatchUpdateRequestSchema as any).safeParse(batchInput);
                        if (!parsedBatch.success) {
                            res.status(400).json({
                                error: 'Invalid batch request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedBatch.error?.issues, batchInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        // [#3939] Cap AFTER the shape check, so a caller gets the
                        // more specific answer first.
                        if (this.enforceBatchSize(res, parsedBatch.data.records.length, maxBatch, req.params?.object)) return;
                        const batchRequest: ServerScopedDataRequest<BatchDataRequest> = {
                            object: req.params.object,
                            request: req.body,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.batchData!(batchRequest);
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Batch operations',
                    tags: ['data', 'batch'],
                },
            });
        }

        // POST /data/:object/createMany - Bulk create
        if (operations.createMany && this.protocol.createManyData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/createMany`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // [#3391] bulk ∧ create — createMany requires the `bulk` primitive.
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', { bulkChild: 'create' })) return;
                        // [#3899] Body IS the records array on this route (what
                        // `client.data.createMany` posts). Validate the assembled
                        // protocol request (`CreateManyDataRequestSchema`, catalog
                        // `requestSchema`) so `{ records: [...] }` — updateMany's
                        // envelope, an easy cross-route slip — or any other
                        // non-array body 400s instead of reaching the engine as a
                        // single garbage "record".
                        const { CreateManyDataRequestSchema } = await import('@objectstack/spec/api');
                        const createManyInput = { object: req.params.object, records: req.body ?? [] };
                        const parsedCreateMany = (CreateManyDataRequestSchema as any).safeParse(createManyInput);
                        if (!parsedCreateMany.success) {
                            res.status(400).json({
                                error: 'Invalid createMany request — the body must be a JSON array of record objects',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedCreateMany.error?.issues, createManyInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        // [#3939] Cap AFTER the shape check.
                        if (this.enforceBatchSize(res, parsedCreateMany.data.records.length, maxBatch, req.params?.object)) return;
                        const createManyRequest: ServerScopedDataRequest<CreateManyDataRequest> = {
                            object: req.params.object,
                            records: req.body || [],
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.createManyData!(createManyRequest);
                        res.status(201).json(result);
                    } catch (error: any) {
                        handleRouteError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Create multiple records',
                    tags: ['data', 'batch'],
                },
            });
        }

        // POST /data/:object/updateMany - Bulk update
        if (operations.updateMany && this.protocol.updateManyData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/updateMany`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // [#3391] bulk ∧ update — updateMany requires the `bulk` primitive.
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', { bulkChild: 'update' })) return;
                        // [#3933] Validate against the spec contract, and write the
                        // PATH object last. The body used to be spread over
                        // `object: req.params.object`, so `{"object":"other", …}`
                        // moved the write to a different object than the one
                        // `enforceApiAccess` had just cleared — that gate reads
                        // `req.params.object`, so `enable.apiEnabled` / `apiMethods`
                        // (ADR-0049) was enforced on A while B was written. Zod also
                        // strips unknown keys, which keeps a body `context` from
                        // becoming the execution context on a deployment where none
                        // resolves (e.g. an anonymous public-book read, #3963).
                        const { UpdateManyDataRequestSchema } = await import('@objectstack/spec/api');
                        const updateManyInput = { ...(req.body ?? {}), object: req.params.object };
                        const parsedUpdate = UpdateManyDataRequestSchema.safeParse(updateManyInput);
                        if (!parsedUpdate.success) {
                            res.status(400).json({
                                error: 'Invalid updateMany request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedUpdate.error?.issues, updateManyInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        // [#3939] Cap AFTER the shape check, so a caller gets the
                        // more specific answer first.
                        if (this.enforceBatchSize(res, parsedUpdate.data.records.length, maxBatch, req.params?.object)) return;
                        const updateManyRequest: ServerScopedDataRequest<UpdateManyDataRequest> = {
                            ...parsedUpdate.data,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.updateManyData!(updateManyRequest);
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Update multiple records',
                    tags: ['data', 'batch'],
                },
            });
        }

        // POST /data/:object/deleteMany - Bulk delete
        if (operations.deleteMany && this.protocol.deleteManyData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/deleteMany`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // [#3391] bulk ∧ delete — deleteMany requires the `bulk` primitive.
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', { bulkChild: 'delete' })) return;
                        // [#3897] Validate against the spec contract instead of
                        // splatting the raw body into the protocol request. Zod
                        // object schemas STRIP unknown keys, which is what makes
                        // this a security boundary and not just an error message:
                        // `options` is narrowed to `BatchOptions`, so a body key
                        // (`options.where`, `options.multi`) can no longer ride
                        // into the engine's delete options, and a top-level
                        // `context` can no longer forge the caller's principal on
                        // a route reachable without auth. The protocol layer
                        // refuses the same shapes independently (defence in
                        // depth) — this stops them one hop earlier, with a 400
                        // the caller can act on.
                        // [#3933] The PATH object is written LAST for the same
                        // reason: `enforceApiAccess` gates on `req.params.object`,
                        // so a body `object` would move the delete to an object
                        // whose exposure policy was never checked.
                        const { DeleteManyDataRequestSchema } = await import('@objectstack/spec/api');
                        const deleteManyInput = { ...(req.body ?? {}), object: req.params.object };
                        const parsed = DeleteManyDataRequestSchema.safeParse(deleteManyInput);
                        if (!parsed.success) {
                            res.status(400).json({
                                error: 'Invalid deleteMany request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsed.error?.issues, deleteManyInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        // [#3939] The cap that matters most: since #3897 this
                        // route deletes per id, so the list length IS the engine
                        // round-trip count.
                        if (this.enforceBatchSize(res, parsed.data.ids.length, maxBatch, req.params?.object)) return;
                        const deleteManyRequest: ServerScopedDataRequest<DeleteManyDataRequest> = {
                            ...parsed.data,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result = await p.deleteManyData!(deleteManyRequest);
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Delete multiple records',
                    tags: ['data', 'batch'],
                },
            });
        }
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
