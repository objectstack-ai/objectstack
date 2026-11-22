// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Home's "Connect an AI Assistant" card: one plain sentence that this system
 * can be worked from Claude, Doubao and similar AI assistants, and one button
 * to Connect an AI Assistant. For every signed-in person.
 *
 * Drawn only when all of these hold:
 *  - the served Account app carries the page (`connectAssistantPath`; a
 *    deployment with MCP turned off has nowhere to send the button);
 *  - the person has not hidden it on this browser (`connectAssistantCardGate`);
 *  - `useConnectedAccess` answered that the person has connected nothing: no
 *    authorized assistant and no API key that still works. While that read is
 *    out, or when it cannot be read, the card stays away rather than offering
 *    a connection the person may already have;
 *  - no other Home card is drawing the same item: an administrator's first-run
 *    checklist claims `connect_assistant` while its row for it is not done
 *    (`homeItemClaims`), and the row says it once, with its done state.
 *
 * Once the person connects one it is gone on the next read, and it does not
 * come back after a dismissal.
 *
 * Where and how big (objectstack#35017): the host draws it after the greeting,
 * My apps and My work, never above them, so it brings no padding or width of
 * its own; the host's column gives both. Below `sm` it is one row (icon,
 * title, Connect, close): the title keeps one line and the sentence under it
 * is visually collapsed but still read out, so a phone's first screen keeps
 * the apps. From `sm` up it is the two-line card it always was.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import { Button, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { Bot, X } from 'lucide-react';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { connectAssistantPath } from '../connect/connectAssistantPath.js';
import { useConnectedAccess } from '../connect/connectedAccess.js';
import { cardStorage, markCardDismissed, wasCardDismissed } from './connectAssistantCardGate.js';
import { useHomeItemClaimed } from './homeItemClaims.js';

export function ConnectAssistantCard({ className }: { className?: string } = {}) {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { apps } = useMetadata();
  const userId = user?.id ?? null;
  const path = connectAssistantPath(apps);
  // Hidden in this mount by the close button; an earlier visit's record is read below.
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const dismissed = userId !== null && (hiddenFor === userId || wasCardDismissed(cardStorage(), userId));
  const access = useConnectedAccess({ enabled: Boolean(path && userId && !dismissed) });
  const saidElsewhere = useHomeItemClaimed('connect_assistant');

  if (!path || !userId || dismissed || saidElsewhere) return null;
  if (access.state !== 'ready' || access.connected) return null;

  const dismiss = () => {
    markCardDismissed(cardStorage(), userId);
    setHiddenFor(userId);
  };

  return (
    <section
      className={cn(
        'flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 sm:gap-3 sm:px-4 sm:py-3',
        className,
      )}
      data-testid="home-connect-assistant"
      aria-labelledby="home-connect-assistant-title"
    >
      <Bot className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2
          id="home-connect-assistant-title"
          className="truncate text-sm font-medium sm:whitespace-normal"
          data-testid="home-connect-assistant-title"
        >
          {t('home.connectAssistant.title')}
        </h2>
        <p className="sr-only text-xs text-muted-foreground sm:not-sr-only" data-testid="home-connect-assistant-body">
          {t('home.connectAssistant.body')}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => navigate(path)}
        data-testid="home-connect-assistant-open"
      >
        {t('home.connectAssistant.action')}
      </Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('home.connectAssistant.dismiss')}
        title={t('home.connectAssistant.dismiss')}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        data-testid="home-connect-assistant-dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </section>
  );
}
