// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4626 — subscribeData delivers TRUE `DataEvent`s, validated at the boundary
 * (the data-side twin of #4602's metadata pins).
 *
 * The callback is typed `(event: DataEvent) => void` — top-level `id` (uuid),
 * `type`, `object`, `recordId` (required), `changes?`, `before?`, `after?`,
 * `userId?`, `timestamp`. Before this fix the handler delivered the raw
 * `RealtimeEventPayload` envelope via `callback(event as any as DataEvent)`,
 * so `event.recordId` / `event.changes` / `event.id` were `undefined` at
 * runtime while the types said otherwise.
 *
 * Pins:
 *  - the subscriber receives the top-level fields (fails on the pre-fix
 *    envelope passthrough);
 *  - an off-contract payload — including the pre-fix producer's
 *    `{ recordId, after }` shape — is rejected LOUDLY: callback never invoked,
 *    error surfaced, nothing coerced;
 *  - the `recordId` filter narrows on the FULFILLED event.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RealtimeEventPayload } from '@objectstack/spec/contracts';
import { RealtimeAPI } from './realtime-api';

const VALID_EVENT = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  type: 'data.record.updated',
  object: 'project_task',
  recordId: 'task_1',
  changes: { status: 'done' },
  after: { id: 'task_1', title: 'Ship it', status: 'done' },
  userId: 'usr_123',
  timestamp: '2026-08-02T12:00:00.000Z',
} as const;

function envelopeOf(
  payload: Record<string, unknown>,
  type = 'data.record.updated',
  object = 'project_task',
): RealtimeEventPayload {
  return { type, object, payload, timestamp: '2026-08-02T12:00:00.000Z' };
}

describe('#4626 — RealtimeAPI.subscribeData contract boundary', () => {
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

  it('delivers the DataEvent with top-level fields to the callback', () => {
    const seen: unknown[] = [];
    api.subscribeData('project_task', (event) => seen.push(event));

    deliver(envelopeOf({ ...VALID_EVENT }));

    expect(seen).toHaveLength(1);
    const event = seen[0] as typeof VALID_EVENT;
    // Top-level, as the type declares — NOT nested under `payload`.
    expect(event.id).toBe(VALID_EVENT.id);
    expect(event.type).toBe('data.record.updated');
    expect(event.object).toBe('project_task');
    expect(event.recordId).toBe('task_1');
    expect(event.changes).toEqual({ status: 'done' });
    expect(event.after).toEqual({ id: 'task_1', title: 'Ship it', status: 'done' });
    expect(event.userId).toBe('usr_123');
    expect(event.timestamp).toBe(VALID_EVENT.timestamp);
  });

  it('rejects the pre-fix producer shape LOUDLY instead of passing it through', () => {
    // The old engine payload: `{ recordId, after }` with no id/type/object/
    // timestamp. The envelope carried those — which is precisely why the
    // double-cast compiled and lied.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const callback = vi.fn();
    api.subscribeData('project_task', callback);

    deliver(envelopeOf({ recordId: 'task_1', after: { id: 'task_1', title: 'Ship it' } }));

    expect(callback).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    const logged = String(errorSpy.mock.calls.map((c) => c.join(' ')).join('\n'));
    expect(logged).toContain('realtime event handler');
  });

  it('rejects a payload with a wrong field type instead of coercing it', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const callback = vi.fn();
    api.subscribeData('project_task', callback);

    deliver(envelopeOf({ ...VALID_EVENT, id: 'not-a-uuid' }));
    expect(callback).not.toHaveBeenCalled();

    // A numeric recordId is a producer bug, not something to String() here.
    deliver(envelopeOf({ ...VALID_EVENT, recordId: 42 }));
    expect(callback).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('filters by recordId on the fulfilled event', () => {
    const callback = vi.fn();
    api.subscribeData('project_task', callback, { recordId: 'task_2' });

    deliver(envelopeOf({ ...VALID_EVENT }));
    expect(callback).not.toHaveBeenCalled();

    deliver(envelopeOf({ ...VALID_EVENT, recordId: 'task_2', after: { id: 'task_2' } }));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].recordId).toBe('task_2');
  });

  it('ignores events for another object', () => {
    const callback = vi.fn();
    api.subscribeData('project_task', callback);

    deliver(envelopeOf(
      { ...VALID_EVENT, object: 'account', recordId: 'acc_1' },
      'data.record.updated',
      'account',
    ));

    expect(callback).not.toHaveBeenCalled();
  });

  it('delivers created and deleted events too', () => {
    const seen: any[] = [];
    api.subscribeData('project_task', (event) => seen.push(event));

    deliver(envelopeOf({
      id: '9f8b0f6e-1c2d-4a3b-8c9d-0e1f2a3b4c5d',
      type: 'data.record.created',
      object: 'project_task',
      recordId: 'task_9',
      after: { id: 'task_9', title: 'New' },
      timestamp: '2026-08-02T12:00:01.000Z',
    }, 'data.record.created'));

    deliver(envelopeOf({
      id: '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081',
      type: 'data.record.deleted',
      object: 'project_task',
      recordId: 'task_9',
      timestamp: '2026-08-02T12:00:02.000Z',
    }, 'data.record.deleted'));

    expect(seen.map((e) => e.type)).toEqual(['data.record.created', 'data.record.deleted']);
    expect(seen.map((e) => e.recordId)).toEqual(['task_9', 'task_9']);
    expect(seen[1].after).toBeUndefined();
  });

  it('unsubscribe stops delivery', () => {
    const callback = vi.fn();
    const off = api.subscribeData('project_task', callback);

    deliver(envelopeOf({ ...VALID_EVENT }));
    expect(callback).toHaveBeenCalledTimes(1);

    off();
    deliver(envelopeOf({ ...VALID_EVENT }));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
