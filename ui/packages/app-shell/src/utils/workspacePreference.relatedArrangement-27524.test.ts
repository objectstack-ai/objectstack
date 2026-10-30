/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524, Target 10 — the stored arrangement of the record page's
 * related panels is `{ v, order, hidden, basedOn, seen }`. `collapsed` left
 * the shape with no compatibility read: a record of the earlier version (the
 * one that carried it) is "no choice", and the reader gets the default order
 * again. This file runs in the node project (no `window`).
 */

import { describe, it, expect } from 'vitest';
import {
  RECORD_RELATED_ARRANGEMENT_PREFERENCE,
  objectPreferenceScope,
  readWorkspacePreference,
  writeWorkspacePreference,
} from './workspacePreference';

const lead = objectPreferenceScope('crm_lead');
const KEY = 'os:pref:record.related.arrangement@object:crm_lead';

const memoryStorage = () => {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
};

describe('record.related.arrangement — no `collapsed`, no compatibility read (objectstack#27524)', () => {
  it('writes { order, hidden, basedOn, seen } and the version, and reads it back', () => {
    const storage = memoryStorage();
    const value = { order: ['task.lead_id', 'note.parent_id'], hidden: ['call.lead_id'], basedOn: 'abcd1234', seen: { 'task.lead_id': 1 } };
    writeWorkspacePreference(RECORD_RELATED_ARRANGEMENT_PREFERENCE, lead, value, storage);
    const stored = JSON.parse(storage.kept.get(KEY)!);
    expect(Object.keys(stored).sort()).toEqual(['basedOn', 'hidden', 'order', 'seen', 'v']);
    expect(stored.v).toBe(2);
    expect(readWorkspacePreference(RECORD_RELATED_ARRANGEMENT_PREFERENCE, lead, storage)).toEqual(value);
  });

  it('reads no choice from a record of the shape that carried `collapsed`', () => {
    const earlier = JSON.stringify({ order: ['note.parent_id'], collapsed: ['task.lead_id'], hidden: [], basedOn: 'abcd1234', v: 1 });
    const storage = { getItem: (key: string) => (key === KEY ? earlier : null) };
    expect(readWorkspacePreference(RECORD_RELATED_ARRANGEMENT_PREFERENCE, lead, storage)).toBeUndefined();
  });
});
