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
 * How a drawer-mode record opens is a reader's own choice, kept per browser
 * under `os:record-open-mode`. These rows pin what the console reads: the
 * values it knows, and the default for everything else — no value, an
 * unknown one, no storage, a storage that throws. objectstack#28915: the
 * drawer is the default, the split pane retired, and a stored `split` is an
 * unknown value like any other (no compatibility read).
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RECORD_OPEN_PREFERENCE,
  RECORD_OPEN_PREFERENCE_KEY,
  readRecordOpenPreference,
  writeRecordOpenPreference,
} from './recordOpenPreference';

const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === RECORD_OPEN_PREFERENCE_KEY ? value : null) });

describe('readRecordOpenPreference (objectstack#26677)', () => {
  it('the key and the default are the ones the Display-menu control will write against', () => {
    expect(RECORD_OPEN_PREFERENCE_KEY).toBe('os:record-open-mode');
    expect(DEFAULT_RECORD_OPEN_PREFERENCE).toBe('drawer');
  });

  it('reads the two values it knows', () => {
    expect(readRecordOpenPreference(storageWith('drawer'))).toBe('drawer');
    expect(readRecordOpenPreference(storageWith('page'))).toBe('page');
  });

  it('answers the drawer for no value, an unknown value, or a retired mode name — a stored `split` included', () => {
    expect(readRecordOpenPreference(storageWith(null))).toBe('drawer');
    expect(readRecordOpenPreference(storageWith('split'))).toBe('drawer');
    expect(readRecordOpenPreference(storageWith('modal'))).toBe('drawer');
    expect(readRecordOpenPreference(storageWith('PAGE'))).toBe('drawer');
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

describe('writeRecordOpenPreference (objectstack#26681)', () => {
  /** A storage double that keeps what it is handed. */
  const memoryStorage = () => {
    const kept = new Map<string, string>();
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
  };

  it('keeps the choice under the key the read side reads', () => {
    const storage = memoryStorage();
    writeRecordOpenPreference('page', storage);
    expect(storage.getItem(RECORD_OPEN_PREFERENCE_KEY)).toBe('page');
    expect(readRecordOpenPreference(storage)).toBe('page');
    writeRecordOpenPreference('drawer', storage);
    expect(storage.getItem(RECORD_OPEN_PREFERENCE_KEY)).toBe('drawer');
    expect(readRecordOpenPreference(storage)).toBe('drawer');
  });

  it('writes nothing and throws nothing with no storage, or with a storage that refuses the write', () => {
    expect(() => writeRecordOpenPreference('page', null)).not.toThrow();
    const refusing = { setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => writeRecordOpenPreference('page', refusing)).not.toThrow();
  });
});
