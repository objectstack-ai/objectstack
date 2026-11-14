// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The API surface tells search engines not to index it.
 *
 * Every answer under `/api/` — data, metadata, auth (`/api/v1/auth/*`), the
 * anonymous runtime-config door, error envelopes and the unmatched-request 404
 * alike — carries `X-Robots-Tag: noindex, nofollow`. These are machine
 * surfaces: a crawler that followed a link into one (a deployment's
 * `/api/v1/runtime/config` was found in a search index) has nothing a person
 * should land on from a search result, and every self-hosted deployment has
 * the same exposure, so the transport says it rather than each deployment.
 *
 * A response that already carries an `X-Robots-Tag` keeps its own: a route that
 * set one (the storage upload-link page does) decided for itself.
 *
 * The rule covers `/api` and `/api/…` only. Public, shareable pages live
 * outside it (the Console's public form page is `/_console/f/<slug>`), and a
 * route an app mounts elsewhere is the app's to describe.
 */
import type { Hono } from 'hono';

/** The directive every `/api/` answer carries unless the route set its own. */
export const API_ROBOTS_TAG = 'noindex, nofollow';

/** Whether `path` is under the API namespace (`/api` or `/api/…`). */
export function isApiPath(path: string): boolean {
    return path === '/api' || path.startsWith('/api/');
}

/**
 * Mount the `X-Robots-Tag` lane on `app`. It runs after the handler (and after
 * the error seam has rendered a throw), so it sees the answer the caller gets.
 */
export function installApiNoindex(app: Hono): void {
    app.use('*', async (c, next) => {
        await next();
        if (!isApiPath(c.req.path)) return;
        if (c.res.headers.has('x-robots-tag')) return;
        c.header('X-Robots-Tag', API_ROBOTS_TAG);
    });
}
