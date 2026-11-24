// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36999 — the conversation's FOCUS: the record a user pinned the
 * chat to, sent as `context.focus` on every turn (the spec's
 * `ToolExecutionContext.focus`) and shown as a chip in the composer.
 *
 * Three rules shape this module (topic #36996's rulings and the card's):
 *
 * - Per conversation, one record in phase 1, client-reported and advisory:
 *   never an access decision. The server re-reads the record as the caller.
 * - The request body is the authority. What is stored here only restores the
 *   chip of a conversation the host shows again (another page, the drawer
 *   closed and reopened, a reload of the tab). The stored copy is per tab
 *   (`sessionStorage`, like the drawer's own target), so the chip is never
 *   shown where the key would not also be sent.
 * - A focus rides on its conversation and never re-keys it: the dock resolves
 *   the same thread with or without one (ADR-0057 as amended for
 *   objectui#10926). The state is held by the HOST, above the pane it keys on
 *   the conversation id, so the first send — which mints that id and remounts
 *   the pane — still carries it.
 *
 * Kept free of chat code: `setChatFocus` is exported from the package root, so
 * the record drawer and the `ask_ai` action can call it from the eager console
 * graph (objectui#13410).
 */

import * as React from 'react';

/** One pinned record: the object's machine name and the record id. */
export interface ChatFocus {
  object: string;
  id: string;
}

/** A conversation's focus and whether the user declined the 「ask about this one instead?」 offer. */
export interface ChatFocusEntry {
  focus: ChatFocus | null;
  /** Remembered for the conversation: once declined, opening another record asks no more. */
  declined: boolean;
}

const EMPTY_ENTRY: ChatFocusEntry = Object.freeze({ focus: null, declined: false }) as ChatFocusEntry;

/** sessionStorage key prefix; the conversation id follows. */
export const CHAT_FOCUS_STORAGE_PREFIX = 'ai-chat-focus:';

function isChatFocus(value: unknown): value is ChatFocus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.object === 'string' && v.object !== '' && typeof v.id === 'string' && v.id !== '';
}

/** Two foci name the same record. */
export function sameChatFocus(a: ChatFocus | null | undefined, b: ChatFocus | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.object === b.object && a.id === b.id;
}

/** The stored entry of `conversationId`, or the empty one. Never throws. */
export function readStoredChatFocus(conversationId: string | undefined): ChatFocusEntry {
  if (!conversationId) return EMPTY_ENTRY;
  try {
    const raw = window.sessionStorage.getItem(`${CHAT_FOCUS_STORAGE_PREFIX}${conversationId}`);
    if (!raw) return EMPTY_ENTRY;
    const parsed = JSON.parse(raw) as { focus?: unknown; declined?: unknown };
    return { focus: isChatFocus(parsed.focus) ? parsed.focus : null, declined: parsed.declined === true };
  } catch {
    return EMPTY_ENTRY;
  }
}

function writeStoredChatFocus(conversationId: string, entry: ChatFocusEntry): void {
  try {
    const key = `${CHAT_FOCUS_STORAGE_PREFIX}${conversationId}`;
    if (!entry.focus && !entry.declined) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* private mode / quota — the chip simply is not restored */
  }
}

/**
 * The `context` keys a turn adds for the focus: `{ focus: [record] }` while
 * one is pinned AND the agent honours it, else nothing at all — so a turn
 * without a focus is byte-identical to a turn before this key existed.
 */
export function buildFocusContext(
  focus: ChatFocus | null | undefined,
  honoured: boolean,
): { focus?: ChatFocus[] } {
  return honoured && focus ? { focus: [{ object: focus.object, id: focus.id }] } : {};
}

// ── The one setter ─────────────────────────────────────────────────────────
// Every entry point pins through `setChatFocus`: the pin on the page chip, the
// record drawer and the `ask_ai` action. It applies to the chat host on
// screen; with none mounted (the drawer is closed) it waits, and the next host
// to mount takes it, so "pin, then open the drawer" lands on the drawer's
// conversation.

type ChatFocusHost = (focus: ChatFocus | null) => void;
const hosts: ChatFocusHost[] = [];
let pending: { focus: ChatFocus | null } | null = null;

/**
 * Pins `focus` to the conversation the chat shows (or clears it with `null`).
 * A new focus starts with a fresh 「ask about this one instead?」 offer.
 */
export function setChatFocus(focus: ChatFocus | null): void {
  const next = focus && isChatFocus(focus) ? { object: focus.object, id: focus.id } : null;
  const host = hosts[hosts.length - 1];
  if (host) host(next);
  else pending = { focus: next };
}

function registerChatFocusHost(host: ChatFocusHost): () => void {
  hosts.push(host);
  if (pending) {
    const { focus } = pending;
    pending = null;
    host(focus);
  }
  return () => {
    const at = hosts.lastIndexOf(host);
    if (at >= 0) hosts.splice(at, 1);
  };
}

/** Test seam: forget every host and a waiting request. */
export function resetChatFocusForTests(): void {
  hosts.length = 0;
  pending = null;
}

/** What a chat host hands its pane. */
export interface ConversationFocus extends ChatFocusEntry {
  /** Pin (or clear) the focus of the conversation on screen. */
  setFocus: (focus: ChatFocus | null) => void;
  /** Decline the offer to switch; remembered for the conversation. */
  decline: () => void;
  /**
   * The host is creating the conversation for a first send (it calls this
   * beside `ensureConversation`): the id that arrives next is the one that
   * send goes to, so a focus pinned before it is carried onto it.
   */
  markSending: () => void;
}

interface FocusState {
  key: string | undefined;
  entry: ChatFocusEntry;
  /**
   * The id that arrives next takes this conversation's focus: set by a first
   * send (`markSending`) and by a `setChatFocus` hand-off that landed before
   * the host had an id ("pin, then open the drawer"). Any other arrival of an
   * id — a resumed thread resolving, a history row, the scope blanking the id
   * between apps — reads that conversation's own stored focus instead.
   */
  carry: boolean;
}

/**
 * The focus of the conversation `conversationId` names, held by the chat
 * host. `undefined` is a conversation the host has no id for yet. A focus
 * pinned there reaches an id only on a CARRY (see {@link FocusState.carry}):
 * the first send minting it, or the setter's hand-off — and then in the same
 * render, so the first turn, sent by the pane that remounts on that id,
 * already carries it. Every other move to a conversation restores that one's
 * chip from storage.
 */
export function useConversationFocus(conversationId: string | undefined): ConversationFocus {
  const [state, setState] = React.useState<FocusState>(() => ({
    key: conversationId,
    entry: readStoredChatFocus(conversationId),
    carry: false,
  }));
  let current = state;
  if (state.key !== conversationId) {
    const carried =
      state.key === undefined && conversationId !== undefined && state.carry && state.entry.focus !== null;
    current = {
      key: conversationId,
      entry: carried ? state.entry : readStoredChatFocus(conversationId),
      carry: false,
    };
    // Derived state set during render: React re-renders before committing, so
    // no child of this commit sees the previous conversation's focus.
    setState(current);
  }
  const { key, entry } = current;

  React.useEffect(() => {
    if (key !== undefined) writeStoredChatFocus(key, entry);
  }, [key, entry]);

  const setFocus = React.useCallback((focus: ChatFocus | null) => {
    setState((s) =>
      sameChatFocus(s.entry.focus, focus) ? s : { ...s, entry: { focus, declined: false } },
    );
  }, []);
  const decline = React.useCallback(() => {
    setState((s) => (s.entry.declined ? s : { ...s, entry: { ...s.entry, declined: true } }));
  }, []);
  const markSending = React.useCallback(() => {
    setState((s) => (s.key !== undefined || s.carry ? s : { ...s, carry: true }));
  }, []);
  // The setter's hand-off: applied here, and carried onto the id the host
  // resolves next when it has none yet.
  const handOff = React.useCallback((focus: ChatFocus | null) => {
    setState((s) => ({ key: s.key, entry: { focus, declined: false }, carry: s.key === undefined }));
  }, []);

  React.useEffect(() => registerChatFocusHost(handOff), [handOff]);

  return React.useMemo(
    () => ({ focus: entry.focus, declined: entry.declined, setFocus, decline, markSending }),
    [entry, setFocus, decline, markSending],
  );
}
