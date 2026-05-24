// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Actions-as-Tools — turn declarative {@link Action} metadata into
 * AI-callable tools so an agent can not only **read** the user's data
 * (via `query_data` / `data_explorer`) but also **act** on it.
 *
 * Phase 1 scope (this module):
 *   - Only `type: 'script'` actions are auto-exposed. Their handler is
 *     resolved through {@link IDataEngine.executeAction} (the same
 *     dispatcher used by Studio's "row toolbar" buttons), so the LLM
 *     ends up calling exactly the same business logic the UI does.
 *   - Skip any action that is dangerous (`confirmText`, `variant: 'danger'`,
 *     `mode: 'delete'`) — these require Phase 2 HITL plumbing.
 *   - Skip any action whose owner opted out via `aiExposed: false` (the
 *     hint is read from the action record but not formalised in the Zod
 *     schema yet; spec change is backwards-compatible additive).
 *
 * The tool's JSON Schema is materialised from `action.params[]`,
 * resolving field-backed params (`{ field: 'priority' }`) against the
 * owning object so the LLM sees the same type/options/required
 * constraints the modal dialog would render.
 */

import type {
  AIToolDefinition,
  IAutomationService,
  IDataEngine,
  IMetadataService,
} from '@objectstack/spec/contracts';
import type { Action, ActionParam } from '@objectstack/spec/ui';
import type { ToolHandler, ToolRegistry } from './tool-registry.js';

/** Minimal field shape we care about when resolving param types. */
interface FieldDef {
  type?: string;
  label?: string;
  required?: boolean;
  options?: Array<{ value: string; label?: unknown } | string>;
  description?: string;
}

/** Minimal object shape — same as what {@link SchemaRetriever} consumes. */
interface ObjectDef {
  name: string;
  label?: string;
  pluralLabel?: string;
  fields?: Record<string, FieldDef>;
  actions?: Action[];
}

/**
 * Dependencies needed to invoke an Action from the AI tool runtime.
 *
 * The `metadata` service is used at registration time to resolve param
 * field types; the `dataEngine` is used at call time to (a) load the
 * subject record when a `recordIdParam` is configured and (b) dispatch
 * to the registered handler via `executeAction`.
 *
 * `automation` enables `type:'flow'` actions to dispatch into the
 * automation service's flow runner. When omitted, flow actions are
 * skipped at registration time with a clear reason.
 *
 * `apiClient` (or `apiBaseUrl`) enables `type:'api'` actions to perform
 * an HTTP call to the action's `target` URL. The default client uses
 * the global `fetch` and prepends `apiBaseUrl` to relative `target`s.
 * Supply a custom client when you need bespoke auth, in-process
 * routing, or stubbing in tests.
 *
 * `principal` lets callers attribute AI-initiated mutations to a known
 * user id; it defaults to a synthetic `'ai_agent'` user so traces /
 * audit always have *some* actor.
 */
export interface ActionToolsContext {
  metadata: IMetadataService;
  dataEngine: IDataEngine;
  /** Automation service for `type:'flow'` action dispatch. Optional. */
  automation?: IAutomationService;
  /** Custom API client for `type:'api'` actions. Defaults to a fetch-based client. */
  apiClient?: ApiActionClient;
  /** Base URL prepended to relative `target` paths for `type:'api'` actions. */
  apiBaseUrl?: string;
  /** Extra HTTP headers (e.g. auth bearer) applied to every `type:'api'` call. */
  apiHeaders?: Record<string, string>;
  /** Synthetic user attribution for AI-initiated calls. */
  principal?: { id: string; name?: string };
  /** Tool-name prefix (default: `action_`). Keeps namespace separate from data tools. */
  toolPrefix?: string;
}

/**
 * Minimal HTTP client shape used by `type:'api'` action dispatch.
 *
 * Implementations are expected to return a JSON-deserialised body (or
 * `null` for empty responses) on 2xx, and throw on non-2xx so the tool
 * surfaces the failure to the LLM as a tool error.
 */
export interface ApiActionClient {
  request(input: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  }): Promise<unknown>;
}

/** Result returned to the LLM after invoking an action. */
interface ActionInvocationResult {
  ok: boolean;
  action: string;
  objectName?: string;
  recordId?: string;
  message?: string;
  result?: unknown;
  error?: string;
}

// ── Skip-list predicates ────────────────────────────────────────────

/**
 * Decide whether an action should be auto-exposed as a tool.
 *
 * Returns `null` when exposed, or a string reason when skipped.
 * Exported for tests and Studio "AI exposure" diagnostics.
 *
 * Supported types as of Phase 2: `script`, `api`, `flow`. Studio-only
 * UI types (`url`, `modal`, `form`) remain skipped — they have no
 * headless invocation path.
 */
export function actionSkipReason(
  action: Action,
  ctx?: { automation?: IAutomationService; apiClient?: ApiActionClient; apiBaseUrl?: string },
): string | null {
  if (action.aiExposed === false) {
    return 'opted-out via aiExposed:false';
  }
  // Skip Studio-only types (no headless invocation surface).
  if (action.type === 'url' || action.type === 'modal' || action.type === 'form') {
    return `type='${action.type}' is UI-only`;
  }
  if (action.type !== 'script' && action.type !== 'api' && action.type !== 'flow') {
    return `type='${action.type}' not supported`;
  }
  if (action.type === 'script' && !action.target && !action.body) {
    return 'no target or body';
  }
  if ((action.type === 'api' || action.type === 'flow') && !action.target) {
    return `type='${action.type}' requires a target`;
  }
  // Wiring availability checks — only meaningful when ctx is supplied.
  if (ctx) {
    if (action.type === 'flow' && !ctx.automation) {
      return 'no automation service available';
    }
    if (action.type === 'api' && !ctx.apiClient && !ctx.apiBaseUrl) {
      return 'no apiClient or apiBaseUrl configured';
    }
  }
  // Safety: dangerous actions require explicit human approval.
  if (action.confirmText) return 'requires confirmation (confirmText set)';
  if (action.mode === 'delete') return "mode='delete' — destructive";
  if (action.variant === 'danger') return "variant='danger' — destructive";
  return null;
}

// ── Param → JSON Schema ─────────────────────────────────────────────

/**
 * Map an ObjectStack field type to a JSON-Schema primitive type.
 *
 * Intentionally conservative — anything we don't recognise becomes
 * `string` so the LLM can still pass *something*. Handlers should
 * re-validate via Zod / runtime checks anyway.
 */
function fieldTypeToJsonType(t: string | undefined): 'string' | 'number' | 'boolean' | 'array' {
  switch (t) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating':
    case 'slider':
    case 'autonumber':
      return 'number';
    case 'boolean':
    case 'toggle':
      return 'boolean';
    case 'multiselect':
    case 'checkboxes':
    case 'tags':
      return 'array';
    default:
      return 'string';
  }
}

/**
 * Resolve a single {@link ActionParam} into a `(name, jsonSchema, required)`
 * tuple by consulting the owning object's field definition when the param
 * uses field-backing.
 */
function resolveParam(
  param: ActionParam,
  ownerObject: ObjectDef | undefined,
  allObjects: Map<string, ObjectDef>,
): { name: string; schema: Record<string, unknown>; required: boolean } | null {
  const fieldRef = param.field;
  const owner =
    param.objectOverride && allObjects.get(param.objectOverride)
      ? allObjects.get(param.objectOverride)
      : ownerObject;
  const field = fieldRef ? owner?.fields?.[fieldRef] : undefined;

  const name = param.name ?? fieldRef;
  if (!name) return null;

  const type = param.type ?? field?.type;
  const jsonType = fieldTypeToJsonType(type);
  const schema: Record<string, unknown> = { type: jsonType };

  const label = typeof param.label === 'string' ? param.label : field?.label;
  const help = param.helpText ?? field?.description;
  const description = [label, help].filter(Boolean).join(' — ') || undefined;
  if (description) schema.description = description;

  // Enum sourcing — explicit override wins, otherwise field options
  const optionSource = param.options ?? field?.options;
  if (Array.isArray(optionSource) && optionSource.length > 0) {
    const values = optionSource
      .map(o => (typeof o === 'string' ? o : (o as { value?: string }).value))
      .filter((v): v is string => typeof v === 'string');
    if (values.length > 0) {
      schema.enum = jsonType === 'array' ? undefined : values;
      if (jsonType === 'array') {
        schema.items = { type: 'string', enum: values };
      }
    }
  } else if (jsonType === 'array') {
    schema.items = { type: 'string' };
  }

  if (param.defaultValue !== undefined) {
    schema.default = param.defaultValue;
  }

  const required = Boolean(param.required ?? field?.required ?? false);
  return { name, schema, required };
}

/**
 * Build the JSON Schema body for an action's `parameters` field.
 *
 * In addition to user-declared params, we always inject a `recordId`
 * argument when the action is bound to an object — the LLM needs *some*
 * way to say "complete _this_ task". The argument is optional for
 * actions that work without a record (`list_toolbar` only) and required
 * when the action declares `recordIdParam`.
 */
function buildParametersSchema(
  action: Action,
  ownerObject: ObjectDef | undefined,
  allObjects: Map<string, ObjectDef>,
): AIToolDefinition['parameters'] {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  // Inject recordId for object-bound, row-context actions
  const isRowContext =
    Array.isArray(action.locations) &&
    action.locations.some(l => l === 'list_item' || l === 'record_header' || l === 'record_more' || l === 'record_related');
  if (action.objectName && isRowContext) {
    properties.recordId = {
      type: 'string',
      description: `The ${action.objectName} record id to act on.`,
    };
    // Mark required if action explicitly references a row field for id seeding
    if (action.recordIdParam || action.recordIdField) {
      required.push('recordId');
    }
  }

  for (const param of action.params ?? []) {
    const resolved = resolveParam(param, ownerObject, allObjects);
    if (!resolved) continue;
    properties[resolved.name] = resolved.schema;
    if (resolved.required) required.push(resolved.name);
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

// ── Tool name + description ─────────────────────────────────────────

/** Compute the AI tool name for a given action (prefixed for namespacing). */
export function actionToolName(action: Action, prefix = 'action_'): string {
  return `${prefix}${action.name}`;
}

function describeAction(action: Action, ownerObject: ObjectDef | undefined): string {
  const label =
    typeof action.label === 'string'
      ? action.label
      : action.name.replace(/_/g, ' ');
  const target = action.objectName ?? ownerObject?.name;
  const targetLabel = ownerObject?.label ?? target;
  const parts: string[] = [];
  parts.push(`${label}${targetLabel ? ` — operates on ${targetLabel}` : ''}.`);
  if (action.successMessage && typeof action.successMessage === 'string') {
    parts.push(`On success: ${action.successMessage}`);
  }
  if (action.mode) parts.push(`Mode: ${action.mode}.`);
  parts.push(
    'Use this when the user asks to perform this operation in natural language.',
  );
  return parts.join(' ');
}

// ── Builders ────────────────────────────────────────────────────────

/**
 * Convert a single {@link Action} into a complete {@link AIToolDefinition}.
 *
 * Returns `null` when the action is filtered out by {@link actionSkipReason}.
 */
export function actionToToolDefinition(
  action: Action,
  ownerObject: ObjectDef | undefined,
  allObjects: Map<string, ObjectDef>,
  toolPrefix = 'action_',
): AIToolDefinition | null {
  if (actionSkipReason(action) !== null) return null;
  return {
    name: actionToolName(action, toolPrefix),
    description: describeAction(action, ownerObject),
    parameters: buildParametersSchema(action, ownerObject, allObjects),
  };
}

// ── Handler / dispatch ─────────────────────────────────────────────

/**
 * Adapter that wraps {@link IDataEngine} into the shape user-authored
 * action handlers expect (see `examples/app-todo/src/actions/task.handlers.ts`).
 *
 * Handlers in the wild use a pseudo-ORM `engine.update(obj, id, data)`
 * convention, while {@link IDataEngine.update} takes `(obj, data, opts)`
 * with a `where`-style options bag. We adapt at the boundary so existing
 * Studio-side handlers run unchanged.
 */
function buildHandlerEngineAdapter(engine: IDataEngine): {
  update: (object: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
  insert: (object: string, data: Record<string, unknown>) => Promise<unknown>;
  find: (object: string, where: Record<string, unknown>) => Promise<unknown[]>;
  delete: (object: string, ids: string[]) => Promise<unknown>;
} {
  return {
    update: (object, id, data) =>
      engine.update(object, { ...data, id }, { where: { id } }),
    insert: (object, data) => engine.insert(object, data),
    find: (object, where) => engine.find(object, { where }),
    delete: (object, ids) =>
      engine.delete(object, { where: { id: ids.length === 1 ? ids[0] : { $in: ids } } }),
  };
}

/**
 * Create the runtime handler for a single action tool.
 *
 * Steps:
 * 1. Pull `recordId` (and other params) from the tool call.
 * 2. When the action is row-context and `recordId` is provided, load the
 *    record so the handler's `ctx.record` is populated like Studio would.
 * 3. Resolve the underlying handler via `dataEngine.executeAction` and
 *    pass the conventional `{ record, engine, user, params }` ctx.
 * 4. Wrap result/error in a stable `ActionInvocationResult` JSON envelope
 *    that the LLM can summarise.
 */
function createActionToolHandler(
  action: Action,
  ctx: ActionToolsContext,
): ToolHandler {
  const principal = ctx.principal ?? { id: 'ai_agent', name: 'AI Assistant' };
  const engineAdapter = buildHandlerEngineAdapter(ctx.dataEngine);
  const requiresRecord =
    Array.isArray(action.locations) &&
    action.locations.some(
      l => l === 'list_item' || l === 'record_header' || l === 'record_more' || l === 'record_related',
    );

  return async (args) => {
    const objectName = action.objectName;
    const target = action.target;
    const result: ActionInvocationResult = {
      ok: false,
      action: action.name,
      objectName,
    };

    if (!objectName) {
      result.error = 'Action has no objectName; cannot dispatch.';
      return JSON.stringify(result);
    }
    if (!target) {
      result.error = 'Action has no target handler.';
      return JSON.stringify(result);
    }

    const recordId =
      typeof args.recordId === 'string' && args.recordId.length > 0
        ? args.recordId
        : undefined;

    let record: Record<string, unknown> | undefined;
    if (requiresRecord) {
      if (!recordId) {
        result.error =
          'recordId is required for this action — supply the id of the ' +
          `${objectName} record to act on (use query_data first if you don't have it).`;
        return JSON.stringify(result);
      }
      try {
        const found = await ctx.dataEngine.find(objectName, {
          where: { id: recordId },
          limit: 1,
        });
        record = (found as Array<Record<string, unknown>>)[0];
        if (!record) {
          result.error = `Record ${recordId} not found in ${objectName}.`;
          return JSON.stringify(result);
        }
        result.recordId = recordId;
      } catch (err) {
        result.error = `Failed to load record: ${err instanceof Error ? err.message : String(err)}`;
        return JSON.stringify(result);
      }
    }

    // Strip recordId from params before forwarding so handlers receive only
    // user-collected fields (mirroring the Studio modal-submit shape).
    const { recordId: _omit, ...userParams } = args as Record<string, unknown>;

    try {
      const handlerCtx = {
        record,
        user: principal,
        engine: engineAdapter,
        params: userParams,
      };
      const out = await (ctx.dataEngine as IDataEngine & {
        executeAction?: (o: string, a: string, c: unknown) => Promise<unknown>;
      }).executeAction?.(objectName, target, handlerCtx);

      result.ok = true;
      result.result = out ?? null;
      const successMsg =
        typeof action.successMessage === 'string' ? action.successMessage : undefined;
      result.message = successMsg ?? `Action '${action.name}' executed successfully.`;
      return JSON.stringify(result);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      return JSON.stringify(result);
    }
  };
}

// ── Registration ──────────────────────────────────────────────────

/**
 * Walk every registered object in the {@link IMetadataService}, pick out
 * each object's actions, and register the ones that pass {@link actionSkipReason}
 * as AI tools.
 *
 * Returns the list of registered tool names and a parallel list of
 * `{ action, reason }` for actions that were intentionally skipped —
 * useful for Studio's "AI exposure" diagnostics surface.
 */
export async function registerActionsAsTools(
  registry: ToolRegistry,
  context: ActionToolsContext,
): Promise<{
  registered: string[];
  skipped: Array<{ action: string; reason: string }>;
}> {
  const objects = (await context.metadata.listObjects()) as ObjectDef[];
  const objMap = new Map<string, ObjectDef>(
    objects.filter((o): o is ObjectDef => Boolean(o?.name)).map(o => [o.name, o]),
  );

  const registered: string[] = [];
  const skipped: Array<{ action: string; reason: string }> = [];
  const prefix = context.toolPrefix ?? 'action_';

  for (const obj of objects) {
    if (!obj?.actions || !Array.isArray(obj.actions)) continue;
    for (const action of obj.actions) {
      if (!action || typeof action.name !== 'string') continue;
      // Backfill objectName if it was elided (defineStack does this normally,
      // but be defensive when metadata comes from external sources).
      const normalized: Action = {
        ...action,
        objectName: action.objectName ?? obj.name,
      };

      const reason = actionSkipReason(normalized);
      if (reason !== null) {
        skipped.push({ action: normalized.name, reason });
        continue;
      }

      const definition = actionToToolDefinition(normalized, obj, objMap, prefix);
      if (!definition) continue;

      // Avoid colliding with already-registered tools (e.g. metadata tools).
      if (registry.has(definition.name)) {
        skipped.push({ action: normalized.name, reason: 'tool name already registered' });
        continue;
      }

      registry.register(definition, createActionToolHandler(normalized, context));
      registered.push(definition.name);
    }
  }

  return { registered, skipped };
}
