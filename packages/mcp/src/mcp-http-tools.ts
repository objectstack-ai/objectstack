// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * mcp-http-tools — object CRUD exposed as MCP tools, for EVERY transport.
 *
 * These are the tools an external agent (Claude Desktop / Cursor) drives, over
 * the network or down a local pipe. Every operation MUST run under the caller's
 * resolved principal: we never touch the data engine directly here, all
 * reads/writes go through an injected {@link McpDataBridge} that the host wires
 * to the SAME permission/RLS-enforcing path the REST API uses. This module owns
 * the tool *shape*; the bridge owns *execution + security*.
 *
 * [#8034] The file name says `http` for historical reasons only, and believing
 * it cost this package a transport. Until #8034 {@link registerObjectTools} and
 * {@link registerActionTools} were called from exactly one place —
 * `MCPServerRuntime.handleHttpRequest()`, on the throwaway per-request server —
 * so the LONG-LIVED server behind the stdio transport reached `tools/list` with
 * an empty registry and answered `-32601` while its `initialize` result
 * advertised `capabilities.tools`. {@link wireBridgeTools} is now the one
 * composition both transports call, so a tool added here reaches both by
 * construction and neither can silently serve a different set.
 *
 * The bridge, not the transport, is what varies: the HTTP host binds it to the
 * request's ExecutionContext, the stdio host to the `OS_MCP_STDIO_API_KEY`
 * identity (re-resolved per call, ADR-0101). Both hand the same interface here.
 *
 * SECURITY (zero-tolerance):
 *  - System objects (`sys_*`) are NOT exposed by default — fail-closed guard on
 *    every tool that takes an object name, independent of the bridge.
 *  - The bridge is bound to the caller's principal; tools cannot widen it.
 *  - Errors are returned as tool errors (text), never thrown across the wire,
 *    and never include secrets.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
} from '@objectstack/spec/ai';
import {
  validateExpression,
  introspectScope,
  inferExpressionType,
  type FieldRole,
} from '@objectstack/formula';

export interface McpObjectSummary {
  name: string;
  label?: string;
  fieldCount?: number;
}

/**
 * Data access seam for the HTTP MCP tools. Implemented by the runtime/dispatcher
 * so execution flows through the existing permission + RLS path bound to the
 * caller's ExecutionContext. Every method runs AS the authenticated principal.
 */
export interface McpDataBridge {
  listObjects(): Promise<McpObjectSummary[]>;
  describeObject(name: string): Promise<unknown | null>;
  query(
    object: string,
    opts: {
      where?: Record<string, unknown>;
      fields?: string[];
      limit?: number;
      offset?: number;
      orderBy?: Array<{ field: string; order: 'asc' | 'desc' }>;
    },
  ): Promise<unknown>;
  get(object: string, id: string): Promise<unknown>;
  create(object: string, data: Record<string, unknown>): Promise<unknown>;
  update(object: string, id: string, data: Record<string, unknown>): Promise<unknown>;
  remove(object: string, id: string): Promise<unknown>;
  /**
   * GROUP BY aggregation through the ObjectQL engine's read path (RLS + the
   * FLS aggregate-input gate). OPTIONAL: a runtime that cannot route
   * aggregation through the engine simply omits it and the
   * `aggregate_records` tool is not registered (graceful degradation, same
   * contract as {@link McpActionBridge}).
   *
   * `groupBy` / `aggregations` are the engine's own declarations
   * (`EngineAggregateOptions`, #8032) rather than a hand-mirrored copy: the
   * tool's zod schema below already enforces exactly these shapes at the
   * ingress, and a private restatement is where the two had drifted — this
   * interface used to declare `function: string` against the six-name enum
   * and a `distinct?: boolean` the engine retired (#6815), silently dropping
   * any caller who believed it.
   */
  aggregate?(
    object: string,
    opts: {
      where?: Record<string, unknown>;
      groupBy?: NonNullable<EngineAggregateOptions['groupBy']>;
      aggregations: NonNullable<EngineAggregateOptions['aggregations']>;
      timezone?: string;
    },
  ): Promise<unknown[]>;
}

export interface RegisterObjectToolsOptions {
  /** Expose `sys_*` system objects too. Default false (fail-closed). */
  allowSystemObjects?: boolean;
  /** Hard cap on `query_records` page size. Default 50. */
  maxQueryLimit?: number;
  /**
   * OAuth 2.1 scopes granted to the caller's access token (#2698).
   * UNDEFINED = not scope-limited (API-key / session provenance) — the full
   * principal-bound tool surface registers, today's behavior. An ARRAY
   * narrows registration to the granted tool families, fail-closed:
   * `data:read` → list/describe/query/get, `data:write` → create/update/
   * delete, `actions:execute` → list_actions/run_action. An empty array
   * registers nothing. Scopes only bound the tool surface — every call
   * still runs under the principal's permissions and RLS.
   */
  grantedScopes?: readonly string[];
}

/** One declared input parameter of a business action, LLM-facing. */
export interface McpActionParamSummary {
  name: string;
  type?: 'string' | 'number' | 'boolean' | 'array';
  required?: boolean;
  description?: string;
  /** Allowed values, when the param (or its backing field) is an enum. */
  enum?: string[];
}

/**
 * A business action the caller may invoke, as surfaced by `list_actions`.
 * Mirrors {@link McpObjectSummary} for the action surface: enough for an agent
 * to decide whether and how to call `run_action`, nothing engine-internal.
 */
export interface McpActionSummary {
  /** Declarative action name — the identifier passed to `run_action`. */
  name: string;
  /** The object the action operates on (omitted for object-less actions). */
  objectName?: string;
  /** Human label. */
  label?: string;
  /** What the action does (the authored `ai.description` when present). */
  description?: string;
  /** Dispatch kind: `script` | `flow` | `api`. */
  type?: string;
  /** True when the action acts on a row and so needs a `recordId`. */
  requiresRecord?: boolean;
  /** True when the action is destructive / an author flagged it for confirmation. */
  requiresConfirmation?: boolean;
  /** Declared input parameters. */
  params?: McpActionParamSummary[];
}

/**
 * Action-execution seam for the HTTP MCP tools. Implemented by the runtime so
 * resolution + dispatch flows through the framework's own action mechanism
 * (`IDataEngine.executeAction` / automation flow runner) bound to the caller's
 * ExecutionContext — the SAME permission + RLS path the REST `/actions/...`
 * endpoint uses. Every method runs AS the authenticated principal.
 *
 * Deliberately decoupled from {@link McpDataBridge}: a runtime that cannot
 * resolve the action mechanism simply does not implement this, and the action
 * tools are then not registered (graceful degradation — see
 * `registerActionTools`). Bridging here is direct framework-contract access; it
 * does NOT depend on `@objectstack/service-ai`.
 */
export interface McpActionBridge {
  /** Actions the caller may run, already filtered by permission + visibility. */
  listActions(): Promise<McpActionSummary[]>;
  /**
   * Invoke an action by its declarative name. Resolves the action (optionally
   * scoped by `objectName` to disambiguate), enforces its `requiredPermissions`
   * as the caller, loads the subject record under RLS when row-context, then
   * dispatches through the framework action runner. Throws on
   * denial / not-found / handler failure so the tool surfaces a tool-error.
   */
  runAction(
    name: string,
    input: { objectName?: string; recordId?: string; params?: Record<string, unknown> },
  ): Promise<unknown>;
}

export interface RegisterActionToolsOptions {
  /** Expose actions on `sys_*` system objects too. Default false (fail-closed). */
  allowSystemObjects?: boolean;
  /**
   * OAuth 2.1 scopes granted to the caller's access token (#2698) — same
   * contract as {@link RegisterObjectToolsOptions.grantedScopes}. The action
   * tools require `actions:execute`; undefined = not scope-limited.
   */
  grantedScopes?: readonly string[];
}

const DEFAULT_MAX_LIMIT = 50;

/** A `sys_`-prefixed object is a system table — off-limits to external agents. */
function isSystemObject(name: string): boolean {
  return /^sys_/i.test(name);
}

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: jsonText(value) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Authoring site → the `(role, scope)` the shared validator uses. A `formula`
 * field is a `value` expression bound to the `record` namespace; a `validation`
 * rule is a `record`-scoped `predicate`; a `flow_condition` is a `predicate`
 * whose fields are flattened to top level; a `template` is a text template.
 * Exposing a single friendly `site` keeps the tool aligned with how an author
 * thinks about *where* the expression goes.
 */
const VALIDATE_SITE_MAP: Record<string, { role: FieldRole; scope: 'record' | 'flattened' }> = {
  formula: { role: 'value', scope: 'record' },
  validation: { role: 'predicate', scope: 'record' },
  flow_condition: { role: 'predicate', scope: 'flattened' },
  template: { role: 'template', scope: 'record' },
};

/**
 * Wire the FULL tool surface a bridge can serve onto one {@link McpServer} —
 * the single composition both transports call (#8034).
 *
 * Object CRUD always; the business-action pair only when the bridge implements
 * `listActions` + `runAction` (graceful degradation — a host with no action
 * mechanism keeps serving object tools unchanged). Whoever owns the server
 * decides nothing else: the tool set is a function of the BRIDGE, so the same
 * bridge yields the same tools on stdio and over HTTP, which is the property
 * `transport-parity` pins.
 *
 * @returns the names actually registered, so a host can report its surface
 *   honestly instead of asserting a count that can drift from the code above.
 */
export function wireBridgeTools(
  server: McpServer,
  bridge: McpDataBridge & Partial<McpActionBridge>,
  options: RegisterObjectToolsOptions & RegisterActionToolsOptions = {},
): string[] {
  const registered = registerObjectTools(server, bridge, options);
  if (typeof bridge.listActions === 'function' && typeof bridge.runAction === 'function') {
    registered.push(...registerActionTools(server, bridge as McpActionBridge, options));
  }
  return registered;
}

/**
 * Register the object-CRUD tool set on an {@link McpServer} — the throwaway
 * per-request one on HTTP, the long-lived one behind stdio. All execution is
 * delegated to `bridge`, which the host binds to the caller's principal.
 *
 * @returns the names registered on this call (the set varies with
 *   `grantedScopes` and with whether the bridge implements `aggregate`).
 */
export function registerObjectTools(
  server: McpServer,
  bridge: McpDataBridge,
  options: RegisterObjectToolsOptions = {},
): string[] {
  // Recorded AT the registration site (`note('…')` below) rather than as a
  // second list here: a literal list would be a parallel spelling of the same
  // fact, and the first tool added without updating it would make every
  // caller's report of this surface wrong while every test stayed green.
  const registered: string[] = [];
  const note = (name: string): string => {
    registered.push(name);
    return name;
  };
  const allowSystem = options.allowSystemObjects === true;
  const maxLimit = options.maxQueryLimit ?? DEFAULT_MAX_LIMIT;
  // OAuth tool-family gating (#2698). undefined = not scope-limited.
  // A tool outside the grant is NOT registered at all — the SDK then
  // rejects it as unknown, which doubles as dispatch-time enforcement.
  const scopes = options.grantedScopes;
  const canRead = !scopes || scopes.includes(MCP_OAUTH_SCOPE_DATA_READ);
  const canWrite = !scopes || scopes.includes(MCP_OAUTH_SCOPE_DATA_WRITE);

  /** Fail-closed object-name guard shared by every object-scoped tool. */
  const guard = (objectName: string): string | undefined => {
    if (!objectName || typeof objectName !== 'string') return 'objectName is required';
    if (!allowSystem && isSystemObject(objectName)) {
      return `Object "${objectName}" is a system object and is not exposed via MCP`;
    }
    return undefined;
  };

  if (canRead) {
    server.registerTool(
      note('list_objects'),
      {
        description:
          'List the data objects (tables) available in this app. Returns each object\'s name, label and field count.',
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async () => {
        try {
          const objects = await bridge.listObjects();
          const visible = allowSystem ? objects : objects.filter((o) => !isSystemObject(o.name));
          return textResult({ objects: visible, totalCount: visible.length });
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    server.registerTool(
      note('describe_object'),
      {
        description:
          'Get the schema of a data object: its fields (name, type, label, required) and enabled features.',
        inputSchema: { objectName: z.string().describe('The object/table name, e.g. "task"') },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          const def = await bridge.describeObject(objectName);
          if (!def) return errorResult(`Object "${objectName}" not found`);
          return textResult(def);
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    // Validate a CEL expression against a real object schema BEFORE it is
    // authored into metadata — the same checks `objectstack build` runs, so an
    // agent gets a build-accurate verdict plus the fields/functions in scope to
    // self-correct, instead of shipping a formula that silently evaluates to
    // `null` (#1928). Read-only (schema introspection); no data is touched.
    server.registerTool(
      note('validate_expression'),
      {
        description:
          'Validate a CEL expression against an object\'s schema before authoring it into metadata. Returns ' +
          'build-time errors (bare field refs, unknown fields, unknown functions) and advisory warnings ' +
          '(text/boolean fields misused in arithmetic, date-equality pitfalls), plus the fields and stdlib ' +
          'functions in scope so you can self-correct. `site` says where the expression will live: a `formula` ' +
          'field, a `validation`/predicate, or a `flow_condition` (fields are bound bare in flow conditions).',
        inputSchema: {
          objectName: z.string().describe('The object/table the expression is authored against, e.g. "task"'),
          expression: z.string().describe('The CEL expression to validate, e.g. "record.amount / 100"'),
          site: z
            .enum(['formula', 'validation', 'flow_condition', 'template'])
            .optional()
            .describe(
              'Where the expression will live. formula/validation bind `record.<field>`; flow_condition binds fields bare. Default: formula.',
            ),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, expression, site }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          const def = (await bridge.describeObject(objectName)) as { fields?: unknown } | null;
          if (!def) return errorResult(`Object "${objectName}" not found`);
          const fieldDefs = Array.isArray(def.fields) ? (def.fields as Array<Record<string, unknown>>) : [];
          const fields: string[] = [];
          const fieldTypes: Record<string, string> = {};
          for (const f of fieldDefs) {
            if (typeof f?.name !== 'string') continue;
            fields.push(f.name);
            if (typeof f?.type === 'string') fieldTypes[f.name] = f.type;
          }
          const { role, scope } = VALIDATE_SITE_MAP[site ?? 'formula'];
          const hint = { objectName, fields, fieldTypes, scope } as const;
          const result = validateExpression(role, expression, hint);
          const inScope = introspectScope(role, hint);
          const inferredType = role === 'value' ? inferExpressionType(expression, hint) : undefined;
          return textResult({
            ok: result.ok,
            errors: result.errors,
            warnings: result.warnings,
            ...(inferredType ? { inferredType } : {}),
            inScope: {
              dialect: inScope.dialect,
              roots: inScope.roots,
              fields: inScope.fields,
              functions: inScope.functions,
            },
          });
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    server.registerTool(
      note('query_records'),
      {
        description:
          'Query records from an object with optional filter, field selection, sorting and pagination. ' +
          'Runs under the caller\'s permissions and row-level security.',
        inputSchema: {
          objectName: z.string().describe('The object/table name'),
          where: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Filter conditions, e.g. {"status":"open"}'),
          fields: z.array(z.string()).optional().describe('Field names to return (defaults to all)'),
          limit: z.number().int().positive().max(maxLimit).optional().describe(`Max rows (≤ ${maxLimit})`),
          offset: z.number().int().nonnegative().optional().describe('Rows to skip'),
          orderBy: z
            .array(z.object({ field: z.string(), order: z.enum(['asc', 'desc']) }))
            .optional()
            .describe('Sort order'),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, where, fields, limit, offset, orderBy }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          const result = await bridge.query(objectName, {
            where,
            fields,
            limit: Math.min(limit ?? maxLimit, maxLimit),
            offset,
            orderBy,
          });
          return textResult(result);
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    if (typeof bridge.aggregate === 'function') {
      const aggregateFn = bridge.aggregate.bind(bridge);
      server.registerTool(
        note('aggregate_records'),
        {
          description:
            'Aggregate records with GROUP BY: count/sum/avg/min/max/count_distinct over an object, ' +
            'optionally grouped by fields (dates can be bucketed by day/week/month/quarter/year). ' +
            'Use this instead of paging query_records when a question needs totals or breakdowns. ' +
            'Runs under the caller\'s permissions, row-level security and field-level security.',
          inputSchema: {
            objectName: z.string().describe('The object/table name'),
            aggregations: z
              .array(
                z.object({
                  function: z
                    .enum(['count', 'sum', 'avg', 'min', 'max', 'count_distinct'])
                    .describe('Aggregation function'),
                  field: z.string().optional().describe('Field to aggregate (omit for count(*))'),
                  alias: z.string().describe('Result column name'),
                }),
              )
              .min(1)
              .describe('Metrics to compute, e.g. [{"function":"sum","field":"amount","alias":"total"}]'),
            groupBy: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    field: z.string().describe('Field to group by'),
                    dateGranularity: z
                      .enum(['day', 'week', 'month', 'quarter', 'year'])
                      .optional()
                      .describe('Bucket a date field into uniform periods'),
                    alias: z.string().optional().describe('Alias for the projected group value'),
                  }),
                ]),
              )
              .optional()
              .describe('Grouping fields; omit for a single overall row'),
            where: z
              .record(z.string(), z.unknown())
              .optional()
              .describe('Filter conditions applied before aggregation, e.g. {"status":"open"}'),
            timezone: z
              .string()
              .optional()
              .describe('IANA timezone for date bucketing (defaults to UTC)'),
          },
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        },
        async ({ objectName, aggregations, groupBy, where, timezone }) => {
          const bad = guard(objectName);
          if (bad) return errorResult(bad);
          try {
            const rows = (await aggregateFn(objectName, {
              where,
              groupBy,
              aggregations,
              timezone,
            })) ?? [];
            // Group count is unbounded (a high-cardinality groupBy can return
            // thousands of rows) — cap the tool output like query_records does.
            const truncated = rows.length > maxLimit;
            return textResult({
              rows: truncated ? rows.slice(0, maxLimit) : rows,
              totalGroups: rows.length,
              ...(truncated ? { truncated: true } : {}),
            });
          } catch (err) {
            return errorResult(messageOf(err));
          }
        },
      );
    }

    server.registerTool(
      note('get_record'),
      {
        description: 'Fetch a single record by id.',
        inputSchema: {
          objectName: z.string().describe('The object/table name'),
          recordId: z.string().describe('The record id'),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, recordId }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          const record = await bridge.get(objectName, recordId);
          if (record == null) return errorResult(`Record "${recordId}" not found in "${objectName}"`);
          return textResult(record);
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );
  } // end canRead (data:read)

  if (canWrite) {
    server.registerTool(
      note('create_record'),
      {
        description: 'Create a new record. Runs under the caller\'s permissions and validations.',
        inputSchema: {
          objectName: z.string().describe('The object/table name'),
          data: z.record(z.string(), z.unknown()).describe('Field values for the new record'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, data }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          return textResult(await bridge.create(objectName, data));
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    server.registerTool(
      note('update_record'),
      {
        description: 'Update fields on an existing record by id.',
        inputSchema: {
          objectName: z.string().describe('The object/table name'),
          recordId: z.string().describe('The record id'),
          data: z.record(z.string(), z.unknown()).describe('Field values to change'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, recordId, data }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          return textResult(await bridge.update(objectName, recordId, data));
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    server.registerTool(
      note('delete_record'),
      {
        description: 'Delete a record by id. This is destructive.',
        inputSchema: {
          objectName: z.string().describe('The object/table name'),
          recordId: z.string().describe('The record id'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async ({ objectName, recordId }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          return textResult(await bridge.remove(objectName, recordId));
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );
  } // end canWrite (data:write)

  return registered;
}

/**
 * Register the business-action tool set (`list_actions`, `run_action`) on an
 * {@link McpServer}. This is the action analogue of
 * {@link registerObjectTools}: it owns the tool *shape* and delegates all
 * resolution + dispatch + security to `bridge`, which the runtime binds to the
 * caller's principal.
 *
 * Symmetry with the object tools is deliberate — like `list_objects`/CRUD, the
 * action surface exposes the *mechanism* and delegates enforcement to the
 * bridge, with `sys_*`-scoped actions held back fail-closed by default.
 *
 * SECURITY (#2849): unlike object CRUD — where every call is RLS/FLS-bounded —
 * an action's body executes as TRUSTED app code once invoked. The bridge
 * therefore gates at invoke time: `ai.exposed` (the author's explicit AI
 * opt-in, ADR-0011) + the ADR-0066 D4 capability gate. The earlier design
 * ("no separate AI opt-in flag; rely on permission + RLS enforcement") was
 * revised, because there is no data-layer backstop inside an action body.
 */
export function registerActionTools(
  server: McpServer,
  bridge: McpActionBridge,
  options: RegisterActionToolsOptions = {},
): string[] {
  const registered: string[] = [];
  const note = (name: string): string => {
    registered.push(name);
    return name;
  };
  const allowSystem = options.allowSystemObjects === true;
  // OAuth tool-family gating (#2698): the whole action surface requires
  // `actions:execute`. Not registered = unknown tool = fail-closed.
  if (options.grantedScopes && !options.grantedScopes.includes(MCP_OAUTH_SCOPE_ACTIONS)) {
    return registered;
  }

  server.registerTool(
    note('list_actions'),
    {
      description:
        'List the business actions you can invoke in this app (e.g. "complete task", "convert lead"). ' +
        'Returns each action\'s name, the object it operates on, a description, whether it needs a record id, ' +
        'whether it is destructive, and its input parameters. Only actions the app author has exposed to AI ' +
        'and that the caller is permitted to run are returned. Use run_action to invoke one.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const actions = await bridge.listActions();
        const visible = allowSystem
          ? actions
          : actions.filter((a) => !a.objectName || !isSystemObject(a.objectName));
        return textResult({ actions: visible, totalCount: visible.length });
      } catch (err) {
        return errorResult(messageOf(err));
      }
    },
  );

  server.registerTool(
    note('run_action'),
    {
      description:
        'Invoke a business action by name (see list_actions). Runs the app\'s registered business logic — ' +
        'this can mutate data or trigger flows. Invocation is gated (author AI opt-in + your capabilities), ' +
        'but the action body itself runs as trusted application code with the app\'s full data authority. ' +
        'Supply recordId for actions that operate on a specific record, and params for any declared inputs.',
      inputSchema: {
        actionName: z.string().describe('The action name from list_actions, e.g. "complete_task"'),
        objectName: z
          .string()
          .optional()
          .describe('The object the action belongs to. Optional; required only to disambiguate a name shared by multiple objects.'),
        recordId: z
          .string()
          .optional()
          .describe('The id of the record to act on (for record-scoped actions).'),
        params: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Input parameters declared by the action.'),
      },
      // Actions execute app-defined business logic with side effects (writes,
      // flows, outbound calls), so we mark the tool destructive + open-world:
      // MCP clients should confirm before invoking. Per-action destructiveness
      // is further surfaced via `requiresConfirmation` in list_actions.
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ actionName, objectName, recordId, params }) => {
      if (!actionName || typeof actionName !== 'string') {
        return errorResult('actionName is required');
      }
      if (objectName && !allowSystem && isSystemObject(objectName)) {
        return errorResult(`Object "${objectName}" is a system object and its actions are not exposed via MCP`);
      }
      try {
        const result = await bridge.runAction(actionName, { objectName, recordId, params });
        return textResult(result);
      } catch (err) {
        return errorResult(messageOf(err));
      }
    },
  );

  return registered;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
  return String(err);
}
