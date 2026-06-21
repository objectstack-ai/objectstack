// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Agent } from '@objectstack/spec/ai';

/**
 * Built-in `data_chat` agent — a thin **persona** record.
 *
 * Following the platform's metadata-driven philosophy, this agent no
 * longer hardcodes the tools it can call. The capability bundle lives
 * on the `data_explorer` *skill* (see `../skills/data-explorer-skill.ts`).
 * The agent record is now just:
 *   - identity (name / label / role)
 *   - persona (system prompt)
 *   - model + safety config
 *   - skills attached → `skills: [...]` (ADR-0040: data + authoring)
 *
 * To grant data-exploration powers to a different agent, just add
 * `data_explorer` to its `skills[]`. To revoke globally, set the
 * skill's `active: false` in metadata.
 *
 * @example
 * ```
 * POST /api/v1/ai/agents/data_chat/chat
 * {
 *   "messages": [{ "role": "user", "content": "Show me all active accounts" }],
 *   "context": { "objectName": "account" }
 * }
 * ```
 */
/**
 * Canonical name of the platform's data-query agent.
 *
 * This is the implicit default copilot for every application that does
 * not pin its own `app.defaultAgent`. Studio is the only built-in app
 * that overrides it (→ the `build` authoring agent). Keeping the name as
 * an exported constant lets the runtime resolve the fallback
 * deterministically instead of guessing "first active agent".
 *
 * Path A renamed this from `data_chat`→`ask`; the legacy name stays
 * resolvable via the alias table (see `agent-aliases.ts`).
 */
export const DEFAULT_DATA_AGENT_NAME = 'ask';

/** Legacy id this agent was renamed from (kept for back-compat / migrations). */
export const LEGACY_DATA_AGENT_NAME = 'data_chat';

export const DATA_CHAT_AGENT: Agent = {
  name: DEFAULT_DATA_AGENT_NAME,
  label: 'Assistant',
  role: 'Business Application Assistant',
  // ADR-0040 — the unified platform assistant. End users never pick an
  // agent; this one persona answers BOTH registers, and the FIRST job of
  // every turn is classifying which register the user is in. The per-register
  // disciplines (plan-first blueprints, draft semantics, no failure
  // narration, data-query guidance) live in the attached skills.
  instructions: `You are the assistant for this business application platform. You can both ANSWER QUESTIONS about the user's data and BUILD or CHANGE the application itself (objects, fields, views, dashboards, whole apps).

INTENT FIRST — before acting, classify the request:
- BUILD/CHANGE intent ("build…", "create an app/object/field…", "add/change/remove …", "建/做一个…系统/应用/字段"): follow the solution-design and metadata-authoring disciplines from your skills — plan-first for whole systems, drafts are not live, verify after building, and never narrate tool errors or internal retries to the user; present outcomes, not your debugging.
- DATA intent ("how many…", "show/list…", "查/统计/看一下…"): use the data-exploration tools and answer concisely with real numbers.
Never mix the registers in one reply: a build turn reports what was built and its verification status; a data turn answers the question.

Always answer in the same language the user is using. Detailed tool-usage guidance is supplied by the skills attached to this agent.`,

  model: {
    provider: 'openai',
    model: 'gpt-4',
    // The stricter of the merged personas: authoring needs determinism.
    temperature: 0.2,
    maxTokens: 4096,
  },

  // Capability bundles live on skills; the agent only references them.
  // `data_explorer`/`actions_executor` = the data register;
  // `metadata_authoring`/`solution_design` = the build register (ADR-0040).
  // The authoring skills are registered by the cloud AI Studio plugin — on
  // deployments without it these references simply don't resolve and the
  // assistant gracefully degrades to data-only (the skill registry ignores
  // unknown names).
  skills: ['data_explorer', 'actions_executor', 'metadata_authoring', 'solution_design'],

  active: true,
  visibility: 'global',

  guardrails: {
    maxTokensPerInvocation: 8192,
    // Whole-app builds (blueprint + per-artifact drafting + verification)
    // legitimately run past the old 30s data-answer budget.
    maxExecutionTimeSec: 60,
    // Union of both personas' blocklists MINUS the ones that contradict the
    // build register: `alter_schema`/`drop_table` were the data-only agent's
    // way of refusing schema work, but authoring IS schema work — and it is
    // already draft-gated (ADR-0033: nothing is live until publish, and
    // destructive changes carry their own warning + HITL). What remains is
    // genuinely off-limits in both registers.
    blockedTopics: ['delete_records', 'drop_database', 'raw_sql', 'system_tables'],
  },

  planning: {
    strategy: 'react',
    // Builds take more steps than data answers (blueprint → drafts → verify).
    maxIterations: 10,
    allowReplan: true,
  },
};

