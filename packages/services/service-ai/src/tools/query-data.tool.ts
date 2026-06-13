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
import { SchemaRetriever, type SchemaHit } from '../schema-retriever.js';
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
  /**
   * Fallback hard cap (ms) on a single query against a *federated* (external)
   * object, used when the datasource doesn't declare its own
   * `external.queryTimeoutMs`. A slow remote warehouse must never hang the AI
   * tool loop indefinitely (ADR-0015 §5.4 AI safety net). Default: 30_000.
   * Managed (local) objects are never timed out here — they're already bounded
   * by the injected `LIMIT`.
   */
  externalQueryTimeoutMs?: number;
  /**
   * Optional protocol shim for cross-source object enumeration. Mirrors the
   * fallback used by `list_objects`/`describe_object` — without it the
   * SchemaRetriever can't see ObjectQL SchemaRegistry objects such as
   * `sys_user`, and queries against system tables fall through to
   * "No matching objects in metadata".
   */
  protocol?: { getMetaItems(req: { type: string; packageId?: string; organizationId?: string }): Promise<unknown[]> };
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
  label: 'Query Data (Natural Language)',
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
  const retriever = new SchemaRetriever(ctx.metadata, {}, ctx.protocol);
  const maxLimit = ctx.maxLimit ?? 100;
  const externalTimeoutFallback = ctx.externalQueryTimeoutMs ?? 30_000;

  /** Load a single object definition by exact name, mirroring the dual-source
   *  lookup (MetadataManager → ObjectQL SchemaRegistry via protocol) so the
   *  current-object fallback can see system objects too. Never throws. */
  const loadObjectByName = async (name: string): Promise<SchemaHit['object'] | undefined> => {
    try {
      const direct = await ctx.metadata.getObject?.(name);
      if (direct && typeof direct === 'object' && (direct as { name?: string }).name) {
        return direct as SchemaHit['object'];
      }
    } catch {
      // fall through to protocol enumeration
    }
    if (ctx.protocol?.getMetaItems) {
      try {
        const all = await ctx.protocol.getMetaItems({ type: 'object' });
        const arr = Array.isArray(all)
          ? all
          : (all && typeof all === 'object' && Array.isArray((all as { items?: unknown }).items)
            ? (all as { items: unknown[] }).items
            : []);
        const found = (arr as Array<{ name?: string }>).find(o => o?.name === name);
        if (found) return found as SchemaHit['object'];
      } catch {
        // ignore — caller treats undefined as "not found"
      }
    }
    return undefined;
  };

  /** Resolve a federated object's per-query timeout (datasource-declared,
   *  else the tool fallback). Never throws — degrades to the fallback. */
  const resolveExternalTimeout = async (datasource: string): Promise<number> => {
    try {
      const ds = (await ctx.metadata.get?.('datasource', datasource)) as
        | { external?: { queryTimeoutMs?: number } }
        | undefined;
      return ds?.external?.queryTimeoutMs ?? externalTimeoutFallback;
    } catch {
      return externalTimeoutFallback;
    }
  };

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
    let hits = await retriever.retrieve(request);
    // Fallback: when keyword retrieval finds nothing (e.g. a non-English
    // request, or one that says "this object" without naming it), target the
    // object the user is currently viewing if the UI supplied one.
    if (hits.length === 0 && execCtx?.currentObjectName) {
      const current = await loadObjectByName(execCtx.currentObjectName);
      if (current) hits = [{ object: current, score: 1 }];
    }
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
    // Federated objects hit a remote production DB — bound the wait so a slow
    // warehouse can't hang the tool loop. Managed objects skip this entirely.
    const isExternal = matchedObject.external !== undefined;
    try {
      const findPromise = ctx.dataEngine.find(plan.objectName, {
        where,
        fields: plan.fields ?? undefined,
        orderBy: plan.orderBy ?? undefined,
        limit,
        context: buildAiEngineContext(execCtx),
      });
      const records = isExternal
        ? await withTimeout(
            findPromise,
            await resolveExternalTimeout(matchedObject.datasource ?? 'default'),
            plan.objectName,
          )
        : await findPromise;
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
 * Bound a promise with a timeout. On expiry, rejects with a descriptive error
 * (surfaced to the model as a query failure). The underlying `find` is not
 * cancellable, so it may complete in the background — that's acceptable for a
 * safety net whose job is to return control to the tool loop promptly.
 */
function withTimeout<T>(p: Promise<T>, ms: number, object: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `query on external object '${object}' exceeded the ${ms}ms timeout. ` +
            'Narrow the filter or lower the limit.',
        ),
      );
    }, ms);
    // Don't let the timer hold the event loop open on its own.
    (timer as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
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
