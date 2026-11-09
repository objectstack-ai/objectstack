// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31605] The one seam every MCP tool call passes through on its way to the
 * tool: a host-installed {@link McpToolInterceptor} that may observe the call,
 * refuse it, or replace its result.
 *
 * ## Why at the server, not at each tool
 *
 * The platform registers tools on an `McpServer` from five families (object
 * CRUD, actions, files, federation, the host-injected authoring registry), the
 * bridged AI `ToolRegistry`, and whatever a plugin adds on `mcp:ready`, across
 * two servers (the long-lived stdio one and the per-request HTTP one). A seam
 * stitched into each registration site is one a new site forgets.
 * {@link routeToolCallsThrough} wraps the server's own registration methods
 * once, right after the platform builds the server, so every tool registered
 * on it afterwards — by any caller, through `registerTool` or the deprecated
 * `tool` — runs its handler through the gate, and so does a handler a later
 * `RegisteredTool.update({ callback })` installs. (The experimental task-based
 * tools, `experimental.tasks.registerToolTask`, are not routed: nothing in the
 * platform registers one.)
 *
 * ## Nothing installed, nothing changed
 *
 * The gate reads the interceptor slot AT EACH CALL. When it is empty the
 * wrapped handler is called with exactly the arguments the SDK passed and its
 * return value is handed back untouched — no principal is resolved, no copy of
 * the arguments is taken, no promise is added. So installation order does not
 * matter either: an interceptor a host installs after the tools registered
 * still sees their next call.
 *
 * ## What the interceptor is told
 *
 * A {@link McpToolCallContext} built here: the door, the server's transport,
 * the tool's registered name, a frozen copy of the validated arguments, and
 * the principal the route resolves from the host's own inputs. Nothing on the
 * inbound request reaches it, so no header a client sends can change a member.
 *
 * ## Policy-free
 *
 * No licence check, audit table or seat rule lives here or anywhere in this
 * package; that is the installing host's, as with the AI `ToolRegistry`'s
 * interceptor seam.
 */

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger, ToolExecutionContext } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { StandardErrorCode } from '@objectstack/spec/api';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { MCP_TOOL_DOOR } from './types.js';
import type {
  McpPrincipalKind,
  McpToolCallContext,
  McpToolCallPrincipal,
  McpToolCallRefusal,
  McpToolCallResult,
  McpToolInterceptor,
  McpToolTransport,
} from './types.js';
import { codedErrorResult, errorResultWithCode } from './mcp-http-tools.js';

/**
 * The members of an `ExecutionContext` a tool-call principal is projected
 * from. A host passes its resolved context; only these are read.
 */
export type McpCallerExecutionContext = Partial<
  Pick<ExecutionContext, 'userId' | 'principalKind' | 'onBehalfOf' | 'performedBy' | 'tenantId' | 'isSystem'>
>;

/** The principal of a call whose host passed none. Frozen; never a grant. */
export const EMPTY_TOOL_CALL_PRINCIPAL: McpToolCallPrincipal = Object.freeze({});

/**
 * Project the host's `ExecutionContext` (and the environment it dispatched
 * for) into the frozen principal an interceptor reads. Copies only the members
 * {@link McpToolCallPrincipal} names, each nested object into a fresh frozen
 * one, so the interceptor holds nothing that aliases the host's context.
 */
export function toolCallPrincipalOf(
  ec: McpCallerExecutionContext | undefined,
  environmentId?: string,
): McpToolCallPrincipal {
  if (!ec && environmentId === undefined) return EMPTY_TOOL_CALL_PRINCIPAL;
  const principal: {
    userId?: string;
    principalKind?: McpPrincipalKind;
    onBehalfOf?: Readonly<{ userId: string; principalKind?: McpPrincipalKind }>;
    performedBy?: Readonly<{ clientId: string }>;
    organizationId?: string;
    environmentId?: string;
    isSystem?: true;
  } = {};
  if (typeof ec?.userId === 'string' && ec.userId.length > 0) principal.userId = ec.userId;
  if (ec?.principalKind !== undefined) principal.principalKind = ec.principalKind;
  if (ec?.onBehalfOf && typeof ec.onBehalfOf.userId === 'string') {
    principal.onBehalfOf = Object.freeze({
      userId: ec.onBehalfOf.userId,
      ...(ec.onBehalfOf.principalKind !== undefined ? { principalKind: ec.onBehalfOf.principalKind } : {}),
    });
  }
  if (ec?.performedBy && typeof ec.performedBy.clientId === 'string') {
    principal.performedBy = Object.freeze({ clientId: ec.performedBy.clientId });
  }
  if (typeof ec?.tenantId === 'string' && ec.tenantId.length > 0) principal.organizationId = ec.tenantId;
  if (typeof environmentId === 'string' && environmentId.length > 0) principal.environmentId = environmentId;
  if (ec?.isSystem === true) principal.isSystem = true;
  return Object.freeze(principal);
}

/**
 * The AI tool context the long-lived bridge hands a bridged `ToolRegistry`
 * for the stdio principal: the key's user as `actor` (with the positions and
 * permissions the key resolved to), so a registry that promotes `actor` into
 * its engine context runs the tool as that user, RLS on, and a governed
 * registry sees an actor. A context with no user carries no actor, which a
 * registry treats as unauthenticated, never as system.
 */
export function toolExecutionContextOf(
  ec: Pick<ExecutionContext, 'userId'> & Partial<Pick<ExecutionContext, 'positions' | 'permissions'>>,
): ToolExecutionContext {
  if (typeof ec.userId !== 'string' || ec.userId.length === 0) return {};
  return {
    actor: {
      id: ec.userId,
      positions: [...(ec.positions ?? [])],
      permissions: [...(ec.permissions ?? [])],
    },
  };
}

/** How one server's tool calls reach the interceptor slot. */
export interface ToolCallRoute {
  /** The transport stamped on every call through this server. */
  readonly transport: McpToolTransport;
  /** The installed interceptor, read at each call; `undefined` when none is. */
  interceptor(): McpToolInterceptor | undefined;
  /**
   * The principal of a call, resolved at the call and only when an
   * interceptor is installed. A throw refuses the call before the interceptor
   * is consulted: the caller's own admission failed, as an HTTP request whose
   * credential fails is refused before any tool.
   */
  principal(): McpToolCallPrincipal | Promise<McpToolCallPrincipal>;
  readonly logger?: Logger;
}

type ToolHandler = (...callArgs: unknown[]) => unknown;
type ToolRegistration = (...registrationArgs: unknown[]) => RegisteredTool;

/**
 * Route every tool registered on `server` from now on through `route`'s
 * interceptor slot. Call it once, right after the server is built and before
 * any tool is registered on it.
 */
export function routeToolCallsThrough(server: McpServer, route: ToolCallRoute): void {
  const routed = (register: ToolRegistration): ToolRegistration => (...registrationArgs) => {
    // The handler is the LAST argument of `registerTool(name, config, cb)` and
    // of every `tool(name, …, cb)` overload.
    const last = registrationArgs.length - 1;
    const handler = registrationArgs[last];
    if (typeof handler !== 'function') return register(...registrationArgs);

    let toolName = String(registrationArgs[0]);
    let registered: RegisteredTool | undefined;
    const gate = (inner: ToolHandler): ToolHandler => (...callArgs) => {
      const interceptor = route.interceptor();
      if (!interceptor) return inner(...callArgs);
      // The SDK calls `handler(args, extra)` for a tool with an input schema
      // and `handler(extra)` for one without; asked at the call, because
      // `update({ paramsSchema })` can change which.
      const args = registered?.inputSchema !== undefined ? callArgs[0] : undefined;
      return interceptToolCall(interceptor, route, toolName, args, () => inner(...callArgs));
    };

    registrationArgs[last] = gate(handler as ToolHandler);
    registered = register(...registrationArgs);
    const update = registered.update;
    registered.update = (updates) => {
      if (typeof updates.name === 'string') toolName = updates.name;
      return update(
        typeof updates.callback === 'function'
          ? { ...updates, callback: gate(updates.callback as ToolHandler) as typeof updates.callback }
          : updates,
      );
    };
    return registered;
  };

  server.registerTool = routed(server.registerTool.bind(server) as ToolRegistration) as typeof server.registerTool;
  server.tool = routed(server.tool.bind(server) as ToolRegistration) as typeof server.tool;
}

/** Run one call through an installed interceptor. */
async function interceptToolCall(
  interceptor: McpToolInterceptor,
  route: ToolCallRoute,
  toolName: string,
  args: unknown,
  run: () => unknown,
): Promise<McpToolCallResult> {
  let principal: McpToolCallPrincipal;
  try {
    principal = await route.principal();
  } catch (err) {
    return errorResultWithCode(err);
  }

  const call: McpToolCallContext = Object.freeze({
    door: MCP_TOOL_DOOR,
    transport: route.transport,
    toolName,
    arguments: frozenArguments(args),
    principal,
  });

  // `next()` runs the tool at most once, however often it is called, and
  // remembers how it failed so a tool's own throw keeps its own answer.
  let ran: Promise<McpToolCallResult> | undefined;
  let toolFailure: { error: unknown } | undefined;
  const next = (): Promise<McpToolCallResult> => {
    ran ??= Promise.resolve()
      .then(run)
      .then(
        (result) => result as McpToolCallResult,
        (error: unknown) => {
          toolFailure = { error };
          throw error;
        },
      );
    return ran;
  };

  let verdict: McpToolCallResult | McpToolCallRefusal;
  try {
    verdict = await interceptor(call, next);
  } catch (err) {
    // The tool threw and the interceptor let it through: the SDK answers it
    // exactly as it answers that tool's throw with no interceptor installed.
    if (toolFailure && toolFailure.error === err) throw err;
    return errorResultWithCode(err);
  }
  return answerOf(verdict, call, route.logger);
}

/** What the client receives for an interceptor's verdict. */
function answerOf(
  verdict: unknown,
  call: McpToolCallContext,
  logger: Logger | undefined,
): McpToolCallResult {
  if (verdict !== null && typeof verdict === 'object') {
    if ('outcome' in verdict) {
      const refusal = verdict as Partial<McpToolCallRefusal>;
      if (refusal.outcome === 'deny' && isNonEmptyString(refusal.code) && isNonEmptyString(refusal.message)) {
        return codedErrorResult({
          code: refusal.code,
          message: refusal.message,
          ...(typeof refusal.status === 'number' ? { status: refusal.status } : {}),
        });
      }
    } else if (Array.isArray((verdict as { content?: unknown }).content)) {
      return verdict as McpToolCallResult;
    }
  }
  // Neither a result nor a deny it can render: the call is refused as a
  // fault, never served on a verdict nobody can read.
  logger?.warn(
    `[MCP] The installed tool-call interceptor answered "${call.toolName}" with neither a tool result nor a `
      + '{ outcome: \'deny\', code, message } refusal, so the call was refused as a server fault. '
      + 'Fix: return the result next() resolved to (or a replacement), or a deny refusal.',
  );
  return codedErrorResult({
    code: StandardErrorCode.enum.INTERNAL_ERROR,
    message: INTERNAL_ERROR_MESSAGE,
    status: 500,
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A deep-frozen copy of the validated arguments, or a frozen `{}` for none. */
function frozenArguments(args: unknown): Readonly<Record<string, unknown>> {
  if (args === null || typeof args !== 'object') return Object.freeze({});
  return deepFreeze(structuredClone(args) as Record<string, unknown>);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
  }
  return value;
}
