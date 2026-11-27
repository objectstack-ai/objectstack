// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The in-process entry to the light authoring door: the five tools the MCP
 * draft door serves (`./domains/mcp-authoring.ts`), with the same contract, read
 * gates and verdicts, for an AI assistant that runs in the server process and
 * acts as the signed-in person (a host's in-app ask turn). It is built by the
 * MCP door's own assembly (`buildOpenAuthoringRegistry`) over a request placed
 * by the dispatcher's own placement step, as `dispatchAction` places a
 * host's action call, so it reads the same services the same way; only the
 * admission's first half and the saves' `surface` differ.
 *
 * ## Who is admitted
 *
 * The MCP door's admission is an intersection of the token's consent
 * (`metadata:write`) and the human's own `manage_metadata`. Here there is no
 * token: the person's signed-in session, which the host authenticated, takes
 * the consent's place. What remains is the second half, decided exactly as the
 * MCP door decides it (`resolveHumanReader`): the person's own grants, resolved
 * in their session's organization (`tenantId`), judged by
 * `metaWriteCapabilityVerdict`. A person without the capability is listed no
 * tool, and a call is refused `403 PERMISSION_DENIED`, the MCP door's refusal
 * shape. Fail closed: an envelope with no user, a system envelope (no person,
 * and one the walled refusal would wave through), or a grant read that fails
 * admits nothing.
 *
 * ## What a save states
 *
 * `surface: 'copilot'`, the published value for an AI assistant's tool
 * writing on a person's behalf, which only an in-process caller may state
 * (`MetadataAuthoringSurfaceSchema`; every HTTP door refuses it). So Studio's
 * draft marks and per-key provenance tell an in-app save from an MCP one
 * (`mcp`) and from the person's own edit (`studio`). No `client` is stated:
 * there is no OAuth client.
 *
 * No tool publishes and none takes a `force`: a person reviews and publishes
 * the drafts in Studio, as with the MCP door.
 */

import type { ObjectKernel } from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AIToolDefinition } from '@objectstack/spec/contracts';
import { hostDispatcherFor, type PlaceRequestInEnvironment } from './action-dispatch.js';
import type { HttpProtocolContext } from './http-dispatcher.js';
import type { DomainHandlerDeps } from './domain-handler-registry.js';
import {
    buildOpenAuthoringRegistry,
    createOpenAuthoringRegistry,
    type OpenAuthoringRegistry,
    type OpenAuthoringToolCall,
    type OpenAuthoringToolResult,
} from './domains/mcp-authoring.js';

/** What a host hands {@link createInProcessAuthoringRegistry} for one person's turn. */
export interface InProcessAuthoringRequest {
    /**
     * The signed-in person, as the host authenticated them: `userId` is the
     * person the tools act as, `tenantId` the organization their capability is
     * read in, `posture` the rung the walled refusal reads, and the user-text
     * locales the verdicts' sentences are composed in. It is used as given,
     * as `dispatchAction` uses its envelope. Never a system envelope:
     * one is admitted nothing.
     */
    executionContext: ExecutionContext;
    /**
     * The environment the person is working in. On a host with a
     * `kernel-resolver` it reaches the resolver as the scoped-URL hint and
     * the resolver places the request; on a host without one it is the
     * request's environment, or the default environment when omitted. As
     * `dispatchAction`'s `environmentId`.
     */
    environmentId?: string;
}

/** The five tools, bound to one person for one turn. */
export interface InProcessAuthoringRegistry {
    /** Whether the person holds `manage_metadata`: the one verdict both methods read. */
    readonly admitted: boolean;
    /** The five tools' definitions when admitted; none otherwise. */
    getAll(): AIToolDefinition[];
    /**
     * One tool call, answered as the MCP door answers it: a `tool-result`
     * whose `output.value` is the JSON reply, with `isError` on a refusal
     * (`{ error: { code, message, status } }`).
     */
    execute(toolCall: OpenAuthoringToolCall): Promise<OpenAuthoringToolResult>;
}

/**
 * The light authoring door's five tools (`list_metadata_items`,
 * `get_metadata_item`, `list_drafts`, `save_metadata_draft`,
 * `delete_metadata_draft`), in process, as the signed-in person. Build one per
 * turn: the admission is read once, here, and both `getAll` and `execute` read
 * that verdict.
 *
 * `kernel` is `dispatchAction`'s: the kernel the host's HTTP door is
 * served from (on a multi-kernel host, the one that registers the
 * `kernel-resolver` service). A resolver that refuses to place the request
 * rejects this call with its error.
 *
 * What stays the host's job before it calls, as for `dispatchAction`:
 * authenticating the person and resolving their envelope for the environment
 * (`executionContext` is used as given), the ADR-0069 authentication-policy
 * gate and the environment-membership gate.
 *
 * @example
 * const authoring = await createInProcessAuthoringRegistry(kernel, { executionContext, environmentId });
 * tools.push(...authoring.getAll());
 * // later, for a call the model made:
 * const result = await authoring.execute({ toolCallId, toolName, input });
 */
export async function createInProcessAuthoringRegistry(
    kernel: ObjectKernel,
    request: InProcessAuthoringRequest,
): Promise<InProcessAuthoringRegistry> {
    return hostDispatcherFor(kernel).hostAuthoringRegistry(request);
}

/**
 * The entry's body over one dispatcher's deps. `place` is the dispatcher's own
 * placement step (`placeHostActionRequest`), the one `dispatchAction`'s
 * call is placed by.
 */
export async function inProcessAuthoringRegistryRequest(
    deps: DomainHandlerDeps,
    request: InProcessAuthoringRequest,
    place: PlaceRequestInEnvironment,
): Promise<InProcessAuthoringRegistry> {
    const ec: any = request?.executionContext;
    const userId = typeof ec?.userId === 'string' && ec.userId.length > 0 ? (ec.userId as string) : undefined;
    // Fail closed: no person, or a system envelope, is admitted nothing, and
    // no grant is read and nothing is placed for it.
    if (!userId || ec?.isSystem === true) {
        return bound(createOpenAuthoringRegistry({ admitted: false, userId: '', getProtocol: async () => undefined, surface: 'copilot' }), false, '');
    }
    const organizationId = typeof ec?.tenantId === 'string' && ec.tenantId.length > 0 ? (ec.tenantId as string) : undefined;

    // PLACEMENT, as `dispatchActionRequest` places a host's action call: on a
    // host with a `kernel-resolver` the environment is the RESOLVER's to
    // write, and the named one reaches it as the scoped-URL hint.
    const namedEnvironment = typeof request.environmentId === 'string' && request.environmentId !== '' ? request.environmentId : undefined;
    const context: HttpProtocolContext = { request: { headers: {} }, executionContext: ec };
    await place(context, { routePath: '/meta', ...(namedEnvironment ? { environmentId: namedEnvironment } : {}) });
    if (namedEnvironment && !deps.isMultiTenantHost()) context.environmentId = namedEnvironment;
    if (!context.environmentId) {
        const def = deps.getDefaultEnvironmentId();
        if (def) context.environmentId = def;
    }

    const { registry, admitted } = await buildOpenAuthoringRegistry(deps, context, {
        userId,
        organizationId,
        clientId: undefined,
        surface: 'copilot',
    });
    return bound(registry, admitted, userId);
}

/** The registry bound to the person it was built for: every call is stamped as theirs. */
function bound(registry: OpenAuthoringRegistry, admitted: boolean, userId: string): InProcessAuthoringRegistry {
    return {
        admitted,
        getAll: () => registry.getAll(),
        execute: (toolCall) => registry.execute(toolCall, { door: 'in_process', principal: { userId } }),
    };
}
