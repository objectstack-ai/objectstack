/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26677 — the reader's record-open preference, read side.
 *
 * `split` left `NavigationModeSchema`: the side-by-side pane is a reader's own
 * choice, kept per browser under `os:record-open-mode`. These rows pin what
 * the console reads: the two values it knows, and the drawer for everything
 * else — no value, an unknown one, no storage, a storage that throws.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RECORD_OPEN_PREFERENCE,
  RECORD_OPEN_PREFERENCE_KEY,
  readRecordOpenPreference,
} from './recordOpenPreference';

const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === RECORD_OPEN_PREFERENCE_KEY ? value : null) });

describe('readRecordOpenPreference (objectstack#26677)', () => {
  it('the key and the default are the ones the Display-menu control will write against', () => {
    expect(RECORD_OPEN_PREFERENCE_KEY).toBe('os:record-open-mode');
    expect(DEFAULT_RECORD_OPEN_PREFERENCE).toBe('drawer');
  });

  it('reads the two values it knows', () => {
    expect(readRecordOpenPreference(storageWith('split'))).toBe('split');
    expect(readRecordOpenPreference(storageWith('drawer'))).toBe('drawer');
  });

  it('answers the drawer for no value, an unknown value, or a retired mode name', () => {
    expect(readRecordOpenPreference(storageWith(null))).toBe('drawer');
    expect(readRecordOpenPreference(storageWith('page'))).toBe('drawer');
    expect(readRecordOpenPreference(storageWith('modal'))).toBe('drawer');
    expect(readRecordOpenPreference(storageWith('SPLIT'))).toBe('drawer');
  });

  it('answers the drawer with no storage, and with a storage that throws', () => {
    expect(readRecordOpenPreference(null)).toBe('drawer');
    const throwing = { getItem: () => { throw new Error('SecurityError'); } };
    expect(readRecordOpenPreference(throwing)).toBe('drawer');
  });

  it('with no `window` at all (SSR — this file runs in the node project), the default storage is absent: the drawer', () => {
    // The browser's own `localStorage` is read by the console's object page;
    // `ObjectView.recordOpenPreference-26677.test.tsx` drives that path.
    expect(typeof window).toBe('undefined');
    expect(readRecordOpenPreference()).toBe('drawer');
  });
});
