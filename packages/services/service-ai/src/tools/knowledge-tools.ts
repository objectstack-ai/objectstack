// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  AIToolDefinition,
  IKnowledgeService,
  KnowledgeSearchOptions,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type {
  ToolHandler,
  ToolExecutionContext,
  ToolRegistry,
} from './tool-registry.js';

/**
 * Services required by the knowledge tool family.
 */
export interface KnowledgeToolContext {
  /** Orchestrator that resolves adapters and applies permission filtering. */
  knowledgeService: IKnowledgeService;
}

/**
 * Default cap on `topK` when callers omit it or supply something silly.
 * Adapters and the orchestrator may cap further.
 */
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

/**
 * Translate a {@link ToolExecutionContext} into the
 * {@link ExecutionContext} that `IKnowledgeService.search` expects.
 *
 * Mirrors the convention used by the data tools: when the AI tool call
 * carries an authenticated actor, RLS is enforced; otherwise we fall
 * back to a system context so legacy / internal callers continue to
 * work unchanged.
 */
function buildEngineContext(ctx?: ToolExecutionContext): ExecutionContext {
  if (ctx?.actor) {
    return {
      userId: ctx.actor.id,
      roles: ctx.actor.roles ?? [],
      permissions: ctx.actor.permissions ?? [],
      isSystem: false,
      ...(ctx.environmentId ? { tenantId: ctx.environmentId } : {}),
      ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
    };
  }
  return { roles: [], permissions: [], isSystem: true };
}

export const SEARCH_KNOWLEDGE_TOOL: AIToolDefinition = {
  name: 'search_knowledge',
  description:
    'Search registered knowledge sources (object snapshots, uploaded files, ' +
    'external URLs) and return the most relevant excerpts. ' +
    'Use this when the user asks a question whose answer is in documents, ' +
    'policies, or reference material the LLM does not natively know. ' +
    'Results are already permission-filtered for the current user.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Free-text question or keywords to search for.',
      },
      sourceIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of source ids to restrict the search to. ' +
          'When omitted, every source the caller can see is queried.',
      },
      topK: {
        type: 'number',
        description: `Maximum hits to return (default ${DEFAULT_TOP_K}, max ${MAX_TOP_K}).`,
      },
      filter: {
        type: 'object',
        description:
          'Optional adapter-specific metadata filter (e.g. {"topic":"refunds"}).',
      },
    },
    required: ['query'],
  },
};

function createSearchKnowledgeHandler(context: KnowledgeToolContext): ToolHandler {
  return async (args, ctx) => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return JSON.stringify({ error: 'search_knowledge: `query` is required.' });
    }

    const sourceIds = Array.isArray(args.sourceIds)
      ? args.sourceIds.filter((x): x is string => typeof x === 'string')
      : undefined;
    const topKRaw = typeof args.topK === 'number' ? args.topK : DEFAULT_TOP_K;
    const topK = Math.max(1, Math.min(MAX_TOP_K, Math.floor(topKRaw)));
    const filter =
      args.filter && typeof args.filter === 'object' && !Array.isArray(args.filter)
        ? (args.filter as Record<string, unknown>)
        : undefined;

    const opts: KnowledgeSearchOptions = {
      topK,
      executionContext: buildEngineContext(ctx),
    };
    if (sourceIds && sourceIds.length > 0) opts.sourceIds = sourceIds;
    if (filter) opts.filter = filter;

    try {
      const hits = await context.knowledgeService.search(query, opts);
      return JSON.stringify({
        query,
        count: hits.length,
        hits: hits.map((h) => ({
          documentId: h.documentId,
          chunkId: h.chunkId,
          sourceId: h.sourceId,
          sourceRecordId: h.sourceRecordId,
          score: Number(h.score?.toFixed?.(4) ?? h.score ?? 0),
          title: h.title,
          snippet: h.snippet,
          metadata: h.metadata,
        })),
      });
    } catch (err) {
      return JSON.stringify({
        error: `search_knowledge failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };
}

/**
 * Register knowledge-related tools on the AI tool registry.
 *
 * @example
 * ```ts
 * ctx.hook('ai:ready', async (aiService) => {
 *   const knowledgeService = ctx.getService<IKnowledgeService>('knowledge');
 *   registerKnowledgeTools(aiService.toolRegistry, { knowledgeService });
 * });
 * ```
 */
export function registerKnowledgeTools(
  registry: ToolRegistry,
  context: KnowledgeToolContext,
): void {
  registry.register(SEARCH_KNOWLEDGE_TOOL, createSearchKnowledgeHandler(context));
}
