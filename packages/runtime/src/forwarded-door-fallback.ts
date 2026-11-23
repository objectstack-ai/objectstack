// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36469] Forwarded doors on a host with no `createHonoApp` catch-all.
 *
 * Some dispatcher domains do nothing but forward the transport's request to a
 * member on the REQUEST kernel's slot and hand back the member's `Response`
 * (ruling A on #22438). The comment doors are one: `plugin-audit` mounts them
 * on its own kernel's `http.server`, and a per-environment kernel owns none,
 * so on a multi-tenant host the `/comments` domain is the only way in.
 *
 * `createHonoApp`'s catch-all reaches that domain through `dispatch()`. A host
 * composed the way `objectstack serve` / `objectstack dev` composes one —
 * `HonoServerPlugin` + `DispatcherPlugin`, no catch-all — does not: before this
 * file, `DispatcherPlugin`'s fallback seam handed on only domain-decided and
 * app-endpoint paths, so these doors answered the transport's own
 * `404 ENDPOINT_NOT_FOUND` there (the card's hosted reading).
 *
 * This module is the fallback's half of the bridge:
 *  - {@link matchForwardedDoorPath} says whether an unrouted request is exactly
 *    one of the forwarded door shapes (bare or environment-scoped);
 *  - {@link toWebRequest} rebuilds the transport's request as a Web `Request`,
 *    because the seam hands the fallback an `IHttpRequest`, not the raw one;
 *  - {@link sendWebResponse} writes the member's `Response` back as it is.
 *
 * Only EXACT door shapes are handed on, so a miss still writes nothing and the
 * transport's unmatched answer stands (#5090), and the fallback runs only after
 * every mounted route missed, so a kernel that mounted the doors itself (the
 * self-hosted shape) is never reached here (ADR-0076 D11).
 */

import { matchCommentDoorPath } from './domains/comments.js';

/** The door matchers the fallback hands on. Each takes the dispatcher's clean path. */
const FORWARDED_DOOR_MATCHERS: ReadonlyArray<(method: string, cleanPath: string) => boolean> = [
    matchCommentDoorPath,
];

/** `/environments/:id` at the head of a sub-path (the environment-scoped spelling). */
const SCOPED_HEAD = /^\/environments\/[^/]+(?=\/)/;

/**
 * Is `method path` exactly one forwarded door? `path` is the wire path,
 * `prefix` included; anything outside the prefix is not a door.
 */
export function matchForwardedDoorPath(method: string, path: string, prefix: string): boolean {
    if (!path.startsWith(prefix + '/')) return false;
    const clean = path.substring(prefix.length).replace(SCOPED_HEAD, '').replace(/\/$/, '');
    return FORWARDED_DOOR_MATCHERS.some((matches) => matches(method, clean));
}

/** The slice of `IHttpRequest` the rebuild reads. */
export interface FallbackRequestLike {
    method: string;
    path: string;
    query?: Record<string, unknown>;
    headers?: Record<string, string | string[] | undefined>;
    rawBody?: () => Promise<Uint8Array>;
}

/**
 * The transport's request as a Web `Request` at its own wire path, headers
 * and query carried, and its ORIGINAL body bytes for a verb that has one.
 */
export async function toWebRequest(req: FallbackRequestLike): Promise<Request> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers ?? {})) {
        if (value === undefined) continue;
        if (Array.isArray(value)) for (const v of value) headers.append(name, v);
        else headers.set(name, value);
    }
    const url = new URL(req.path, `http://${headers.get('host') ?? 'localhost'}`);
    for (const [name, value] of Object.entries(req.query ?? {})) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) for (const v of value) url.searchParams.append(name, String(v));
        else url.searchParams.set(name, String(value));
    }
    const method = req.method.toUpperCase();
    const init: RequestInit = { method, headers };
    if (method !== 'GET' && method !== 'HEAD' && typeof req.rawBody === 'function') {
        const bytes = await req.rawBody();
        if (bytes.byteLength > 0) init.body = bytes;
    }
    return new Request(url, init);
}

/** The slice of `IHttpResponse` the write uses. */
export interface FallbackResponseLike {
    status(code: number): unknown;
    header(name: string, value: string | string[]): unknown;
    send(data: string | Uint8Array | ArrayBuffer): void | Promise<void>;
}

/** Write a member's `Response` through the transport: status, headers and body bytes, unchanged. */
export async function sendWebResponse(response: Response, res: FallbackResponseLike): Promise<void> {
    res.status(response.status);
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    response.headers.forEach((value, name) => {
        if (name.toLowerCase() === 'set-cookie') return;
        res.header(name, value);
    });
    if (cookies.length > 0) res.header('set-cookie', cookies);
    await res.send(new Uint8Array(await response.arrayBuffer()));
}
