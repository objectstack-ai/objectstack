// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Model Context Protocol (MCP) — Reference & Binding Primitives
 *
 * MCP itself is an external protocol defined by Anthropic
 * (https://modelcontextprotocol.io). The platform does NOT re-define
 * MCP's wire format, transport, or message shapes — that is the job
 * of the `@modelcontextprotocol/sdk` consumed by `@objectstack/mcp`.
 *
 * This file defines only the two things the *platform* needs:
 *
 * 1. **MCPServerRef** — how a project references an external MCP
 *    server (so an agent can mount its tools).
 * 2. **MCPToolBinding** — how an MCP tool from a referenced server
 *    is exposed as an ObjectStack {@link AIToolDefinition} (alias,
 *    visibility, approval policy).
 *
 * Everything else (transport details, capability negotiation,
 * resource/prompt shapes, streaming, sampling) is handled by the SDK
 * at runtime and does not need a metadata representation.
 */

/**
 * MCP transport over which to reach an external server.
 *
 * `stdio` is for local subprocess servers; `http` and `websocket` are
 * for hosted servers. Authentication is transport-specific and lives
 * in `secretRef`.
 */
export const MCPTransportSchema = lazySchema(() => z.enum([
  'stdio',
  'http',
  'websocket',
]));

/**
 * Reference to an external MCP server.
 *
 * A project lists these to declare *which* MCP servers its agents may
 * mount. The runtime connects via `@modelcontextprotocol/sdk` and
 * discovers tools dynamically — we do NOT pre-declare each tool here.
 */
export const MCPServerRefSchema = lazySchema(() => z.object({
  /** Stable identifier used by agents to reference this server. */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine name (snake_case)'),
  /** Human-readable label. */
  label: z.string().describe('Display label'),
  /** Transport used to reach the server. */
  transport: MCPTransportSchema,
  /**
   * Connection target. Interpretation depends on transport:
   * - `stdio`: command to spawn (e.g. `npx @modelcontextprotocol/server-filesystem`)
   * - `http`  / `websocket`: URL
   */
  endpoint: z.string().describe('Command (stdio) or URL (http/websocket)'),
  /** Reference to stored credentials (bearer token, API key, etc.). */
  secretRef: z.string().optional(),
  /** Whether the server is active. */
  active: z.boolean().default(true),
}));

/**
 * Approval policy for tools exposed via MCP.
 *
 * MCP tools are third-party code; the platform must let operators
 * decide whether the agent can call them autonomously or must wait
 * for a human in the loop.
 */
export const MCPApprovalPolicySchema = lazySchema(() => z.enum([
  /** Always require explicit human approval before each call. */
  'always',
  /** Auto-approve for trusted servers (default for read-only tools). */
  'never',
  /** Approve on first call per conversation; subsequent calls auto-approve. */
  'first_call',
]));

/**
 * Binding from an MCP tool to an ObjectStack agent surface.
 *
 * Used by agent metadata to mount a specific tool from a referenced
 * MCP server, optionally renaming it and constraining its use.
 */
export const MCPToolBindingSchema = lazySchema(() => z.object({
  /** MCP server name (must match an {@link MCPServerRefSchema}). */
  server: z.string(),
  /** Tool name as advertised by the MCP server. */
  toolName: z.string(),
  /** Optional alias to expose to the LLM (defaults to `toolName`). */
  aliasAs: z.string().optional(),
  /** Approval policy applied to this binding. */
  approval: MCPApprovalPolicySchema.default('never'),
}));

export type MCPTransport = z.infer<typeof MCPTransportSchema>;
export type MCPServerRef = z.infer<typeof MCPServerRefSchema>;
export type MCPApprovalPolicy = z.infer<typeof MCPApprovalPolicySchema>;
export type MCPToolBinding = z.infer<typeof MCPToolBindingSchema>;

/**
 * OAuth 2.1 scopes for the platform's OWN MCP endpoint (`/api/v1/mcp`).
 *
 * These are the coarse, tool-family-level grants an OAuth access token can
 * carry when a human-connected MCP client (claude.ai, Claude Desktop,
 * Claude Code, …) authorizes against a deployment's embedded authorization
 * server. Scopes narrow the *tool surface* (which tools are exposed) AND, via
 * `scopesToAgentPermissionSets` below, derive the agent's DATA-LAYER capability
 * ceiling: an OAuth-authenticated request is a `principalKind:'agent'` acting
 * on behalf of the human, and the ADR-0090 D10 intersection bounds it by BOTH
 * that scope-derived ceiling AND the user's own grants. So a scope can never
 * grant more than the logged-in user could do (the intersection only narrows),
 * and it now enforces that at the data layer, not just the tool surface.
 *
 * Deliberately minimal (see #2698): finer grades can be added later without
 * breaking these. Constants live in the spec so the authorization server
 * (`@objectstack/plugin-auth`), the resource server (`@objectstack/runtime`)
 * and the tool layer (`@objectstack/mcp`) can never drift on the names.
 */
/** Read-family tools: `list_objects`, `describe_object`, `query_records`, `get_record`. */
export const MCP_OAUTH_SCOPE_DATA_READ = 'data:read';
/** Write-family tools: `create_record`, `update_record`, `delete_record`. */
export const MCP_OAUTH_SCOPE_DATA_WRITE = 'data:write';
/** Business-action tools: `list_actions`, `run_action`. */
export const MCP_OAUTH_SCOPE_ACTIONS = 'actions:execute';

/** All MCP tool-family scopes, in the order they are advertised. */
export const MCP_OAUTH_SCOPES = [
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
] as const;

export type McpOauthScope = (typeof MCP_OAUTH_SCOPES)[number];

/**
 * [ADR-0090 D10] Built-in permission sets that express an MCP agent's
 * capability CEILING, derived from the OAuth scopes the user consented to.
 *
 * When an MCP request authenticates via an OAuth token (an AI client acting on
 * behalf of a human), the engine treats it as a `principalKind:'agent'`
 * principal `onBehalfOf` that human. The agent's OWN grants are one of these
 * sets, and the D10 intersection bounds the effective permission by BOTH the
 * agent's ceiling AND the delegating user's grants — so a `data:read` token can
 * never write ANY record at the data layer, even via a crafted call, no matter
 * what the user could do. This promotes the OAuth scope from a tool-surface
 * hint (bypassable at the API) to a real, enforced data-layer boundary while
 * staying strictly consistent with "a scope can never grant more than the user
 * could do anyway" (the intersection only ever narrows).
 *
 * These sets are pure capability ceilings — object CRUD bits only, NO
 * row-level security. All row/owner/tenant narrowing comes from the delegating
 * user's own sets on the other side of the intersection.
 */
/** Read-only ceiling (maps to `data:read`): read every object, write none. */
export const MCP_AGENT_PERMISSION_SET_READ = 'mcp_agent_data_read';
/** Read+write ceiling (maps to `data:write`): full CRUD, still bounded by the user. */
export const MCP_AGENT_PERMISSION_SET_WRITE = 'mcp_agent_data_write';
/**
 * No-object-access floor (actions-only / no data scope). Keeps the resolved set
 * list non-empty so the enforcement middleware fails CLOSED (every object op
 * denied) rather than falling open on an empty principal.
 */
export const MCP_AGENT_PERMISSION_SET_RESTRICTED = 'mcp_agent_restricted';

/** All built-in MCP agent ceiling sets. */
export const MCP_AGENT_PERMISSION_SETS = [
  MCP_AGENT_PERMISSION_SET_READ,
  MCP_AGENT_PERMISSION_SET_WRITE,
  MCP_AGENT_PERMISSION_SET_RESTRICTED,
] as const;

/**
 * [ADR-0090 D10] Map the OAuth scopes on an MCP token to the agent's ceiling
 * permission set(s). `data:write` (a superset — its set also grants read) wins
 * over `data:read`; a token with neither data scope (e.g. `actions:execute`
 * only) gets the no-object-access floor. Always returns at least one set so the
 * agent principal is never empty (which would fail OPEN in the middleware).
 */
export function scopesToAgentPermissionSets(scopes: readonly string[] | undefined): string[] {
  const s = new Set(scopes ?? []);
  if (s.has(MCP_OAUTH_SCOPE_DATA_WRITE)) return [MCP_AGENT_PERMISSION_SET_WRITE];
  if (s.has(MCP_OAUTH_SCOPE_DATA_READ)) return [MCP_AGENT_PERMISSION_SET_READ];
  return [MCP_AGENT_PERMISSION_SET_RESTRICTED];
}
