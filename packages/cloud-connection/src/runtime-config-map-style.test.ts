// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `mapStyleUrl` — the deployment's default map style, served on
 * `/api/v1/runtime/config` from the operator's `OS_CONSOLE_MAP_STYLE_URL`
 * (#26001, ruling A: operator env only).
 *
 * Three directions, each pinned here:
 *
 *   set     → served VERBATIM, at the top level beside `cloudUrl`;
 *   unset   → the key is NOT THERE, and every other key is unchanged;
 *   refused → the plugin's `start()` rejects, naming the variable, so the
 *             kernel refuses the boot.
 *
 * The absent direction is asserted on KEY PRESENCE, as `upgradeUrl` and
 * `branding.stage` are: `{ mapStyleUrl: undefined }` is a present property.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuntimeConfigPlugin } from './runtime-config-plugin.js';

const ENV = 'OS_CONSOLE_MAP_STYLE_URL';
const STYLE = 'https://tiles.example.com/styles/basic/style.json';

interface Served {
    body: any;
    warnings: string[];
}

/** Mount the plugin on a Hono-shaped raw app and serve one request (the `runtime-config-stage.test.ts` harness). */
async function serve(): Promise<Served> {
    let handler: ((c: any) => Promise<any>) | undefined;
    const rawApp = {
        routes: [] as Array<{ method: string; path: string }>,
        get(path: string, h: (c: any) => Promise<any>) {
            this.routes.push({ method: 'GET', path });
            if (path === '/api/v1/runtime/config') handler = h;
        },
    };
    const warnings: string[] = [];
    const ctx: any = {
        logger: { info() {}, warn: (m: string) => { warnings.push(String(m)); } },
        getService: (n: string) => {
            if (n === 'http-server') return { getRawApp: () => rawApp };
            throw new Error(`no ${n}`);
        },
        hooks: [] as Array<() => Promise<void>>,
        hook(_e: string, cb: () => Promise<void>) { this.hooks.push(cb); },
    };
    const plugin = new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true });
    await plugin.start(ctx);
    for (const cb of ctx.hooks) await cb();
    if (!handler) throw new Error('handler not mounted');
    const body = await handler({
        req: { header: () => undefined },
        json: (b: any) => b,
    });
    return { body, warnings };
}

function hasMapStyleUrlKey(body: any): boolean {
    return Object.prototype.hasOwnProperty.call(body, 'mapStyleUrl');
}

describe('RuntimeConfigPlugin — mapStyleUrl from OS_CONSOLE_MAP_STYLE_URL (#26001)', () => {
    const saved = process.env[ENV];

    beforeEach(() => { delete process.env[ENV]; });
    afterEach(() => {
        if (saved === undefined) delete process.env[ENV];
        else process.env[ENV] = saved;
    });

    describe('set — served verbatim at the top level', () => {
        it('serves the operator\'s style URL as mapStyleUrl', async () => {
            process.env[ENV] = STYLE;
            const { body, warnings } = await serve();
            expect(hasMapStyleUrlKey(body)).toBe(true);
            expect(body.mapStyleUrl).toBe(STYLE);
            expect(warnings).toEqual([]);
        });

        it('keeps the value as written, never re-serialised by the URL parser', async () => {
            // The parser would lower-case the host and drop the default port.
            const written = 'https://Tiles.Example.com:443/styles/Basic/style.json?key=public-demo';
            process.env[ENV] = `  ${written}  `;
            const { body } = await serve();
            expect(body.mapStyleUrl).toBe(written);
        });

        it('lives at the top level, not inside branding or features', async () => {
            process.env[ENV] = STYLE;
            const { body } = await serve();
            expect(Object.keys(body.branding)).not.toContain('mapStyleUrl');
            expect(Object.keys(body.features)).not.toContain('mapStyleUrl');
        });
    });

    describe('unset — the key is absent and the rest of the payload is unchanged', () => {
        it('omits the key when the env var is not set', async () => {
            const { body, warnings } = await serve();
            expect(hasMapStyleUrlKey(body)).toBe(false);
            expect(Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(body)), 'mapStyleUrl')).toBe(false);
            expect(warnings).toEqual([]);
        });

        it('reads an empty or whitespace-only value as unset', async () => {
            process.env[ENV] = '   ';
            const { body, warnings } = await serve();
            expect(hasMapStyleUrlKey(body)).toBe(false);
            expect(warnings).toEqual([]);
        });

        it('serves every other key byte-identical whether or not the env var is set', async () => {
            const unset = JSON.stringify((await serve()).body);
            process.env[ENV] = STYLE;
            const { mapStyleUrl, ...rest } = (await serve()).body;
            expect(mapStyleUrl).toBe(STYLE);
            expect(JSON.stringify(rest)).toBe(unset);
        });
    });

    describe('refused — the boot fails, naming the variable', () => {
        it.each([
            ['an http: URL', 'http://tiles.example.com/style.json'],
            ['a relative path', '/styles/basic/style.json'],
            ['a bare host', 'tiles.example.com'],
            ['a non-web scheme', 'javascript:alert(1)'],
            ['a URL with credentials', 'https://user:secret@tiles.example.com/style.json'],
            ['an IP literal a policy cannot name', 'https://[::1]/style.json'],
        ])('rejects %s', async (_label, value) => {
            process.env[ENV] = value;
            await expect(serve()).rejects.toThrow(/^OS_CONSOLE_MAP_STYLE_URL is .*absolute https: URL/s);
        });

        it('names a refused URL without its credentials, since the message lands in the boot log', async () => {
            process.env[ENV] = 'https://user:secret@tiles.example.com/style.json';
            const refusal = await serve().then(() => undefined, (e: Error) => e.message);
            expect(refusal).toContain('https://tiles.example.com/style.json');
            expect(refusal).not.toContain('secret');
        });
    });
});
