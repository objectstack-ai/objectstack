// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D4, open question L852] Pins the `_sync_external_id` spelling of a
 * row's source key, and the stamp both pulls put on a row.
 */

import { describe, it, expect } from 'vitest';
import {
  carriesSyncProvenanceColumns,
  encodeSyncExternalId,
  mappedSyncProvenanceTarget,
  stampSyncProvenance,
} from './sync-provenance-stamp.js';

describe('[ADR-0153 L852] encodeSyncExternalId', () => {
  it('one key field: its value as plain text', () => {
    expect(encodeSyncExternalId(['A-1'])).toBe('A-1');
    expect(encodeSyncExternalId(['  A-1 '])).toBe('A-1');
    expect(encodeSyncExternalId([42])).toBe('42');
    expect(encodeSyncExternalId([10n])).toBe('10');
    expect(encodeSyncExternalId([true])).toBe('true');
    expect(encodeSyncExternalId([new Date('2026-01-02T03:04:05Z')])).toBe('2026-01-02T03:04:05.000Z');
    expect(encodeSyncExternalId([{ a: 1 }])).toBe('{"a":1}');
  });

  it('a composite key: a JSON array of the spellings, in upsertKey order, never sorted', () => {
    expect(encodeSyncExternalId([10, 'A-1'])).toBe('["10","A-1"]');
    expect(encodeSyncExternalId(['A-1', 10])).toBe('["A-1","10"]');
    // a value holding the array's own punctuation stays unambiguous
    expect(encodeSyncExternalId(['a","b', 'c'])).toBe('["a\\",\\"b","c"]');
    expect(JSON.parse(encodeSyncExternalId(['a","b', 'c'])!)).toEqual(['a","b', 'c']);
  });

  it('the same values give the same text on every call (canonical)', () => {
    expect(encodeSyncExternalId([' x', 1])).toBe(encodeSyncExternalId(['x ', '1']));
  });

  it('any blank key value: no id', () => {
    expect(encodeSyncExternalId([])).toBeUndefined();
    expect(encodeSyncExternalId([null])).toBeUndefined();
    expect(encodeSyncExternalId(['   '])).toBeUndefined();
    expect(encodeSyncExternalId(['A', undefined])).toBeUndefined();
    expect(encodeSyncExternalId([new Date('nope')])).toBeUndefined();
  });
});

describe('[ADR-0153 D4] the stamp', () => {
  it('stamps the mapping, the source key, the time and the run, on new row objects', () => {
    const rows = [{ code: 'C1', title: 'x' }];
    const out = stampSyncProvenance(rows, ['code'], { mapping: 'erp', runId: 'run_1', pulledAt: '2026-01-01T00:00:00.000Z' });
    expect(out).toEqual([{
      code: 'C1', title: 'x',
      _sync_source: 'erp', _sync_external_id: 'C1', _sync_pulled_at: '2026-01-01T00:00:00.000Z', _sync_run_id: 'run_1',
    }]);
    expect(out[0]).not.toBe(rows[0]);
    expect(rows[0]).toEqual({ code: 'C1', title: 'x' });
  });

  it('no run record: no run column; a blank key: no external id; never _sync_deleted_at', () => {
    const [row] = stampSyncProvenance([{ code: ' ' }], ['code'], { mapping: 'erp', runId: undefined, pulledAt: 't' });
    expect('_sync_run_id' in row!).toBe(false);
    expect('_sync_external_id' in row!).toBe(false);
    expect('_sync_deleted_at' in row!).toBe(false);
  });

  it('carriesSyncProvenanceColumns reads the plan: synced yes, others and systemFields:false no', () => {
    expect(carriesSyncProvenanceColumns({ name: 'a', managedBy: 'synced' })).toBe(true);
    expect(carriesSyncProvenanceColumns({ name: 'a', managedBy: 'synced', systemFields: false })).toBe(false);
    expect(carriesSyncProvenanceColumns({ name: 'a' })).toBe(false);
  });

  it('mappedSyncProvenanceTarget finds a _sync_ target, single or fanned out', () => {
    expect(mappedSyncProvenanceTarget([{ target: 'name' }, { target: '_sync_source' }])).toBe('_sync_source');
    expect(mappedSyncProvenanceTarget([{ target: ['a', '_sync_run_id'] }])).toBe('_sync_run_id');
    expect(mappedSyncProvenanceTarget([{ target: 'name' }, undefined])).toBeUndefined();
  });
});
