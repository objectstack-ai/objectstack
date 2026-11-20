// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The open MCP draft door: the authoring registry this runtime injects into
 * `handleHttpRequest` as `authoring` (design `docs/design/mcp-local-first-door.md`,
 * Design A; rulings D2 A, D3 A and E3 of the local-first door's epic).
 *
 * Five tools: three reads (`list_metadata_items`, `get_metadata_item`,
 * `list_drafts`) and two draft writes (`save_metadata_draft`,
 * `delete_metadata_draft`). No tool publishes and none takes a `force` (D2 A):
 * a person reviews and publishes the drafts in Studio.
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
 *  - `list_drafts` runs no item gate on its rows, as `/meta/_drafts` runs none
 *    for this same caller: a draft row carries the item's identity and its own
 *    `label`, no body for a gate to judge (each row's verdict is gated, below).
 *
 * ## What the writes do (E3: the save answers with the publish verdict)
 *
 *  - `save_metadata_draft` saves through `saveMetaItem` with `mode: 'draft'`,
 *    `surface: 'mcp'` and the token's OAuth client as `client`, attributed to
 *    the human (`actor`). A draft save runs the type's schema parse and no
 *    authoring rule, so the reply carries what a publish would answer: the
 *    protocol's public `draftPublishJudgement` on the stored draft, every
 *    finding whole (rule id, path, message, hint, severity), and the Studio
 *    routes a person reviews it on. `package` is required (seat ruling D4):
 *    Studio's Changes review is per package, and a save naming none is
 *    refused with the writable packages named. A judgement that fails after
 *    the save landed is said beside the saved identity, never as a refused
 *    save.
 *  - [#34774] `save_metadata_draft`'s optional `clientSpecVersion` is judged
 *    first ({@link clientSpecVersionVerdict}).
 *  - `delete_metadata_draft` discards a pending draft through `deleteMetaItem`
 *    with `state: 'draft'`, never an active item.
 *  - Both ask the `/meta` type-level write admission (`metaTypeWriteRefusal`,
 *    the save as `PUT`, the discard as `DELETE`) with the human as the caller,
 *    then the walled refusal (`walledCatalogWriteVerdict`, ADR-0131 D3/D12),
 *    before anything is written, as every `/meta` write door does, on the
 *    posture this transport reads (`readEffectiveTenancyPosture`). The
 *    authoring admission (D1) alone does not cover a type whose own write
 *    door requires more.
 *  - A verdict is a read of the stored draft's body, so the save's verdict
 *    and each listed draft's verdict are told only where the type-level read
 *    admission admits the human; elsewhere the reply says it was withheld.
 *  - `list_drafts` stays ungated as a list (as `/meta/_drafts`), and each
 *    entry now carries its publish verdict. The verdict is read off the
 *    draft's body, so it is told only where the `/meta` item gate admits the
 *    strict draft read for this human; elsewhere the entry says it was
 *    withheld and why.
 *
 * ## The names (seat ruling D3 A)
 *
 * The design table's `list_metadata` is already a hosted platform tool
 * (`PLATFORM_TOOLS_BY_PACKAGE` in `@objectstack/spec/system`), so the two item
 * reads are `list_metadata_items` and `get_metadata_item`. None of the five
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

import { createRequire } from 'node:module';
import { resolveUserAuthzGrants, userTextLocalesOf } from '@objectstack/core';
import { metaWriteCapabilityVerdict, walledCatalogWriteVerdict } from '@objectstack/metadata-core';
import {
    createMetaItemReadGate,
    createMetaListReadGate,
    metaTypeReadRefusal,
    metaTypeWriteRefusal,
    refuseUnknownMetaListType,
    STORED_VERSION_DOOR_POLICY,
    type MetaItemReadGateSources,
    type MetaReadGateCaller,
} from '@objectstack/rest';
import { MCP_OAUTH_SCOPE_METADATA_WRITE } from '@objectstack/spec/ai';
import { SEMVER_2_0_0_VERSION_PATTERN } from '@objectstack/spec/kernel';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import type { ErrorCode, ListDraftsResponse, MetadataProtocol, RuntimeAuthoringIssue } from '@objectstack/spec/api';
import type { AIToolDefinition } from '@objectstack/spec/contracts';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import { readEffectiveTenancyPosture } from './activation-gate.js';

/** The read tools' names, in the order the registry lists them. */
export const OPEN_AUTHORING_READ_TOOL_NAMES = ['list_metadata_items', 'get_metadata_item', 'list_drafts'] as const;

/** The draft write tools' names, listed after the reads. */
export const OPEN_AUTHORING_WRITE_TOOL_NAMES = ['save_metadata_draft', 'delete_metadata_draft'] as const;

const PERMISSION_DENIED: ErrorCode = 'PERMISSION_DENIED';
/** A malformed argument this door judges itself; a protocol refusal keeps its own code. */
const VALIDATION_ERROR: ErrorCode = 'VALIDATION_ERROR';
const RESOURCE_NOT_FOUND: ErrorCode = 'RESOURCE_NOT_FOUND';
const SERVICE_UNAVAILABLE: ErrorCode = 'SERVICE_UNAVAILABLE';
const INTERNAL_ERROR: ErrorCode = 'INTERNAL_ERROR';

/** [#34774] The `@objectstack/spec` this process resolves (the version `initialize` and the restriction profile state). */
const SERVER_SPEC_VERSION: string | undefined = (() => {
    try {
        const { version } = createRequire(import.meta.url)('@objectstack/spec/package.json') as { version?: unknown };
        return typeof version === 'string' && version ? version : undefined;
    } catch {
        return undefined;
    }
})();

/**
 * [#34774] The save's judgement of the client's declared spec version (#34659
 * ruling D4 = A), before anything is written: another major is refused with the
 * install line (`refusal`), another minor is saved with an `advisory`, and none
 * or the same major and minor says nothing. The type's schema parse on the save
 * stays the final gate either way.
 */
function clientSpecVersionVerdict(declared: unknown, server = SERVER_SPEC_VERSION): { refusal?: string; advisory?: string } {
    if (declared === undefined) return {};
    if (typeof declared !== 'string' || !SEMVER_2_0_0_VERSION_PATTERN.test(declared)) {
        return { refusal: '`clientSpecVersion` is the `@objectstack/spec` version you built against, in SemVer form (e.g. 18.6.0).' };
    }
    if (!server) return { advisory: `This server could not read its own @objectstack/spec version, so ${declared} was not compared.` };
    const [clientMajor, clientMinor] = declared.split('.').map(Number);
    const [serverMajor, serverMinor] = server.split('.').map(Number);
    const install = `npm i -D @objectstack/spec@${server}`;
    if (clientMajor !== serverMajor) {
        return {
            refusal: `This server runs @objectstack/spec ${server}, and you built against ${declared}, another major: what `
                + 'that major lets an item say is not what this server accepts. Nothing was saved. Install the server\'s '
                + `version, rebuild the item against it and save again: ${install}`,
        };
    }
    if (clientMinor === serverMinor) return {};
    return {
        advisory: `This server runs @objectstack/spec ${server}, and you built against ${declared}: the same major, so the `
            + `draft was saved, but a key or value one of the two minors adds may be refused or not understood. ${install}`,
    };
}

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
            + 'published yet. A person reviews and publishes drafts in Studio. Each draft carries its publish '
            + 'verdict: `verdict.refusals` lists what a publish would refuse it on (rule id, path, hint), empty '
            + 'when it would publish. Pass `package` to list one package\'s drafts.',
        parameters: {
            type: 'object',
            properties: {
                package: { type: 'string', minLength: 1, description: 'The id of the package whose drafts to list.' },
            },
            additionalProperties: false,
        },
    },
]);

/**
 * The two draft write tools. `package` is required (seat ruling D4) and is
 * judged by the registry rather than by the input schema's `required`, so a
 * save naming none is answered with the packages it may name instead of the
 * schema validator's bare refusal.
 */
const WRITE_TOOLS: readonly AIToolDefinition[] = Object.freeze([
    {
        name: 'save_metadata_draft',
        description:
            'Save one metadata item as a DRAFT in a package. Nothing is published: a person reviews and '
            + 'publishes drafts in Studio, and this server has no publish tool. The reply answers what a publish '
            + 'would say about the saved draft: `verdict.refusals` lists every rule the publish would refuse it '
            + 'on, each with its rule id, the path in the item and a `hint` (the next step); fix the item and '
            + 'save again until it is empty. `verdict.advisories` are findings a publish still returns. `review` '
            + 'names the Studio routes where the draft is reviewed. Saving again replaces the pending draft.',
        parameters: {
            type: 'object',
            properties: {
                type: TYPE_PARAMETER,
                name: { type: 'string', minLength: 1, description: 'The item\'s machine name.' },
                item: { type: 'object', description: 'The item\'s full definition, as `get_metadata_item` reads it.' },
                package: {
                    type: 'string',
                    minLength: 1,
                    description: 'Required: the id of the package the draft is saved into. Studio reviews drafts per package; a save without one is refused with the writable packages named.',
                },
                ifMatch: {
                    type: 'string',
                    minLength: 1,
                    description: 'Optional: the `version` a read or a save answered. The save is refused if the draft changed since.',
                },
                clientSpecVersion: {
                    type: 'string',
                    minLength: 1,
                    description: 'Recommended: the `@objectstack/spec` version you built the item against (SemVer, e.g. 18.6.0). '
                        + 'This server\'s version is the `Authoring contract` line of its instructions. Another major is '
                        + 'refused before anything is saved, naming the version to install; another minor is saved and '
                        + 'advised. The saved item is still validated either way.',
                },
            },
            required: ['type', 'name', 'item'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_metadata_draft',
        description:
            'Discard one pending metadata draft. The published version, if any, is not touched. Pass '
            + '`package` to discard that package\'s draft of the item.',
        parameters: {
            type: 'object',
            properties: {
                type: TYPE_PARAMETER,
                name: { type: 'string', minLength: 1, description: 'The item\'s machine name.' },
                package: { type: 'string', minLength: 1, description: 'The id of the package whose draft to discard.' },
            },
            required: ['type', 'name'],
            additionalProperties: false,
        },
    },
]);

/** The publish judgement of a stored draft (`ObjectStackProtocolImplementation#draftPublishJudgement`). */
export interface OpenAuthoringDraftJudgement {
    refusals: RuntimeAuthoringIssue[];
    advisories: RuntimeAuthoringIssue[];
}

/** The protocol calls this door makes, named structurally (a host may fill the slot partially). */
export type OpenAuthoringProtocol = Partial<Pick<MetadataProtocol, 'getMetaTypes' | 'getMetaItems' | 'getMetaItem' | 'saveMetaItem' | 'deleteMetaItem'>> & {
    listDrafts?(request: { packageId?: string; type?: string }): Promise<ListDraftsResponse>;
    /** The metadata protocol's public draft verdict; with no `body`, it judges the stored draft at the address. */
    draftPublishJudgement?(draft: {
        type: string; name: string; packageId: string | null; member?: string;
        userTextLocales?: readonly (string | undefined)[];
        /** One map per pass: each package's publish closure is collected once, on its first draft. */
        packageClosures?: Map<string, Promise<unknown>>;
    }): Promise<OpenAuthoringDraftJudgement>;
};

/**
 * What the write tools need beyond the protocol, built per request by
 * {@link resolveOpenAuthoringInjection}; a registry handed none refuses every
 * write (fail closed).
 */
export interface OpenAuthoringWriter {
    /** The OAuth client the token was issued to, stated on the save as its `client`. */
    clientId?: string;
    /** The languages the verdict's user sentences are composed in (`userTextLocalesOf`). */
    userTextLocales: string[];
    /** The walled refusal for a write of `type` (`walledCatalogWriteVerdict`). */
    writeVerdict(type: string): Promise<{ allowed: true } | { allowed: false; code: ErrorCode; message: string; status: number }>;
}

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
            ...(reader ? { readGate: openReadGateSources(deps, context, reader), writer: openWriter(deps, context, clientId) } : {}),
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

/**
 * The write tools' per-request inputs. The walled refusal is the one every
 * `/meta` write door asks (`walledCatalogWriteVerdict`), on the posture this
 * transport reads; a posture that cannot be read refuses the write `503`,
 * never a permit. The caller's posture rung is the request envelope's, as the
 * `/meta` doors and the MCP `import_object` tool read it.
 */
function openWriter(deps: DomainHandlerDeps, context: HttpProtocolContext, clientId: string | undefined): OpenAuthoringWriter {
    const ec: any = context.executionContext;
    return {
        ...(clientId ? { clientId } : {}),
        userTextLocales: userTextLocalesOf(ec),
        async writeVerdict(type) {
            let tenancyPosture: Awaited<ReturnType<typeof readEffectiveTenancyPosture>>;
            try {
                tenancyPosture = await readEffectiveTenancyPosture(deps, context);
            } catch {
                return {
                    allowed: false,
                    code: SERVICE_UNAVAILABLE,
                    message: 'This environment\'s tenancy posture could not be read, so no metadata is written. Nothing was saved or discarded; try again.',
                    status: 503,
                };
            }
            const walled = walledCatalogWriteVerdict({ type, tenancyPosture, isSystem: ec?.isSystem === true, callerPosture: ec?.posture });
            return walled.allowed ? { allowed: true } : { allowed: false, code: PERMISSION_DENIED, message: walled.message, status: 403 };
        },
    };
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
    /** The write tools' inputs; without them every write is refused. */
    writer?: OpenAuthoringWriter;
    logger?: { warn?: (...args: unknown[]) => void };
}): OpenAuthoringRegistry {
    const { admitted, userId, getProtocol, readGate, writer } = opts;
    return {
        getAll: () => (admitted ? [...READ_TOOLS, ...WRITE_TOOLS] : []),
        async execute(toolCall, context) {
            const answer = (body: unknown): OpenAuthoringToolResult => ({
                type: 'tool-result',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                output: { type: 'text', value: JSON.stringify(body, null, 2) },
            });
            const refuse = (code: ErrorCode, message: string, status: number, issues?: unknown[]): OpenAuthoringToolResult => ({
                ...answer({ error: { code, message, status, ...(issues ? { issues } : {}) } }),
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
            /** The `/meta` item gate, as the doors that serve a stored version for authoring run it. */
            const itemGate = (type: string, name: string, stored: unknown) =>
                createMetaItemReadGate(readGate(protocol ?? {}), type, name, [stored], STORED_VERSION_DOOR_POLICY)(stored);
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
                        const verdict = await itemGate(type, name, stored);
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
                        if (typeof protocol.draftPublishJudgement !== 'function' || typeof protocol.getMetaItem !== 'function') {
                            return unavailable();
                        }
                        const listed = await protocol.listDrafts(pkg ? { packageId: pkg } : {});
                        const drafts = Array.isArray(listed?.drafts) ? listed.drafts : [];
                        // The list itself runs no item gate, as `/meta/_drafts` runs
                        // none: a row is the item's identity and its own label. Each
                        // verdict is read off the draft's BODY, so it is told only where
                        // the item gate admits the strict draft read for this human.
                        // Cost per draft: that strict read, which the item gate needs
                        // (it judges the served body, and the read folds its own verdict
                        // into `_diagnostics` as every `/meta` draft read does), and the
                        // judgement, which reads the row as stored (the bytes the publish
                        // judges; the served copy is not) and answers each finding whole.
                        // The closure a draft is judged against is its package's alone,
                        // so one map collects it once per package for the judgements.
                        const packageClosures = new Map<string, Promise<unknown>>();
                        const judged = [];
                        for (const draft of drafts) judged.push({ ...draft, ...(await gatedDraftVerdict(protocol, draft, packageClosures)) });
                        return answer({ count: judged.length, drafts: judged });
                    }
                    case 'save_metadata_draft': {
                        if (typeof protocol?.saveMetaItem !== 'function' || typeof protocol.draftPublishJudgement !== 'function') {
                            return unavailable();
                        }
                        if (!writer) return refuse(PERMISSION_DENIED, 'The authoring tools cannot write on this request.', 403);
                        // Folded once to the canonical singular, as the protocol folds a
                        // plural spelling, so the walled verdict, the save, the verdict and
                        // the review route all name the type the protocol writes.
                        const type = canonicalTypeOf(input.type);
                        const name = requiredString(input.name);
                        if (!type || !name) return refuse(VALIDATION_ERROR, 'Name the item as `type` and `name`.', 400);
                        const item = input.item;
                        if (!item || typeof item !== 'object' || Array.isArray(item)) {
                            return refuse(VALIDATION_ERROR, 'Send the item\'s full definition as `item`, an object.', 400);
                        }
                        const pkg = requiredString(input.package);
                        // Seat ruling D4: Studio's Changes review is per package.
                        if (!pkg) return refuse(VALIDATION_ERROR, await packageRequiredMessage(protocol), 400);
                        const ifMatch = input.ifMatch === undefined ? undefined : requiredString(input.ifMatch);
                        if (input.ifMatch !== undefined && !ifMatch) {
                            return refuse(VALIDATION_ERROR, '`ifMatch` is the `version` a read or a save answered.', 400);
                        }
                        // [#34774] The client's spec version, judged before anything is written.
                        const specVerdict = clientSpecVersionVerdict(input.clientSpecVersion);
                        if (specVerdict.refusal) return refuse(VALIDATION_ERROR, specVerdict.refusal, 400);
                        const advised = specVerdict.advisory ? { specVersionAdvisory: specVerdict.advisory } : {};
                        // The `/meta` type-level write admission, before anything is written.
                        const typeWriteRefused = await typeAdmission('PUT', type);
                        if (typeWriteRefused) return refuse(typeWriteRefused.code, typeWriteRefused.message, typeWriteRefused.status);
                        const walled = await writer.writeVerdict(type);
                        if (!walled.allowed) return refuse(walled.code, walled.message, walled.status);
                        // Built field by field: `item` is data, never a channel, so no
                        // `force`, `mode` or `writeFace` rides in through it.
                        const saved = await protocol.saveMetaItem({
                            type,
                            name,
                            item,
                            packageId: pkg,
                            mode: 'draft',
                            surface: 'mcp',
                            ...(writer.clientId ? { client: { id: writer.clientId } } : {}),
                            // The face of a door with no `force` and a structured issues channel.
                            writeFace: 'meta-dispatch',
                            ...(ifMatch ? { parentVersion: ifMatch } : {}),
                            actor: userId,
                            userTextLocales: writer.userTextLocales,
                        });
                        const identity = {
                            type,
                            name,
                            package: pkg,
                            state: (saved as { state?: unknown } | undefined)?.state ?? 'draft',
                            ...((saved as { version?: unknown } | undefined)?.version !== undefined ? { version: (saved as { version?: unknown }).version } : {}),
                        };
                        const review = reviewRoutes(pkg, type, name);
                        // The verdict is a read of the stored draft: told only where the
                        // `/meta` type-level read admission admits this human.
                        const typeReadRefused = await typeAdmission('read', type);
                        if (typeReadRefused) {
                            return answer({ saved: identity, verdict: null, verdictWithheld: typeReadRefused, review, ...advised });
                        }
                        let judgement: OpenAuthoringDraftJudgement;
                        try {
                            judgement = await protocol.draftPublishJudgement({ type, name, packageId: pkg, userTextLocales: writer.userTextLocales });
                        } catch (error) {
                            // The draft is saved; only its verdict is missing, and the
                            // reply says so rather than reading as a refused save.
                            return answer({ saved: identity, verdict: null, verdictError: verdictErrorOf(error), review, ...advised });
                        }
                        return answer({ saved: identity, verdict: verdictOf(judgement), review, ...advised });
                    }
                    case 'delete_metadata_draft': {
                        if (typeof protocol?.deleteMetaItem !== 'function') return unavailable();
                        if (!writer) return refuse(PERMISSION_DENIED, 'The authoring tools cannot write on this request.', 403);
                        const type = canonicalTypeOf(input.type);
                        const name = requiredString(input.name);
                        if (!type || !name) return refuse(VALIDATION_ERROR, 'Name the draft as `type` and `name`.', 400);
                        const pkg = input.package === undefined ? undefined : requiredString(input.package);
                        if (input.package !== undefined && !pkg) return refuse(VALIDATION_ERROR, '`package` is a package id.', 400);
                        const typeWriteRefused = await typeAdmission('DELETE', type);
                        if (typeWriteRefused) return refuse(typeWriteRefused.code, typeWriteRefused.message, typeWriteRefused.status);
                        const walled = await writer.writeVerdict(type);
                        if (!walled.allowed) return refuse(walled.code, walled.message, walled.status);
                        // `state: 'draft'`: the pending draft only, never an active item.
                        await protocol.deleteMetaItem({ type, name, state: 'draft', ...(pkg ? { packageId: pkg } : {}), actor: userId });
                        return answer({ discarded: { type, name, package: pkg ?? null } });
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
                const refusal = await typeAdmission('read', type);
                return refusal ? refuse(refusal.code, refusal.message, refusal.status) : undefined;
            }

            /**
             * The `/meta` type-level admissions, read or write, with the human as
             * the caller: `metaTypeReadRefusal` for a read of a typed item (a draft's
             * body, the verdict read off it), `metaTypeWriteRefusal` for a draft save
             * (`PUT`) or discard (`DELETE`), as the `/meta` entry asks them of the
             * same verbs. `undefined` admits.
             */
            async function typeAdmission(
                kind: 'read' | 'PUT' | 'DELETE',
                type: string,
            ): Promise<{ code: ErrorCode; message: string; status: number } | undefined> {
                const caller = await readGate!(protocol ?? {}).resolveCaller();
                return kind === 'read' ? metaTypeReadRefusal('GET', type, caller) : metaTypeWriteRefusal(kind, type, caller);
            }

            function unavailable(): OpenAuthoringToolResult {
                return refuse(SERVICE_UNAVAILABLE, 'This environment serves no metadata protocol this tool can use.', 503);
            }

            /** One draft's verdict, told where the item gate admits this human's strict draft read. */
            async function gatedDraftVerdict(
                p: OpenAuthoringProtocol,
                listed: { type: string; name: string; packageId?: string | null; member?: string },
                packageClosures: Map<string, Promise<unknown>>,
            ): Promise<{ verdict: ReturnType<typeof verdictOf> | null; verdictWithheld?: unknown; verdictError?: unknown }> {
                // The gate and the judgement read the canonical singular, folded by
                // the door's one helper; a row with no type keeps the row's own.
                const draft = { ...listed, type: canonicalTypeOf(listed.type) ?? listed.type };
                try {
                    // A type this human may not read: neither its body nor a verdict read off it.
                    const typeRefused = await typeAdmission('read', draft.type);
                    if (typeRefused) return { verdict: null, verdictWithheld: typeRefused };
                    // A package-unbound draft is read without a package: the strict
                    // draft read's own address resolution then names it.
                    const read = await p.getMetaItem!({
                        type: draft.type,
                        name: draft.name,
                        state: 'draft',
                        ...(draft.packageId ? { packageId: draft.packageId } : {}),
                        ...(draft.member !== undefined ? { member: draft.member } : {}),
                    } as Parameters<NonNullable<OpenAuthoringProtocol['getMetaItem']>>[0]);
                    if (read?.item === undefined || read.item === null) {
                        return { verdict: null, verdictWithheld: { code: RESOURCE_NOT_FOUND, message: `No '${draft.type}' draft named '${draft.name}' is readable here.`, status: 404 } };
                    }
                    const gate = await itemGate(draft.type, draft.name, read.item);
                    if (gate.kind === 'refuse') {
                        const { refusal } = gate;
                        return {
                            verdict: null,
                            verdictWithheld: refusal.reason === 'absent'
                                ? { code: RESOURCE_NOT_FOUND, message: `No '${draft.type}' draft named '${draft.name}' is readable here.`, status: 404 }
                                : { code: refusal.code, message: refusal.message, status: refusal.status },
                        };
                    }
                    const judgement = await p.draftPublishJudgement!({
                        type: draft.type,
                        name: draft.name,
                        packageId: draft.packageId ?? null,
                        ...(draft.member !== undefined ? { member: draft.member } : {}),
                        ...(writer ? { userTextLocales: writer.userTextLocales } : {}),
                        packageClosures,
                    });
                    return { verdict: verdictOf(judgement) };
                } catch (error) {
                    return { verdict: null, verdictError: verdictErrorOf(error) };
                }
            }

            /** A verdict that could not be reached: a coded refusal keeps its code; a fault is named without its text. */
            function verdictErrorOf(error: unknown): { code: string; message: string; status: number } {
                const code = (error as { code?: unknown } | null)?.code;
                const status = (error as { status?: unknown } | null)?.status;
                if (typeof code === 'string' && code.length > 0 && typeof status === 'number' && status < 500) {
                    return { code, message: error instanceof Error ? error.message : String(error), status };
                }
                (opts.logger ?? console).warn?.(`[MCP] ${toolCall.toolName}: the publish verdict could not be read`, {
                    error: error instanceof Error ? error.message : String(error),
                });
                return { code: INTERNAL_ERROR, message: 'The publish verdict could not be read.', status: 500 };
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
                    // The structured findings travel beside the message: the save
                    // states the `meta-dispatch` face, whose spec-validation refusal
                    // trims its message to a headline because the face carries
                    // `issues[]` (`specValidationFindings`), so they are relayed here.
                    const issues = (error as { issues?: unknown } | null)?.issues;
                    return refuse(code as ErrorCode, error instanceof Error ? error.message : String(error), status, Array.isArray(issues) ? issues : undefined);
                }
                (opts.logger ?? console).warn?.(`[MCP] ${toolCall.toolName} failed`, {
                    error: error instanceof Error ? error.message : String(error),
                });
                return refuse(
                    INTERNAL_ERROR,
                    toolCall.toolName === 'save_metadata_draft' ? 'Saving the draft failed.'
                        : toolCall.toolName === 'delete_metadata_draft' ? 'Discarding the draft failed.'
                            : 'Reading the metadata failed.',
                    500,
                );
            }
        },
    };
}

/** A judgement as the replies carry it: `publishable` is "no refusal". */
function verdictOf(judgement: OpenAuthoringDraftJudgement): {
    publishable: boolean;
    refusals: RuntimeAuthoringIssue[];
    advisories: RuntimeAuthoringIssue[];
} {
    const refusals = Array.isArray(judgement?.refusals) ? judgement.refusals : [];
    const advisories = Array.isArray(judgement?.advisories) ? judgement.advisories : [];
    return { publishable: refusals.length === 0, refusals, advisories };
}

/**
 * Where a person reviews the draft, as Console routes: the package's Changes
 * drawer (`?changes=review` on its Interfaces pillar, `studioChangesLink.ts`)
 * and the item's draft review on Studio's metadata area (`?review=1`).
 */
function reviewRoutes(packageId: string, type: string, name: string): { changes: string; item: string; note: string } {
    const pkg = encodeURIComponent(packageId);
    return {
        changes: `/studio/${pkg}/interfaces?changes=review`,
        item: `/studio/${pkg}/metadata/${encodeURIComponent(type)}/${encodeURIComponent(name)}?review=1`,
        note: 'Console routes. A person reviews and publishes the draft there; this server cannot publish.',
    };
}

/** How many writable package ids the missing-package refusal names. */
const NAMED_PACKAGES_CAP = 20;

/**
 * The refusal of a save naming no package (seat ruling D4), naming the
 * packages it may name: the protocol's own writability verdict on each
 * installed package (`getMetaItems({ type: 'package' })`'s `writable`).
 */
async function packageRequiredMessage(protocol: OpenAuthoringProtocol): Promise<string> {
    const head = 'Name the package to save the draft into as `package`: Studio reviews and publishes drafts per package. Nothing was saved.';
    let writable: string[] | undefined;
    try {
        const listed = typeof protocol.getMetaItems === 'function' ? await protocol.getMetaItems({ type: 'package' }) : undefined;
        if (listed && Array.isArray(listed.items)) {
            writable = listed.items
                .filter((p: any) => p?.writable === true)
                .map((p: any) => p?.manifest?.id ?? p?.id)
                .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
        }
    } catch {
        writable = undefined;
    }
    if (writable === undefined) return `${head} The packages could not be listed on this request; list them with list_metadata_items, type "package".`;
    if (writable.length === 0) return `${head} No package in this environment is writable: create one in Studio first.`;
    const named = writable.slice(0, NAMED_PACKAGES_CAP).join(', ');
    return `${head} Writable packages here: ${named}${writable.length > NAMED_PACKAGES_CAP ? `, and ${writable.length - NAMED_PACKAGES_CAP} more` : ''}.`;
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
