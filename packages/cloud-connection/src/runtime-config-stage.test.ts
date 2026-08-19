// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `branding.stage` — the documented preview-badge switch (#9252).
 *
 * objectui's app-shell README tells operators the badge is turned off with
 * `OS_PRODUCT_STAGE` or `new RuntimeConfigPlugin({ stage })`. Neither half was
 * implemented, so `OS_PRODUCT_STAGE=ga objectstack dev` left the "Preview" chip
 * on screen and nothing said why.
 *
 * Both directions are pinned here, and the absent one is asserted on KEY
 * PRESENCE rather than `toBeUndefined()` — the two are not the same claim, and
 * only one of them is this card's contract. `{ stage: undefined }` satisfies
 * `toBeUndefined()` while being a present property: it survives structuredClone,
 * shows up in `Object.keys`, and reaches any consumer that does not round-trip
 * the body through JSON. The contract is that the key is NOT THERE.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuntimeConfigPlugin, type RuntimeConfigPluginConfig } from './runtime-config-plugin.js';

interface Served {
    body: any;
    warnings: string[];
}

/**
 * Mount the plugin on a Hono-shaped raw app and serve one request, keeping the
 * warnings it emitted at mount time. Same harness shape as
 * `runtime-config-plugin.test.ts`; it records `warn` because the refusal path
 * is only observable there.
 */
async function serve(pluginConfig: RuntimeConfigPluginConfig = {}): Promise<Served> {
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
    const plugin = new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true, ...pluginConfig });
    await plugin.start(ctx);
    for (const cb of ctx.hooks) await cb();
    if (!handler) throw new Error('handler not mounted');
    const body = await handler({
        req: { header: () => undefined },
        json: (b: any) => b,
    });
    return { body, warnings };
}

/** The assertion this card turns on: is the key THERE, whatever its value? */
function hasStageKey(body: any): boolean {
    return Object.prototype.hasOwnProperty.call(body.branding, 'stage');
}

describe('RuntimeConfigPlugin — branding.stage (#9252)', () => {
    const saved = process.env.OS_PRODUCT_STAGE;

    beforeEach(() => { delete process.env.OS_PRODUCT_STAGE; });
    afterEach(() => {
        if (saved === undefined) delete process.env.OS_PRODUCT_STAGE;
        else process.env.OS_PRODUCT_STAGE = saved;
    });

    describe('direction 1 — the env var reaches the response', () => {
        it('OS_PRODUCT_STAGE=ga is served as branding.stage (the reported repro)', async () => {
            process.env.OS_PRODUCT_STAGE = 'ga';
            const { body, warnings } = await serve();
            expect(hasStageKey(body)).toBe(true);
            expect(body.branding.stage).toBe('ga');
            expect(warnings).toEqual([]);
        });

        it.each(['preview', 'beta', 'ga'] as const)('carries the whole closed set: %s', async (stage) => {
            process.env.OS_PRODUCT_STAGE = stage;
            const { body } = await serve();
            expect(body.branding.stage).toBe(stage);
        });

        it('trims surrounding whitespace, like every sibling branding env read', async () => {
            process.env.OS_PRODUCT_STAGE = '  ga  ';
            const { body } = await serve();
            expect(body.branding.stage).toBe('ga');
        });

        it('the host option wins over the env var — the host decides, env is its fallback', async () => {
            process.env.OS_PRODUCT_STAGE = 'preview';
            const { body } = await serve({ stage: 'ga' });
            expect(body.branding.stage).toBe('ga');
        });

        it('the host option works with no env var set at all', async () => {
            const { body } = await serve({ stage: 'beta' });
            expect(body.branding.stage).toBe('beta');
        });
    });

    describe('direction 2 — unset stays ABSENT, not empty and not guessed', () => {
        it('omits the key entirely when nothing set it', async () => {
            const { body, warnings } = await serve();
            // The load-bearing assertion: absent, not present-and-undefined.
            expect(hasStageKey(body)).toBe(false);
            expect(Object.keys(body.branding)).not.toContain('stage');
            // ...and no invented default in its place. The Console owns the
            // documented 'preview' default; asserting a value here would be
            // this card's own defect pointing the other way.
            expect(body.branding.stage).toBeUndefined();
            expect(warnings).toEqual([]);
        });

        it('survives a JSON round trip as an absent key', async () => {
            const { body } = await serve();
            const parsed = JSON.parse(JSON.stringify(body));
            expect(Object.prototype.hasOwnProperty.call(parsed.branding, 'stage')).toBe(false);
        });

        it('an EMPTY env var reads as unset — absent, and silent (not a typo)', async () => {
            process.env.OS_PRODUCT_STAGE = '   ';
            const { body, warnings } = await serve();
            expect(hasStageKey(body)).toBe(false);
            expect(warnings).toEqual([]);
        });

        it('leaves the sibling branding keys exactly as they were', async () => {
            const { body } = await serve();
            expect(body.branding.productName).toBe('ObjectOS');
            expect(body.branding.productShortName).toBe('ObjectOS');
            expect(body.branding.pwaThemeColor).toBe('#4f46e5');
        });
    });

    describe('the value space is closed — an unrecognised stage is refused, loudly', () => {
        it('refuses a near-miss spelling rather than coercing it', async () => {
            process.env.OS_PRODUCT_STAGE = 'GA';
            const { body } = await serve();
            expect(hasStageKey(body)).toBe(false);
        });

        it.each(['general-availability', 'production', 'stable', 'ga '.repeat(3)])(
            'refuses %j',
            async (value) => {
                process.env.OS_PRODUCT_STAGE = value;
                const { body } = await serve();
                expect(hasStageKey(body)).toBe(false);
            },
        );

        it('names the refused value AND the accepted set, so the operator can fix it', async () => {
            process.env.OS_PRODUCT_STAGE = 'GA';
            const { warnings } = await serve();
            const warning = warnings.find((w) => w.includes('product stage'));
            expect(warning).toBeDefined();
            // What was refused, quoted, and where it came from.
            expect(warning).toContain('"GA"');
            expect(warning).toContain('OS_PRODUCT_STAGE');
            // ...and every accepted spelling, so the fix needs no source dive.
            for (const accepted of ['preview', 'beta', 'ga']) expect(warning).toContain(accepted);
        });

        it('refuses an off-contract value from a JS host too, not only from the env', async () => {
            const { body, warnings } = await serve({ stage: 'launched' as any });
            expect(hasStageKey(body)).toBe(false);
            expect(warnings.some((w) => w.includes('"launched"'))).toBe(true);
        });

        it('a valid value emits no warning', async () => {
            process.env.OS_PRODUCT_STAGE = 'ga';
            const { warnings } = await serve();
            expect(warnings.some((w) => w.includes('product stage'))).toBe(false);
        });
    });
});
