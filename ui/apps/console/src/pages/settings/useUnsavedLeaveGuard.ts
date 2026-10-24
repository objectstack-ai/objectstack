/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Ask before leaving a page that holds unsaved edits (objectui#13163,
 * objectui#13231).
 *
 * The settings page keeps its edits in component state, so any way off the
 * page dropped them without a word: a sidebar link, its own "All settings"
 * crumb, a tab close, and the shell's own menus — Help, the avatar's Profile
 * and organization entries, the workspace switcher, a sidebar entry's Design.
 *
 * This hook registers the page's edits with the shell's unsaved-edits seam
 * (`useRegisterUnsavedEdits` in `@object-ui/app-shell`) while `dirty`. The
 * seam then guards every departure it can see — a tab close or reload, an
 * in-app link, and each shell departure that starts from a button, an
 * organization switch included, which now asks before the switch is sent —
 * and removes its listeners the moment the page goes clean (a save, a
 * discard) or unmounts. Why the prompt is the native `confirm` and what it
 * cannot see (browser Back / Forward) is written beside the seam.
 */

import { confirmUnsavedLeave, useRegisterUnsavedEdits } from '@object-ui/app-shell';

/**
 * Guard a page's unsaved edits against every departure the shell can see.
 *
 * @param dirty   whether the page holds edits that leaving would drop
 * @param message the question the prompt asks, already translated
 * @returns `confirmLeave(go)` — for the page's own navigations: runs `go` at
 *          once when clean, and otherwise only after the user confirms
 */
export function useUnsavedLeaveGuard(
  dirty: boolean,
  message: string,
): (go: () => void) => void {
  useRegisterUnsavedEdits(dirty, message);
  return confirmUnsavedLeave;
}
