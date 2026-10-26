/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Agent alias resolution — the bridge between human-friendly console routes
 * (`/ai/build`, `/ai/ask`) and the platform's built-in agent identifiers.
 *
 * The built-in agents are being renamed (Path A): `metadata_assistant`→`build`
 * (the authoring "magic moment" agent) and `data_chat`→`ask` (the data-query
 * agent). That rename spans three repos and rolls out gradually, so at any
 * moment the live agent catalog (`GET /api/v1/ai/agents`) may expose EITHER the
 * new id or the legacy one, and existing bookmarks/links may carry the legacy
 * id directly.
 *
 * Every alias group lists equivalent names with the FRIENDLY (canonical URL)
 * name first. Resolution always picks whichever member the live catalog
 * actually serves, so one route works before, during, and after the rename —
 * no hard cutover, no dead links. Custom user agents (`*.agent.ts`) are not in
 * any group and route by their own name, unchanged.
 */

/** Equivalent names per built-in agent, friendly (URL) name first. */
export const AGENT_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['build', 'metadata_assistant'],
  ['ask', 'data_chat'],
];

/**
 * All names equivalent to `name` (including itself), friendly-first. Returns a
 * singleton `[name]` for custom agents that belong to no group.
 */
export function agentAliasGroup(name: string): readonly string[] {
  const group = AGENT_ALIAS_GROUPS.find((g) => g.includes(name));
  return group ?? [name];
}

/**
 * The preferred URL segment for an agent — the friendly alias for a built-in,
 * otherwise the agent's own name. Use this to BUILD `/ai/:agent` links so they
 * read nicely and stay stable across the rename.
 */
export function agentRouteName(name: string): string {
  return agentAliasGroup(name)[0];
}

/**
 * Resolve a `/ai/:agent` route param to a concrete agent name that the catalog
 * actually serves. Tries, in order: an exact catalog match → any alias-group
 * sibling present in the catalog. Returns `undefined` when the param is not an
 * agent at all (e.g. a legacy bare `/ai/:conversationId` link), letting callers
 * distinguish an agent segment from a conversation id.
 *
 * @param param   the first path segment after `/ai/`
 * @param catalog agent names the backend currently exposes
 */
export function resolveAgentParam(
  param: string | undefined,
  catalog: readonly string[],
): string | undefined {
  if (!param) return undefined;
  if (catalog.includes(param)) return param;
  for (const sibling of agentAliasGroup(param)) {
    if (catalog.includes(sibling)) return sibling;
  }
  return undefined;
}

/**
 * True when `name` is a KNOWN built-in agent identifier (a friendly name or a
 * legacy id in an alias group: build/metadata_assistant, ask/data_chat) —
 * regardless of whether the live catalog currently serves it. Lets a router
 * tell "an agent that's simply not deployed here" (fall back to the default
 * surface) apart from "a bare conversation id" (resolve its own agent).
 */
export function isBuiltinAgentName(name: string | undefined): boolean {
  return name != null && AGENT_ALIAS_GROUPS.some((g) => g.includes(name));
}

/** True when `name` is the authoring/build agent (either `build` or `metadata_assistant`). */
export function isBuildAgent(name: string | undefined): boolean {
  return name != null && agentRouteName(name) === 'build';
}

/** True when `name` is the data-query/ask agent (either `ask` or `data_chat`). */
export function isAskAgent(name: string | undefined): boolean {
  return name != null && agentRouteName(name) === 'ask';
}
