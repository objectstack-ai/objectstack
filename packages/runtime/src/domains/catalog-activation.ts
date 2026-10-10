// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §3 regime C, as ADR-0131 D6 amends it] THE ACTIVATION DOOR for the
 * security catalog: `POST /security/_activation/:type/:name`, body
 * `{ enabled?: boolean }`, `:type` one of `position` / `permission`.
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
 * action stores use. ⛔ No definition is touched, ⛔ no catalog row's `active`
 * is written (ADR-0131 D3: that column is not the switch any more), ⛔ no clone
 * is authored. The write goes through the engine, so every hook on the ledger
 * runs: the last-admin guard refuses switching `admin_full_access` off
 * (ADR-0135 D5.2), and the grants cache drops what it holds for the ledger.
 *
 * Who may call it is exactly who may call the flow and action doors: the
 * caller's `manage_metadata`, then the ADR-0126 §5 posture rule (inert under
 * `single`, the platform operator under a wall). ⛔ No new authority.
 */

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
const CATALOG_ACTIVATION_SUBJECTS: Readonly<Record<'position' | 'permission', ActivationSubject>> = {
    position: POSITION_ACTIVATION_SUBJECT,
    permission: PERMISSION_SET_ACTIVATION_SUBJECT,
};

type CatalogActivationType = keyof typeof CATALOG_ACTIVATION_SUBJECTS;

function isCatalogActivationType(type: string): type is CatalogActivationType {
    return Object.prototype.hasOwnProperty.call(CATALOG_ACTIVATION_SUBJECTS, type);
}

/** The catalog noun a sentence names, per type. */
const NOUN: Readonly<Record<CatalogActivationType, string>> = {
    position: 'Position',
    permission: 'Permission set',
};

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
 *  2. **Shape**: `['_activation', type, name]`, `type` a catalog type.
 *  3. **Body**: {@link readActivationBody}.
 *  4. **Declaration**, through the catalog reader the security plugin binds to
 *     the engine — the one `resolveUserAuthzGrants` reads, so this door and
 *     the resolver cannot disagree about which names exist. No reader bound,
 *     or a reader that cannot answer ⇒ 503 (an outage is not a verdict);
 *     unknown ⇒ 404.
 *  5. **The durable write**, through the engine.
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
    const reader = securityCatalogReaderOf(ql);
    if (!reader) {
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
    let entry: SecurityCatalogEntry | undefined;
    try {
        entry = await reader.resolve(type, name);
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
        await new ObjectStoreMetadataActivationStore(ql, type).setActive({
            name: entry.name,
            packageId: entry.packageId ?? '',
            active: enabled,
        });
    } catch (err: any) {
        // A hook's refusal carries its own status and code (the last-admin
        // guard: 403 PERMISSION_DENIED); anything else is a store failure, and
        // a failed write must never read as a successful flip.
        const status = typeof err?.status === 'number' ? err.status : 503;
        const code = typeof err?.code === 'string' ? err.code : 'SERVICE_UNAVAILABLE';
        return {
            handled: true,
            response: deps.error(err?.message ?? String(err), status, { code }),
        };
    }
    return { handled: true, response: deps.success({ type, name: entry.name, enabled }) };
}
