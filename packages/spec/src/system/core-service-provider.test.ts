// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { CoreServiceName, CORE_SERVICE_PROVIDER, serviceUnavailableMessage } from './core-services.zod';

/**
 * [#4093 follow-up] Discovery tells a consumer two things about an absent
 * capability: that it is absent, and what to do about it. The first has been
 * carefully honest since #2462/#4000. The second was invented from the slot
 * name — `Install a ${slot} plugin to enable` in the dispatcher, and a
 * hand-written table in metadata-protocol where ten of fifteen names were not
 * real packages. These pin the remedy to reality.
 *
 * `scripts/check-service-providers.mjs` is the other half: it fails CI when a
 * name here stops being a workspace package. This file pins the SHAPE of the
 * answer; the script pins its TRUTH against the filesystem.
 */
describe('CORE_SERVICE_PROVIDER', () => {
    it('never names a package derived from the slot name alone', () => {
        // The entry that proves the rule: nothing about "notification" suggests
        // "messaging", so any name-derived guess is wrong here by construction.
        expect(CORE_SERVICE_PROVIDER['notification']).toBe('@objectstack/service-messaging');
    });

    it('uses null — not a plausible name — for slots nothing implements', () => {
        for (const slot of ['ai', 'search', 'workflow', 'graphql']) {
            expect(CORE_SERVICE_PROVIDER[slot], `${slot} must have no provider`).toBeNull();
        }
    });

    it('scopes every named package, so the remedy is copy-pasteable', () => {
        for (const [slot, pkg] of Object.entries(CORE_SERVICE_PROVIDER)) {
            if (pkg === null) continue;
            expect(pkg, `${slot} provider`).toMatch(/^@objectstack\//);
        }
    });

    it('covers every core slot that can be filled by an installable package', () => {
        // `data` and `metadata` come from the engine itself, never from an
        // optional package, so they carry no remedy.
        const engineOwned = new Set(['data', 'metadata']);
        for (const slot of CoreServiceName.options) {
            if (engineOwned.has(slot)) continue;
            expect(
                Object.prototype.hasOwnProperty.call(CORE_SERVICE_PROVIDER, slot),
                `${slot} must have an entry (even if null)`,
            ).toBe(true);
        }
    });
});

describe('serviceUnavailableMessage', () => {
    it('names the package to install when one exists', () => {
        expect(serviceUnavailableMessage('auth')).toBe('Install @objectstack/plugin-auth to enable');
        expect(serviceUnavailableMessage('file-storage')).toBe('Install @objectstack/service-storage to enable');
    });

    it('says nothing ships rather than naming a package that cannot be installed', () => {
        const msg = serviceUnavailableMessage('search');
        expect(msg).not.toMatch(/Install/);
        expect(msg).toContain("'search'");
        // The old template produced exactly this — a package that never existed.
        expect(msg).not.toContain('search plugin');
    });

    it('treats an unknown slot as "nothing ships", never inventing a name', () => {
        const msg = serviceUnavailableMessage('not-a-real-slot');
        expect(msg).not.toMatch(/Install/);
    });
});
