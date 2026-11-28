// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36999 — the conversation's FOCUS: the record a conversation is
 * about, sent as `context.focus` on every turn (the spec's
 * `ToolExecutionContext.focus`) and shown as a chip in the composer.
 *
 * objectstack#37861 (framework ADR-0160 D6, seventh amendment, "The focus of a
 * conversation") — a conversation's state is `{ focus, dismissed }`:
 *
 * - **Before the first send, the focus is the record on the page** (the
 *   console's `surfaceRecord()`), unless the user removed it with ×
 *   (`dismissed`). It follows the page with no prompt: another record is that
 *   record, a page with no record is no focus.
 * - **× removes it.** Nothing adds a focus to that conversation again.
 * - **The first send fixes both.** The focus the conversation has at its first
 *   send rides that turn and every later one; navigation no longer moves it.
 *   After the first send × is the one change left.
 *
 * Three rules from topic #36996 still shape this module:
 *
 * - One record per conversation in phase 1, client-reported and advisory:
 *   never an access decision. The server re-reads the record as the caller.
 * - The request body is the authority. What is stored only restores the chip
 *   of a conversation the host shows again: this tab's copy (`sessionStorage`,
 *   like the drawer's own target) and, for a conversation this tab never held
 *   (another tab, a history row), the conversation's own `metadata.focus`,
 *   which the in-app assistant writes from the turns it served.
 * - A focus rides on its conversation and never re-keys it: the dock resolves
 *   the same thread with or without one (ADR-0057 as amended for
 *   objectui#10926). The state is held by the HOST, above the pane it keys on
 *   the conversation id, so the first send — which mints that id and remounts
 *   the pane — still carries it.
 */

import * as React from 'react';
import type { ChatSurfaceContext } from './chatSurfaceContext.js';

/** One focused record: the object's machine name and the record id. */
export interface ChatFocus {
  object: string;
  id: string;
}

/** A conversation's stored focus state (ADR-0160 D6, seventh amendment). */
export interface ChatFocusEntry {
  focus: ChatFocus | null;
  /** The user removed the focus with ×: nothing adds one to this conversation again. */
  dismissed: boolean;
}

const EMPTY_ENTRY: ChatFocusEntry = Object.freeze({ focus: null, dismissed: false }) as ChatFocusEntry;

/** sessionStorage key prefix; the conversation id follows. */
export const CHAT_FOCUS_STORAGE_PREFIX = 'ai-chat-focus:';

function isChatFocus(value: unknown): value is ChatFocus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.object === 'string' && v.object !== '' && typeof v.id === 'string' && v.id !== '';
}

/**
 * The record a surface shows on its own (a record page, a record open in a
 * list's drawer), or null: a list or a dashboard has none. An unsent
 * conversation's focus (ADR-0160 D6, seventh amendment).
 */
export function surfaceRecord(surface: ChatSurfaceContext | undefined): ChatFocus | null {
  const object = surface?.artifact?.type === 'object' ? surface.artifact.name : undefined;
  const id = surface?.selection?.kind === 'record' ? surface.selection.id : undefined;
  return object && id ? { object, id } : null;
}

/** Two foci name the same record. */
export function sameChatFocus(a: ChatFocus | null | undefined, b: ChatFocus | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.object === b.object && a.id === b.id;
}

/** A conversation's focus as its `metadata.focus` carries it, with the record's label when the server read one. */
export interface ChatFocusFromMetadata extends ChatFocus {
  label?: string;
}

/**
 * The focus a conversation's `metadata` records, or null. The in-app
 * assistant stores `focus` in the shape the request sends (`context.focus`):
 * an array whose first entry is the record, with an optional display `label`.
 * It deletes the key when a turn carries no focus. Anything else (a bare
 * object, an entry without a string `object` and `id`) reads as no focus.
 */
export function chatFocusFromMetadata(metadata: Readonly<Record<string, unknown>> | undefined): ChatFocusFromMetadata | null {
  const raw = metadata?.focus;
  if (!Array.isArray(raw)) return null;
  const first: unknown = raw[0];
  if (!isChatFocus(first)) return null;
  const label = (first as { label?: unknown }).label;
  return {
    object: first.object,
    id: first.id,
    ...(typeof label === 'string' && label.trim() !== '' ? { label: label.trim() } : {}),
  };
}

/** The stored entry of `conversationId` in this tab, or null when there is none. Never throws. */
function readStoredEntry(conversationId: string | undefined): ChatFocusEntry | null {
  if (!conversationId) return null;
  try {
    const raw = window.sessionStorage.getItem(`${CHAT_FOCUS_STORAGE_PREFIX}${conversationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { focus?: unknown; dismissed?: unknown };
    const focus = isChatFocus(parsed.focus) ? { object: parsed.focus.object, id: parsed.focus.id } : null;
    const dismissed = parsed.dismissed === true;
    return focus || dismissed ? { focus, dismissed } : null;
  } catch {
    return null;
  }
}

/** The stored entry of `conversationId` in this tab, or the empty one. Never throws. */
export function readStoredChatFocus(conversationId: string | undefined): ChatFocusEntry {
  return readStoredEntry(conversationId) ?? EMPTY_ENTRY;
}

function writeStoredChatFocus(conversationId: string, entry: ChatFocusEntry): void {
  try {
    const key = `${CHAT_FOCUS_STORAGE_PREFIX}${conversationId}`;
    if (!entry.focus && !entry.dismissed) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* private mode / quota — the chip is restored from the conversation's metadata, or not at all */
  }
}

/**
 * The `context` keys a turn adds for the focus: `{ focus: [record] }` while
 * the conversation has one AND the agent honours it, else nothing at all — so
 * a turn without a focus is byte-identical to a turn before this key existed.
 */
export function buildFocusContext(
  focus: ChatFocus | null | undefined,
  honoured: boolean,
): { focus?: ChatFocus[] } {
  return honoured && focus ? { focus: [{ object: focus.object, id: focus.id }] } : {};
}

/** What a chat host hands its pane. */
export interface ConversationFocus {
  /** The conversation's focus now: the page's record while it has sent nothing (unless dismissed), else the one it was sent with. */
  focus: ChatFocus | null;
  /** The user removed the focus with ×. */
  dismissed: boolean;
  /** The conversation has sent nothing yet, so its focus follows the page. */
  unsent: boolean;
  /** The record's display name as the conversation's metadata stored it, when the chip was restored from there. */
  label?: string;
  /** × on the focus chip: clears the focus and sets `dismissed`. */
  dismiss: () => void;
  /**
   * The host is creating the conversation for a first send (it calls this
   * beside `ensureConversation`, and only while it has a user to create it
   * for): the id that create mints takes the focus the conversation had at
   * this moment. Only that id: one the host resolves or is handed instead (a
   * found thread the send joins, a history row) restores its own. A create
   * that fails spends the mark (see the hook's `createError`), and so does
   * another target while unsent.
   */
  markSending: () => void;
}

interface FocusState {
  /** The conversation the state is for; `undefined` is one with no id yet (unsent). */
  key: string | undefined;
  /** A sent conversation's entry; for an unsent one only `dismissed` is read. */
  entry: ChatFocusEntry;
  /** The metadata label of a focus restored from the conversation's metadata. */
  label?: string;
  /** What the host was asked to show when the state last moved (see `origin`). */
  origin: string | undefined;
  /**
   * How many times another target started another unsent conversation. A
   * first-send mark is good only for the unsent conversation it was made in.
   */
  epoch: number;
}

/** A first send's mark: the entry it fixes, for the unsent conversation it was made in. */
interface SendingMark {
  entry: ChatFocusEntry;
  epoch: number;
}

/** The entry a conversation the host arrives at restores: this tab's copy, else its metadata's. */
function restoredState(
  key: string | undefined,
  origin: string | undefined,
  fromMetadata: ChatFocusFromMetadata | null,
  epoch: number,
): FocusState {
  const stored = readStoredEntry(key);
  if (stored) return { key, entry: stored, origin, epoch };
  if (key !== undefined && fromMetadata) {
    return {
      key,
      entry: { focus: { object: fromMetadata.object, id: fromMetadata.id }, dismissed: false },
      label: fromMetadata.label,
      origin,
      epoch,
    };
  }
  return { key, entry: EMPTY_ENTRY, origin, epoch };
}

/**
 * The state the host's props move `state` to. `undefined` → the id the first
 * send's own create minted (`createdId`) takes the mark `sending` holds, when
 * that mark was made in this unsent conversation. Every other arrival of an
 * id restores that conversation's own entry: a thread the resolve found, which
 * a send made during the resolve joins, and a history row opened while the
 * create was on the wire, keep the focus they were fixed on.
 */
function nextFocusState(
  state: FocusState,
  conversationId: string | undefined,
  origin: string | undefined,
  fromMetadata: ChatFocusFromMetadata | null,
  createdId: string | undefined,
  sending: { readonly current: SendingMark | null },
): FocusState {
  if (state.key !== conversationId) {
    const mark =
      state.key === undefined && conversationId !== undefined && conversationId === createdId
        ? sending.current
        : null;
    return mark && mark.epoch === state.epoch
      ? { key: conversationId, entry: mark.entry, origin, epoch: state.epoch }
      : restoredState(conversationId, origin, fromMetadata, state.epoch);
  }
  if (state.origin !== origin) {
    // Another target while unsent is another conversation: × on the last one
    // does not carry over, nor does a first send's mark. A sent conversation
    // keeps its own entry.
    return state.key === undefined
      ? { key: undefined, entry: EMPTY_ENTRY, origin, epoch: state.epoch + 1 }
      : { ...state, origin };
  }
  if (
    state.key !== undefined &&
    fromMetadata &&
    !state.entry.focus &&
    !state.entry.dismissed &&
    readStoredEntry(state.key) === null
  ) {
    // The conversation's row arrived after its id: its metadata restores the
    // chip this tab never held.
    return restoredState(state.key, origin, fromMetadata, state.epoch);
  }
  return state;
}

/**
 * The focus of the conversation `conversationId` names, held by the chat
 * host. `undefined` is a conversation the host has no id for yet: it has sent
 * nothing, so its focus is `pageRecord` unless the user dismissed it. The
 * first send fixes that focus onto the id its create mints (`createdId`), in
 * the same render, so the first turn, sent by the pane that remounts on that
 * id, already carries it.
 * Every other arrival of an id (a resumed thread resolving, a history row, the
 * scope blanking the id between apps) restores that conversation's own focus:
 * this tab's stored copy, else `metadata.focus` from the conversation's row.
 */
export function useConversationFocus(
  conversationId: string | undefined,
  /** The host's `createError`: a first send whose create failed minted nothing. */
  createError?: unknown,
  /** The record on the page in view (`surfaceRecord()`), or null on a page that shows no one record. */
  pageRecord?: ChatFocus | null,
  /** The `metadata` of the conversation `conversationId` names, as its row returned it. */
  conversationMetadata?: Readonly<Record<string, unknown>>,
  /**
   * A key of what the host was asked to show (the dock's target). While the
   * conversation is unsent, a change starts another one: its `dismissed` is
   * dropped. A host that passes none keeps it until an id arrives.
   */
  origin?: string,
  /**
   * The id of the row the host's own create minted last
   * (`useChatConversation().createdConversationId`): the one id a first
   * send's mark goes to.
   */
  createdId?: string,
): ConversationFocus {
  const fromMetadata = React.useMemo(() => chatFocusFromMetadata(conversationMetadata), [conversationMetadata]);
  const [state, setState] = React.useState<FocusState>(() => restoredState(conversationId, origin, fromMetadata, 0));
  // The focus a first send in flight fixes: a ref, not state, so marking it
  // re-renders nothing while the pane holds the message it is creating the
  // row for.
  const sendingRef = React.useRef<SendingMark | null>(null);
  const current = nextFocusState(state, conversationId, origin, fromMetadata, createdId, sendingRef);
  // Derived state set during render: React re-renders before committing, so
  // no child of this commit sees the previous conversation's focus.
  if (current !== state) setState(current);
  const { key, entry, label, epoch } = current;

  React.useEffect(() => {
    if (key !== undefined) writeStoredChatFocus(key, entry);
  }, [key, entry]);
  // The send's id has arrived (or another one did): the mark is spent.
  React.useEffect(() => {
    if (key !== undefined) sendingRef.current = null;
  }, [key]);
  // The send's create failed: no id is coming for it, so the mark is spent
  // and the next id to arrive (a history row) restores its own focus. A send
  // made while the host is still resolving is not spent: a resolve that
  // settles on nothing creates the row, whose id takes it; one that finds a
  // thread hands an id no create minted, which keeps its own.
  React.useEffect(() => {
    if (createError) sendingRef.current = null;
  }, [createError]);

  const unsent = key === undefined;
  const page = pageRecord && isChatFocus(pageRecord) ? pageRecord : null;
  const pageObject = page?.object;
  const pageId = page?.id;
  const effective = React.useMemo<ChatFocus | null>(() => {
    if (!unsent) return entry.focus;
    if (entry.dismissed || !pageObject || !pageId) return null;
    return { object: pageObject, id: pageId };
  }, [unsent, entry, pageObject, pageId]);
  // What the conversation has as of this commit, for `markSending`, which runs
  // in an event or a child's effect after it. An insertion effect runs before
  // every layout and passive effect of the commit, the children's included.
  const effectiveRef = React.useRef<SendingMark>({ entry: EMPTY_ENTRY, epoch: 0 });
  React.useInsertionEffect(() => {
    effectiveRef.current = { entry: { focus: effective, dismissed: entry.dismissed }, epoch };
  }, [effective, entry.dismissed, epoch]);

  const dismiss = React.useCallback(() => {
    setState((s) => (s.entry.dismissed && !s.entry.focus ? s : { ...s, entry: { focus: null, dismissed: true }, label: undefined }));
  }, []);
  const markSending = React.useCallback(() => {
    const { entry: now, epoch: madeIn } = effectiveRef.current;
    sendingRef.current = { entry: { ...now }, epoch: madeIn };
  }, []);

  return React.useMemo(
    () => ({
      focus: effective,
      dismissed: entry.dismissed,
      unsent,
      ...(label && effective ? { label } : {}),
      dismiss,
      markSending,
    }),
    [effective, entry.dismissed, unsent, label, dismiss, markSending],
  );
}
