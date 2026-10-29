/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useSyncExternalStore } from 'react';
import {
  relatedArrangementFromRecord,
  relatedArrangementToRecord,
  type RelatedArrangement,
} from '@object-ui/plugin-detail';

/**
 * The console's per-reader workspace preferences — how a reader likes the
 * workspace laid out, kept per browser and never metadata (objectstack#27052).
 *
 * A preference is a READER's choice: which record-page columns they keep
 * shown, how a drawer-mode object opens its records. An author declares none
 * of it, so none of it is a key in `@objectstack/spec`; a preference that has
 * no stored choice answers a default the host derives (from the object, for a
 * per-object preference), and the default is the host's, never stored.
 *
 * ## One store, keyed by preference × scope
 *
 * A preference is declared once ({@link defineWorkspacePreference}) and read
 * in a scope: `user` (the reader, across objects) or `object:OBJECT_NAME`
 * (the reader, for one object — {@link objectPreferenceScope}). Each pair has
 * one `localStorage` key ({@link workspacePreferenceStorageKey}).
 *
 * ## The value is a small versioned record
 *
 * What is stored is a JSON record carrying `v`, the shape's version
 * ({@link versionedPreferenceCodec}): a reader of a newer version than it
 * knows, or of an unreadable record, answers "no choice", so a shape change is
 * a version bump with a migration in its codec, never a silent misread. A
 * preference that already had a stored spelling before this module keeps it
 * byte for byte through a codec of its own — `recordOpenPreference.ts` is the
 * one today (`os:record-open-mode`, a bare `drawer` / `split`).
 *
 * ## Read, write, and live
 *
 * {@link readWorkspacePreference} / {@link writeWorkspacePreference} are the
 * plain pair; {@link useWorkspacePreference} is the live one, through
 * `useSyncExternalStore`: a write in this page re-renders every caller of
 * the same preference and scope, and a write in another tab of the origin
 * arrives through the browser's `storage` event. With no `window` (SSR), no
 * storage, or a storage that throws (private mode, a blocked origin, a full
 * quota), a read answers "no choice" and a write throws nothing — and a choice
 * the storage would not keep is held for this page, so the reader who picks a
 * value keeps reading it back until the page unloads.
 */

/** Whose choice a preference is: the reader across objects, or the reader for one object. */
export type WorkspacePreferenceScope = 'user' | `object:${string}`;

/** The scope of a per-object preference for `objectName`. */
export function objectPreferenceScope(objectName: string): WorkspacePreferenceScope {
  return `object:${objectName}`;
}

/** How a preference's value is spelled in storage. */
export interface WorkspacePreferenceCodec<T> {
  /** The value a stored string spells, or `undefined` for one this codec does not read. */
  decode(stored: string): T | undefined;
  /** The stored spelling of `value`. */
  encode(value: T): string;
}

/** A declared preference — see {@link defineWorkspacePreference}. */
export interface WorkspacePreference<T> {
  /** The preference's name, dotted (`record.columns.timeline`). */
  readonly name: string;
  readonly codec: WorkspacePreferenceCodec<T>;
  /**
   * The `localStorage` key for `scope`. Absent: the module's own spelling,
   * `os:pref:NAME` for `user` and `os:pref:NAME@SCOPE` otherwise.
   */
  readonly storageKey?: (scope: WorkspacePreferenceScope) => string;
}

/** Declare a preference. Pass a module-level constant to the hooks. */
export function defineWorkspacePreference<T>(definition: WorkspacePreference<T>): WorkspacePreference<T> {
  return Object.freeze({ ...definition });
}

/** The `localStorage` key `preference` is kept under in `scope`. */
export function workspacePreferenceStorageKey(
  preference: WorkspacePreference<unknown>,
  scope: WorkspacePreferenceScope = 'user',
): string {
  if (preference.storageKey) return preference.storageKey(scope);
  return scope === 'user' ? `os:pref:${preference.name}` : `os:pref:${preference.name}@${scope}`;
}

/**
 * The codec of a versioned record: what is stored is `{ v: version, ...fields }`.
 * `fromRecord` reads a record of exactly `version` (its migration point for an
 * older one, when a later version needs it), and answers `undefined` for a
 * record it does not read; a record of another version, or one that is not a
 * JSON object, is "no choice".
 */
export function versionedPreferenceCodec<T>(options: {
  version: number;
  toRecord: (value: T) => Record<string, unknown>;
  fromRecord: (record: Record<string, unknown>) => T | undefined;
}): WorkspacePreferenceCodec<T> {
  const { version, toRecord, fromRecord } = options;
  return {
    encode: (value) => JSON.stringify({ ...toRecord(value), v: version }),
    decode: (stored) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stored);
      } catch {
        return undefined;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
      const record = parsed as Record<string, unknown>;
      if (record.v !== version) return undefined;
      return fromRecord(record);
    },
  };
}

/**
 * An on | off preference — a record-page column shown or not. Stored as
 * `{"value":"on"|"off","v":1}`.
 */
export type PreferenceSwitch = 'on' | 'off';

const switchCodec = versionedPreferenceCodec<PreferenceSwitch>({
  version: 1,
  toRecord: (value) => ({ value }),
  fromRecord: (record) => (record.value === 'on' || record.value === 'off' ? record.value : undefined),
});

/**
 * Whether the record page shows its timeline column, per object
 * (scope `object:OBJECT_NAME`). With no choice the host derives the default
 * from the object (`recordPageColumnDefaults` in `@object-ui/plugin-detail`).
 */
export const RECORD_TIMELINE_COLUMN_PREFERENCE = defineWorkspacePreference<PreferenceSwitch>({
  name: 'record.columns.timeline',
  codec: switchCodec,
});

/**
 * Whether the record page shows its related column, per object
 * (scope `object:OBJECT_NAME`). With no choice: shown.
 */
export const RECORD_RELATED_COLUMN_PREFERENCE = defineWorkspacePreference<PreferenceSwitch>({
  name: 'record.columns.related',
  codec: switchCodec,
});

/**
 * How the reader arranged the record page's related cards, per object
 * (scope `object:OBJECT_NAME`, objectstack#27055): `{ v, order, collapsed,
 * hidden, basedOn }` — plus `seen`, the first-seen stamps of relationships new
 * since the last drag (the 48 h 「新」 badge needs a clock). The value is a
 * DIFF against the default order; `resolveRelatedArrangement` in
 * `@object-ui/plugin-detail` lays it over the default. With no choice the
 * host passes `EMPTY_RELATED_ARRANGEMENT`: the default order, every card open.
 */
export const RECORD_RELATED_ARRANGEMENT_PREFERENCE = defineWorkspacePreference<RelatedArrangement>({
  name: 'record.related.arrangement',
  codec: versionedPreferenceCodec<RelatedArrangement>({
    version: 1,
    toRecord: relatedArrangementToRecord,
    fromRecord: relatedArrangementFromRecord,
  }),
});

/** The storage surface a read takes — `localStorage`, or a test double. */
export type WorkspacePreferenceReadStorage = Pick<Storage, 'getItem'>;

/** The storage surface a write takes — `localStorage`, or a test double. */
export type WorkspacePreferenceWriteStorage = Pick<Storage, 'setItem'>;

/** The browser's `localStorage`, or `null` with no `window` or a storage that throws on access. */
export function workspacePreferenceStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Accessing `localStorage` itself throws on a blocked origin.
    return null;
  }
}

/**
 * Choices storage would not keep, held for this page by storage key: a
 * browser whose storage refuses the write would otherwise have the reader
 * pick a value and keep reading the old one back. An entry exists only while
 * storage did not keep the choice — storage is then the one answer — and is
 * cleared by the next kept write and by another tab's write.
 */
const pageChoices = new Map<string, string>();

/** The live {@link useWorkspacePreference} callers on this page, by storage key. */
const listeners = new Map<string, Set<() => void>>();

function storedSpelling(key: string, storage: WorkspacePreferenceReadStorage | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The reader's choice for `preference` in `scope` as `storage` keeps it, or
 * `undefined` when it keeps none: nothing stored, a spelling the codec does
 * not read, or no readable storage. `storage` defaults to the browser's
 * `localStorage`; `null` says there is none. A choice held for this page only
 * (storage refused it) is the live hook's, {@link useWorkspacePreference}.
 */
export function readWorkspacePreference<T>(
  preference: WorkspacePreference<T>,
  scope: WorkspacePreferenceScope = 'user',
  storage: WorkspacePreferenceReadStorage | null = workspacePreferenceStorage(),
): T | undefined {
  const stored = storedSpelling(workspacePreferenceStorageKey(preference, scope), storage);
  return stored === null ? undefined : preference.codec.decode(stored);
}

/**
 * Keep the reader's choice for `preference` in `scope`. With no storage, or
 * one that refuses the write, nothing is kept and nothing throws: the choice
 * holds on this page and the next page load reads "no choice". Every live
 * caller of the same preference and scope on this page hears the write;
 * another tab hears it through the browser's `storage` event.
 */
export function writeWorkspacePreference<T>(
  preference: WorkspacePreference<T>,
  scope: WorkspacePreferenceScope,
  next: T,
  storage: WorkspacePreferenceWriteStorage | null = workspacePreferenceStorage(),
): void {
  const key = workspacePreferenceStorageKey(preference, scope);
  const spelling = preference.codec.encode(next);
  pageChoices.set(key, spelling);
  if (storage) {
    try {
      storage.setItem(key, spelling);
      pageChoices.delete(key);
    } catch {
      // Not kept past this page — see `pageChoices`.
    }
  }
  for (const listener of Array.from(listeners.get(key) ?? [])) listener();
}

function subscribeTo(key: string, onChange: () => void): () => void {
  let keyListeners = listeners.get(key);
  if (!keyListeners) {
    keyListeners = new Set();
    listeners.set(key, keyListeners);
  }
  keyListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    // `key === null` is a `clear()` in another tab.
    if (event.key === key || event.key === null) {
      pageChoices.delete(key);
      onChange();
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    keyListeners!.delete(onChange);
    if (keyListeners!.size === 0) listeners.delete(key);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/**
 * Decoded values by storage key and the spelling they were decoded from, so a
 * snapshot is the same value until the spelling changes — what
 * `useSyncExternalStore` requires of a record-shaped preference.
 */
const decoded = new Map<string, { spelling: string; value: unknown }>();

function snapshotOf<T>(preference: WorkspacePreference<T>, key: string): T | undefined {
  const spelling = pageChoices.get(key) ?? storedSpelling(key, workspacePreferenceStorage());
  if (spelling === null) return undefined;
  const cached = decoded.get(key);
  if (cached && cached.spelling === spelling) return cached.value as T | undefined;
  const value = preference.codec.decode(spelling);
  decoded.set(key, { spelling, value });
  return value;
}

/**
 * The reader's choice for `preference` in `scope` as live state — `fallback`
 * while there is none (and on the server) — and the setter that keeps a new
 * one. A write here, in another component of this page, or in another tab
 * re-renders every caller of the same preference and scope.
 */
export function useWorkspacePreference<T>(
  preference: WorkspacePreference<T>,
  scope: WorkspacePreferenceScope,
  fallback: T,
): [T, (next: T) => void] {
  const key = workspacePreferenceStorageKey(preference, scope);
  const subscribe = useCallback((onChange: () => void) => subscribeTo(key, onChange), [key]);
  const getSnapshot = useCallback(() => snapshotOf(preference, key), [preference, key]);
  const getServerSnapshot = useCallback((): T | undefined => undefined, []);
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setChoice = useCallback(
    (next: T) => writeWorkspacePreference(preference, scope, next),
    [preference, scope],
  );
  return [choice === undefined ? fallback : choice, setChoice];
}
