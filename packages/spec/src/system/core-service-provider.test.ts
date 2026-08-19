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

    // ['workflow', 'graphql'] left this list in #4451 (v17): the workflow slot
    // was retired outright, and graphql was never a CoreServiceName — its
    // stray entry here named a surface the dispatcher had already removed.
    it('uses null — not a plausible name — where no package can be installed', () => {
        for (const slot of ['ai', 'search']) {
            expect(CORE_SERVICE_PROVIDER[slot], `${slot} must name no installable package`).toBeNull();
        }
    });

    it('carries no entry for retired or never-real slots (#4451)', () => {
        for (const slot of ['workflow', 'graphql']) {
            expect(
                Object.prototype.hasOwnProperty.call(CORE_SERVICE_PROVIDER, slot),
                `${slot} must have no entry`,
            ).toBe(false);
        }
    });

    // `null` covers two different situations, and only one of them means
    // "nothing exists". Verified against objectstack-ai/cloud: nothing there
    // registers search, but `@objectstack/service-ai` does register `ai` — it
    // is simply `private: true`, so there is no package to install and no
    // name that belongs in an "Install X" sentence.
    it('still says something ships for a slot whose provider is real but uninstallable', () => {
        const ai = serviceUnavailableMessage('ai');
        expect(ai).not.toMatch(/No implementation ships/);
        expect(ai).toContain('@objectstack/service-ai');
        expect(ai).toMatch(/Cloud\/Enterprise/);
        // Still not an instruction a reader could act on and fail at.
        expect(ai).not.toMatch(/^Install /);

        // The genuinely-empty slot keeps the plain sentence.
        expect(serviceUnavailableMessage('search')).toMatch(/No implementation ships/);
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
        expect(serviceUnavailableMessage('storage')).toBe('Install @objectstack/service-storage to enable');
        // Deprecated v17 alias of `storage` (#9683) — same provider, same remedy.
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
