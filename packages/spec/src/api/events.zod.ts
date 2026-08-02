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

export type MetadataEventType = z.infer<typeof MetadataEventType>;

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

export type DataEventType = z.infer<typeof DataEventType>;

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

export type BulkDataEventType = z.infer<typeof BulkDataEventType>;

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

export type MetadataEvent = z.infer<typeof MetadataEventSchema>;

/**
 * Data Event Payload
 *
 * Represents a data record change event (create, update, delete).
 * Used for real-time synchronization of data records across clients.
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

export type DataEvent = z.infer<typeof DataEventSchema>;

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
 */
export const BulkDataEventSchema = lazySchema(() => z.object({
  /** Unique event identifier */
  id: z.string().uuid().describe('Unique event identifier'),

  /** Event type (data.records.{action}) */
  type: BulkDataEventType.describe('Event type'),

  /** Object name */
  object: z.string().describe('Object name'),

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

export type BulkDataEvent = z.infer<typeof BulkDataEventSchema>;
