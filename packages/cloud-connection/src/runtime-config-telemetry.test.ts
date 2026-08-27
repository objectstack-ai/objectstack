// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `telemetry.errorReporting` — the client error-reporting SOURCE served by the
 * operator's own runtime (#12681, superseding the #10805 permission boolean).
 *
 * The measured injury: an air-gapped on-prem EE Console sent 14 Sentry
 * envelopes per session to `sentry.io` carrying IP + User-Agent PII, and the
 * customer had no way to stop it. #10805 shipped a runtime PERMISSION and left
 * the SOURCE compiled into the bundle — which closed the leak and left a
 * self-hosting operator unable to turn reporting ON at all, because
 * ObjectStack's users consume a prebuilt console and cannot set build-time
 * keys. This file pins the server half of the replacement.
 *
 * Two subjects, and they are different claims:
 *
 *  - `RuntimeConfigPlugin` — does the runtime SERVE the right thing?
 *  - `readClientErrorReporting` — does the documented reading of what it
 *    served (and of what a runtime that never heard of the key served) come
 *    out fail-closed?
 *
 * The second is the one that carries the guarantee, which is why the producer
 * owns it: "no DSN means do not send" is a claim about consumer code, and a
 * consumer left to write its own `?.` chain is one loose truthiness check away
 * from re-opening the leak on exactly the legacy payloads the guarantee is for.
 *
 * ## What changed shape here, and why the old conjunction is gone
 *
 * #10805's suite composed two grants — `Boolean(buildTimeDsn) && permission` —
 * because the source and the permission lived in different places. They do not
 * any more: the DSN's presence IS the grant, so the composed decision collapsed
 * to reading one object. That collapse is the fix, not an accident of it: two
 * knobs in two places produced two silent dead states ("permission on, no DSN"
 * and "DSN in, permission off") that look identical from the browser.
 *
 * Every absence assertion below is therefore paired with a COUNTER-PROBE — a
 * posture that SHOULD serve a DSN, asserted to actually serve one. Without it,
 * a plugin stuck serving nothing at all would satisfy this entire file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuntimeConfigPlugin, type RuntimeConfigPluginConfig } from './runtime-config-plugin.js';
import {
    readClientErrorReporting,
    readClientErrorReportingConfig,
    redactDsn,
    CLIENT_ERROR_REPORTING_DSN_ENV,
    CLIENT_ERROR_REPORTING_PII_ENV,
    CLIENT_ERROR_REPORTING_ENVIRONMENT_ENV,
    CLIENT_ERROR_REPORTING_TRACES_RATE_ENV,
    CLIENT_ERROR_REPORTING_REPLAY_RATE_ENV,
    DEFAULT_TRACES_SAMPLE_RATE,
    DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE,
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
 * mention `OS_CLOUD_URL` is running in the "same origin, not declined" posture.
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

/** A DSN of the shape every real Sentry project issues. */
const DSN = 'https://abc123@o1.ingest.sentry.io/42';
/** A self-hosted sink — must be as acceptable as the SaaS one. */
const SELF_HOSTED_DSN = 'https://key9@sentry.acme.internal/7';

/** Every env var this feature reads, so a test can clear the whole family. */
const TELEMETRY_ENVS = [
    CLIENT_ERROR_REPORTING_DSN_ENV,
    CLIENT_ERROR_REPORTING_PII_ENV,
    CLIENT_ERROR_REPORTING_ENVIRONMENT_ENV,
    CLIENT_ERROR_REPORTING_TRACES_RATE_ENV,
    CLIENT_ERROR_REPORTING_REPLAY_RATE_ENV,
];

describe('RuntimeConfigPlugin — telemetry.errorReporting (#12681)', () => {
    const saved = new Map<string, string | undefined>();

    beforeEach(() => {
        for (const name of [...TELEMETRY_ENVS, 'OS_CLOUD_URL']) {
            if (!saved.has(name)) saved.set(name, process.env[name]);
            delete process.env[name];
        }
    });
    afterEach(() => {
        for (const [name, value] of saved) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });

    describe('fail-closed by default — a deployment that says nothing sends nothing', () => {
        it('serves no sink with zero configuration (the operator who never heard of Sentry)', async () => {
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting).toBeUndefined();
            // Nothing was refused, so nothing is reported: a default is not a
            // diagnostic, and a warning on every boot is a muted warning.
            expect(warnings).toEqual([]);
        });

        it('serves no sink on a CONNECTED posture either, not only on the air-gapped one', async () => {
            // The internet-connected on-prem EE box runs the SAME build
            // artifact as the hosted console, so "connected therefore
            // configured" would have left the reported injury class open one
            // deployment over, for a customer equally unaware of Sentry.
            process.env.OS_CLOUD_URL = 'https://cloud.objectos.ai';
            const { body } = await serve({ controlPlaneUrl: 'https://cloud.objectos.ai' });
            expect(body.telemetry.errorReporting).toBeUndefined();
        });

        it('the telemetry BLOCK is always present, so one curl distinguishes the two absences', async () => {
            const { body } = await serve();
            expect(Object.prototype.hasOwnProperty.call(body, 'telemetry')).toBe(true);
            // `{"telemetry":{}}` — this runtime knows the key and has no DSN.
            // A payload with no `telemetry` key at all came from a runtime that
            // does not know it. Both deny; only one is fixable here.
            expect(JSON.parse(JSON.stringify(body)).telemetry).toEqual({});
        });
    });

    describe('direction 1 — a configured DSN reaches the payload', () => {
        it('THE ACCEPTANCE — the env var alone enables reporting, no frontend rebuild', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting.dsn).toBe(DSN);
            expect(warnings).toEqual([]);
        });

        it('accepts a self-hosted sink as readily as the SaaS one', async () => {
            // The validation must not be a vendor-format parser: refusing a
            // working self-hosted DSN would hand the operator this card's own
            // defect back.
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = SELF_HOSTED_DSN;
            const { body } = await serve();
            expect(body.telemetry.errorReporting.dsn).toBe(SELF_HOSTED_DSN);
        });

        it('trims a padded DSN rather than refusing it', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = `  ${DSN}  `;
            expect((await serve()).body.telemetry.errorReporting.dsn).toBe(DSN);
        });

        it('the host option configures it with no env var set at all', async () => {
            const { body } = await serve({ clientErrorReporting: { dsn: DSN } });
            expect(body.telemetry.errorReporting.dsn).toBe(DSN);
        });

        it('the host option wins over the env var, per field', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = SELF_HOSTED_DSN;
            const { body } = await serve({ clientErrorReporting: { dsn: DSN } });
            expect(body.telemetry.errorReporting.dsn).toBe(DSN);
        });

        it('a host option for ONE knob does not discard the operator DSN', async () => {
            // Whole-object replacement was rejected precisely here: a host
            // passing only `sendDefaultPii` silently dropping `..._DSN` is the
            // quiet two-knob failure this card exists to delete.
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            const { body } = await serve({ clientErrorReporting: { sendDefaultPii: true } });
            expect(body.telemetry.errorReporting.dsn).toBe(DSN);
            expect(body.telemetry.errorReporting.sendDefaultPii).toBe(true);
        });

        it('a same-origin runtime (controlPlaneUrl: "") is NOT a declined control plane', async () => {
            // The conflation this must not inherit: `resolveCloudUrl()` returns
            // '' both for "this runtime IS the cloud" and for `OS_CLOUD_URL=off`.
            // Reading the posture off that would silence the hosted console —
            // the one deployment that legitimately configures a sink.
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            const { body, warnings } = await serve({ controlPlaneUrl: '' });
            expect(body.telemetry.errorReporting.dsn).toBe(DSN);
            expect(warnings).toEqual([]);
        });
    });

    describe('the closed set of knobs travels WITH the DSN', () => {
        it('defaults every knob to its documented value when only a DSN is set', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            const { body } = await serve();
            expect(body.telemetry.errorReporting).toEqual({
                dsn: DSN,
                // OPT-IN. One artifact serves every posture, so PII collection
                // is the deliberate choice of the deployment that wants it.
                sendDefaultPii: false,
                tracesSampleRate: DEFAULT_TRACES_SAMPLE_RATE,
                // Replay records what the user did — the most privacy-bearing
                // knob in the set, therefore off unless asked for.
                replaysOnErrorSampleRate: DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE,
            });
            // Absent, not empty-string: there IS a sensible client-side answer
            // (the SPA's build mode) and inventing one here would assert
            // something this side does not know.
            expect(Object.prototype.hasOwnProperty.call(body.telemetry.errorReporting, 'environment'))
                .toBe(false);
        });

        it.each(['1', 'true', 'on', 'yes', 'TRUE', '  yes  '])('opts into PII on %j', async (raw) => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            process.env[CLIENT_ERROR_REPORTING_PII_ENV] = raw;
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting.sendDefaultPii).toBe(true);
            expect(warnings).toEqual([]);
        });

        it.each(['0', 'false', 'off', 'no'])('keeps PII off on %j, silently', async (raw) => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            process.env[CLIENT_ERROR_REPORTING_PII_ENV] = raw;
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting.sendDefaultPii).toBe(false);
            expect(warnings).toEqual([]);
        });

        it('carries the operator environment tag and the sample rates', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            process.env[CLIENT_ERROR_REPORTING_ENVIRONMENT_ENV] = 'staging';
            process.env[CLIENT_ERROR_REPORTING_TRACES_RATE_ENV] = '0.25';
            process.env[CLIENT_ERROR_REPORTING_REPLAY_RATE_ENV] = '1';
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting).toMatchObject({
                environment: 'staging',
                tracesSampleRate: 0.25,
                replaysOnErrorSampleRate: 1,
            });
            expect(warnings).toEqual([]);
        });

        it('accepts a rate of exactly 0 rather than reading it as unset', async () => {
            // `0` is a real answer ("sample nothing"), and `??`-style coalescing
            // would quietly replace it with the default — the operator would
            // have turned sampling DOWN and got it turned back up.
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            process.env[CLIENT_ERROR_REPORTING_TRACES_RATE_ENV] = '0';
            expect((await serve()).body.telemetry.errorReporting.tracesSampleRate).toBe(0);
        });

        it('survives the wire — the whole block round-trips through JSON unchanged', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            process.env[CLIENT_ERROR_REPORTING_PII_ENV] = 'true';
            process.env[CLIENT_ERROR_REPORTING_ENVIRONMENT_ENV] = 'production';
            const { body } = await serve();
            expect(JSON.parse(JSON.stringify(body)).telemetry.errorReporting)
                .toEqual(body.telemetry.errorReporting);
        });
    });

    describe('direction 2 — malformed is REFUSED at mount, never coerced', () => {
        it.each([
            ['not a URL at all', 'enable'],
            ['a bare host', 'sentry.io/42'],
            ['the wrong scheme', 'ftp://abc@o1.ingest.sentry.io/42'],
            ['no public key', 'https://o1.ingest.sentry.io/42'],
            ['no project id', 'https://abc123@o1.ingest.sentry.io'],
        ])('refuses %s and serves no block', async (_label, raw) => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = raw;
            const { body } = await serve();
            expect(body.telemetry.errorReporting).toBeUndefined();
        });

        it('names the refused DSN, the env var and the accepted form, so it is fixable', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = 'enable';
            const { warnings } = await serve();
            const warning = warnings.find((w) => w.includes(CLIENT_ERROR_REPORTING_DSN_ENV));
            expect(warning).toBeDefined();
            expect(warning).toContain('"enable"');
            expect(warning).toContain('PUBLIC_KEY');
            expect(warning).toContain('sends no error reports');
        });

        it('REFUSES A SECRET-BEARING DSN — this payload is read by every browser', async () => {
            // Not shape policing. A legacy Sentry DSN carrying a secret after
            // the public key would be published to every Console visitor, and
            // the value looks entirely ordinary while doing it.
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = 'https://public:secret@o1.ingest.sentry.io/42';
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting).toBeUndefined();
            const warning = warnings.find((w) => w.includes(CLIENT_ERROR_REPORTING_DSN_ENV));
            expect(warning).toBeDefined();
            expect(warning).toContain('secret');
        });

        it('REDACTS the key when quoting a refused DSN — boot logs travel further than config', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = 'https://sup3rsecret@o1.ingest.sentry.io';
            const { warnings } = await serve();
            const warning = warnings.find((w) => w.includes(CLIENT_ERROR_REPORTING_DSN_ENV));
            expect(warning).not.toContain('sup3rsecret');
            // ...and the SHAPE is kept, which is the half the operator needs.
            expect(warning).toContain('o1.ingest.sentry.io');
        });

        it('an EMPTY DSN reads as unset — no block, and silent', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = '   ';
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting).toBeUndefined();
            expect(warnings).toEqual([]);
        });

        it('a bad SAMPLE RATE takes down only itself — the sink still ships', async () => {
            // Refusal always lands on the safer value, and the safer value for
            // a volume knob is its default. Silencing error reporting over a
            // typo in an unrelated knob would be strictness pointed away from
            // the hazard.
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            process.env[CLIENT_ERROR_REPORTING_TRACES_RATE_ENV] = 'lots';
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting.dsn).toBe(DSN);
            expect(body.telemetry.errorReporting.tracesSampleRate).toBe(DEFAULT_TRACES_SAMPLE_RATE);
            expect(warnings.some((w) => w.includes(CLIENT_ERROR_REPORTING_TRACES_RATE_ENV))).toBe(true);
        });

        it.each(['2', '-0.5', 'lots', ''])('refuses the out-of-range rate %j', (raw) => {
            const reading = readClientErrorReportingConfig({ dsn: DSN, tracesSampleRate: raw });
            expect(reading.config?.tracesSampleRate).toBe(DEFAULT_TRACES_SAMPLE_RATE);
        });

        it('a bad PII spelling falls back to OFF and says so', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            process.env[CLIENT_ERROR_REPORTING_PII_ENV] = 'sure';
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting.sendDefaultPii).toBe(false);
            const warning = warnings.find((w) => w.includes(CLIENT_ERROR_REPORTING_PII_ENV));
            expect(warning).toBeDefined();
            expect(warning).toContain('"sure"');
            for (const accepted of ['1', 'true', 'on', 'yes', '0', 'false', 'off', 'no']) {
                expect(warning).toContain(accepted);
            }
        });

        it('reports EVERY wrong knob, not just the first', async () => {
            // An operator who mis-set two knobs has two things to fix, and
            // hearing about one is how the second stays hidden.
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            process.env[CLIENT_ERROR_REPORTING_PII_ENV] = 'sure';
            process.env[CLIENT_ERROR_REPORTING_REPLAY_RATE_ENV] = 'always';
            const { warnings } = await serve();
            expect(warnings.some((w) => w.includes(CLIENT_ERROR_REPORTING_PII_ENV))).toBe(true);
            expect(warnings.some((w) => w.includes(CLIENT_ERROR_REPORTING_REPLAY_RATE_ENV))).toBe(true);
        });

        it('reports knob refusals even when the DSN is missing too', async () => {
            // Both are broken; reporting only the DSN would leave the operator
            // fixing it and then meeting the second failure on the next boot.
            process.env[CLIENT_ERROR_REPORTING_PII_ENV] = 'sure';
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting).toBeUndefined();
            expect(warnings.some((w) => w.includes(CLIENT_ERROR_REPORTING_PII_ENV))).toBe(true);
        });
    });

    describe('the declared-off control plane refuses to serve the sink (the posture ceiling)', () => {
        it.each(['off', 'none', 'local', 'disabled', 'OFF', ' off '])(
            'OS_CLOUD_URL=%j overrules a well-formed DSN',
            async (raw) => {
                process.env.OS_CLOUD_URL = raw;
                process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
                const { body } = await serve();
                expect(body.telemetry.errorReporting).toBeUndefined();
            },
        );

        it('overrules the HOST option too, not only the env var', async () => {
            process.env.OS_CLOUD_URL = 'off';
            const { body } = await serve({ clientErrorReporting: { dsn: DSN } });
            expect(body.telemetry.errorReporting).toBeUndefined();
        });

        it('catches the decline spelled in the host argument, with no env var at all', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            const { body } = await serve({ controlPlaneUrl: 'off' });
            expect(body.telemetry.errorReporting).toBeUndefined();
        });

        it('says so — an explicit configuration refused in silence is this defect class', async () => {
            process.env.OS_CLOUD_URL = 'off';
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            const { warnings } = await serve();
            const warning = warnings.find((w) => w.includes('refusing to serve'));
            expect(warning).toBeDefined();
            expect(warning).toContain('OS_CLOUD_URL');
            expect(warning).toContain(CLIENT_ERROR_REPORTING_DSN_ENV);
            // The key is masked here too — same reason as every other quote.
            expect(warning).not.toContain('abc123');
        });

        it('stays silent when there was no DSN to refuse', async () => {
            process.env.OS_CLOUD_URL = 'off';
            const { body, warnings } = await serve();
            expect(body.telemetry.errorReporting).toBeUndefined();
            expect(warnings.some((w) => w.includes('refusing to serve'))).toBe(false);
        });
    });

    describe('the sink has exactly one author — resolveFeatures cannot supply it', () => {
        it('a distribution feature hook returning telemetry keys does not move the sink', async () => {
            const { body } = await serve({
                resolveFeatures: () => ({ errorReporting: { dsn: DSN } } as any),
            });
            // It may land in the open-ended feature map — that map is the
            // distribution's — but the sink is a sibling of it, not a member,
            // so billing-tier code cannot reach it.
            expect(body.telemetry.errorReporting).toBeUndefined();
            expect(readClientErrorReporting(body)).toBeNull();
        });
    });
});

describe('readClientErrorReporting — the fail-closed reading (#12681)', () => {
    describe('a configured runtime is what turns reporting on, and nothing else is', () => {
        it('reads the sink out of a runtime that serves one', () => {
            const payload = { telemetry: { errorReporting: { dsn: DSN, sendDefaultPii: true } } };
            expect(readClientErrorReporting(payload)).toMatchObject({ dsn: DSN, sendDefaultPii: true });
        });

        it('a runtime serving an empty telemetry block sends nothing', () => {
            expect(readClientErrorReporting({ telemetry: {} })).toBeNull();
        });
    });

    describe('absent reads as do-not-send', () => {
        it('a payload from a runtime that never heard of the key', () => {
            // Every field a pre-#12681 runtime really serves, and no telemetry.
            const legacy = {
                cloudUrl: '',
                singleEnvironment: true,
                features: { installLocal: true, marketplace: false, aiStudio: true },
                branding: { productName: 'ObjectOS' },
            };
            expect(Object.prototype.hasOwnProperty.call(legacy, 'telemetry')).toBe(false);
            expect(readClientErrorReporting(legacy)).toBeNull();
        });

        it('a payload from the runtime this card REPLACED — the permission boolean alone', () => {
            // The landing-order case stated in both PR bodies: an intermediate
            // runtime serving only #10805's boolean carries no source, so a new
            // client reads it as off. No dual-spelling window in either
            // direction.
            expect(readClientErrorReporting({ telemetry: { allowClientErrorReporting: true } })).toBeNull();
        });

        it.each([
            ['an empty errorReporting block', { telemetry: { errorReporting: {} } }],
            ['a present-but-undefined dsn', { telemetry: { errorReporting: { dsn: undefined } } }],
            ['an empty-string dsn', { telemetry: { errorReporting: { dsn: '' } } }],
            ['a whitespace-only dsn', { telemetry: { errorReporting: { dsn: '   ' } } }],
            ['a non-string dsn', { telemetry: { errorReporting: { dsn: 42 } } }],
            ['a null errorReporting block', { telemetry: { errorReporting: null } }],
            ['an errorReporting block that is not an object', { telemetry: { errorReporting: DSN } }],
            ['a null telemetry block', { telemetry: null }],
            ['a telemetry block that is not an object', { telemetry: 'on' }],
            ['an empty payload', {}],
        ])('%s', (_label, payload) => {
            expect(readClientErrorReporting(payload)).toBeNull();
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
            expect(readClientErrorReporting(payload)).toBeNull();
        });

        it('the real thing: a rejected fetch, caught, read through the same function', async () => {
            const fetchRuntimeConfig = async (): Promise<unknown> => {
                try {
                    throw new TypeError('Failed to fetch');
                } catch {
                    // The whole point of accepting `unknown`: the error path is
                    // the absent path, so there is no second reading to forget.
                    return undefined;
                }
            };
            expect(readClientErrorReporting(await fetchRuntimeConfig())).toBeNull();
        });
    });

    describe('the knobs are re-derived defensively, never coerced', () => {
        it.each([
            ['the STRING "true"', 'true'],
            ['the number 1', 1],
            ['the string "yes"', 'yes'],
            ['a truthy object', {}],
        ])('does not accept %s as a PII opt-in', (_label, value) => {
            // `=== true`, not truthiness. A consumer should not be taught that
            // any truthy shape on this key opens a PII flow.
            const payload = { telemetry: { errorReporting: { dsn: DSN, sendDefaultPii: value } } };
            expect(readClientErrorReporting(payload)?.sendDefaultPii).toBe(false);
        });

        it.each([['a numeric string', '0.5'], ['out of range', 2], ['not a number', NaN]])(
            'falls back to the default rate on %s',
            (_label, value) => {
                const payload = { telemetry: { errorReporting: { dsn: DSN, tracesSampleRate: value } } };
                expect(readClientErrorReporting(payload)?.tracesSampleRate).toBe(DEFAULT_TRACES_SAMPLE_RATE);
            },
        );

        it('REFUSES a secret-bearing DSN from an untrusted host', () => {
            // The one shape check the consumer keeps, because its failure mode
            // is a secret published to every browser rather than a
            // misconfiguration. A well-behaved ObjectStack runtime never serves
            // one, so this can only fire against a third-party host.
            const payload = {
                telemetry: { errorReporting: { dsn: 'https://public:secret@o1.ingest.sentry.io/42' } },
            };
            expect(readClientErrorReporting(payload)).toBeNull();
        });

        it('does NOT re-run the producer full shape check', () => {
            // A server serving a working DSN that this reader quietly discarded
            // would be the two-places-disagreeing failure this card deletes,
            // one layer down. `Sentry.init` is the authority on its own format.
            const odd = { telemetry: { errorReporting: { dsn: 'https://k@host/1?tunnel=x' } } };
            expect(readClientErrorReporting(odd)?.dsn).toBe('https://k@host/1?tunnel=x');
        });
    });

    describe('the served payload round-trips through JSON into the same verdict', () => {
        const savedDsn = process.env[CLIENT_ERROR_REPORTING_DSN_ENV];
        afterEach(() => {
            if (savedDsn === undefined) delete process.env[CLIENT_ERROR_REPORTING_DSN_ENV];
            else process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = savedDsn;
        });

        it('configured — and every field the producer emitted survives the reader', async () => {
            process.env[CLIENT_ERROR_REPORTING_DSN_ENV] = DSN;
            const { body } = await serve();
            delete process.env[CLIENT_ERROR_REPORTING_DSN_ENV];
            // Producer-accepted implies consumer-accepted: the two sides must
            // never disagree about a DSN, or the operator gets a silent dead
            // state in the one place this card removed it from.
            expect(readClientErrorReporting(JSON.parse(JSON.stringify(body))))
                .toEqual(body.telemetry.errorReporting);
        });

        it('unconfigured', async () => {
            const { body } = await serve();
            expect(readClientErrorReporting(JSON.parse(JSON.stringify(body)))).toBeNull();
        });
    });
});

describe('readClientErrorReportingConfig — the pure resolution (#12681)', () => {
    it('unset is unset: no config, and not a refusal', () => {
        expect(readClientErrorReportingConfig({})).toEqual({ refusals: [] });
    });

    it('an unrecognised DSN is refused AND held for reporting', () => {
        const reading = readClientErrorReportingConfig({ dsn: 'enable' });
        expect(reading.config).toBeUndefined();
        expect(reading.refusals).toHaveLength(1);
        expect(reading.refusals[0]).toMatchObject({ env: CLIENT_ERROR_REPORTING_DSN_ENV, value: 'enable' });
    });

    it('believes a typed host boolean without running it through the string vocabulary', () => {
        expect(readClientErrorReportingConfig({ dsn: DSN, sendDefaultPii: true }).config?.sendDefaultPii)
            .toBe(true);
    });

    it('refuses a non-string, non-boolean knob rather than coercing it', () => {
        // A JS host outside the type system can hand over anything at all.
        const reading = readClientErrorReportingConfig({ dsn: DSN, sendDefaultPii: {} });
        expect(reading.config?.sendDefaultPii).toBe(false);
        expect(reading.refusals).toHaveLength(1);
    });

    it('reads a typed host number for a sample rate', () => {
        expect(readClientErrorReportingConfig({ dsn: DSN, tracesSampleRate: 0.5 }).config?.tracesSampleRate)
            .toBe(0.5);
    });
});

describe('redactDsn — boot logs travel further than the configuration they quote', () => {
    it('masks the public key and keeps the shape', () => {
        expect(redactDsn(DSN)).toBe('https://***@o1.ingest.sentry.io/42');
    });

    it('masks a secret-bearing DSN too, both halves of the userinfo', () => {
        expect(redactDsn('https://public:secret@o1.ingest.sentry.io/42'))
            .toBe('https://***@o1.ingest.sentry.io/42');
    });

    it('still masks a value that does NOT parse as a URL — those are the ones it sees', () => {
        expect(redactDsn('htp://key@host/1')).toBe('htp://***@host/1');
    });

    it('leaves a value with no userinfo alone', () => {
        expect(redactDsn('enable')).toBe('enable');
    });

    it('truncates something pasted in by mistake', () => {
        expect(redactDsn('x'.repeat(500))).toHaveLength(121);
    });
});
