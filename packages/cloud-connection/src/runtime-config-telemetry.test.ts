// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `telemetry.allowClientErrorReporting` — the post-build off switch (#10805,
 * upstream half of cloud#1508).
 *
 * The measured injury: an air-gapped on-prem EE Console sent 14 Sentry
 * envelopes per session to `sentry.io` carrying IP + User-Agent PII, and the
 * customer had no way to stop it — every knob was a Vite build-time variable
 * frozen into the bundle. This file pins the server half of the fix.
 *
 * Two subjects, and they are different claims:
 *
 *  - `RuntimeConfigPlugin` — does the runtime SAY the right thing?
 *  - `isClientErrorReportingAllowed` — does the documented reading of what it
 *    said (and of what a runtime that never heard of the key said) come out
 *    fail-closed?
 *
 * The second is the one that carries the guarantee, which is why the producer
 * owns it: "absent means do not send" is a claim about consumer code, and a
 * consumer left to write its own `?.` chain is one `!== false` away from
 * re-opening the leak on exactly the legacy payloads the guarantee is for.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuntimeConfigPlugin, type RuntimeConfigPluginConfig } from './runtime-config-plugin.js';
import {
    isClientErrorReportingAllowed,
    readClientErrorReportingGrant,
    CLIENT_ERROR_REPORTING_ENV,
} from './telemetry-posture.js';

interface Served {
    body: any;
    warnings: string[];
}

/**
 * Mount the plugin on a Hono-shaped raw app and serve one request, keeping the
 * warnings it emitted at mount time. Same harness as
 * `runtime-config-stage.test.ts` — the refusal paths are only observable there.
 *
 * The default `controlPlaneUrl: ''` is load-bearing, not boilerplate: it is
 * what the CLI passes on BOTH its arms, so every test below that does not
 * mention the env var is running in the "same origin, not declined" posture.
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
    const body = await handler({ req: { header: () => undefined }, json: (b: any) => b });
    return { body, warnings };
}

/**
 * The consumer rule this key exists to make expressible, written out once.
 *
 * The DSN is the build-time conjunct objectui already owns; the permission is
 * the runtime conjunct this repo just added. Neither alone sends. Spelling the
 * conjunction here is what lets the "a declining server beats a DSN" pins be
 * about the composed decision rather than about a boolean in isolation.
 */
function wouldSendToThirdParty(buildTimeDsn: string | undefined, runtimeConfig: unknown): boolean {
    return Boolean(buildTimeDsn) && isClientErrorReportingAllowed(runtimeConfig);
}

/** A build that DID opt in at build time — the artifact cloud#1508 measured. */
const OPTED_IN_BUILD = 'https://abc123@o1.ingest.sentry.io/42';

describe('RuntimeConfigPlugin — telemetry.allowClientErrorReporting (#10805)', () => {
    const savedGrant = process.env[CLIENT_ERROR_REPORTING_ENV];
    const savedCloudUrl = process.env.OS_CLOUD_URL;

    beforeEach(() => {
        delete process.env[CLIENT_ERROR_REPORTING_ENV];
        delete process.env.OS_CLOUD_URL;
    });
    afterEach(() => {
        if (savedGrant === undefined) delete process.env[CLIENT_ERROR_REPORTING_ENV];
        else process.env[CLIENT_ERROR_REPORTING_ENV] = savedGrant;
        if (savedCloudUrl === undefined) delete process.env.OS_CLOUD_URL;
        else process.env.OS_CLOUD_URL = savedCloudUrl;
    });

    describe('fail-closed by default — a deployment that says nothing sends nothing', () => {
        it('denies with zero configuration (the air-gapped operator who never heard of Sentry)', async () => {
            const { body, warnings } = await serve();
            expect(body.telemetry.allowClientErrorReporting).toBe(false);
            // Nothing was refused, so nothing is reported: a default is not a
            // diagnostic, and a warning on every boot is a muted warning.
            expect(warnings).toEqual([]);
        });

        it('denies on a CONNECTED posture too, not only on the air-gapped one', async () => {
            // The internet-connected on-prem EE box runs the SAME build
            // artifact as the hosted console, so "connected therefore allowed"
            // would have left the reported injury class open one deployment
            // over, for a customer equally unaware of Sentry.
            process.env.OS_CLOUD_URL = 'https://cloud.objectos.ai';
            const { body } = await serve({ controlPlaneUrl: 'https://cloud.objectos.ai' });
            expect(body.telemetry.allowClientErrorReporting).toBe(false);
        });

        it('the key is ALWAYS present, so absence can mean exactly one thing', async () => {
            const { body } = await serve();
            expect(Object.prototype.hasOwnProperty.call(body, 'telemetry')).toBe(true);
            expect(Object.prototype.hasOwnProperty.call(body.telemetry, 'allowClientErrorReporting')).toBe(true);
            // ...and it survives the wire as a real boolean, not as a dropped
            // `undefined` — the failure `branding.stage` had to be spelled
            // around, pointing the other way.
            const parsed = JSON.parse(JSON.stringify(body));
            expect(parsed.telemetry).toEqual({ allowClientErrorReporting: false });
        });
    });

    describe('direction 1 — an explicit grant reaches the payload', () => {
        it.each(['1', 'true', 'on', 'yes', 'TRUE', '  yes  '])('grants on %j', async (raw) => {
            process.env[CLIENT_ERROR_REPORTING_ENV] = raw;
            const { body, warnings } = await serve();
            expect(body.telemetry.allowClientErrorReporting).toBe(true);
            expect(warnings).toEqual([]);
        });

        it('the host option grants with no env var set at all', async () => {
            const { body } = await serve({ allowClientErrorReporting: true });
            expect(body.telemetry.allowClientErrorReporting).toBe(true);
        });

        it('the host option wins over the env var — in BOTH directions', async () => {
            process.env[CLIENT_ERROR_REPORTING_ENV] = 'false';
            expect((await serve({ allowClientErrorReporting: true })).body.telemetry.allowClientErrorReporting)
                .toBe(true);
            process.env[CLIENT_ERROR_REPORTING_ENV] = 'true';
            expect((await serve({ allowClientErrorReporting: false })).body.telemetry.allowClientErrorReporting)
                .toBe(false);
        });

        it('a same-origin runtime (controlPlaneUrl: "") is NOT a declined control plane', async () => {
            // The conflation this key must not inherit: `resolveCloudUrl()`
            // returns '' both for "this runtime IS the cloud" and for
            // `OS_CLOUD_URL=off`. Reading the posture off that would deny the
            // hosted console — the one deployment that legitimately grants.
            process.env[CLIENT_ERROR_REPORTING_ENV] = 'true';
            const { body, warnings } = await serve({ controlPlaneUrl: '' });
            expect(body.telemetry.allowClientErrorReporting).toBe(true);
            expect(warnings).toEqual([]);
        });
    });

    describe('direction 2 — an explicit denial, and the vocabulary is closed', () => {
        it.each(['0', 'false', 'off', 'no'])('denies on %j, silently (deliberate, not a typo)', async (raw) => {
            process.env[CLIENT_ERROR_REPORTING_ENV] = raw;
            const { body, warnings } = await serve();
            expect(body.telemetry.allowClientErrorReporting).toBe(false);
            expect(warnings).toEqual([]);
        });

        it.each(['enable', 'enabled', 'y', 'sure', '2'])('refuses %j rather than guessing', async (raw) => {
            process.env[CLIENT_ERROR_REPORTING_ENV] = raw;
            const { body } = await serve();
            expect(body.telemetry.allowClientErrorReporting).toBe(false);
        });

        it('names the refused value AND the accepted set, so the operator can fix it', async () => {
            process.env[CLIENT_ERROR_REPORTING_ENV] = 'enable';
            const { warnings } = await serve();
            const warning = warnings.find((w) => w.includes('telemetry switch'));
            expect(warning).toBeDefined();
            expect(warning).toContain('"enable"');
            expect(warning).toContain(CLIENT_ERROR_REPORTING_ENV);
            for (const accepted of ['1', 'true', 'on', 'yes', '0', 'false', 'off', 'no']) {
                expect(warning).toContain(accepted);
            }
        });

        it('an EMPTY env var reads as unset — denied, and silent', async () => {
            process.env[CLIENT_ERROR_REPORTING_ENV] = '   ';
            const { body, warnings } = await serve();
            expect(body.telemetry.allowClientErrorReporting).toBe(false);
            expect(warnings).toEqual([]);
        });
    });

    describe('the declared-off control plane refuses the grant (the posture ceiling)', () => {
        it.each(['off', 'none', 'local', 'disabled', 'OFF', ' off '])(
            'OS_CLOUD_URL=%j overrules a well-spelled grant',
            async (raw) => {
                process.env.OS_CLOUD_URL = raw;
                process.env[CLIENT_ERROR_REPORTING_ENV] = 'true';
                const { body } = await serve();
                expect(body.telemetry.allowClientErrorReporting).toBe(false);
            },
        );

        it('overrules the HOST option too, not only the env var', async () => {
            process.env.OS_CLOUD_URL = 'off';
            const { body } = await serve({ allowClientErrorReporting: true });
            expect(body.telemetry.allowClientErrorReporting).toBe(false);
        });

        it('catches the decline spelled in the host argument, with no env var at all', async () => {
            process.env[CLIENT_ERROR_REPORTING_ENV] = 'true';
            const { body } = await serve({ controlPlaneUrl: 'off' });
            expect(body.telemetry.allowClientErrorReporting).toBe(false);
        });

        it('says so — an explicit request refused in silence is the defect this card is about', async () => {
            process.env.OS_CLOUD_URL = 'off';
            process.env[CLIENT_ERROR_REPORTING_ENV] = 'true';
            const { warnings } = await serve();
            const warning = warnings.find((w) => w.includes('client-error-reporting grant'));
            expect(warning).toBeDefined();
            expect(warning).toContain('OS_CLOUD_URL');
            expect(warning).toContain(CLIENT_ERROR_REPORTING_ENV);
        });

        it('stays silent when there was no grant to refuse', async () => {
            process.env.OS_CLOUD_URL = 'off';
            const { body, warnings } = await serve();
            expect(body.telemetry.allowClientErrorReporting).toBe(false);
            expect(warnings.some((w) => w.includes('client-error-reporting grant'))).toBe(false);
        });
    });

    describe('the permission has exactly one author — resolveFeatures cannot grant it', () => {
        it('a distribution feature hook returning the key does not move the permission', async () => {
            const { body } = await serve({
                resolveFeatures: () => ({ allowClientErrorReporting: true } as any),
            });
            // It may land in the open-ended feature map — that map is the
            // distribution's — but the permission is a sibling of it, not a
            // member, so billing-tier code cannot reach it.
            expect(body.telemetry.allowClientErrorReporting).toBe(false);
            expect(isClientErrorReportingAllowed(body)).toBe(false);
        });
    });
});

describe('isClientErrorReportingAllowed — the fail-closed reading (#10805)', () => {
    describe('a declining server beats a build-time DSN', () => {
        it('an opted-in BUILD sends nothing when the runtime declines', () => {
            const declining = { telemetry: { allowClientErrorReporting: false } };
            expect(wouldSendToThirdParty(OPTED_IN_BUILD, declining)).toBe(false);
        });

        it('...and sends when the same build meets a runtime that grants', () => {
            // The control that makes the line above a reading rather than a
            // function that always answers false.
            const granting = { telemetry: { allowClientErrorReporting: true } };
            expect(wouldSendToThirdParty(OPTED_IN_BUILD, granting)).toBe(true);
        });

        it('a granting runtime cannot START telemetry on a build with no DSN', () => {
            // The permission is a conjunct, never a source: this side supplies
            // no sink and must not be able to open one.
            const granting = { telemetry: { allowClientErrorReporting: true } };
            expect(wouldSendToThirdParty(undefined, granting)).toBe(false);
        });
    });

    describe('absent reads as do-not-send', () => {
        it('a payload from a runtime that never heard of the key', () => {
            // Every field a pre-#10805 runtime really serves, and no telemetry.
            const legacy = {
                cloudUrl: '',
                singleEnvironment: true,
                features: { installLocal: true, marketplace: false, aiStudio: true },
                branding: { productName: 'ObjectOS' },
            };
            expect(Object.prototype.hasOwnProperty.call(legacy, 'telemetry')).toBe(false);
            expect(isClientErrorReportingAllowed(legacy)).toBe(false);
            expect(wouldSendToThirdParty(OPTED_IN_BUILD, legacy)).toBe(false);
        });

        it.each([
            ['an empty telemetry block', { telemetry: {} }],
            ['a present-but-undefined permission', { telemetry: { allowClientErrorReporting: undefined } }],
            ['a null telemetry block', { telemetry: null }],
            ['a telemetry block that is not an object', { telemetry: 'on' }],
            ['an empty payload', {}],
        ])('%s', (_label, payload) => {
            expect(isClientErrorReportingAllowed(payload)).toBe(false);
        });

        it.each([
            ['the STRING "true"', 'true'],
            ['the number 1', 1],
            ['the string "yes"', 'yes'],
            ['a truthy object', {}],
        ])('does not accept %s as the permission', (_label, value) => {
            // `=== true`, not truthiness. A consumer should not be taught that
            // any truthy shape on this key opens a third-party data flow.
            expect(isClientErrorReportingAllowed({ telemetry: { allowClientErrorReporting: value } })).toBe(false);
        });
    });

    describe('a failed or erroring config fetch reads as do-not-send', () => {
        it.each([
            ['the fetch threw and the caller has nothing', undefined],
            ['the response body was null', null],
            ['a 404 handed back an error envelope', { error: { code: 'NOT_FOUND' } }],
            ['the body was not JSON at all', '<!doctype html>'],
            ['the endpoint answered with an array', []],
        ])('%s', (_label, payload) => {
            expect(isClientErrorReportingAllowed(payload)).toBe(false);
            expect(wouldSendToThirdParty(OPTED_IN_BUILD, payload)).toBe(false);
        });

        it('the real thing: a rejected fetch, caught, read through the same function', async () => {
            const fetchRuntimeConfig = async (): Promise<unknown> => {
                try {
                    throw new TypeError('Failed to fetch');
                } catch {
                    // The whole point of accepting `unknown`: the error path
                    // is the absent path, so there is no second reading to
                    // forget to write.
                    return undefined;
                }
            };
            expect(wouldSendToThirdParty(OPTED_IN_BUILD, await fetchRuntimeConfig())).toBe(false);
        });
    });

    describe('the served payload round-trips through JSON into the same verdict', () => {
        it('granting', async () => {
            process.env[CLIENT_ERROR_REPORTING_ENV] = 'true';
            const { body } = await serve();
            delete process.env[CLIENT_ERROR_REPORTING_ENV];
            expect(isClientErrorReportingAllowed(JSON.parse(JSON.stringify(body)))).toBe(true);
        });

        it('declining', async () => {
            const { body } = await serve();
            expect(isClientErrorReportingAllowed(JSON.parse(JSON.stringify(body)))).toBe(false);
        });
    });
});

describe('readClientErrorReportingGrant — the closed switch vocabulary (#10805)', () => {
    it('unset is unset: denied, and not a refusal', () => {
        expect(readClientErrorReportingGrant(undefined)).toEqual({ allowed: false });
    });

    it('an unrecognised spelling is denied AND held for reporting', () => {
        expect(readClientErrorReportingGrant('enable')).toEqual({ allowed: false, refused: 'enable' });
    });

    it('keeps the operator original spelling, untrimmed, so the diagnostic quotes what they typed', () => {
        expect(readClientErrorReportingGrant(' Enable ').refused).toBe(' Enable ');
    });
});
