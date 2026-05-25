// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import type {
  AIToolDefinition,
  IAIService,
  IDataEngine,
  IMetadataService,
  ModelMessage,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SchemaRetriever } from '../schema-retriever.js';
import type { ToolHandler, ToolRegistry, ToolExecutionContext } from './tool-registry.js';

/** See `data-tools.ts#buildEngineContext` — duplicated here to keep
 *  this single-tool module dependency-free from the data-tools file. */
function buildAiEngineContext(ctx?: ToolExecutionContext): ExecutionContext {
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

/**
 * Context for the `query_data` tool.
 *
 * Wires together the three services it needs:
 * - {@link IAIService} for structured-output generation of the ObjectQL query
 * - {@link IMetadataService} for schema discovery
 * - {@link IDataEngine} for actually executing the resolved query
 */
export interface QueryDataToolContext {
  ai: IAIService;
  metadata: IMetadataService;
  dataEngine: IDataEngine;
  /** Maximum number of records returned per call (default: 100). */
  maxLimit?: number;
}

/**
 * Zod schema used to constrain the LLM's structured output.
 *
 * Kept small and strict — every property is documented so providers like
 * OpenAI Structured Outputs and Anthropic Tool Use can render high-quality
 * prompts from the schema metadata.
 *
 * NOTE: `where` is intentionally typed as a JSON string rather than a free-form
 * record. OpenAI's Structured Outputs surface rejects `propertyNames`
 * (which Zod's `z.record(z.string(), ...)` emits), and Anthropic's tool-use
 * surface dislikes open-ended object schemas without `additionalProperties`.
 * Having the model emit a JSON-encoded filter sidesteps both restrictions and
 * keeps the tool portable across providers.
 */
const QueryPlanSchema = z.object({
  objectName: z
    .string()
    .min(1)
    .describe('The snake_case object name to query (e.g. "task", "account").'),
  whereJson: z
    .string()
    .nullable()
    .describe(
      'Filter conditions encoded as a JSON object string. Examples: ' +
      '`{"status":"completed"}`, `{"subject":{"$contains":"Build"}}`, ' +
      '`{"amount":{"$gt":100}}`. Pass null to match all records.',
    ),
  fields: z
    .array(z.string())
    .nullable()
    .describe('Field names to return. Pass null to return all fields.'),
  orderBy: z
    .array(
      z.object({
        field: z.string(),
        order: z.enum(['asc', 'desc']),
      }),
    )
    .nullable()
    .describe('Sort order. First entry is primary sort key. Pass null for no sort.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .nullable()
    .describe('Maximum number of records (default 20, max 200). Pass null for default.'),
});

/** Strongly-typed query plan inferred from the LLM. */
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

/**
 * Tool definition advertised to the LLM in the outer tool-call loop.
 *
 * The model invokes this tool with a single `request` argument — a
 * paraphrased question. The handler then performs:
 * 1. Schema retrieval (keyword match on the metadata catalogue)
 * 2. Structured-output generation of an ObjectQL plan (via Zod schema)
 * 3. Execution of that plan against the data engine
 * 4. Returns the results as JSON for the model to summarise.
 *
 * This collapses what used to be "schema retriever middleware + NLQ service"
 * into one tool, fully consistent with the platform's tool-calling pattern.
 */
export const QUERY_DATA_TOOL: AIToolDefinition = {
  name: 'query_data',
  description:
    'Answer a natural-language question about the user\'s data. ' +
    'Internally retrieves the relevant object schema, generates an ObjectQL ' +
    'query, executes it, and returns the matching records. Prefer this tool ' +
    'over `query_records` / `aggregate_data` when the user\'s intent is ' +
    'expressed in plain language.',
  parameters: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        description:
          'The natural-language question to answer (paraphrase the user\'s ' +
          'request if needed for clarity).',
      },
    },
    required: ['request'],
    additionalProperties: false,
  },
};

/**
 * Create a handler for the `query_data` tool.
 *
 * The handler is intentionally stateless — every call performs a fresh
 * schema lookup so newly registered objects are picked up immediately.
 */
export function createQueryDataHandler(ctx: QueryDataToolContext): ToolHandler {
  const retriever = new SchemaRetriever(ctx.metadata);
  const maxLimit = ctx.maxLimit ?? 100;

  return async (args, execCtx) => {
    const { request } = args as { request: string };

    if (!request || typeof request !== 'string') {
      return JSON.stringify({ error: 'query_data: `request` is required' });
    }

    if (!ctx.ai.generateObject) {
      return JSON.stringify({
        error:
          'query_data requires structured-output support. Configure a ' +
          'Vercel-AI-SDK-backed adapter (OpenAI, Anthropic, Google).',
      });
    }

    // 1. Schema retrieval
    const hits = await retriever.retrieve(request);
    if (hits.length === 0) {
      return JSON.stringify({
        error:
          'No matching objects in metadata. Ask the user which object(s) ' +
          'to query, or list available objects via list_objects.',
      });
    }
    const snippet = SchemaRetriever.renderSnippet(hits);

    // 2. Plan generation
    const planMessages: ModelMessage[] = [
      {
        role: 'system',
        content:
          'You translate user data questions into a single ObjectQL query plan. ' +
          'Use ONLY the objects and fields listed in the schema context below. ' +
          'Never invent field names. If the question is ambiguous, pick the ' +
          'most likely interpretation and use a reasonable `limit`.\n\n' +
          'Filter operator hints:\n' +
          '  • For partial string matches (e.g. "task named Foo", "find X"), ' +
          'use case-insensitive substring matching with `$contains`: ' +
          '`{"subject": {"$contains": "Foo"}}`. Do NOT use equality unless ' +
          'the user clearly supplied the exact full value.\n' +
          '  • For numeric/date ranges use `$gt` / `$gte` / `$lt` / `$lte`.\n' +
          '  • For "is one of" use `$in: [...]`.\n' +
          '  • For exact equality just write the value: `{"status": "completed"}`.\n\n' +
          snippet,
      },
      { role: 'user', content: request },
    ];

    let plan: QueryPlan;
    try {
      const generated = await ctx.ai.generateObject(planMessages, QueryPlanSchema, {
        schemaName: 'ObjectQLQueryPlan',
        schemaDescription: 'A single ObjectQL find() query to answer the user request.',
      });
      plan = generated.object;
    } catch (err) {
      return JSON.stringify({
        error: `Failed to plan query: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 3. Validate the plan against the retrieved schema
    const matchedObject = hits.find(h => h.object.name === plan.objectName)?.object
      ?? hits[0].object;
    if (matchedObject.name !== plan.objectName) {
      return JSON.stringify({
        error:
          `Planned object "${plan.objectName}" is not in the retrieved schema. ` +
          `Available: ${hits.map(h => h.object.name).join(', ')}`,
      });
    }

    // 4. Execution
    const limit = Math.min(plan.limit ?? 20, maxLimit);
    let where: Record<string, unknown> | undefined;
    if (plan.whereJson) {
      try {
        const parsed = JSON.parse(plan.whereJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          where = parsed as Record<string, unknown>;
        } else {
          return JSON.stringify({
            plan,
            error: `whereJson must encode a JSON object, got: ${plan.whereJson}`,
          });
        }
      } catch (err) {
        return JSON.stringify({
          plan,
          error: `whereJson is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    try {
      const records = await ctx.dataEngine.find(plan.objectName, {
        where,
        fields: plan.fields ?? undefined,
        orderBy: plan.orderBy ?? undefined,
        limit,
        context: buildAiEngineContext(execCtx),
      });
      return JSON.stringify({
        plan: { ...plan, where },
        count: records.length,
        records,
      });
    } catch (err) {
      return JSON.stringify({
        plan,
        error: `Query execution failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };
}

/**
 * Register the `query_data` tool on the given {@link ToolRegistry}.
 *
 * Typically called from {@link AIServicePlugin.start} once the AI, metadata,
 * and data services are all available.
 */
export function registerQueryDataTool(
  registry: ToolRegistry,
  context: QueryDataToolContext,
): void {
  registry.register(QUERY_DATA_TOOL, createQueryDataHandler(context));
}
