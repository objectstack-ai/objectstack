// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  AIToolDefinition,
  ToolCallPart,
  ToolExecutionContext,
  ToolResultPart,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * Minimal ToolRegistry interface consumed by the MCP bridge.
 *
 * Matches the public API of `ToolRegistry` from `@objectstack/service-ai`
 * without creating a hard dependency on that package.
 */
export interface ToolRegistry {
  /** Return all registered tool definitions. */
  getAll(): AIToolDefinition[];

  /**
   * Execute a tool call and return the result.
   *
   * [#31605] The long-lived (stdio) bridge passes the transport's principal as
   * `context` once the plugin has bound one (`OS_MCP_STDIO_API_KEY`, resolved
   * per call), so a governed registry sees the key's user as the actor. A
   * runtime with no stdio principal bound calls `execute(toolCall)` with one
   * argument, as before.
   */
  execute(toolCall: ToolCallPart, context?: ToolExecutionContext): Promise<ToolExecutionResult>;
}

/**
 * Extended ToolResultPart with isError flag, matching service-ai's ToolExecutionResult.
 */
export interface ToolExecutionResult extends ToolResultPart {
  isError?: boolean;
}

// ── Host-injected authoring registry (HTTP, `metadata:write`) ────────────────

/**
 * The door every call the HTTP MCP runtime makes into a host-injected
 * authoring registry is stamped with. ONE spelling, owned by the runtime: the
 * host's access check and tier mapping branch on it, and it is written by the
 * runtime at the call site — never copied from anything the request carried,
 * so no header a client sends can claim another door.
 */
export const MCP_TOOL_DOOR = 'mcp' as const;
export type McpToolDoor = typeof MCP_TOOL_DOOR;

/**
 * The principal an OAuth access token resolves to, as the HOST verified it.
 * The runtime copies it into every authoring call's context verbatim and adds
 * nothing from the request: the host resolved the token, so the host is the
 * only honest source.
 */
export interface McpTokenPrincipal {
  /** The user the access token was issued to — the human the agent acts for. */
  userId: string;
  /** The organization the token's consent bound, when it bound one. */
  organizationId?: string;
  /** The OAuth client the token was issued to, when the host knows it. */
  clientId?: string;
  /** The OAuth scopes the token carries, as the host verified them. */
  scopes?: readonly string[];
}

/**
 * The per-call context the runtime hands a host-injected authoring tool — a
 * {@link ToolExecutionContext} whose identity half is filled from the token
 * and which carries the door provenance the host's access check and tier
 * mapping read. The three provenance members are stamped by the runtime on
 * every call (`door` is always {@link MCP_TOOL_DOOR}, `principal` and
 * `environmentId` are the host's own inputs to `handleHttpRequest`); none is
 * ever read from a request header, so a spoofed header changes nothing here.
 */
export interface McpAuthoringToolContext extends ToolExecutionContext {
  /** Always {@link MCP_TOOL_DOOR}: this call came through the MCP door. */
  door: McpToolDoor;
  /** The token's user, as the actor a `ToolExecutionContext` reader expects (RLS on, as that user). */
  actor: { id: string };
  /** The token principal: a frozen per-call copy of what the host passed, so a tool cannot taint the next call. */
  principal: McpTokenPrincipal;
  /** The environment the request was dispatched for, verbatim from the host. */
  environmentId?: string;
}

/**
 * A host-injected authoring `ToolRegistry`: the same shape as
 * {@link ToolRegistry}, except that `execute` takes the per-call
 * {@link McpAuthoringToolContext} beside the call — authoring tools act on an
 * environment's metadata as a principal, so a call without its context has no
 * identity to act as.
 */
export interface McpAuthoringToolRegistry {
  /** Return the authoring tool definitions the host chose to expose over MCP. */
  getAll(): AIToolDefinition[];
  /** Execute one authoring tool call under the door provenance the runtime stamped. */
  execute(toolCall: ToolCallPart, context: McpAuthoringToolContext): Promise<ToolExecutionResult>;
}

/**
 * What a host passes to `handleHttpRequest` to bridge its authoring registry
 * for one request. The registry's tools register only when the request's
 * token carries `metadata:write`; `principal` and `environmentId` become the
 * provenance of every call into it.
 */
export interface McpAuthoringInjection {
  /**
   * The authoring registry — which tools it holds is the host's business. Its
   * names must not collide with the native surface or with each other: the SDK
   * throws on a duplicate registration and the request fails with it.
   */
  registry: McpAuthoringToolRegistry;
  /**
   * The token principal the host resolved for this request — from the SAME
   * token whose scopes the host passes as `toolOptions.grantedScopes`, since
   * that list is what admits the registry. Copied and frozen per call.
   */
  principal: McpTokenPrincipal;
  /** The environment the host dispatched this request for. */
  environmentId?: string;
  /**
   * The server instructions this request's `initialize` answers with — the
   * text an MCP client puts in its model's context (where the authoring
   * rules live, which ones exist). Read under the SAME grant that admits
   * {@link registry}: a request whose grant registers the authoring family
   * is answered with this text; any other request — a `data:read` token, an
   * API key, a session — gets the runtime's configured or default
   * instructions and never sees it. Omitted, the authoring request gets the
   * configured or default instructions too.
   */
  instructions?: string;
}

// ── Host-installed tool-call interceptor (every MCP tool call) ───────────────

/**
 * [#31605] The transport a tool call arrived on: `http` for the per-request
 * Streamable HTTP server (`handleHttpRequest`), `stdio` for the long-lived
 * server `start()` attaches. Stamped by the runtime, never read from a request.
 */
export type McpToolTransport = 'http' | 'stdio';

/** The principal kinds an `ExecutionContext` names (ADR-0090 D10). */
export type McpPrincipalKind = NonNullable<ExecutionContext['principalKind']>;

/**
 * [#31605] Who a tool call runs as, projected by the runtime from the
 * `ExecutionContext` the HOST admitted the caller as — the request's resolved
 * credential on HTTP, the `OS_MCP_STDIO_API_KEY` identity on stdio. Every
 * member is copied from that context (or, for `environmentId`, from the
 * environment the host dispatched the request for) and from nothing a client
 * sent: no header, no argument and no JSON-RPC member can set or change one.
 * Frozen, so an interceptor cannot taint the next call's view.
 *
 * A member is absent when the context carries none: a personal API key has no
 * `onBehalfOf` or `performedBy`, and the stdio transport serves one process's
 * kernel and stamps no `environmentId`. An empty principal means the host
 * passed none; it is never a grant of anything.
 */
export interface McpToolCallPrincipal {
  /** The user the call is authorized as (`ExecutionContext.userId`). */
  readonly userId?: string;
  /** `human`, `agent` (an OAuth client acting for a user), `service`, … */
  readonly principalKind?: McpPrincipalKind;
  /** The delegator an agent principal acts for (ADR-0090 D10). */
  readonly onBehalfOf?: Readonly<{ userId: string; principalKind?: McpPrincipalKind }>;
  /** The OAuth client that performed the call, set only by the `/mcp` OAuth door. */
  readonly performedBy?: Readonly<{ clientId: string }>;
  /** The organization the principal is in (`ExecutionContext.tenantId`). */
  readonly organizationId?: string;
  /** The environment the host dispatched the request for (HTTP only). */
  readonly environmentId?: string;
  /** Present, and `true`, only for a system principal the host admitted. */
  readonly isSystem?: true;
}

/**
 * [#31605] What a tool-call interceptor is told about one call. Built by the
 * runtime at the call, on the server side of the transport.
 */
export interface McpToolCallContext {
  /** Always {@link MCP_TOOL_DOOR}. */
  readonly door: McpToolDoor;
  /** The transport the call arrived on. */
  readonly transport: McpToolTransport;
  /** The registered tool's name. */
  readonly toolName: string;
  /**
   * The arguments the tool is about to run with, after the SDK validated them
   * against the tool's input schema: a frozen copy, so observing them cannot
   * change what the tool receives. Empty for a tool that declares no input.
   */
  readonly arguments: Readonly<Record<string, unknown>>;
  /** Who the call runs as. */
  readonly principal: McpToolCallPrincipal;
}

/** The MCP `tools/call` result a tool answers with, and an interceptor may replace. */
export type McpToolCallResult = CallToolResult;

/**
 * [#31605] An interceptor's refusal: the call does not run, and the client is
 * answered with the coded-refusal envelope every MCP tool error uses —
 * `isError: true` with the text `{ "error": { code, message, status } }`.
 *
 * `outcome` is a discriminator so a later outcome (a `hold` that routes the
 * call to an approval) can be added beside `deny` without reshaping it. Today
 * `deny` is the only outcome: anything else an interceptor returns is refused
 * as a malformed verdict, never run.
 */
export interface McpToolCallRefusal {
  readonly outcome: 'deny';
  /** The ADR-0112 error code the client branches on. */
  readonly code: string;
  /** The sentence the client (and its model) reads. */
  readonly message: string;
  /** The HTTP status the refusal corresponds to (403 for a policy refusal). */
  readonly status?: number;
}

/**
 * [#31605] The host-installed seam around every MCP tool call, on both
 * transports and every registration path: the object, action, file and
 * federation tools, the host-injected authoring family, the bridged AI tools
 * and any tool a plugin registers on the runtime's server.
 *
 * - **Allow**: call `next()`. The interceptor sees the tool's result and
 *   returns it, or a replacement result.
 * - **Deny**: return a {@link McpToolCallRefusal} without calling `next()`.
 *   The tool never runs.
 *
 * A throw from the interceptor refuses the call too: it is answered as a tool
 * error, a coded throw with its `code` and `status`, as every MCP tool's own
 * catch answers one.
 *
 * Neutral by contract: the runtime carries no policy. Audit, seat checks and
 * kill switches live entirely in whichever host installs the interceptor
 * (`MCPServerRuntime.setToolInterceptor`). With none installed every tool
 * call runs exactly as it did before the seam existed.
 */
export type McpToolInterceptor = (
  call: McpToolCallContext,
  next: () => Promise<McpToolCallResult>,
) => Promise<McpToolCallResult | McpToolCallRefusal>;
