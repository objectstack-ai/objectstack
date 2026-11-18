// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The open MCP draft door: the authoring registry this runtime injects into
 * `handleHttpRequest` as `authoring` (design `docs/design/mcp-local-first-door.md`,
 * Design A; rulings D2 A, D3 A and E3 of the local-first door's epic).
 *
 * This first half carries the registry, its admission and the three read
 * tools. The draft save and discard tools, and the publish verdict a save
 * answers with, join it later; until then nothing here writes.
 *
 * ## Who is admitted (seat ruling D1 A)
 *
 * The effective right is an intersection, and both halves are read here, once
 * per request (the HTTP door is stateless, so every `tools/call` is a request
 * of its own and is judged afresh):
 *
 *  1. The TOKEN consents: its grant names `metadata:write`. The MCP runtime's
 *     own gate (`grantsAuthoringTools` in `@objectstack/mcp`) stays the
 *     authority on this half; it is read here only so an API key, a session
 *     or a data-only token costs no grant read. An API key or a session
 *     carries no grant at all and is never injected anything.
 *  2. The HUMAN holds the authoring capability. An OAuth agent's envelope
 *     carries no system permission unless its token also holds
 *     `actions:execute` (`assemble-execution-context.ts`, ADR-0090 D10), so
 *     the capability cannot be read off the request. The user the token was
 *     issued to (`ExecutionContext.userId`) is resolved through the same
 *     grant resolution a request uses (`resolveUserAuthzGrants`), in the
 *     organization the token's consent bound (`tenantId`), and judged by the
 *     one predicate every `/meta` write door asks, `metaWriteCapabilityVerdict`
 *     (ADR-0066 D1, ADR-0131 D6). An AI service account resolves to no system
 *     permission and is refused there.
 *
 * Fail closed: no `userId`, or a grant resolution that throws, admits nothing.
 *
 * ## What a refused user sees (the listing rule of the federation pair)
 *
 * Listing and calling read ONE verdict, taken before the server is built: the
 * registry lists its tools only when the verdict admitted the user, and every
 * call reads the same verdict again before it touches the protocol. So a
 * token with `metadata:write` whose user lacks `manage_metadata` is listed no
 * authoring tool, the shape the MCP door gives every tool its caller cannot
 * pass, and a call that reaches the registry anyway is refused
 * `403 PERMISSION_DENIED`.
 *
 * ## What the reads serve
 *
 * The metadata protocol's public reads (`getMetaItems`, `getMetaItem`,
 * `listDrafts`), judged by the `/meta` doors' own per-caller read gates, with
 * the HUMAN as the caller. The door is not whole-for-author:
 *
 *  - The object-schema mask does not apply: a holder of `manage_metadata` is
 *    exempt from it on every `/meta` door (ADR-0106 D4,
 *    `isObjectSchemaMaskExempt`), and the same predicate admits the
 *    pending-drafts read (`mayReadPendingDrafts`).
 *  - The read gates do apply, as `@objectstack/rest` exports them
 *    (`createMetaItemReadGate`, `createMetaListReadGate`). They refuse on the
 *    caller's own `systemPermissions` and docs audience with no
 *    `manage_metadata` exemption: a dashboard, a list view or an app whose
 *    `requiredPermissions` the human does not hold, and a book or doc outside
 *    their ADR-0046 audience, are refused here as every `/meta` door refuses
 *    them to that human ("either way, author or not", ruling 5856774816).
 *    Whatever spelling of `type` the agent sends: the door folds it once, at
 *    its boundary, with the fold the protocol's reads apply
 *    (`canonicalMetaUrlType`), and hands the one folded type to the protocol
 *    read, to the unknown-type refusal and to both gates. The gates judge the
 *    SINGULAR type only and leave the fold to their caller, as every `/meta`
 *    caller of them folds first; an unfolded `dashboards` or `docs` would be
 *    read as the dashboard or doc by the protocol and judged by no gate.
 *    The caller the gates read is built from the grants the admission
 *    resolved (`resolveUserAuthzGrants`), never from the agent's envelope,
 *    whose system permissions and permission sets are the token's ceiling.
 *  - Before either gate and before any protocol read, both reads ask the
 *    `/meta` type-level read admission (`metaTypeReadRefusal`, over
 *    `META_TYPE_READ_CAPABILITIES`) of the folded type, with the same human
 *    caller, on every `state`: a type whose own door requires a capability
 *    the human does not hold is refused here as every `/meta` read refuses
 *    it, `manage_metadata` or not.
 *  - The item read runs `STORED_VERSION_DOOR_POLICY`, the policy of the
 *    `/meta` doors that serve a stored version for authoring (the plain read's
 *    `?state=draft` branch among them): only the per-caller gates, and the
 *    author exemption for a container's entries, since this caller may save
 *    the item. A whole refusal stays a refusal.
 *  - A gate that cannot evaluate (a books or doc read that throws, a security
 *    service that cannot resolve holdings) refuses: the read answers that
 *    fault, never the item (ADR-0049).
 *  - `list_drafts` runs no item gate, as `/meta/_drafts` runs none for this
 *    same caller: a draft row carries the item's identity and its own `label`,
 *    no body for a gate to judge.
 *
 * The walled refusal (`walledCatalogWriteVerdict`, ADR-0131 D3/D12) gates
 * metadata WRITES and no `/meta` read; it joins this door with the save tool.
 *
 * ## The names (seat ruling D3 A)
 *
 * The design table's `list_metadata` is already a hosted platform tool
 * (`PLATFORM_TOOLS_BY_PACKAGE` in `@objectstack/spec/system`), so the two item
 * reads are `list_metadata_items` and `get_metadata_item`. None of the three
 * names is an MCP native tool: the SDK refuses a duplicate registration by
 * throwing, and the request would fail with it.
 *
 * ## A host with a build door of its own
 *
 * There is no host hook for this injection to defer to: a host that serves its
 * own build door passes its own `authoring` at its own `handleHttpRequest`
 * call, and the option is one object, so the two registries are never merged
 * and their names never meet.
 */

import { resolveUserAuthzGrants } from '@objectstack/core';
import { metaWriteCapabilityVerdict } from '@objectstack/metadata-core';
import {
    createMetaItemReadGate,
    createMetaListReadGate,
    metaTypeReadRefusal,
    refuseUnknownMetaListType,
    STORED_VERSION_DOOR_POLICY,
    type MetaItemReadGateSources,
    type MetaReadGateCaller,
} from '@objectstack/rest';
import { MCP_OAUTH_SCOPE_METADATA_WRITE } from '@objectstack/spec/ai';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import type { ErrorCode, ListDraftsResponse, MetadataProtocol } from '@objectstack/spec/api';
import type { AIToolDefinition } from '@objectstack/spec/contracts';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

/** The read tools' names, in the order the registry lists them. */
export const OPEN_AUTHORING_READ_TOOL_NAMES = ['list_metadata_items', 'get_metadata_item', 'list_drafts'] as const;

const PERMISSION_DENIED: ErrorCode = 'PERMISSION_DENIED';
/** A malformed argument this door judges itself; a protocol refusal keeps its own code. */
const VALIDATION_ERROR: ErrorCode = 'VALIDATION_ERROR';
const RESOURCE_NOT_FOUND: ErrorCode = 'RESOURCE_NOT_FOUND';
const SERVICE_UNAVAILABLE: ErrorCode = 'SERVICE_UNAVAILABLE';
const INTERNAL_ERROR: ErrorCode = 'INTERNAL_ERROR';

/** The lifecycle selector the item reads take. */
const STATES = ['active', 'draft'] as const;
type ReadState = (typeof STATES)[number];

const TYPE_PARAMETER = {
    type: 'string',
    minLength: 1,
    description: 'The metadata type, singular: `object`, `view`, `flow`, `dashboard`, `app`, and so on.',
} as const;

const STATE_PARAMETER = {
    type: 'string',
    enum: [...STATES],
} as const;

/**
 * The three read tools, in the `AIToolDefinition` shape every authoring
 * registry hands the MCP runtime: a JSON Schema `parameters` the runtime
 * converts into the tool's input schema, so an argument outside it is refused
 * before the registry is called.
 */
const READ_TOOLS: readonly AIToolDefinition[] = Object.freeze([
    {
        name: 'list_metadata_items',
        description:
            'List the items of one metadata type in this environment. A pending draft is listed in place of '
            + 'its published version and marked `draft: true`. Pass `state: "active"` for the published items '
            + 'only, or `state: "draft"` for the pending drafts only. Each entry is a summary (name, label, '
            + 'package); read one item\'s full definition with `get_metadata_item`.',
        parameters: {
            type: 'object',
            properties: {
                type: TYPE_PARAMETER,
                state: {
                    ...STATE_PARAMETER,
                    description: 'Omit to list drafts in place of their published versions; `active` lists the published items only; `draft` lists the pending drafts only.',
                },
            },
            required: ['type'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_metadata_item',
        description:
            'Read one metadata item\'s full definition. Without `state`, a pending draft is read in place of '
            + 'the published version and the answer says `draft: true`. `state: "draft"` reads the pending '
            + 'draft only and is refused when there is none; `state: "active"` reads the published version.',
        parameters: {
            type: 'object',
            properties: {
                type: TYPE_PARAMETER,
                name: { type: 'string', minLength: 1, description: 'The item\'s machine name.' },
                state: {
                    ...STATE_PARAMETER,
                    description: 'Omit to read a pending draft where one exists and the published version otherwise; `draft` or `active` reads that version only.',
                },
            },
            required: ['type', 'name'],
            additionalProperties: false,
        },
    },
    {
        name: 'list_drafts',
        description:
            'List the pending metadata drafts in this environment: what was saved as a draft and is not '
            + 'published yet. A person reviews and publishes drafts in Studio. Pass `package` to list one '
            + 'package\'s drafts.',
        parameters: {
            type: 'object',
            properties: {
                package: { type: 'string', minLength: 1, description: 'The id of the package whose drafts to list.' },
            },
            additionalProperties: false,
        },
    },
]);

/** The protocol reads this door makes, named structurally (a host may fill the slot partially). */
export type OpenAuthoringProtocol = Partial<Pick<MetadataProtocol, 'getMetaTypes' | 'getMetaItems' | 'getMetaItem'>> & {
    listDrafts?(request: { packageId?: string; type?: string }): Promise<ListDraftsResponse>;
};

/**
 * The `/meta` read gates' ports for one protocol, with the admitted human as
 * the caller. Built by {@link resolveOpenAuthoringInjection}; a registry
 * handed none refuses every read (fail closed).
 */
export type OpenAuthoringReadGateSources = (protocol: OpenAuthoringProtocol) => MetaItemReadGateSources;

/**
 * The per-call context the MCP runtime stamps on every authoring call
 * (`McpAuthoringToolContext` in `@objectstack/mcp`), named structurally as
 * this package names every MCP shape: it takes no dependency on that package.
 */
export interface OpenAuthoringCallContext {
    door: 'mcp';
    principal: { userId: string };
    environmentId?: string;
}

/** One tool call, as the MCP runtime hands it to an authoring registry. */
export interface OpenAuthoringToolCall {
    toolCallId: string;
    toolName: string;
    input: unknown;
}

/** One tool result, as the MCP runtime reads it back (`formatToolOutput` reads `output.value`). */
export interface OpenAuthoringToolResult {
    type: 'tool-result';
    toolCallId: string;
    toolName: string;
    output: { type: 'text'; value: string };
    isError?: boolean;
}

/** The registry half of `McpAuthoringInjection`. */
export interface OpenAuthoringRegistry {
    getAll(): AIToolDefinition[];
    execute(toolCall: OpenAuthoringToolCall, context: OpenAuthoringCallContext): Promise<OpenAuthoringToolResult>;
}

/** What `handleHttpRequest` receives as `authoring` (`McpAuthoringInjection`). */
export interface OpenAuthoringInjection {
    registry: OpenAuthoringRegistry;
    principal: { userId: string; organizationId?: string; clientId?: string; scopes: readonly string[] };
    environmentId?: string;
}

/**
 * The open authoring injection for this request, or `undefined` when none is
 * owed: a grant without `metadata:write` (an API key and a session carry no
 * grant), or an envelope with no `userId`. A token whose user is not admitted
 * still gets the injection, with a registry that lists nothing and refuses
 * every call: one verdict, read by both.
 */
export async function resolveOpenAuthoringInjection(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    grantedScopes: readonly string[] | undefined,
): Promise<OpenAuthoringInjection | undefined> {
    if (!Array.isArray(grantedScopes) || !grantedScopes.includes(MCP_OAUTH_SCOPE_METADATA_WRITE)) return undefined;
    const ec: any = context.executionContext;
    const userId = typeof ec?.userId === 'string' && ec.userId.length > 0 ? (ec.userId as string) : undefined;
    // Fail closed: a token principal with no user has no human whose grant to read.
    if (!userId) return undefined;
    const organizationId = typeof ec?.tenantId === 'string' && ec.tenantId.length > 0 ? (ec.tenantId as string) : undefined;
    const clientId = typeof ec?.performedBy?.clientId === 'string' ? (ec.performedBy.clientId as string) : undefined;

    const reader = await resolveHumanReader(deps, context, userId, organizationId);
    return {
        registry: createOpenAuthoringRegistry({
            admitted: reader !== undefined,
            userId,
            getProtocol: async () => (await deps.resolveService(context, 'protocol', context.environmentId)) as OpenAuthoringProtocol | undefined,
            ...(reader ? { readGate: openReadGateSources(deps, context, reader) } : {}),
            logger: deps.logger,
        }),
        principal: {
            userId,
            ...(organizationId ? { organizationId } : {}),
            ...(clientId ? { clientId } : {}),
            scopes: [...grantedScopes],
        },
        ...(context.environmentId !== undefined ? { environmentId: context.environmentId } : {}),
    };
}

/**
 * The human the token was issued to, as the `/meta` read gates read a caller,
 * when they hold `manage_metadata` in the organization the token's consent
 * bound; `undefined` when they do not, or when the grant resolution cannot be
 * read (no data engine, or a read that throws): a capability nobody could read
 * is not held.
 *
 * The caller is the human's own grants, never the agent envelope's: its
 * `systemPermissions` and permission sets are what the gates' audience and
 * `requiredPermissions` arms read. `mayWriteItem` is this door's save answer,
 * the one `metaWriteCapabilityVerdict` just gave, as the `/meta` save door
 * gives it.
 */
async function resolveHumanReader(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    userId: string,
    organizationId: string | undefined,
): Promise<MetaReadGateCaller | undefined> {
    try {
        const ql = (await deps.getObjectQL(context, context.environmentId))
            ?? (await deps.resolveService(context, 'objectql', context.environmentId));
        if (!ql) throw new Error('no data engine to resolve the user\'s grants from');
        const grants = await resolveUserAuthzGrants(ql, userId, organizationId ? { tenantId: organizationId } : {});
        // The human's own grant, never the request envelope's: `isSystem` is not
        // passed, and an agent envelope's system permissions are not read.
        if (!metaWriteCapabilityVerdict({ systemPermissions: grants.systemPermissions, operation: 'save' }).allowed) return undefined;
        return {
            userId,
            ...(organizationId ? { tenantId: organizationId } : {}),
            positions: grants.positions,
            permissions: grants.permissions,
            ...(grants.permissionSetAddresses ? { permissionSetAddresses: grants.permissionSetAddresses } : {}),
            systemPermissions: grants.systemPermissions,
            principalKind: grants.principalKind ?? 'human',
            isSystem: false,
            mayWriteItem: true,
        };
    } catch (error) {
        // A functional degradation (the authoring tools are not listed, and
        // nothing claims to have persisted), so `warn`.
        (deps.logger ?? console).warn?.(
            '[MCP] The authoring tools are not served on this request: the user\'s metadata permission could not be read.',
            { error: error instanceof Error ? error.message : String(error) },
        );
        return undefined;
    }
}

/** Where the app gate's nav-servability prune log records what it has already said, for this door. */
const NAV_PRUNE_LOGGED = new Set<string>();

/**
 * The read gates' ports for this request, the I/O the runtime `/meta` domain
 * hands the same gates, with `caller` in place of the request's envelope. Only
 * I/O: every verdict is the gate's.
 */
function openReadGateSources(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    caller: MetaReadGateCaller,
): OpenAuthoringReadGateSources {
    return (protocol) => ({
        resolveCaller: async () => caller,
        resolveSecurityService: () => deps.resolveService(context, 'security'),
        // `undefined` when the protocol has no list read: an unreadable input,
        // which the gates refuse on, never an empty one.
        listMetaItems: (type) => (typeof protocol.getMetaItems === 'function' ? protocol.getMetaItems({ type }) : undefined),
        serviceProbe: () => async (name: string) => {
            try {
                return (await deps.resolveService(context, name)) != null;
            } catch {
                return false;
            }
        },
        navPruneLogged: NAV_PRUNE_LOGGED,
        resolveMessageTranslator: async () => {
            let i18n: { t?: unknown } | null | undefined;
            try {
                i18n = await deps.resolveService(context, 'i18n');
            } catch {
                return undefined;
            }
            if (!i18n || typeof i18n.t !== 'function') return undefined;
            const t = i18n.t as (key: string, locale: string, params?: Record<string, unknown>) => string;
            return (key, locale, params) => t.call(i18n, key, locale, params);
        },
    });
}

/**
 * The registry over one admission verdict. Exported for its pins; the door
 * builds it through {@link resolveOpenAuthoringInjection}.
 */
export function createOpenAuthoringRegistry(opts: {
    admitted: boolean;
    userId: string;
    getProtocol: () => Promise<OpenAuthoringProtocol | undefined>;
    /** The `/meta` read gates' ports; without them every read is refused. */
    readGate?: OpenAuthoringReadGateSources;
    logger?: { warn?: (...args: unknown[]) => void };
}): OpenAuthoringRegistry {
    const { admitted, userId, getProtocol, readGate } = opts;
    return {
        getAll: () => (admitted ? [...READ_TOOLS] : []),
        async execute(toolCall, context) {
            const answer = (body: unknown): OpenAuthoringToolResult => ({
                type: 'tool-result',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                output: { type: 'text', value: JSON.stringify(body, null, 2) },
            });
            const refuse = (code: ErrorCode, message: string, status: number): OpenAuthoringToolResult => ({
                ...answer({ error: { code, message, status } }),
                isError: true,
            });

            // The same verdict the listing read, and the same user it was taken for.
            if (!admitted || context?.principal?.userId !== userId) {
                return refuse(
                    PERMISSION_DENIED,
                    'The authoring tools need the `metadata:write` scope on your connection and the `manage_metadata` capability on your own account.',
                    403,
                );
            }

            const input = (toolCall.input && typeof toolCall.input === 'object' ? toolCall.input : {}) as Record<string, unknown>;
            const state = input.state;
            if (state !== undefined && !STATES.includes(state as ReadState)) {
                return refuse(VALIDATION_ERROR, '`state` is `active` or `draft`.', 400);
            }

            const protocol = await getProtocol();
            // Fail closed: a registry with no read gate cannot judge what this
            // caller may read, so it reads nothing.
            if (typeof readGate !== 'function') {
                return refuse(PERMISSION_DENIED, 'The authoring tools cannot judge what your account may read on this request.', 403);
            }
            try {
                switch (toolCall.toolName) {
                    case 'list_metadata_items': {
                        if (typeof protocol?.getMetaItems !== 'function') return unavailable();
                        const type = canonicalTypeOf(input.type);
                        if (!type) return refuse(VALIDATION_ERROR, 'Name the metadata type as `type`.', 400);
                        const typeRefused = await typeReadRefusal(type);
                        if (typeRefused) return typeRefused;
                        // A type the platform does not declare and this deployment holds
                        // nothing under is refused, as the `/meta` list refuses it, rather
                        // than answered an empty list.
                        await refuseUnknownMetaListType(protocol, type);
                        // `state: "draft"` reads the draft-overlaid list and keeps its
                        // drafts, rather than `listDrafts({ type })`: the list gate
                        // below judges each item's BODY (its `requiredPermissions`,
                        // a doc's audience), and a draft row carries none.
                        const listed = await protocol.getMetaItems({
                            type,
                            ...(state === 'active' ? {} : { previewDrafts: true }),
                        });
                        // What the `/meta` list withholds from this human is not listed.
                        const kept = await createMetaListReadGate(readGate(protocol), type)(
                            Array.isArray(listed?.items) ? listed.items : [],
                        );
                        const items = kept
                            .map(summaryOf)
                            .filter((item) => state !== 'draft' || item.draft);
                        return answer({ type: listed?.type ?? type, count: items.length, items });
                    }
                    case 'get_metadata_item': {
                        if (typeof protocol?.getMetaItem !== 'function') return unavailable();
                        const type = canonicalTypeOf(input.type);
                        const name = requiredString(input.name);
                        if (!type || !name) return refuse(VALIDATION_ERROR, 'Name the item as `type` and `name`.', 400);
                        const typeRefused = await typeReadRefusal(type);
                        if (typeRefused) return typeRefused;
                        const read = await protocol.getMetaItem({
                            type,
                            name,
                            ...(state === 'draft' ? { state: 'draft' as const } : state === 'active' ? {} : { previewDrafts: true }),
                        });
                        const notFound = () => refuse(RESOURCE_NOT_FOUND, `No '${type}' item named '${name}' in this environment.`, 404);
                        const stored = read?.item;
                        if (stored === undefined || stored === null) return notFound();
                        // The `/meta` item gate, as the doors that serve a stored version
                        // for authoring run it. `absent` is the not-found answer itself
                        // (an unpublished app stays unobservable, ADR-0045 §3).
                        const verdict = await createMetaItemReadGate(readGate(protocol), type, name, [stored], STORED_VERSION_DOOR_POLICY)(stored);
                        if (verdict.kind === 'refuse') {
                            const { refusal } = verdict;
                            if (refusal.reason === 'absent') return notFound();
                            return refuse(refusal.code, refusal.message, refusal.status);
                        }
                        const item = verdict.document;
                        const draft = state === 'draft' || (item as { _draft?: unknown })._draft === true;
                        return answer({
                            type: read.type ?? type,
                            name: read.name ?? name,
                            draft,
                            ...(read.version !== undefined ? { version: read.version } : {}),
                            item,
                        });
                    }
                    case 'list_drafts': {
                        if (typeof protocol?.listDrafts !== 'function') return unavailable();
                        const pkg = input.package === undefined ? undefined : requiredString(input.package);
                        if (input.package !== undefined && !pkg) return refuse(VALIDATION_ERROR, '`package` is a package id.', 400);
                        // ADR-0131 D6: no organization, as the `/meta` drafts list; every
                        // draft is saved environment-wide.
                        const listed = await protocol.listDrafts(pkg ? { packageId: pkg } : {});
                        const drafts = Array.isArray(listed?.drafts) ? listed.drafts : [];
                        return answer({ count: drafts.length, drafts });
                    }
                    default:
                        return refuse(VALIDATION_ERROR, `'${toolCall.toolName}' is not one of this registry's tools.`, 400);
                }
            } catch (error) {
                return refusalFromThrown(error);
            }

            /**
             * The `/meta` type-level read admission (`metaTypeReadRefusal`), asked
             * of the folded type with the human as the caller, before any read
             * of the protocol, on every `state`: a type whose own door requires
             * a capability the human lacks is refused here as every `/meta` read
             * refuses it, whether or not the named item exists.
             */
            async function typeReadRefusal(type: string): Promise<OpenAuthoringToolResult | undefined> {
                const refusal = metaTypeReadRefusal('GET', type, await readGate!(protocol ?? {}).resolveCaller());
                return refusal ? refuse(refusal.code, refusal.message, refusal.status) : undefined;
            }

            function unavailable(): OpenAuthoringToolResult {
                return refuse(SERVICE_UNAVAILABLE, 'This environment serves no metadata protocol to read from.', 503);
            }

            /**
             * A coded throw (the protocol's own refusals: an unknown type, a draft
             * that does not exist, a package-scoped refusal) keeps its code, status
             * and sentence. Anything else is a fault, answered without its text.
             */
            function refusalFromThrown(error: unknown): OpenAuthoringToolResult {
                const code = (error as { code?: unknown } | null)?.code;
                const status = (error as { status?: unknown } | null)?.status;
                if (typeof code === 'string' && code.length > 0 && typeof status === 'number' && status < 500) {
                    return refuse(code as ErrorCode, error instanceof Error ? error.message : String(error), status);
                }
                (opts.logger ?? console).warn?.(`[MCP] ${toolCall.toolName} failed`, {
                    error: error instanceof Error ? error.message : String(error),
                });
                return refuse(INTERNAL_ERROR, 'Reading the metadata failed.', 500);
            }
        },
    };
}

/**
 * A `type` argument folded to its canonical singular (`dashboards` → `dashboard`),
 * or `undefined` when absent: the door's one fold, applied once at its
 * boundary, so the protocol read, the unknown-type refusal and both read gates
 * see the same type. It is the fold the protocol's reads apply themselves.
 */
function canonicalTypeOf(value: unknown): string | undefined {
    const type = requiredString(value);
    if (type === undefined) return undefined;
    const folded: unknown = canonicalMetaUrlType(type);
    // The fold reads a plain object, so an inherited member's name
    // (`constructor`, `toString`) answers a function, not a type. The door's
    // type stays the string the agent sent then: the spelling the protocol and
    // the unknown-type refusal are handed for it on every `/meta` door.
    return typeof folded === 'string' ? folded : type;
}

function requiredString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** One listed item as a summary: what a client needs to pick the item to read. */
function summaryOf(raw: unknown): { name: string | null; label: unknown; packageId: string | null; draft: boolean } {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const pkg = item._packageId ?? item.packageId;
    return {
        name: typeof item.name === 'string' ? item.name : null,
        label: item.label ?? null,
        packageId: typeof pkg === 'string' ? pkg : null,
        draft: item._draft === true,
    };
}
