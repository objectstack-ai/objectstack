/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordPagePreferencesContext — a signed-in user's own record-page choices,
 * per object, offered to the record page's renderers by their host
 * (objectstack#25883).
 *
 * The one choice it carries today is "show empty fields": a reader who opens a
 * section's "Show N empty fields" row wants to see the whole record, and wants
 * it on every section of the page, on the next record of the same object and
 * after a reload. The host keeps that choice where it keeps the user's list
 * state, a `sys_user_preference` row per object (the Console's key is
 * `ui.record.<object>`, beside `ui.list.<object>`).
 *
 * ## Why a context, and why here
 *
 * The record page's sections reach the page through `ComponentRegistry`, so no
 * host prop reaches them; a context does, the same way `HostNavigationContext`
 * and `HostMapStyleContext` reach the renderers they serve. The persistence
 * (the preference read, the row writes, the signed-in user) belongs to the
 * host, and the renderer package must not depend on the host's package, so the
 * seam lives in this package, which both already depend on.
 *
 * ## Absent is a supported state
 *
 * Outside a provider, or under one given `null` (no signed-in user, no
 * preference store), {@link useRecordPagePreferences} answers `null`, and a
 * renderer keeps the choice in its own component state as it did before: per
 * section, until the page unmounts.
 *
 * ⛔ Not metadata. Nothing here is authorable and nothing changes what a view
 * declares; it is one user's own reading preference, invisible to every other
 * user.
 */

import React, { createContext, useContext } from 'react';

/** One user's record-page choices for one object. */
export interface RecordPagePreference {
  /**
   * The reader chose to see the fields the page folds away as empty. Absent
   * means no choice was made: the page folds them, as it always has.
   */
  showEmptyFields?: boolean;
}

/** The host's store of record-page choices, one entry per object. */
export interface RecordPagePreferencesStore {
  /** The user's choices for `objectName`; `{}` when they made none. */
  get(objectName: string): RecordPagePreference;
  /** Record a choice for `objectName`. The parts the patch names replace the stored ones. */
  update(objectName: string, patch: RecordPagePreference): void;
}

export const RecordPagePreferencesContext = createContext<RecordPagePreferencesStore | null>(null);

export const RecordPagePreferencesProvider: React.FC<{
  /** The host's store, or `null` when the host has none to offer right now. */
  value: RecordPagePreferencesStore | null;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <RecordPagePreferencesContext.Provider value={value}>{children}</RecordPagePreferencesContext.Provider>
);

/**
 * The host's record-page preference store, or `null` when no host provided
 * one. See the module docblock.
 */
export function useRecordPagePreferences(): RecordPagePreferencesStore | null {
  return useContext(RecordPagePreferencesContext);
}
