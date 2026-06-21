// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Core service
export { AIService } from './ai-service.js';
export type { AIServiceConfig } from './ai-service.js';

// Kernel plugin
export { AIServicePlugin } from './plugin.js';
export type { AIServicePluginOptions, AIAdapterStatus } from './plugin.js';

// Adapters
export { MemoryLLMAdapter } from './adapters/memory-adapter.js';
export { VercelLLMAdapter } from './adapters/vercel-adapter.js';
export type { VercelLLMAdapterConfig } from './adapters/vercel-adapter.js';
export type { LLMAdapter } from '@objectstack/spec/contracts';

// Vercel Data Stream encoder
export { encodeStreamPart, encodeVercelDataStream } from './stream/vercel-stream-encoder.js';

// Conversation
export { InMemoryConversationService } from './conversation/in-memory-conversation-service.js';
export { ObjectQLConversationService } from './conversation/objectql-conversation-service.js';

// Tool registry
export { ToolRegistry } from './tools/tool-registry.js';
export type { ToolHandler, ToolExecutionResult } from './tools/tool-registry.js';

// Data tools
export { registerDataTools, DATA_TOOL_DEFINITIONS } from './tools/data-tools.js';
export type { DataToolContext } from './tools/data-tools.js';

// NOTE: AI metadata-authoring (metadata tools, plan-first blueprint tools,
// package context tools, and the metadata_assistant agent + authoring skills)
// moved to the cloud-only @objectstack/service-ai-studio package. The generic
// AI runtime, data tools, knowledge tools, and the metadata WRITE mechanism in
// the kernel stay open here.

// Knowledge tools
export { registerKnowledgeTools, SEARCH_KNOWLEDGE_TOOL } from './tools/knowledge-tools.js';
export type { KnowledgeToolContext } from './tools/knowledge-tools.js';

// Action tools (write-side: turn declarative Actions into AI-callable tools)
export {
  registerActionsAsTools,
  actionToToolDefinition,
  actionToolName,
  actionSkipReason,
} from './tools/action-tools.js';
export type { ActionToolsContext } from './tools/action-tools.js';

// Agent runtime
export { AgentRuntime } from './agent-runtime.js';
export type { AgentChatContext } from './agent-runtime.js';

// Skill registry (Agent → Skill → Tool composition)
export { SkillRegistry } from './skill-registry.js';
export type { SkillContext, SkillSummary } from './skill-registry.js';

// Built-in agents
export { DATA_CHAT_AGENT, DEFAULT_DATA_AGENT_NAME, LEGACY_DATA_AGENT_NAME } from './agents/index.js';
// Back-compat agent-name aliases (Path A rename). Other packages register their
// own renames (e.g. cloud AI Studio: `metadata_assistant`→`build`).
export { registerAgentAlias, resolveAgentAlias, agentAliasEntries } from './agents/index.js';

// Built-in skills
export {
  DATA_EXPLORER_SKILL,
  ACTIONS_EXECUTOR_SKILL,
} from './skills/index.js';

// Object definitions
export { AiConversationObject, AiMessageObject, AiTraceObject } from './objects/index.js';

// View definitions (built-in Studio surfaces)
export { AiTraceView } from './views/index.js';

// Model registry
export { ModelRegistry, computeCost } from './model-registry.js';
export type { ModelRegistryConfig, CostEstimate, TokenUsage } from './model-registry.js';

// Trace recorder
export {
  NullTraceRecorder,
  ObjectQLTraceRecorder,
  buildTraceEvent,
} from './trace-recorder.js';
export type { TraceRecorder, TraceEvent, TraceOperation } from './trace-recorder.js';

// Schema retriever (keyword-based metadata retrieval for AI prompts)
export { SchemaRetriever } from './schema-retriever.js';
export type {
  SchemaHit,
  SchemaRetrieverOptions,
  ObjectShape,
  FieldShape,
} from './schema-retriever.js';

// query_data tool (NL → ObjectQL via structured output)
export {
  QUERY_DATA_TOOL,
  createQueryDataHandler,
  registerQueryDataTool,
} from './tools/query-data.tool.js';
export type { QueryDataToolContext, QueryPlan } from './tools/query-data.tool.js';

// visualize_data tool (analytics aggregation → SDUI chart via `data-chart` part)
export {
  VISUALIZE_DATA_TOOL,
  createVisualizeDataHandler,
  registerVisualizeDataTool,
} from './tools/visualize-data.tool.js';
export type { VisualizeDataToolContext } from './tools/visualize-data.tool.js';

// Routes
export { buildAIRoutes } from './routes/ai-routes.js';
export { buildAgentRoutes } from './routes/agent-routes.js';
export { buildAssistantRoutes } from './routes/assistant-routes.js';
export { buildToolRoutes } from './routes/tool-routes.js';
export type { RouteDefinition, RouteRequest, RouteResponse, RouteUserContext } from './routes/ai-routes.js';
