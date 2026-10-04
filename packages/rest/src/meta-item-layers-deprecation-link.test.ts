// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20508] The deprecated `?layers=` spelling's successor `Link` names the path
 * the request arrived on, on BOTH `RestServer` mounts.
 *
 * `RestServer` built the `Link` from `metaPath`, which on the
 * environment-scoped mount is the route TEMPLATE:
 * `GET /api/v1/environments/env_1/meta/view/lead_all?layers=true` answered
 * `</api/v1/environments/:environmentId/meta/view/lead_all/layers>`, a path with
 * a literal `:environmentId` in it, so a client that followed the header asked
 * for a path it could not mean. The runtime dispatcher builds its `Link` from
 * the request's own URL; `RestServer` now passes the request's own path
 * (`IHttpRequest.path`), read the same way.
 *
 * Driven through the real `HonoHttpServer`, the adapter `os serve` mounts,
 * because the path is the ADAPTER's statement: a hand-built request carries
 * whatever the test writes into it, and the encoded-name case below turns on
 * what this adapter hands over (a `decodeURI`'d path).
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { RestServer } from './rest-server';

/** Both mounts: `optional` registers the unscoped routes beside the scoped ones. */
const SCOPED_API = { api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'optional' } };

function protocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({
            type, name, item: { name }, lock: 'none', editable: true, deletable: true, resettable: false,
        })),
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => ({
            type,
            name,
            code: { name },
            overlay: null,
            overlayScope: 'org',
            effective: { name },
            _diagnostics: { valid: true },
            lock: 'none',
            editable: true,
            deletable: true,
            resettable: false,
        })),
        findData: vi.fn().mockResolvedValue([]),
    };
}

async function layersFlagRead(path: string) {
    const server = new HonoHttpServer(0);
    const p = protocol();
    const rest = new RestServer(server as any, p as any, SCOPED_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    const res: Response = await server.getRawApp().fetch(new Request(`http://local${path}?layers=true`));
    return {
        status: res.status,
        deprecation: res.headers.get('deprecation'),
        link: res.headers.get('link'),
        layeredReads: p.getMetaItemLayered.mock.calls.length,
    };
}

describe('[#20508] the `?layers=true` successor `Link` names the request path', () => {
    it('on the environment-scoped mount, names the environment the request named', async () => {
        const answer = await layersFlagRead('/api/v1/environments/env_1/meta/view/lead_all');

        // Anti-vacuity: the flag was served the layered view, so the headers
        // below are that branch's, not an error answer's.
        expect(answer.status).toBe(200);
        expect(answer.layeredReads).toBe(1);
        expect(answer.deprecation).toBe('true');
        expect(answer.link).toBe(
            '</api/v1/environments/env_1/meta/view/lead_all/layers>; rel="successor-version"',
        );
    });

    it('on the unscoped mount (the control), is unchanged', async () => {
        const answer = await layersFlagRead('/api/v1/meta/view/lead_all');

        expect(answer.status).toBe(200);
        expect(answer.layeredReads).toBe(1);
        expect(answer.deprecation).toBe('true');
        expect(answer.link).toBe('</api/v1/meta/view/lead_all/layers>; rel="successor-version"');
    });

    it('keeps a percent-encoded name encoded, though the adapter hands the path over decoded', async () => {
        // Hono's `c.req.path` is `decodeURI`'d: `lead%20all` reaches the handler
        // as `lead all`. Written into the header as it arrived, that is a space
        // inside a URI reference; parsed as a URL path, as the dispatcher parses
        // its request URL, it is `lead%20all` again.
        const answer = await layersFlagRead('/api/v1/environments/env_1/meta/view/lead%20all');

        expect(answer.status).toBe(200);
        expect(answer.link).toBe(
            '</api/v1/environments/env_1/meta/view/lead%20all/layers>; rel="successor-version"',
        );
    });
});
