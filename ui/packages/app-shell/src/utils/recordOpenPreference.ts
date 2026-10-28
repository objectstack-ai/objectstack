/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useSyncExternalStore } from 'react';

/**
 * How the console's object page opens a record a reader clicks, when the
 * object opens its records in the drawer — a READER's own preference, not
 * metadata (objectstack#26677).
 *
 * The maintainer's record-page model (ruling 2026-10-27): an object opens its
 * records one way — the drawer, which expands to the full page, by default,
 * or the full page where the object declares `navigation.mode: 'page'` — and
 * the side-by-side pane is each reader's own choice. So `split` left
 * `NavigationModeSchema` (an author can no longer fix it for every reader) and
 * lives here instead: `drawer` draws the record in the drawer over the list,
 * `split` draws the same record page beside the list.
 *
 * Both sides live here: {@link readRecordOpenPreference} and
 * {@link writeRecordOpenPreference}, and {@link useRecordOpenPreference}, the
 * live pair the object page reads — the Display menu's 「打开记录」 control
 * writes through it and the next row click opens the new way, with no reload
 * (objectstack#26681).
 *
 * Read per browser: the value lives in `localStorage` under
 * {@link RECORD_OPEN_PREFERENCE_KEY}, across objects. An absent value, an
 * unknown one, a host with no `window` (SSR), or a storage that throws
 * (private mode, a blocked origin) all answer {@link DEFAULT_RECORD_OPEN_PREFERENCE}.
 * It never overrides a declaration: an object whose resolved mode is `page`,
 * `new_window` or `none` ignores it, because the host reads it only for a
 * drawer-mode record.
 */
export type RecordOpenPreference = 'drawer' | 'split';

/** The `localStorage` key the preference is kept under. */
export const RECORD_OPEN_PREFERENCE_KEY = 'os:record-open-mode';

/** What a reader who never chose gets: the drawer. */
export const DEFAULT_RECORD_OPEN_PREFERENCE: RecordOpenPreference = 'drawer';

/** The storage surface this module reads — `localStorage`, or a test double. */
export type RecordOpenPreferenceStorage = Pick<Storage, 'getItem'>;

/** The storage surface this module writes — `localStorage`, or a test double. */
export type RecordOpenPreferenceWriteStorage = Pick<Storage, 'setItem'>;

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Accessing `localStorage` itself throws on a blocked origin.
    return null;
  }
}

/**
 * The reader's record-open preference, or {@link DEFAULT_RECORD_OPEN_PREFERENCE}
 * when none is stored, the stored value is not one of the two, or there is no
 * readable storage. `storage` defaults to the browser's `localStorage`; `null`
 * says there is none.
 */
export function readRecordOpenPreference(
  storage: RecordOpenPreferenceStorage | null = defaultStorage(),
): RecordOpenPreference {
  if (!storage) return DEFAULT_RECORD_OPEN_PREFERENCE;
  try {
    const stored = storage.getItem(RECORD_OPEN_PREFERENCE_KEY);
    return stored === 'split' || stored === 'drawer' ? stored : DEFAULT_RECORD_OPEN_PREFERENCE;
  } catch {
    return DEFAULT_RECORD_OPEN_PREFERENCE;
  }
}

/**
 * A choice storage would not keep, held for this page: a browser whose
 * storage refuses the write (private mode, a full quota, a blocked origin)
 * would otherwise have the reader pick 分屏 and keep reading 抽屉 back.
 * `undefined` while storage keeps the choice — storage is then the one answer
 * — and cleared by the next kept write and by another tab's write (see
 * `subscribe`).
 */
let pageChoice: RecordOpenPreference | undefined;

/** The live {@link useRecordOpenPreference} callers on this page. */
const listeners = new Set<() => void>();

/**
 * Keep the reader's choice. `storage` defaults to the browser's
 * `localStorage`; `null` says there is none. With no storage, or one that
 * refuses the write, nothing is kept and nothing throws: the choice holds on
 * this page, through {@link useRecordOpenPreference}, and the next page load
 * reads the default.
 *
 * Every live {@link useRecordOpenPreference} on this page hears the write;
 * another tab of the same origin hears it through the browser's `storage`
 * event.
 */
export function writeRecordOpenPreference(
  next: RecordOpenPreference,
  storage: RecordOpenPreferenceWriteStorage | null = defaultStorage(),
): void {
  pageChoice = next;
  if (storage) {
    try {
      storage.setItem(RECORD_OPEN_PREFERENCE_KEY, next);
      pageChoice = undefined;
    } catch {
      // Not kept past this page — see above.
    }
  }
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    // `key === null` is a `clear()` in another tab.
    if (event.key === RECORD_OPEN_PREFERENCE_KEY || event.key === null) {
      pageChoice = undefined;
      onChange();
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

function snapshot(): RecordOpenPreference {
  return pageChoice ?? readRecordOpenPreference();
}

function serverSnapshot(): RecordOpenPreference {
  return DEFAULT_RECORD_OPEN_PREFERENCE;
}

/**
 * The reader's record-open preference as live state, and the setter the
 * Display menu writes it with (objectstack#26681). A write here, in another
 * component of this page, or in another tab re-renders every caller, so the
 * object page decides its split face from the value the reader just chose.
 */
export function useRecordOpenPreference(): [RecordOpenPreference, (next: RecordOpenPreference) => void] {
  const preference = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setPreference = useCallback((next: RecordOpenPreference) => writeRecordOpenPreference(next), []);
  return [preference, setPreference];
}
