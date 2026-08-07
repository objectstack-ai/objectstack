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
      async (_uri, variables) => {
        const objectName = String(variables.objectName);
        const objectDef = await metadataService.getObject(objectName);

        if (!objectDef) {
          return {
            contents: [{
              uri: `objectstack://objects/${objectName}`,
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Object "${objectName}" not found` }),
            }],
          };
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
            uri: `objectstack://objects/${objectName}`,
            mimeType: 'application/json',
            text: JSON.stringify({
              name: def.name,
              label: def.label ?? def.name,
              fields: fieldSummary,
              enableFeatures: def.enable ?? {},
            }, null, 2),
          }],
        };
      },
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
      async (args) => {
        const agentName = String(args.agentName ?? '');
        if (!agentName) {
          return {
            messages: [{
              role: 'user' as const,
              content: { type: 'text' as const, text: 'Error: agentName argument is required' },
            }],
          };
        }

        const raw = await metadataService.get('agent', agentName);
        if (!raw) {
          return {
            messages: [{
              role: 'user' as const,
              content: { type: 'text' as const, text: `Error: Agent "${agentName}" not found` },
            }],
          };
        }

        const agent = raw as Agent;

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
      },
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
