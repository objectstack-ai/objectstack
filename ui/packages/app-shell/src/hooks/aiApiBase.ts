// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The AI service base URL, in a module of its own so a reader that only needs
 * the URL (the sidebar's conversation favourites, `UnifiedSidebar`) does not
 * import the surface hook's module, which many layout tests replace with a
 * mock that carries no `resolveAiApiBase`.
 */

/**
 * Resolve the AI service base URL, mirroring AiChatPage / the Home CTAs:
 * an explicit `VITE_AI_BASE_URL` wins, otherwise `${VITE_SERVER_URL}/api/v1/ai`.
 * Shared so every catalog fetch (route guard, layouts, Home) hits the same URL.
 */
export function resolveAiApiBase(): string {
  const env = (import.meta as any).env ?? {};
  const fromEnv = env.VITE_AI_BASE_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const serverUrl = (env.VITE_SERVER_URL as string | undefined) ?? '';
  return `${serverUrl.replace(/\/$/, '')}/api/v1/ai`;
}
