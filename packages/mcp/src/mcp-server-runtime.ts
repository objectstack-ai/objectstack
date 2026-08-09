// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Logger, IMetadataService, AIToolDefinition } from '@objectstack/spec/contracts';
import type { Agent } from '@objectstack/spec/ai';
import type { ToolRegistry, ToolExecutionResult } from './types.js';
import { registerObjectTools, registerActionTools } from './mcp-http-tools.js';
import type {
  McpDataBridge,
  McpActionBridge,
  RegisterObjectToolsOptions,
  RegisterActionToolsOptions,
} from './mcp-http-tools.js';
import { renderSkillMarkdown, type RenderSkillOptions } from './skill-md.js';
import {
  listSkillPrompts,
  registerSkillPrompts,
  skillPromptResult,
  type McpSkillBridge,
} from './skill-prompts.js';
import { z } from 'zod';

/**
 * Configuration for the MCP Server Runtime.
 */
export interface MCPServerRuntimeConfig {
  /** Human-readable server name. */
  name?: string;
  /** Server version (semver). */
  version?: string;
  /** Optional instructions describing how to use the server. */
  instructions?: string;
  /** Transport mode: 'stdio' (default) or 'http'. */
  transport?: 'stdio' | 'http';
  /** Logger instance. */
  logger?: Logger;
}

/**
 * Minimal shape of an object definition returned by IMetadataService.
 */
interface ObjectDef {
  name: string;
  label?: string;
  fields?: Record<string, { name?: string; type?: string; label?: string; required?: boolean }>;
  enable?: Record<string, boolean>;
}

/**
 * Names of tools that are read-only (no side effects).
 * Kept as a module-level constant for easy extension.
 */
const READ_ONLY_TOOLS = new Set([
  'list_objects',
  'describe_object',
  'query_records',
  'get_record',
  'aggregate_records',
  'aggregate_data',
]);

/**
 * Names of tools that perform destructive mutations.
 */
const DESTRUCTIVE_TOOLS = new Set([
  'delete_field',
]);

// ── Metadata outage vs. metadata miss (#6055, ADR-0110 D3) ───────────────────

/**
 * [#6055] The classification this file gives "the metadata read did not
 * happen", and the classification it gives "the read happened and found
 * nothing". Both are the standard catalog's own codes for their status
 * (`HttpStatusErrorCodeMap[503]` / `[404]`, ADR-0112) — the same spelling the
 * `sys_metadata` half of this family already emits (#5532 / #5843 / #5705), not
 * a vocabulary invented for MCP.
 *
 * There is no HTTP status on this surface: MCP answers `prompts/get` with a
 * `GetPromptResult` and `resources/read` with a `ReadResourceResult`, and
 * neither carries an error envelope (only `CallToolResult` has `isError`). So
 * the code travels in the payload the surface already had — text for a prompt,
 * the JSON body for a resource — and that is the strongest discriminator this
 * transport offers. See the PR body for why the channel was not changed.
 */
const METADATA_UNAVAILABLE_CODE = 'SERVICE_UNAVAILABLE';
const METADATA_MISS_CODE = 'RESOURCE_NOT_FOUND';

/**
 * [#6055] The sentence for "a read that would have decided this did not
 * happen", modelled on `METADATA_STORE_UNAVAILABLE_MESSAGE` (#5532) —
 * *whether it exists is unknown*, plus the retry advice — with two deliberate
 * differences:
 *
 * 1. It names the **metadata service**, not "the metadata store". The verdict
 *    behind it is `getDiagnosed`'s `degraded`, whose meaning is "at least one
 *    LOADER threw and nothing answered this item" — a loader-set fact, not a
 *    single-store one. PR #6051 records that distinction explicitly (it is why
 *    `degraded` did not copy #5897's `storeUnavailable` spelling), so echoing
 *    "store" here would import the narrower claim.
 * 2. It states what the caller is NOT getting. This surface is fail-CLOSED
 *    both before and after this change — the defect was never that an outage
 *    widened access, only that it was **described** as an author's decision —
 *    and saying so keeps the next reader from "restoring" a body here.
 */
function metadataUnavailableSentence(subject: string, withheld: string): string {
  return (
    `The metadata service could not be read, so whether ${subject} exists is unknown. `
    + `No ${withheld} is being served for this call. `
    + 'Retry once the metadata service is reachable.'
  );
}

/** What {@link diagnosedGet} and {@link diagnoseEmptyRead} report. */
interface DiagnosedRead {
  data: unknown;
  degraded: boolean;
  errors: string[];
}

/**
 * [#6055] Read one metadata item, keeping the ADR-0110 D3 verdict instead of
 * flattening an outage into the same `undefined` a never-declared name
 * produces.
 *
 * `IMetadataService.getDiagnosed` is **optional** (#5840): implementations that
 * predate it cannot report the distinction at all, so a service without it is
 * read exactly as before and reports nothing degraded — which is precisely what
 * it could express. Same probe, same fallback, as the two consumers PR #6051
 * landed (`metadata-protocol/src/protocol.ts`, `objectql/src/plugin.ts`).
 *
 * `getDiagnosed` is the diagnosed twin of `get` (registry-first, and
 * `metadata-manager-get-diagnosed.test.ts` pins that `get()` and
 * `getDiagnosed().data` agree on every case), so swapping it in for a `get`
 * call site changes what the caller LEARNS, never what it resolves.
 */
async function diagnosedGet(
  metadataService: IMetadataService,
  type: string,
  name: string,
): Promise<DiagnosedRead> {
  if (typeof metadataService.getDiagnosed === 'function') {
    const diagnosed = await metadataService.getDiagnosed(type, name);
    return {
      data: diagnosed?.data,
      degraded: diagnosed?.degraded === true,
      errors: Array.isArray(diagnosed?.errors) ? diagnosed.errors : [],
    };
  }
  return { data: await metadataService.get(type, name), degraded: false, errors: [] };
}

/**
 * [#6055] The verdict for a lookup that did NOT go through `get` — used by the
 * `object_schema` resource, whose resolver is `getObject(name)`.
 *
 * Deliberately a **verdict-only probe run after the empty answer**, rather than
 * swapping `getObject` out for `getDiagnosed('object', name)`. The ground is
 * the *contract*, not the runtime: `getObject` is its own member of
 * `IMetadataService`, and at the time of #6055 that member carried **no
 * documented equivalence** to `get('object', name)`. Presuming an undocumented
 * equivalence at a consumer is exactly the private dialect Prime Directive #12
 * forbids, so the resolver is left untouched and only the *question* "could
 * this answer be trusted as complete?" is asked of the contract member that is
 * declared to answer it.
 *
 * [#6724] This TSDoc used to offer a second, factual ground — that the
 * equivalence "does not hold in general", `MetadataFacade.getObject` (objectql)
 * returning "a different shape from its own `get()`". That claim is **false**,
 * and it was asserted rather than measured. `SchemaRegistry.getItem`
 * special-cases `'object'`/`'objects'` straight back to `getObject`, so the
 * facade's `get('object', n)` resolves through the very same lookup, and the
 * `item?.content ?? item` unwrap that follows is a no-op — a merged
 * `ServiceObject` has no `content` key. Measured: the two members hand back the
 * **identical object reference** on a hit, and both answer `undefined` on a
 * miss. All three shipped implementations are pinned that way by
 * `packages/objectql/src/metadata-service-getobject-equivalence.test.ts`
 * (PR #6839 for #6745), and `IMetadataService.getObject` has documented the
 * equivalence since PR #6723 (#6505) — so the "no documented equivalence" half
 * above is a fact about #6055's repo, not today's.
 *
 * Correcting the record does not decide the design question, and this note
 * deliberately does not make that call: whether the resolver should become
 * `getDiagnosed('object', name)` and shed the extra miss-path read is a
 * separate judgement, to be made on its own merits by whoever takes it up.
 *
 * Consequences of that choice, both acceptable and both deliberate:
 * - one extra read on the MISS path only (never on a hit, never on success);
 * - on a host that implements `getDiagnosed` *and* a `getObject` resolving
 *   somewhere else, a degraded loader set makes this answer "unknown" for an
 *   object that is genuinely absent. That is the conservative direction — it
 *   withholds, it never admits — and no such host exists today
 *   (`MetadataManager` is the only `getDiagnosed` implementation on `main`).
 *   Since PR #6723 the contract also rules such a host out by declaration, so
 *   this reads as residual risk against a contract violation, not as a live
 *   divergence anyone can point at.
 */
async function diagnoseEmptyRead(
  metadataService: IMetadataService,
  type: string,
  name: string,
): Promise<{ degraded: boolean; errors: string[] }> {
  if (typeof metadataService.getDiagnosed !== 'function') {
    return { degraded: false, errors: [] };
  }
  const diagnosed = await metadataService.getDiagnosed(type, name);
  return {
    degraded: diagnosed?.degraded === true,
    errors: Array.isArray(diagnosed?.errors) ? diagnosed.errors : [],
  };
}

/**
 * What MCP's `prompts/get` answers with — the text-content subset of the SDK's
 * `GetPromptResult` this surface produces.
 *
 * The index signature is not decoration: the SDK's own result types are
 * `{ [x: string]: unknown; … }` (protocol passthrough plus `_meta`), and a
 * named interface without it is rejected by `registerPrompt`'s callback
 * signature. Narrower than `GetPromptResult` on the `content` union so the pin
 * tests can read `.text` without narrowing at every assertion.
 */
export interface AgentPromptResult {
  [key: string]: unknown;
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
}

/** An `Error: …` answer on the prompt surface — this file's existing shape. */
function promptError(text: string): AgentPromptResult {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

/**
 * [#6055] Resolve the `agent_prompt` answer for one call.
 *
 * Exported so the three states below can be pinned directly: the handler is
 * registered on a private `McpServer`, and driving it over a transport would
 * test the SDK rather than this decision.
 *
 * The three states, and why each answers what it does:
 *
 * - **present** — the agent's instructions plus any UI context. Unchanged.
 * - **genuinely absent** — `Error: Agent "X" not found`, byte-identical to
 *   before. A miss is a real fact about what the author declared and this
 *   surface was always right to state it.
 * - **degraded** — an honest {@link METADATA_UNAVAILABLE_CODE} sentence.
 *   Before #6055 this case produced the *not found* text: an availability
 *   failure reported to an MCP client as a declaration fact, the ADR-0110 D3
 *   shape. It never widened access (no instructions were served either way),
 *   so this is a diagnosis fix and MUST stay one — a body served here would be
 *   a security regression, not a nicety.
 *
 * Order matters and is the same narrowing PR #6051 applied to `getMetaItem`:
 * `degraded` only decides the answer once the read has resolved NOTHING, i.e.
 * only when the answer would otherwise have been the unfounded "not found".
 * A read that answered a body is served as it always was.
 */
export async function buildAgentPromptResult(
  metadataService: IMetadataService,
  args: { agentName?: unknown; objectName?: unknown; recordId?: unknown; viewName?: unknown },
  logger?: Logger,
): Promise<AgentPromptResult> {
  const agentName = String(args.agentName ?? '');
  if (!agentName) {
    return promptError('Error: agentName argument is required');
  }

  const read = await diagnosedGet(metadataService, 'agent', agentName);

  if (read.data === undefined || read.data === null) {
    if (read.degraded) {
      logger?.warn(
        '[MCP] agent prompt refused — the metadata service could not be read, so whether this agent '
          + 'exists is unknown. The caller was told SERVICE_UNAVAILABLE and no instructions were served '
          + '(unchanged: nothing is served on a miss either). '
          + 'Fix: check the loaders behind the metadata service (datasource connection, credentials, table).',
        { agentName, errors: read.errors },
      );
      return promptError(
        `Error: ${METADATA_UNAVAILABLE_CODE} — `
          + metadataUnavailableSentence(`agent "${agentName}"`, 'agent instruction'),
      );
    }
    return promptError(`Error: Agent "${agentName}" not found`);
  }

  const agent = read.data as Agent;

  // Build system prompt from agent instructions + context
  const parts: string[] = [];
  parts.push(agent.instructions ?? '');

  const contextHints: string[] = [];
  if (args.objectName) contextHints.push(`Current object: ${args.objectName}`);
  if (args.recordId) contextHints.push(`Selected record ID: ${args.recordId}`);
  if (args.viewName) contextHints.push(`Current view: ${args.viewName}`);
  if (contextHints.length > 0) {
    parts.push('\n--- Current Context ---\n' + contextHints.join('\n'));
  }

  return {
    messages: [{
      role: 'assistant' as const,
      content: { type: 'text' as const, text: parts.join('\n') },
    }],
  };
}

/**
 * What MCP's `resources/read` answers with — the text-content subset of the
 * SDK's `ReadResourceResult`. Carries an index signature for the same reason
 * {@link AgentPromptResult} does.
 */
export interface ObjectSchemaResourceResult {
  [key: string]: unknown;
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

/**
 * [#6055] Resolve the `objectstack://objects/{objectName}` answer for one call.
 *
 * The `agent_prompt` sibling of this fix, on the second occurrence of the same
 * family in this package: `getObject()` returning `undefined` was read as
 * `Object "X" not found` whether the object was never declared or every loader
 * behind the metadata service was down.
 *
 * A resource body is JSON, so unlike the prompt surface it can carry the
 * classification structurally — and both answers now do, so an MCP client can
 * tell an outage from a miss without parsing prose. The `error` sentence of the
 * miss is unchanged; `code`/`status` are additive.
 *
 * Why the resolver is still `getObject` and the verdict is a second, probe-only
 * read: see {@link diagnoseEmptyRead}.
 */
export async function buildObjectSchemaResource(
  metadataService: IMetadataService,
  objectName: string,
  logger?: Logger,
): Promise<ObjectSchemaResourceResult> {
  const uri = `objectstack://objects/${objectName}`;
  const body = (payload: unknown): ObjectSchemaResourceResult => ({
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(payload) }],
  });

  const objectDef = await metadataService.getObject(objectName);

  if (!objectDef) {
    const { degraded, errors } = await diagnoseEmptyRead(metadataService, 'object', objectName);
    if (degraded) {
      logger?.warn(
        '[MCP] object schema withheld — the metadata service could not be read, so whether this object '
          + 'exists is unknown. The caller was told SERVICE_UNAVAILABLE and no schema was served '
          + '(unchanged: nothing is served on a miss either). '
          + 'Fix: check the loaders behind the metadata service (datasource connection, credentials, table).',
        { objectName, errors },
      );
      return body({
        error: metadataUnavailableSentence(`object "${objectName}"`, 'schema'),
        code: METADATA_UNAVAILABLE_CODE,
        status: 503,
      });
    }
    return body({
      error: `Object "${objectName}" not found`,
      code: METADATA_MISS_CODE,
      status: 404,
    });
  }

  const def = objectDef as ObjectDef;
  const fields = def.fields ?? {};
  const fieldSummary = Object.entries(fields).map(([key, f]) => ({
    name: key,
    type: f.type,
    label: f.label ?? key,
    required: f.required ?? false,
  }));

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        name: def.name,
        label: def.label ?? def.name,
        fields: fieldSummary,
        enableFeatures: def.enable ?? {},
      }, null, 2),
    }],
  };
}

/**
 * MCPServerRuntime — Bridges ObjectStack kernel services to the Model Context Protocol.
 *
 * Responsibilities:
 * 1. Bridge ToolRegistry → MCP tools (all registered AI tools)
 * 2. Bridge IMetadataService → MCP resources (object schemas, metadata types)
 * 3. Bridge IDataEngine → MCP resources (record access by URI)
 * 4. Bridge Agent definitions + `skill` metadata → MCP prompts (#3905:
 *    the `instructions` half of an authored skill is what an MCP client can
 *    list and fetch — see `skill-prompts.ts`)
 *
 * Architecture:
 * ```
 * ToolRegistry (service-ai)  ──┐
 * IMetadataService (metadata) ─┼──→  MCPServerRuntime  ──→  McpServer (SDK)
 * IDataEngine (objectql)     ──┤                              │
 * Agent definitions          ──┘                              ├── stdio transport
 *                                                             └── http transport (future)
 * ```
 */
export class MCPServerRuntime {
  private readonly mcpServer: McpServer;
  private readonly config: Required<Pick<MCPServerRuntimeConfig, 'name' | 'version'>> & MCPServerRuntimeConfig;
  private transport: StdioServerTransport | undefined;
  private started = false;

  constructor(config: MCPServerRuntimeConfig = {}) {
    this.config = {
      name: 'objectstack',
      version: '1.0.0',
      transport: 'stdio',
      ...config,
    };

    this.mcpServer = new McpServer(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
          prompts: {},
          logging: {},
        },
        instructions: this.config.instructions ?? 'ObjectStack MCP Server — access data objects, AI tools, and agent prompts.',
      },
    );
  }

  /** The underlying McpServer instance (for advanced use cases). */
  get server(): McpServer {
    return this.mcpServer;
  }

  /** Whether the server is currently connected and running. */
  get isStarted(): boolean {
    return this.started;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /**
   * Extract the text value from a ToolExecutionResult's output.
   *
   * The output may be a `{ type: 'text', value: string }` object (from the
   * Vercel AI SDK ToolResultPart) or any serialisable value.
   */
  private static formatToolOutput(result: ToolExecutionResult): string {
    const output = result.output;
    if (output && typeof output === 'object' && 'value' in output) {
      return String((output as { value: unknown }).value);
    }
    return JSON.stringify(output ?? '');
  }

  // ── Tool Bridge ────────────────────────────────────────────────

  /**
   * Bridge all tools from the ToolRegistry to MCP tools.
   *
   * Each registered tool becomes an MCP tool with the same name, description,
   * and JSON Schema parameters. The handler delegates to the ToolRegistry's
   * execute path.
   */
  bridgeTools(toolRegistry: ToolRegistry): void {
    const tools = toolRegistry.getAll();
    const logger = this.config.logger;

    for (const tool of tools) {
      this.registerToolFromDefinition(tool, toolRegistry);
    }

    logger?.info(`[MCP] Bridged ${tools.length} tools from ToolRegistry`);
  }

  /**
   * Register a single tool on the MCP server from an AIToolDefinition.
   */
  private registerToolFromDefinition(tool: AIToolDefinition, toolRegistry: ToolRegistry): void {
    const logger = this.config.logger;

    // Convert JSON Schema parameters to Zod-compatible format for MCP SDK
    // The MCP SDK registerTool with inputSchema expects a Zod raw shape or AnySchema.
    // Since our tools use JSON Schema, we use the low-level .tool() with a raw callback
    // and pass the JSON Schema as annotations metadata.
    this.mcpServer.registerTool(
      tool.name,
      {
        description: tool.description,
        annotations: {
          // Mark tools with write side-effects for destructive operations
          destructiveHint: this.isDestructiveTool(tool.name),
          readOnlyHint: this.isReadOnlyTool(tool.name),
          openWorldHint: false,
        },
      },
      async (extra) => {
        // The MCP SDK passes tool arguments via the extra.arguments property
        // when registerTool is called without an inputSchema.
        const rawExtra = extra as Record<string, unknown>;
        const args = (rawExtra.arguments ?? {}) as Record<string, unknown>;

        try {
          const result = await toolRegistry.execute({
            type: 'tool-call',
            toolCallId: `mcp-${tool.name}-${Date.now()}`,
            toolName: tool.name,
            input: args,
          });

          const outputText = MCPServerRuntime.formatToolOutput(result);

          if (result.isError) {
            return {
              content: [{ type: 'text' as const, text: outputText }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text' as const, text: outputText }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger?.warn(`[MCP] Tool "${tool.name}" execution failed:`, { error: message });
          return {
            content: [{ type: 'text' as const, text: message }],
            isError: true,
          };
        }
      },
    );
  }

  /**
   * Check if a tool is read-only (data query tools).
   */
  private isReadOnlyTool(name: string): boolean {
    return READ_ONLY_TOOLS.has(name);
  }

  /**
   * Check if a tool performs destructive operations.
   */
  private isDestructiveTool(name: string): boolean {
    return DESTRUCTIVE_TOOLS.has(name);
  }

  // ── Resource Bridge ────────────────────────────────────────────

  /**
   * Bridge metadata service and data engine to MCP resources.
   *
   * Exposes:
   * - `objectstack://objects` — List all data objects
   * - `objectstack://objects/{objectName}` — Get object schema
   * - `objectstack://objects/{objectName}/records/{recordId}` — Get a specific record
   * - `objectstack://metadata/types` — List all metadata types
   */
  bridgeResources(
    metadataService: IMetadataService,
    getRecord?: (objectName: string, recordId: string) => Promise<Record<string, unknown> | null>,
  ): void {
    const logger = this.config.logger;
    let resourceCount = 0;

    // ── Static resource: List all objects ──
    this.mcpServer.registerResource(
      'object_list',
      'objectstack://objects',
      {
        description: 'List all data objects (tables) in the ObjectStack instance',
        mimeType: 'application/json',
      },
      async () => {
        const objects = await metadataService.listObjects();
        const summary = (objects as ObjectDef[]).map(o => ({
          name: o.name,
          label: o.label ?? o.name,
          fieldCount: o.fields ? Object.keys(o.fields).length : 0,
        }));

        return {
          contents: [{
            uri: 'objectstack://objects',
            mimeType: 'application/json',
            text: JSON.stringify({ objects: summary, totalCount: summary.length }, null, 2),
          }],
        };
      },
    );
    resourceCount++;

    // ── Template resource: Object schema ──
    this.mcpServer.registerResource(
      'object_schema',
      new ResourceTemplate('objectstack://objects/{objectName}', { list: undefined }),
      {
        description: 'Get the full schema of a specific data object including fields and features',
        mimeType: 'application/json',
      },
      async (_uri, variables) =>
        // [#6055] Outage vs. miss lives in the builder — see
        // {@link buildObjectSchemaResource}.
        buildObjectSchemaResource(metadataService, String(variables.objectName), logger),
    );
    resourceCount++;

    // ── Template resource: Record by ID ──
    // The ONE resource that reads ROW data, so it MUST run under a principal
    // (ADR-0101): the caller supplies a principal-bound reader that applies
    // RLS/FLS/tenant (e.g. `ql.find(obj, { where: { id }, context })`). Without
    // one, the resource is NOT registered — there is deliberately no unscoped
    // fallback. The long-lived stdio server reaches this only after the plugin
    // resolved `OS_MCP_STDIO_API_KEY` to an identity; the reader re-resolves per
    // call, so a revoked/expired key stops working on the next read.
    if (getRecord) {
      this.mcpServer.registerResource(
        'record_by_id',
        new ResourceTemplate('objectstack://objects/{objectName}/records/{recordId}', { list: undefined }),
        {
          description: 'Get a specific record by ID from a data object (under the caller\'s permissions and row-level security)',
          mimeType: 'application/json',
        },
        async (_uri, variables) => {
          const objectName = String(variables.objectName);
          const recordId = String(variables.recordId);

          try {
            const record = await getRecord(objectName, recordId);

            if (!record) {
              return {
                contents: [{
                  uri: `objectstack://objects/${objectName}/records/${recordId}`,
                  mimeType: 'application/json',
                  text: JSON.stringify({ error: `Record "${recordId}" not found in "${objectName}"` }),
                }],
              };
            }

            return {
              contents: [{
                uri: `objectstack://objects/${objectName}/records/${recordId}`,
                mimeType: 'application/json',
                text: JSON.stringify(record, null, 2),
              }],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              contents: [{
                uri: `objectstack://objects/${objectName}/records/${recordId}`,
                mimeType: 'application/json',
                text: JSON.stringify({ error: message }),
              }],
            };
          }
        },
      );
      resourceCount++;
    }

    // ── Static resource: Metadata types ──
    if (metadataService.getRegisteredTypes) {
      this.mcpServer.registerResource(
        'metadata_types',
        'objectstack://metadata/types',
        {
          description: 'List all registered metadata types (object, app, view, agent, tool, etc.)',
          mimeType: 'application/json',
        },
        async () => {
          const types = await metadataService.getRegisteredTypes!();
          return {
            contents: [{
              uri: 'objectstack://metadata/types',
              mimeType: 'application/json',
              text: JSON.stringify({ types, totalCount: types.length }, null, 2),
            }],
          };
        },
      );
      resourceCount++;
    }

    logger?.info(`[MCP] Bridged ${resourceCount} resource endpoints`);
  }

  // ── Prompt Bridge ──────────────────────────────────────────────

  /**
   * Bridge registered agents **and authored skills** to MCP prompts.
   *
   * Two prompt families land here:
   *
   * 1. `agent_prompt` — one dynamic prompt that loads an agent's system prompt
   *    by name, with optional UI context (objectName, recordId, viewName).
   * 2. One prompt per authored `skill` that carries `instructions` (#3905).
   *    This is the open distribution's consumer for skill metadata: a tenant
   *    writes `*.skill.ts`, and its instructions become a prompt any MCP client
   *    connected to this server can list and fetch. See `skill-prompts.ts` for
   *    why only the instructions half projects.
   *
   * The skill **list** is a snapshot taken here (the stdio transport registers
   * prompts with the SDK, which owns `prompts/list` for this server); each
   * prompt's **body** is re-read from metadata at `prompts/get` time, so an
   * edited skill serves fresh text without a restart. The HTTP transport builds
   * its server per request and is live on both — see {@link handleHttpRequest}.
   */
  async bridgePrompts(metadataService: IMetadataService): Promise<void> {
    const logger = this.config.logger;

    // Register a dynamic prompt that loads agents at call time
    this.mcpServer.registerPrompt(
      'agent_prompt',
      {
        description: 'Load an agent\'s system prompt with optional UI context. ' +
          'Use the agentName argument to select which agent\'s instructions to use.',
        argsSchema: {
          agentName: z.string().describe('Name of the agent to load (e.g. "data_chat", "metadata_assistant")'),
          objectName: z.string().optional().describe('Current object the user is viewing'),
          recordId: z.string().optional().describe('Currently selected record ID'),
          viewName: z.string().optional().describe('Current view name'),
        },
      },
      async (args) =>
        // [#6055] Outage vs. miss lives in the builder — see
        // {@link buildAgentPromptResult}.
        buildAgentPromptResult(metadataService, args, logger),
    );

    logger?.info('[MCP] Agent prompts bridged');

    // ── Skill metadata → MCP prompts (#3905) ──
    const skillBridge: McpSkillBridge = {
      listSkills: async () => (await metadataService.list('skill')) ?? [],
    };

    let skills: Awaited<ReturnType<typeof listSkillPrompts>>;
    try {
      skills = await listSkillPrompts(skillBridge);
    } catch (err) {
      // A metadata service that cannot list this type is not a boot failure —
      // the server keeps its tools, resources and agent prompt.
      const message = err instanceof Error ? err.message : String(err);
      logger?.warn(`[MCP] Could not read skill metadata for the prompt surface: ${message}`);
      return;
    }

    let bridged = 0;
    for (const skill of skills) {
      if (skill.name === 'agent_prompt') {
        // The one reserved name on this surface. Never silently dropped: the
        // author is told which skill collided and what it costs them.
        logger?.warn(
          `[MCP] Skill "${skill.name}" is not exposed as a prompt — that name is reserved by the built-in agent prompt. Rename the skill to make its instructions reachable over MCP.`,
        );
        continue;
      }
      this.mcpServer.registerPrompt(
        skill.name,
        {
          ...(skill.title ? { title: skill.title } : {}),
          ...(skill.description ? { description: skill.description } : {}),
        },
        async () => {
          // Re-read at call time so an edited skill serves fresh instructions.
          const current = (await listSkillPrompts(skillBridge)).find((s) => s.name === skill.name);
          return skillPromptResult(current ?? skill);
        },
      );
      bridged++;
    }

    logger?.info(`[MCP] Bridged ${bridged} skill prompts`);
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /**
   * Start the MCP server with the configured transport.
   *
   * For stdio transport, this connects to process stdin/stdout.
   */
  async start(): Promise<void> {
    if (this.started) return;

    const logger = this.config.logger;

    if (this.config.transport === 'stdio') {
      this.transport = new StdioServerTransport();
      await this.mcpServer.connect(this.transport);
      this.started = true;
      logger?.info(`[MCP] Server started (transport: stdio, name: ${this.config.name})`);
    } else {
      // HTTP is served per-request via `handleHttpRequest()` (mounted by the
      // runtime dispatcher at `/api/v1/mcp`), not through a long-lived
      // `connect()` like stdio — so there is nothing to start here.
      logger?.info('[MCP] HTTP transport ready (served per-request at /api/v1/mcp).');
    }
  }

  /**
   * Stop the MCP server and disconnect the transport.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    await this.mcpServer.close();
    this.transport = undefined;
    this.started = false;
    this.config.logger?.info('[MCP] Server stopped');
  }

  /**
   * Render the portable Agent Skill (`SKILL.md`) for this environment
   * (ADR-0036 Amendment C: ONE generic skill, schema discovered live).
   *
   * Exposed on the runtime so HTTP hosts can serve it (`GET /api/v1/mcp/skill`
   * in the runtime dispatcher) without depending on `@objectstack/mcp` —
   * they duck-call this through the registered `'mcp'` service, mirroring
   * how `handleHttpRequest` is reached.
   */
  renderSkill(options?: RenderSkillOptions): string {
    return renderSkillMarkdown(options);
  }

  // ── HTTP (Streamable HTTP) transport ───────────────────────────

  /**
   * Handle one MCP request over the **Streamable HTTP** transport (Web Standard
   * `Request`/`Response`), the network-reachable surface for external agents.
   *
   * Stateless by design: a fresh {@link McpServer} + transport is built per
   * request (the SDK-recommended pattern for stateless HTTP — it avoids any
   * cross-request session/request-id collision and keeps each call isolated).
   * The tool set is the object-CRUD bridge plus — when the bridge can resolve
   * the framework's action mechanism — the business-action tools
   * (`list_actions` / `run_action`), all bound to the **caller's principal**
   * via `bridge`; the runtime wires that bridge to the existing permission +
   * RLS path, so an external agent can never exceed the key's authority.
   *
   * Only these native tools are exposed here — the internal AI/authoring
   * toolRegistry (which can mutate metadata) is deliberately NOT bridged onto
   * the external surface.
   *
   * **Prompts (#3905).** When the bridge can also read this environment's
   * `skill` metadata (`listSkills`), the server additionally serves the MCP
   * `prompts` primitive: every authored skill that carries `instructions`
   * becomes a prompt the client can `prompts/list` and `prompts/get`. The
   * projection is read from the SAME per-request, environment-scoped bridge the
   * tools use — never from server-held state — so a multi-tenant host cannot
   * serve one environment's skills to another. A bridge without `listSkills`
   * does not declare the capability at all (graceful degradation, as with the
   * action tools).
   *
   * @param request    The inbound Web `Request` (headers/method/url).
   * @param opts.bridge       Principal-bound data (+ optional action / skill) accessor (required to expose tools).
   * @param opts.parsedBody   Pre-parsed JSON-RPC body (the dispatcher already read it).
   * @param opts.authInfo     Optional auth info forwarded to message handlers.
   * @param opts.toolOptions  Tool exposure options (system objects, query limits).
   */
  async handleHttpRequest(
    request: Request,
    opts: {
      bridge?: McpDataBridge & Partial<McpActionBridge> & Partial<McpSkillBridge>;
      parsedBody?: unknown;
      authInfo?: unknown;
      toolOptions?: RegisterObjectToolsOptions & RegisterActionToolsOptions;
    } = {},
  ): Promise<Response> {
    // The prompt surface is wired by capability, like the action tools: a
    // bridge that cannot read skill metadata gets no `prompts` capability and
    // no handlers, rather than a capability that answers nothing.
    const skillBridge =
      opts.bridge && typeof opts.bridge.listSkills === 'function'
        ? (opts.bridge as McpSkillBridge)
        : undefined;

    // Fresh, isolated server per request (stateless).
    const server = new McpServer(
      { name: this.config.name, version: this.config.version },
      {
        capabilities: { tools: {}, ...(skillBridge ? { prompts: {} } : {}) },
        instructions:
          this.config.instructions ??
          'ObjectStack MCP Server — query and modify your app\'s data objects as tools.',
      },
    );

    if (skillBridge) {
      registerSkillPrompts(server, skillBridge);
    }

    if (opts.bridge) {
      registerObjectTools(server, opts.bridge, opts.toolOptions);
      // The action surface is wired by capability: only when the runtime's
      // bridge can resolve + dispatch the framework's actions. A host with no
      // action mechanism keeps serving object tools unchanged (graceful
      // degradation, mirroring how record resources need a dataEngine).
      if (
        typeof opts.bridge.listActions === 'function' &&
        typeof opts.bridge.runAction === 'function'
      ) {
        registerActionTools(server, opts.bridge as McpActionBridge, opts.toolOptions);
      }
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      // Stateless: no session id, single request/response.
      sessionIdGenerator: undefined,
      // Return a buffered JSON response (no long-lived SSE) — fits the
      // Worker→container hop without streaming pass-through concerns.
      enableJsonResponse: true,
    });

    await server.connect(transport);
    try {
      // JSON-response mode fully materialises the Response before resolving,
      // so it is safe to close the per-request server in `finally`.
      return await transport.handleRequest(request, {
        parsedBody: opts.parsedBody,
        authInfo: opts.authInfo as any,
      });
    } finally {
      await server.close().catch(() => {});
    }
  }
}
