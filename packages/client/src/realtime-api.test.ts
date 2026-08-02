// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4602 — subscribeMetadata delivers TRUE `MetadataEvent`s, validated at the
 * boundary.
 *
 * The callback is typed `(event: MetadataEvent) => void` — top-level `id`
 * (uuid), `metadataType`, `name`, `definition?`, `userId?`. Before this fix
 * the handler delivered the raw `RealtimeEventPayload` envelope via
 * `callback(event as any as MetadataEvent)`, so `event.name` /
 * `event.metadataType` were `undefined` at runtime while the types said
 * `string`.
 *
 * Pins:
 *  - the subscriber receives the top-level fields (fails on the pre-fix
 *    envelope-passthrough);
 *  - an off-contract payload (e.g. the pre-fix producer's nested shape) is
 *    rejected LOUDLY — callback never invoked, error surfaced — not passed
 *    through or coerced.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RealtimeEventPayload } from '@objectstack/spec/contracts';
import { RealtimeAPI } from './realtime-api';

const VALID_EVENT = {
  id: 'a3bb189e-8bf9-4888-9912-ace4e6543002',
  type: 'metadata.object.created',
  metadataType: 'object',
  name: 'account',
  packageId: 'com.acme.crm',
  definition: { name: 'account', label: 'Account' },
  userId: 'usr_123',
  timestamp: '2026-08-02T12:00:00.000Z',
} as const;

function envelopeOf(payload: Record<string, unknown>, type = 'metadata.object.created'): RealtimeEventPayload {
  return {
    type,
    object: 'object',
    payload,
    timestamp: '2026-08-02T12:00:00.000Z',
  };
}

describe('#4602 — RealtimeAPI.subscribeMetadata contract boundary', () => {
  let api: RealtimeAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    api = new RealtimeAPI('http://localhost:3000');
  });

  afterEach(() => {
    api.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function deliver(envelope: RealtimeEventPayload): void {
    api._bufferEvent(envelope);
    vi.advanceTimersByTime(2000); // poll interval drains the buffer
  }

  it('delivers the MetadataEvent with top-level fields to the callback', () => {
    const seen: unknown[] = [];
    api.subscribeMetadata('object', (event) => seen.push(event));

    deliver(envelopeOf({ ...VALID_EVENT }));

    expect(seen).toHaveLength(1);
    const event = seen[0] as typeof VALID_EVENT;
    // Top-level, as the type declares — NOT nested under `payload`.
    expect(event.id).toBe(VALID_EVENT.id);
    expect(event.type).toBe('metadata.object.created');
    expect(event.metadataType).toBe('object');
    expect(event.name).toBe('account');
    expect(event.packageId).toBe('com.acme.crm');
    expect(event.definition).toEqual({ name: 'account', label: 'Account' });
    expect(event.userId).toBe('usr_123');
    expect(event.timestamp).toBe(VALID_EVENT.timestamp);
  });

  it('rejects the pre-fix producer shape LOUDLY instead of passing it through', () => {
    // The old MetadataManager payload: no id/type/timestamp inside, fields
    // that DO exist are fine — but the event as a whole violates the schema.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const callback = vi.fn();
    api.subscribeMetadata('object', callback);

    deliver(envelopeOf({
      metadataType: 'object',
      name: 'account',
      definition: { name: 'account' },
    }));

    expect(callback).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    const logged = String(errorSpy.mock.calls.map((c) => c.join(' ')).join('\n'));
    expect(logged).toContain('realtime event handler');
  });

  it('rejects a payload with a wrong field type instead of coercing it', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const callback = vi.fn();
    api.subscribeMetadata('object', callback);

    deliver(envelopeOf({ ...VALID_EVENT, id: 'not-a-uuid' }));

    expect(callback).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('still filters by event type and packageId on the envelope', () => {
    const callback = vi.fn();
    api.subscribeMetadata('object', callback, { packageId: 'com.other' });

    // packageId mismatch → filtered out before the boundary parse.
    deliver(envelopeOf({ ...VALID_EVENT }));
    expect(callback).not.toHaveBeenCalled();

    // matching packageId → delivered.
    const matching = { ...VALID_EVENT, packageId: 'com.other' };
    deliver(envelopeOf(matching));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].packageId).toBe('com.other');
  });

  it('unsubscribe stops delivery', () => {
    const callback = vi.fn();
    const off = api.subscribeMetadata('object', callback);

    deliver(envelopeOf({ ...VALID_EVENT }));
    expect(callback).toHaveBeenCalledTimes(1);

    off();
    deliver(envelopeOf({ ...VALID_EVENT }));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
