/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#34608 (ui ADR-0057 as amended) — the top-bar robot, the AI
 * assistant's ONE standing entry: it opens and closes the right-side drawer
 * without leaving the page. The floating bottom-right button it replaces is
 * gone; what that button carried moved here:
 *  - objectui#11666 — while a proposed plan awaits the user's approval the
 *    robot carries a marker, so a user who closed the chat still sees the
 *    assistant is waiting on them. Read off the assistant bus; only a change
 *    of the plan's state clears it, never opening the chat.
 *
 * Under a layout with no drawer it is a link to the pre-drawer address, which
 * the console routes back into the drawer.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { usePlanApprovalPending } from '../assistant/assistantBus.js';
import { useChatDockControl } from './chatDockControl.js';

export function AssistantTopBarButton({ className }: { className?: string }) {
  const { t } = useObjectTranslation();
  const control = useChatDockControl();
  const planPending = usePlanApprovalPending();
  const markerId = React.useId();
  const label = t('topbar.aiAssistant', { defaultValue: 'AI Assistant' });
  const marker = planPending ? (
    <span className="absolute right-1 top-1 flex size-2.5" data-testid="topbar-ai-assistant-plan-pending">
      <span aria-hidden="true" className="size-2.5 rounded-full bg-amber-500 ring-2 ring-background" />
      <span id={markerId} className="sr-only">
        {t('console.ai.dock.planAwaitingApproval')}
      </span>
    </span>
  ) : null;
  const classes = cn('relative h-8 w-8 max-md:size-11 shrink-0', className);
  if (!control) {
    return (
      <Button variant="ghost" size="icon" className={classes} asChild aria-label={label}>
        <Link to="/ai" data-testid="topbar-ai-assistant" aria-describedby={planPending ? markerId : undefined}>
          <Bot className="h-4 w-4" />
          {marker}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(classes, control.expanded && 'bg-accent text-accent-foreground')}
      onClick={control.toggle}
      aria-label={label}
      title={label}
      aria-pressed={control.expanded}
      aria-describedby={planPending ? markerId : undefined}
      data-testid="topbar-ai-assistant"
    >
      <Bot className="h-4 w-4" />
      {marker}
    </Button>
  );
}
