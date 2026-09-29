// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { RealtimeRecordAction, BasePresenceSchema } from './realtime-shared.zod';

// Re-export shared types for backward compatibility
import { lazySchema } from '../shared/lazy-schema';
export { PresenceStatus, RealtimeRecordAction, BasePresenceSchema } from './realtime-shared.zod';
export type { BasePresence } from './realtime-shared.zod';

/**
 * Transport Protocol Enum
 * Defines the communication protocol for realtime data synchronization
 */
export const TransportProtocol = z.enum([
  'websocket',  // Full-duplex, low latency communication
  'sse',        // Server-Sent Events, unidirectional push
  'polling',    // Short polling, best compatibility
]);

export type TransportProtocol = z.input<typeof TransportProtocol>;

// Retired event-name prescriptions, one per value `RealtimeEventType` used to
// accept. Declared with `//` (never `/** */`): build-docs takes a file's first
// JSDoc as the reference page's blurb, and this file deliberately renders none.
// No `os migrate meta` sentence: a subscription is not a stack collection
// member and never a stored row, so the command has nothing to list for it.
const REALTIME_EVENT_TYPE_RETIRED: ReadonlyMap<string, string> = new Map([
  ['record.created',
    '`record.created` was removed from `RealtimeEventType` in @objectstack/spec 17.5.0 '
    + '(ADR-0049 enforce-or-remove) — no producer ever emitted it, so a subscription naming it '
    + 'could never fire: the ObjectQL engine publishes each inserted record as '
    + '`data.record.created`. Write `data.record.created` — the same event, spelled the way the '
    + 'engine publishes it.'],
  ['record.updated',
    '`record.updated` was removed from `RealtimeEventType` in @objectstack/spec 17.5.0 '
    + '(ADR-0049 enforce-or-remove) — no producer ever emitted it, so a subscription naming it '
    + 'could never fire: the ObjectQL engine publishes a single-record update as '
    + '`data.record.updated`, and a predicate write (`multi: true`) as the aggregate '
    + '`data.records.updated`, which carries a count and no record. Write `data.record.updated`; '
    + 'add a second event on `data.records.updated` if the subscriber must also hear predicate '
    + 'writes.'],
  ['record.deleted',
    '`record.deleted` was removed from `RealtimeEventType` in @objectstack/spec 17.5.0 '
    + '(ADR-0049 enforce-or-remove) — no producer ever emitted it, so a subscription naming it '
    + 'could never fire: the ObjectQL engine publishes a single-record delete as '
    + '`data.record.deleted`, and a predicate write (`multi: true`) as the aggregate '
    + '`data.records.deleted`, which carries a count and no record. Write `data.record.deleted`; '
    + 'add a second event on `data.records.deleted` if the subscriber must also hear predicate '
    + 'writes.'],
  ['field.changed',
    '`field.changed` was removed from `RealtimeEventType` in @objectstack/spec 17.5.0 '
    + '(ADR-0049 enforce-or-remove) — no producer ever emitted it, and no event is published per '
    + 'field: an update is published once per write as `data.record.updated`, whose `DataEvent` '
    + 'payload lists the changed fields in `changes`. Write `data.record.updated` and read the '
    + 'field from `changes`.'],
]);

/**
 * Event Type Enum
 * The realtime event names a subscription can listen for: exactly the
 * record-change events the runtime emits, and nothing else.
 *
 * - `data.record.created` / `data.record.updated` / `data.record.deleted` — one
 *   event per written record (`DataEventType`, `events.zod.ts`);
 * - `data.records.updated` / `data.records.deleted` — the aggregate event a
 *   predicate write (`multi: true`) publishes instead, carrying a count and no
 *   record (`BulkDataEventType`).
 *
 * The ObjectQL engine parses every one of these events through
 * `DataEventSchema` / `BulkDataEventSchema` before it publishes, so those two
 * enums bound what can arrive. `realtime.test.ts` pins this enum equal to their
 * union: a name the engine gains or loses there turns that pin red rather than
 * drifting apart from this list.
 *
 * Metadata change events (`metadata.{type}.{action}`, `MetadataEventType`) are
 * deliberately NOT members. A subscription event is record-shaped — `object`
 * names a data object and `filters` is meant to narrow records — while a metadata event is
 * keyed by metadata type and has its own contract and its own client primitive
 * (`subscribeMetadata`).
 *
 * REMOVED in 17.5.0 (#20288, ADR-0049 enforce-or-remove): `record.created`,
 * `record.updated`, `record.deleted` and `field.changed`. No producer ever
 * emitted any of them, so a subscription written with the only names the API
 * reference showed could never fire. The runtime's published names did not
 * change; this enum moved to them. Each removed value is refused with its own
 * prescription ({@link REALTIME_EVENT_TYPE_RETIRED}); any other unknown value
 * keeps zod's own message, which lists the legal names.
 *
 * Nothing in the open framework parses a subscription: it mounts no realtime
 * transport (#14646 ruling A, #8347 ruling 甲). The vocabulary is fixed here so
 * that whatever does parse `SubscriptionSchema` receives names that fire.
 */
export const RealtimeEventType = z.enum([
  'data.record.created',
  'data.record.updated',
  'data.record.deleted',
  'data.records.updated',
  'data.records.deleted',
], {
  // Only a value that USED to be legal gets the retirement prescription —
  // telling the author of a typo that their value "was removed" would
  // misinform. (The `HookBodyCapability` / `RuntimeMode` precedent.)
  error: (issue) =>
    typeof issue.input === 'string' ? REALTIME_EVENT_TYPE_RETIRED.get(issue.input) : undefined,
}).describe('Realtime event type: a record-change event name the runtime emits');

export type RealtimeEventType = z.input<typeof RealtimeEventType>;

/**
 * Subscription Event Configuration
 * Defines what events to subscribe to with optional filtering
 */
export const SubscriptionEventSchema = lazySchema(() => z.object({
  type: RealtimeEventType.describe('Type of event to subscribe to'),
  object: z.string().optional().describe('Object name to subscribe to'),
  filters: z.unknown().optional().describe('Filter conditions'),
}));
export type SubscriptionEvent = z.input<typeof SubscriptionEventSchema>;

/**
 * Subscription Schema
 * Configuration for subscribing to realtime events
 */
export const SubscriptionSchema = lazySchema(() => z.object({
  id: z.string().uuid().describe('Unique subscription identifier'),
  events: z.array(SubscriptionEventSchema).describe('Array of events to subscribe to'),
  transport: TransportProtocol.describe('Transport protocol to use'),
  channel: z.string().optional().describe('Optional channel name for grouping subscriptions'),
}));

export type Subscription = z.input<typeof SubscriptionSchema>;

/**
 * Presence Schema
 * Tracks user online status and metadata.
 * Extends the shared BasePresenceSchema for transport-level presence tracking.
 */
export const RealtimePresenceSchema = lazySchema(() => BasePresenceSchema);

export type RealtimePresence = z.input<typeof RealtimePresenceSchema>;

/**
 * Realtime Event Schema
 * Represents a realtime synchronization event
 */
export const RealtimeEventSchema = lazySchema(() => z.object({
  id: z.string().uuid().describe('Unique event identifier'),
  type: z.string().describe('Event type (e.g., data.record.created, data.records.updated)'),
  object: z.string().optional().describe('Object name the event relates to'),
  action: RealtimeRecordAction.optional().describe('Action performed'),
  payload: z.record(z.string(), z.unknown()).describe('Event payload data'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime when event occurred'),
  userId: z.string().optional().describe('User who triggered the event'),
  sessionId: z.string().optional().describe('Session identifier'),
}));

export type RealtimeEvent = z.input<typeof RealtimeEventSchema>;

/**
 * Realtime Configuration Schema
 * 
 * Configuration for enabling realtime data synchronization.
 */
export const RealtimeConfigSchema = lazySchema(() => z.object({
  /** Enable realtime sync */
  enabled: z.boolean().default(true).describe('Enable realtime synchronization'),
  
  /** Transport protocol */
  transport: TransportProtocol.default('websocket').describe('Transport protocol'),
  
  /** Default subscriptions */
  subscriptions: z.array(SubscriptionSchema).optional().describe('Default subscriptions'),
}).passthrough()); // Allow additional properties

export type RealtimeConfig = z.input<typeof RealtimeConfigSchema>;
/** Post-parse shape of {@link RealtimeConfig} — defaults applied, transforms run (ADR-0122). */
export type RealtimeConfigParsed = z.infer<typeof RealtimeConfigSchema>;
