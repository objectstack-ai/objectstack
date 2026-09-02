// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `upgradeUrl` — the control plane's upgrade / billing entry, published on
 * `/api/v1/runtime/config` instead of derived by the Console (#14514, the
 * framework half of cloud#1850).
 *
 * The contract has exactly two directions, and both are pinned here:
 *
 *   declared   → served VERBATIM, at the top level beside `cloudUrl`;
 *   undeclared → the key is NOT THERE.
 *
 * The absent direction is asserted on KEY PRESENCE, not `toBeUndefined()` —
 * `{ upgradeUrl: undefined }` satisfies the latter while being a present
 * property that survives structuredClone and shows up in `Object.keys`. The
 * Console reads "no key" as "no link", so the key must be absent, not empty.
 *
 * A third group pins the one thing the producer enforces: the value must be an
 * ABSOLUTE http(s) URL. A relative path is the defect this key exists to remove
 * (opened from the tenant origin it resolves against the wrong host), so it is
 * refused and named at mount, never forwarded.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeConfigPlugin, type RuntimeConfigPluginConfig } from './runtime-config-plugin.js';

interface Served {
    body: any;
    warnings: string[];
}

/**
 * Mount the plugin on a Hono-shaped raw app and serve one request, keeping the
 * warnings it emitted at mount time. Same harness shape as
 * `runtime-config-stage.test.ts`; it records `warn` because the refusal path
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
function hasUpgradeUrlKey(body: any): boolean {
    return Object.prototype.hasOwnProperty.call(body, 'upgradeUrl');
}

/** The shape the cloud distribution will declare — console mount, app slug and page route included. */
const PRICING = 'https://cloud.example.com/_console/apps/cloud_control/page/pricing';

describe('RuntimeConfigPlugin — upgradeUrl (#14514)', () => {
    describe('direction 1 — declared, it is served verbatim', () => {
        it('passes the declared absolute URL through unchanged, at the top level beside cloudUrl', async () => {
            const { body, warnings } = await serve({ upgradeUrl: PRICING });
            expect(hasUpgradeUrlKey(body)).toBe(true);
            expect(body.upgradeUrl).toBe(PRICING);
            expect(Object.prototype.hasOwnProperty.call(body, 'cloudUrl')).toBe(true);
            expect(warnings).toEqual([]);
        });

        it('is verbatim — no trailing-slash trimming, no case folding, no re-serialisation', async () => {
            const spelled = 'https://Cloud.Example.com:8443/_console/apps/cloud_control/page/pricing/?from=quota#plans';
            const { body } = await serve({ upgradeUrl: spelled });
            expect(body.upgradeUrl).toBe(spelled);
        });

        it('accepts http:// too — a local rig control plane is not https', async () => {
            const local = 'http://localhost:3000/_console/apps/cloud_control/page/pricing';
            const { body, warnings } = await serve({ upgradeUrl: local });
            expect(body.upgradeUrl).toBe(local);
            expect(warnings).toEqual([]);
        });

        it('survives a JSON round trip with the same value', async () => {
            const { body } = await serve({ upgradeUrl: PRICING });
            expect(JSON.parse(JSON.stringify(body)).upgradeUrl).toBe(PRICING);
        });

        it('lives beside cloudUrl — not inside features, not inside branding', async () => {
            const { body } = await serve({ upgradeUrl: PRICING });
            expect(Object.keys(body.features)).not.toContain('upgradeUrl');
            expect(Object.keys(body.branding)).not.toContain('upgradeUrl');
        });

        it('is declared independently of cloudUrl — the two keys do not derive from each other', async () => {
            const { body } = await serve({ controlPlaneUrl: 'https://cloud.example.com', upgradeUrl: PRICING });
            expect(body.cloudUrl).toBe('https://cloud.example.com');
            expect(body.upgradeUrl).toBe(PRICING);
        });
    });

    describe('direction 2 — undeclared, the key is NOT THERE', () => {
        it('omits the key entirely when nothing declared it', async () => {
            const { body, warnings } = await serve();
            // The load-bearing assertion: absent, not present-and-undefined.
            expect(hasUpgradeUrlKey(body)).toBe(false);
            expect(Object.keys(body)).not.toContain('upgradeUrl');
            // ...and no invented default in its place. The Console owns the
            // "no key means no link" reading; a guessed URL here would be the
            // original defect pointing the other way.
            expect(body.upgradeUrl).toBeUndefined();
            expect(warnings).toEqual([]);
        });

        it('survives a JSON round trip as an absent key', async () => {
            const { body } = await serve();
            const parsed = JSON.parse(JSON.stringify(body));
            expect(Object.prototype.hasOwnProperty.call(parsed, 'upgradeUrl')).toBe(false);
        });

        it.each(['', '   '])('an empty declaration %j reads as unset — absent, and silent (not a typo)', async (value) => {
            const { body, warnings } = await serve({ upgradeUrl: value });
            expect(hasUpgradeUrlKey(body)).toBe(false);
            expect(warnings).toEqual([]);
        });

        it('a resolved cloudUrl does not conjure an upgradeUrl — nothing is derived from the origin', async () => {
            const { body } = await serve({ controlPlaneUrl: 'https://cloud.example.com' });
            expect(body.cloudUrl).toBe('https://cloud.example.com');
            expect(hasUpgradeUrlKey(body)).toBe(false);
        });

        it('leaves the sibling keys exactly as they were', async () => {
            const { body } = await serve();
            expect(body.cloudUrl).toBe('');
            expect(body.singleEnvironment).toBe(true);
            expect(body.features.aiStudio).toBe(true);
            expect(body.telemetry).toEqual({});
        });
    });

    describe('the value must be ABSOLUTE — a relative path is refused, loudly', () => {
        it.each([
            '/settings/billing',
            '/_console/apps/cloud_control/page/pricing',
            'apps/cloud_control/page/pricing',
            'cloud.example.com/pricing',
        ])('refuses %j rather than forwarding a path the tenant origin would resolve wrongly', async (value) => {
            const { body, warnings } = await serve({ upgradeUrl: value });
            expect(hasUpgradeUrlKey(body)).toBe(false);
            expect(warnings.some((w) => w.includes(JSON.stringify(value)))).toBe(true);
        });

        it.each([
            'javascript:alert(1)',
            'mailto:billing@example.com',
            'ftp://cloud.example.com/pricing',
        ])('refuses a non-http scheme %j — this string is rendered as a link in every browser', async (value) => {
            const { body, warnings } = await serve({ upgradeUrl: value });
            expect(hasUpgradeUrlKey(body)).toBe(false);
            expect(warnings.some((w) => w.includes(JSON.stringify(value)))).toBe(true);
        });

        it('names the option, the refused value and the requirement, so the host can fix it', async () => {
            const { warnings } = await serve({ upgradeUrl: '/settings/billing' });
            const warning = warnings.find((w) => w.includes('upgradeUrl'));
            expect(warning).toBeDefined();
            expect(warning).toContain('"/settings/billing"');
            expect(warning).toContain('absolute');
        });

        it('a refused value does not disturb the rest of the payload', async () => {
            const { body } = await serve({ upgradeUrl: '/settings/billing' });
            expect(body.cloudUrl).toBe('');
            expect(body.features.aiStudio).toBe(true);
            expect(body.telemetry).toEqual({});
        });

        it('an accepted value emits no warning at all', async () => {
            const { warnings } = await serve({ upgradeUrl: PRICING });
            expect(warnings.some((w) => w.includes('upgradeUrl'))).toBe(false);
        });
    });
});
