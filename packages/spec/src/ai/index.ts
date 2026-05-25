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
export * from './tool.zod';
export * from './skill.zod';
export * from './conversation.zod';
export * from './model-registry.zod';
export * from './embedding.zod';
export * from './usage.zod';
export * from './mcp.zod';
export * from './knowledge-source.zod';
export * from './knowledge-document.zod';
