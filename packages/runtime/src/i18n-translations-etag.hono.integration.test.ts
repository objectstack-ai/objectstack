// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * A browser holding the current translation bundle is answered `304` with no
 * body, over a real Hono socket (#25785).
 *
 * `GET /api/v1/i18n/translations/:locale` used to answer every console open
 * with the whole locale bundle and neither `ETag` nor `Cache-Control`. The
 * domain body now issues a validator (`domains/i18n-translations-etag.test.ts`
 * pins its derivation); this file pins what reaches the wire through the
 * standalone server's mount (`dispatcher-plugin.ts` → `sendResult` →
 * `plugin-hono-server`):
 *
 * 1. the `200` carries both headers and the same JSON envelope as before;
 * 2. a matching `If-None-Match` is answered `304` with an EMPTY body and the
 *    same two headers — the transport writes the body-less answer without a
 *    serialised `null` or `undefined`, and without throwing on a null-body
 *    status;
 * 3. a validator issued before the bundle changed is served the new bundle;
 * 4. an anonymous caller holding the validator is still refused `401`.
 *
 * `LiteKernel` with two stub slots: `auth` answers a session only when the
 * request carries `x-test-session`, and `i18n` serves a bundle the test can
 * replace between reads.
 */

const SESSION_HEADER = 'x-test-session';
const URL_PATH = '/api/v1/i18n/translations/fr';

const bundles: Record<string, Record<string, unknown>> = {
    fr: { objects: { lead: { label: 'Prospect', fields: { company: { label: 'Société' } } } } },
};

function fakeServicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-services-i18n-etag',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: any) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_i18n_etag' } } : undefined),
                },
            });
            ctx.registerService('i18n', {
                getLocales: () => Object.keys(bundles),
                getDefaultLocale: () => 'fr',
                getTranslations: (locale: string) => bundles[locale] ?? {},
            });
        },
    };
}

describe('the translation bundle is revalidated with ETag and answered 304 over a real socket (integration, #25785)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(fakeServicesPlugin());
        // port 0 → an OS-assigned free port, read back through getPort().
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(createDispatcherPlugin({ prefix: '/api/v1' }));
        await kernel.bootstrap();
        baseUrl = `http://127.0.0.1:${kernel.getService<IHttpServer>('http.server').getPort!()}`;
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    function get(headers: Record<string, string>) {
        return fetch(`${baseUrl}${URL_PATH}`, { headers });
    }

    it('a signed-in read is 200 with ETag, Cache-Control: private, no-cache and the envelope it always had', async () => {
        const res = await get({ [SESSION_HEADER]: '1' });
        expect(res.status).toBe(200);
        expect(res.headers.get('etag')).toMatch(/^W\/"[A-Za-z0-9_-]{43}"$/);
        expect(res.headers.get('cache-control')).toBe('private, no-cache');
        expect(await res.json()).toEqual({ success: true, data: { locale: 'fr', translations: bundles.fr } });
    });

    it('the same read with that validator in If-None-Match is 304, with an empty body and both headers', async () => {
        const first = await get({ [SESSION_HEADER]: '1' });
        await first.arrayBuffer();
        const etag = first.headers.get('etag')!;

        const res = await get({ [SESSION_HEADER]: '1', 'if-none-match': etag });
        expect(res.status).toBe(304);
        expect(res.headers.get('etag')).toBe(etag);
        expect(res.headers.get('cache-control')).toBe('private, no-cache');
        expect((await res.arrayBuffer()).byteLength).toBe(0);
    });

    it('a validator issued before the bundle changed is served the new bundle and a new validator', async () => {
        const first = await get({ [SESSION_HEADER]: '1' });
        await first.arrayBuffer();
        const issued = first.headers.get('etag')!;

        const previous = bundles.fr;
        bundles.fr = { objects: { lead: { label: 'Piste' } } };
        try {
            const res = await get({ [SESSION_HEADER]: '1', 'if-none-match': issued });
            expect(res.status).toBe(200);
            expect(res.headers.get('etag')).not.toBe(issued);
            expect((await res.json()).data.translations).toEqual({ objects: { lead: { label: 'Piste' } } });
        } finally {
            bundles.fr = previous;
        }
    });

    it('an anonymous caller holding the current validator is still refused 401, with no validator', async () => {
        const first = await get({ [SESSION_HEADER]: '1' });
        await first.arrayBuffer();
        const etag = first.headers.get('etag')!;

        const res = await get({ 'if-none-match': etag });
        expect(res.status).toBe(401);
        expect(res.headers.get('etag')).toBeNull();
        expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    });
});
