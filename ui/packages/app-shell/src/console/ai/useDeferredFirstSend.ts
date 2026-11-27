// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The first send across `<ChatPane>`'s id-keyed remount: the held first
 * message and its replay, and the composer draft hand-off. Split out of
 * `AiChatPage.tsx` move-only (objectstack#37730).
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** A composer submission held until the conversation id that will carry it exists. */
export interface PendingFirstMessage {
  content: string;
  files?: File[];
  /**
   * #2450 — the agent surface this stash is FOR (e.g. `'build'` for the
   * ADR-0057 handoff seed). The replay refuses to consume it in a pane bound to
   * a different agent, so a stash targeted at the Builder can never be eaten by
   * (and die in) an ask-surface pane mid route-transition. Absent = untargeted
   * (a user-typed first send), consumed by whichever pane replays first —
   * unchanged behavior.
   */
  targetAgentRoute?: string;
}

/**
 * Guards the empty-state FIRST send against the conversation-id remount race.
 *
 * On a fresh `/ai/:agent` the composer (and its suggestion chips) go live the
 * instant the agent resolves — BEFORE `POST /conversations` has minted the id.
 * `<ChatPane>` is keyed on that id (`…:pending` → `…:<id>`), so the moment it
 * resolves React UNMOUNTS the pane and mounts a fresh one. A first message
 * submitted in that window lives inside the doomed pane: its optimistic bubble
 * is discarded and the just-started `…/chat` request is aborted before it
 * reaches the wire — so it vanishes silently (input cleared, no bubble, no
 * error). Distinct from the #2047 path, where `…/chat` WAS sent and failed.
 *
 * The fix: when we have a server endpoint but no id yet, stash the send in a ref
 * the PAGE owns (so it outlives the pane remount) and replay it the moment an id
 * exists — in the freshly-mounted pane (or in place if no remount happened). A
 * send made once the id is present (the normal path, and every send after the
 * first) goes straight through. Local/echo mode (no `chatApi`) also sends
 * immediately, so the offline-demo bot keeps responding.
 *
 * Exported for unit testing.
 */
/** Two attachments are one file when they are the same object, or agree on name, size, type and lastModified. */
function isSameFile(a: File, b: File): boolean {
  return (
    a === b ||
    (a.name === b.name && a.size === b.size && a.type === b.type && a.lastModified === b.lastModified)
  );
}

/**
 * objectstack#32984 — is this submit a repeat of the held first message? The
 * same text and the same files, file for file; anything that differs joins.
 */
function isSameFirstSend(held: PendingFirstMessage, content: string, files?: File[]): boolean {
  const a = held.files ?? [];
  const b = files ?? [];
  return content === held.content && a.length === b.length && a.every((f, i) => isSameFile(f, b[i]));
}

export function useDeferredFirstSend(opts: {
  /** The chat endpoint — defined once an agent is resolved (server-backed mode). */
  chatApi: string | undefined;
  /** The conversation id; undefined while `POST /conversations` is in flight. */
  conversationId: string | undefined;
  /** Page-owned stash that OUTLIVES the keyed `<ChatPane>` remount. */
  pendingRef: React.MutableRefObject<PendingFirstMessage | null>;
  /** The real send (resetSuppression + sendMessage + onSent). */
  doSend: (content: string, files?: File[]) => void;
  /**
   * Bumped by the PAGE whenever it sets `pendingRef` out of band (the ADR-0057
   * handoff seed). Refs don't trigger effects, so without this the replay only
   * re-runs on id / doSend changes — and a seed that lands AFTER the id resolves
   * (the async agent-catalog race) would never fire (the swallow). Listing it in
   * the replay deps makes the seed reliably replay.
   */
  pendingSignal?: number;
  /**
   * #2450 — the agent surface THIS pane is bound to (route name, e.g.
   * `'build'`). A pending message stamped with a `targetAgentRoute` is only
   * consumed when it matches; a mismatched pane HOLDS the stash untouched so
   * the correctly-bound pane can replay it after the route transition settles.
   */
  agentRoute?: string;
  /**
   * objectstack#32031 — creates the conversation on the first send
   * (`useChatConversation().ensureConversation`). The host no longer mints a
   * row on mount, so a stash with no id ASKS for one: from the send itself,
   * and from the replay effect for a stash seeded out of band (the handoff).
   * Idempotent on the host side, so calling it again while the create is on
   * the wire makes no second row. Absent = wait for an id someone else makes.
   */
  ensureConversation?: () => unknown;
  /**
   * objectstack#33420 — told which message the user sent is waiting in the
   * stash (`null` once it is replayed or rolled back), so the pane draws it at
   * once. A stash targeted at an agent surface (the handoff seed) is not one
   * the user sent here, and is never reported. Also called on mount with the
   * stash a replaced pane left behind, so the message stays drawn across the
   * id-keyed remount.
   */
  onHeldChange?: (held: PendingFirstMessage | null) => void;
  /**
   * objectstack#33420 — the host's create failure (`useChatConversation`'s
   * `createError`). A new one drops the user's held message: it was never
   * sent, and the composer puts its text back in the box (the not-sent
   * rollback), so keeping it would send it twice with the next attempt.
   * objectstack#33562 — the box gets the whole held message, joined parts
   * included: the pane hands it to the composer as its `unsentText`.
   */
  createError?: Error;
}): (content: string, files?: File[]) => void {
  const { chatApi, conversationId, pendingRef, doSend, pendingSignal, agentRoute, ensureConversation, onHeldChange, createError } = opts;
  const apiMode = Boolean(chatApi);
  // Read through a ref: the replay effect must not re-run (or depend for
  // correctness) on the identity of a host callback — ui/AGENTS.md #10. Synced
  // in a layout effect, which runs before the replay effect below.
  const ensureConversationRef = useRef(ensureConversation);
  const onHeldChangeRef = useRef(onHeldChange);
  useLayoutEffect(() => {
    ensureConversationRef.current = ensureConversation;
    onHeldChangeRef.current = onHeldChange;
  }, [ensureConversation, onHeldChange]);
  // Only a committed pane is told: a send can reach a render React has not
  // committed (or has thrown away), and a state update there loses the render
  // the stash belongs to. The mount report below covers that pane once it commits.
  const committedRef = useRef(false);
  useLayoutEffect(() => {
    committedRef.current = true;
    return () => {
      committedRef.current = false;
    };
  }, []);
  const reportHeld = useCallback(() => {
    if (!committedRef.current) return;
    const held = pendingRef.current;
    onHeldChangeRef.current?.(held && !held.targetAgentRoute ? held : null);
  }, [pendingRef]);

  // A message held over from the pane this one replaced is drawn before the
  // first paint, so the id-keyed remount never shows an empty thread.
  useLayoutEffect(() => {
    if (apiMode && pendingRef.current) reportHeld();
  }, [apiMode, pendingRef, reportHeld]);

  // The create failed: the user's held message goes (its text is restored to
  // the composer by the host's not-sent rollback). A handoff seed is kept.
  useEffect(() => {
    if (!createError) return;
    const held = pendingRef.current;
    if (!held || held.targetAgentRoute) return;
    pendingRef.current = null;
    onHeldChangeRef.current?.(null);
  }, [createError, pendingRef]);

  // Replay a deferred first message the instant a conversation id exists — in
  // the freshly-mounted pane after the remount, or in place if none happened.
  // Clearing the ref before sending makes the replay fire at most once even
  // though `doSend` (and StrictMode's double-invoke) re-run this effect.
  useEffect(() => {
    if (!apiMode) return;
    const pending = pendingRef.current;
    if (!pending) return;
    // #2450 — a targeted stash (the handoff seed) must not be consumed by a
    // pane bound to another agent: mid ask→build transition a doomed pane can
    // replay first, and a send issued there dies with its unmount before it
    // reaches the wire. Hold the stash; the matching pane replays it.
    if (pending.targetAgentRoute && pending.targetAgentRoute !== agentRoute) return;
    // objectstack#32031 — no id yet: this stash is the first send, so ask the
    // host to create the conversation (covers a stash seeded out of band, which
    // never passed through the send callback below). Its id re-runs this effect.
    if (!conversationId) {
      void ensureConversationRef.current?.();
      return;
    }
    // objectstack#32031 — replay on the next task, never inside this effect.
    // The chat runtime stops its in-flight request when the pane's effects are
    // torn down (`useChat`'s cleanup calls `chat.stop()`), and React tears them
    // down right after this first run whenever it re-runs effects on mount
    // (StrictMode, i.e. every dev build) — so a send issued here was aborted
    // before it reached the wire and the first message vanished. That only
    // happened in the old race window; with the row created by the first send
    // it would be every first message. The timer is cleared with the effect,
    // so the replay fires once, from the pane whose effects stayed up; a pane
    // unmounted for real leaves the stash for the next one.
    const timer = setTimeout(() => {
      if (pendingRef.current !== pending) return;
      pendingRef.current = null;
      onHeldChangeRef.current?.(null);
      doSend(pending.content, pending.files);
    }, 0);
    return () => clearTimeout(timer);
  }, [apiMode, conversationId, pendingRef, doSend, pendingSignal, agentRoute]);

  return useCallback(
    (content: string, files?: File[]) => {
      // Server-backed, but the id is still being minted: sending now would be
      // lost — a convId-less `/chat` the server won't persist, or a request torn
      // down when the pane remounts as the id resolves. Stash it; the effect
      // above replays it once the id lands.
      if (apiMode && !conversationId) {
        // objectstack#32031 — the first send is now what creates the
        // conversation, so the create is on the wire for a moment after every
        // first send. A second submit inside that moment must not replace the
        // first message (it would be lost); the first one stands and is
        // replayed once the id lands, and the host's create is shared, so no
        // second row is made either. (A held handoff seed is still replaced
        // by what the user typed, as before.)
        // objectstack#32984 — nor may the second one vanish: it used to be
        // dropped without a word. It joins the held first message, which has
        // not left the client yet, so both reach the agent as the first turn.
        // A repeat of the held message (a doubled submit event: the same
        // text AND the same files) is not sent twice.
        const held = pendingRef.current;
        if (!held || held.targetAgentRoute) pendingRef.current = { content, files };
        else if (!isSameFirstSend(held, content, files)) {
          const heldFiles = held.files ?? [];
          const joined = [
            ...heldFiles,
            ...(files ?? []).filter((f) => !heldFiles.some((h) => isSameFile(h, f))),
          ];
          pendingRef.current = {
            content: [held.content, content].filter((part) => part.trim() !== '').join('\n\n'),
            files: joined.length > 0 ? joined : undefined,
          };
        }
        reportHeld();
        void ensureConversationRef.current?.();
        return;
      }
      doSend(content, files);
    },
    [apiMode, conversationId, pendingRef, doSend, reportHeld],
  );
}

/** Composer text a `…:pending` pane hands to the pane that replaces it. */
interface ComposerDraftHandoff {
  text: string;
  /** The chat endpoint the text was typed for. */
  chatApi: string | undefined;
  /** The conversation the host was asking for when the text was last typed. */
  requestedConversationId: string | undefined;
  /** The replaced box had focus, so typing goes on in the new one. */
  focused: boolean;
}

/**
 * Keyed by the host's page-owned first-message stash: the one object a host
 * keeps across the pane's id-keyed remount, and its own, so two hosts never
 * trade drafts. An entry lives for one commit only (see
 * {@link useComposerDraftHandoff}).
 */
const composerDraftHandoffs = new WeakMap<object, ComposerDraftHandoff>();

/**
 * objectstack#33674 — the text typed (and not sent) into the composer of a
 * pane that does not know its conversation yet survives the remount that
 * follows when the id lands: the conversation GET of a deep link answering, or
 * the create of a new conversation answering. `<ChatPane>` stays keyed on the
 * id, because everything else in it (the chat runtime, its messages) belongs
 * to one conversation; only the composer's text is carried.
 *
 * The replaced pane writes the text as it unmounts and the new pane reads it
 * as it mounts. React runs both in the same commit, so the hand-off is never
 * read later: a microtask drops an entry no pane took. Only a pending pane
 * hands text on, and only to a pane on the same endpoint whose host still asks
 * for the conversation it asked for when the text was last typed, so opening
 * another conversation leaves the draft behind, as before. The new box gets
 * the same text with the cursor at its end, and focus when the old box had it.
 * Nothing is sent.
 *
 * Returns the composer's `onInputChange`, which records what the host was
 * asking for when the user typed.
 */
export function useComposerDraftHandoff(opts: {
  /** The host's page-owned stash (`pendingFirstMessageRef`), the hand-off's key. */
  hostStash: object;
  /** The pane's root element; the composer is the `message` textarea inside it. */
  containerRef: React.RefObject<HTMLElement | null>;
  chatApi: string | undefined;
  conversationId: string | undefined;
  /** The conversation the host asks `useChatConversation` for (its `activeId`). */
  requestedConversationId: string | undefined;
}): () => void {
  const { hostStash, containerRef, chatApi, conversationId, requestedConversationId } = opts;
  const requestedRef = useRef(requestedConversationId);
  const typedForRef = useRef(requestedConversationId);
  useLayoutEffect(() => {
    requestedRef.current = requestedConversationId;
  }, [requestedConversationId]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const composerBox = () => container?.querySelector<HTMLTextAreaElement>('textarea[name="message"]') ?? null;
    const handoff = composerDraftHandoffs.get(hostStash);
    composerDraftHandoffs.delete(hostStash);
    if (
      handoff &&
      conversationId &&
      handoff.chatApi === chatApi &&
      handoff.requestedConversationId === requestedRef.current
    ) {
      const box = composerBox();
      if (box && box.value === '') {
        box.value = handoff.text;
        box.setSelectionRange(handoff.text.length, handoff.text.length);
        if (handoff.focused) box.focus();
      }
    }
    return () => {
      if (conversationId) return;
      const box = composerBox();
      if (!box || box.value.trim() === '') return;
      const entry: ComposerDraftHandoff = {
        text: box.value,
        chatApi,
        requestedConversationId: typedForRef.current,
        focused: box.ownerDocument.activeElement === box,
      };
      composerDraftHandoffs.set(hostStash, entry);
      queueMicrotask(() => {
        if (composerDraftHandoffs.get(hostStash) === entry) composerDraftHandoffs.delete(hostStash);
      });
    };
  }, [hostStash, containerRef, chatApi, conversationId]);
  return useCallback(() => {
    typedForRef.current = requestedRef.current;
  }, []);
}
