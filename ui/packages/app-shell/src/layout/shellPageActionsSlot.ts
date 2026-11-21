// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shell's top-right button group as the page headers see it
 * (objectstack#36111): a slot, not an import of the group.
 *
 * The headers that place the group (the console `PageHeader`, the list's view
 * bar, the record page's navigation row) are imported by pages that run
 * outside the console shell too: a page bundled on its own, a test that
 * mounts one bare. The group itself reads the app's metadata, the Studio
 * gate, the AI surface and the help menu's docs, so importing it from a
 * header would drag all of that into every one of those pages. The shell
 * hands the group in through this context instead (`ShellPageActionsScope`,
 * in `ShellPageActions.tsx`); a header reads it here, which imports nothing
 * but React and the phone breakpoint.
 *
 * `null` (outside a scope, the scope turned off, or a phone): the header
 * draws nothing for the group.
 */

import * as React from 'react';
import { usePhoneViewport } from '../hooks/usePhoneViewport.js';

export interface ShellPageActionsSlotProps {
  /**
   * The comments entry, first in the group: handed by the list and record
   * pages only, nothing until the comments work puts its icon here.
   */
  comments?: React.ReactNode;
}

/** Draws the group with the header's comments entry. */
export type ShellPageActionsRender = (props: ShellPageActionsSlotProps) => React.ReactNode;

/** The group the shell turned on for the pages under it; `null` when off. */
export const ShellPageActionsSlotContext = React.createContext<ShellPageActionsRender | null>(null);

/** The group to draw here: the shell's, unless it is off or this is a phone. */
export function useShellPageActionsSlot(): ShellPageActionsRender | null {
  const renderGroup = React.useContext(ShellPageActionsSlotContext);
  const phone = usePhoneViewport();
  return renderGroup && !phone ? renderGroup : null;
}
