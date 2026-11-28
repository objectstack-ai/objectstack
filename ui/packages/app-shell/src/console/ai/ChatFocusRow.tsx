// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36999 / objectstack#37861 — the composer's context chip while
 * the agent honours a conversation focus (`capabilities.focus` on its catalog
 * row), drawn inside the input's frame at the start of the line.
 *
 * Framework ADR-0160 D6 (seventh amendment): with a focus, the chip names the
 * record (the object's icon and the record's name) with × to remove it; ×
 * shows while the composer has focus or the pointer is over the chip, and
 * always on a touch screen. Without a focus — a list or a dashboard, a
 * conversation sent without one, or after × — it is the page chip
 * 「正在看：X」 (`console.ai.discussing`), with no ×. There is no pin and no
 * offer to switch records: an unsent conversation follows the page on its
 * own, and a sent one keeps the record it was sent with.
 *
 * The record's name is read client-side, as the user: the object definition
 * and one `findOne`, through the same seams the record page reads with. Until
 * that answers, the label the conversation's metadata stored stands in; a
 * record the user cannot read keeps its `object · id` pair.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { ObjectIconTile } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useMetadataItem } from '@object-ui/react';
import { useAdapter } from '../../providers/AdapterProvider.js';
import { getRecordDisplayName } from '../../utils/index.js';
import type { ChatFocus, ConversationFocus } from '../../layout/chatFocus.js';

/** What the chip shows of a record: its display name and its object's icon and colour. */
export interface ChatRecordFace {
  /** The display name, undefined while it loads and when the record or its definition cannot be read. */
  title?: string;
  icon?: string;
  color?: string;
}

/** The face of `record`, read as the user. */
export function useChatRecordFace(record: ChatFocus | null): ChatRecordFace {
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

  const def = record ? (objectDef as { icon?: unknown; color?: unknown } | undefined) : undefined;
  const icon = typeof def?.icon === 'string' ? def.icon : undefined;
  const color = typeof def?.color === 'string' ? def.color : undefined;
  if (!record || !answer || answer.key !== key || !answer.row || !objectDef) return { icon, color };
  const title = getRecordDisplayName(objectDef, answer.row, { fallback: '' });
  return { title: title || undefined, icon, color };
}

const CHIP =
  'group/focus-chip inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-muted/40 py-0.5 text-[11px] text-muted-foreground';
/**
 * × — a 24px hit area around a 12px glyph (WCAG 2.5.8). Revealed while the
 * pointer is over the chip, while anything in the composer has focus (the
 * frame is the `group/input-group`), on its own keyboard focus, and always on
 * a coarse pointer, where there is no hover.
 */
const REMOVE =
  '-my-1 -me-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/focus-chip:opacity-100 group-focus-within/input-group:opacity-100 pointer-coarse:opacity-100';

export interface ChatFocusRowProps {
  /** The host's focus state for the conversation on screen. */
  focus: ConversationFocus;
  /** The page chip's text, as the composer draws it today; absent → no page chip. */
  surfaceLabel?: string;
  /** The page chip's tooltip (the internal `type · name` pair). */
  surfaceTitle?: string;
}

export function ChatFocusRow({ focus, surfaceLabel, surfaceTitle }: ChatFocusRowProps) {
  const { t } = useObjectTranslation();
  const record = focus.focus;
  const face = useChatRecordFace(record);

  if (record) {
    const pair = `${record.object} · ${record.id}`;
    const name = face.title || focus.label || pair;
    const described = t('console.ai.focus.pinned', { defaultValue: 'Asking about: {{target}}', target: name });
    return (
      <span
        className={`${CHIP} ps-1 pe-2`}
        role="group"
        aria-label={described}
        title={`${described} (${pair})`}
        data-testid="chat-focus-chip"
        data-focus-object={record.object}
        data-focus-id={record.id}
      >
        <ObjectIconTile icon={face.icon} color={face.color} size="xs" className="shrink-0" />
        <span className="truncate text-foreground/90" data-testid="chat-focus-name">
          {name}
        </span>
        <button
          type="button"
          className={REMOVE}
          onClick={focus.dismiss}
          aria-label={t('console.ai.focus.remove', { defaultValue: 'Stop asking about this record' })}
          title={t('console.ai.focus.remove', { defaultValue: 'Stop asking about this record' })}
          data-testid="chat-focus-remove"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </span>
    );
  }

  if (!surfaceLabel) return null;
  return (
    <span className={`${CHIP} px-2`} title={surfaceTitle} data-testid="surface-context-chip">
      <span className="truncate">{surfaceLabel}</span>
    </span>
  );
}
