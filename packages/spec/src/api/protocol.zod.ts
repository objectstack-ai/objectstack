// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ViewSchema } from '../ui/view.zod';
import { DiscoverySchema } from './discovery.zod';
import {
  BatchUpdateRequestSchema,
  BatchUpdateResponseSchema,
  UpdateManyRequestSchema,
  DeleteManyRequestSchema,
} from './batch.zod';
import { MetadataCacheRequestSchema, MetadataCacheResponseSchema } from './http-cache.zod';
import { QuerySchema, QUERY_DISTINCT_REMOVED } from '../data/query.zod';
import { retiredKey } from '../shared/retired-key';
import { DroppedFieldsEventSchema } from '../data/data-engine.zod';
import { 
  AnalyticsQueryRequestSchema,  
  AnalyticsResultResponseSchema, 
  GetAnalyticsMetaRequestSchema, 
  AnalyticsMetadataResponseSchema 
} from './analytics.zod';
import { RealtimePresenceSchema, TransportProtocol } from './realtime.zod';
import { ObjectPermissionSchema, EffectiveObjectPermissionSchema, FieldPermissionSchema } from '../security/permission.zod';
import { ActionDescriptorSchema } from '../automation/node-executor.zod';
import { TranslationDataSchema } from '../system/translation.zod';
// #5950 / #5882 — the ADR-0010 read-side protection envelope both metadata-item
// responses publish. Same three vocabularies the resolver filters against, so a
// value this spec cannot name is a value the resolver would have dropped.
import {
  MetadataLockSchema,
  MetadataLockSourceSchema,
  MetadataProvenanceSchema,
} from '../kernel/metadata-protection.zod';
import { MetadataValidationResultSchema } from '../kernel/metadata-plugin.zod';
import {
  ListPackagesRequestSchema,
  ListPackagesResponseSchema,
  GetPackageRequestSchema,
  GetPackageResponseSchema,
  InstallPackageRequestSchema,
  InstallPackageResponseSchema,
  UninstallPackageRequestSchema,
  UninstallPackageResponseSchema,
  EnablePackageRequestSchema,
  EnablePackageResponseSchema,
  DisablePackageRequestSchema,
  DisablePackageResponseSchema,
} from '../kernel/package-registry.zod';
import type {
  ListPackagesRequest,
  ListPackagesResponse,
  GetPackageRequest,
  GetPackageResponse,
  InstallPackageRequest,
  InstallPackageResponse,
  UninstallPackageRequest,
  UninstallPackageResponse,
  EnablePackageRequest,
  EnablePackageResponse,
  DisablePackageRequest,
  DisablePackageResponse,
  InstalledPackage,
  PackageStatus,
} from '../kernel/package-registry.zod';

import { lazySchema } from '../shared/lazy-schema';
export const AutomationTriggerRequestSchema = lazySchema(() => z.object({
  trigger: z.string(),
  payload: z.record(z.string(), z.unknown())
}));

export const AutomationTriggerResponseSchema = lazySchema(() => z.object({
  success: z.boolean(),
  jobId: z.string().optional(),
  result: z.unknown().optional()
}));

/**
 * Response for `GET /api/v1/automation/actions` (ADR-0018).
 *
 * Returns the live action/node registry — the platform's built-in actions plus
 * any plugin-contributed ones — backing the designer palette and flow
 * validation. Each entry is a canonical {@link ActionDescriptorSchema}.
 */
export const AutomationActionsResponseSchema = lazySchema(() => z.object({
  actions: z.array(ActionDescriptorSchema).describe('Registered action descriptors (built-in + plugin)'),
  total: z.number().int().nonnegative().describe('Number of descriptors returned (after any filters)'),
}));

/**
 * ObjectStack Protocol - Zod Schema Definitions
 * 
 * Defines the runtime-validated contract for interacting with ObjectStack metadata and data.
 * Used by API adapters (HTTP, WebSocket, gRPC) to fetch data/metadata without knowing engine internals.
 * 
 * This protocol enables:
 * - Runtime request/response validation at API gateway level
 * - Automatic API documentation generation
 * - Type-safe RPC communication between microservices
 * - Client SDK generation from schemas
 * 
 * Architecture Alignment:
 * - Salesforce: REST API Request/Response schemas
 * - Kubernetes: API Resource schemas with runtime validation
 * - GraphQL: Schema-first API design
 */

// ==========================================
// Discovery & Metadata Operations
// ==========================================

/**
 * Get API Discovery Request
 * No parameters needed
 */
export const GetDiscoveryRequestSchema = lazySchema(() => z.object({}));

/**
 * Get API Discovery Response
 * Derived from DiscoverySchema (single source of truth) for protocol-level use.
 * 
 * All fields from DiscoverySchema are available but made optional (except `version`)
 * to support progressive disclosure and backward compatibility with existing clients.
 * 
 * - `routes` provides a flat endpoint map for client routing.
 * - `services` is the single source of truth for service availability.
 * - `apiName` is kept as an optional alias for `name` for backward compatibility.
 *
 * ## This schema is the CLIENT's tolerance, never a producer's licence (#4828)
 *
 * `.partial()` exists so a client can parse an OLDER server's response without
 * exploding, and zod's default unknown-key strip lets it parse a NEWER one.
 * That tolerance is correct at this boundary and wrong as a producer contract —
 * and for a long time it was the only schema anything referenced, so it acted
 * as both. The result was `declared ≠ enforced` in both directions at once:
 * `getDiscovery()` never emitted the required `name`/`environment`/`locale` and
 * still parsed clean, while the runtime dispatcher emitted `features` and
 * `endpoints` — declared nowhere — and also parsed clean.
 *
 * So the two schemas now have separate jobs, and a gate compares them:
 *
 * - **{@link DiscoverySchema} is authoritative for PRODUCERS.** Every producer's
 *   live shape must satisfy it (`packages/metadata-protocol`, `packages/runtime`
 *   and `packages/rest` each carry a `discovery-schema-conformance.test.ts`).
 * - **This schema is the CONSUMER's parse**, and its key set is the allowance
 *   those producer gates check against — i.e. `DiscoverySchema`'s keys plus the
 *   declared deprecated aliases. `./discovery.test.ts` pins that equivalence, so
 *   a key can never again appear on one side only.
 *
 * ## `apiName` retirement schedule (ADR-0087)
 *
 * `apiName` is the sole surviving deprecated alias here. `name` is canonical and
 * REQUIRED by `DiscoverySchema`; as of protocol 17 every producer emits `name`,
 * and `getDiscovery()` additionally emits `apiName` with the identical value so
 * clients pinned to the alias keep working.
 *
 * - **Protocol 17 (now)**: both emitted; `name` canonical, `apiName` deprecated.
 * - **Protocol 18**: producers stop emitting `apiName` and it is removed from
 *   this schema. Consumers migrate to `name` — a pure rename with no semantic
 *   change, which is why it needs no D2 conversion entry (that table converts
 *   AUTHORED metadata at load; a response payload has no load seam).
 *
 * Consumers to migrate before 18 — measured 2026-08-05 across `objectstack`,
 * `objectui` and `cloud`: `packages/client/tests/integration/01-discovery.test.ts`
 * (TC-DISC-001/002). No product code in any of the three repos reads `apiName`.
 *
 * @see DiscoverySchema in ./discovery.zod.ts — the canonical definition.
 */
export const GetDiscoveryResponseSchema = lazySchema(() => DiscoverySchema
  .partial()
  .required({ version: true })
  .extend({
    /**
     * @deprecated Use `name` instead. Removed in protocol 18 — see the
     * retirement schedule above. Emitted alongside `name` until then.
     */
    apiName: z.string().optional().describe('API name (deprecated — use `name`; removed in protocol 18)'),
  }));

/**
 * Get Metadata Types Request
 */
export const GetMetaTypesRequestSchema = lazySchema(() => z.object({}));

/**
 * Get Metadata Types Response
 *
 * Phase 3a-1: returns the bare `types` array (for backwards compatibility)
 * plus rich per-type `entries` describing label, domain, file patterns, and
 * runtime capability flags. Admin UIs (Metadata Directory, Resource list,
 * Quick Find) consume `entries`; legacy code that only needs the type list
 * keeps using `types`.
 */
export const GetMetaTypesResponseSchema = lazySchema(() => z.object({
  types: z.array(z.string()).describe('Available metadata type names (e.g., "object", "plugin", "view")'),
  entries: z.array(z.object({
    type: z.string().describe('Singular type identifier'),
    label: z.string().describe('Human-readable label'),
    description: z.string().optional().describe('Brief description'),
    filePatterns: z.array(z.string()).describe('Glob patterns used to discover artifacts of this type'),
    supportsOverlay: z.boolean().describe('Loader can merge per-org overlays on top of artifact'),
    allowOrgOverride: z.boolean().describe('Per-org overlay writes accepted at runtime (may be env-elevated)'),
    allowRuntimeCreate: z.boolean().describe('New artifacts of this type can be created via runtime API'),
    supportsVersioning: z.boolean().describe('History is tracked for this type'),
    executionPinned: z.boolean().describe('Runtime transactions pin a specific historical version_hash (ADR-0009)'),
    loadOrder: z.number().int().describe('Loading priority (lower = earlier)'),
    domain: z.enum(['data', 'ui', 'automation', 'system', 'security', 'ai']).describe('Protocol domain'),
    overrideSource: z.enum(['registry', 'env']).describe('Whether allowOrgOverride is set in the static registry or via OS_METADATA_WRITABLE env var'),
    createSeed: z.unknown().optional().describe('Authoritative minimal valid create seed for this type — Studio/CLI/API derive create defaults from it (single source of truth in @objectstack/spec). Absent for canvas-create types whose shape is built interactively.'),
  })).optional().describe('Enriched per-type registry entries (Phase 3a)'),
}));

/**
 * Get Metadata Items Request
 * Get all items of a specific metadata type
 */
export const GetMetaItemsRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name (e.g., "object", "plugin")'),
  packageId: z.string().optional().describe('Optional package ID to filter items by'),
  organizationId: z.string().optional().describe(
    'Organization (tenant) scope for the read. Selects the org partition in the '
    + 'ADR-0005 overlay read order — org overlay wins over env-wide overlay wins '
    + 'over packaged artifact — so it decides which tenant\'s customization rows '
    + 'are merged into the list. Absent = environment-wide read: only env-level '
    + 'overlays apply and no org partition is consulted.',
  ),
}));

/**
 * Get Metadata Items Response
 */
export const GetMetaItemsResponseSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  items: z.array(z.unknown()).describe('Array of metadata items'),
}));

/**
 * Get Metadata Item Request
 * Get a specific metadata item by type and name
 */
export const GetMetaItemRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name (snake_case identifier)'),
  packageId: z.string().optional().describe('Optional package ID to filter items by'),
  organizationId: z.string().optional().describe(
    'Organization (tenant) scope for the read. Selects the org partition in the '
    + 'ADR-0005 overlay read order — org overlay wins over env-wide overlay wins '
    + 'over packaged artifact — so it decides which tenant\'s customization row '
    + 'is served as the item. Absent = environment-wide read: only env-level '
    + 'overlays apply and no org partition is consulted.',
  ),
}));

/**
 * ADR-0010 read-side protection envelope — the flags a metadata READ publishes
 * alongside the document, all derived from one `resolveLockState()` call.
 *
 * These are the UN-prefixed, envelope-level counterparts of the `_lock` /
 * `_provenance` fields `MetadataProtectionFields` splices into the document
 * itself: the document stores `_lock`, and the read RESOLVES it into `lock`
 * plus the three `editable` / `deletable` / `resettable` verdicts Studio
 * renders affordances from (ADR-0010 §5), so no consumer re-implements the
 * lock algebra.
 *
 * Shared by {@link GetMetaItemResponseSchema} and
 * {@link GetMetaItemLayeredResponseSchema} — both are produced by the SAME
 * `resolveLockState` call in `metadata-protocol`, so a mixin is what keeps the
 * two declarations from drifting apart key by key. Module-local on purpose: it
 * is a shape these two responses share, not a new public vocabulary.
 *
 * Every key is optional HERE and tightened per-response where the producer
 * guarantees presence — see each schema's note. Optionality is measured, not
 * assumed: the six `lockReason` … `packageVersion` keys are spread only when
 * `!== undefined` (they read off `_`-prefixed document fields that are
 * themselves optional), so they are conditional on EVERY path.
 */
const MetadataProtectionEnvelopeFields = {
  lock: MetadataLockSchema.optional().describe(
    'Resolved lock verdict for this item (ADR-0010 §3.3). `none` means unlocked; '
    + '`no-overlay` / `no-delete` / `full` refuse the corresponding write with '
    + '403 `ITEM_LOCKED`. Resolved from the document\'s `_lock`, with the packaged '
    + 'artifact winning over any org overlay.',
  ),
  lockReason: z.string().optional().describe(
    'Human-readable explanation shown next to a refused write. Present only when '
    + 'the resolved item declares `_lockReason`.',
  ),
  lockSource: MetadataLockSourceSchema.optional().describe(
    'Which layer asserted the lock. Present only when the resolved item declares '
    + '`_lockSource`.',
  ),
  lockDocsUrl: z.string().optional().describe(
    'Documentation link surfaced beside `lockReason`. Present only when the '
    + 'resolved item declares `_lockDocsUrl`.',
  ),
  provenance: MetadataProvenanceSchema.optional().describe(
    'Where the item came from (package | org | env-forced). Present only when the '
    + 'resolved item declares `_provenance`.',
  ),
  packageId: z.string().optional().describe(
    'Owning package machine id. Present only when the resolved item declares '
    + '`_packageId`.',
  ),
  packageVersion: z.string().optional().describe(
    'Owning package version. Present only when the resolved item declares '
    + '`_packageVersion`.',
  ),
  editable: z.boolean().optional().describe(
    'Whether an overlay write is permitted — false iff `lock` is `no-overlay` or '
    + '`full`. A derived verdict: do not recompute it from `lock` client-side.',
  ),
  deletable: z.boolean().optional().describe(
    'Whether deleting the overlay is permitted — false iff `lock` is `no-delete` '
    + 'or `full`.',
  ),
  resettable: z.boolean().optional().describe(
    'Whether the item can be reset to its packaged default — true iff it is '
    + 'artifact-backed, i.e. there is a baseline to reset TO.',
  ),
} as const;

/**
 * Get Metadata Item Response
 *
 * Describes the FULL body `GET /api/v1/meta/:type/:name` can return, not the
 * three-key subset it used to claim (#5950 — the read-side twin of the write-side
 * gap #5745 closed on {@link SaveMetaItemResponseSchema}).
 *
 * The declaration stopped at `{ type, name, item }` while the uncached branch
 * served ten more keys: the ADR-0010 protection envelope, spread onto the wire
 * verbatim by the REST layer (`rest-server.ts`'s `translateMetaEnvelope` does
 * `{ ...envelope, item }`). `lock` in particular is the read half of the ADR-0008
 * optimistic-concurrency story the write half already declares — so an SDK caller
 * typed against this response could not see it, and reading it meant a cast, the
 * consumer-side tolerance this repo rejects by Prime Directive #12.
 *
 * **Why every protection key is optional, measured rather than assumed.** This
 * route reaches a body by two branches and they publish different amounts:
 *
 * - **cached** (`getMetaItemCached`, THE DEFAULT — `enableCache` defaults to
 *   `true`): the REST layer rebuilds the envelope as `{ type, name, item }` and
 *   deliberately resolves NO lock — it is the fast published-value path and
 *   never consults the lock resolver (`rest-server.ts`, the `cachedEnvelope`
 *   note). All ten keys are ABSENT.
 * - **uncached** (`getMetaItem`): `lock`, `editable`, `deletable` and
 *   `resettable` are always set; the other six appear only when the resolved
 *   document carries the corresponding `_`-prefixed field.
 *
 * So `optional` here means "this deployment/branch did not publish it", NEVER
 * "unlocked" — a consumer that needs the OCC carriers must read the uncached
 * path and must not read absence as `lock: 'none'`. Declaring them required
 * would make the default deployment's own response fail its own contract, which
 * is the #5563 defect in mirror image.
 *
 * ⚠️ This is a DECLARATION change only — zero runtime behaviour is altered. That
 * lock presence depends on a server-side cache setting is a separate, larger
 * question (#5950 says so explicitly) and is deliberately NOT decided here.
 */
export const GetMetaItemResponseSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name'),
  item: z.unknown().describe('Metadata item definition'),
  ...MetadataProtectionEnvelopeFields,
}));

/**
 * Get Metadata Item — LAYERED Request
 *
 * Request shape for `GET /api/v1/meta/:type/:name/layers` (the
 * `getMetaItemLayered` protocol method). Mirrors the implementation's
 * parameter type in `@objectstack/metadata-protocol` member for member — a
 * declared-surface catch-up, not a new capability: the verb and every member
 * here already ship and are enforced.
 */
export const GetMetaItemLayeredRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name'),
  packageId: z.string().optional().describe(
    'Optional package ID — scopes the `code` layer so a same-name collision '
    + 'resolves to the requested package\'s artifact (ADR-0048).',
  ),
  organizationId: z.string().optional().describe(
    'Organization (tenant) scope for the read. Selects the org partition in the '
    + 'ADR-0005 overlay read order, so it decides which tenant\'s customization '
    + 'row is reported as the `overlay` layer (and merged into `effective`). '
    + 'Absent = environment-wide read: `overlay` reports the env-level row only.',
  ),
}));

/**
 * Get Metadata Item — LAYERED Response
 *
 * The body of `GET /api/v1/meta/:type/:name/layers`: a three-layer diagnostic
 * projection that shows the packaged baseline, the tenant's customization row
 * and the merged result SIDE BY SIDE, which is what drives Studio's
 * "code default vs override vs effective" comparison tabs.
 *
 * **Why this is a separate schema on a separate path** (#5882, ruled B by the
 * maintainer 2026-08-06). This projection used to be reached by putting
 * `?layers=true` on the ordinary read, so one route answered two unrelated
 * resource representations while `packages/spec` declared only one of them —
 * anything generating a client from the route table (SDK annotations, codegen,
 * an AI-written integration) produced a parser that was simply wrong for the
 * flagged call. Collapsing the three layers into
 * {@link GetMetaItemResponseSchema}'s single `item` was never an option: seeing
 * the layers apart IS the diagnostic. The rejected alternative was teaching the
 * route declaration to express "two shapes, chosen by query flag"; that adds a
 * new primitive every future tool must understand, and conditional response
 * selection is precisely where codegen and AI clients go wrong. One path, one
 * response shape — so the projection got its own path.
 *
 * The `?layers=` flag still answers this same body during its deprecation
 * window, marked with `Deprecation` / `Link` response headers.
 *
 * **Required vs optional, measured against the producer.** Unlike the ordinary
 * read there is exactly ONE producer path here (`getMetaItemLayered`; the
 * layered view deliberately skips the cache), so the four resolved verdicts
 * `lock` / `editable` / `deletable` / `resettable` are ALWAYS set and are
 * required below. The six conditional protection keys stay optional for the
 * same reason they are optional on the ordinary read.
 */
export const GetMetaItemLayeredResponseSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name (canonical singular)'),
  name: z.string().describe('Item name'),
  code: z.unknown().describe(
    'LAYER 1 — the packaged artifact baseline exactly as shipped, before any '
    + 'tenant customization. `null` when no artifact ships this item (it exists '
    + 'only as an overlay).',
  ),
  overlay: z.unknown().describe(
    'LAYER 2 — the stored customization row ALONE, not merged with `code`. '
    + '`null` when this tenant has not customized the item.',
  ),
  overlayScope: z.enum(['org', 'env']).nullable().describe(
    'Which scope the `overlay` row was read from — `org` for a tenant overlay, '
    + '`env` for an environment-level one. `null` exactly when `overlay` is null.',
  ),
  effective: z.unknown().describe(
    'LAYER 3 — the merged result, i.e. the value an ordinary '
    + '`GET /meta/:type/:name` would return under `item`. `null` when the item '
    + 'resolves to nothing at all.',
  ),
  _diagnostics: MetadataValidationResultSchema.optional().describe(
    'Load-time spec-validation verdict for `effective`, so the Studio edit page '
    + 'can raise invalid-metadata banners and inline field errors without a '
    + 'second round trip. ABSENT for metadata types that register no Zod schema '
    + '(function / service / router) — absence means "no opinion", never "valid".',
  ),
  ...MetadataProtectionEnvelopeFields,
  // The four resolved verdicts are unconditional on this single-producer path —
  // tightened from the mixin's optional baseline. See the note above.
  lock: MetadataLockSchema.describe(
    'Resolved lock verdict (ADR-0010 §3.3), artifact winning over overlay. Always '
    + 'present on this path.',
  ),
  editable: z.boolean().describe('Whether an overlay write is permitted. Always present on this path.'),
  deletable: z.boolean().describe('Whether deleting the overlay is permitted. Always present on this path.'),
  resettable: z.boolean().describe('Whether the item can be reset to its packaged default. Always present on this path.'),
}));

/**
 * One finding from the #4463 runtime authoring gate — the fourth door.
 *
 * The gate runs the SHARED author-time rule registry (`@objectstack/lint`'s
 * `AUTHORING_RULES`, the same table `os validate` / `os build` / `os lint` run)
 * over a body about to go `active`, and partitions its findings by severity.
 * The `error` half becomes the 422 `invalid_metadata` envelope's `issues[]`;
 * the rest are ADVISORY — they do not block the write, and #4463 D3 decided
 * they ride the 2xx response instead of being discarded.
 *
 * This is that ONE element shape, declared once and used by both halves, which
 * is the whole point of D3's "reuse the Zod envelope": a consumer reads the
 * same six keys whether the verdict arrived on a refusal or on a success.
 * `@objectstack/metadata-protocol` re-exports this type as its
 * `RuntimeAuthoringIssue` rather than declaring a second interface (#4717).
 */
export const RuntimeAuthoringIssueSchema = lazySchema(() => z.object({
  rule: z.string().describe(
    'Stable diagnostic rule id (`flow-multi-write-unfiltered`, '
    + '`approval-expression-invalid`, …). Machine-readable and stable across '
    + 'releases — the key a renderer groups or suppresses by.',
  ),
  path: z.string().describe(
    'Config path inside the SUBMITTED body (`flows[0].nodes[1].config.multi`), '
    + 'so an editor can jump to the offending key. May be empty when the '
    + 'finding is about the item as a whole.',
  ),
  where: z.string().describe(
    'Human-readable location — `flow "leave_approval" · node "approve"`. Prose '
    + 'for a person; use `path` for anything mechanical.',
  ),
  message: z.string().describe('What is wrong, in the rule author\'s own words.'),
  hint: z.string().describe('How to fix it.'),
  severity: z.enum(['error', 'warning', 'info']).describe(
    'How the gate treated this finding. `error` means the write was REFUSED '
    + '(these appear on the 422, never on a 2xx); `warning` / `info` are '
    + 'advisory — the write succeeded and the finding is FYI.',
  ),
}));

/**
 * Save Metadata Item Request
 * Create or update a metadata item
 */
export const SaveMetaItemRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name'),
  item: z.unknown().describe('Metadata item definition'),
}));

/**
 * Save Metadata Item Response
 *
 * Describes the FULL body `PUT /api/v1/meta/:type/:name` returns, not a subset
 * of it (#5745, settled by the #5563 maintainer ruling "补齐 spec 字段"). The
 * declaration previously stopped at `{ success, message }`, so a `.parse()` of
 * a real response silently STRIPPED `version` / `seq` / `state` — and
 * `SaveMetaItemResponse` could not even name them at the type level. `version`
 * in particular is the token the ADR-0008 optimistic-concurrency chain already
 * runs on (echo it back as `If-Match` on the next write to get a 409 instead of
 * a lost update), so leaving it undeclared meant the OCC carrier existed on the
 * wire with no contract behind it.
 *
 * Presence was measured against `origin/main`, not assumed: the sole producer is
 * `ObjectStackProtocolImplementation.saveMetaItem`, whose single success return
 * is the repository write path, and the REST route hands that object to
 * `res.json()` verbatim. That path always sets `version` / `seq` / `state`, so
 * the three are REQUIRED here; `projectionApplied` is conditional on an
 * ADR-0094 mutation projector being registered for the type, so it alone is
 * optional. (A second, receipt-less legacy return used to exist and would have
 * forced all three to be optional — it was proved unreachable and deleted in
 * #5264 / PR #5782, which is why `required` is safe to state.)
 */
export const SaveMetaItemResponseSchema = lazySchema(() => z.object({
  success: z.boolean(),
  version: z.string().describe(
    'Content hash of the just-committed body, and the token the ADR-0008 '
    + 'optimistic-concurrency chain runs on: send it back as the `If-Match` '
    + 'request header on the next write to that item and a concurrent edit is '
    + 'reported as 409 `metadata_conflict` instead of silently overwritten. '
    + 'Opaque to callers — echo it verbatim, never parse it. Currently emitted '
    + 'as `sha256:<64 hex chars>`, but the format is not part of this contract.',
  ),
  seq: z.number().int().describe(
    'Monotonic sequence number of the metadata event this write appended to '
    + 'the item history (sys_metadata_history.event_seq). Orders writes; unlike '
    + '`version` it is not an OCC token.',
  ),
  state: z.enum(['draft', 'active']).describe(
    'Lifecycle the body was written into: "draft" when the request asked for '
    + 'draft mode (`?mode=draft`), otherwise "active" (published and live). A '
    + 'draft is staged only — it is not served to the runtime until published.',
  ),
  projectionApplied: z.object({
    success: z.boolean().describe('False when the projector threw; the metadata write itself still succeeded.'),
    error: z.string().optional().describe('Projector failure message, present only when `success` is false.'),
  }).optional().describe(
    'Outcome of the awaited ADR-0094 mutation projector — the post-persist step '
    + 'that materializes this metadata into its derived data-plane read model '
    + '(e.g. `permission` → `sys_permission_set`). Present ONLY when a projector '
    + 'is registered for this metadata type, which is why it is optional: its '
    + 'absence means "no projector ran", never "the projection failed". '
    + 'Best-effort by design — a projector failure is reported here and logged, '
    + 'never thrown, so a caller that needs the read model to be live must check '
    + '`projectionApplied.success` rather than rely on the 200.',
  ),
  advisories: z.array(RuntimeAuthoringIssueSchema).optional().describe(
    'Non-gating findings from the #4463 runtime authoring gate — the same '
    + 'shared author-time rules `os validate` / `os build` / `os lint` run, '
    + 'applied to this body on its way to `active`. The write SUCCEEDED; these '
    + 'are what the gate has to say about it anyway (#4717, closing #4463 D3). '
    + 'Present ONLY when at least one advisory was raised — an empty array is '
    + 'never emitted, so a clean save\'s response bytes are unchanged and '
    + 'absence means "nothing to report", never "the gate did not run". '
    + 'Advisory by construction: every entry has `severity` `warning` or '
    + '`info`, because an `error` finding refuses the write and arrives as the '
    + '422 `invalid_metadata` envelope instead of here. A caller that ignores '
    + 'this key behaves exactly as before. Runtime-only: the CLI surfaces the '
    + 'same findings on its own stdout, and a Studio / MCP / AI author has no '
    + 'CLI at all, which is the gap #4463 exists to close. The gate runs on '
    + 'both write doors (#4463 D1), and both report: '
    + '`POST /meta/:type/:name/publish` carries the same key on '
    + '`PublishMetaItemResponseSchema` (#9176).',
  ),
  message: z.string().optional(),
}));

/**
 * Publish Metadata Item Response
 *
 * Describes the FULL body `POST /api/v1/meta/:type/:name/publish` returns
 * (#7294 — the #5745 discipline carried one door over). The publish door is the
 * sibling write surface of the save door: `saveMetaItem` writes a body, and
 * `publishMetaItem` promotes an already-written DRAFT body to `active`. Until
 * this declaration the route was served with no contract behind it at all —
 * the string `PublishMetaItem` appeared nowhere under `packages/spec/src/`, so
 * `version` here sat in exactly the undeclared state `version` on the save
 * response sat in before #5745, despite being the same ADR-0008
 * optimistic-concurrency token with the same "echo it back as `If-Match`" job.
 *
 * Presence was measured against `origin/main`, not assumed. The sole producer
 * is `ObjectStackProtocolImplementation.publishMetaItem`, which builds ONE
 * response object and the REST route hands it to `res.json()` verbatim. That
 * object literal always sets `success` / `version` / `seq`, so the three are
 * REQUIRED; the three `*Applied` receipts are each attached only when the
 * corresponding side effect ran, so each is optional — and their absence means
 * "that side effect did not run", NEVER "it failed".
 *
 * **The three conditional receipts, and what makes each conditional**
 * (`runPublishSideEffects`, phase 2 of the ADR-0067 D2 split):
 *
 * - `seedApplied` — only when the published type is `seed`. Publishing a seed
 *   is what makes its rows live, so the row materialization rides along.
 * - `materializeApplied` — only when an ADR-0086 P2 publish materializer is
 *   registered for the type (e.g. `permission` → `sys_permission_set`).
 * - `projectionApplied` — only when an ADR-0094 mutation projector is
 *   registered for the type. Same field, same meaning, as on
 *   {@link SaveMetaItemResponseSchema}: both write doors run the projector.
 *
 * All three are **best-effort by contract**: publishing the metadata always
 * succeeds independently, and a side-effect failure is SURFACED here rather
 * than thrown. So `success: true` on the envelope does not mean the data plane
 * caught up — a caller that needs it live must read the receipt's own
 * `success`, which is why every receipt carries one.
 *
 * **`advisories` is the fourth conditional key** (#9176, mirroring #4717 one
 * door over): the #4463 runtime authoring gate runs on BOTH write doors by
 * D1 — a draft→active promotion is gated exactly as a direct active save —
 * and its non-blocking findings ride the 2xx of whichever door earned it.
 * Until #9176 only the save door reported; the promotion call site received
 * the gate's advisory return and discarded it, which mattered precisely
 * because Studio's designer takes draft-then-publish on every edit, so the
 * one door its authors actually use was the one that said nothing.
 */
export const PublishMetaItemResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe(
    'Always true on a 2xx — the draft was promoted. It does NOT cover the '
    + 'best-effort side effects below, each of which reports its own `success`.',
  ),
  version: z.string().describe(
    'Content hash of the just-promoted body, and the token the ADR-0008 '
    + 'optimistic-concurrency chain runs on: send it back as the `If-Match` '
    + 'request header on the next write to that item and a concurrent edit is '
    + 'reported as 409 `metadata_conflict` instead of silently overwritten. '
    + 'Opaque to callers — echo it verbatim, never parse it. Currently emitted '
    + 'as `sha256:<64 hex chars>`, but the format is not part of this contract.',
  ),
  seq: z.number().int().describe(
    'Monotonic sequence number of the `op=\'publish\'` metadata event this '
    + 'promotion appended to the item history (sys_metadata_history.event_seq). '
    + 'Orders writes; unlike `version` it is not an OCC token.',
  ),
  seedApplied: z.object({
    success: z.boolean().describe(
      'False when the seed rows did not fully land. The publish itself still '
      + 'succeeded — check this rather than assuming data went live.',
    ),
    inserted: z.number().int().describe('Rows created by the externalId-keyed upsert.'),
    updated: z.number().int().describe('Rows updated by the externalId-keyed upsert.'),
    error: z.string().optional().describe(
      'Single failure message, present when the seed apply threw before the '
      + 'loader ran (including "no readable seed bodies").',
    ),
    errors: z.array(z.unknown()).optional().describe(
      'Per-record failures reported by the seed loader. Present only when the '
      + 'loader ran and returned a non-empty error list.',
    ),
  }).optional().describe(
    'Outcome of materializing a published `seed` body into data rows. Present '
    + 'ONLY when the published type is `seed` — publishing a seed is what makes '
    + 'its rows live, so the load rides along with the metadata promotion. '
    + 'Best-effort: a seed-load problem is surfaced here, never thrown, so a '
    + 'caller must check `seedApplied.success` instead of assuming the 200 '
    + 'covered the data. Absent on the batch path, which suppresses the '
    + 'per-item apply and loads every seed body in one later pass.',
  ),
  materializeApplied: z.object({
    success: z.boolean().describe('False when the materializer threw or reported failure; the publish still succeeded.'),
    inserted: z.number().int().describe('Data-plane rows created by the materializer.'),
    updated: z.number().int().describe('Data-plane rows updated by the materializer.'),
    error: z.string().optional().describe('Materializer failure message, present only when `success` is false.'),
  }).optional().describe(
    'Outcome of the ADR-0086 P2 publish-time materializer — the step that '
    + 'projects the published body into its data-plane row (e.g. `permission` '
    + '→ `sys_permission_set`, under the owning package). Present ONLY when a '
    + 'materializer is registered for this metadata type, which is why it is '
    + 'optional: its absence means "no materializer ran", never "it failed". '
    + 'Best-effort, same contract as `seedApplied`.',
  ),
  projectionApplied: z.object({
    success: z.boolean().describe('False when the projector threw; the metadata promotion itself still succeeded.'),
    error: z.string().optional().describe('Projector failure message, present only when `success` is false.'),
  }).optional().describe(
    'Outcome of the awaited ADR-0094 mutation projector — the post-persist step '
    + 'that materializes this metadata into its derived data-plane read model. '
    + 'The same receipt {@link SaveMetaItemResponseSchema} carries, because the '
    + 'projector runs on BOTH write doors: a direct active save and this '
    + 'draft→active promotion. Present ONLY when a projector is registered for '
    + 'this metadata type. Best-effort — a projector failure is reported here '
    + 'and logged, never thrown.',
  ),
  advisories: z.array(RuntimeAuthoringIssueSchema).optional().describe(
    'Non-gating findings from the #4463 runtime authoring gate — the same '
    + 'shared author-time rules `os validate` / `os build` / `os lint` run, '
    + 'applied to the DRAFT body this promotion carried to `active` (#9176, '
    + 'the same key `SaveMetaItemResponseSchema` carries, because the gate '
    + 'runs on both write doors by #4463 D1). The promotion SUCCEEDED; these '
    + 'are what the gate has to say about it anyway. Present ONLY when at '
    + 'least one advisory was raised — an empty array is never emitted, so a '
    + 'clean publish\'s response bytes are unchanged and absence means '
    + '"nothing to report", never "the gate did not run". Advisory by '
    + 'construction: every entry has `severity` `warning` or `info`, because '
    + 'an `error` finding refuses the promotion and arrives as the 422 '
    + '`invalid_metadata` envelope instead of here. A caller that ignores '
    + 'this key behaves exactly as before. This door is the one Studio\'s '
    + 'designer takes on every edit (draft save, then publish), and a Studio '
    + '/ MCP / AI author has no CLI at all — which is the gap #4463 exists '
    + 'to close.',
  ),
  message: z.string().optional().describe(
    'Human-readable receipt, e.g. `Published draft — type=view, name=cases '
    + '[seq=3]`. The producer sets it on every publish today; it stays optional '
    + 'to match the producer\'s own signature and its `SaveMetaItemResponse` '
    + 'twin, and because an absent human-readable string strips no data — the '
    + 'failure mode #5745 exists to prevent.',
  ),
}));

/**
 * Publish Package Drafts Response — the "publish whole app" door.
 *
 * Describes the FULL body `POST /api/v1/packages/:id/publish-drafts` answers
 * inside the dispatcher's `{ success, data }` envelope (#9406 — the #5745
 * "declared = returned" discipline carried to the batch door, the same move
 * #7294 made for the single-item `POST /meta/:type/:name/publish`). Until this
 * declaration the batch response was only an inline TypeScript return type in
 * `@objectstack/metadata-protocol` — no spec schema, no pin suite, no
 * conformance gate — so a field added to or dropped from Studio's "publish
 * whole app" response could not turn anything red (#9343's discarded
 * advisories were the measured instance).
 *
 * **The wire face is the helper's return PLUS the route's mutations** —
 * measured on the producer pair, not assumed:
 *
 * - `ObjectStackProtocolImplementation.publishPackageDrafts` builds the base
 *   object. Its three return sites always set `success` / `publishedCount` /
 *   `failedCount` / `published` / `failed` (so those five are REQUIRED), and
 *   attach `seedApplied` / `materializeApplied` / `probes` / `commitId` only
 *   on the happy path when the corresponding fact exists (so each is
 *   optional — absence means "did not apply", never "failed").
 * - The REST door (`packages/runtime/src/domains/packages.ts`) then mutates
 *   that object before `res.json()`: it back-fills `seedApplied` for custom
 *   protocols that do not self-apply, and attaches the ADR-0045 visibility
 *   flip receipts `unhiddenApps` / `unhideError` and the `metadata:reloaded`
 *   announce receipt `rebindError`. Those keys are ON the wire, so they are
 *   declared here — a schema of the helper's raw return would strip them.
 *
 * **`success` is the batch verdict, not an HTTP echo**: the producer sets
 * `failed.length === 0 && published.length > 0`, and the two refusal returns
 * (pre-flight violations; the ADR-0067 D2 all-or-nothing rollback) answer
 * `success: false` on a 200 with `publishedCount: 0`, `published: []` and the
 * whole batch in `failed[]` (`BATCH_ABORTED` marks the non-causal items).
 *
 * **`probes` is deliberately OPAQUE** — see its own note below. Do not model
 * it here without a consumer-driven card (#9406 ruling).
 */
export const PublishPackageDraftsResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe(
    'True only when every pending draft promoted (`failed` empty) AND at '
    + 'least one item published. A pre-flight refusal or an ADR-0067 D2 '
    + 'rollback answers false on a 200 — read `failed[]`, not the HTTP '
    + 'status. It does NOT cover the best-effort receipts below, each of '
    + 'which reports its own `success`.',
  ),
  publishedCount: z.number().int().describe(
    'Number of drafts promoted to active — `published.length`. 0 on every '
    + 'refusal path (the batch is all-or-nothing, ADR-0067 D2).',
  ),
  failedCount: z.number().int().describe(
    'Number of items that did not publish — `failed.length`. On a rollback '
    + 'this counts the WHOLE batch: the causal item plus every sibling '
    + 'marked BATCH_ABORTED.',
  ),
  published: z.array(z.object({
    type: z.string().describe('Metadata type of the promoted draft (canonical singular).'),
    name: z.string().describe('Item name of the promoted draft.'),
    version: z.string().describe(
      'Content hash of the just-promoted body — the same ADR-0008 '
      + 'optimistic-concurrency token the single-item doors return: echo it '
      + 'back as `If-Match` on the next write to this item. Opaque to '
      + 'callers; currently `sha256:<64 hex chars>`, but the format is not '
      + 'part of this contract.',
    ),
    advisories: z.array(RuntimeAuthoringIssueSchema).optional().describe(
      'Non-gating findings the #4463 runtime authoring gate raised against '
      + 'THIS draft\'s promotion (#9343 — the same element shape and the '
      + 'same omitted-when-empty discipline as '
      + '`PublishMetaItemResponseSchema.advisories`, riding each element '
      + 'rather than a parallel top-level map). Present ONLY when at least '
      + 'one finding was raised — an empty array is never emitted, so an '
      + 'advisory-free batch\'s response bytes are unchanged. Advisory by '
      + 'construction: every entry is `warning`/`info`, because an `error` '
      + 'finding refuses the promotion and — the batch being all-or-nothing '
      + '— aborts the whole batch as `failed[]` instead; `failed[]` '
      + 'elements never carry this key.',
    ),
  })).describe(
    'Every draft promoted to active, in publish order. Empty on every '
    + 'refusal path.',
  ),
  failed: z.array(z.object({
    type: z.string().describe('Metadata type of the item that did not publish.'),
    name: z.string().describe('Item name.'),
    error: z.string().describe(
      'What refused it. On a rollback, the causal item carries its real '
      + 'error and every sibling carries the all-or-nothing explanation.',
    ),
    code: z.string().optional().describe(
      'Machine code for the refusal class (SCREAMING_SNAKE, ADR-0112 '
      + 'vocabulary) — e.g. a pre-flight violation code, or BATCH_ABORTED '
      + 'on the non-causal items of a rolled-back batch.',
    ),
  })).describe(
    'Items that did not publish. Because the batch is all-or-nothing '
    + '(ADR-0067 D2), a non-empty list means NOTHING landed: '
    + '`published: []`, `publishedCount: 0`.',
  ),
  seedApplied: z.object({
    success: z.boolean().describe(
      'False when the seed rows did not fully land. The publish itself '
      + 'still succeeded — check this rather than assuming data went live.',
    ),
    inserted: z.number().int().optional().describe(
      'Rows created by the externalId-keyed upsert. Optional ONLY because '
      + 'the route-level fallback producer (custom protocols that do not '
      + 'self-apply) reports early failures without counters; the in-batch '
      + 'producer always emits both counters.',
    ),
    updated: z.number().int().optional().describe(
      'Rows updated by the externalId-keyed upsert. Same optionality '
      + 'rationale as `inserted`.',
    ),
    error: z.string().optional().describe(
      'Single failure message, present when the apply failed before the '
      + 'loader ran (including "no readable seed bodies").',
    ),
    errors: z.array(z.unknown()).optional().describe(
      'Per-record failures reported by the seed loader, plus any seed-body '
      + 'read failures. May be present and empty on a clean load.',
    ),
  }).optional().describe(
    'Aggregate outcome of materializing EVERY published `seed` body in one '
    + 'multi-pass loader run (cross-seed references need the whole set). '
    + 'Present ONLY when the batch published at least one seed. Two '
    + 'producers, one key: the batch itself self-applies '
    + '(`applySeedBodies`), and the REST door back-fills the same key for '
    + 'custom protocols that do not — never both (an externalId-less seed '
    + 'would double-insert). Best-effort: a seed problem is surfaced here, '
    + 'never thrown.',
  ),
  materializeApplied: z.object({
    success: z.boolean().describe('False when any item\'s materializer failed; the publish still succeeded.'),
    inserted: z.number().int().describe('Data-plane rows created across the batch.'),
    updated: z.number().int().describe('Data-plane rows updated across the batch.'),
    failures: z.array(z.object({
      type: z.string().describe('Metadata type of the item whose projection did not land.'),
      name: z.string().describe('Item name.'),
      error: z.string().describe('Why the projection did not land.'),
    })).describe(
      'Each item whose data-plane projection did NOT land — named '
      + 'per-item, unlike the single-item door\'s scalar `error`, because '
      + 'one aggregate boolean over N items would hide WHICH ones never '
      + 'went live.',
    ),
  }).optional().describe(
    'ADR-0086 P2 — aggregate result of publish-time materializers across '
    + 'the batch (e.g. `permission` → `sys_permission_set`), including '
    + 'side-effect failures surfaced by the per-item effects loop. Present '
    + 'ONLY when at least one published item had a registered materializer '
    + 'or a side-effect failure. Best-effort, same contract as '
    + '`seedApplied`.',
  ),
  // #9406 ruling: `probes` (`BuildProbeReport`) gets a DELIBERATELY OPAQUE
  // passthrough declaration — the key is declared so the face is complete and
  // nothing strips it, but its inner shape is NOT modeled here. It upgrades to
  // a modeled Zod schema only when a consumer needs a field of it (maintainer,
  // 2026-08-18: "Do not model it speculatively"). The TS shape lives on
  // `packages/metadata-protocol/src/build-probes.ts` (`BuildProbeReport`:
  // `issues[]` + per-plane `checked` counters).
  probes: z.unknown().optional().describe(
    'ADR-0038 L3 post-publish runtime probe report — one real read per '
    + 'published artifact (seeded objects have rows, views are readable, '
    + 'widget dataset selections execute). DELIBERATELY OPAQUE in this '
    + 'contract (#9406): the key is declared and carried through verbatim, '
    + 'but its inner shape is intentionally not modeled until a consumer '
    + 'needs a field of it. Present only when something was publishable; '
    + 'probes never fail the publish.',
  ),
  commitId: z.string().optional().describe(
    'ADR-0067 — id of the commit this publish recorded. Absent when '
    + 'nothing published.',
  ),
  unhiddenApps: z.array(z.string()).optional().describe(
    'ADR-0045 §3 — names of the apps whose `_unpublished` gate this publish '
    + 'cleared (publish = live AND visible; a materialized additive build '
    + 'has no drafts, only this flip). Attached by the REST door, not the '
    + 'protocol helper. Present ONLY when at least one app flipped — on a '
    + 'mid-loop failure it names the apps that DID persist, beside '
    + '`unhideError` (#5242\'s split report). Spelling is a permanent wire '
    + 'contract (see the door\'s #6955 note).',
  ),
  unhideError: z.string().optional().describe(
    'Present when the ADR-0045 visibility flip failed (wholly or partway): '
    + 'the drafts ARE published, but apps still stored `_unpublished: true` '
    + 'stay externally unobservable. Client-facing text only — undeclared '
    + 'driver text is withheld per ADR-0112 (#8516); the full cause is in '
    + 'the server log. The route is idempotent: re-run it once the cause is '
    + 'resolved.',
  ),
  rebindError: z.string().optional().describe(
    'Present when the post-publish `metadata:reloaded` announce failed: '
    + 'everything is published and stored, but boot-cached consumers keep '
    + 'the pre-publish view until re-run or restart (a newly published '
    + 'record-triggered flow does not bind its trigger). Client-facing text '
    + 'only, same ADR-0112 withhold as `unhideError` (#8516).',
  ),
}));

/**
 * Delete Metadata Item Request
 * Removes a customization overlay row from sys_metadata (ADR-0005).
 */
export const DeleteMetaItemRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name'),
}));

/**
 * Delete Metadata Item Response
 * `reset === true` means a row was deleted (item is now at artifact default).
 * `reset === false` means no overlay row existed (already at artifact default).
 */
export const DeleteMetaItemResponseSchema = lazySchema(() => z.object({
  success: z.boolean(),
  reset: z.boolean().optional(),
  message: z.string().optional(),
}));

/**
 * Get Metadata Item with Cache Request
 * Get a specific metadata item with HTTP cache validation support
 */
export const GetMetaItemCachedRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name'),
  cacheRequest: MetadataCacheRequestSchema.optional().describe('Cache validation parameters'),
  locale: z.string().optional().describe(
    'Resolved response locale. Folded into the ETag so a language switch '
    + 'never returns a stale-locale 304 — metadata is translated *after* the '
    + 'cache validator check (issue #1319).',
  ),
  organizationId: z.string().optional().describe(
    'Organization (tenant) scope for the read. Selects the org partition in the '
    + 'ADR-0005 overlay read order — org overlay wins over env-wide overlay wins '
    + 'over packaged artifact — exactly as on the uncached read (#9454). Also '
    + 'folded into the ETag, so a scope switch never returns a stale 304 from '
    + 'another scope\'s cached representation. Absent = environment-wide read.',
  ),
}));

/**
 * Get Metadata Item with Cache Response
 * Uses MetadataCacheResponse from http-cache.zod.ts
 */
export const GetMetaItemCachedResponseSchema = lazySchema(() => MetadataCacheResponseSchema);

/**
 * Get UI View Request
 * Resolves the appropriate UI view for an object based on context.
 * Unlike getMetaItem, this does not require a specific View ID.
 */
export const GetUiViewRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name (snake_case)'),
  type: z.enum(['list', 'form']).describe('View type'),
}));

/**
 * Get UI View Response
 */
export const GetUiViewResponseSchema = lazySchema(() => ViewSchema);

// ==========================================
// Data Operations
// ==========================================

/**
 * Find Data Request
 * Defines a query to retrieve records from a specific object.
 * Supports filtering, sorting, pagination, and field selection.
 * 
 * @example
 * {
 *   "object": "customers",
 *   "query": {
 *     "where": { "status": "active", "revenue": { "$gt": 10000 } },
 *     "orderBy": [{ "field": "name", "order": "desc" }],
 *     "limit": 10
 *   }
 * }
 */
export const FindDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('The unique machine name of the object to query (e.g. "account").'),
  query: QuerySchema.optional().describe('Structured query definition (filter, sort, select, pagination).'),
}));

/**
 * Find Data Response
 * Returns a list of records matching the query criteria.
 */
export const FindDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name for the returned records.'),
  records: z.array(z.record(z.string(), z.unknown())).describe('The list of matching records.'),
  total: z.number().optional().describe('Total number of records matching the filter (if requested).'),
  nextCursor: z.string().optional().describe('Cursor for the next page of results (cursor-based pagination).'),
  hasMore: z.boolean().optional().describe('True if there are more records available (pagination).'),
}));

/**
 * HTTP Find Query Parameters
 * 
 * Canonical HTTP query parameter names for GET /data/:object list endpoints.
 * The canonical filter parameter is `filter` (singular). The plural `filters` is
 * accepted for backward compatibility but `filter` is the standard going forward.
 * 
 * This schema defines the allowlisted query parameters for HTTP GET list requests.
 * Server-side parsers (protocol.ts) should accept both `filter` and `filters` and
 * normalize to `filter` (singular) internally.
 * 
 * @example
 * GET /api/v1/data/contacts?filter={"status":"active"}&select=name,email&top=10&sort=name
 */
export const HttpFindQueryParamsSchema = lazySchema(() => z.object({
  /** @canonical Singular form — the standard going forward. JSON string of filter expression or AST. */
  filter: z.string().optional().describe('JSON-encoded filter expression (canonical, singular).'),
  /** @deprecated Use `filter` (singular). Accepted for backward compatibility. */
  filters: z.string().optional().describe('JSON-encoded filter expression (deprecated plural alias).'),
  select: z.string().optional().describe('Comma-separated list of fields to retrieve.'),
  sort: z.string().optional().describe('Sort expression (e.g. "name asc,created_at desc" or "-created_at").'),
  orderBy: z.string().optional().describe('Alias for sort (OData compatibility).'),
  top: z.coerce.number().optional().describe('Max records to return (limit).'),
  skip: z.coerce.number().optional().describe('Records to skip (offset).'),
  expand: z.string().optional().describe(
    'Comma-separated list of lookup/master_detail field names to expand. '
    + 'Resolved to populate array and passed to the engine for batch $in expansion.'
  ),
  search: z.string().optional().describe('Full-text search query.'),
  /** `?distinct` — REMOVED (#4286): the querystring spelling of `query.distinct`, same tombstone. */
  distinct: retiredKey(QUERY_DISTINCT_REMOVED),
  count: z.coerce.boolean().optional().describe('Include total count in response.'),
}));

/**
 * Get Data Request
 * Retrieval of a single record by its unique identifier.
 * Only `select` and `expand` are permitted as additional query parameters.
 * All other query parameters should be discarded to prevent parameter pollution.
 * 
 * @example
 * {
 *   "object": "contracts",
 *   "id": "cnt_123456",
 *   "select": ["name", "status", "amount"],
 *   "expand": ["owner", "account"]
 * }
 */
export const GetDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  id: z.string().describe('The unique record identifier (primary key).'),
  select: z.array(z.string()).optional().describe('Fields to include in the response (allowlisted query param).'),
  expand: z.array(z.string()).optional().describe(
    'Lookup/master_detail field names to expand. '
    + 'The engine resolves these via batch $in queries, replacing foreign key IDs with full objects.'
  ),
}));

/**
 * Get Data Response
 */
export const GetDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  id: z.string().describe('The record ID.'),
  record: z.record(z.string(), z.unknown()).describe('The complete record data.'),
}));

/**
 * Create Data Request
 * Creation of a new record.
 * 
 * @example
 * {
 *   "object": "leads",
 *   "data": {
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "company": "Acme Inc"
 *   }
 * }
 */
export const CreateDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  data: z.record(z.string(), z.unknown()).describe('The dictionary of field values to insert.'),
}));

/**
 * Create Data Response
 */
export const CreateDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  id: z.string().describe('The ID of the newly created record.'),
  record: z.record(z.string(), z.unknown()).describe('The created record, including server-generated fields (created_at, owner).'),
  droppedFields: z.array(DroppedFieldsEventSchema).optional().describe(
    'Write-observability (#3407/#3431): caller-supplied fields that were LEGALLY stripped ' +
    'before the record was written — a non-system create cannot seed a static `readonly` ' +
    'column (#3043 ingress strip), so those keys are dropped and the field re-derives its ' +
    'default. Present ONLY when ≥1 field was dropped; the create still succeeded without ' +
    'them (status/success semantics unchanged). REST additionally surfaces this as the ' +
    '`X-ObjectStack-Dropped-Fields` response header. Optional — omit-when-empty keeps the ' +
    'shape backward-compatible for existing clients.'
  ),
}));

/**
 * One field-level finding from a validate-only run — the same
 * `{ field, code, message }` triple the engine's `ValidationError.fields`
 * carries, so a caller reads one vocabulary whether the verdict arrived from a
 * preview or from a rejected write.
 */
export const ValidateDataIssueSchema = lazySchema(() => z.object({
  field: z.string().describe('The field the finding is about (`_record` for an object-level rule).'),
  code: z.string().describe('Machine-readable finding code, e.g. `required`, `invalid_type`, `rule_violation`.'),
  message: z.string().describe('Human-readable message — a validation rule\'s author-written text where one exists.'),
}));

/**
 * Validate Data Request (#6037 — #4633 ruling D)
 *
 * Ask for the write path's verdict on candidate rows WITHOUT writing them.
 *
 * @example
 * {
 *   "object": "leads",
 *   "mode": "insert",
 *   "data": [{ "first_name": "John", "email": "not-an-email" }]
 * }
 */
export const ValidateDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  data: z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.record(z.string(), z.unknown())),
  ]).describe('A candidate record, or an array of them. Nothing is persisted.'),
  mode: z.enum(['insert', 'update']).optional().describe(
    "Which write the verdict should predict. `insert` (default) walks every declared field, so a " +
    "missing required field is a finding; `update` judges only the supplied keys, matching a PATCH.",
  ),
}));

/**
 * Validate Data Response
 *
 * One entry per submitted row, in submission order.
 */
export const ValidateDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  mode: z.enum(['insert', 'update']).describe('The write mode the verdict was reached for.'),
  valid: z.boolean().describe('True when EVERY row is valid — the whole-set answer.'),
  results: z.array(z.object({
    valid: z.boolean().describe('True when this row would be accepted by the write path.'),
    errors: z.array(ValidateDataIssueSchema).describe('Findings that would REJECT this row. Empty when valid.'),
    warnings: z.array(ValidateDataIssueSchema).describe(
      'Findings the target deployment ADMITS rather than rejects — today, ADR-0104 value shapes under a ' +
      'warn-first posture. The row is valid; the write would store it and log the same complaint.',
    ),
  })).describe('Per-row verdicts, in submission order.'),
  posture: z.object({
    valueShapeStrict: z.boolean().describe('True when this deployment rejects non-conforming value shapes (ADR-0104 self-certified).'),
    mediaValueShapeStrict: z.boolean().describe('The same, for media field value shapes.'),
  }).describe(
    'The ADR-0104 posture the verdict was reached under — reported because it is the difference between ' +
    '"this row is fine" and "this row is fine HERE". The same row can be an error on a self-certified ' +
    'deployment and an admitted warning on an un-migrated one, and a caller explaining a verdict needs to ' +
    'know which it got. An unconditionally-strict preview was considered and rejected (#4633 option B): it ' +
    'would fail rows on every un-migrated deployment that the write would have accepted.',
  ),
}));

/**
 * Update Data Request
 * Modification of an existing record.
 * 
 * @example
 * {
 *   "object": "tasks",
 *   "id": "tsk_001",
 *   "data": {
 *     "status": "completed",
 *     "percent_complete": 100
 *   }
 * }
 */
export const UpdateDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  id: z.string().describe('The ID of the record to update.'),
  data: z.record(z.string(), z.unknown()).describe('The fields to update (partial update).'),
  expectedVersion: z.string().optional().describe(
    'Optimistic concurrency token (typically the `updated_at` value the client read). ' +
    'When provided, the server compares it against the current record version and ' +
    'returns 409 CONCURRENT_UPDATE if they differ. Optional — omit to skip the check.'
  ),
}));

/**
 * Update Data Response
 */
export const UpdateDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  id: z.string().describe('Updated record ID'),
  record: z.record(z.string(), z.unknown()).describe('Updated record'),
  droppedFields: z.array(DroppedFieldsEventSchema).optional().describe(
    'Write-observability (#3407/#3431): caller-supplied fields the engine LEGALLY stripped ' +
    'from the write before persisting — static `readonly` (#2948) or a TRUE `readonlyWhen` ' +
    'predicate (#3042). Present ONLY when ≥1 field was dropped; the update still succeeded ' +
    'without them (status/success semantics unchanged — stripping is legitimate, not an ' +
    'error). REST additionally surfaces this as the `X-ObjectStack-Dropped-Fields` response ' +
    'header. Optional — omit-when-empty keeps the shape backward-compatible for existing ' +
    'clients that only read `record`.'
  ),
}));

/**
 * Delete Data Request
 */
export const DeleteDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  id: z.string().describe('Record ID to delete'),
  expectedVersion: z.string().optional().describe(
    'Optimistic concurrency token (typically the `updated_at` value the client read). ' +
    'When provided, the server compares it against the current record version and ' +
    'returns 409 CONCURRENT_UPDATE if they differ. Optional — omit to skip the check.'
  ),
}));

/**
 * Delete Data Response
 */
export const DeleteDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  id: z.string().describe('Deleted record ID'),
  success: z.boolean().describe('Whether deletion succeeded'),
}));

// ==========================================
// Batch Operations
// ==========================================

/**
 * Batch Data Request
 */
export const BatchDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  request: BatchUpdateRequestSchema.describe('Batch operation request'),
}));

/**
 * Batch Data Response
 * Uses BatchUpdateResponse from batch.zod.ts
 */
export const BatchDataResponseSchema = lazySchema(() => BatchUpdateResponseSchema);

/**
 * Create Many Data Request
 */
export const CreateManyDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  records: z.array(z.record(z.string(), z.unknown())).describe('Array of records to create'),
}));

/**
 * Create Many Data Response
 */
export const CreateManyDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  records: z.array(z.record(z.string(), z.unknown())).describe('Created records'),
  count: z.number().describe('Number of records created'),
  droppedFields: z.array(DroppedFieldsEventSchema).optional().describe(
    'Write-observability (#3407/#3431/#3455): caller-supplied `readonly` fields the #3043 ' +
    'create-ingress strip removed before the rows were written. AGGREGATED across the batch ' +
    '(one event per object/reason with the union of dropped field names) rather than per-row, ' +
    'because the insert-time strip is static-`readonly` only — schema-uniform, so every row ' +
    'drops the same set. Present ONLY when ≥1 field was dropped; the creates still succeeded ' +
    'without them (count/success unchanged). Optional — omit-when-empty keeps the shape ' +
    'backward-compatible. (The per-row `insertMany`/`batch` paths carry per-row `droppedFields` ' +
    'on each result instead — see BatchOperationResultSchema.)'
  ),
}));

/**
 * Update Many Data Request
 *
 * [#3939] The wire body IS {@link UpdateManyRequestSchema} — one Zod source per
 * contract (Prime Directive #7). This adds only `object`, which the REST route
 * takes from the URL path and never from the body (#3933). The two used to be
 * hand-maintained copies that had already drifted apart: the batch.zod one
 * accepted `{}` rows, this one required `id` + `data`, and only this one was
 * ever enforced.
 */
export const UpdateManyDataRequestSchema = lazySchema(() => UpdateManyRequestSchema.extend({
  object: z.string().describe('Object name'),
}));

/**
 * Update Many Data Response
 * Uses BatchUpdateResponse for consistency
 */
export const UpdateManyDataResponseSchema = lazySchema(() => BatchUpdateResponseSchema);

/**
 * Delete Many Data Request
 *
 * [#3939] The wire body IS {@link DeleteManyRequestSchema}; this adds only the
 * `object` the REST route takes from the URL path (#3933). See
 * {@link UpdateManyDataRequestSchema} for why the copies were merged.
 */
export const DeleteManyDataRequestSchema = lazySchema(() => DeleteManyRequestSchema.extend({
  object: z.string().describe('Object name'),
}));

/**
 * Delete Many Data Response
 */
export const DeleteManyDataResponseSchema = lazySchema(() => BatchUpdateResponseSchema);

// ==========================================
// Package Management Operations
// ==========================================

/**
 * Re-export Package Management Request/Response schemas from kernel.
 * These define the contract for package lifecycle management:
 * - List installed packages (with filters)
 * - Get a specific package by ID
 * - Install a new package (from manifest)
 * - Uninstall a package
 * - Enable/Disable a package
 * 
 * Key distinction: Package (ManifestSchema) is the unit of installation.
 * An App (AppSchema) is a UI navigation entity within a package.
 * A package may contain 0, 1, or many apps.
 */
export {
  ListPackagesRequestSchema,
  ListPackagesResponseSchema,
  GetPackageRequestSchema,
  GetPackageResponseSchema,
  InstallPackageRequestSchema,
  InstallPackageResponseSchema,
  UninstallPackageRequestSchema,
  UninstallPackageResponseSchema,
  EnablePackageRequestSchema,
  EnablePackageResponseSchema,
  DisablePackageRequestSchema,
  DisablePackageResponseSchema,
};

// ==========================================
// View Management Operations — RETIRED
// ==========================================

// `ListViews` / `GetView` / `CreateView` / `UpdateView` / `DeleteView` —
// five methods and their ten Request/Response schemas — were REMOVED per
// ADR-0049 enforce-or-remove (#6239, protocol 17, maintainer ruling
// 2026-08-07). Route 3 of the retirement playbook: not one of the ten was a
// KEY on an authorable shape, nothing parsed them, and no route could reach the
// methods, so there is no tombstone to write and no source or `sys_metadata`
// row for a D2 conversion to rewrite. `RETIRED_DEFS_BY_MAJOR[17]` plus the D3
// `SemanticMigration` `view-management-protocol-retired` ARE the declaration.
//
// ## What it declared, and what serves it
//
// A viewId-addressed CRUD surface over views: list by object (+ optional
// list/form filter), read one, create, patch, delete. Measured on `origin/main`
// immediately before the removal, it had ZERO of the three things a protocol
// method needs:
//
//   - no implementation — `packages/metadata-protocol/src/protocol.ts` declares
//     no `listViews`/`getView`/`createView`/`updateView`/`deleteView`; its only
//     view resolver is `getUiView`;
//   - no route — `packages/rest/src/rest-server.ts` never mentions `viewId`, so
//     nothing viewId-addressed is reachable over HTTP at all;
//   - no caller — the only `ViewProtocol` mention outside this file was
//     `content/docs/kernel/services-checklist.mdx`, which already recorded the
//     five as declared-and-unrouted.
//
// Views are read and written today through surfaces that DO exist: the
// metadata routes (`/api/v1/meta/view/:name`, i.e. `getMetaItem` /
// `saveMetaItem` / `deleteMetaItem` with `type: 'view'`) for the stored
// definition, and `getUiView` (`GET /api/v1/ui/view/:object/:type`) for the
// resolved render-time view.
//
// ## Why this one was worth the removal rather than a note
//
// A declared surface that is name-identical and semantics-adjacent to a real
// one is not merely dead weight; it is an attractive nuisance in every grep.
// It had already cost once: #5948's issue body AND its 2026-08-07 maintainer
// ruling both read `GetViewResponseSchema` (this block, zero implementations)
// as the contract of `GET /ui/view/:object/:type`, whose declared response is
// `GetUiViewResponseSchema` — 250 lines up, one word different. The ruling's
// reasoning happened to survive the mix-up, which is the luck that makes this
// class of defect worth removing rather than annotating.
//
// If "read/write ONE view by id" becomes a real requirement, it returns through
// the ENFORCE route — implementation first, vocabulary second (ADR-0049).

// ==========================================
// Permission Operations
// ==========================================

export const CheckPermissionRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name to check permissions for'),
  action: z.enum(['create', 'read', 'edit', 'delete', 'transfer', 'restore', 'purge']).describe('Action to check'),
  recordId: z.string().optional().describe('Specific record ID (for record-level checks)'),
  field: z.string().optional().describe('Specific field name (for field-level checks)'),
}));

export const CheckPermissionResponseSchema = lazySchema(() => z.object({
  allowed: z.boolean().describe('Whether the action is permitted'),
  reason: z.string().optional().describe('Reason if denied'),
}));

export const GetObjectPermissionsRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name to get permissions for'),
}));

export const GetObjectPermissionsResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  permissions: ObjectPermissionSchema.describe('Object-level permissions'),
  fieldPermissions: z.record(z.string(), FieldPermissionSchema).optional().describe('Field-level permissions keyed by field name'),
}));

export const GetEffectivePermissionsRequestSchema = lazySchema(() => z.object({}));

export const GetEffectivePermissionsResponseSchema = lazySchema(() => z.object({
  // [#3391] The effective response carries the server-resolved API operation set
  // per object (`apiOperations`) — the single "effective" channel the frontend
  // consumes. Authoring `ObjectPermissionSchema` stays unextended.
  objects: z.record(z.string(), EffectiveObjectPermissionSchema).describe('Effective object permissions keyed by object name'),
  systemPermissions: z.array(z.string()).describe('Effective system-level permissions'),
}));

// ==========================================
// Workflow Operations — REMOVED (#4451, v17)
// ==========================================
// The Get/WorkflowState/Config/Transition schemas and the `WorkflowProtocol`
// interface were deleted: no code ever implemented any of the three methods,
// nothing ever registered the `workflow` service slot they notionally fronted
// (ADR-0115 Evidence 5 — "no code in this repository resolves either slot",
// verified across both repositories), and no HTTP surface ever mounted
// `/api/v1/workflow` (the pre-#3586 DEFAULT_DISPATCHER_ROUTES listed it among
// routes that never existed). The capability the wrappers promised is live
// elsewhere: record state machines are enforced by the `state_machine`
// validation rule (`StateMachineSchema` stays authorable on the object),
// approvals are first-class flow nodes on the approvals runtime (ADR-0019 —
// decisions via `POST /approvals/requests/:id/{approve,reject}`), and
// record-triggered automation is lifecycle hooks + `record_change` flows.

// ==========================================
// Realtime Operations
// ==========================================

export const RealtimeConnectRequestSchema = lazySchema(() => z.object({
  transport: TransportProtocol.optional().describe('Preferred transport protocol'),
  channels: z.array(z.string()).optional().describe('Channels to subscribe to on connect'),
  token: z.string().optional().describe('Authentication token'),
}));

export const RealtimeConnectResponseSchema = lazySchema(() => z.object({
  connectionId: z.string().describe('Unique connection identifier'),
  transport: TransportProtocol.describe('Negotiated transport protocol'),
  url: z.string().optional().describe('WebSocket/SSE endpoint URL'),
}));

export const RealtimeDisconnectRequestSchema = lazySchema(() => z.object({
  connectionId: z.string().optional().describe('Connection ID to disconnect'),
}));

export const RealtimeDisconnectResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether disconnection succeeded'),
}));

export const RealtimeSubscribeRequestSchema = lazySchema(() => z.object({
  channel: z.string().describe('Channel name to subscribe to'),
  events: z.array(z.string()).optional().describe('Specific event types to listen for'),
  filter: z.record(z.string(), z.unknown()).optional().describe('Event filter criteria'),
}));

export const RealtimeSubscribeResponseSchema = lazySchema(() => z.object({
  subscriptionId: z.string().describe('Unique subscription identifier'),
  channel: z.string().describe('Subscribed channel name'),
}));

export const RealtimeUnsubscribeRequestSchema = lazySchema(() => z.object({
  subscriptionId: z.string().describe('Subscription ID to cancel'),
}));

export const RealtimeUnsubscribeResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether unsubscription succeeded'),
}));

export const SetPresenceRequestSchema = lazySchema(() => z.object({
  channel: z.string().describe('Channel to set presence in'),
  state: RealtimePresenceSchema.describe('Presence state to set'),
}));

export const SetPresenceResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether presence was set'),
}));

export const GetPresenceRequestSchema = lazySchema(() => z.object({
  channel: z.string().describe('Channel to get presence for'),
}));

export const GetPresenceResponseSchema = lazySchema(() => z.object({
  channel: z.string().describe('Channel name'),
  members: z.array(RealtimePresenceSchema).describe('Active members and their presence state'),
}));

// ==========================================
// Notification Operations
// ==========================================

export const RegisterDeviceRequestSchema = lazySchema(() => z.object({
  token: z.string().describe('Device push notification token'),
  platform: z.enum(['ios', 'android', 'web']).describe('Device platform'),
  deviceId: z.string().optional().describe('Unique device identifier'),
  name: z.string().optional().describe('Device friendly name'),
}));

export const RegisterDeviceResponseSchema = lazySchema(() => z.object({
  deviceId: z.string().describe('Registered device ID'),
  success: z.boolean().describe('Whether registration succeeded'),
}));

export const UnregisterDeviceRequestSchema = lazySchema(() => z.object({
  deviceId: z.string().describe('Device ID to unregister'),
}));

export const UnregisterDeviceResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether unregistration succeeded'),
}));

export const NotificationPreferencesSchema = lazySchema(() => z.object({
  email: z.boolean().default(true).describe('Receive email notifications'),
  push: z.boolean().default(true).describe('Receive push notifications'),
  inApp: z.boolean().default(true).describe('Receive in-app notifications'),
  digest: z.enum(['none', 'daily', 'weekly']).default('none').describe('Email digest frequency'),
  channels: z.record(z.string(), z.object({
    enabled: z.boolean().default(true).describe('Whether this channel is enabled'),
    email: z.boolean().optional().describe('Override email setting'),
    push: z.boolean().optional().describe('Override push setting'),
  })).optional().describe('Per-channel notification preferences'),
}));

export const GetNotificationPreferencesRequestSchema = lazySchema(() => z.object({}));

export const GetNotificationPreferencesResponseSchema = lazySchema(() => z.object({
  preferences: NotificationPreferencesSchema.describe('Current notification preferences'),
}));

export const UpdateNotificationPreferencesRequestSchema = lazySchema(() => z.object({
  preferences: NotificationPreferencesSchema.partial().describe('Preferences to update'),
}));

export const UpdateNotificationPreferencesResponseSchema = lazySchema(() => z.object({
  preferences: NotificationPreferencesSchema.describe('Updated notification preferences'),
}));

export const NotificationSchema = lazySchema(() => z.object({
  id: z.string().describe('Notification ID'),
  type: z.string().describe('Notification type'),
  title: z.string().describe('Notification title'),
  body: z.string().describe('Notification body text'),
  read: z.boolean().default(false).describe('Whether notification has been read'),
  data: z.record(z.string(), z.unknown()).optional().describe('Additional notification data'),
  actionUrl: z.string().optional().describe('URL to navigate to when clicked'),
  createdAt: z.string().datetime().describe('When notification was created'),
}));

// ==========================================
// Notification inbox listing — NOT paginated
// ==========================================

// `cursor` was declared on BOTH halves of `GET /api/v1/notifications` and
// honoured on neither, and `limit` declared a default the server has never
// applied. Both are removed per the maintainer ruling of 2026-08-07 (#6361,
// Option A), ruled together with #6363 as one capability's two halves — a
// pagination capability is never half-deleted.
//
// ## What the route actually does
//
// It answers a WINDOW, never a page: `MessagingService.listInbox` reads the
// newest `limit` rows and stops. There is no continuation token, no `hasMore`,
// and no ordering key a caller could resume from — so `cursor` had nothing to
// carry even if something had read it. The request half was ignored by the
// domain (which reads `read` / `type` / `limit` and nothing else) and the
// response half was never emitted, so an SDK caller looping "until the cursor
// runs out" re-read page 1 forever, with no error and no 400.
//
// This is `data.query.cursor` (#4286, `query-cursor-retired`) one layer up,
// with the same verdict for the same reason: a caller-visible pagination
// parameter no engine implements is worse than inert, because it has a shipped
// producer. That one deleted `QueryBuilder.cursor()` with the key; this one
// deletes the `cursor` argument of `client.notifications.list()`.
//
// ## Why `limit` loses its default rather than gaining a truer number
//
// The ruling allowed either "declare the real default (50)" or "drop the
// default and describe it as server-decided". The second is taken because the
// FICTION IS THE MECHANISM, not just the number: nothing parses a query string
// through this schema (#3899 wired the catalog's `requestSchema` to the real
// entry for BODIES only), so `.default(...)` has never stamped anything onto
// anything. Re-spelling `20` as `50` would keep a declaration that does not
// execute and merely make it coincide with the server for as long as nobody
// moves the clamp. `.optional()` plus prose is true on both axes: the schema
// claims no behaviour it does not perform, and the server's window is
// described as the server's.
//
// Deliberately NOT declared: `.int()`, `.positive()` or `.max(200)`. The
// service CLAMPS an out-of-range limit (`Math.min(Math.max(limit ?? 50, 1),
// 200)`); it does not refuse one. A constraint here would declare a rejection
// the wire does not perform — the same declared-not-enforced defect in the
// opposite direction. ADR-0049, #6361.

/**
 * One prescription, two rejection sites — the `cursor` key was declared on both
 * halves of this route, so both tombstone it with the same string.
 *
 * Tombstoned rather than deleted for the ADR-0104 reason these schemas keep
 * paying for: neither is `.strict()`, so a bare deletion makes Zod SILENTLY
 * STRIP whatever the caller keeps sending — a clean parse and a parameter that
 * never takes effect, which is the very failure this issue is about, moved one
 * layer down. `retiredKey()` types the key as `never` (so `tsc` refuses it at
 * the authoring site) and raises this text at parse time.
 */
const NOTIFICATIONS_CURSOR_REMOVED =
  '`cursor` was removed from GET /api/v1/notifications in @objectstack/spec 17 '
  + '(#6361, ADR-0049) — it was declared on the request AND the response and honoured on '
  + 'neither: the server reads only `read`/`type`/`limit`, and no emit site ever wrote the '
  + 'response key, so a caller paginating by it re-read the first window forever with no '
  + 'error and no 400. Delete the key; the `cursor` argument of '
  + '`client.notifications.list()` was removed with it. This route is NOT paginated — it '
  + 'answers the newest `limit` notifications and stops, so ask for a bigger window '
  + '(`limit`, clamped by the server into 1..200) instead of a next page. A first-class '
  + 'inbox cursor, if ever built, will be a response-minted opaque token, not this key.';

export const ListNotificationsRequestSchema = lazySchema(() => z.object({
  read: z.boolean().optional().describe('Filter by read status'),
  type: z.string().optional().describe('Filter by notification type'),
  limit: z.number().optional().describe(
    'Maximum number of notifications to return — the newest N. Omitted leaves the window '
    + 'to the server, which is not a fixed part of this contract: the platform inbox '
    + 'answers 50 and clamps any requested value into 1..200 rather than refusing it. '
    + 'This endpoint is not paginated — there is no continuation token, so a larger '
    + 'window is the only way to see more.',
  ),
  cursor: retiredKey(NOTIFICATIONS_CURSOR_REMOVED),
}));

export const ListNotificationsResponseSchema = lazySchema(() => z.object({
  notifications: z.array(NotificationSchema).describe('List of notifications — the newest window, not a page'),
  unreadCount: z.number().describe('Total number of unread notifications'),
  cursor: retiredKey(NOTIFICATIONS_CURSOR_REMOVED),
}));

export const MarkNotificationsReadRequestSchema = lazySchema(() => z.object({
  ids: z.array(z.string()).describe('Notification IDs to mark as read'),
}));

export const MarkNotificationsReadResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  readCount: z.number().describe('Number of notifications marked as read'),
}));

export const MarkAllNotificationsReadRequestSchema = lazySchema(() => z.object({}));

export const MarkAllNotificationsReadResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  readCount: z.number().describe('Number of notifications marked as read'),
}));

// ==========================================
// AI Operations
// ==========================================
//
// THESE ARE THE SHAPES OF THE ROUTES THAT EXIST (#3718).
//
// What used to live here — `AiNlq*`, `AiSuggest*`, `AiInsights*` — described
// `/api/v1/ai/{nlq,suggest,insights}`, three endpoints **no repo has ever
// mounted**. They were declared here, registered in `DEFAULT_AI_ROUTES` (a
// table with no runtime consumer), typed as optional protocol methods nothing
// implements, and called by `client.ai.*`. Every call 404ed for the whole life
// of the namespace; the SDK's AI surface and the real one were disjoint sets.
//
// The AI service itself is a Cloud/EE package (`service-ai`, in the `cloud`
// repo) — this repo's dispatcher only proxies `/api/v1/ai/**` to whatever
// `buildAIRoutes()` mounted, or 404s "AI service is not configured". So these
// schemas deliberately describe **the wire**, not a protocol this repo serves:
// they are the one shape `client.ai.*` and cloud's route handlers both read.
// The mounted table's reviewed dispositions live in `cloud`
// (`packages/service-ai/src/ai-route-ledger.ts`), which drives this SDK
// against the routes it really returns.

/**
 * One conversation message on the wire.
 *
 * Deliberately permissive about `content`: the AI routes accept a plain string
 * (legacy), a content-part array, and the Vercel AI SDK v6 `parts` form where
 * `content` may be absent entirely. `role` is the part the routes actually
 * validate, so it is the part constrained here — narrowing `content` further
 * would reject payloads the server accepts.
 */
export const AiMessageSchema = lazySchema(() => z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']).describe('Message role'),
  content: z.unknown().optional().describe('Message content: a string, or an array of content parts'),
  parts: z.array(z.unknown()).optional().describe('Vercel AI SDK v6 message parts (alternative to `content`)'),
}).passthrough()); // adapters carry extra per-message fields (id, createdAt, …)

/**
 * `POST /api/v1/ai/chat` — dual-mode. `stream: false` returns
 * {@link AiChatResponseSchema} as JSON; anything else streams the Vercel UI
 * Message Stream Protocol (SSE with JSON payloads).
 *
 * Flat `model`/`temperature`/`maxTokens` are the Vercel `useChat` shape and
 * take precedence over the same keys nested under `options`.
 */
export const AiChatRequestSchema = lazySchema(() => z.object({
  messages: z.array(AiMessageSchema).min(1).describe('Conversation messages (at least one)'),
  system: z.string().optional().describe('System prompt, prepended as a system message'),
  model: z.string().optional().describe('Model id override'),
  temperature: z.number().optional().describe('Sampling temperature'),
  maxTokens: z.number().int().positive().optional().describe('Maximum tokens to generate'),
  stream: z.boolean().optional().describe('false → JSON response; otherwise the UI Message Stream Protocol'),
  conversationId: z.string().optional().describe('Conversation to persist this turn into (auto-created when omitted)'),
  turnId: z.string().optional().describe('Stable per-turn idempotency key (ADR-0013 D1)'),
  options: z.record(z.string(), z.unknown()).optional().describe('Legacy nested request options'),
}));

/** JSON body of a non-streaming chat/completion turn — the `AIResult` shape. */
export const AiChatResponseSchema = lazySchema(() => z.object({
  content: z.string().describe('Generated text'),
  model: z.string().optional().describe('Model that produced it'),
  toolCalls: z.array(z.unknown()).optional().describe('Tool calls the model requested (Vercel `ToolCallPart`)'),
  usage: z.object({
    promptTokens: z.number().describe('Tokens consumed by the prompt'),
    completionTokens: z.number().describe('Tokens generated'),
    totalTokens: z.number().describe('prompt + completion'),
  }).optional().describe('Token usage'),
  conversationId: z.string().optional().describe('Conversation the turn was persisted into'),
}));

/** `POST /api/v1/ai/complete` — single-shot text completion. */
export const AiCompleteRequestSchema = lazySchema(() => z.object({
  prompt: z.string().describe('Prompt text'),
  options: z.record(z.string(), z.unknown()).optional().describe('Request options (model, temperature, maxTokens, …)'),
}));

/** `GET /api/v1/ai/models` — the environment's plan-filtered picker list (ADR-0028). */
export const AiModelsResponseSchema = lazySchema(() => z.object({
  /**
   * Objects when the service exposes the ADR-0028 allowlist; bare ids when it
   * falls back to the adapter's `listModels()`. Both shapes are live, so both
   * are declared rather than one being asserted and the other 404-by-parse.
   */
  models: z.array(z.union([
    z.string(),
    z.object({
      id: z.string().describe('Model id'),
      label: z.string().describe('Display label for the picker'),
      default: z.boolean().describe('Whether this is the environment default'),
    }),
  ])).describe('Models this environment offers'),
  defaultModel: z.string().optional().describe('Default model id, when the service reports one'),
}));

/** A persisted AI conversation, as the `/ai/conversations` routes return it. */
export const AiConversationSchema = lazySchema(() => z.object({
  id: z.string().describe('Conversation id'),
  title: z.string().optional().describe('Title / summary'),
  agentId: z.string().optional().describe('Agent this conversation is bound to'),
  userId: z.string().optional().describe('Owning user'),
  messages: z.array(AiMessageSchema).describe('Message history'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
  updatedAt: z.string().describe('Last update timestamp (ISO 8601)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Conversation metadata'),
}));

/**
 * `POST /api/v1/ai/conversations`. `userId` is NOT accepted from the caller —
 * the route overwrites it with the authenticated actor.
 */
export const CreateAiConversationRequestSchema = lazySchema(() => z.object({
  title: z.string().optional().describe('Initial title'),
  agentId: z.string().optional().describe('Agent to bind the conversation to'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Conversation metadata'),
}));

/** `GET /api/v1/ai/conversations` query — scoped to the authenticated user. */
export const ListAiConversationsRequestSchema = lazySchema(() => z.object({
  agentId: z.string().optional().describe('Filter by agent'),
  limit: z.number().int().positive().optional().describe('Maximum conversations to return'),
  cursor: z.string().optional().describe('Pagination cursor'),
}));

export const ListAiConversationsResponseSchema = lazySchema(() => z.object({
  conversations: z.array(AiConversationSchema).describe('Matching conversations'),
}));

/**
 * One frame of a streaming chat response.
 *
 * `POST /api/v1/ai/chat` (streaming mode) speaks the Vercel **UI Message
 * Stream Protocol**: SSE lines carrying JSON objects that always have a
 * `type` — `start`, `text-start`, `text-delta`, `tool-input-available`,
 * `tool-output-available`, `error`, `finish-step`, `finish` — terminated by a
 * literal `data: [DONE]`. `POST /api/v1/ai/chat/stream` uses the same SSE
 * envelope for raw `TextStreamPart` events. Only `type` is guaranteed across
 * both, so only `type` is declared; the rest of each frame passes through.
 */
export const AiStreamChunkSchema = lazySchema(() => z.object({
  type: z.string().describe('Frame type (text-delta, tool-input-available, finish, error, …)'),
}).passthrough());

/** `PATCH /api/v1/ai/conversations/:id` — at least one field is required. */
export const UpdateAiConversationRequestSchema = lazySchema(() => z.object({
  title: z.string().optional().describe('New title'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('New metadata'),
}).refine((p) => p.title !== undefined || p.metadata !== undefined, {
  message: 'at least one of title or metadata is required',
}));

// ── Named agents ──────────────────────────────────────────────────────────
//
// `/ai/agents` and `/ai/agents/:agentName/chat` were mounted long before the
// SDK could express them: `objectui` hand-built both URLs in five places
// because there was nothing to call. Typed from what the routes RETURN, not
// from what a client might like them to (#3718).

/** What an agent can do, derived server-side from its surface. */
export const AiAgentCapabilitiesSchema = lazySchema(() => z.object({
  authoring: z.boolean().describe('Authors app metadata (objects/views/flows)'),
  canvas: z.boolean().describe('Drives the Live Canvas split view (ADR-0037)'),
  debug: z.boolean().describe('Exposes the build-doctor debug drawer'),
  resume: z.boolean().describe('Turns resume durable multi-step runs (ADR-0013)'),
}));

/** One row of the `GET /api/v1/ai/agents` catalog. */
export const AiAgentSummarySchema = lazySchema(() => z.object({
  name: z.string().describe('Agent name — the `:agentName` path segment'),
  label: z.string().describe('Display label'),
  role: z.string().describe('Agent role'),
  capabilities: AiAgentCapabilitiesSchema.describe('Capability set implied by the agent surface'),
}));

/**
 * `GET /api/v1/ai/agents` — the **`data` payload**, not the whole body.
 *
 * The body is the platform envelope (`BaseResponseSchema`), and this schema is
 * what travels under `data`: `{ success: true, data: { agents: [...] } }`. It
 * was declared as the whole body until #4053 converted the route, and moving it
 * under `data` was a RELOCATION — the payload is unchanged, exactly as
 * `SettingsNamespacePayload` moved in #3843, not a flatten to the bare array the
 * way #3983 reshaped `/share-links`.
 *
 * That distinction is load-bearing, which is why it is recorded on the
 * declaration rather than only at the two producers. `unwrapResponse` returns
 * `data`, so `client.ai.agents.list()` reads `.agents` off this object; flattening
 * to `data: [...]` would make that read `undefined` → an empty catalog, which
 * `useAiSurfaceEnabled` turns into "hide the entire AI surface" — the same thing a
 * seat-less caller and a Community-Edition deployment correctly see, with no
 * error, no 403 and no log to tell them apart. `ai-agents-envelope.test.ts` pins
 * both halves.
 *
 * ACCESS-AWARE: the route returns only agents the CALLER may chat with
 * (ADR-0049), so an empty list is a legitimate answer for a seat-less user —
 * not an error, and not something to retry.
 */
export const AiAgentsResponseSchema = lazySchema(() => z.object({
  agents: z.array(AiAgentSummarySchema).describe('Agents this caller may chat with'),
}));

/**
 * `POST /api/v1/ai/agents/:agentName/chat`.
 *
 * Same dual-mode `stream` flag as `/ai/chat`: absent or `true` streams Vercel
 * Data Stream frames, `false` returns the JSON reply. The client sets it per
 * method rather than leaving it to the caller, so `agents.chat` cannot
 * accidentally return a stream body.
 */
export const AiAgentChatRequestSchema = lazySchema(() => z.object({
  messages: z.array(AiMessageSchema).min(1).describe('Conversation messages (at least one)'),
  context: z.record(z.string(), z.unknown()).optional().describe('Agent context (app, object, record, …)'),
  options: z.record(z.string(), z.unknown()).optional().describe('Request options (model, temperature, …)'),
}));

// ── HITL pending actions ──────────────────────────────────────────────────
//
// The approval queue an embedding app has to render. `objectui` ships a whole
// approval UI on these four routes over hand-built URLs.

/** Lifecycle of a proposed action. Mirrors `PendingActionStatus` in contracts. */
export const AiPendingActionStatusSchema = lazySchema(() =>
  z.enum(['pending', 'approved', 'executed', 'failed', 'rejected']));

/**
 * One queued action, as the routes return it — the persisted row, snake_case
 * because that is the wire shape, not a style choice.
 */
export const AiPendingActionSchema = lazySchema(() => z.object({
  id: z.string().describe('Pending action id'),
  object_name: z.string().describe('Object the action targets'),
  action_name: z.string().describe('Action name'),
  tool_name: z.string().describe('Tool that would execute it'),
  tool_input: z.string().describe('Serialized tool input'),
  status: AiPendingActionStatusSchema.describe('Lifecycle status'),
  result: z.string().optional().describe('Serialized result, once executed'),
  error: z.string().optional().describe('Failure message, when status is failed'),
  rejection_reason: z.string().optional().describe('Reason given at rejection'),
  conversation_id: z.string().optional().describe('Conversation that proposed it'),
  message_id: z.string().optional().describe('Message that proposed it'),
  proposed_by: z.string().optional().describe('Actor that proposed it'),
  decided_by: z.string().optional().describe('Actor that approved or rejected it'),
  proposed_at: z.string().describe('Proposal timestamp (ISO 8601)'),
  decided_at: z.string().optional().describe('Decision timestamp (ISO 8601)'),
}));

/**
 * `GET /api/v1/ai/pending-actions` query.
 *
 * Only the three the ROUTE reads. `AIService.listPendingActions` also accepts
 * `objectName`, but the route never forwards it, so declaring it here would
 * type a filter that silently does nothing.
 */
export const ListAiPendingActionsRequestSchema = lazySchema(() => z.object({
  status: AiPendingActionStatusSchema.optional().describe('Filter by status'),
  conversationId: z.string().optional().describe('Filter by proposing conversation'),
  limit: z.number().int().positive().optional().describe('Max rows (server default 100)'),
}));

export const ListAiPendingActionsResponseSchema = lazySchema(() => z.object({
  items: z.array(AiPendingActionSchema).describe('Queued actions, newest first'),
  total: z.number().describe('Number of rows returned (not a total across pages)'),
}));

/**
 * `POST /api/v1/ai/pending-actions/:id/approve` — approve AND execute.
 *
 * `status: 'failed'` is a 200 with a reason, not an HTTP error: the approval
 * succeeded, the execution did not. A caller that only checks `res.ok` will
 * report a failed write as a success.
 */
export const ApproveAiPendingActionResponseSchema = lazySchema(() => z.object({
  status: z.enum(['executed', 'failed']).describe('Outcome of executing the approved action'),
  result: z.unknown().optional().describe('Tool result, when executed'),
  error: z.string().optional().describe('Failure reason, when failed'),
}));

/** `POST /api/v1/ai/pending-actions/:id/reject` — never executes anything. */
export const RejectAiPendingActionResponseSchema = lazySchema(() => z.object({
  status: z.literal('rejected').describe('Always "rejected"'),
  id: z.string().describe('The rejected action id'),
}));

// ==========================================
// i18n Operations
// ==========================================

export const GetLocalesRequestSchema = lazySchema(() => z.object({}));

/**
 * `GET /api/v1/i18n/locales` — the available locale set.
 *
 * `label` is the locale CODE, echoed back. Every descriptor on every serving
 * surface comes from one helper — `toLocaleDescriptors`
 * (`system/i18n-resolver.ts`), shared by the runtime dispatcher's `/i18n`
 * domain and `service-i18n`'s autonomous route — and it sets `label` to the
 * code, because nothing in the tree carries a locale name to set it from.
 *
 * This describe used to read "Display name of the locale" while no producer
 * ever wrote one: the declared-not-enforced shape ADR-0049 is about, one field
 * wide. A client that trusted it rendered `th` where `ไทย` belongs — which is
 * what objectui#4039 hit, and why the console routes around the field
 * entirely: its language menu reads `code` alone off this body and names
 * locales from its own built-in table plus `Intl.DisplayNames`
 * (`apps/console/src/loadLocales.ts`). So #7634 made the declaration state the
 * convention it actually ships, and `i18n-resolver.test.ts` pins both halves —
 * the values the producer emits, and this text promising them.
 *
 * Naming a locale for a UI stays the client's job: `Intl.DisplayNames` is in
 * every runtime that matters, and *which* language to name it in (its own, or
 * the requester's `Accept-Language`) is a caller's choice the server cannot
 * make for it. Serving real names would put CLDR data behind an endpoint for
 * something every client can already compute, and no consumer asks for it.
 */
export const GetLocalesResponseSchema = lazySchema(() => z.object({
  locales: z.array(z.object({
    code: z.string().describe('BCP-47 locale code (e.g., en-US, zh-CN)'),
    label: z.string().describe(
      'Locale label. Equals `code` on every serving surface today — the client names locales for its UI (#7634)',
    ),
    isDefault: z.boolean().default(false).describe('Whether this is the default locale'),
  })).describe('Available locales'),
}));

/**
 * `locale` is the whole request — the endpoint returns that locale's full
 * bundle, and there is no server-side filter to ask for.
 *
 * This once declared `namespace` and `keys` filters. Neither serving surface
 * ever read them: the dispatcher domain body takes `parts[1]`/`query.locale`
 * and service-i18n takes `req.params.locale`, so both returned the whole
 * bundle while the SDK dutifully put both on the query string. A caller who
 * passed `keys` to shrink the payload shrank nothing and was told nothing —
 * Prime Directive #10's declared ≠ enforced, the shape #1475 trimmed out of
 * the validation-rule types. Removed rather than implemented (#3676): no
 * caller in this repo or objectui passed either one, `II18nService`
 * (`contracts/i18n-service.ts`) takes only `locale` so a filter could only be
 * a post-filter on an already-materialized bundle — which is precisely not
 * the server-side work `keys` reads as saving — and against the nested
 * `TranslationData` shape #3778 settled on, a flat `keys: string[]` has no
 * defined meaning at all. Re-adding an optional filter is additive and
 * non-breaking the day a consumer actually needs one; a declared-but-unread
 * field is the exemplar the next author copies.
 */
export const GetTranslationsRequestSchema = lazySchema(() => z.object({
  locale: z.string().describe('BCP-47 locale code'),
}));

export const GetTranslationsResponseSchema = lazySchema(() => z.object({
  locale: z.string().describe('Locale code'),
  translations: TranslationDataSchema.describe('Translation data'),
}));

export const GetFieldLabelsRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  locale: z.string().describe('BCP-47 locale code'),
}));

export const GetFieldLabelsResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  locale: z.string().describe('Locale code'),
  labels: z.record(z.string(), z.object({
    label: z.string().describe('Translated field label'),
    help: z.string().optional().describe('Translated help text'),
    options: z.record(z.string(), z.string()).optional().describe('Translated option labels'),
  })).describe('Field labels keyed by field name'),
}));

// ==========================================
// Protocol Interface Schema
// ==========================================

/**
 * TypeScript Types
 * Derived from Zod schemas using z.infer
 */
export type GetDiscoveryRequest = z.input<typeof GetDiscoveryRequestSchema>;
export type GetDiscoveryResponse = z.input<typeof GetDiscoveryResponseSchema>;
export type GetMetaTypesRequest = z.input<typeof GetMetaTypesRequestSchema>;
export type GetMetaTypesResponse = z.input<typeof GetMetaTypesResponseSchema>;
export type GetMetaItemsRequest = z.input<typeof GetMetaItemsRequestSchema>;
export type GetMetaItemsResponse = z.input<typeof GetMetaItemsResponseSchema>;
export type GetMetaItemRequest = z.input<typeof GetMetaItemRequestSchema>;
export type GetMetaItemResponse = z.input<typeof GetMetaItemResponseSchema>;
export type GetMetaItemLayeredRequest = z.input<typeof GetMetaItemLayeredRequestSchema>;
export type GetMetaItemLayeredResponse = z.input<typeof GetMetaItemLayeredResponseSchema>;
/**
 * One #4463 runtime authoring-gate finding. The SINGLE declaration of the shape;
 * `@objectstack/metadata-protocol` re-exports this rather than declaring its own
 * (#4717), so the 422 `issues[]` and the 2xx `advisories[]` cannot drift apart.
 */
export type RuntimeAuthoringIssue = z.input<typeof RuntimeAuthoringIssueSchema>;
export type SaveMetaItemRequest = z.input<typeof SaveMetaItemRequestSchema>;
export type SaveMetaItemResponse = z.input<typeof SaveMetaItemResponseSchema>;
export type PublishMetaItemResponse = z.input<typeof PublishMetaItemResponseSchema>;
/**
 * The batch publish door's response — `POST /packages/:id/publish-drafts`
 * (#9406). `probes` is `unknown` by declaration, not by omission: the #9406
 * ruling stages it opaque until a consumer needs a field of it.
 */
export type PublishPackageDraftsResponse = z.input<typeof PublishPackageDraftsResponseSchema>;
export type DeleteMetaItemRequest = z.input<typeof DeleteMetaItemRequestSchema>;
export type DeleteMetaItemResponse = z.input<typeof DeleteMetaItemResponseSchema>;
export type GetMetaItemCachedRequest = z.input<typeof GetMetaItemCachedRequestSchema>;
export type GetMetaItemCachedResponse = z.input<typeof GetMetaItemCachedResponseSchema>;
/** Post-parse shape of {@link GetMetaItemCachedResponse} — defaults applied, transforms run (ADR-0122). */
export type GetMetaItemCachedResponseParsed = z.infer<typeof GetMetaItemCachedResponseSchema>;
export type GetUiViewRequest = z.input<typeof GetUiViewRequestSchema>;
export type GetUiViewResponse = z.input<typeof GetUiViewResponseSchema>;
/** Post-parse shape of {@link GetUiViewResponse} — defaults applied, transforms run (ADR-0122). */
export type GetUiViewResponseParsed = z.infer<typeof GetUiViewResponseSchema>;

type AnalyticsQueryRequest = z.infer<typeof AnalyticsQueryRequestSchema>;
type AnalyticsResultResponse = z.infer<typeof AnalyticsResultResponseSchema>;
type GetAnalyticsMetaRequest = z.infer<typeof GetAnalyticsMetaRequestSchema>;
type GetAnalyticsMetaResponse = z.infer<typeof AnalyticsMetadataResponseSchema>;

export type AutomationTriggerRequest = z.input<typeof AutomationTriggerRequestSchema>;
export type AutomationTriggerResponse = z.input<typeof AutomationTriggerResponseSchema>;
export type AutomationActionsResponse = z.input<typeof AutomationActionsResponseSchema>;
/** Post-parse shape of {@link AutomationActionsResponse} — defaults applied, transforms run (ADR-0122). */
export type AutomationActionsResponseParsed = z.infer<typeof AutomationActionsResponseSchema>;

export type FindDataRequest = z.input<typeof FindDataRequestSchema>;
/** Post-parse shape of {@link FindDataRequest} — defaults applied, transforms run (ADR-0122). */
export type FindDataRequestParsed = z.infer<typeof FindDataRequestSchema>;
export type FindDataResponse = z.input<typeof FindDataResponseSchema>;
export type GetDataRequest = z.input<typeof GetDataRequestSchema>;
export type GetDataResponse = z.input<typeof GetDataResponseSchema>;
export type CreateDataRequest = z.input<typeof CreateDataRequestSchema>;
export type CreateDataResponse = z.input<typeof CreateDataResponseSchema>;
export type ValidateDataIssue = z.input<typeof ValidateDataIssueSchema>;
export type ValidateDataRequest = z.input<typeof ValidateDataRequestSchema>;
export type ValidateDataResponse = z.input<typeof ValidateDataResponseSchema>;
export type UpdateDataRequest = z.input<typeof UpdateDataRequestSchema>;
export type UpdateDataResponse = z.input<typeof UpdateDataResponseSchema>;
export type DeleteDataRequest = z.input<typeof DeleteDataRequestSchema>;
export type DeleteDataResponse = z.input<typeof DeleteDataResponseSchema>;

export type BatchDataRequest = z.input<typeof BatchDataRequestSchema>;
/** Post-parse shape of {@link BatchDataRequest} — defaults applied, transforms run (ADR-0122). */
export type BatchDataRequestParsed = z.infer<typeof BatchDataRequestSchema>;
export type BatchDataResponse = z.input<typeof BatchDataResponseSchema>;
/** Post-parse shape of {@link BatchDataResponse} — defaults applied, transforms run (ADR-0122). */
export type BatchDataResponseParsed = z.infer<typeof BatchDataResponseSchema>;
export type CreateManyDataRequest = z.input<typeof CreateManyDataRequestSchema>;
export type CreateManyDataResponse = z.input<typeof CreateManyDataResponseSchema>;
export type UpdateManyDataRequest = z.input<typeof UpdateManyDataRequestSchema>;
/** Post-parse shape of {@link UpdateManyDataRequest} — defaults applied, transforms run (ADR-0122). */
export type UpdateManyDataRequestParsed = z.infer<typeof UpdateManyDataRequestSchema>;
export type UpdateManyDataResponse = z.input<typeof UpdateManyDataResponseSchema>;
/** Post-parse shape of {@link UpdateManyDataResponse} — defaults applied, transforms run (ADR-0122). */
export type UpdateManyDataResponseParsed = z.infer<typeof UpdateManyDataResponseSchema>;
export type DeleteManyDataRequest = z.input<typeof DeleteManyDataRequestSchema>;
/** Post-parse shape of {@link DeleteManyDataRequest} — defaults applied, transforms run (ADR-0122). */
export type DeleteManyDataRequestParsed = z.infer<typeof DeleteManyDataRequestSchema>;
export type DeleteManyDataResponse = z.input<typeof DeleteManyDataResponseSchema>;
/** Post-parse shape of {@link DeleteManyDataResponse} — defaults applied, transforms run (ADR-0122). */
export type DeleteManyDataResponseParsed = z.infer<typeof DeleteManyDataResponseSchema>;

// Permission Types
export type CheckPermissionRequest = z.input<typeof CheckPermissionRequestSchema>;
export type CheckPermissionResponse = z.input<typeof CheckPermissionResponseSchema>;
export type GetObjectPermissionsRequest = z.input<typeof GetObjectPermissionsRequestSchema>;
export type GetObjectPermissionsResponse = z.input<typeof GetObjectPermissionsResponseSchema>;
/** Post-parse shape of {@link GetObjectPermissionsResponse} — defaults applied, transforms run (ADR-0122). */
export type GetObjectPermissionsResponseParsed = z.infer<typeof GetObjectPermissionsResponseSchema>;
export type GetEffectivePermissionsRequest = z.input<typeof GetEffectivePermissionsRequestSchema>;
export type GetEffectivePermissionsResponse = z.input<typeof GetEffectivePermissionsResponseSchema>;

// Workflow Types — removed with the schemas (#4451, v17); see the block comment
// at "Workflow Operations — REMOVED" above.

// Realtime Types
export type RealtimeConnectRequest = z.input<typeof RealtimeConnectRequestSchema>;
export type RealtimeConnectResponse = z.input<typeof RealtimeConnectResponseSchema>;
export type RealtimeDisconnectRequest = z.input<typeof RealtimeDisconnectRequestSchema>;
export type RealtimeDisconnectResponse = z.input<typeof RealtimeDisconnectResponseSchema>;
export type RealtimeSubscribeRequest = z.input<typeof RealtimeSubscribeRequestSchema>;
export type RealtimeSubscribeResponse = z.input<typeof RealtimeSubscribeResponseSchema>;
export type RealtimeUnsubscribeRequest = z.input<typeof RealtimeUnsubscribeRequestSchema>;
export type RealtimeUnsubscribeResponse = z.input<typeof RealtimeUnsubscribeResponseSchema>;
export type SetPresenceRequest = z.input<typeof SetPresenceRequestSchema>;
export type SetPresenceResponse = z.input<typeof SetPresenceResponseSchema>;
export type GetPresenceRequest = z.input<typeof GetPresenceRequestSchema>;
export type GetPresenceResponse = z.input<typeof GetPresenceResponseSchema>;

// Notification Types
export type RegisterDeviceRequest = z.input<typeof RegisterDeviceRequestSchema>;
export type RegisterDeviceResponse = z.input<typeof RegisterDeviceResponseSchema>;
export type UnregisterDeviceRequest = z.input<typeof UnregisterDeviceRequestSchema>;
export type UnregisterDeviceResponse = z.input<typeof UnregisterDeviceResponseSchema>;
export type NotificationPreferences = z.input<typeof NotificationPreferencesSchema>;
/** Post-parse shape of {@link NotificationPreferences} — defaults applied, transforms run (ADR-0122). */
export type NotificationPreferencesParsed = z.infer<typeof NotificationPreferencesSchema>;
export type GetNotificationPreferencesRequest = z.input<typeof GetNotificationPreferencesRequestSchema>;
export type GetNotificationPreferencesResponse = z.input<typeof GetNotificationPreferencesResponseSchema>;
/** Post-parse shape of {@link GetNotificationPreferencesResponse} — defaults applied, transforms run (ADR-0122). */
export type GetNotificationPreferencesResponseParsed = z.infer<typeof GetNotificationPreferencesResponseSchema>;
export type UpdateNotificationPreferencesRequest = z.input<typeof UpdateNotificationPreferencesRequestSchema>;
/** Post-parse shape of {@link UpdateNotificationPreferencesRequest} — defaults applied, transforms run (ADR-0122). */
export type UpdateNotificationPreferencesRequestParsed = z.infer<typeof UpdateNotificationPreferencesRequestSchema>;
export type UpdateNotificationPreferencesResponse = z.input<typeof UpdateNotificationPreferencesResponseSchema>;
/** Post-parse shape of {@link UpdateNotificationPreferencesResponse} — defaults applied, transforms run (ADR-0122). */
export type UpdateNotificationPreferencesResponseParsed = z.infer<typeof UpdateNotificationPreferencesResponseSchema>;
export type Notification = z.input<typeof NotificationSchema>;
/** Post-parse shape of {@link Notification} — defaults applied, transforms run (ADR-0122). */
export type NotificationParsed = z.infer<typeof NotificationSchema>;
export type ListNotificationsRequest = z.input<typeof ListNotificationsRequestSchema>;
/** Post-parse shape of {@link ListNotificationsRequest} — defaults applied, transforms run (ADR-0122). */
export type ListNotificationsRequestParsed = z.infer<typeof ListNotificationsRequestSchema>;
export type ListNotificationsResponse = z.input<typeof ListNotificationsResponseSchema>;
/** Post-parse shape of {@link ListNotificationsResponse} — defaults applied, transforms run (ADR-0122). */
export type ListNotificationsResponseParsed = z.infer<typeof ListNotificationsResponseSchema>;
export type MarkNotificationsReadRequest = z.input<typeof MarkNotificationsReadRequestSchema>;
export type MarkNotificationsReadResponse = z.input<typeof MarkNotificationsReadResponseSchema>;
export type MarkAllNotificationsReadRequest = z.input<typeof MarkAllNotificationsReadRequestSchema>;
export type MarkAllNotificationsReadResponse = z.input<typeof MarkAllNotificationsReadResponseSchema>;

// AI Types
export type AiMessage = z.input<typeof AiMessageSchema>;
export type AiChatRequest = z.input<typeof AiChatRequestSchema>;
export type AiChatResponse = z.input<typeof AiChatResponseSchema>;
export type AiStreamChunk = z.input<typeof AiStreamChunkSchema>;
export type AiCompleteRequest = z.input<typeof AiCompleteRequestSchema>;
export type AiModelsResponse = z.input<typeof AiModelsResponseSchema>;
export type AiConversation = z.input<typeof AiConversationSchema>;
export type CreateAiConversationRequest = z.input<typeof CreateAiConversationRequestSchema>;
export type ListAiConversationsRequest = z.input<typeof ListAiConversationsRequestSchema>;
export type ListAiConversationsResponse = z.input<typeof ListAiConversationsResponseSchema>;
export type UpdateAiConversationRequest = z.input<typeof UpdateAiConversationRequestSchema>;
export type AiAgentCapabilities = z.input<typeof AiAgentCapabilitiesSchema>;
export type AiAgentSummary = z.input<typeof AiAgentSummarySchema>;
export type AiAgentsResponse = z.input<typeof AiAgentsResponseSchema>;
export type AiAgentChatRequest = z.input<typeof AiAgentChatRequestSchema>;
export type AiPendingActionStatus = z.input<typeof AiPendingActionStatusSchema>;
export type AiPendingAction = z.input<typeof AiPendingActionSchema>;
export type ListAiPendingActionsRequest = z.input<typeof ListAiPendingActionsRequestSchema>;
export type ListAiPendingActionsResponse = z.input<typeof ListAiPendingActionsResponseSchema>;
export type ApproveAiPendingActionResponse = z.input<typeof ApproveAiPendingActionResponseSchema>;
export type RejectAiPendingActionResponse = z.input<typeof RejectAiPendingActionResponseSchema>;

// i18n Types
export type GetLocalesRequest = z.input<typeof GetLocalesRequestSchema>;
export type GetLocalesResponse = z.input<typeof GetLocalesResponseSchema>;
/** Post-parse shape of {@link GetLocalesResponse} — defaults applied, transforms run (ADR-0122). */
export type GetLocalesResponseParsed = z.infer<typeof GetLocalesResponseSchema>;
export type GetTranslationsRequest = z.input<typeof GetTranslationsRequestSchema>;
export type GetTranslationsResponse = z.input<typeof GetTranslationsResponseSchema>;
export type GetFieldLabelsRequest = z.input<typeof GetFieldLabelsRequestSchema>;
export type GetFieldLabelsResponse = z.input<typeof GetFieldLabelsResponseSchema>;

// Package Management Types (re-exported from kernel for convenience)
export type { 
  ListPackagesRequest,
  ListPackagesResponse,
  GetPackageRequest,
  GetPackageResponse,
  InstallPackageRequest,
  InstallPackageResponse,
  UninstallPackageRequest,
  UninstallPackageResponse,
  EnablePackageRequest,
  EnablePackageResponse,
  DisablePackageRequest,
  DisablePackageResponse,
  InstalledPackage,
  PackageStatus,
};

/**
 * Zod-inferred protocol type (for runtime validation only).
 * Depend on the narrowest per-domain contract (e.g. `DataProtocol`).
 */

/**
 * ObjectStack Protocol Interface
 * 
 * Properly typed interface for implementing the ObjectStack API protocol.
 * Per-domain Zod schemas are used for runtime validation,
 * while this interface provides compile-time type safety for implementations.
 */
// ─────────────────────────────────────────────────────────────────────────────
// Protocol contracts, segmented per domain (ADR-0076 D9).
//
// The historical `ObjectStackProtocol` union of these per-domain contracts was
// and is shape-identical to the historical flat interface — a back-compat alias.
// New code should depend on the narrowest slice it needs (e.g. `DataProtocol`).
// Per ADR-0076 D9 (rev.7) the union is transitional; the end-state dissolves it
// in favour of independent domain protocols + the discovery `services` registry.
// ─────────────────────────────────────────────────────────────────────────────

/** Business-data CRUD + batch operations (thin wire-normalizers over the engine). */
export interface DataProtocol {
  // Data Operations (core)
  findData(request: FindDataRequest): Promise<FindDataResponse>;
  getData(request: GetDataRequest): Promise<GetDataResponse>;
  createData(request: CreateDataRequest): Promise<CreateDataResponse>;
  updateData(request: UpdateDataRequest): Promise<UpdateDataResponse>;
  deleteData(request: DeleteDataRequest): Promise<DeleteDataResponse>;

  /**
   * Validate-only (#6037 — #4633 ruling D): the write path's verdict on
   * candidate rows, with nothing persisted.
   *
   * Declared optional because it is additive to a shipped contract, not
   * because it is aspirational — `metadata-protocol` implements it in the same
   * change that declares it. That is a ruling clause, not a style note:
   * `BatchOptions.validateOnly` was retired in #4052 as a dry-run flag that
   * "promised a dry-run" while every batch surface persisted regardless, so a
   * caller previewing a mutation had it EXECUTED. A second declared-and-unmet
   * validation promise is the one outcome this operation must not become.
   *
   * The verdict honours the deployment's real ADR-0104 posture, so it predicts
   * what THIS deployment would do — see `ValidateDataResponseSchema.posture`.
   */
  validateData?(request: ValidateDataRequest): Promise<ValidateDataResponse>;

  // Batch Operations (optional)
  batchData?(request: BatchDataRequest): Promise<BatchDataResponse>;
  createManyData?(request: CreateManyDataRequest): Promise<CreateManyDataResponse>;
  updateManyData?(request: UpdateManyDataRequest): Promise<UpdateManyDataResponse>;
  deleteManyData?(request: DeleteManyDataRequest): Promise<DeleteManyDataResponse>;
}

/** Discovery + metadata (sys_metadata) management. */
export interface MetadataProtocol {
  // Discovery & Metadata (core)
  getDiscovery(request?: GetDiscoveryRequest): Promise<GetDiscoveryResponse>;
  getMetaTypes(request?: GetMetaTypesRequest): Promise<GetMetaTypesResponse>;
  getMetaItems(request: GetMetaItemsRequest): Promise<GetMetaItemsResponse>;
  getMetaItem(request: GetMetaItemRequest): Promise<GetMetaItemResponse>;
  saveMetaItem(request: SaveMetaItemRequest): Promise<SaveMetaItemResponse>;
  /**
   * Delete a metadata customization overlay row. Per ADR-0005 this is the
   * "reset to artifact factory default" semantic — it removes a sys_metadata
   * row (if present) so subsequent reads fall through to the compiled
   * artifact. Whitelisted to view + dashboard in project-kernel mode.
   */
  deleteMetaItem?(request: DeleteMetaItemRequest): Promise<DeleteMetaItemResponse>;
  getMetaItemCached?(request: GetMetaItemCachedRequest): Promise<GetMetaItemCachedResponse>;
  // `getMetaItemLayered` is deliberately NOT declared here yet, although both
  // its request and response schemas are (see them above). Declaring the
  // member makes tsc check `metadata-protocol`'s implementation against
  // `GetMetaItemLayeredResponse`, and that check currently fails on one
  // member: the implementation's inline return type annotates `lockSource`
  // with an `'overlay'` arm that its only producer (`resolveLockState`, whose
  // return is typed `MetadataLockSource | undefined`) can never emit — an
  // over-wide annotation, not enforced behaviour. Until that annotation is
  // corrected at the implementation, adding the member here would either lie
  // about the wire enum or hard-break the implementing class. Tracked as its
  // own card (filed from #9726).
  getUiView?(request: GetUiViewRequest): Promise<GetUiViewResponse>;
}

/** Analytics (optional). */
export interface AnalyticsProtocol {
  analyticsQuery?(request: AnalyticsQueryRequest): Promise<AnalyticsResultResponse>;
  getAnalyticsMeta?(request: GetAnalyticsMetaRequest): Promise<GetAnalyticsMetaResponse>;
}

/** Automation (optional). */
export interface AutomationProtocol {
  triggerAutomation?(request: AutomationTriggerRequest): Promise<AutomationTriggerResponse>;
}

/** Package lifecycle (optional). */
export interface PackageProtocol {
  listPackages?(request: ListPackagesRequest): Promise<ListPackagesResponse>;
  getPackage?(request: GetPackageRequest): Promise<GetPackageResponse>;
  installPackage?(request: InstallPackageRequest): Promise<InstallPackageResponse>;
  uninstallPackage?(request: UninstallPackageRequest): Promise<UninstallPackageResponse>;
  enablePackage?(request: EnablePackageRequest): Promise<EnablePackageResponse>;
  disablePackage?(request: DisablePackageRequest): Promise<DisablePackageResponse>;
}

// `ViewProtocol` (`listViews` / `getView` / `createView` / `updateView` /
// `deleteView`) was REMOVED at protocol 17 — see the "View Management
// Operations — RETIRED" note above (#6239). No host implemented it and no route
// reached it; view read/write is `MetadataProtocol` (`getMetaItem` /
// `saveMetaItem` / `deleteMetaItem` with `type: 'view'`) plus `getUiView`.

/** Permissions (optional). */
export interface PermissionProtocol {
  checkPermission?(request: CheckPermissionRequest): Promise<CheckPermissionResponse>;
  getObjectPermissions?(request: GetObjectPermissionsRequest): Promise<GetObjectPermissionsResponse>;
  getEffectivePermissions?(request: GetEffectivePermissionsRequest): Promise<GetEffectivePermissionsResponse>;
}

// `WorkflowProtocol` (optional sub-protocol) was removed here (#4451, v17):
// no implementation of any of its three methods ever existed. See the
// "Workflow Operations — REMOVED" block comment above.

/** Realtime / presence (optional). */
export interface RealtimeProtocol {
  realtimeConnect?(request: RealtimeConnectRequest): Promise<RealtimeConnectResponse>;
  realtimeDisconnect?(request: RealtimeDisconnectRequest): Promise<RealtimeDisconnectResponse>;
  realtimeSubscribe?(request: RealtimeSubscribeRequest): Promise<RealtimeSubscribeResponse>;
  realtimeUnsubscribe?(request: RealtimeUnsubscribeRequest): Promise<RealtimeUnsubscribeResponse>;
  setPresence?(request: SetPresenceRequest): Promise<SetPresenceResponse>;
  getPresence?(request: GetPresenceRequest): Promise<GetPresenceResponse>;
}

/** Notifications (optional). */
export interface NotificationProtocol {
  registerDevice?(request: RegisterDeviceRequest): Promise<RegisterDeviceResponse>;
  unregisterDevice?(request: UnregisterDeviceRequest): Promise<UnregisterDeviceResponse>;
  getNotificationPreferences?(request: GetNotificationPreferencesRequest): Promise<GetNotificationPreferencesResponse>;
  updateNotificationPreferences?(request: UpdateNotificationPreferencesRequest): Promise<UpdateNotificationPreferencesResponse>;
  listNotifications?(request: ListNotificationsRequest): Promise<ListNotificationsResponse>;
  markNotificationsRead?(request: MarkNotificationsReadRequest): Promise<MarkNotificationsReadResponse>;
  markAllNotificationsRead?(request: MarkAllNotificationsReadRequest): Promise<MarkAllNotificationsReadResponse>;
}

// `AiProtocol` is GONE (#3718).
//
// It declared exactly three optional methods — `aiNlq?` / `aiSuggest?` /
// `aiInsights?` — and no service in any repo implemented one. Nothing
// dispatched through it either: `/api/v1/ai/**` is proxied straight to the
// route handlers `service-ai` (Cloud/EE, in the `cloud` repo) builds, never
// through a protocol object. An interface whose every member is optional and
// unimplemented does not describe a server — it only makes one look declared.
//
// The real server-side contract for AI is `IAIService` +
// `IAIConversationService` in `@objectstack/spec/contracts` (`ai-service.ts`),
// which `service-ai` actually implements. The wire shapes those routes speak
// are the `Ai*` schemas above.

/** Localization (optional). */
export interface I18nProtocol {
  getLocales?(request: GetLocalesRequest): Promise<GetLocalesResponse>;
  getTranslations?(request: GetTranslationsRequest): Promise<GetTranslationsResponse>;
  getFieldLabels?(request: GetFieldLabelsRequest): Promise<GetFieldLabelsResponse>;
}

