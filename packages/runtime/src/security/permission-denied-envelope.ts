// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7450] What a `PERMISSION_DENIED` body may carry on the dispatcher transport.
 *
 * ## What was wrong
 *
 * `plugin-security`'s object gate attaches a structured payload to every
 * `PermissionDeniedError`:
 *
 * ```ts
 * throw new PermissionDeniedError(message,
 *   { operation: opCtx.operation, object: opCtx.object, positions, permissionSets });
 * ```
 *
 * `@objectstack/rest`'s `mapDataError` never reads `error.details` — its 403
 * body is `{ error, code, object? }`, and the `object` on it is the one the
 * ROUTE named (`req.params?.object`). The dispatcher's `dispatch()` catch did
 * the opposite: `this.error(e.message, 403, { code: 'PERMISSION_DENIED',
 * ...(e.details ?? {}) })`, and `buildApiError` puts everything that is not the
 * `code` on the wire as `error.details`. `/data` is served by that dispatcher
 * and `domains/data.ts` has no local catch, so an ordinary CRUD denial told the
 * browser the caller's position names, their permission-set names, and — the
 * sharp one — the API name of an object the caller never addressed.
 *
 * ## The ruling (2026-08-11 maintainer ruling on #7450, option A)
 *
 * `positions` / `permissionSets` are server-side diagnostics: internal
 * authorization topology does not go on the wire. REST's shape (message + code
 * + object) is the contract for BOTH transports.
 *
 * ## Why the object comes from the ROUTE and not from `error.details`
 *
 * This is the part an "allowlist `operation` + `object`" reading gets wrong.
 * `details.object` is not always the object the caller addressed:
 * `ObjectQL.cascadeDeleteRelations` re-enters `delete()` for every child of the
 * row being deleted, so the child's own trip through the security middleware
 * throws with `opCtx.object === <child>`. A `DELETE /data/parent/1` denied on a
 * cascade child would answer `object: 'child'` — the API name of an object the
 * caller never named, i.e. third-party information, even though the field looks
 * like an echo of their own input.
 *
 * So the allowlist is not a filter over `error.details` at all: the response's
 * `object` is DERIVED FROM THE REQUEST PATH, exactly as REST derives it from
 * `req.params.object`. `error.details` contributes nothing to the body. A denial
 * raised on a path with no object segment carries no `object`, which is REST's
 * `...(object ? { object } : {})` behaviour.
 *
 * `operation` is dropped for the same reason the ruling names REST's shape
 * rather than "REST's shape plus the harmless bits": shipping it on one
 * transport and not the other rebuilds the divergence this card closed.
 *
 * Nothing is thrown away — {@link describeDeniedDiagnostics} renders the whole
 * payload for a server-side log line. It is diagnostics, not garbage.
 */

/**
 * The object segment of a data-plane route, or `undefined` when the path names
 * none.
 *
 * Mirrors `@objectstack/rest`'s `req.params?.object` on the `/data/:object`
 * family — the only dispatcher routes whose path carries an object name.
 * Expects the dispatcher's already-cleaned path (trailing slash removed,
 * `/projects/:environmentId` prefix stripped).
 */
export function routeObjectFromPath(cleanPath: string): string | undefined {
    const m = /^\/data\/([^/?#]+)/.exec(cleanPath);
    if (!m) return undefined;
    const object = decodeURIComponent(m[1]!);
    return object.length > 0 ? object : undefined;
}

/**
 * The `details` argument for `HttpDispatcher.error()` on a permission denial.
 *
 * `code` is promoted into `error.code` by `buildApiError`; anything else here
 * lands on the wire as `error.details`. So the returned object IS the wire
 * contract — keep it to what the ruling allows.
 */
export function permissionDeniedErrorDetails(cleanPath: string): { code: 'PERMISSION_DENIED'; object?: string } {
    const object = routeObjectFromPath(cleanPath);
    return { code: 'PERMISSION_DENIED', ...(object ? { object } : {}) };
}

/**
 * Render a denial's withheld structured payload for a SERVER-SIDE log line.
 *
 * Everything the wire no longer carries has to stay reachable to whoever is
 * debugging a false denial: the positions and permission sets that were
 * consulted, the gate's own `operation`/`object` (which, on a cascade, is the
 * child the caller never addressed and therefore the single most useful field
 * in the payload). Returns `undefined` when the error carried nothing, so the
 * caller can skip the log entirely rather than emit an empty line.
 */
export function describeDeniedDiagnostics(details: unknown): string | undefined {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
    const entries = Object.entries(details as Record<string, unknown>);
    if (entries.length === 0) return undefined;
    return entries
        .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(', ')}]` : String(v)}`)
        .join(' ');
}
