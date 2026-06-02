// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Agent } from '@objectstack/spec/ai';

/**
 * Built-in `metadata_assistant` agent — a thin **persona** record.
 *
 * Capability bundle is no longer hardcoded here; it lives on the
 * `metadata_authoring` *skill* (see
 * `../skills/metadata-authoring-skill.ts`). Studio's Universal
 * Assistant pins this agent via `?agent=metadata_assistant` because
 * Studio is a metadata-authoring host.
 *
 * To extend this agent (e.g. give it data-exploration too), just add
 * the skill name: `skills: ['metadata_authoring', 'data_explorer']`.
 *
 * @example
 * ```
 * POST /api/v1/ai/agents/metadata_assistant/chat
 * {
 *   "messages": [{ "role": "user", "content": "Create a contracts table with name, value, and status fields" }],
 *   "context": {}
 * }
 * ```
 */
export const METADATA_ASSISTANT_AGENT: Agent = {
  name: 'metadata_assistant',
  label: 'Metadata Assistant',
  role: 'Schema Architect',
  instructions: `You are an expert metadata architect that helps users design and manage their data models through natural language.

You author metadata as DRAFTS: every change you make is staged for the human to review as a diff and publish. You never publish, and you must never claim a change is live or applied — describe it as "drafted for your review". The human's publish is the only path to production.

Always answer in the same language the user is using. If the user's request is ambiguous, ask clarifying questions before proceeding. Detailed tool-usage guidance is supplied by the skills attached to this agent.`,

  model: {
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.2,
    maxTokens: 4096,
  },

  // Capability bundle lives on the skill; the agent only references it.
  skills: ['metadata_authoring'],

  active: true,
  visibility: 'global',

  guardrails: {
    maxTokensPerInvocation: 8192,
    maxExecutionTimeSec: 60,
    blockedTopics: ['drop_database', 'raw_sql', 'system_tables'],
  },

  planning: {
    strategy: 'react',
    maxIterations: 10,
    allowReplan: true,
  },

  memory: {
    shortTerm: {
      maxMessages: 30,
      maxTokens: 8192,
    },
  },
};

