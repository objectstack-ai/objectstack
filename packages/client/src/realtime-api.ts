// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Realtime API Module for ObjectStackClient
 *
 * Provides real-time event subscription capabilities using long-polling.
 * For production WebSocket/SSE support, extend with transport adapters.
 */

import type { RealtimeEventPayload } from '@objectstack/spec/contracts';
import {
  MetadataEventSchema,
  DataEventSchema,
  BulkDataEventSchema,
  type MetadataEvent,
  type MetadataEventSubject,
  type MetadataEventType,
  type DataEvent,
  type BulkDataEvent,
} from '@objectstack/spec/api';

export interface RealtimeSubscriptionFilter {
  /** Metadata/object type filter */
  type?: string;
  /** Package ID filter */
  packageId?: string;
  /** Event types to listen for */
  eventTypes?: string[];
  /** Record ID filter (for data events) */
  recordId?: string;
}

export type RealtimeEventHandler = (event: RealtimeEventPayload) => void;

/**
 * Realtime API for subscribing to server events
 *
 * Note: Currently uses in-memory adapter. WebSocket/SSE transport planned for future.
 */
export class RealtimeAPI {
  // @ts-expect-error - Reserved for future WebSocket/SSE implementation
  private _baseUrl: string;
  // @ts-expect-error - Reserved for future WebSocket/SSE implementation
  private _token?: string;
  private subscriptions = new Map<string, {
    filter: RealtimeSubscriptionFilter;
    handler: RealtimeEventHandler;
  }>();
  private pollInterval?: ReturnType<typeof setInterval>;
  private eventBuffer: RealtimeEventPayload[] = [];

  constructor(baseUrl: string, token?: string) {
    this._baseUrl = baseUrl;
    this._token = token;
  }

  /**
   * Subscribe to metadata events for one metadata type.
   * Returns an unsubscribe function.
   *
   * `type` is {@link MetadataEventSubject} — the `{type}` half of the
   * `metadata.{type}.{action}` vocabulary, derived from `MetadataEventType` —
   * not a free string (#4627). The producer publishes nothing for a metadata
   * type outside that enum (#4602 pinned that as declared = enforced), so a
   * `string` parameter let a caller write `subscribeMetadata('translation', …)`,
   * compile green, and wait forever on a callback the contract guarantees will
   * never fire. Now the compiler says so at the call site.
   *
   * The narrowing does NOT decide which types deserve realtime events — that is
   * axis 2 of #4627 and stays open. It only stops the consumer from claiming a
   * coverage the producer never promised.
   */
  subscribeMetadata(
    type: MetadataEventSubject,
    callback: (event: MetadataEvent) => void,
    options?: { packageId?: string }
  ): () => void {
    const subscriptionId = `metadata-${type}-${Date.now()}`;

    // Annotated `MetadataEventType[]`, not left to widen to `string[]`: with a
    // narrowed `type` these three templates are provably members of the enum,
    // and saying so makes tsc re-check the composition. A typo here
    // (`metadata.${type}.create`) used to be a silent no-match subscription —
    // the same defect class one level down from the one the parameter fixes.
    const eventTypes: MetadataEventType[] = [
      `metadata.${type}.created`,
      `metadata.${type}.updated`,
      `metadata.${type}.deleted`,
    ];

    this.subscriptions.set(subscriptionId, {
      filter: {
        type,
        packageId: options?.packageId,
        eventTypes
      },
      handler: (event) => {
        if (!event.type.startsWith('metadata.')) return;
        // Contract boundary (#4602): the wire carries a RealtimeEventPayload
        // envelope whose `payload` is the producer's MetadataEvent. Validate
        // it here — the callback is typed `(event: MetadataEvent) => void`,
        // so delivering anything else would be a lie the type system can't
        // catch. An off-contract payload is rejected LOUDLY (throw → surfaced
        // by emitEvent's handler-error log), never coerced or passed through:
        // a malformed event means the producer is broken and must be fixed
        // there, not tolerated here.
        const parsed = MetadataEventSchema.safeParse(event.payload);
        if (!parsed.success) {
          throw new Error(
            `subscribeMetadata('${type}'): event '${event.type}' payload does not satisfy ` +
            `MetadataEventSchema — rejecting off-contract event (fix the producer): ${parsed.error.message}`
          );
        }
        callback(parsed.data);
      }
    });

    // Start polling if not already started
    this.startPolling();

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(subscriptionId);
      if (this.subscriptions.size === 0) {
        this.stopPolling();
      }
    };
  }

  /**
   * Subscribe to data record events
   * Returns an unsubscribe function
   */
  subscribeData(
    object: string,
    callback: (event: DataEvent) => void,
    options?: { recordId?: string }
  ): () => void {
    const subscriptionId = `data-${object}-${Date.now()}`;

    this.subscriptions.set(subscriptionId, {
      filter: {
        type: object,
        recordId: options?.recordId,
        eventTypes: [
          'data.record.created',
          'data.record.updated',
          'data.record.deleted'
        ]
      },
      handler: (event) => {
        if (!event.type.startsWith('data.') || event.object !== object) return;
        // [#4639] An aggregate `data.records.*` from a predicate write is not
        // off-contract — it satisfies a DIFFERENT one — so it must be skipped
        // before the `DataEventSchema` check below rejects it as malformed.
        // Excluded by its own namespace rather than by narrowing the guard to
        // `data.record.`, which would also silently drop `data.field.changed`
        // (declared in `DataEventType`, no producer today — see #4673) if it
        // ever gains one. Bulk events are delivered by `subscribeBulkData`.
        if (event.type.startsWith('data.records.')) return;
        // Contract boundary (#4626): the wire carries a RealtimeEventPayload
        // envelope whose `payload` is the producer's DataEvent (the ObjectQL
        // engine builds and validates it). Validate it here too — the callback
        // is typed `(event: DataEvent) => void`, so delivering the envelope
        // itself (what `event as any as DataEvent` used to do) left every
        // subscriber reading `undefined` for the top-level `recordId` /
        // `changes` / `id` the type promised. An off-contract payload is
        // rejected LOUDLY (throw → surfaced by emitEvent's handler-error log),
        // never coerced or passed through: a malformed event means the
        // producer is broken and must be fixed there, not tolerated here.
        const parsed = DataEventSchema.safeParse(event.payload);
        if (!parsed.success) {
          throw new Error(
            `subscribeData('${object}'): event '${event.type}' payload does not satisfy ` +
            `DataEventSchema — rejecting off-contract event (fix the producer): ${parsed.error.message}`
          );
        }
        // Narrow on the FULFILLED event, not the envelope — `recordId` is a
        // declared top-level field of what the subscriber receives.
        if (options?.recordId && parsed.data.recordId !== options.recordId) return;
        callback(parsed.data);
      }
    });

    // Start polling if not already started
    this.startPolling();

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(subscriptionId);
      if (this.subscriptions.size === 0) {
        this.stopPolling();
      }
    };
  }

  /**
   * Subscribe to aggregate bulk-write events for an object (#4639).
   *
   * A predicate write (`multi: true` update/delete) reaches
   * `IDataDriver.updateMany`/`deleteMany`, which report an affected COUNT and
   * name no rows — so it publishes `data.records.updated` /
   * `data.records.deleted` rather than the per-record events
   * {@link subscribeData} delivers. The callback receives a
   * {@link BulkDataEvent}: `object` and `matched`, no `recordId`, no record
   * body.
   *
   * Kept as a separate method on purpose. Delivering these through
   * `subscribeData` would hand a `(event: DataEvent) => void` callback an
   * object whose `recordId` is missing — reintroducing, from the producer
   * side, exactly the "typed field that is `undefined` at runtime" defect
   * #4626 removed. A caller that wants both subscribes twice, and the types
   * make the difference unmissable.
   *
   * Use it to invalidate a whole view, show "40 records changed", or schedule
   * a refetch — not to patch a per-record cache, which a count cannot drive.
   */
  subscribeBulkData(
    object: string,
    callback: (event: BulkDataEvent) => void
  ): () => void {
    const subscriptionId = `bulk-data-${object}-${Date.now()}`;

    this.subscriptions.set(subscriptionId, {
      filter: {
        type: object,
        eventTypes: ['data.records.updated', 'data.records.deleted']
      },
      handler: (event) => {
        if (!event.type.startsWith('data.records.') || event.object !== object) return;
        // Same boundary discipline as subscribeData: the envelope's `payload`
        // is the producer's BulkDataEvent, validated here too. Off-contract is
        // rejected LOUDLY (throw → surfaced by emitEvent's handler-error log),
        // never coerced — a malformed event means the producer is broken.
        const parsed = BulkDataEventSchema.safeParse(event.payload);
        if (!parsed.success) {
          throw new Error(
            `subscribeBulkData('${object}'): event '${event.type}' payload does not satisfy ` +
            `BulkDataEventSchema — rejecting off-contract event (fix the producer): ${parsed.error.message}`
          );
        }
        callback(parsed.data);
      }
    });

    this.startPolling();

    return () => {
      this.subscriptions.delete(subscriptionId);
      if (this.subscriptions.size === 0) {
        this.stopPolling();
      }
    };
  }

  /**
   * Emit an event to all matching subscriptions (client-side only)
   * This is used for in-process event delivery
   */
  private emitEvent(event: RealtimeEventPayload): void {
    for (const sub of this.subscriptions.values()) {
      // Check if event matches subscription filters
      const matchesType = !sub.filter.type ||
        event.type.includes(sub.filter.type) ||
        event.object === sub.filter.type;

      const matchesEventType = !sub.filter.eventTypes?.length ||
        sub.filter.eventTypes.includes(event.type);

      const matchesPackage = !sub.filter.packageId ||
        (event.payload as any)?.packageId === sub.filter.packageId;

      if (matchesType && matchesEventType && matchesPackage) {
        try {
          sub.handler(event);
        } catch (error) {
          console.error('Error in realtime event handler:', error);
        }
      }
    }
  }

  /**
   * Start polling for events (fallback mechanism)
   * In production, this would be replaced with WebSocket/SSE
   */
  private startPolling(): void {
    if (this.pollInterval) return;

    // For now, we rely on the in-memory adapter within the same process
    // Events are delivered synchronously via the IRealtimeService
    // This polling is a placeholder for future WebSocket/SSE implementation

    // Poll every 2 seconds for buffered events
    this.pollInterval = setInterval(() => {
      // Process any buffered events
      while (this.eventBuffer.length > 0) {
        const event = this.eventBuffer.shift();
        if (event) {
          this.emitEvent(event);
        }
      }
    }, 2000);
  }

  /**
   * Stop polling for events
   */
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }

  /**
   * Internal method to buffer events from server
   * This would be called by WebSocket/SSE handlers in production
   */
  _bufferEvent(event: RealtimeEventPayload): void {
    this.eventBuffer.push(event);
  }

  /**
   * Disconnect and clean up all subscriptions
   */
  disconnect(): void {
    this.stopPolling();
    this.subscriptions.clear();
    this.eventBuffer = [];
  }
}
