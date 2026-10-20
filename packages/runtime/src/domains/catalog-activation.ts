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
 * the ruling that retired the declared-webhook seeder).
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
 */

import { AUDIENCE_ANCHOR_POSITIONS, GUEST_POSITION } from '@objectstack/spec/identity';
import {
    METADATA_ACTIVATION_TABLE,
    ObjectStoreMetadataActivationStore,
    securityCatalogReaderOf,
    type SecurityCatalogEntry,
} from '@objectstack/core';
import {
    refuseUngrantedActivationWrite,
    refuseUngrantedActivationAuthoring,
    readActivationBody,
    POSITION_ACTIVATION_SUBJECT,
    PERMISSION_SET_ACTIVATION_SUBJECT,
    SHARING_RULE_ACTIVATION_SUBJECT,
    WEBHOOK_ACTIVATION_SUBJECT,
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
const CATALOG_ACTIVATION_SUBJECTS: Readonly<Record<'position' | 'permission' | 'sharing_rule' | 'webhook', ActivationSubject>> = {
    position: POSITION_ACTIVATION_SUBJECT,
    permission: PERMISSION_SET_ACTIVATION_SUBJECT,
    // [ADR-0131 D6 regime C] A declared sharing rule — read from the sharing-rule
    // service, which serves no declaration this ledger switches off.
    sharing_rule: SHARING_RULE_ACTIVATION_SUBJECT,
    // [ADR-0131 D2/D6 regime C] A declared webhook — read from the declared-webhook
    // reader, which the dispatcher reads its switch through.
    webhook: WEBHOOK_ACTIVATION_SUBJECT,
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
};

/**
 * [ADR-0131 D6 regime C] The declaration a `sharing_rule` row addresses, as the
 * sharing-rule service (`sharingRules`, plugin-sharing) reads it: declared in
 * the code, whether or not the ledger has it switched off. A rule an
 * organization authored is a `sys_sharing_rule` row with a switch of its own
 * (`active`) and is never addressed here.
 */
interface DeclaredSharingRuleReader {
    declaredRuleNamed(name: string): Promise<{ name: string; packageId?: string } | null>;
}

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
}

function declaredWebhookReaderOf(service: unknown): DeclaredWebhookReader | undefined {
    const candidate = service as Partial<DeclaredWebhookReader> | null | undefined;
    return typeof candidate?.declaredWebhookNamed === 'function' ? (candidate as DeclaredWebhookReader) : undefined;
}

/**
 * [#24910] Whether this deployment DELIVERS a declared webhook switched on, as
 * the same reader answers it: the reason the dispatcher is not running, or
 * `null` when it is. plugin-webhooks decides it once its kernel is ready (the
 * auto-enqueuer reads record events only from the realtime service), and binds
 * the reader already knowing it.
 *
 * Declared REQUIRED for switching ON: a reader that cannot say leaves the door
 * unable to confirm that `enabled: true` is true, and the door refuses rather
 * than reporting a switch that may switch nothing. Switching OFF never asks.
 */
interface DeclaredWebhookDispatch {
    dispatchUnavailable(): string | null;
}

function declaredWebhookDispatchOf(service: unknown): DeclaredWebhookDispatch | undefined {
    const candidate = service as Partial<DeclaredWebhookDispatch> | null | undefined;
    return typeof candidate?.dispatchUnavailable === 'function' ? (candidate as DeclaredWebhookDispatch) : undefined;
}

/**
 * The service-backed types — declarations a plugin owns, not catalog entries —
 * each with how its declaration is looked up and how it is named in a refusal.
 */
const DECLARATION_LOOKUPS: Readonly<Record<'sharing_rule' | 'webhook', {
    service: string;
    noun: string;
    serviceNoun: string;
    authoredRemedy: string;
    lookup(service: unknown, name: string): Promise<{ name: string; packageId?: string } | null> | undefined;
    /**
     * [#24910] Why switching `name` ON would switch nothing on this deployment,
     * or `undefined` when it takes effect. Asked only for `enabled: true`, after
     * the declaration is confirmed.
     */
    switchOnRefusal?(service: unknown, name: string): string | undefined;
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
        switchOnRefusal: (service, name) => {
            const cannotConfirm = (why: string) =>
                `Cannot confirm that declared webhook '${name}' would be delivered — ${why}. ` +
                'Refusing rather than answering enabled: true for a webhook that may never be sent.';
            const dispatch = declaredWebhookDispatchOf(service);
            if (!dispatch) {
                return cannotConfirm('the declared-webhook reader bound to this deployment does not say whether its dispatcher runs');
            }
            let reason: string | null;
            try {
                reason = dispatch.dispatchUnavailable();
            } catch (err: any) {
                return cannotConfirm(`the declared-webhook reader could not say whether its dispatcher runs (${err?.message ?? String(err)})`);
            }
            return reason === null
                ? undefined
                : `Declared webhook '${name}' cannot be switched on — this deployment delivers no declared webhook: ` +
                    `${reason} Refusing rather than answering enabled: true for a webhook that would never be sent; ` +
                    'switching it off is unaffected.';
        },
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
 *     not an audience anchor (`everyone` / `guest`), which this door refuses.
 *  3. **Body**: {@link readActivationBody}.
 *  4. **Declaration**, through the catalog reader the security plugin binds to
 *     the engine — the one `resolveUserAuthzGrants` reads, so this door and
 *     the resolver cannot disagree about which names exist. No reader bound,
 *     or a reader that cannot answer ⇒ 503 (an outage is not a verdict);
 *     unknown ⇒ 404. A declared webhook switched ON is also refused 503 where
 *     the deployment delivers no declared webhook at all — the reader says why
 *     — since that 200 would report a switch that switches nothing.
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
    if (parts.length !== 3 || !isCatalogActivationType(requestedType) || !parts[2]) {
        return {
            handled: true,
            response: deps.error(
                `Path must be /security/_activation/:type/:name, with :type one of ` +
                `${Object.keys(CATALOG_ACTIVATION_SUBJECTS).map((t) => `\`${t}\``).join(', ')}`,
                400,
            ),
        };
    }
    const type: CatalogActivationType = requestedType;
    const name = parts[2];

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
    if (isDeclarationType(type)) {
        const declaration = DECLARATION_LOOKUPS[type];
        const service = await deps.resolveService(context, declaration.service);
        let pending: Promise<{ name: string; packageId?: string } | null> | undefined;
        try {
            pending = declaration.lookup(service, name);
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
        // [#24910] A switch ON is a claim that the declaration now takes
        // effect. Where this deployment delivers no declared webhook at all (the
        // dispatcher is not running), a 200 `enabled: true` would be the claim
        // with nothing behind it, so the door refuses in the same 503 shape as
        // a reader it cannot consult. Switching OFF is always true and is
        // written as before.
        const switchOnRefusal = enabled ? declaration.switchOnRefusal?.(service, entry.name) : undefined;
        if (switchOnRefusal !== undefined) {
            return {
                handled: true,
                response: deps.error(switchOnRefusal, 503, { code: 'SERVICE_UNAVAILABLE' }),
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
        // type and name, never by package.
        await new ObjectStoreMetadataActivationStore(ql, type).setActive({
            name: entry.name,
            ...(entry.packageId !== undefined ? { packageId: entry.packageId } : {}),
            active: enabled,
        });
    } catch (err: unknown) {
        // A failed write must never read as a successful flip, and its code and
        // status must say the same thing (ADR-0112). The one shared rule
        // decides both (`resolveThrownHttpError`): a hook's refusal keeps its
        // own (the last-admin guard: 403 PERMISSION_DENIED), a record
        // validation refusal is 400 VALIDATION_FAILED, and anything that
        // declares no status is a store failure, 503 SERVICE_UNAVAILABLE.
        return { handled: true, response: deps.errorFromThrown(err, 503) };
    }
    return { handled: true, response: deps.success({ type, name: entry.name, enabled }) };
}
