// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  AIToolDefinition,
  ToolCallPart,
  ToolExecutionContext,
  ToolResultPart,
} from '@objectstack/spec/contracts';

/**
 * Minimal ToolRegistry interface consumed by the MCP bridge.
 *
 * Matches the public API of `ToolRegistry` from `@objectstack/service-ai`
 * without creating a hard dependency on that package.
 */
export interface ToolRegistry {
  /** Return all registered tool definitions. */
  getAll(): AIToolDefinition[];

  /** Execute a tool call and return the result. */
  execute(toolCall: ToolCallPart): Promise<ToolExecutionResult>;
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
}
