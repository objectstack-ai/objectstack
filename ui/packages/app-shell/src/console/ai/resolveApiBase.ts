// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The AI service base URL every chat surface talks to: an explicit prop, else
 * `VITE_AI_BASE_URL`, else `VITE_SERVER_URL` + `/api/v1/ai`.
 *
 * A module of its own so the dock chrome (`layout/ChatDock.tsx`), which is in
 * every console page load, can resolve it without statically importing
 * `AiChatPage` and, through it, the whole chat UI (objectui#13410).
 * `AiChatPage` re-exports it unchanged.
 */
const DEFAULT_AI_PATH = '/api/v1/ai';

export function resolveApiBase(explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, '');
  const env = (import.meta as any).env ?? {};
  const fromEnv = env.VITE_AI_BASE_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const serverUrl = (env.VITE_SERVER_URL as string | undefined) ?? '';
  return `${serverUrl.replace(/\/$/, '')}${DEFAULT_AI_PATH}`;
}
