// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §3 regime C, as ADR-0131 D6 amends it] THE ACTIVATION DOOR for the
 * security catalog: `POST /security/_activation/:type/:name`, body
 * `{ enabled?: boolean }`, `:type` one of `position` / `permission`, and — since
 * ADR-0131 D6 charts declared sharing rules under regime C — `sharing_rule`, a
 * rule a package declares, read from the sharing-rule service (`sharingRules`)
 * rather than the security catalog; and `webhook`, a webhook a stack declares
 * (`defineStack({ webhooks })`), read from the declared-webhook reader
 * (`declaredWebhooks`, plugin-webhooks) under the same regime (ADR-0131 D2/D6,
 * the ruling that retired the declared-webhook seeder); and, since ADR-0142,
 * `queue`, a queue a stack declares (`queues`), read from the `ownership-queue`
 * service, and `assignment_rule`, a rule a stack declares (`assignmentRules`),
 * read from the engine's metadata registry, where the evaluator reads it.
 *
 * ## Why it exists
 *
 * ADR-0131 D3 moves the on/off switch of a position and of a permission set off
 * the catalog row and into the deployment-level activation ledger,
 * `sys_metadata_activation` — one row per `(metadata_type, name)`, no tenant
 * column. `resolveUserAuthzGrants` reads that ledger for both types and never
 * the catalog row's `active` column (`readDisabledCatalogNames`,
 * `@objectstack/core`'s `security/resolve-authz-context.ts`). Before this door
 * nothing wrote the ledger for these two types — only the flow and action
 * stores did — so a deactivation switched nothing off. This is the write half
 * of that read.
 *
 * ## The spelling, and why it is the action door's
 *
 * Every activation door shares the verb (`POST`), the body
 * (`{ enabled?: boolean }`, {@link readActivationBody}) and the authority
 * ({@link refuseUngrantedActivationAuthoring}, then
 * {@link refuseUngrantedActivationWrite}). The path mirrors the action door,
 * `POST /actions/_activation/:object/:action`: a reserved `_activation` first
 * segment, then the address the ledger keys a row by. Machine names cannot
 * begin with `_` (`SnakeCaseIdentifierSchema`), so the segment collides with
 * nothing this domain serves, and `:type` is the ledger's own `metadata_type`
 * value — the two catalog types the resolver honours, nothing wider.
 *
 * ## What it writes, and what it deliberately does not
 *
 * One `sys_metadata_activation` row through the shared
 * `ObjectStoreMetadataActivationStore` — the same row contract the flow and
 * action stores use. Unlike theirs, this door's subjects need not be packaged:
 * a position or permission set the environment authored is switched the same
 * way (#22621 → A), and its row carries no package. ⛔ No definition is touched, ⛔ no catalog row's `active`
 * is written (ADR-0131 D3: that column is not the switch any more), ⛔ no clone
 * is authored. The write goes through the engine, so every hook on the ledger
 * runs: the last-admin guard refuses switching `admin_full_access` off
 * (ADR-0135 D5.2), and the grants cache drops what it holds for the ledger.
 *
 * Who may call it is exactly who may call the flow and action doors: the
 * caller's `manage_metadata`, then the ADR-0126 §5 posture rule (inert under
 * `single`, the platform operator under a wall). ⛔ No new authority.
 *
 * ## A declared webhook two packages declare (ADR-0150 D3/D4/D5, #31699)
 *
 * Two packages of two namespaces may each declare a webhook of one name, and
 * the dispatcher reads each one's switch from its own row,
 * `(webhook, package_id, name)`. So the webhook store is addressed by
 * `(package, name)` ({@link WEBHOOK_LEDGER_ADDRESSING}): switching one
 * holder's webhook never touches the other's row. The bare
 * `webhook/:name` answers a name two packages declare `409
 * RESOURCE_CONFLICT`, naming both (it was a `503`: the reader's refusal
 * carried no `refusal`), and `POST /security/_activation/webhook/:ns/:name`
 * addresses the holder in namespace `:ns` ({@link resolveQualifiedWebhook}).
 * A row naming no package becomes the holder's own when the name has that one
 * holder (`adoptPackageless`, ADR-0150 D8), as the name-addressed store wrote
 * it before; under two holders it is neither's and is never written for one.
 */

import { AUDIENCE_ANCHOR_POSITIONS, GUEST_POSITION } from '@objectstack/spec/identity';
import { OWNERSHIP_QUEUE_SERVICE, type IOwnershipQueueService, type ISharingRuleService } from '@objectstack/spec/contracts';
import {
    METADATA_ACTIVATION_TABLE,
    ObjectStoreMetadataActivationStore,
    PackageScopedNameRefusedError,
    packageScopedRefusalMessage,
    securityCatalogReaderOf,
    type PackageScopedHolder,
    type PackageScopedRefusal,
    type SecurityCatalogEntry,
} from '@objectstack/core';
import {
    refuseUngrantedActivationWrite,
    refuseUngrantedActivationAuthoring,
    readActivationBody,
    activationWriteContext,
    POSITION_ACTIVATION_SUBJECT,
    PERMISSION_SET_ACTIVATION_SUBJECT,
    SHARING_RULE_ACTIVATION_SUBJECT,
    WEBHOOK_ACTIVATION_SUBJECT,
    QUEUE_ACTIVATION_SUBJECT,
    ASSIGNMENT_RULE_ACTIVATION_SUBJECT,
    type ActivationSubject,
} from './activation-gate.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

/** The reserved first segment of the door (see the module doc). */
export const CATALOG_ACTIVATION_SEGMENT = '_activation';

/**
 * The ledger types this door writes, each with its refusal wording. Exactly the
 * types the resolver reads from the ledger; `capability` is code-only on the
 * regime and has no switch.
 */
const CATALOG_ACTIVATION_SUBJECTS: Readonly<Record<
    'position' | 'permission' | 'sharing_rule' | 'webhook' | 'queue' | 'assignment_rule',
    ActivationSubject
>> = {
    position: POSITION_ACTIVATION_SUBJECT,
    permission: PERMISSION_SET_ACTIVATION_SUBJECT,
    // [ADR-0131 D6 regime C] A declared sharing rule — read from the sharing-rule
    // service, which serves no declaration this ledger switches off.
    sharing_rule: SHARING_RULE_ACTIVATION_SUBJECT,
    // [ADR-0131 D2/D6 regime C] A declared webhook — read from the declared-webhook
    // reader, which the dispatcher reads its switch through.
    webhook: WEBHOOK_ACTIVATION_SUBJECT,
    // [ADR-0142 D1] A declared ownership queue — read from the queue service,
    // which resolves no declared queue this ledger switches off.
    queue: QUEUE_ACTIVATION_SUBJECT,
    // [ADR-0142 D5] A declared assignment rule — read from the registry the
    // engine's evaluator reads, which skips a rule this ledger switches off.
    assignment_rule: ASSIGNMENT_RULE_ACTIVATION_SUBJECT,
};

type CatalogActivationType = keyof typeof CATALOG_ACTIVATION_SUBJECTS;

function isCatalogActivationType(type: string): type is CatalogActivationType {
    return Object.prototype.hasOwnProperty.call(CATALOG_ACTIVATION_SUBJECTS, type);
}

/** The catalog noun a sentence names, per type. */
const NOUN: Readonly<Record<CatalogActivationType, string>> = {
    position: 'Position',
    permission: 'Permission set',
    sharing_rule: 'Declared sharing rule',
    webhook: 'Declared webhook',
    queue: 'Declared queue',
    assignment_rule: 'Declared assignment rule',
};

/**
 * [ADR-0131 D6 regime C] The declaration a `sharing_rule` row addresses, as the
 * sharing-rule service (`sharingRules`, plugin-sharing) reads it: declared in
 * the code, whether or not the ledger has it switched off. A rule an
 * organization authored is a `sys_sharing_rule` row with a switch of its own
 * (`active`) and is never addressed here.
 *
 * The reader is the contract's own optional member,
 * `ISharingRuleService.declaredRuleNamed` (`@objectstack/spec/contracts`): this
 * door probes for its presence and answers 503 when it is absent.
 */
type DeclaredSharingRuleReader = Required<Pick<ISharingRuleService, 'declaredRuleNamed'>>;

function declaredSharingRuleReaderOf(service: unknown): DeclaredSharingRuleReader | undefined {
    const candidate = service as Partial<DeclaredSharingRuleReader> | null | undefined;
    return typeof candidate?.declaredRuleNamed === 'function' ? (candidate as DeclaredSharingRuleReader) : undefined;
}

/**
 * [ADR-0131 D2/D6 regime C] The declaration a `webhook` row addresses, as the
 * declared-webhook reader (`declaredWebhooks`, plugin-webhooks) reads it:
 * declared in the code, whether or not the ledger has it switched off. A
 * webhook an organization authored is a `sys_webhook` row with a switch of its
 * own (`active`) and is never addressed here.
 */
interface DeclaredWebhookReader {
    declaredWebhookNamed(name: string): Promise<{ webhook: { name: string }; packageId?: string } | null>;
    /** Every declaration, one per `(package, name)` slot (#31699): read by the qualified door. */
    list?(): Promise<Array<{ webhook: { name: string }; packageId?: string }>>;
}

/**
 * [ADR-0150 D4, #31699] The webhook type's ledger rows are addressed by
 * `(package, name)`, as flows' are (`flow-activation-store.ts`): the
 * dispatcher reads each holder's switch from its own row. Only this type and
 * the stores that already were; every other type's store stays name-addressed.
 */
export const WEBHOOK_LEDGER_ADDRESSING = { addressing: 'package-and-name' } as const;

/**
 * [ADR-0150 D5, #31699] The declared webhook `POST /security/_activation/
 * webhook/:ns/:name` addresses: among the packages of namespace `namespace`
 * (the registry's `getNamespaceOwners`), the one that declares `name`. Two —
 * a shareable namespace's co-owners — are refused naming each
 * (`ambiguous-in-namespace`); none is refused naming the holders there are
 * (`not-held-by-qualifier`), or answered `404` when nothing declares the name
 * or no package declares the namespace. `holders` is how many slots the name
 * has, for the write's `adoptPackageless`.
 */
async function resolveQualifiedWebhook(
    reader: DeclaredWebhookReader,
    ql: any,
    namespace: string,
    name: string,
): Promise<
    | { readonly entry: { name: string; packageId: string }; readonly holders: number }
    | { readonly refusal: PackageScopedRefusal }
    | { readonly missing: string }
> {
    const owners: string[] = typeof ql?.registry?.getNamespaceOwners === 'function'
        ? ql.registry.getNamespaceOwners(namespace) ?? []
        : [];
    if (owners.length === 0) return { missing: `no installed package declares the namespace '${namespace}'` };
    const slots = (await reader.list!()).filter((d) => d.webhook.name === name);
    const holding = slots.flatMap((d) => (d.packageId !== undefined && owners.includes(d.packageId) ? [d.packageId] : []));
    if (holding.length === 1) return { entry: { name, packageId: holding[0] }, holders: slots.length };
    if (holding.length === 0 && slots.length === 0) return { missing: `nothing declares it in namespace '${namespace}'` };
    const candidates: PackageScopedHolder[] = (holding.length > 1 ? holding : slots.map((d) => d.packageId))
        .map((packageId) => (packageId === undefined ? { kind: 'environment' as const } : { kind: 'package' as const, packageId }));
    const base = {
        status: 'refused' as const,
        reason: holding.length > 1 ? 'ambiguous-in-namespace' as const : 'not-held-by-qualifier' as const,
        type: 'webhook' as const,
        name,
        callerPackageId: holding.length > 1 ? null : owners[0],
        candidates,
    };
    return { refusal: { ...base, message: packageScopedRefusalMessage(base) } };
}

function declaredWebhookReaderOf(service: unknown): DeclaredWebhookReader | undefined {
    const candidate = service as Partial<DeclaredWebhookReader> | null | undefined;
    return typeof candidate?.declaredWebhookNamed === 'function' ? (candidate as DeclaredWebhookReader) : undefined;
}

/**
 * [ADR-0142 D1] The declaration a `queue` row addresses, as the queue service
 * (`ownership-queue`, plugin-sharing) reads it: declared in the code, whether
 * or not the ledger has it switched off. A queue an organization authored is a
 * `sys_queue` row and is never addressed here.
 */
type DeclaredQueueReader = Required<Pick<IOwnershipQueueService, 'declaredQueueNamed'>>;

function declaredQueueReaderOf(service: unknown): DeclaredQueueReader | undefined {
    const candidate = service as Partial<DeclaredQueueReader> | null | undefined;
    return typeof candidate?.declaredQueueNamed === 'function' ? (candidate as DeclaredQueueReader) : undefined;
}

/**
 * [ADR-0142 D5] The declaration an `assignment_rule` row addresses: the item of
 * that type in the engine's metadata registry — the one the engine's evaluator
 * lists on every insert — whether or not the ledger has it switched off.
 * `undefined` when the engine carries no registry to ask.
 */
function declaredAssignmentRuleNamed(
    ql: unknown,
    name: string,
): Promise<{ name: string; packageId?: string } | null> | undefined {
    const registry = (ql as { registry?: { listItems?: (type: string) => unknown } } | null | undefined)?.registry;
    if (typeof registry?.listItems !== 'function') return undefined;
    return Promise.resolve(registry.listItems('assignment_rule')).then((items) => {
        const declared = (Array.isArray(items) ? items : [])
            .filter((i: any) => i && typeof i === 'object' && i.name === name) as Array<Record<string, unknown>>;
        if (declared.length === 0) return null;
        const packageOf = (item: Record<string, unknown>): string | undefined => {
            const packageId = item._packageId ?? item.packageId;
            return typeof packageId === 'string' && packageId ? packageId : undefined;
        };
        // [ADR-0150 D3/D5, child G1] Two packages declaring the name are two
        // items, and the door names neither by package: refused naming every
        // holder (`409 RESOURCE_CONFLICT`), never the first one listed.
        const holders = [...new Set(declared.map(packageOf))];
        if (holders.length > 1) {
            const candidates: PackageScopedHolder[] = holders.map((packageId) =>
                (packageId === undefined ? { kind: 'environment' as const } : { kind: 'package' as const, packageId }));
            const refusal = {
                status: 'refused' as const,
                reason: 'ambiguous-in-environment' as const,
                type: 'assignment_rule' as const,
                name,
                callerPackageId: null,
                candidates,
            };
            throw new PackageScopedNameRefusedError({ ...refusal, message: packageScopedRefusalMessage(refusal) });
        }
        const packageId = packageOf(declared[0]);
        return { name, ...(packageId ? { packageId } : {}) };
    });
}

/**
 * [ADR-0150 D5, epic #31527 child G1] The package-scoped rule's refusal a
 * declared-name reader threw (plugin-sharing's `declaredRuleNamed` and
 * `declaredQueueNamed` since E4, the assignment-rule lookup above), or
 * `undefined` for any other failure. A refusal is an answer about the name —
 * two holders, nothing picked — never a read that failed, so the door answers
 * it as one.
 */
function packageScopedRefusalOf(err: unknown): PackageScopedRefusal | undefined {
    if (err instanceof PackageScopedNameRefusedError) return err.refusal;
    const refusal = (err as { code?: unknown; refusal?: Partial<PackageScopedRefusal> } | null | undefined);
    return refusal?.code === 'RESOURCE_CONFLICT' && refusal.refusal?.status === 'refused'
        && Array.isArray(refusal.refusal.candidates) && typeof refusal.refusal.message === 'string'
        ? refusal.refusal as PackageScopedRefusal
        : undefined;
}

/**
 * The door's answer to a refused name: `409 RESOURCE_CONFLICT`, the
 * resolver's sentence, and every candidate in the envelope — the shape the
 * `/actions` door answers its own refusal with. Nothing is written.
 */
function refusedNameAnswer(deps: DomainHandlerDeps, refusal: PackageScopedRefusal): HttpDispatcherResult {
    return {
        handled: true,
        response: deps.error(refusal.message, 409, { code: 'RESOURCE_CONFLICT', candidates: refusal.candidates }),
    };
}

/**
 * The declaration-backed types — declarations a plugin or the engine owns, not
 * catalog entries — each with how its declaration is looked up and how it is
 * named in a refusal. `service` absent means the lookup reads the engine.
 */
const DECLARATION_LOOKUPS: Readonly<Record<'sharing_rule' | 'webhook' | 'queue' | 'assignment_rule', {
    service?: string;
    noun: string;
    serviceNoun: string;
    authoredRemedy: string;
    lookup(service: unknown, name: string, ql: unknown): Promise<{ name: string; packageId?: string } | null> | undefined;
}>> = {
    sharing_rule: {
        service: 'sharingRules',
        noun: 'sharing rule',
        serviceNoun: 'sharing-rule service',
        authoredRemedy: 'A rule your organization authored is switched by its own `active` field.',
        lookup: (service, name) => declaredSharingRuleReaderOf(service)?.declaredRuleNamed(name),
    },
    webhook: {
        service: 'declaredWebhooks',
        noun: 'webhook',
        serviceNoun: 'declared-webhook reader',
        authoredRemedy: 'A webhook your organization authored is switched by its own `active` field.',
        lookup: (service, name) => {
            const reader = declaredWebhookReaderOf(service);
            return reader
                ? reader.declaredWebhookNamed(name).then((d) => (d
                    ? { name: d.webhook.name, ...(d.packageId !== undefined ? { packageId: d.packageId } : {}) }
                    : null))
                : undefined;
        },
    },
    queue: {
        service: OWNERSHIP_QUEUE_SERVICE,
        noun: 'queue',
        serviceNoun: 'ownership-queue service',
        authoredRemedy: 'A queue your organization authored is a `sys_queue` row: staff or delete it there.',
        lookup: (service, name) => declaredQueueReaderOf(service)?.declaredQueueNamed(name),
    },
    assignment_rule: {
        noun: 'assignment rule',
        serviceNoun: 'metadata registry',
        authoredRemedy: 'Assignment rules are declared by the application only; an organization authors none.',
        lookup: (_service, name, ql) => declaredAssignmentRuleNamed(ql, name),
    },
};

function isDeclarationType(type: CatalogActivationType): type is keyof typeof DECLARATION_LOOKUPS {
    return Object.prototype.hasOwnProperty.call(DECLARATION_LOOKUPS, type);
}

/**
 * Does this request belong to the door? Every `POST` under `_activation`, with
 * no upper bound on depth, so the gate is exactly as wide as the arm: a
 * wrong-shaped path is refused by the arm with the shape named, never passed on.
 */
export function isCatalogActivationWrite(parts: readonly string[], method: string): boolean {
    return method === 'POST' && parts[0] === CATALOG_ACTIVATION_SEGMENT;
}

/** Whether the engine's registry says the ledger object is absent from this composition. */
function ledgerUnregistered(ql: any): boolean {
    const getObject = ql?.registry?.getObject;
    if (typeof getObject !== 'function') return false;
    try {
        return !getObject.call(ql.registry, METADATA_ACTIVATION_TABLE);
    } catch {
        return false; // a registry that cannot answer is not an answer: write, and let the write decide
    }
}

/**
 * `POST /security/_activation/:type/:name` — flip one position's or permission
 * set's deployment-level activation row.
 *
 * Order of operations, each step where it is for the reason given:
 *
 *  1. **Both authority gates, first** — ahead of the path and body checks and
 *     of any lookup, so a refused caller writes nothing and learns nothing:
 *     neither the body contract nor whether the name exists here. The refusal
 *     names the subject the PATH asked for; a path whose type is not a catalog
 *     type is refused with the position wording, which says nothing a refused
 *     caller could not read off the route ledger.
 *  2. **Shape**: `['_activation', type, name]`, `type` a catalog type, and
 *     not an audience anchor (`everyone` / `guest`), which this door refuses;
 *     or `['_activation', 'webhook', ns, name]` (#31699).
 *  3. **Body**: {@link readActivationBody}.
 *  4. **Declaration**, through the catalog reader the security plugin binds to
 *     the engine — the one `resolveUserAuthzGrants` reads, so this door and
 *     the resolver cannot disagree about which names exist. No reader bound,
 *     or a reader that cannot answer ⇒ 503 (an outage is not a verdict);
 *     unknown ⇒ 404.
 *  5. **The durable write**, through the engine. A packaged item's row names
 *     its package; an environment-authored item's row names none.
 */
export async function handleCatalogActivationWrite(
    deps: DomainHandlerDeps,
    parts: readonly string[],
    body: unknown,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    const requestedType = parts[1] ?? '';
    const subject = isCatalogActivationType(requestedType)
        ? CATALOG_ACTIVATION_SUBJECTS[requestedType]
        : POSITION_ACTIVATION_SUBJECT;

    // ── 1. authority ────────────────────────────────────────────────────────
    const authoringRefusal = refuseUngrantedActivationAuthoring(deps, context, subject);
    if (authoringRefusal) return authoringRefusal;
    const postureRefusal = await refuseUngrantedActivationWrite(deps, context, subject);
    if (postureRefusal) return postureRefusal;

    // ── 2. shape ────────────────────────────────────────────────────────────
    // [ADR-0150 D5, #31699] A declared webhook is also addressed by its
    // namespace: `['_activation', 'webhook', ns, name]`.
    const qualified = parts.length === 4 && requestedType === 'webhook' && !!parts[2] && !!parts[3];
    if (!qualified && (parts.length !== 3 || !isCatalogActivationType(requestedType) || !parts[2])) {
        return {
            handled: true,
            response: deps.error(
                `Path must be /security/_activation/:type/:name, with :type one of ` +
                `${Object.keys(CATALOG_ACTIVATION_SUBJECTS).map((t) => `\`${t}\``).join(', ')}` +
                (requestedType === 'webhook' ? ', or /security/_activation/webhook/:namespace/:name' : ''),
                400,
            ),
        };
    }
    const type = requestedType as CatalogActivationType;
    const namespace = qualified ? parts[2] : undefined;
    const name = qualified ? parts[3] : parts[2];
    let adoptPackageless = false;

    // ── 2b. the audience anchors ────────────────────────────────────────────
    // [ADR-0090 D5/D9] `everyone` is the authenticated baseline every signed-in
    // member holds implicitly, and `guest` the anonymous one. One row here
    // would switch either off for every principal in the deployment at once.
    // Stage 1 kept the anchors sealed against every caller-reachable write, and
    // this door keeps that: refused in either direction, before the body is
    // read and before any lookup or write, with the same 400 as a type that has
    // no switch — a well-formed target this door does not switch.
    if (type === 'position' && (AUDIENCE_ANCHOR_POSITIONS as readonly string[]).includes(name)) {
        return {
            handled: true,
            response: deps.error(
                `Position '${name}' is an audience anchor: it carries the ${name === GUEST_POSITION ? 'anonymous' : 'authenticated'} ` +
                `baseline of every principal in the deployment, so it is not switchable through this door (ADR-0090 D5/D9). ` +
                `Change what it grants through the permission sets bound to it instead.`,
                400,
            ),
        };
    }

    // ── 3. body ─────────────────────────────────────────────────────────────
    const bodyReading = readActivationBody(deps, body);
    if (bodyReading.refusal) return bodyReading.refusal;
    const enabled = bodyReading.enabled;

    // ── 4. declaration ──────────────────────────────────────────────────────
    if (!context.environmentId) {
        const def = deps.getDefaultEnvironmentId();
        if (def) context.environmentId = def;
    }
    const ql: any = (await deps.resolveProjectKernelObjectQL(context))
        ?? await deps.getObjectQL(context, context.environmentId);
    if (!ql) {
        return { handled: true, response: deps.error('Data engine not available', 503) };
    }
    let entry: { name: string; packageId?: string } | undefined;
    if (namespace !== undefined) {
        const reader = declaredWebhookReaderOf(await deps.resolveService(context, 'declaredWebhooks'));
        if (!reader || typeof reader.list !== 'function') {
            return {
                handled: true,
                response: deps.error(
                    `Cannot verify the declaration of webhook '${name}' — no declared-webhook reader is bound to this ` +
                    `deployment. Refusing rather than writing an activation row for a name nobody can confirm exists.`,
                    503,
                    { code: 'SERVICE_UNAVAILABLE' },
                ),
            };
        }
        let address: Awaited<ReturnType<typeof resolveQualifiedWebhook>>;
        try {
            address = await resolveQualifiedWebhook(reader, ql, namespace, name);
        } catch (err: any) {
            return {
                handled: true,
                response: deps.error(
                    `Cannot verify the declaration of webhook '${name}' — the declared webhooks could not be read ` +
                    `(${err?.message ?? String(err)}). Refusing rather than writing an activation row for a name nobody ` +
                    `can confirm exists.`,
                    503,
                    { code: 'SERVICE_UNAVAILABLE' },
                ),
            };
        }
        if ('refusal' in address) return refusedNameAnswer(deps, address.refusal);
        if ('missing' in address) {
            return {
                handled: true,
                response: deps.error(
                    `Webhook '${name}' is not declared in namespace '${namespace}': ${address.missing}. There is nothing ` +
                    `to switch ${enabled ? 'on' : 'off'}. ${DECLARATION_LOOKUPS.webhook.authoredRemedy}`,
                    404,
                ),
            };
        }
        entry = address.entry;
        adoptPackageless = address.holders === 1;
    } else if (isDeclarationType(type)) {
        const declaration = DECLARATION_LOOKUPS[type];
        const service = declaration.service ? await deps.resolveService(context, declaration.service) : undefined;
        let pending: Promise<{ name: string; packageId?: string } | null> | undefined;
        try {
            pending = declaration.lookup(service, name, ql);
        } catch (err) {
            pending = Promise.reject(err); // a reader that throws before its promise is still a failed read
        }
        if (!pending) {
            return {
                handled: true,
                response: deps.error(
                    `Cannot verify the declaration of ${declaration.noun} '${name}' — no ${declaration.serviceNoun} is ` +
                    `bound to this deployment. Refusing rather than writing an activation row for a name nobody can ` +
                    `confirm exists.`,
                    503,
                    { code: 'SERVICE_UNAVAILABLE' },
                ),
            };
        }
        try {
            entry = (await pending) ?? undefined;
        } catch (err: any) {
            const refusal = packageScopedRefusalOf(err);
            if (refusal) return refusedNameAnswer(deps, refusal);
            return {
                handled: true,
                response: deps.error(
                    `Cannot verify the declaration of ${declaration.noun} '${name}' — the declared ${declaration.noun}s ` +
                    `could not be read (${err?.message ?? String(err)}). Refusing rather than writing an activation row ` +
                    `for a name nobody can confirm exists.`,
                    503,
                    { code: 'SERVICE_UNAVAILABLE' },
                ),
            };
        }
        // [ADR-0150 D8] A bare name resolves to a package only while that
        // package is its one holder: its row naming no package is its own.
        adoptPackageless = type === 'webhook' && entry?.packageId !== undefined;
        if (!entry) {
            const noun = declaration.noun.charAt(0).toUpperCase() + declaration.noun.slice(1);
            return {
                handled: true,
                response: deps.error(
                    `${noun} '${name}' is not declared by the application — there is nothing to switch ` +
                    `${enabled ? 'on' : 'off'}. ${declaration.authoredRemedy}`,
                    404,
                ),
            };
        }
    }
    const reader = isDeclarationType(type) ? undefined : securityCatalogReaderOf(ql);
    if (!isDeclarationType(type) && !reader) {
        return {
            handled: true,
            response: deps.error(
                `Cannot verify the definition of ${NOUN[type].toLowerCase()} '${name}' — no security catalog is bound to ` +
                `this deployment's data engine. Refusing rather than writing an activation row for a name nobody can ` +
                `confirm exists.`,
                503,
                { code: 'SERVICE_UNAVAILABLE' },
            ),
        };
    }
    try {
        if (reader) entry = (await reader.resolve(type as 'position' | 'permission', name)) as SecurityCatalogEntry | undefined;
    } catch (err: any) {
        const refusal = packageScopedRefusalOf(err);
        if (refusal) return refusedNameAnswer(deps, refusal);
        return {
            handled: true,
            response: deps.error(
                `Cannot verify the definition of ${NOUN[type].toLowerCase()} '${name}' — the security catalog could not ` +
                `be read (${err?.message ?? String(err)}). Refusing rather than writing an activation row for a name ` +
                `nobody can confirm exists.`,
                503,
                { code: 'SERVICE_UNAVAILABLE' },
            ),
        };
    }
    if (!entry) {
        return {
            handled: true,
            response: deps.error(
                `${NOUN[type]} '${name}' has no definition — there is nothing to switch ${enabled ? 'on' : 'off'}. ` +
                `The activation ledger addresses DECLARED catalog items (ADR-0126 §4).`,
                404,
            ),
        };
    }

    // ── 5. the durable write ────────────────────────────────────────────────
    if (ledgerUnregistered(ql) || typeof ql.find !== 'function' || typeof ql.insert !== 'function'
        || typeof ql.update !== 'function') {
        // The resolver reads an absent ledger as "nothing switched off", so a
        // 200 here would report a switch that never existed.
        return {
            handled: true,
            response: deps.error(
                `This deployment does not carry the activation ledger (${METADATA_ACTIVATION_TABLE}, ADR-0126 §4), ` +
                `so ${NOUN[type].toLowerCase()} '${name}' cannot be switched ${enabled ? 'on' : 'off'} here.`,
                501,
            ),
        };
    }
    try {
        // [#22621 → A] The row carries the definition's package when it names
        // one, and NO package when it does not — a position or permission set
        // the environment authored through the metadata door. That item is
        // switched exactly like a packaged one: the resolver keys the row by
        // type and name, never by package. The write runs for the caller,
        // elevated, so the row and its audit row name the administrator who
        // switched the item (`activationWriteContext`).
        await new ObjectStoreMetadataActivationStore(ql, type, type === 'webhook' ? WEBHOOK_LEDGER_ADDRESSING : undefined).setActive(
            {
                name: entry.name,
                ...(entry.packageId !== undefined ? { packageId: entry.packageId } : {}),
                active: enabled,
            },
            { context: activationWriteContext(context), ...(adoptPackageless ? { adoptPackageless } : {}) },
        );
    } catch (err: unknown) {
        // A failed write must never read as a successful flip, and its code and
        // status must say the same thing (ADR-0112). The one shared rule
        // decides both (`resolveThrownHttpError`): a hook's refusal keeps its
        // own (the last-admin guard: 403 PERMISSION_DENIED), a record
        // validation refusal is 400 VALIDATION_FAILED, and anything that
        // declares no status is a store failure, 503 SERVICE_UNAVAILABLE.
        return { handled: true, response: deps.errorFromThrown(err, 503) };
    }
    return {
        handled: true,
        response: deps.success({
            type,
            name: entry.name,
            ...(namespace !== undefined ? { packageId: entry.packageId } : {}),
            enabled,
        }),
    };
}
