// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30964, cloud#3624 ruling A] The install-local door, reachable in process.
 *
 * ## Why
 *
 * On a hosted environment the Console installs a marketplace package through
 * `POST /api/v1/cloud-connection/install`, which asks the control plane
 * (`sys_package.install_package`). When the control plane grants an
 * UNMANAGED install, the copy is the environment's own work: only the
 * environment can write its metadata, and only it knows whether the copy
 * succeeded. The environment already has that copy, with every gate around it:
 * `POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'`
 * (the caller's install capability, the protocol handshake, namespace holds,
 * the copy record, sample data owned by the installer, #30808). So the
 * cloud-connection door hands the copy to that door rather than running the
 * import a second way.
 *
 * ## The shape
 *
 * The install-local plugin registers {@link INSTALL_LOCAL_DOOR_SERVICE}, whose
 * `install` takes a Fetch `Request` (the door's JSON body, and the caller's
 * own headers, so the door admits the same person) and answers the door's own
 * `Response`, exactly as `POST /api/v1/marketplace/install-local` would. It is
 * the same handler; {@link routeContextOf} is only the slice of a route
 * context that handler reads.
 *
 * Multi-tenant, the service is read from the environment's own kernel (the
 * one `kernel-manager` hands out); single-environment, from the host's.
 *
 * A hosted environment's kernel registers this door with no HTTP route and no
 * `installLocal` feature (cloud#3845 ruling A, built on the cloud side by
 * cloud#4175): only this cloud-connection door, after a control-plane grant,
 * reaches it there. Where the door is not registered at all, an unmanaged
 * grant copies nothing and answers 503 `SERVICE_UNAVAILABLE`, saying the
 * plugin is not mounted.
 */

/** The service name the install-local plugin registers its in-process door under. */
export const INSTALL_LOCAL_DOOR_SERVICE = 'marketplace-install-local';

/**
 * [#30794, #31482] The door's refusal of `targetNamespace` beside a managed
 * install (or no `installMode`), `INVALID_REQUEST` / 400: a managed install is
 * never renamed. One sentence, answered by the install-local door's step 0″
 * and by `POST /api/v1/cloud-connection/install` for its `target_namespace`
 * beside a managed install, so the two doors never drift apart.
 */
export const TARGET_NAMESPACE_ON_MANAGED_INSTALL_MESSAGE =
    '`targetNamespace` renames an unmanaged copy, and this install is managed: a managed install '
    + 'is never renamed — it keeps the package\'s namespace and its upgrade channel. Install with '
    + '`installMode: \'unmanaged\'` to take a copy under a namespace of its own, or omit `targetNamespace`.';

/**
 * [#31481] The control plane's unmanaged grant a copy is made for, as the
 * cloud-connection door read it. Handed to {@link InstallLocalDoor.install} on
 * the grant path only: a grant the door then refuses is audited (cloud#3624
 * ruling A「两边审计」), while the same refusal of a plain install-local call,
 * which no grant started, is not.
 */
export interface InstallLocalDoorGrant {
    /** The marketplace package the control plane granted (the action's `recordId`). */
    packageId: string;
    /** The granted version, as the grant echoed it (`data.version`). */
    version?: string;
    /**
     * [#31963] The manifest id the grant is for, set only when the request
     * carries the grant's own manifest inline: the grant's `data.manifest_id`,
     * or the requested package id when that is itself a manifest id. The
     * inline manifest must declare exactly this id and {@link version}, or the
     * door copies nothing.
     */
    manifestId?: string;
    /** The environment the grant is for. */
    environmentId?: string;
    /** The installer: the session the cloud-connection door admitted. */
    actor?: string;
}

/** The in-process install-local door ({@link INSTALL_LOCAL_DOOR_SERVICE}). */
export interface InstallLocalDoor {
    /**
     * Run `POST /api/v1/marketplace/install-local` for `request` and answer
     * what that route answers. Never throws for a refusal: a refusal is the
     * door's own non-2xx `Response`.
     *
     * [#31481] With `options.grant`, a refusal the door's unmanaged copy did
     * not already audit (every refusal before the import runs: the install
     * capability, the handshake, the manifest fetch, the walled catalog, and
     * the rest) hands the `audit` slot one `package_unmanaged_import` failure
     * event, carrying the answer's code and status. Without it, nothing
     * changes.
     *
     * [#31963] A grant-path request whose body carries a `manifest` is the
     * grant's own manifest: the door copies it only when it declares the
     * grant's `manifestId` and `version` (502 `PLUGIN_MANIFEST_INVALID`
     * otherwise, before any write), and every later check runs on it as on a
     * fetched one, with the fetched manifest's statuses.
     */
    install(request: Request, options?: { grant?: InstallLocalDoorGrant }): Promise<Response>;
}

/**
 * [#30964] The event handed to the `audit` slot's `recordPackageLifecycleEvent`
 * for each unmanaged copy attempted, or [#31481] refused after its grant —
 * declared here, structurally, so this package does not depend on
 * `@objectstack/plugin-audit`, which owns the row shape
 * (`PackageUnmanagedImportAuditEvent` there).
 */
export interface UnmanagedImportAuditEvent {
    action: 'package_unmanaged_import';
    packageId: string;
    version?: string;
    environmentId?: string;
    actor?: string;
    targetPackageId?: string;
    namespace?: string;
    sourceNamespace?: string;
    copiedCount?: number;
    outcome: 'success' | 'failure';
    errorCode?: string;
    status?: number;
}

/** The `audit` slot member the event is handed to. */
export interface UnmanagedImportAuditSurface {
    recordPackageLifecycleEvent?(event: UnmanagedImportAuditEvent): unknown;
}

/** The logger slice {@link recordUnmanagedImportEvent} writes to: `error`, or `warn` where a host sink has none. */
interface ErrorLogger {
    warn(message: string): unknown;
    error?(message: string): unknown;
}

/**
 * Hand `audit` one {@link UnmanagedImportAuditEvent}. No audit slot, or one
 * without the member, means no ledger, and the call is skipped; a slot that
 * throws is logged at `error` (`warn` on a sink without one) under `source`, never thrown: the install's
 * answer is the install's, whatever the ledger does.
 */
export async function recordUnmanagedImportEvent(
    audit: UnmanagedImportAuditSurface | undefined,
    logger: ErrorLogger | undefined,
    source: string,
    event: UnmanagedImportAuditEvent,
): Promise<void> {
    const record = audit?.recordPackageLifecycleEvent;
    if (typeof record !== 'function') return;
    try {
        await record.call(audit, event);
    } catch (err: any) {
        const message = `[${source}] the unmanaged install of ${event.packageId} (${event.outcome}) was answered, but the `
            + 'audit service refused its `package_unmanaged_import` row, so the compliance ledger does not record it: '
            + `${err?.message ?? err}`;
        if (logger?.error) logger.error(message);
        else logger?.warn(message);
    }
}

/**
 * [#31481] The failure event of a granted copy that was refused: the grant's
 * package, version, environment and installer, with the refusal's code and
 * HTTP status (never its message, which can quote package content).
 */
export function grantRefusalEvent(grant: InstallLocalDoorGrant, errorCode: string, status: number): UnmanagedImportAuditEvent {
    return {
        action: 'package_unmanaged_import',
        packageId: grant.packageId,
        ...(grant.version ? { version: grant.version } : {}),
        ...(grant.environmentId ? { environmentId: grant.environmentId } : {}),
        ...(grant.actor ? { actor: grant.actor } : {}),
        outcome: 'failure',
        errorCode,
        status,
    };
}

/** [#31481] The `error.code` of a refusal `Response`, read from a clone; `undefined` when it names none. */
export async function refusalCodeOf(answer: Response): Promise<string | undefined> {
    try {
        const body: any = await answer.clone().json();
        const named = body?.error?.code;
        return typeof named === 'string' && named !== '' ? named : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The slice of a route context the install-local handlers read, over a Fetch
 * `Request`: `req.json` / `req.text` (one read of the body, cached),
 * `req.header`, `req.raw`, `req.url`, empty route params, and `json`, which
 * builds the answer.
 */
export function routeContextOf(request: Request): any {
    let text: Promise<string> | undefined;
    const bodyText = (): Promise<string> => (text ??= request.text());
    return {
        req: {
            raw: request,
            url: request.url,
            method: request.method,
            header: (name: string): string | undefined => request.headers.get(name) ?? undefined,
            text: bodyText,
            json: async (): Promise<unknown> => JSON.parse(await bodyText()),
            param: (): undefined => undefined,
            params: {},
            query: (): Record<string, string> => Object.fromEntries(new URL(request.url).searchParams),
        },
        json: (payload: unknown, status = 200): Response => new Response(JSON.stringify(payload), {
            status,
            headers: { 'content-type': 'application/json' },
        }),
    };
}
