// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10993 — `version` on `GET /health` and in the discovery payload
 * (`registerBuiltinDomains()` / `getDiscoveryInfo()` in `./http-dispatcher.ts`)
 * must be DERIVED: an injected `OS_RUNTIME_VERSION` stamp, falling back to
 * the resolved `@objectstack/runtime` package version — never the `'1.0.0'`
 * literal both sites hardcoded before this fix.
 *
 * Every assertion here drives the REAL `HttpDispatcher.dispatch()` path
 * (never the source text or `resolveRuntimeVersion()` in isolation), so it
 * fails if either handler stops actually reading the derived value — the
 * anti-vacuity requirement #10993 calls out by name. A reverse-verification
 * pass (temporarily restoring the `'1.0.0'` literal on both sites) confirmed
 * this file goes red at exactly that restoration and names the failing site
 * — see the PR description for the transcript; that step is deliberately
 * NOT encoded as a test here, since a test cannot un-revert itself mid-run.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { HttpDispatcher } from './http-dispatcher';
import { ObjectKernel } from '@objectstack/core';

/**
 * The real fallback value, read the same way `resolveRuntimeVersion()` reads
 * it — so this assertion tracks the production code instead of independently
 * guessing a version string that could drift from it.
 */
const RUNTIME_PACKAGE_VERSION = (
    createRequire(import.meta.url)('../package.json') as { version: string }
).version;

function newDispatcher(): HttpDispatcher {
    const kernel = {
        services: {},
        context: { getService: vi.fn() },
    } as unknown as ObjectKernel;
    return new HttpDispatcher(kernel);
}

async function healthVersion(dispatcher: HttpDispatcher): Promise<unknown> {
    const res = await dispatcher.dispatch('GET', '/health', undefined, undefined, {} as any);
    return res.response?.body?.data?.version;
}

async function discoveryVersion(dispatcher: HttpDispatcher): Promise<unknown> {
    const res = await dispatcher.dispatch('GET', '/discovery', undefined, {}, {} as any);
    return res.response?.body?.data?.version;
}

describe('HttpDispatcher — served `version` is derived, not a literal (#10993)', () => {
    const ORIGINAL_STAMP = process.env.OS_RUNTIME_VERSION;

    afterEach(() => {
        if (ORIGINAL_STAMP === undefined) delete process.env.OS_RUNTIME_VERSION;
        else process.env.OS_RUNTIME_VERSION = ORIGINAL_STAMP;
    });

    // A value with no plausible relationship to '1.0.0' or the package
    // version — if either handler answered anything else, it would prove
    // the handler is not actually reading the injected stamp.
    const INJECTED_STAMP = 'stamp-9f3c7a1-cloud1537-could-not-be-a-coincidence';

    it('serves the injected OS_RUNTIME_VERSION stamp verbatim on /health', async () => {
        process.env.OS_RUNTIME_VERSION = INJECTED_STAMP;
        const dispatcher = newDispatcher();

        expect(await healthVersion(dispatcher)).toBe(INJECTED_STAMP);
    });

    it('serves the SAME injected stamp on the discovery payload — one derived source, two callers', async () => {
        process.env.OS_RUNTIME_VERSION = INJECTED_STAMP;
        const dispatcher = newDispatcher();

        expect(await discoveryVersion(dispatcher)).toBe(INJECTED_STAMP);
    });

    it('falls back to the resolved package version — not a literal, not undefined — when no stamp is injected', async () => {
        delete process.env.OS_RUNTIME_VERSION;
        const dispatcher = newDispatcher();

        const health = await healthVersion(dispatcher);
        const discovery = await discoveryVersion(dispatcher);

        expect(health).toBe(RUNTIME_PACKAGE_VERSION);
        expect(discovery).toBe(RUNTIME_PACKAGE_VERSION);
        expect(health).not.toBe('1.0.0');
        expect(health).not.toBeUndefined();
    });

    it('resolves the stamp/fallback ONCE at construction — a later env change does not retroactively affect an already-constructed dispatcher', async () => {
        delete process.env.OS_RUNTIME_VERSION;
        const dispatcher = newDispatcher();
        expect(await healthVersion(dispatcher)).toBe(RUNTIME_PACKAGE_VERSION);

        process.env.OS_RUNTIME_VERSION = 'late-stamp-must-not-apply-to-the-existing-instance';
        expect(await healthVersion(dispatcher)).toBe(RUNTIME_PACKAGE_VERSION);

        // A freshly constructed dispatcher DOES pick up the now-set stamp —
        // confirms the previous assertion is about construction-time
        // resolution, not about the stamp never being read at all.
        expect(await healthVersion(newDispatcher())).toBe('late-stamp-must-not-apply-to-the-existing-instance');
    });
});
