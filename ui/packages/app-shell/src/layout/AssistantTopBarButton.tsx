/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#34608 (ui ADR-0057 as amended) — the AI assistant's ONE standing
 * entry: it opens and closes the right-side drawer without leaving the page.
 * The floating bottom-right button it replaces is gone; what that button
 * carried moved here:
 *  - objectui#11666 — while a proposed plan awaits the user's approval the
 *    entry carries a marker, so a user who closed the chat still sees the
 *    assistant is waiting on them. Read off the assistant bus; only a change
 *    of the plan's state clears it, never opening the chat.
 *
 * objectstack#37858 — the entry is an outlined button that says what it does,
 * 「Ask AI」, beside a chat-bubble icon, on every page: the
 * page header's button group, the record page's navigation row, the phone's
 * top bar, Home's bar, and the corner button of a route with no shell header.
 * The words are the platform's — no app renames them — and they are Home's
 * 「Ask AI」 string (`home.askAI`): Home's button opens the same entry
 * (`useAskAiEntry`), so the one entry has one string in every pack. Two faces:
 *  - with its text, the text is the accessible name (no `aria-label`);
 *  - icon only — a phone (a 44 px target), or a header that ran out of room
 *    and asked for it (`iconOnly`) — `aria-label` carries the same words.
 * The tooltip names the ⌘⇧I shortcut on a Mac only: on other platforms
 * Ctrl+Shift+I opens the browser's developer tools first, so no shortcut is
 * advertised there and `aria-keyshortcuts` is not set.
 *
 * Under a layout with no drawer it is a link to the pre-drawer address, which
 * the console routes back into the drawer.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { Button, Kbd, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { usePlanApprovalPending } from '../assistant/assistantBus.js';
import { useChatDockControl, useOpenAssistant } from './chatDockControl.js';
import type { ChatDockTarget } from './chatDockTarget.js';
import { usePhoneViewport } from '../hooks/usePhoneViewport.js';

/** The drawer's shortcut in `aria-keyshortcuts` syntax; advertised on a Mac only. */
export const ASK_AI_MAC_KEY_SHORTCUTS = 'Meta+Shift+I';
/** The same shortcut as the tooltip's keycaps. */
const ASK_AI_MAC_KEYCAPS = ['⌘', '⇧', 'I'] as const;

/** Whether this browser runs on a Mac, where ⌘⇧I is free for the drawer. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac/i.test(platform);
}

/**
 * The Ask AI entry's opening, for a button elsewhere on a page that asks the
 * assistant the way the standing entry does — Home's 「Ask AI」. Absent a
 * target it opens the drawer on whatever it shows now: the drawer's own
 * toggle, which is what the standing button runs (a handoff the drawer still
 * holds is kept); with one, on that target. Under no drawer host it goes to
 * the pre-drawer address. What opening means changes here and in the
 * button's toggle together.
 */
export function useAskAiEntry(): (target?: ChatDockTarget) => void {
  const control = useChatDockControl();
  const openAssistant = useOpenAssistant();
  return React.useCallback(
    (target?: ChatDockTarget) => {
      if (control && target === undefined) {
        if (!control.expanded) control.toggle();
        return;
      }
      openAssistant(target);
    },
    [control, openAssistant],
  );
}

export interface AssistantTopBarButtonProps {
  className?: string;
  /**
   * Draw the icon alone, named by `aria-label`: the header placing the button
   * measured that its own content no longer fits beside the words. A phone
   * draws the icon alone whatever this says.
   */
  iconOnly?: boolean;
}

export function AssistantTopBarButton({ className, iconOnly = false }: AssistantTopBarButtonProps) {
  const { t } = useObjectTranslation();
  const control = useChatDockControl();
  const planPending = usePlanApprovalPending();
  const phone = usePhoneViewport();
  const mac = React.useMemo(isMacPlatform, []);
  const markerId = React.useId();
  const label = t('home.askAI', { defaultValue: 'Ask AI' });
  const iconAlone = iconOnly || phone;
  // `aria-hidden` keeps the marker's words out of the name a text face takes
  // from its content; the button still reads them as its description, which
  // names the marker by id.
  const marker = planPending ? (
    <span aria-hidden="true" className="absolute right-1 top-1 flex size-2.5" data-testid="topbar-ai-assistant-plan-pending">
      <span className="size-2.5 rounded-full bg-amber-500 ring-2 ring-background" />
      <span id={markerId} className="sr-only">
        {t('console.ai.dock.planAwaitingApproval')}
      </span>
    </span>
  ) : null;
  const face = (
    <>
      <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!iconAlone && (
        <span className="whitespace-nowrap" data-testid="topbar-ai-assistant-text">
          {label}
        </span>
      )}
      {marker}
    </>
  );
  const shared = {
    variant: 'outline' as const,
    size: 'sm' as const,
    className: cn(
      'relative shrink-0',
      phone ? 'size-11 p-0' : iconAlone ? 'size-8 p-0' : 'h-8 gap-1.5 px-2.5',
      control?.expanded && 'bg-accent text-accent-foreground',
      className,
    ),
    'aria-label': iconAlone ? label : undefined,
    'aria-keyshortcuts': mac ? ASK_AI_MAC_KEY_SHORTCUTS : undefined,
    'data-icon-only': iconAlone ? 'true' : 'false',
  };
  const button = control ? (
    <Button
      {...shared}
      // Opening is `useAskAiEntry`'s no-target arm, the drawer's own toggle;
      // read straight off the handle so the button needs no router.
      onClick={control.toggle}
      aria-pressed={control.expanded}
      aria-describedby={planPending ? markerId : undefined}
      data-testid="topbar-ai-assistant"
    >
      {face}
    </Button>
  ) : (
    <Button {...shared} asChild>
      <Link to="/ai" data-testid="topbar-ai-assistant" aria-describedby={planPending ? markerId : undefined}>
        {face}
      </Link>
    </Button>
  );
  // The tooltip adds what the face does not show: the words, when the icon
  // stands alone, and the shortcut, on a Mac. With neither there is none.
  if (!iconAlone && !mac) return button;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2" data-testid="topbar-ai-assistant-tooltip">
          <span>{label}</span>
          {mac && (
            <span className="inline-flex items-center gap-1" data-testid="topbar-ai-assistant-shortcut">
              {ASK_AI_MAC_KEYCAPS.map((cap) => (
                <Kbd key={cap}>{cap}</Kbd>
              ))}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
