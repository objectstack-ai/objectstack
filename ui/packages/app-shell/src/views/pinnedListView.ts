/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import { useOrganizationScope } from '../context/UserStateAdapters.js';
import {
  LIST_PINNED_VIEW_PREFERENCE,
  objectPreferenceScope,
  useWorkspacePreference,
  workspacePreferenceStorage,
  workspacePreferenceStorageKey,
  type WorkspacePreferenceScope,
} from '../utils/workspacePreference.js';

/**
 * The reader's pinned list view for an object, kept per organization
 * (objectstack#36244).
 *
 * The pin can name a personal view (`sys_personal_view`), which exists in one
 * organization only, so one browser slot per object made a pin set in one
 * organization name a view another organization's list does not offer, and a
 * pin set there overwrite it. The slot therefore names the active organization
 * too: `os:pref:list.view.pinned@object:OBJECT@org:ORG`. With no organization
 * (no organization feature, a preview) it is the per-object slot it always
 * was. Only this preference is keyed this way; every other workspace
 * preference stays per browser.
 */
export function pinnedListViewScope(objectName: string, orgId: string | null): WorkspacePreferenceScope {
  const scope = objectPreferenceScope(objectName);
  return orgId ? `${scope}@org:${orgId}` : scope;
}

/**
 * The first organization to read its pin for `objectName` and find none adopts
 * the pin kept before the organization was part of the slot: the stored
 * spelling moves under this organization's slot and the per-object slot is
 * removed, so exactly one organization inherits it. Idempotent.
 */
function adoptPerObjectPin(objectName: string, orgId: string | null): void {
  if (!orgId) return;
  const storage = workspacePreferenceStorage();
  if (!storage) return;
  try {
    const own = workspacePreferenceStorageKey(LIST_PINNED_VIEW_PREFERENCE, pinnedListViewScope(objectName, orgId));
    if (storage.getItem(own) !== null) return;
    const perObject = workspacePreferenceStorageKey(LIST_PINNED_VIEW_PREFERENCE, objectPreferenceScope(objectName));
    const kept = storage.getItem(perObject);
    if (kept === null) return;
    storage.setItem(own, kept);
    storage.removeItem(perObject);
  } catch {
    // A storage that refuses the move leaves the pin where it was.
  }
}

/**
 * The reader's pinned view for `objectName` in the active organization —
 * `null` while none is pinned — and the setter that pins one (or unpins, with
 * `null`).
 */
export function usePinnedListView(objectName: string): [string | null, (next: string | null) => void] {
  const orgId = useOrganizationScope();
  // Before the store is read below, so the first read already sees an adopted
  // pin. The move is idempotent, so a recomputation does nothing more.
  useMemo(() => adoptPerObjectPin(objectName, orgId), [objectName, orgId]);
  return useWorkspacePreference(LIST_PINNED_VIEW_PREFERENCE, pinnedListViewScope(objectName, orgId), null);
}
