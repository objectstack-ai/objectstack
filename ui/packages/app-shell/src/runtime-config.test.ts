// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * runtime-config commercial-feature parsing (cloud ADR-0011/0012).
 *
 * `customDomain` / `sso` / `scim` are paid flags: they must default OFF and
 * only turn on when the server explicitly grants them, so an older/vanilla
 * runtime that omits them never surfaces a paid affordance.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { initRuntimeConfig, getRuntimeConfig, getPlatformStage, isAiStudioEnabled, isMarketplaceEnabled, isStorageUsageServed, isSingleAppSwitcherHidden, getClientErrorReporting, resetRuntimeConfigForTesting } from './runtime-config.js';

function mockConfig(features: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ features }),
    })) as any);
}

afterEach(() => {
    resetRuntimeConfigForTesting();
    vi.unstubAllGlobals();
});

describe('runtime-config commercial features', () => {
    it('defaults customDomain/sso/scim OFF before init', () => {
        resetRuntimeConfigForTesting();
        expect(getRuntimeConfig().features.customDomain).toBe(false);
        expect(getRuntimeConfig().features.sso).toBe(false);
        expect(getRuntimeConfig().features.scim).toBe(false);
    });

    it('grants customDomain/sso only when the server says true (scim stays OFF when the server says false)', async () => {
        mockConfig({ customDomain: true, sso: false, scim: false });
        await initRuntimeConfig();
        expect(getRuntimeConfig().features.customDomain).toBe(true);
        expect(getRuntimeConfig().features.sso).toBe(false);
        // The negative leg that actually tests fail-closed: `scim: false` sits
        // in the SAME payload as `customDomain: true`, so a hardcoded
        // `scim: true` (or "any granted sibling flips scim on") would fail
        // here even though it would pass the all-true case below.
        expect(getRuntimeConfig().features.scim).toBe(false);
    });

    it('business-tier grants all three', async () => {
        mockConfig({ customDomain: true, sso: true, scim: true });
        await initRuntimeConfig();
        expect(getRuntimeConfig().features.customDomain).toBe(true);
        expect(getRuntimeConfig().features.sso).toBe(true);
        expect(getRuntimeConfig().features.scim).toBe(true);
    });

    it('older runtime omitting the flags keeps them OFF (no paid surface leak)', async () => {
        mockConfig({ aiStudio: true }); // no customDomain/sso/scim keys at all
        await initRuntimeConfig();
        expect(getRuntimeConfig().features.customDomain).toBe(false);
        expect(getRuntimeConfig().features.sso).toBe(false);
        expect(getRuntimeConfig().features.scim).toBe(false);
        // sanity: existing flags still parse
        expect(getRuntimeConfig().features.aiStudio).toBe(true);
    });

});

/**
 * Platform stage drives the top-bar preview/beta badge. It must default to
 * `'preview'` so the whole platform reads as preview before/without any server
 * signal, only leave preview when the server sends a recognised stage, and
 * never blank out on a malformed payload.
 */
function mockBranding(branding: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ branding }),
    })) as any);
}

/**
 * `isAiStudioEnabled()` — the AI-authoring gate's ONE spelling (objectui#5577).
 *
 * `features.aiStudio` used to be read inline at two call sites with two
 * different spellings (`ChatDock` un-chained, `HomePage` optional-chained), and
 * the fail-open doctrine was written down only on the `marketplace` sibling. The
 * accessor is where the doctrine now lives, so these cases pin the doctrine
 * itself rather than either call site's transcription of it:
 *
 *  - fails OPEN on every unanswered question (before init, key absent, fetch
 *    failed) — withholding a working capability on no answer is the worse
 *    direction, and the server refuses the write regardless;
 *  - only the literal `false` closes it;
 *  - the snapshot the accessor reads always carries `features`, which is why an
 *    absent flag is a DEFAULT here and never a TypeError.
 */
describe('runtime-config isAiStudioEnabled (objectui#5577)', () => {
    it('fails OPEN before init — a runtime that never answered keeps the capability', () => {
        resetRuntimeConfigForTesting();
        expect(isAiStudioEnabled()).toBe(true);
    });

    it('honours an explicit false from the server', async () => {
        mockConfig({ aiStudio: false });
        await initRuntimeConfig();
        expect(isAiStudioEnabled()).toBe(false);
    });

    it('stays enabled when the server explicitly says true', async () => {
        mockConfig({ aiStudio: true });
        await initRuntimeConfig();
        expect(isAiStudioEnabled()).toBe(true);
    });

    it('fails OPEN when the runtime omits the aiStudio key entirely', async () => {
        mockConfig({ marketplace: true }); // no aiStudio key at all
        await initRuntimeConfig();
        expect(isAiStudioEnabled()).toBe(true);
    });

    it('fails OPEN when the config fetch itself fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('network down');
        }) as any);
        await initRuntimeConfig();
        expect(isAiStudioEnabled()).toBe(true);
    });

    it('closes only on the literal false, never on a falsy look-alike', async () => {
        // `!== false` is the doctrine, not `=== true`: a runtime that sends a
        // string or a 0 has not said "disabled", so the capability stays.
        mockConfig({ aiStudio: 'false' });
        await initRuntimeConfig();
        expect(isAiStudioEnabled()).toBe(true);
    });

    it('agrees with its marketplace sibling on the fail-open direction', () => {
        // One doctrine, one spelling. If these two ever diverge, the accessor
        // that changed has left the doctrine its docblock claims to carry.
        resetRuntimeConfigForTesting();
        expect(isAiStudioEnabled()).toBe(isMarketplaceEnabled());
        expect(isAiStudioEnabled()).toBe(true);
    });

    /**
     * The reachability leg of objectui#5577: the accessor reads the module's own
     * singleton, and EVERY writer of that singleton constructs `features` as an
     * object (the initial `{...defaults}`, `applyUpdate`'s spread, and the test
     * reset). There is no exported setter, so no caller can install a partial
     * snapshot through the module's API — which is what makes an absent flag a
     * default rather than the TypeError the un-chained inline read would have
     * produced. Driven through the real fetch path, not asserted from the source.
     */
    it('never hands out a snapshot missing `features`, whatever the server sends', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ branding: { productName: 'Acme' } }), // no `features` key
        })) as any);
        await initRuntimeConfig();
        expect(getRuntimeConfig().features).toBeDefined();
        expect(getRuntimeConfig().branding.productName).toBe('Acme');
        expect(isAiStudioEnabled()).toBe(true);
    });
});

/**
 * `features.storageUsage` — does this runtime serve `GET /api/v1/usage/storage`?
 * (objectui#11002)
 *
 * A composition fact, not a plan one: the cloud distribution serves `true`
 * exactly when it mounts the endpoint, and every other runtime sends no key.
 * The two console banners that read that endpoint ask it only when this is on,
 * so it is OFF unless the server sends the literal `true` — the runtimes that
 * leave the question unanswered are exactly the ones that would answer the
 * request with a 404. `'true'` and `1` are payloads a consumer should not teach
 * itself to accept.
 */
describe('runtime-config storageUsage (objectui#11002)', () => {
    it('is OFF before init', () => {
        resetRuntimeConfigForTesting();
        expect(getRuntimeConfig().features.storageUsage).toBe(false);
        expect(isStorageUsageServed()).toBe(false);
    });

    it('is ON when the server sends the literal true', async () => {
        mockConfig({ storageUsage: true });
        await initRuntimeConfig();
        expect(getRuntimeConfig().features.storageUsage).toBe(true);
        expect(isStorageUsageServed()).toBe(true);
    });

    it.each([
        ['absent (a self-hosted runtime)', { marketplace: true, installLocal: false }],
        ['false', { storageUsage: false }],
        ["the string 'true'", { storageUsage: 'true' }],
        ['the number 1', { storageUsage: 1 }],
    ])('is OFF when the key is %s', async (_label, features) => {
        mockConfig(features);
        await initRuntimeConfig();
        expect(getRuntimeConfig().features.storageUsage).toBe(false);
        expect(isStorageUsageServed()).toBe(false);
    });

    it('is OFF when the config fetch itself fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('network down');
        }));
        await initRuntimeConfig();
        expect(isStorageUsageServed()).toBe(false);
    });

    it('withdraws it when a later fetch no longer serves it', async () => {
        mockConfig({ storageUsage: true });
        await initRuntimeConfig();
        expect(isStorageUsageServed()).toBe(true);

        mockConfig({ marketplace: true });
        await initRuntimeConfig();
        expect(isStorageUsageServed()).toBe(false);
    });
});

/**
 * `hideSingleAppSwitcher` — a host's request for no app switcher when the
 * viewer is served one app (objectui#12913). A top-level member of the
 * payload, not a `features` flag: it is how this host wants its chrome drawn,
 * not a capability. ON only when the host sends the literal `true`, and
 * re-derived from each payload, so a runtime that says nothing keeps today's
 * switcher. What the switcher does with it is
 * `layout/__tests__/AppSwitcher.hostSingleApp-12913.test.tsx`'s pin.
 */
function mockPayload(payload: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => payload,
    })) as any);
}

describe('runtime-config hideSingleAppSwitcher (objectui#12913)', () => {
    it('is OFF before init', () => {
        resetRuntimeConfigForTesting();
        expect(getRuntimeConfig().hideSingleAppSwitcher).toBe(false);
        expect(isSingleAppSwitcherHidden()).toBe(false);
    });

    it('is ON when the host sends the literal true', async () => {
        mockPayload({ hideSingleAppSwitcher: true });
        await initRuntimeConfig();
        expect(getRuntimeConfig().hideSingleAppSwitcher).toBe(true);
        expect(isSingleAppSwitcherHidden()).toBe(true);
    });

    it.each([
        ['absent (every runtime that does not ask)', { singleEnvironment: true }],
        ['false', { hideSingleAppSwitcher: false }],
        ["the string 'true'", { hideSingleAppSwitcher: 'true' }],
        ['the number 1', { hideSingleAppSwitcher: 1 }],
        ['nested under features, where it is not read', { features: { hideSingleAppSwitcher: true } }],
    ])('is OFF when the key is %s', async (_label, payload) => {
        mockPayload(payload);
        await initRuntimeConfig();
        expect(getRuntimeConfig().hideSingleAppSwitcher).toBe(false);
        expect(isSingleAppSwitcherHidden()).toBe(false);
    });

    it('is OFF when the config fetch itself fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('network down');
        }));
        await initRuntimeConfig();
        expect(isSingleAppSwitcherHidden()).toBe(false);
    });

    it('withdraws it when a later fetch no longer serves it', async () => {
        mockPayload({ hideSingleAppSwitcher: true });
        await initRuntimeConfig();
        expect(isSingleAppSwitcherHidden()).toBe(true);

        mockPayload({ singleEnvironment: false });
        await initRuntimeConfig();
        expect(isSingleAppSwitcherHidden()).toBe(false);
    });
});

describe('runtime-config platform stage', () => {
    it('defaults to preview before init (badge shows out of the box)', () => {
        resetRuntimeConfigForTesting();
        expect(getPlatformStage()).toBe('preview');
    });

    it('honours an explicit stage from the server (e.g. GA hides the badge)', async () => {
        mockBranding({ stage: 'ga' });
        await initRuntimeConfig();
        expect(getPlatformStage()).toBe('ga');
    });

    it('keeps the preview default when branding omits the stage', async () => {
        mockBranding({ productName: 'Acme' });
        await initRuntimeConfig();
        expect(getRuntimeConfig().branding.productName).toBe('Acme');
        expect(getPlatformStage()).toBe('preview');
    });

    it('ignores an unrecognised stage rather than blanking the badge', async () => {
        mockBranding({ stage: 'nonsense' });
        await initRuntimeConfig();
        expect(getPlatformStage()).toBe('preview');
    });
});


/**
 * `telemetry.errorReporting` — the runtime-served error-reporting sink
 * (objectui#5522 / objectstack#12681, upstream half of cloud#1508).
 *
 * ## Why this suite is stricter than its neighbours above
 *
 * `customDomain` / `sso` withhold a PAID surface and `marketplace` / `aiStudio`
 * deliberately fail OPEN. This one withholds an OUTBOUND THIRD-PARTY REQUEST
 * from inside customer networks: an air-gapped on-prem EE Console was measured
 * sending 14 Sentry envelopes per session to `sentry.io` carrying IP +
 * User-Agent PII. So every "cannot determine the answer" state must land on
 * OFF, and each is pinned separately below rather than represented by one case
 * — they arrive through different code paths (early return, absent block,
 * absent DSN, `catch`) and only their ANSWER is shared.
 *
 * ## This is a mirror, and drift is the risk it is guarding
 *
 * `readClientErrorReporting` in `runtime-config.ts` is a hand copy of the
 * export of the same name from `@objectstack/cloud-connection/telemetry-posture`.
 * That is not a shortcut: this repo has NO dependency on that package (nothing
 * here names it, and neither `@objectstack/spec` nor `@objectstack/client`,
 * which we do pin, re-export it), exactly as `branding` and `features` are
 * mirrored above. No version bump can hand us the shape and no pin lag can
 * withhold it — the only failure mode available is the two readings drifting
 * apart, so the cases below pin the producer's documented semantics verbatim.
 */
function mockBody(body: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => body,
    })) as any);
}

/** A sink shaped exactly as `RuntimeConfigPlugin` serves one. */
const SERVED = {
    dsn: 'https://abc123@o1.ingest.sentry.io/42',
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 0,
};

describe('runtime-config client error-reporting sink', () => {
    it('is ABSENT before init — the state a too-early caller sees', () => {
        resetRuntimeConfigForTesting();
        expect(getClientErrorReporting()).toBeNull();
        expect(getRuntimeConfig().telemetry.errorReporting).toBeUndefined();
    });

    it('is ABSENT on a runtime that predates the key', async () => {
        // The population this exists for: every deployment leaking today runs a
        // server that has never heard of it.
        mockBody({ features: { aiStudio: true }, branding: { productName: 'Acme' } });
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toBeNull();
        // Counter-probe: the payload WAS parsed, so the absence above is the
        // reader answering and not the fetch having quietly done nothing.
        expect(getRuntimeConfig().branding.productName).toBe('Acme');
    });

    it('is ABSENT on a runtime serving only the REPLACED permission boolean', async () => {
        // The landing-order case stated in both PR bodies: an intermediate
        // runtime carrying objectstack#10805's boolean serves no source, so this
        // client reads it as off. No dual-spelling window in either direction.
        mockBody({ telemetry: { allowClientErrorReporting: true } });
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toBeNull();
    });

    it('is ABSENT when the telemetry block is present but empty', async () => {
        // What a runtime that KNOWS the key but has no DSN serves.
        mockBody({ telemetry: {} });
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toBeNull();
    });

    it('is ABSENT when the fetch fails outright', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('air-gapped: no route to control plane');
        }) as any);
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toBeNull();
    });

    it('is ABSENT on a malformed payload', async () => {
        for (const body of [null, 'nonsense', 42, []]) {
            resetRuntimeConfigForTesting();
            mockBody(body);
            await initRuntimeConfig();
            expect(getClientErrorReporting(), `payload ${JSON.stringify(body)} must not configure a sink`).toBeNull();
        }
    });

    it('is ABSENT on every unusable DSN shape', async () => {
        for (const dsn of [undefined, null, '', '   ', 42, {}, []]) {
            resetRuntimeConfigForTesting();
            mockBody({ telemetry: { errorReporting: { dsn } } });
            await initRuntimeConfig();
            expect(getClientErrorReporting(), `dsn ${JSON.stringify(dsn)} must not configure a sink`).toBeNull();
        }
    });

    it('REFUSES a secret-bearing DSN from an untrusted host', async () => {
        // The one shape check this mirror keeps, because its failure mode is a
        // secret published to every browser rather than a misconfiguration. A
        // well-behaved ObjectStack runtime never serves one.
        mockBody({ telemetry: { errorReporting: { dsn: 'https://public:secret@o1.ingest.sentry.io/42' } } });
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toBeNull();
    });

    it('COUNTER-PROBE — is PRESENT when the runtime serves a sink', async () => {
        // Without this every assertion above is satisfied by a reader that is
        // simply stuck returning null, which is the one failure this file cannot
        // otherwise see.
        mockBody({ telemetry: { errorReporting: SERVED } });
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toEqual(SERVED);
    });

    it('carries the whole closed set through, including the environment tag', async () => {
        mockBody({
            telemetry: {
                errorReporting: {
                    ...SERVED,
                    sendDefaultPii: true,
                    environment: 'staging',
                    tracesSampleRate: 0.25,
                    replaysOnErrorSampleRate: 1,
                },
            },
        });
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toEqual({
            dsn: SERVED.dsn,
            sendDefaultPii: true,
            environment: 'staging',
            tracesSampleRate: 0.25,
            replaysOnErrorSampleRate: 1,
        });
    });

    it('requires a real boolean `true` for PII, never a truthy lookalike', async () => {
        // `=== true`, mirroring the producer. `'true'`, `1` and `'yes'` are
        // payloads a consumer should not teach itself to accept.
        for (const value of ['true', 1, 'yes', 'on', {}, []]) {
            resetRuntimeConfigForTesting();
            mockBody({ telemetry: { errorReporting: { ...SERVED, sendDefaultPii: value } } });
            await initRuntimeConfig();
            expect(
                getClientErrorReporting()?.sendDefaultPii,
                `${JSON.stringify(value)} must not enable PII`,
            ).toBe(false);
        }
    });

    it('falls back to the documented default rate on anything out of range', async () => {
        for (const value of ['0.5', 2, -1, NaN, null]) {
            resetRuntimeConfigForTesting();
            mockBody({ telemetry: { errorReporting: { ...SERVED, tracesSampleRate: value } } });
            await initRuntimeConfig();
            expect(
                getClientErrorReporting()?.tracesSampleRate,
                `${JSON.stringify(value)} must not move the rate`,
            ).toBe(0.1);
        }
    });

    it('does NOT accept the sink from the open-ended `features` map', async () => {
        // The producer keeps this in its own namespace precisely because a
        // host's `resolveFeatures` hook merges arbitrary keys into `features`
        // verbatim — so a distribution could otherwise hand out a telemetry
        // endpoint from code whose subject is billing tiers. Pinned on both
        // sides; this is our half.
        mockBody({ features: { errorReporting: SERVED } });
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toBeNull();
    });

    it('withdraws a previous sink when a later fetch no longer carries it', async () => {
        // `telemetry` is REPLACED per payload, not merged like `features` /
        // `branding`. A sink that outlived the response that carried it would
        // let a re-fetch against a withdrawing runtime keep sending.
        mockBody({ telemetry: { errorReporting: SERVED } });
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toEqual(SERVED);

        mockBody({ telemetry: {} });
        await initRuntimeConfig();
        expect(getClientErrorReporting()).toBeNull();
    });
});
