// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Metadata Event Types
 *
 * Triggered when metadata items are created, updated, or deleted.
 * Follows the pattern: `metadata.{type}.{action}`
 *
 * Examples:
 * - `metadata.object.created` - A new object was created
 * - `metadata.view.updated` - A view was updated
 * - `metadata.agent.deleted` - An agent was deleted
 */
import { lazySchema } from '../shared/lazy-schema';
export const MetadataEventType = z.enum([
  'metadata.object.created',
  'metadata.object.updated',
  'metadata.object.deleted',
  'metadata.field.created',
  'metadata.field.updated',
  'metadata.field.deleted',
  'metadata.view.created',
  'metadata.view.updated',
  'metadata.view.deleted',
  'metadata.app.created',
  'metadata.app.updated',
  'metadata.app.deleted',
  'metadata.agent.created',
  'metadata.agent.updated',
  'metadata.agent.deleted',
  'metadata.tool.created',
  'metadata.tool.updated',
  'metadata.tool.deleted',
  'metadata.flow.created',
  'metadata.flow.updated',
  'metadata.flow.deleted',
  'metadata.action.created',
  'metadata.action.updated',
  'metadata.action.deleted',
  'metadata.workflow.created',
  'metadata.workflow.updated',
  'metadata.workflow.deleted',
  'metadata.dashboard.created',
  'metadata.dashboard.updated',
  'metadata.dashboard.deleted',
  'metadata.report.created',
  'metadata.report.updated',
  'metadata.report.deleted',
  'metadata.role.created',
  'metadata.role.updated',
  'metadata.role.deleted',
  'metadata.permission.created',
  'metadata.permission.updated',
  'metadata.permission.deleted',
]);

export type MetadataEventType = z.input<typeof MetadataEventType>;

/**
 * The `{action}` half of `metadata.{type}.{action}`.
 *
 * Module-private: it exists to make {@link MetadataEventSubject}'s pattern
 * spell the real suffix instead of `${string}`, which would also match a type
 * name containing a dot and silently mis-split it. Not exported — the actions
 * are a property of the event-name grammar, not a vocabulary anything outside
 * this file chooses from.
 */
type MetadataEventAction = 'created' | 'updated' | 'deleted';

/**
 * Splits one `metadata.{type}.{action}` name into its `{type}` segment.
 *
 * The type parameter is what makes this work: a conditional type distributes
 * over a union only through a NAKED type parameter, so matching the whole
 * {@link MetadataEventType} union against the pattern inline would infer one
 * answer for all 39 members instead of 13 answers. Module-private for the same
 * reason {@link MetadataEventAction} is — it is derivation machinery, not a
 * contract anyone authors against.
 */
type MetadataEventSubjectOf<T extends string> =
  T extends `metadata.${infer Subject}.${MetadataEventAction}` ? Subject : never;

/**
 * Metadata Event Subject — the `{type}` half of `metadata.{type}.{action}`:
 * `'object' | 'field' | 'view' | …`, DERIVED from {@link MetadataEventType}
 * rather than restated, so the two can never disagree.
 *
 * This is the set of metadata types that HAVE a realtime event contract, and
 * it is the same set on both sides of the wire:
 *
 * - **Publish** (#4602, `MetadataManager.register`/`unregister`): a metadata
 *   type outside {@link MetadataEventType} publishes nothing — there is no
 *   event shape that could be delivered to a `(event: MetadataEvent) => void`
 *   callback, and emitting one every compliant consumer must reject is worse
 *   than silence.
 * - **Subscribe** (#4627, `@objectstack/client`'s `subscribeMetadata` and the
 *   `@objectstack/client-react` hooks that delegate to it): the parameter is
 *   THIS type, so subscribing to a type that will never fire —
 *   `subscribeMetadata('translation', …)` — is a compile error rather than a
 *   green build with a permanently silent callback.
 *
 * `MetadataManager.register()` accepts any `type` string and
 * `DEFAULT_METADATA_TYPE_REGISTRY` holds more types than this
 * (`translation`, `datasource`, `page`, `hook`, `trigger`, `validation`, …).
 * That gap is deliberate and is NOT closed by widening this alias: which
 * additional types deserve a realtime event is a product question, tracked as
 * axis 2 of #4627 and answered only when a real consumer needs one (e.g.
 * #4426 would put `translation` in play). Until then the honest statement is
 * the narrow one — adding a member here without adding its three
 * {@link MetadataEventType} names would re-open exactly the silent-subscription
 * hole this alias closes, and the derivation makes that impossible to express.
 */
export type MetadataEventSubject = MetadataEventSubjectOf<MetadataEventType>;

/**
 * Data Event Types
 *
 * Triggered when data records are created, updated, or deleted.
 * Follows the pattern: `data.record.{action}`
 *
 * Only event names with a REAL producer are declared here — a subscriber must
 * not be able to wait on something that never fires (the same rule
 * `WebhookTriggerType` states for its own vocabulary). The engine's
 * `publishDataEvent` emits exactly these three.
 *
 * REMOVED in 17.0.0 (#4673, ADR-0049 enforce-or-remove): `data.field.changed`.
 * Nothing in either repository ever emitted it, and `DataEventSchema` has no
 * `field` / `oldValue` / `newValue` slot to carry per-field semantics anyway —
 * it is record-shaped. Per-field detail is already on the record event: a
 * `data.record.updated` payload carries `changes` (the changed fields),
 * `before` and `after`. A consumer that keyed on `data.field.changed` was
 * keying on an event no producer sent (ADR-0078's silently-inert declaration).
 * If a genuine per-field stream is ever needed it gets its own honest contract
 * — the precedent #4639 set for bulk writes — rather than an empty member here.
 */
export const DataEventType = z.enum([
  'data.record.created',
  'data.record.updated',
  'data.record.deleted',
]);

export type DataEventType = z.input<typeof DataEventType>;

/**
 * Bulk Data Event Types
 *
 * Triggered when a predicate write touches an unbounded set of records:
 * `ObjectQL.update()` / `delete()` with `options.multi = true`, which reach
 * `IDataDriver.updateMany` / `deleteMany`. Follows the pattern
 * `data.records.{action}` — plural, to read differently at a glance from the
 * per-record `data.record.{action}` above.
 *
 * These exist because the driver contract for a multi-row write returns an
 * affected COUNT and nothing else (`Promise<number>` — see
 * `contracts/data-driver.ts`), so there is no record identity to put in
 * {@link DataEventSchema}'s required `recordId`. Before #4639 the engine had
 * only two options, and both were wrong: fabricate a per-record event with
 * `recordId: ''` (which every schema-compliant consumer must reject — the
 * pre-#4626 behaviour), or publish nothing at all (#4626's honest-but-silent
 * stopgap). A bulk write now gets its OWN contract instead of impersonating a
 * per-record one: a consumer that receives `data.records.updated` can see from
 * the type alone that no `recordId` is coming, rather than discovering it as an
 * empty string at runtime.
 *
 * There is deliberately no `data.records.created`: a batch insert knows every
 * row it wrote, so the engine publishes N per-record `data.record.created`
 * events for it (each with its own event id) — a count would be strictly less
 * information than the contract already delivers.
 */
export const BulkDataEventType = z.enum([
  'data.records.updated',
  'data.records.deleted',
]);

export type BulkDataEventType = z.input<typeof BulkDataEventType>;

/**
 * Metadata Event Payload
 *
 * Represents a metadata change event (create, update, delete).
 * Used for real-time synchronization of metadata across clients.
 */
export const MetadataEventSchema = lazySchema(() => z.object({
  /** Unique event identifier */
  id: z.string().uuid().describe('Unique event identifier'),

  /** Event type (metadata.{type}.{action}) */
  type: MetadataEventType.describe('Event type'),

  /** Metadata type (object, view, agent, tool, etc.) */
  metadataType: z.string().describe('Metadata type (object, view, agent, etc.)'),

  /** Metadata item name */
  name: z.string().describe('Metadata item name'),

  /** Package ID (if applicable) */
  packageId: z.string().optional().describe('Package ID'),

  /** Full definition (only for create/update events) */
  definition: z.unknown().optional().describe('Full definition (create/update only)'),

  /** User who triggered the event */
  userId: z.string().optional().describe('User who triggered the event'),

  /** Event timestamp (ISO 8601) */
  timestamp: z.string().datetime().describe('Event timestamp'),
}));

export type MetadataEvent = z.input<typeof MetadataEventSchema>;

/**
 * Data Event Payload
 *
 * Represents a data record change event (create, update, delete).
 * Used for real-time synchronization of data records across clients.
 *
 * **This payload IS the contract a consumer discriminates on.** It travels as
 * the `payload` of the `RealtimeEventPayload` envelope
 * (`contracts/realtime-service.ts`), and the envelope is a transport shape —
 * `type` / `object` / `payload` / `timestamp`, a TypeScript interface no
 * parse ever validates. Every consumer that must read a per-event fact
 * already reads it HERE, not on the envelope: the webhook fan-out takes
 * `recordId` from the payload at its match site, and the client SDK
 * `safeParse`s the payload against this schema before it delivers anything.
 * So the tenant term below is a member of this validated payload rather than
 * a second, unvalidated envelope field: one declaration, enforced at the
 * publish site by the same `parse` that enforces `recordId`.
 */
export const DataEventSchema = lazySchema(() => z.object({
  /** Unique event identifier */
  id: z.string().uuid().describe('Unique event identifier'),

  /** Event type (data.record.{action}) */
  type: DataEventType.describe('Event type'),

  /** Object name */
  object: z.string().describe('Object name'),

  /** Record ID */
  recordId: z.string().describe('Record ID'),

  /**
   * Organization the record belongs to — its `organization_id` column, under
   * the camelCase spelling every published payload in this package uses for
   * the tenant term (`organizationId`, the blessed developer-facing name).
   *
   * **Why a first-class member and not a read of the record body.** A
   * tenant-scoped consumer — the webhook fan-out matching subscriptions to
   * events, a per-organization realtime subscriber — must discriminate the
   * event's tenant BEFORE it touches the record: `after` is absent on
   * `data.record.deleted`, `before` is absent on create, and both are the
   * unfiltered row body the consumer may not be entitled to read at all. The
   * match term therefore rides beside `object` and `recordId`, validated
   * with the rest of the event at the publish site.
   *
   * **Absent = the record belongs to no organization.** Two situations, one
   * meaning:
   *  - a `single`-posture deployment — `postureEnforcesWall(posture)` is
   *    `false` and `postureStampsOrganization(posture)` with it (see
   *    `@objectstack/spec/security`): there is no organization wall and
   *    nothing stamps the column, so EVERY event is organization-less;
   *  - a row that carries no organization under a walled posture (`group` /
   *    `isolated`): an environment-wide row (`organization_id IS NULL`), or a
   *    row of an object that stands outside the wall — `tenancy.enabled:
   *    false` by declaration, or no `organization_id` column at all (the
   *    identity tables).
   * In both, a consumer may read absence as "not behind any organization
   * wall" — the reading it already gives an `organization_id IS NULL` row on
   * the read path. It may NOT read absence as "unknown, resolve it yourself":
   * either the producer had the organization in hand or the record has none,
   * and a per-event lookup on the fan-out path is exactly the hot-path read
   * this member exists to make unnecessary.
   *
   * **Present = exactly that organization, never a guess.** It names the
   * organization the RECORD belongs to — not the caller's active organization
   * standing in for the row's, which would mislabel an administrator's write
   * into another organization. It is never fabricated: no `.default()`, and
   * the empty string is refused, so "no organization" has exactly one
   * spelling — the key is absent.
   *
   * **Optional as a contract fact, not as a transition.** A `single`-posture
   * deployment stays organization-less for its whole life, so a required key
   * would either force a fabricated tenant there or leave the engine unable to
   * publish at all (the publish site `parse`s the event and drops it on
   * failure). Declared = enforced: this optionality is exactly what validation
   * enforces, and no consumer tolerates any other shape. The producer
   * obligation is the other half of the same contract: a producer that omits
   * the key on an organization-stamped row publishes a cross-tenant event,
   * which is fixed at the publish site — never by a consumer-side lookup.
   */
  organizationId: z.string().min(1).optional().describe(
    'Organization the record belongs to (its organization_id), so a tenant-scoped '
    + 'consumer can discriminate the event\'s tenant without reading the record body. '
    + 'Absent when the record belongs to no organization: every event on a single-posture '
    + 'deployment (no organization wall, nothing stamps the column), and a row that '
    + 'carries no organization under a walled posture (environment-wide, or an object '
    + 'outside the wall) — read absence as '
    + '"not behind any organization wall", never as "unknown". Present = exactly that '
    + 'organization; never fabricated, and the empty string is refused.',
  ),

  /** Changed fields (update events only) */
  changes: z.record(z.string(), z.unknown()).optional().describe('Changed fields'),

  /** Record before update (update events only) */
  before: z.record(z.string(), z.unknown()).optional().describe('Before state'),

  /** Record after update (create/update events) */
  after: z.record(z.string(), z.unknown()).optional().describe('After state'),

  /** User who triggered the event */
  userId: z.string().optional().describe('User who triggered the event'),

  /** Event timestamp (ISO 8601) */
  timestamp: z.string().datetime().describe('Event timestamp'),
}));

export type DataEvent = z.input<typeof DataEventSchema>;

/**
 * Bulk Data Event Payload
 *
 * Represents a predicate write (`multi: true` update/delete) that affected
 * `matched` records without naming any of them. Travels in the same
 * `RealtimeEventPayload` envelope as {@link DataEventSchema}, and is validated
 * by the producer before publish — but it is a SEPARATE contract, not a
 * degraded `DataEvent`: there is no `recordId`, no `before`/`after`, and no
 * `changes`, because a multi-row driver call returns none of them.
 *
 * **What a consumer can and cannot do with this.** It can count, alert, audit
 * at aggregate level, or mark a derived index as needing reconciliation. It
 * CANNOT incrementally maintain a per-record projection (search index, cache,
 * mirror) from it — `matched: 40` names no rows. A consumer whose correctness
 * depends on knowing *which* records changed must reconcile against the source
 * of truth; that is a property of the driver contract, not a gap in this
 * schema, and no field added here could fix it.
 *
 * **Why there is no `where`.** The only predicate in hand at publish time is
 * the middleware-COMPOSED query AST — the caller's filter after the security
 * layer injected its row scoping (RLS write filter, sharing's editable-rows
 * filter). Publishing it would ship tenant scoping internals to whatever
 * external URL a webhook points at. The caller's own pre-composition filter is
 * no better: it is a second, divergent answer to "what did this write touch".
 * So the event reports the count it can state truthfully and stops there.
 *
 * **The tenant term is ONE organization for the whole batch, or nothing.**
 * `organizationId` (below) names the organization every affected record
 * belongs to. It is never per-row — a bulk event names no rows, so a per-row
 * answer would have nothing to attach to — and never a list. That is what
 * keeps a tenant-scoped fan-out one comparison, never a partition of the
 * batch. Its ABSENCE means something different from the same key's absence on
 * {@link DataEventSchema}; the member's own doc states both readings.
 */
export const BulkDataEventSchema = lazySchema(() => z.object({
  /** Unique event identifier */
  id: z.string().uuid().describe('Unique event identifier'),

  /** Event type (data.records.{action}) */
  type: BulkDataEventType.describe('Event type'),

  /** Object name */
  object: z.string().describe('Object name'),

  /**
   * Organization every record the predicate write affected belongs to — ONE
   * organization for the whole batch, never per-row and never a list. Same
   * spelling, same refusal of the empty string, and the same position (beside
   * the match term `object`) as {@link DataEventSchema}'s `organizationId`, so
   * a tenant-scoped consumer discriminates both event families on one key.
   *
   * **One for the batch, by construction.** A predicate write reaches the
   * driver with the middleware-COMPOSED query (see "Why there is no `where`"
   * above): under a walled posture the security layer AND-composes its tenant
   * wall (Layer 0, ADR-0095 D1) onto the caller's filter first — under
   * `isolated` an equality on the caller's active organization, under `group`
   * membership in the caller's organization set (ADR-0105 D2) — and nothing in
   * Layer 1 (business RLS, sharing's editable-rows filter) can widen it. So
   * when the wall names exactly one organization, every affected row belongs
   * to it, and the producer can state that from what it already holds: no
   * second query on the publish path.
   *
   * **Present = every affected record belongs to exactly this organization.**
   * Never fabricated (no `.default()`, the empty string is refused), and never
   * the caller's active organization standing in for the rows': under `group`
   * the wall is the caller's membership SET, so the batch is attributable to
   * one organization only when that set names exactly one.
   *
   * **Absent = the producer did not assert one organization for the batch.**
   * Deliberately DIVERGENT from `DataEventSchema.organizationId`, whose absence
   * means "this record belongs to no organization, not behind any wall". A
   * bulk event names no rows, so its absence is a statement about the
   * producer's knowledge, not about the rows: every event on a
   * `single`-posture deployment (no wall); an environment-wide or system /
   * unscoped predicate write (an `isSystem` context, a true `PLATFORM_ADMIN`
   * crossing the wall); a `group`-posture sweep across several memberships;
   * any write whose affected rows are not known to belong to one
   * organization. It is NOT the single-record reading "belongs to no
   * organization".
   *
   * **What a consumer may do with each reading.** A tenant-scoped consumer —
   * a per-organization webhook subscription, a per-organization realtime
   * subscriber — matches on equality when the key is present, and MUST treat
   * an absent key as "not attributable to my organization": it must not
   * deliver that event inside an organization wall. A deployment-wide consumer
   * may use it. Either way the fan-out filter stays one comparison.
   */
  organizationId: z.string().min(1).optional().describe(
    'Organization every record the predicate write affected belongs to — one organization '
    + 'for the whole batch, never per-row. Present = exactly that organization, asserted by '
    + 'the producer from the composed tenant wall, never fabricated and never the caller\'s '
    + 'active organization standing in for the rows\'; the empty string is refused. '
    + 'Absent = the producer did not assert one organization for the batch (every event on a '
    + 'single-posture deployment; a system, environment-wide or cross-membership predicate '
    + 'write; any write whose affected rows are not known to belong to one organization) — '
    + 'deliberately NOT the DataEvent reading "belongs to no organization". A tenant-scoped '
    + 'consumer must treat an absent key as not attributable to its organization and must '
    + 'not deliver the event inside an organization wall; a deployment-wide consumer may use it.',
  ),

  /**
   * Number of records the predicate write affected. The ObjectQL engine does
   * not publish an event at all when this would be `0` — a predicate that
   * matched nothing changed no data — so a consumer will not see idle sweeps.
   */
  matched: z.number().int().nonnegative().describe('Number of records affected'),

  /** User who triggered the event */
  userId: z.string().optional().describe('User who triggered the event'),

  /** Event timestamp (ISO 8601) */
  timestamp: z.string().datetime().describe('Event timestamp'),
}));

export type BulkDataEvent = z.input<typeof BulkDataEventSchema>;
