/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#34608 (ui ADR-0057 as amended) — what the console's ONE chat
 * container, the right-side drawer, is showing, kept React-free so the address
 * grammar and the storage round-trip are unit-testable on their own.
 *
 * The drawer has no route of its own: opening, expanding and switching threads
 * leave the page's address unchanged. What it shows is a {@link ChatDockTarget}:
 * absent, the drawer shows its AMBIENT thread (the app-bound build thread in an
 * authorable app, the product thread elsewhere); present, it names an agent, a
 * conversation, a package and/or a fresh start. The old `/ai…` addresses parse
 * into a target ({@link parseAiAddress}), so a bookmark or a shared link still
 * opens the conversation it named, in the drawer.
 */

import { isFramedConsole } from './chatDockState.js';

/** What the drawer shows; every member optional, absent = the ambient thread. */
export interface ChatDockTarget {
  /** The agent, by route name or backend name (`build`, `ask`, a custom agent). */
  agent?: string;
  /** The conversation to show; absent = the agent's own cached thread. */
  conversationId?: string;
  /** The package a build conversation is bound to (ADR-0070 "Edit with AI"). */
  packageId?: string;
  /** Start a new conversation instead of resuming the cached one. */
  fresh?: boolean;
}

/**
 * objectui#12493 — the ADR-0057 P4 Builder handoff ("Open in Builder →" on the
 * `ask` surface) never travels in a URL or in storage: a URL can be written by
 * anyone and opened by a signed-in user in one click, and the build surface
 * sends its seeded first message with no further action. It rides react-router
 * NAVIGATION STATE or an in-memory call, which only this app's own code sets.
 */
export interface BuilderHandoffState {
  /** The build prompt the `ask` agent handed off; sent once as the build thread's first message. */
  handoffPrompt?: string;
  /** The source `ask` conversation id, forwarded as the build agent's first-turn context (cloud#817). */
  parentConversationId?: string;
}

/** A handoff waiting to be sent, tagged so each one is seeded exactly once. */
export interface ChatDockHandoff {
  seq: number;
  state: BuilderHandoffState;
}

/** How the drawer presents its body: the side rail, the full window, or the phone sheet. */
export type ChatDockPresentation = 'rail' | 'full' | 'sheet';

/** Reads a handoff from `location.state`; anything that is not a non-empty string is absent. */
export function readBuilderHandoffState(state: unknown): BuilderHandoffState {
  if (!state || typeof state !== 'object') return {};
  const record = state as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    handoffPrompt: text(record.handoffPrompt),
    parentConversationId: text(record.parentConversationId),
  };
}

/** Drops absent members, so two targets naming the same thing compare equal as JSON. */
function compactTarget(target: ChatDockTarget): ChatDockTarget | undefined {
  const out: ChatDockTarget = {};
  if (target.agent) out.agent = target.agent;
  if (target.conversationId) out.conversationId = target.conversationId;
  if (target.packageId) out.packageId = target.packageId;
  if (target.fresh) out.fresh = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse a pre-drawer chat address — `/ai`, `/ai/AGENT`, `/ai/AGENT/CONVERSATION`,
 * with `?package=`, `?new=` and the older `?agent=` — into the target it named.
 * `pathname` may carry the console's mount prefix; everything up to the first `ai`
 * segment is ignored. A single segment that is not an agent is a legacy bare
 * conversation id; telling the two apart needs the live catalog, so the segment
 * is kept as `agent` here and the drawer resolves it.
 */
export function parseAiAddress(pathname: string, search: string): ChatDockTarget | undefined {
  const segments = pathname.split('/').filter(Boolean);
  const at = segments.indexOf('ai');
  const tail = at === -1 ? [] : segments.slice(at + 1);
  const decode = (s: string | undefined) => {
    if (!s) return undefined;
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const params = new URLSearchParams(search);
  const text = (v: string | null) => (v && v.trim() ? v.trim() : undefined);
  return compactTarget({
    agent: decode(tail[0]) ?? text(params.get('agent')),
    conversationId: decode(tail[1]),
    packageId: text(params.get('package')),
    fresh: params.get('new') !== null,
  });
}

/**
 * The pre-drawer address of a target — the URL a host without a drawer still
 * navigates to (a page the drawer's provider does not wrap). The console routes
 * that address back into the drawer.
 */
export function aiAddressOf(target: ChatDockTarget | undefined, agentRoute: (agent: string) => string): string {
  let path = '/ai';
  if (target?.agent) {
    path += `/${encodeURIComponent(agentRoute(target.agent))}`;
    if (target.conversationId) path += `/${encodeURIComponent(target.conversationId)}`;
  }
  const query = new URLSearchParams();
  if (target?.packageId) query.set('package', target.packageId);
  if (target?.fresh) query.set('new', '1');
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * sessionStorage key holding the drawer's target as JSON (never a handoff
 * prompt). Per tab, like the expanded flag: it survives in-tab navigation and a
 * reload, and never leaks into a shared URL.
 */
export const DOCK_TARGET_STORAGE_KEY = 'ai-chat-dock-target';

/**
 * sessionStorage key holding `'1'` while the drawer fills the window
 * (maximized in place). Read once when a drawer host mounts; the deep-link
 * redirect arms it so an old full-page link opens the drawer maximized.
 */
export const DOCK_FULL_WINDOW_STORAGE_KEY = 'ai-chat-dock-full-window';

/** The stored target; unset, malformed or unreadable storage → `undefined` (ambient). */
export function readStoredDockTarget(): ChatDockTarget | undefined {
  if (isFramedConsole()) return undefined;
  try {
    const raw = window.sessionStorage.getItem(DOCK_TARGET_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    return compactTarget({
      agent: text(record.agent),
      conversationId: text(record.conversationId),
      packageId: text(record.packageId),
      fresh: record.fresh === true,
    });
  } catch {
    return undefined;
  }
}

/** Store a target (`undefined` clears it). No-op inside a frame or without storage. */
export function writeStoredDockTarget(target: ChatDockTarget | undefined): void {
  if (isFramedConsole()) return;
  try {
    const compact = target ? compactTarget(target) : undefined;
    if (compact) window.sessionStorage.setItem(DOCK_TARGET_STORAGE_KEY, JSON.stringify(compact));
    else window.sessionStorage.removeItem(DOCK_TARGET_STORAGE_KEY);
  } catch {
    /* private mode — the drawer just returns to its ambient thread */
  }
}

/** Whether the drawer was left (or armed) filling the window. */
export function readStoredDockFullWindow(): boolean {
  if (isFramedConsole()) return false;
  try {
    return window.sessionStorage.getItem(DOCK_FULL_WINDOW_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Store the full-window flag. No-op inside a frame or without storage. */
export function writeStoredDockFullWindow(fullWindow: boolean): void {
  if (isFramedConsole()) return;
  try {
    if (fullWindow) window.sessionStorage.setItem(DOCK_FULL_WINDOW_STORAGE_KEY, '1');
    else window.sessionStorage.removeItem(DOCK_FULL_WINDOW_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

/** Two targets name the same thread. */
export function sameDockTarget(a: ChatDockTarget | undefined, b: ChatDockTarget | undefined): boolean {
  const ca = a ? compactTarget(a) : undefined;
  const cb = b ? compactTarget(b) : undefined;
  return JSON.stringify(ca ?? null) === JSON.stringify(cb ?? null);
}

/**
 * Navigation-state key the deep-link redirect hands its handoff over under, to
 * the drawer host on the page it lands on (see {@link readBuilderHandoffState}).
 */
export const DOCK_HANDOFF_STATE_KEY = 'chatDockHandoff';
