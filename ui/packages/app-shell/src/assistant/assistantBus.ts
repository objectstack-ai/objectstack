// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Assistant bus — a tiny framework-agnostic singleton that connects the
 * metadata designers to the global AI chat (`ConsoleFloatingChatbot`).
 *
 * Two channels:
 *   1. **Editor context** — a designer publishes *what the user is
 *      currently editing* (`{ type, name, label, fields }`). The chatbot
 *      reads it and merges it into the `context` it sends the agent, so
 *      "add a priority field" acts on the open object without the user
 *      restating which object they mean.
 *   2. **Open signal** — a designer can ask the global chat to open (e.g.
 *      an "Ask AI" button). The lazy chat FAB arms + opens on the signal.
 *
 * Why a singleton bus instead of React context? The chat FAB is
 * lazy-mounted on a different branch of the tree from the designers, and
 * the open-signal must cross that boundary without a shared Provider
 * being threaded through every layout. A module singleton + (subscribe,
 * getSnapshot) reads cleanly via `useSyncExternalStore`.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@object-ui/auth';

export interface AssistantEditorField {
  name: string;
  type?: string;
  label?: string;
  required?: boolean;
}

export interface AssistantEditorContext {
  /** Metadata type, e.g. 'object'. */
  type: string;
  /** Item primary-key name (may be empty in create mode). */
  name: string;
  label?: string;
  /** Lightweight field summary — enough for the agent to reason, not the full draft. */
  fields?: AssistantEditorField[];
}

/** A metadata item the chat has asked the host to open in review/diff. */
export interface AssistantReviewTarget {
  type: string;
  name: string;
}

export interface AssistantSnapshot {
  /** What the user is currently editing, or null when no designer is active. */
  editor: AssistantEditorContext | null;
  /** Monotonic counter — bumped each time a surface requests the chat to open. */
  openSeq: number;
  /**
   * Monotonic counter — bumped each time the chat asks the host to open a
   * drafted item in review (ADR-0033 Phase B). The host (which knows the app
   * base) watches this and navigates to the designer.
   */
  reviewSeq: number;
  /** The item to review, set alongside the latest `reviewSeq` bump. */
  reviewTarget: AssistantReviewTarget | null;
}

let editor: AssistantEditorContext | null = null;
let openSeq = 0;
let reviewSeq = 0;
let reviewTarget: AssistantReviewTarget | null = null;
// Cached snapshot — its reference only changes on a real state change so
// useSyncExternalStore doesn't loop.
let snapshot: AssistantSnapshot = { editor, openSeq, reviewSeq, reviewTarget };

const listeners = new Set<() => void>();

function commit(): void {
  snapshot = { editor, openSeq, reviewSeq, reviewTarget };
  for (const l of listeners) l();
}

function sameEditor(a: AssistantEditorContext | null, b: AssistantEditorContext | null): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export const assistantBus = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): AssistantSnapshot {
    return snapshot;
  },
  /** Publish the currently-edited item (or null to clear). No-op if unchanged. */
  setEditor(next: AssistantEditorContext | null): void {
    if (sameEditor(editor, next)) return;
    editor = next;
    commit();
  },
  /** Ask the global chat to open (and warm/mount the lazy FAB). */
  requestOpen(): void {
    openSeq += 1;
    commit();
  },
  /**
   * Ask the host to open `target` in the designer's review/diff (ADR-0033
   * Phase B). The chat calls this from the "Review N change(s)" affordance;
   * a navigator that knows the app base performs the routing.
   */
  requestReview(target: AssistantReviewTarget): void {
    reviewSeq += 1;
    reviewTarget = target;
    commit();
  },
};

// ── ADR-0037 P2.5 — canvas invalidations ───────────────────────────────────
// The chat announces "this draft artifact just changed"; preview surfaces in
// the SAME document (a page open on ?preview=draft while the floating chat
// edits) subscribe and refetch the affected type. Kept OFF the snapshot bus:
// invalidations are fire-and-forget events, not state — putting them in the
// snapshot would re-render every useAssistant consumer per artifact.

export interface CanvasInvalidation {
  type: string;
  name: string;
}

const invalidateListeners = new Set<(inv: CanvasInvalidation) => void>();

/** Announce that a draft artifact changed (chat hosts call this). */
export function emitCanvasInvalidate(inv: CanvasInvalidation): void {
  for (const l of invalidateListeners) l(inv);
}

/** Subscribe to draft-artifact invalidations; returns an unsubscriber. */
export function subscribeCanvasInvalidate(
  listener: (inv: CanvasInvalidation) => void,
): () => void {
  invalidateListeners.add(listener);
  return () => {
    invalidateListeners.delete(listener);
  };
}

// ── Live-metadata-changed signal ─────────────────────────────
// The live registry just changed out-of-band from the metadata trees — a
// publish promoted staged drafts, or a marketplace install merged a package.
// Unlike the per-artifact, draft-only canvas invalidations above, this is a
// coarse "the live world changed, refetch" pulse: EVERY mounted
// MetadataProvider (nav sidebar included, not just the surface that triggered
// it) refetches its loaded types so already-open forms/views/nav pick up the
// change WITHOUT a full page reload. Fire-and-forget, off the snapshot bus
// (same reasoning as canvas invalidations — an event, not state).

const metadataRefreshListeners = new Set<() => void>();

/** Announce that the live metadata registry changed (publish / install hosts call this). */
export function emitMetadataRefresh(): void {
  for (const l of metadataRefreshListeners) l();
}

/** Subscribe to live-metadata-changed events; returns an unsubscriber. */
export function subscribeMetadataRefresh(listener: () => void): () => void {
  metadataRefreshListeners.add(listener);
  return () => {
    metadataRefreshListeners.delete(listener);
  };
}

// ── objectui#11666 — a proposed plan awaiting the user's approval ──────────
// The chat knows, per conversation, whether the newest proposed plan still
// waits for the user: `ChatbotEnhanced` derives it from the same producer its
// plan card renders and reports it through `onPlanApprovalPendingChange`, and
// the chat host (`ChatPane`) publishes that reading here. The launchers — the
// console FAB and the ChatDock edge launcher — read it, and they are on screen
// only while the chat is CLOSED, when no chat code is mounted to ask. This
// store is where the reading outlives the chat.
//
// Only a mounted chat writes it, and every change to a plan's state in this
// document happens inside a mounted chat (the approval click, a newer
// proposal, the build that runs), so within the document it is the chat's own
// reading, not a guess. What it cannot see is stated rather than papered over:
// a change made in another tab or device, and a page reload. The durable copy
// is the server conversation, which the launcher cannot read without the chat
// graph it exists to keep out of the first load.
//
// Two keys, both load-bearing:
//   * the conversation — opening a chat on ANOTHER thread does not clear a
//     plan waiting in this one, so opening a chat clears nothing by itself;
//   * the owner — the SPA keeps running across a sign-out (`AuthProvider`), so
//     a reading is shown only to the user it was read for, never carried into
//     the next session in the tab.
// Kept OFF the snapshot bus above, like the two event channels: a plan's state
// must not re-render every `useAssistant` consumer.

/** conversation id → the user whose chat read its plan as awaiting approval. */
let planApprovalOwners: ReadonlyMap<string, string> = new Map();
const planApprovalListeners = new Set<() => void>();

function subscribePlanApproval(listener: () => void): () => void {
  planApprovalListeners.add(listener);
  return () => {
    planApprovalListeners.delete(listener);
  };
}

function getPlanApprovalOwners(): ReadonlyMap<string, string> {
  return planApprovalOwners;
}

/**
 * Record a chat's reading of whether `conversationId`'s newest proposed plan
 * awaits the user's approval (chat hosts call this). No-op when unchanged.
 * `pending: false` also drops the reading of a conversation that was deleted.
 */
export function publishPlanApprovalPending(reading: {
  userId: string | undefined;
  conversationId: string;
  pending: boolean;
}): void {
  const owner = reading.userId ?? '';
  const current = planApprovalOwners.get(reading.conversationId);
  if (reading.pending ? current === owner : current === undefined) return;
  const next = new Map(planApprovalOwners);
  if (reading.pending) next.set(reading.conversationId, owner);
  else next.delete(reading.conversationId);
  planApprovalOwners = next;
  for (const l of planApprovalListeners) l();
}

/**
 * True while any conversation of the signed-in user has a proposed plan
 * awaiting approval, as last read by a mounted chat. Read by the launchers.
 */
export function usePlanApprovalPending(): boolean {
  const owners = useSyncExternalStore(
    subscribePlanApproval,
    getPlanApprovalOwners,
    getPlanApprovalOwners,
  );
  const { user } = useAuth();
  const owner = user?.id ?? '';
  for (const o of owners.values()) if (o === owner) return true;
  return false;
}

/** Subscribe a component to the assistant bus snapshot. */
export function useAssistant(): AssistantSnapshot {
  return useSyncExternalStore(
    assistantBus.subscribe,
    assistantBus.getSnapshot,
    assistantBus.getSnapshot,
  );
}

/**
 * Publish the currently-edited item to the assistant for the lifetime of
 * the calling component (auto-clears on unmount). Pass `null` to register
 * nothing. Stable across renders with equal content.
 */
export function useRegisterAssistantEditor(ctx: AssistantEditorContext | null): void {
  // Serialize for a cheap, content-based effect dependency.
  const key = ctx ? JSON.stringify(ctx) : '';
  useEffect(() => {
    assistantBus.setEditor(ctx);
    return () => assistantBus.setEditor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Open the global AI chat from anywhere (e.g. an "Ask AI" button). */
export function requestAssistantOpen(): void {
  assistantBus.requestOpen();
}

/** Ask the host to open a drafted item in the designer's review/diff. */
export function requestAssistantReview(target: AssistantReviewTarget): void {
  assistantBus.requestReview(target);
}
