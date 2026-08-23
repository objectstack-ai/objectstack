// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11235 — the `version` field `getDiscovery()` serves must be DERIVED: an
 * injected `OS_RUNTIME_VERSION` stamp, falling back to the resolved
 * `@objectstack/metadata-protocol` package version — never the `'1.0'` literal
 * this producer hardcoded before the fix, and never any other constant.
 *
 * ## What these cases are built to catch, and why they are shaped this way
 *
 * The regression this file exists to prevent is a literal creeping back into
 * the producer. A test that asserts one specific expected string is weak
 * against exactly that: whoever restores a literal only has to restore the
 * string the test names. So the load-bearing case here
 * ("tracks the stamp across two distinct values") asserts a PROPERTY no
 * constant can satisfy — that two different injected stamps produce two
 * different served values — and it names no expected string at all. The
 * value-level cases sit beside it for the more ordinary failure (the stamp is
 * read but mangled), not in place of it.
 *
 * Every assertion drives the REAL `ObjectStackProtocolImplementation
 * .getDiscovery()` path, never `resolveDiscoveryVersion()` in isolation and
 * never the source text: a fix that stops being wired into the producer has to
 * fail here. That is the same anti-vacuity requirement #10993's sibling test
 * (`packages/runtime/src/http-dispatcher.runtime-version.test.ts`) states, and
 * this file is deliberately its counterpart one package over.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { ObjectStackProtocolImplementation } from './index.js';

/**
 * The real fallback value, read the same way `resolveDiscoveryVersion()` reads
 * it — so this assertion tracks the production code instead of independently
 * guessing a version string that would drift from it at the next release.
 */
const PACKAGE_VERSION = (
    createRequire(import.meta.url)('../package.json') as { version: string }
).version;

/**
 * A protocol impl over a minimal engine — the harness
 * `discovery-schema-conformance.test.ts` already uses in this package.
 * `getDiscovery()` reads `engine.registry`, `engine.transaction` and the
 * services registry; nothing here touches `version`, which is the point.
 */
function makeImpl() {
    const engine = {
        registry: {
            getObject: (_name: string) => undefined,
            getRegisteredTypes: () => [],
        },
    };
    return new ObjectStackProtocolImplementation(engine as any, () => new Map());
}

async function servedVersion(): Promise<unknown> {
    const discovery: any = await makeImpl().getDiscovery();
    return discovery.version;
}

describe('[#11235] getDiscovery() serves a DERIVED `version`, not a literal', () => {
    const ORIGINAL_STAMP = process.env.OS_RUNTIME_VERSION;

    afterEach(() => {
        if (ORIGINAL_STAMP === undefined) delete process.env.OS_RUNTIME_VERSION;
        else process.env.OS_RUNTIME_VERSION = ORIGINAL_STAMP;
    });

    // Values with no plausible relationship to '1.0', '1.0.0' or the package
    // version — anything else served back would prove the producer is not
    // actually reading the injected stamp.
    const STAMP_A = 'stamp-a-6d1e0b4-issue11235-could-not-be-a-coincidence';
    const STAMP_B = 'stamp-b-c72f593-issue11235-could-not-be-a-coincidence';

    it('serves the injected OS_RUNTIME_VERSION stamp verbatim', async () => {
        process.env.OS_RUNTIME_VERSION = STAMP_A;

        expect(await servedVersion()).toBe(STAMP_A);
    });

    it('TRACKS the stamp across two distinct values — a constant cannot do this', async () => {
        // The anti-literal pin. It names no expected string: it asserts only
        // that the served value FOLLOWS its source. Restoring `version: '1.0'`
        // — or any other hardcode — fails this case no matter which string the
        // hardcode picks, which is precisely what a specific-string assertion
        // cannot promise.
        process.env.OS_RUNTIME_VERSION = STAMP_A;
        const first = await servedVersion();

        process.env.OS_RUNTIME_VERSION = STAMP_B;
        const second = await servedVersion();

        expect(first).not.toBe(second);
        expect(first).toBe(STAMP_A);
        expect(second).toBe(STAMP_B);
    });

    it('falls back to the resolved package version — not a literal, not undefined — when no stamp is injected', async () => {
        delete process.env.OS_RUNTIME_VERSION;

        const version = await servedVersion();

        expect(version).toBe(PACKAGE_VERSION);
        expect(version).not.toBeUndefined();
        // The two literals this defect family produced, named so a restoration
        // of EITHER is caught here as well as by the tracking case above:
        // `'1.0'` was this producer's, `'1.0.0'` the runtime dispatcher's
        // (#10993). Their disagreement is the evidence neither was a contract
        // value.
        expect(version).not.toBe('1.0');
        expect(version).not.toBe('1.0.0');
    });

    it('reports the fallback as a real, non-empty identity string', async () => {
        delete process.env.OS_RUNTIME_VERSION;

        const version = await servedVersion();

        expect(typeof version).toBe('string');
        expect((version as string).length).toBeGreaterThan(0);
        // `'unknown'` is the honest last resort when the package's own
        // `package.json` cannot be read. In this repo it always can be, so
        // seeing it here would mean the resolver's read path is broken —
        // failing loudly instead of passing on a plausible-looking string.
        expect(version).not.toBe('unknown');
    });
});
