/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27052 — the console's one workspace-preference store: a
 * preference × scope keyed `localStorage` entry holding a small versioned
 * record, read as "no choice" whenever it cannot be read. This file runs in
 * the node project (no `window`); the live hook and its cross-tab path are
 * driven in `workspacePreference.live.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import {
  RECORD_RELATED_COLUMN_PREFERENCE,
  RECORD_TIMELINE_COLUMN_PREFERENCE,
  defineWorkspacePreference,
  objectPreferenceScope,
  readWorkspacePreference,
  versionedPreferenceCodec,
  workspacePreferenceStorageKey,
  writeWorkspacePreference,
} from './workspacePreference';

const memoryStorage = () => {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
};

describe('workspacePreference keys (objectstack#27052)', () => {
  it('one key per preference × scope; the per-object scope names the object', () => {
    expect(objectPreferenceScope('crm_lead')).toBe('object:crm_lead');
    expect(workspacePreferenceStorageKey(RECORD_TIMELINE_COLUMN_PREFERENCE, objectPreferenceScope('crm_lead'))).toBe(
      'os:pref:record.columns.timeline@object:crm_lead',
    );
    expect(workspacePreferenceStorageKey(RECORD_RELATED_COLUMN_PREFERENCE, objectPreferenceScope('crm_lead'))).toBe(
      'os:pref:record.columns.related@object:crm_lead',
    );
    const userScoped = defineWorkspacePreference({ name: 'demo.user', codec: { decode: (s) => s, encode: (v: string) => v } });
    expect(workspacePreferenceStorageKey(userScoped)).toBe('os:pref:demo.user');
  });

  it('a preference with a spelling of its own keeps it', () => {
    const legacy = defineWorkspacePreference({
      name: 'demo.legacy',
      storageKey: () => 'os:demo-legacy',
      codec: { decode: (s) => s, encode: (v: string) => v },
    });
    const storage = memoryStorage();
    writeWorkspacePreference(legacy, 'user', 'kept', storage);
    expect(storage.kept.get('os:demo-legacy')).toBe('kept');
  });
});

describe('the column switches — a versioned record (objectstack#27052)', () => {
  const lead = objectPreferenceScope('crm_lead');
  const product = objectPreferenceScope('crm_product');

  it('stores a record carrying `v`, and reads it back per object', () => {
    const storage = memoryStorage();
    writeWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, lead, 'off', storage);
    const stored = JSON.parse(storage.kept.get('os:pref:record.columns.timeline@object:crm_lead')!);
    expect(stored).toEqual({ value: 'off', v: 1 });
    expect(readWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, lead, storage)).toBe('off');
    // Another object, and the other column, have no choice.
    expect(readWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, product, storage)).toBeUndefined();
    expect(readWorkspacePreference(RECORD_RELATED_COLUMN_PREFERENCE, lead, storage)).toBeUndefined();
    writeWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, lead, 'on', storage);
    expect(readWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, lead, storage)).toBe('on');
  });

  it('reads no choice from a record of another version, a value it does not know, or a spelling that is not a record', () => {
    const key = 'os:pref:record.columns.timeline@object:crm_lead';
    const storageWith = (value: string) => ({ getItem: (k: string) => (k === key ? value : null) });
    for (const spelling of ['{"value":"off","v":2}', '{"value":"off"}', '{"value":"hidden","v":1}', 'off', '[1]', 'null', '{']) {
      expect(readWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, lead, storageWith(spelling))).toBeUndefined();
    }
  });

  it('reads no choice with no storage, or with one that throws; a write to either throws nothing', () => {
    expect(readWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, lead, null)).toBeUndefined();
    const throwing = { getItem: () => { throw new Error('SecurityError'); } };
    expect(readWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, lead, throwing)).toBeUndefined();
    expect(() => writeWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, lead, 'off', null)).not.toThrow();
    const refusing = { setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => writeWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, product, 'off', refusing)).not.toThrow();
  });

  it('with no `window` (SSR — this file runs in the node project), the default storage is absent: no choice', () => {
    expect(typeof window).toBe('undefined');
    expect(readWorkspacePreference(RECORD_RELATED_COLUMN_PREFERENCE, lead)).toBeUndefined();
  });
});

describe('versionedPreferenceCodec (objectstack#27052)', () => {
  it('a record-shaped value round-trips; `v` is written last and always', () => {
    const codec = versionedPreferenceCodec<{ order: string[]; collapsed: string[] }>({
      version: 3,
      toRecord: (value) => ({ ...value }),
      fromRecord: (record) =>
        Array.isArray(record.order) && Array.isArray(record.collapsed)
          ? { order: record.order as string[], collapsed: record.collapsed as string[] }
          : undefined,
    });
    const spelling = codec.encode({ order: ['a', 'b'], collapsed: ['b'] });
    expect(JSON.parse(spelling)).toEqual({ order: ['a', 'b'], collapsed: ['b'], v: 3 });
    expect(codec.decode(spelling)).toEqual({ order: ['a', 'b'], collapsed: ['b'] });
    expect(codec.decode('{"order":[],"collapsed":[],"v":2}')).toBeUndefined();
  });
});
