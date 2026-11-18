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
 *
 * objectstack#35014 — the conversation follows the app (maintainer ruling: the
 * switch is automatic, with no "start a new conversation?" prompt). A target
 * records the app it was opened in ({@link ChatDockTarget.app}), and the drawer
 * shows it only in that app, or in the app it names ({@link dockTargetFollowsApp}).
 * Anywhere else the drawer shows that app's own ambient thread. Nothing is
 * deleted: back in the app, the target it was left on is shown again.
 */

import { isPlatformBuiltinApp } from '../utils/platformApp.js';
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
  /**
   * objectstack#35014 — the app the console was in when the drawer was pointed
   * at this target: its authorable package ({@link ambientAppPackage}), or
   * `null` outside any app (Home, a built-in app). The host stamps it
   * ({@link placeDockTarget}). Absent = not placed yet: an old `/ai…` link the
   * redirect stored before it knew the landing, or a target stored before this
   * member existed. The host places it in the app it is first read in.
   */
  app?: string | null;
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
  // `app` says where a target was opened; on its own it names no thread.
  if (Object.keys(out).length === 0) return undefined;
  if (target.app !== undefined) out.app = target.app;
  return out;
}

/**
 * The app a `build` thread binds to in the console (ui ADR-0057 Amendment A2):
 * the package of the app in view when it is authorable, i.e. not a
 * `com.objectstack.*` built-in. `undefined` = app-less (Home, a built-in app).
 * The one resolver for both the drawer host and the drawer body.
 */
export function ambientAppPackage(appPackageId: string | undefined): string | undefined {
  return appPackageId && !isPlatformBuiltinApp({ _packageId: appPackageId }) ? appPackageId : undefined;
}

/**
 * Stamp a target with the app it is opened in, unless it already carries one.
 * `app` is the {@link ambientAppPackage} of the app in view. A target that
 * names nothing is the ambient thread (`undefined`), wherever it was opened.
 */
export function placeDockTarget(
  target: ChatDockTarget | undefined,
  app: string | undefined,
): ChatDockTarget | undefined {
  const compact = target ? compactTarget(target) : undefined;
  if (!compact || compact.app !== undefined) return compact;
  return { ...compact, app: app ?? null };
}

/**
 * objectstack#35014 — does the drawer show this target in the app in view
 * (`app`, the {@link ambientAppPackage})? Yes in the app it was opened in, and
 * in the app it names (a build "Edit with AI" for X opened at Home, a build
 * that has just created X and moves the page there). Anywhere else the drawer
 * shows that app's ambient thread, so a thread never follows the user into an
 * app it does not belong to. An unplaced target is shown (see
 * {@link ChatDockTarget.app}).
 */
export function dockTargetFollowsApp(target: ChatDockTarget, app: string | undefined): boolean {
  if (target.app === undefined) return true;
  if (target.app === (app ?? null)) return true;
  return target.packageId !== undefined && target.packageId === app;
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
      app: record.app === null ? null : text(record.app),
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

/** Two targets name the same thread, opened in the same app. */
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
