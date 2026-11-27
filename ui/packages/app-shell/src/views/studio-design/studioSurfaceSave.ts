// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's save-entry plumbing, moved out of
 * `StudioDesignSurface.tsx` unchanged by objectstack#37553 (a move-only
 * split): the open page's unsaved work (a dirty pillar, a held edit, an edit
 * waiting for the page's Save), the one question every departure asks, the
 * tab-close prompt, and the registration with the shell's unsaved-edits seam.
 */

import * as React from 'react';
import { t, type SupportedLocale } from '../metadata-admin/i18n.js';
import { confirmUnsavedLeave, useRegisterUnsavedEdits } from '../../chrome/unsavedEdits.js';
import { useStudioSaveCoordinator } from './studioSaveBar.js';

/** The open page's unsaved work and the question every departure asks. */
export function useStudioSurfaceSave(locale: SupportedLocale) {
  // objectui#2600 — the header's pillar links and its 「‹ Back to app」 link
  // are pure SPA client navigation, so the editors' `beforeunload` guard never
  // fires; a dirty pillar unmounts silently and its unsaved edits are gone
  // (Access matrix cells, Interfaces nav). Each pillar mirrors its dirty state
  // up (the PR #2588 `onDirtyChange` contract) and every header-driven
  // departure gates on the same native confirm the pillars use internally.
  // Pillars reset their report on unmount, so a confirmed discard clears the
  // flag by itself.
  const [pillarDirty, setPillarDirty] = React.useState(false);
  // objectui#11786 — what the open pillar's autosave holds unsent (an
  // incomplete-but-normal edit), as the clause naming what it needs. A publish
  // promotes the drafts the server holds, which do not carry that edit, so it is
  // refused while one is held rather than going around it silently.
  const [heldEdit, setHeldEdit] = React.useState<string | null>(null);
  // objectstack#36511 — the open page's buffers that save with the top bar's
  // Save and Cancel (`studioSaveBar.tsx`).
  const saveBar = useStudioSaveCoordinator(locale);
  // objectstack#26705 — a held edit lives only in the pillar's buffer, so a
  // departure drops it exactly as it drops a dirty pillar's edits: both are
  // unsaved work, and every guard below reads this one bit. objectstack#36511
  // — so does an edit waiting for the page's Save.
  const unsavedPillarWork = pillarDirty || heldEdit !== null || saveBar.dirty;
  // objectstack#36900 — every departure this surface starts asks the shell's
  // unsaved-edits seam, not only this surface's own bit: the seam holds this
  // surface's work (registered below with the same question) AND every editor
  // below it that registers its own, the "All metadata" item page
  // (`ResourceEditPage`) among them, whose edits this bit never sees. So the
  // palette's picks, the header's Back to app, the retired-Interfaces notice
  // and a request to open another pillar's surface all ask before they drop
  // either kind of edit. `true`: nothing would be lost, or the author agreed.
  const confirmLeavePillar = React.useCallback((): boolean => {
    let agreed = false;
    confirmUnsavedLeave(() => {
      agreed = true;
    });
    return agreed;
  }, []);
  // Browser-native "leave site?" prompt on tab close / reload while a pillar
  // is dirty. The matrix editor installs its own (double registration is
  // harmless); the Interfaces nav editor has none, so this closes that gap.
  React.useEffect(() => {
    if (!unsavedPillarWork) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for Chrome to actually show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [unsavedPillarWork]);
  // objectui#13253 — the shell's own departures (header menus, palette, inbox,
  // AI entry) leave from buttons this surface never sees, so a dirty pillar
  // registers with the shell's seam, with the same question the header asks.
  // While registered, the seam's link guard also asks before a pillar link
  // leaves, so the pillar links below no longer ask a second time.
  useRegisterUnsavedEdits(unsavedPillarWork, t('engine.edit.unsavedLeaveConfirm', locale));
  return { setPillarDirty, heldEdit, setHeldEdit, saveBar, confirmLeavePillar };
}
