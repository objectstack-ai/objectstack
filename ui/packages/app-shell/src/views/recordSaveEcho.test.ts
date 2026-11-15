/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33827 — what a save's answer may change on the record the page
 * holds. The page-level pin (the saved value drawn when the save resolves) is
 * in `RecordDetailView.timelineCount-28737.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { applySavedRecordEcho } from './recordSaveEcho';

const held = {
  id: 'r1',
  name: 'Initech',
  phone: null,
  owner: { id: 'u1', name: 'Dev Admin' },
  tags: [{ id: 't1', name: 'Gold' }, { id: 't2', name: 'Key' }],
  score: 3,
};

describe('applySavedRecordEcho', () => {
  it('takes the saved values and keeps a key the answer leaves out', () => {
    const next = applySavedRecordEcho(held, { id: 'r1', name: 'Initech', phone: '021-55550100' }, 'r1');
    expect(next).toEqual({ ...held, phone: '021-55550100' });
    expect(held.phone).toBeNull();
  });

  it('keeps a relation the page read expanded when the answer names the same record', () => {
    const next = applySavedRecordEcho(held, { id: 'r1', owner: 'u1', tags: ['t1', 't2'], score: 4 }, 'r1');
    expect(next.owner).toBe(held.owner);
    expect(next.tags).toBe(held.tags);
    expect(next.score).toBe(4);
  });

  it('takes a relation the save changed', () => {
    const next = applySavedRecordEcho(held, { id: 'r1', owner: 'u2', tags: ['t1'] }, 'r1');
    expect(next.owner).toBe('u2');
    expect(next.tags).toEqual(['t1']);
  });

  it('hands back the held object itself when the answer changes nothing', () => {
    expect(applySavedRecordEcho(held, { id: 'r1', name: 'Initech', owner: 'u1' }, 'r1')).toBe(held);
  });

  it('takes nothing from an answer that does not name this record', () => {
    expect(applySavedRecordEcho(held, { id: 'r2', name: 'Other' }, 'r1')).toBe(held);
    expect(applySavedRecordEcho(held, { name: 'No id' }, 'r1')).toBe(held);
    expect(applySavedRecordEcho(held, undefined, 'r1')).toBe(held);
    expect(applySavedRecordEcho(held, ['r1'], 'r1')).toBe(held);
  });

  it('reads `_id` as the record id', () => {
    expect(applySavedRecordEcho(held, { _id: 'r1', name: 'Renamed' }, 'r1').name).toBe('Renamed');
  });

  it('lays nothing over a record that has not loaded', () => {
    expect(applySavedRecordEcho(null, { id: 'r1', name: 'Initech' }, 'r1')).toBeNull();
  });
});
