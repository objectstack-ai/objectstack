// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AI Protocol Exports
 *
 * Platform AI primitives. Scope is deliberately narrow — these are
 * the schemas the runtime directly consumes. Application-level
 * concerns (DevOps agents, predictive pipelines, AIOps, orchestration
 * plans, NLQ services, RAG pipeline DSLs, budget enforcement, etc.)
 * were removed in v1 because they can be built on top of these
 * primitives and do not need a platform-blessed shape.
 *
 * Primitives:
 * - Agent           — persona + skill/tool bindings
 * - Skill           — capability bundle with context-driven activation
 * - Tool            — Zod-typed callable surface
 * - Conversation    — message persistence + short/long-term memory
 * - Model Registry  — multi-provider LLM configuration
 * - Embedding       — embedding model + vector store references
 * - Usage           — token accounting + per-call cost
 * - MCP             — references and bindings to external MCP servers
 */

export * from './agent.zod';
export { agentForm } from './agent.form';
export * from './tool.zod';
export { toolForm } from './tool.form';
export * from './skill.zod';
export { skillForm } from './skill.form';
export * from './conversation.zod';
export * from './model-registry.zod';
export * from './embedding.zod';
export * from './usage.zod';
export * from './mcp.zod';
export * from './knowledge-source.zod';
export * from './knowledge-document.zod';
export * from './solution-blueprint.zod';

// [#12414] entry-nameability: these factories' return types expand to mention
// `/data`'s `FilterCondition` and `/automation`'s `StateNodeConfig` — both
// public on their own subpaths but not nameable from `/ai`. Same invariant
// (maintainer ruling recorded on #11350), same repair: re-export from the
// declaring module.
export type { FilterCondition } from '../data/filter.zod';
export type { StateNodeConfig } from '../automation/state-machine.zod';
