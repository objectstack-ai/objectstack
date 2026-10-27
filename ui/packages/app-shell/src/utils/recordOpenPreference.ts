/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
 * This is the READ side. The Display-menu control that writes it is
 * objectstack#26681; until it lands nothing in the console writes the key, so
 * every reader gets the default.
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

function defaultStorage(): RecordOpenPreferenceStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    // Accessing `localStorage` itself throws on a blocked origin.
    return undefined;
  }
}

/**
 * The reader's record-open preference, or {@link DEFAULT_RECORD_OPEN_PREFERENCE}
 * when none is stored, the stored value is not one of the two, or there is no
 * readable storage.
 */
export function readRecordOpenPreference(
  storage: RecordOpenPreferenceStorage | undefined = defaultStorage(),
): RecordOpenPreference {
  if (!storage) return DEFAULT_RECORD_OPEN_PREFERENCE;
  try {
    const stored = storage.getItem(RECORD_OPEN_PREFERENCE_KEY);
    return stored === 'split' || stored === 'drawer' ? stored : DEFAULT_RECORD_OPEN_PREFERENCE;
  } catch {
    return DEFAULT_RECORD_OPEN_PREFERENCE;
  }
}
