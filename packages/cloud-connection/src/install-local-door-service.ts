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
 * Cross-repo, NOT MEASURED: that a hosted environment's kernel mounts the
 * install-local plugin at all. Nothing in this repo shows it, and this repo's
 * own hosted Console reads a cloud base as having no install-local door (the
 * 30963 changeset, `MarketplacePage`). Where the door is not mounted, an
 * unmanaged grant copies nothing and answers 503 `SERVICE_UNAVAILABLE`, saying
 * the plugin is not mounted. Follow-up: #31482.
 */

/** The service name the install-local plugin registers its in-process door under. */
export const INSTALL_LOCAL_DOOR_SERVICE = 'marketplace-install-local';

/** The in-process install-local door ({@link INSTALL_LOCAL_DOOR_SERVICE}). */
export interface InstallLocalDoor {
    /**
     * Run `POST /api/v1/marketplace/install-local` for `request` and answer
     * what that route answers. Never throws for a refusal: a refusal is the
     * door's own non-2xx `Response`.
     */
    install(request: Request): Promise<Response>;
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
