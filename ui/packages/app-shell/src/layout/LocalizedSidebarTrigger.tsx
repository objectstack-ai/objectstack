import * as React from 'react';
import { PanelLeft } from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  useSidebar,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { shortcutKeycaps, type ShortcutChord } from '../chrome/advertisedShortcuts.js';

/**
 * The chord `SidebarProvider`'s own listener answers to (⌘B / Ctrl+B). It is
 * the same chord `ConsoleLayout` advertises to the keyboard-shortcuts dialog;
 * the tooltip draws it with the dialog's keycaps so the two never spell it
 * differently.
 */
const TOGGLE_SIDEBAR_CHORD: ShortcutChord = { key: 'b', mod: true };

/**
 * The shell's one sidebar trigger (objectui#12429). It lives in the app bar's
 * left slot at every width: below the Shadcn mobile breakpoint it opens and
 * closes the drawer, above it it collapses the sidebar to the icon rail and
 * expands it again. `aria-expanded` follows whichever of the two states the
 * click toggles, and the tooltip names the keyboard shortcut.
 */
export const LocalizedSidebarTrigger = React.forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({ className, onClick, 'aria-label': ariaLabel, title, ...props }, ref) => {
  const { toggleSidebar, isMobile, open, openMobile } = useSidebar();
  const { t } = useObjectTranslation();
  const label = String(ariaLabel || title || t('common.toggleSidebar', { defaultValue: 'Toggle sidebar' }));
  const expanded = isMobile ? openMobile : open;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          data-sidebar="trigger"
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', className)}
          aria-label={label}
          onClick={(event) => {
            onClick?.(event);
            toggleSidebar();
          }}
          {...props}
          aria-expanded={expanded}
        >
          <PanelLeft />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="flex items-center gap-2">
        <span>{label}</span>
        <kbd
          data-testid="sidebar-trigger-shortcut"
          className="pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground"
        >
          {shortcutKeycaps(TOGGLE_SIDEBAR_CHORD).join('')}
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
});

LocalizedSidebarTrigger.displayName = 'LocalizedSidebarTrigger';
