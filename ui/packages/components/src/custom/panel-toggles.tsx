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
  /** The panel's name — the segment's visible text, its accessible name and its tooltip text. */
  label: string;
  /** The panel's icon, drawn before the label. Decorative: the label names the segment. */
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
 * ONE segmented control that shows and hides a page's panels — the reader's
 * own layout switches (objectstack#27052), the way an editor's title bar
 * toggles its side panels. Each segment is a toggle with an icon and its
 * label (objectstack#27241): `aria-pressed` says whether its panel is shown;
 * a segment that is on is filled with the accent tint and reads in the
 * foreground colour, a segment that is off is plain muted text — the state
 * reads at a glance, in both themes, without hovering. Its tooltip names the
 * panel and the shortcut that toggles it.
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
        className={cn('inline-flex h-8 items-center gap-0.5 rounded-md border border-border bg-background p-0.5', className)}
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
                  aria-keyshortcuts={item.ariaKeyShortcuts}
                  className={cn(
                    'h-[1.625rem] min-w-0 gap-1.5 rounded-[5px] px-2 text-xs font-medium text-muted-foreground',
                    'hover:bg-muted hover:text-foreground',
                    // `aria-pressed`, not Radix's `data-state`: the tooltip
                    // trigger writes its own `data-state` onto this button.
                    'aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:aria-pressed:bg-accent',
                  )}
                  data-panel-toggle={item.id}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{item.label}</span>
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
