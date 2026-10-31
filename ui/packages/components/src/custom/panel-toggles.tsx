/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Toggle } from '../ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../lib/utils';
import { Kbd, KbdGroup } from './kbd';

/** One panel a {@link PanelToggles} control shows or hides. */
export interface PanelToggleItem {
  /** Stable identity within the control; also the segment's `data-panel-toggle`. */
  id: string;
  /** The panel's name — the toggle's accessible name and its tooltip text. */
  label: string;
  /** The panel's icon, the toggle's whole face. Decorative: the label names the toggle. */
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** Whether the panel is shown. */
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** The keycaps of the shortcut that toggles the panel, drawn in the tooltip (`['⌘', '⇧', '.']`). */
  shortcut?: readonly string[];
  /** The same shortcut for assistive technology, in `aria-keyshortcuts` syntax (`Meta+Shift+.`). */
  ariaKeyShortcuts?: string;
}

export interface PanelTogglesProps {
  items: readonly PanelToggleItem[];
  /** The control's accessible name. */
  label: string;
  className?: string;
}

/**
 * The icon toggles that show and hide a page's panels — the reader's own
 * layout switches (objectstack#27052), the way an editor's title bar toggles
 * its side panels: the record page's ⊟ (「右栏」, objectstack#27524, Target
 * 4). Each toggle is its icon alone: `aria-pressed` says whether its panel
 * is shown — a toggle that is on is filled with the accent tint
 * (objectstack#27241), one that is off is a muted icon — and its accessible
 * name and tooltip are the panel's name, with the shortcut that toggles it.
 *
 * Pure presentation: the host owns the state and the shortcut handlers, and
 * hands in localized labels. The console's record page draws it at the end
 * of the record header's action row; any other host may place it where its
 * own chrome is.
 */
export function PanelToggles({ items, label, className }: PanelTogglesProps) {
  if (items.length === 0) return null;
  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="group"
        aria-label={label}
        className={cn('inline-flex h-8 items-center gap-0.5', className)}
        data-panel-toggles=""
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Toggle
                  size="sm"
                  pressed={item.pressed}
                  onPressedChange={item.onPressedChange}
                  aria-label={item.label}
                  aria-keyshortcuts={item.ariaKeyShortcuts}
                  className={cn(
                    'h-8 w-8 min-w-0 rounded-md p-0 text-muted-foreground',
                    'hover:bg-muted hover:text-foreground',
                    // `aria-pressed`, not Radix's `data-state`: the tooltip
                    // trigger writes its own `data-state` onto this button.
                    'aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:aria-pressed:bg-accent',
                  )}
                  data-panel-toggle={item.id}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                </Toggle>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-2">
                <span>{item.label}</span>
                {item.shortcut && item.shortcut.length > 0 && (
                  <KbdGroup>
                    {item.shortcut.map((cap, index) => (
                      <Kbd key={index}>{cap}</Kbd>
                    ))}
                  </KbdGroup>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
