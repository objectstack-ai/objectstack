/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  defineWorkspacePreference,
  readWorkspacePreference,
  useWorkspacePreference,
  writeWorkspacePreference,
  workspacePreferenceStorage,
} from './workspacePreference.js';

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
 *
 * A thin alias over the console's one preference store,
 * `workspacePreference.ts` (objectstack#27052): the preference is
 * {@link RECORD_OPEN_PREFERENCE} there, in the `user` scope, and it keeps the
 * spelling it was first stored with — a bare `drawer` / `split` under
 * {@link RECORD_OPEN_PREFERENCE_KEY} — so a reader's earlier choice reads
 * back unchanged.
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

/**
 * The preference in the console's store: one key for every object (`user`
 * scope), stored as the bare value. Any other stored spelling — an unknown
 * value, a retired mode name, another case — is no choice.
 */
export const RECORD_OPEN_PREFERENCE = defineWorkspacePreference<RecordOpenPreference>({
  name: 'record.open-mode',
  storageKey: () => RECORD_OPEN_PREFERENCE_KEY,
  codec: {
    decode: (stored) => (stored === 'split' || stored === 'drawer' ? stored : undefined),
    encode: (value) => value,
  },
});

/**
 * The reader's record-open preference, or {@link DEFAULT_RECORD_OPEN_PREFERENCE}
 * when none is stored, the stored value is not one of the two, or there is no
 * readable storage. `storage` defaults to the browser's `localStorage`; `null`
 * says there is none.
 */
export function readRecordOpenPreference(
  storage: RecordOpenPreferenceStorage | null = workspacePreferenceStorage(),
): RecordOpenPreference {
  return readWorkspacePreference(RECORD_OPEN_PREFERENCE, 'user', storage) ?? DEFAULT_RECORD_OPEN_PREFERENCE;
}

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
  storage: RecordOpenPreferenceWriteStorage | null = workspacePreferenceStorage(),
): void {
  writeWorkspacePreference(RECORD_OPEN_PREFERENCE, 'user', next, storage);
}

/**
 * The reader's record-open preference as live state, and the setter the
 * Display menu writes it with (objectstack#26681). A write here, in another
 * component of this page, or in another tab re-renders every caller, so the
 * object page decides its split face from the value the reader just chose.
 */
export function useRecordOpenPreference(): [RecordOpenPreference, (next: RecordOpenPreference) => void] {
  return useWorkspacePreference(RECORD_OPEN_PREFERENCE, 'user', DEFAULT_RECORD_OPEN_PREFERENCE);
}
