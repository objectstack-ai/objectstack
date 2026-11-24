// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36999 — the composer's context row while the agent honours a
 * conversation focus (`capabilities.focus` on its catalog row).
 *
 * It takes the place of the page chip the composer draws today
 * (`console.ai.discussing`), in the pane's in-flow composer row: the page chip
 * with a pin on it when the page shows one record, or — once a record is
 * pinned — the focus chip, naming the record by its display name, with a
 * remove control. Opening another record while one is pinned asks once
 * 「改为问《X》？」; a decline is remembered for the conversation.
 *
 * The record's name is read client-side, as the user: the object definition
 * and one `findOne`, through the same seams the record page reads with. A
 * record the user cannot read keeps its `object · id` pair.
 */

import * as React from 'react';
import { Pin, X } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { useMetadataItem } from '@object-ui/react';
import { useAdapter } from '../../providers/AdapterProvider.js';
import { getRecordDisplayName } from '../../utils/index.js';
import type { ChatSurfaceContext } from '../../layout/chatSurfaceContext.js';
import { sameChatFocus, type ChatFocus, type ConversationFocus } from '../../layout/chatFocus.js';

/** The record a surface shows on its own (a record page, a record open in a list's drawer), or null. */
export function surfaceRecord(surface: ChatSurfaceContext | undefined): ChatFocus | null {
  const object = surface?.artifact?.type === 'object' ? surface.artifact.name : undefined;
  const id = surface?.selection?.kind === 'record' ? surface.selection.id : undefined;
  return object && id ? { object, id } : null;
}

/**
 * The display name of `record`, read as the user: undefined while it loads,
 * and when the record or its definition cannot be read.
 */
export function useChatRecordTitle(record: ChatFocus | null): string | undefined {
  const dataSource = useAdapter() as { findOne?: (object: string, id: string) => unknown } | null;
  const { item: objectDef } = useMetadataItem('object', record?.object ?? null);
  const object = record?.object;
  const id = record?.id;
  const key = object && id ? `${object}::${id}` : null;
  const canRead = typeof dataSource?.findOne === 'function';
  const [answer, setAnswer] = React.useState<{ key: string; row: Record<string, unknown> | null } | null>(null);

  React.useEffect(() => {
    if (!object || !id || !canRead) return;
    const asked = `${object}::${id}`;
    let cancelled = false;
    // The executor runs synchronously, so a source that THROWS lands as a rejection.
    new Promise<unknown>((resolve) => resolve(dataSource!.findOne!(object, id))).then(
      (row) => {
        if (cancelled) return;
        setAnswer({
          key: asked,
          row: row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : null,
        });
      },
      () => {
        if (!cancelled) setAnswer({ key: asked, row: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [object, id, canRead, dataSource]);

  if (!record || !answer || answer.key !== key || !answer.row || !objectDef) return undefined;
  const title = getRecordDisplayName(objectDef, answer.row, { fallback: '' });
  return title || undefined;
}

const CHIP =
  'inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground';
const CHIP_BUTTON =
  'inline-flex shrink-0 items-center justify-center rounded-full p-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export interface ChatFocusRowProps {
  /** The host's focus state for the conversation on screen. */
  focus: ConversationFocus;
  /** The page in view (`context.surface`). */
  surface?: ChatSurfaceContext;
  /** The page chip's text, as the composer draws it today; absent → no page chip. */
  surfaceLabel?: string;
  /** The page chip's tooltip (the internal `type · name` pair). */
  surfaceTitle?: string;
}

export function ChatFocusRow({ focus, surface, surfaceLabel, surfaceTitle }: ChatFocusRowProps) {
  const { t } = useObjectTranslation();
  const pinned = focus.focus;
  const pageRecord = surfaceRecord(surface);
  const offerSwitch = Boolean(pinned && pageRecord && !sameChatFocus(pinned, pageRecord) && !focus.declined);
  const pinnedTitle = useChatRecordTitle(pinned);
  const pageTitle = useChatRecordTitle(offerSwitch ? pageRecord : null);

  if (pinned) {
    const pair = `${pinned.object} · ${pinned.id}`;
    return (
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1 px-3" data-testid="chat-focus-row">
        <span className={CHIP} title={pair} data-testid="chat-focus-chip">
          <Pin className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {t('console.ai.focus.pinned', { defaultValue: 'Asking about: {{target}}', target: pinnedTitle || pair })}
          </span>
          <button
            type="button"
            className={CHIP_BUTTON}
            onClick={() => focus.setFocus(null)}
            aria-label={t('console.ai.focus.remove', { defaultValue: 'Stop asking about this record' })}
            title={t('console.ai.focus.remove', { defaultValue: 'Stop asking about this record' })}
            data-testid="chat-focus-remove"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
        {offerSwitch && pageRecord ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-[11px]" role="group" data-testid="chat-focus-switch">
            <span className="min-w-0 truncate text-muted-foreground">
              {t('console.ai.focus.switchPrompt', {
                defaultValue: 'Ask about "{{target}}" instead?',
                target: pageTitle || pageRecord.id,
              })}
            </span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
              onClick={() => focus.setFocus(pageRecord)}
              data-testid="chat-focus-switch-accept"
            >
              {t('console.ai.focus.switchAccept', { defaultValue: 'Switch' })}
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={focus.decline}
              data-testid="chat-focus-switch-decline"
            >
              {t('console.ai.focus.switchDecline', { defaultValue: 'Keep' })}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (!surfaceLabel) return null;
  return (
    <div className="flex min-w-0 flex-1 px-3" data-testid="chat-focus-row">
      <span className={CHIP} title={surfaceTitle} data-testid="surface-context-chip">
        <span className="truncate">{surfaceLabel}</span>
        {pageRecord ? (
          <button
            type="button"
            className={CHIP_BUTTON}
            onClick={() => focus.setFocus(pageRecord)}
            aria-label={t('console.ai.focus.pin', { defaultValue: 'Keep asking about this record' })}
            title={t('console.ai.focus.pin', { defaultValue: 'Keep asking about this record' })}
            data-testid="chat-focus-pin"
          >
            <Pin className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  );
}
