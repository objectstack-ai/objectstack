// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37863 — favourite conversations. The assistant drawer's ☆ stores
 * a conversation in the user's favourites; the sidebar's Favorites section
 * lists it, and its row opens the drawer in place on that conversation, the
 * target a history row opens (ui ADR-0057 Amendment A5, row 5). Its `href` is
 * the conversation's `/ai…` address, which a page without a drawer follows.
 *
 * A favourite's label follows the conversation: the sidebar reads each shown
 * conversation favourite once per mount and keeps the label its history row
 * carries. A conversation the server answers is gone or not this user's is
 * marked unavailable for that mount (never stored), and stays removable.
 */

import * as React from 'react';
import { agentRouteName } from '@object-ui/plugin-chatbot/core';
import type { FavoriteItem } from '../context/FavoritesProvider.js';
import { readConversationRow } from '../hooks/useConversationList.js';
import { aiAddressOf, type ChatDockTarget } from './chatDockTarget.js';

/** The favourite id of conversation `conversationId`. */
export function conversationFavoriteId(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/**
 * The favourite entry of a conversation with `agent` (a route or backend
 * name), labelled `label`: what the drawer's ☆ toggles.
 */
export function conversationFavoriteItem(input: {
  conversationId: string;
  agent: string;
  label: string;
}): Omit<FavoriteItem, 'favoritedAt'> {
  const agent = agentRouteName(input.agent);
  return {
    id: conversationFavoriteId(input.conversationId),
    label: input.label,
    href: aiAddressOf({ agent, conversationId: input.conversationId }, agentRouteName),
    type: 'conversation',
    conversationId: input.conversationId,
    agent,
  };
}

/** The drawer target a conversation favourite opens; `undefined` for any other favourite. */
export function conversationFavoriteTarget(item: FavoriteItem): ChatDockTarget | undefined {
  if (item.type !== 'conversation' || !item.conversationId) return undefined;
  return item.agent
    ? { agent: item.agent, conversationId: item.conversationId }
    : { conversationId: item.conversationId };
}

/**
 * Reads each conversation favourite in `items` once per mount: a label that
 * moved on the server is written back through `refreshLabel`, and the ids the
 * server answers are gone (404) or not this user's (403) are returned. A read
 * that fails any other way marks nothing.
 */
export function useUnavailableConversationFavorites(
  items: readonly FavoriteItem[],
  apiBase: string,
  refreshLabel: (id: string, label: string) => void,
): ReadonlySet<string> {
  const [unavailable, setUnavailable] = React.useState<ReadonlySet<string>>(() => new Set());
  const refreshLabelRef = React.useRef(refreshLabel);
  React.useLayoutEffect(() => {
    refreshLabelRef.current = refreshLabel;
  }, [refreshLabel]);
  const requested = React.useRef(new Set<string>());

  const pending = items
    .filter((item) => item.type === 'conversation' && !!item.conversationId)
    .map((item) => `${item.id}\n${item.conversationId}`)
    .sort()
    .join('\n\n');

  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!pending) return;
    for (const pair of pending.split('\n\n')) {
      const [id, conversationId] = pair.split('\n');
      const key = `${apiBase}\n${id}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      readConversationRow(apiBase, conversationId).then(
        (row) => {
          if (!mounted.current) return;
          if (row === null) {
            setUnavailable((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
            return;
          }
          const label = row.title || row.preview;
          if (label) refreshLabelRef.current(id, label);
        },
        () => {
          requested.current.delete(key);
        },
      );
    }
  }, [pending, apiBase]);

  return unavailable;
}
