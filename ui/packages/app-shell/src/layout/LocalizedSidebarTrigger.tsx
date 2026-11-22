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
import { shortcutKeycaps } from '../chrome/advertisedShortcuts.js';
import { SIDEBAR_TOGGLE_CHORD } from './consoleSidebarRail.js';

/**
 * The shell's sidebar trigger (objectui#12429): below the Shadcn mobile
 * breakpoint it opens and closes the drawer, above it it collapses the
 * sidebar and expands it again. In the console a collapsed sidebar is hidden,
 * and the trigger docks it beside the content again as the reader's choice
 * (ruling 7069868269 on objectstack#36112, `consoleSidebarRail`).
 * `aria-expanded` follows whichever of the two states the click toggles.
 *
 * The tooltip names ⌘B / Ctrl+B ({@link SIDEBAR_TOGGLE_CHORD}), drawn with
 * the keyboard-shortcuts dialog's keycaps so the two never spell it
 * differently: the chord is a press on this button (ruling 7074574380 on
 * objectstack#36112).
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
          className="pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground"
        >
          {shortcutKeycaps(SIDEBAR_TOGGLE_CHORD).join('')}
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
});

LocalizedSidebarTrigger.displayName = 'LocalizedSidebarTrigger';
