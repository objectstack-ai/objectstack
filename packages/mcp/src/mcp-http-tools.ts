// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * mcp-http-tools — object CRUD exposed as MCP tools for the HTTP transport.
 *
 * These are the tools an external agent (Claude Desktop / Cursor) drives over
 * the network. Unlike the stdio bridge — which is a trusted local process —
 * the HTTP surface is reached by arbitrary callers, so every operation MUST
 * run under the caller's resolved principal. We never touch the data engine
 * directly here: all reads/writes go through an injected {@link McpDataBridge}
 * that the runtime wires to the SAME permission/RLS-enforcing path the REST
 * API uses (`callData` with the request's ExecutionContext). This module owns
 * the tool *shape*; the bridge owns *execution + security*.
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
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
} from '@objectstack/spec/ai';

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
 * Register the object-CRUD tool set on a fresh per-request {@link McpServer}.
 * All execution is delegated to `bridge`, which is bound to the caller's
 * principal by the runtime.
 */
export function registerObjectTools(
  server: McpServer,
  bridge: McpDataBridge,
  options: RegisterObjectToolsOptions = {},
): void {
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
      'list_objects',
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
      'describe_object',
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

    server.registerTool(
      'query_records',
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

    server.registerTool(
      'get_record',
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
      'create_record',
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
      'update_record',
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
      'delete_record',
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
}

/**
 * Register the business-action tool set (`list_actions`, `run_action`) on a
 * fresh per-request {@link McpServer}. This is the action analogue of
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
): void {
  const allowSystem = options.allowSystemObjects === true;
  // OAuth tool-family gating (#2698): the whole action surface requires
  // `actions:execute`. Not registered = unknown tool = fail-closed.
  if (options.grantedScopes && !options.grantedScopes.includes(MCP_OAUTH_SCOPE_ACTIONS)) {
    return;
  }

  server.registerTool(
    'list_actions',
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
    'run_action',
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
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
  return String(err);
}
