// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Actions-as-Tools (ADR-0011) — turn declarative {@link Action} metadata
 * into AI-callable tools so an agent can not only **read** the user's data
 * (via `query_data` / `data_explorer`) but also **act** on it.
 *
 * Exposure is **opt-in** (ADR-0011): an action becomes a tool only when its
 * metadata sets `ai.exposed === true`, in which case `ai.description` (the
 * LLM-facing contract) is required by the spec. There is no heuristic
 * auto-exposure — in an AI-authoring world the opt-in flag is the governance
 * gate between "an action exists" and "the agent fleet may invoke it".
 *
 * Supported dispatch types: `script` (via {@link IDataEngine.executeAction} —
 * the same dispatcher Studio's row-toolbar buttons use), `api` (HTTP call to
 * the action `target`), and `flow` (automation runner). UI-only types
 * (`url`, `modal`, `form`) have no headless path and are never exposed.
 *
 * Destructive actions (`confirmText`, `mode:'delete'`, `variant:'danger'`,
 * or `ai.requiresConfirmation:true`) route through the HITL approval queue
 * when it is wired (`enableActionApproval` + `aiService`); otherwise they are
 * skipped. An author may assert a destructive-looking action is safe by
 * setting `ai.requiresConfirmation:false` (the bridge logs a warning).
 *
 * The tool's JSON Schema is materialised from `action.params[]`, resolving
 * field-backed params (`{ field: 'priority' }`) against the owning object so
 * the LLM sees the same type/options/required constraints the modal dialog
 * would render, then refined by `ai.paramHints`.
 */

import type {
  AIToolDefinition,
  IAutomationService,
  IDataEngine,
  IMetadataService,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { Action, ActionParam } from '@objectstack/spec/ui';
import type { ToolHandler, ToolRegistry, ToolExecutionContext } from './tool-registry.js';

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
  /**
   * AI service used to enqueue HITL approvals for dangerous actions.
   * When supplied together with `enableActionApproval: true`, actions
   * that would otherwise be skipped on safety grounds (`confirmText`,
   * `mode:'delete'`, `variant:'danger'`) are registered as tools whose
   * handler proposes a pending action and returns
   * `{ status: 'pending_approval' }` instead of executing.
   */
  aiService?: {
    proposePendingAction?: (input: {
      objectName: string;
      actionName: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      conversationId?: string;
      messageId?: string;
      proposedBy?: string;
    }) => Promise<{ id: string }>;
    registerPendingActionDispatcher?: (
      toolName: string,
      dispatch: (input: Record<string, unknown>) => Promise<unknown>,
    ) => void;
  };
  /**
   * Opt into the HITL approval queue for dangerous actions. Default
   * is `false` (safer: dangerous actions stay invisible to the LLM
   * until an operator explicitly enables approval routing).
   */
  enableActionApproval?: boolean;
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
/**
 * True when an AI invocation of this action must be gated behind human
 * confirmation (HITL approval queue) rather than dispatched directly.
 *
 * The author's explicit `ai.requiresConfirmation` wins. When unset, an action
 * is treated as confirmation-requiring if it looks destructive (`confirmText`
 * set, `mode:'delete'`, or `variant:'danger'`). Exported so Studio's
 * AI-exposure surface can highlight which actions require approval.
 */
export function actionRequiresApproval(action: Action): boolean {
  const override = action.ai?.requiresConfirmation;
  if (override !== undefined) return override;
  return Boolean(
    action.confirmText || action.mode === 'delete' || action.variant === 'danger',
  );
}

/**
 * True when an action *looks* destructive by heuristic, independent of any
 * `ai.requiresConfirmation` override. Used to detect the "author asserted a
 * destructive action is safe" case so the bridge can warn.
 */
function actionLooksDestructive(action: Action): boolean {
  return Boolean(
    action.confirmText || action.mode === 'delete' || action.variant === 'danger',
  );
}

export function actionSkipReason(
  action: Action,
  ctx?: {
    automation?: IAutomationService;
    apiClient?: ApiActionClient;
    apiBaseUrl?: string;
    enableActionApproval?: boolean;
    aiService?: ActionToolsContext['aiService'];
  },
): string | null {
  // ADR-0011: opt-in. An action is exposed only when it explicitly says so.
  if (action.ai?.exposed !== true) {
    return 'not AI-exposed (set ai.exposed:true to opt in)';
  }
  // Spec requires a description when exposed; be defensive against raw
  // (non-Zod-parsed) metadata reaching this path.
  if (!action.ai.description) {
    return 'ai.exposed:true but ai.description is missing';
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
  // Safety: actions requiring confirmation must route through the HITL queue.
  // When the caller has opted in (and wired aiService), we *register* them and
  // route to the queue; otherwise we skip — an exposed action whose author did
  // not assert it safe must never run unattended.
  if (actionRequiresApproval(action)) {
    const approvalReady =
      ctx?.enableActionApproval === true && Boolean(ctx?.aiService?.proposePendingAction);
    if (!approvalReady) {
      const why =
        action.ai?.requiresConfirmation === true
          ? 'ai.requiresConfirmation:true'
          : action.confirmText
            ? 'confirmText set'
            : action.mode === 'delete'
              ? "mode='delete'"
              : "variant='danger'";
      return `requires confirmation (${why}) — wire HITL approval (enableActionApproval) or set ai.requiresConfirmation:false to assert it is safe`;
    }
  }
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

  // ADR-0011: apply per-parameter AI hints last so they refine the LLM-facing
  // schema (tighter enum, clearer description, examples) without touching the
  // UI-facing field metadata. Spec validation guarantees keys reference a real
  // param (or the injected `recordId`).
  const hints = action.ai?.paramHints;
  if (hints) {
    for (const [key, hint] of Object.entries(hints)) {
      const target = properties[key] ?? (properties[key] = { type: 'string' });
      if (hint.description !== undefined) target.description = hint.description;
      if (hint.enum !== undefined) target.enum = hint.enum;
      if (hint.examples !== undefined) target.examples = hint.examples;
    }
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

/**
 * Defensive fallback description for raw (non-Zod-parsed) metadata that
 * somehow reaches the bridge with `ai.exposed:true` but no `ai.description`.
 * Normal authored actions never hit this — the spec requires a description
 * when exposed. We deliberately do NOT derive descriptions from the UI label
 * for the happy path (ADR-0011 Non-Goal).
 */
function fallbackDescription(action: Action, ownerObject: ObjectDef | undefined): string {
  const label =
    typeof action.label === 'string' ? action.label : action.name.replace(/_/g, ' ');
  const targetLabel = ownerObject?.label ?? action.objectName ?? ownerObject?.name;
  return `${label}${targetLabel ? ` — operates on ${targetLabel}` : ''}.`;
}

/** Top-level property names of a JSON-Schema object, if any. */
function outputSchemaKeys(schema: Record<string, unknown> | undefined): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const props = (schema as { properties?: unknown }).properties;
  if (!props || typeof props !== 'object') return [];
  return Object.keys(props as Record<string, unknown>);
}

/**
 * Compose the LLM-facing tool description: the authored `ai.description`
 * (required when exposed), plus a compact "Returns:" line summarising
 * `ai.outputSchema` so the model can reason about chaining the result.
 */
function buildToolDescription(action: Action, ownerObject: ObjectDef | undefined): string {
  const base = action.ai?.description ?? fallbackDescription(action, ownerObject);
  const keys = outputSchemaKeys(action.ai?.outputSchema);
  if (keys.length > 0) {
    return `${base}\n\nReturns an object with: ${keys.join(', ')}.`;
  }
  return base;
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
  // NOTE: skip eligibility is decided by the caller (registerActionsAsTools)
  // with full context (apiClient, automation, HITL approval wiring). This
  // function only checks the *structural* invariants that make a
  // definition impossible to build.
  if (action.ai?.exposed !== true) return null;
  if (action.type === 'url' || action.type === 'modal' || action.type === 'form') return null;
  return {
    name: actionToolName(action, toolPrefix),
    description: buildToolDescription(action, ownerObject),
    parameters: buildParametersSchema(action, ownerObject, allObjects),
    ...(action.ai.category ? { category: action.ai.category } : {}),
    ...(action.ai.outputSchema ? { outputSchema: action.ai.outputSchema } : {}),
    ...(action.objectName ? { objectName: action.objectName } : {}),
    requiresConfirmation: actionRequiresApproval(action),
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
    delete: async (object, ids) => {
      if (!Array.isArray(ids) || ids.length === 0) return 0;
      // Loop scalar deletes — engine.delete prioritises a scalar `id`
      // extracted from `where.id` over the `multi:true` branch, so passing
      // `{ where: { id: { $in: [...] } } }` breaks at the driver layer.
      let count = 0;
      for (const id of ids) {
        await engine.delete(object, { where: { id } });
        count++;
      }
      return count;
    },
  };
}

/**
 * Shared entry-point: load record (when row-context), assemble user
 * params, then delegate to the type-specific executor.
 */
function createActionToolHandler(
  action: Action,
  ctx: ActionToolsContext,
): ToolHandler {
  const fallbackPrincipal = ctx.principal ?? { id: 'ai_agent', name: 'AI Assistant' };
  const requiresRecord =
    Array.isArray(action.locations) &&
    action.locations.some(
      l => l === 'list_item' || l === 'record_header' || l === 'record_more' || l === 'record_related',
    );

  return async (args, execCtx) => {
    // Per-request execution context wins over the static principal so
    // every audit/dispatch entry attributes the work to the real user
    // when one is known. Falls back to the registration-time principal
    // (or the synthetic `ai_agent`) for unauthenticated callers.
    const principal = execCtx?.actor
      ? { id: execCtx.actor.id, name: execCtx.actor.name }
      : fallbackPrincipal;
    const engineCtx = buildActionEngineContext(execCtx);
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
    if (!target && action.type !== 'script') {
      result.error = 'Action has no target.';
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
        // RLS engages here too — if the actor can't see the record,
        // the agent gets a "not found" error instead of leaking data.
        const found = await ctx.dataEngine.find(objectName, {
          where: { id: recordId },
          limit: 1,
          context: engineCtx,
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

    // ── HITL routing ──────────────────────────────────────────────
    // When the action is dangerous AND approval is wired, persist a
    // pending request and return the "pending" envelope instead of
    // dispatching. The dispatcher itself was pre-registered with
    // aiService.registerPendingActionDispatcher() at registration time
    // so approval re-runs the exact same code path.
    if (
      ctx.enableActionApproval &&
      actionRequiresApproval(action) &&
      ctx.aiService?.proposePendingAction
    ) {
      try {
        const toolName = `${ctx.toolPrefix ?? 'action_'}${action.name}`;
        const { id } = await ctx.aiService.proposePendingAction({
          objectName: objectName!,
          actionName: action.name,
          toolName,
          toolInput: args as Record<string, unknown>,
          conversationId: execCtx?.conversationId,
          messageId: execCtx?.messageId,
          proposedBy: principal.id,
        });
        const pending: ActionInvocationResult & {
          status?: string;
          pendingActionId?: string;
        } = {
          ok: true,
          action: action.name,
          objectName,
          recordId,
          status: 'pending_approval',
          pendingActionId: id,
          message:
            `Action '${action.name}' is destructive and requires human approval. ` +
            `Proposal queued as ${id}. ` +
            `An operator must approve via Studio's pending-actions inbox before it runs. ` +
            `Do NOT call this tool again for the same intent — wait for the operator.`,
        };
        return JSON.stringify(pending);
      } catch (err) {
        result.error = `Failed to enqueue approval: ${err instanceof Error ? err.message : String(err)}`;
        return JSON.stringify(result);
      }
    }

    try {
      let out: unknown;
      if (action.type === 'api') {
        out = await dispatchApiAction(action, ctx, userParams, record, recordId);
      } else if (action.type === 'flow') {
        out = await dispatchFlowAction(action, ctx, userParams, record, principal);
      } else {
        // 'script' (default) — existing behaviour.
        out = await dispatchScriptAction(action, ctx, userParams, record, principal);
      }
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

/**
 * Translate the AI-side {@link ToolExecutionContext} into an ObjectQL
 * {@link ExecutionContext} for record lookups inside action handlers.
 * Mirrors `data-tools.ts#buildEngineContext` — kept local so this file
 * has no inter-tool dependency.
 */
function buildActionEngineContext(ctx?: ToolExecutionContext): ExecutionContext {
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

async function dispatchScriptAction(
  action: Action,
  ctx: ActionToolsContext,
  params: Record<string, unknown>,
  record: Record<string, unknown> | undefined,
  principal: { id: string; name?: string },
): Promise<unknown> {
  const engineAdapter = buildHandlerEngineAdapter(ctx.dataEngine);
  const handlerCtx = { record, user: principal, engine: engineAdapter, params };
  return await (ctx.dataEngine as IDataEngine & {
    executeAction?: (o: string, a: string, c: unknown) => Promise<unknown>;
  }).executeAction?.(action.objectName!, action.target!, handlerCtx);
}

/**
 * Compose the HTTP body for a `type:'api'` action.
 *
 * Order of merge (last-wins):
 *   1. user-collected params (wrapped if `bodyShape.wrap` is set)
 *   2. recordId — placed flat at `recordIdParam` (using `recordIdField`
 *      to pick the value off the record, defaulting to `id`)
 *   3. `bodyExtra` constants (always win)
 */
export function buildApiRequestBody(
  action: Action,
  args: Record<string, unknown>,
  record: Record<string, unknown> | undefined,
  recordId: string | undefined,
): Record<string, unknown> {
  const shape = action.bodyShape;
  const wrapKey =
    shape && typeof shape === 'object' && 'wrap' in shape && typeof shape.wrap === 'string'
      ? shape.wrap
      : undefined;
  const body: Record<string, unknown> = wrapKey ? { [wrapKey]: { ...args } } : { ...args };

  if (action.recordIdParam) {
    const idField = action.recordIdField ?? 'id';
    const idValue = record ? record[idField] : recordId;
    if (idValue !== undefined) body[action.recordIdParam] = idValue;
  }

  if (action.bodyExtra && typeof action.bodyExtra === 'object') {
    Object.assign(body, action.bodyExtra as Record<string, unknown>);
  }
  return body;
}

async function dispatchApiAction(
  action: Action,
  ctx: ActionToolsContext,
  params: Record<string, unknown>,
  record: Record<string, unknown> | undefined,
  recordId: string | undefined,
): Promise<unknown> {
  const client =
    ctx.apiClient ??
    (ctx.apiBaseUrl
      ? createFetchApiClient({ baseUrl: ctx.apiBaseUrl, headers: ctx.apiHeaders })
      : undefined);
  if (!client) {
    throw new Error('No apiClient configured for type:"api" action dispatch.');
  }
  const method = (action.method ?? 'POST') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  const body = buildApiRequestBody(action, params, record, recordId);
  return await client.request({
    url: action.target!,
    method,
    body: method === 'GET' || method === 'DELETE' ? undefined : body,
    headers: ctx.apiHeaders,
  });
}

async function dispatchFlowAction(
  action: Action,
  ctx: ActionToolsContext,
  params: Record<string, unknown>,
  record: Record<string, unknown> | undefined,
  principal: { id: string; name?: string },
): Promise<unknown> {
  if (!ctx.automation) {
    throw new Error('No automation service available for type:"flow" action dispatch.');
  }
  const result = await ctx.automation.execute(action.target!, {
    triggerData: { record, params, user: principal, action: action.name },
  } as Parameters<IAutomationService['execute']>[1]);
  if (result && typeof result === 'object' && 'success' in result && result.success === false) {
    throw new Error(
      `Flow '${action.target}' failed: ${(result as { error?: string }).error ?? 'unknown error'}`,
    );
  }
  return result;
}

/**
 * Default fetch-based {@link ApiActionClient}. Resolves relative `url`s
 * against `baseUrl`, merges static `headers`, throws on non-2xx, returns
 * the parsed JSON body (or `null` if empty).
 */
export function createFetchApiClient(options: {
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}): ApiActionClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('createFetchApiClient: no global fetch available; pass options.fetch.');
  }
  return {
    async request({ url, method, body, headers }) {
      const absolute = /^https?:\/\//.test(url) ? url : `${(options.baseUrl ?? '').replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
      const res = await fetchImpl(absolute, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
          ...(headers ?? {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      const parsed = text ? safeJsonParse(text) : null;
      if (!res.ok) {
        const msg =
          parsed && typeof parsed === 'object' && 'error' in parsed
            ? (parsed as { error: unknown }).error
            : text;
        throw new Error(`${method} ${absolute} → ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      }
      return parsed;
    },
  };
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
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
  /**
   * Non-fatal lint advisories surfaced while building tools — e.g. an author
   * exposed a destructive-looking action and asserted it safe via
   * `ai.requiresConfirmation:false`. Callers (the plugin) log these.
   */
  warnings: Array<{ action: string; warning: string }>;
}> {
  const objects = (await context.metadata.listObjects()) as ObjectDef[];
  const objMap = new Map<string, ObjectDef>(
    objects.filter((o): o is ObjectDef => Boolean(o?.name)).map(o => [o.name, o]),
  );

  const registered: string[] = [];
  const skipped: Array<{ action: string; reason: string }> = [];
  const warnings: Array<{ action: string; warning: string }> = [];
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

      const reason = actionSkipReason(normalized, {
        automation: context.automation,
        apiClient: context.apiClient,
        apiBaseUrl: context.apiBaseUrl,
        enableActionApproval: context.enableActionApproval,
        aiService: context.aiService,
      });
      if (reason !== null) {
        skipped.push({ action: normalized.name, reason });
        continue;
      }

      // Lint guardrail: the action is exposed and will run unattended, yet it
      // looks destructive and the author explicitly asserted it safe. Register
      // it (the author's call) but make the assertion visible.
      if (actionLooksDestructive(normalized) && normalized.ai?.requiresConfirmation === false) {
        warnings.push({
          action: normalized.name,
          warning:
            'exposed destructive-looking action with ai.requiresConfirmation:false — ' +
            'it will run without human approval; confirm this is intended.',
        });
      }

      const definition = actionToToolDefinition(normalized, obj, objMap, prefix);
      if (!definition) continue;

      // Avoid colliding with already-registered tools (e.g. metadata tools).
      if (registry.has(definition.name)) {
        skipped.push({ action: normalized.name, reason: 'tool name already registered' });
        continue;
      }

      const handler = createActionToolHandler(normalized, context);
      registry.register(definition, handler);
      registered.push(definition.name);

      // Pre-register the *bypass-approval* dispatcher under the same tool
      // name so AIService.approvePendingAction can re-run the action by
      // looking up the dispatcher and invoking it with the original input.
      if (
        context.enableActionApproval &&
        actionRequiresApproval(normalized) &&
        context.aiService?.registerPendingActionDispatcher
      ) {
        // Build a parallel context with approval *disabled* so the handler
        // executes directly instead of re-queuing.
        const bypassCtx: ActionToolsContext = {
          ...context,
          enableActionApproval: false,
        };
        const directHandler = createActionToolHandler(normalized, bypassCtx);
        context.aiService.registerPendingActionDispatcher(
          definition.name,
          async (input) => {
            const raw = await directHandler(input);
            // Handlers return a JSON string envelope; parse for the
            // approval pathway so the row's `result` is structured.
            let parsed: unknown = raw;
            try {
              parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch {
              parsed = raw;
            }
            // Surface handler-level failures as exceptions so the
            // approval row flips to `failed` (not silently `executed`).
            if (
              parsed &&
              typeof parsed === 'object' &&
              'ok' in parsed &&
              (parsed as { ok?: unknown }).ok === false
            ) {
              const errMsg =
                (parsed as { error?: unknown }).error != null
                  ? String((parsed as { error?: unknown }).error)
                  : 'action handler reported failure';
              throw new Error(errMsg);
            }
            return parsed;
          },
        );
      }
    }
  }

  return { registered, skipped, warnings };
}
