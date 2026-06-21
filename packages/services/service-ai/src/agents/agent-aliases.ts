// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Back-compat aliases for renamed built-in agents.
 *
 * The platform's built-in agents were renamed (Path A) so the friendly console
 * URL equals the real identifier: the data agent `data_chat`→`ask`. Old clients,
 * bookmarks, and persisted `ai_conversations.agent_id` values still carry the
 * legacy name, so {@link AgentRuntime.loadAgent} normalizes a requested name
 * through this table before loading the record — `/agents/data_chat/chat` keeps
 * resolving to the `ask` agent.
 *
 * The table is a process-wide registry so each package that owns a built-in
 * agent registers ITS OWN rename and the two stay decoupled: the framework
 * seeds `data_chat`→`ask` here, and the cloud AI Studio plugin registers
 * `metadata_assistant`→`build` at init via {@link registerAgentAlias}. That
 * decoupling is what makes the two renames independently safe — neither alias
 * points at an id its owning package hasn't registered yet.
 *
 * Aliases are resolution-only: they are NOT separate metadata records, so the
 * agent list (`GET /api/v1/ai/agents`) still shows each agent exactly once
 * under its canonical name.
 */
const AGENT_NAME_ALIASES = new Map<string, string>([
  // The framework's own data agent rename.
  ['data_chat', 'ask'],
]);

/**
 * Register a legacy→canonical agent-name alias. Idempotent; a later call for the
 * same legacy name wins. Call at plugin init, BEFORE the canonical agent is
 * looked up, so a legacy request resolves to the registered canonical id.
 */
export function registerAgentAlias(legacy: string, canonical: string): void {
  if (legacy && canonical && legacy !== canonical) {
    AGENT_NAME_ALIASES.set(legacy, canonical);
  }
}

/** Resolve a (possibly legacy) agent name to its canonical id, or itself. */
export function resolveAgentAlias(name: string): string {
  return AGENT_NAME_ALIASES.get(name) ?? name;
}

/** Test/diagnostics helper: a snapshot of the current alias table. */
export function agentAliasEntries(): Array<[string, string]> {
  return Array.from(AGENT_NAME_ALIASES.entries());
}
