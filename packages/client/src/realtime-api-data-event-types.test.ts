// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31473 — the SDK's data subscriptions ask for the event types the spec
 * declares, read from the spec, never from a hand list.
 *
 * `subscribeData` hand-listed created / updated / deleted, so when #31220
 * added `data.record.restored` to `DataEventType` (a row restored from the
 * recycle bin, published by ObjectQL's restore), the subscription filtered it
 * out and a subscriber's live list never saw the row come back.
 *
 *  - ⭐ a `data.record.restored` event reaches the callback, and a list the
 *    callback keeps shows the restored row again;
 *  - ⭐ every member of the spec's `DataEventType` reaches `subscribeData`,
 *    and every member of `BulkDataEventType` reaches `subscribeBulkData`
 *    (read from the enums, so a type added later is covered without an edit
 *    here);
 *  - ⭐ `realtime-api.ts` spells no data event type as a string literal: the
 *    lists come from the spec enums.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RealtimeEventPayload } from '@objectstack/spec/contracts';
import { BulkDataEventType, DataEventType, type DataEvent } from '@objectstack/spec/api';
import { RealtimeAPI } from './realtime-api';

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = '2026-11-08T12:00:00.000Z';

function recordEvent(type: string, recordId: string, after?: Record<string, unknown>): RealtimeEventPayload {
  const payload = {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    type,
    object: 'project_task',
    recordId,
    ...(after ? { after } : {}),
    timestamp: AT,
  };
  return { type, object: 'project_task', payload, timestamp: AT };
}

function bulkEvent(type: string): RealtimeEventPayload {
  const payload = { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', type, object: 'project_task', matched: 3, timestamp: AT };
  return { type, object: 'project_task', payload, timestamp: AT };
}

describe('#31473 — the data subscriptions follow the spec event enums', () => {
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
    vi.advanceTimersByTime(2000); // the poll interval drains the buffer
  }

  it('⭐ a row restored from the recycle bin reappears in the subscriber\'s list', () => {
    const rows = new Map<string, Record<string, unknown>>();
    const apply = (event: DataEvent): void => {
      if (event.type === 'data.record.deleted') rows.delete(event.recordId);
      else if (event.after) rows.set(event.recordId, event.after);
    };
    api.subscribeData('project_task', apply);

    deliver(recordEvent('data.record.created', 'task_1', { id: 'task_1', title: 'Ship it' }));
    deliver(recordEvent('data.record.deleted', 'task_1'));
    expect([...rows.keys()]).toEqual([]);

    deliver(recordEvent('data.record.restored', 'task_1', { id: 'task_1', title: 'Ship it' }));
    expect([...rows.keys()]).toEqual(['task_1']);
  });

  it('⭐ every DataEventType the spec declares reaches subscribeData', () => {
    const seen: string[] = [];
    api.subscribeData('project_task', (event) => seen.push(event.type));

    for (const type of DataEventType.options) deliver(recordEvent(type, 'task_1'));

    expect(seen).toEqual([...DataEventType.options]);
    expect(seen).toContain('data.record.restored');
  });

  it('⭐ every BulkDataEventType the spec declares reaches subscribeBulkData', () => {
    const seen: string[] = [];
    api.subscribeBulkData('project_task', (event) => seen.push(event.type));

    for (const type of BulkDataEventType.options) deliver(bulkEvent(type));

    expect(seen).toEqual([...BulkDataEventType.options]);
  });

  it('⭐ realtime-api.ts keeps no hand list of data event types', () => {
    const source = readFileSync(join(HERE, 'realtime-api.ts'), 'utf8');
    expect(source).not.toMatch(/'data\.records?\.[a-z_]+'/);
    expect(source).toMatch(/DataEventType\.options/);
    expect(source).toMatch(/BulkDataEventType\.options/);
  });
});
