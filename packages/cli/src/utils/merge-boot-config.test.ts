// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { mergeBootConfig } from './merge-boot-config.js';

/** What `createStandaloneStack()` actually returns for the `api` block. */
const BOOT_API = { enableProjectScoping: false, projectResolution: 'none' } as const;

describe('mergeBootConfig (#4002)', () => {
    it('keeps an authored api key the boot result does not set', () => {
        const merged: any = mergeBootConfig(
            { api: { enforceProjectMembership: false } },
            { api: { ...BOOT_API }, plugins: [] },
        );

        // `enforceProjectMembership` is a live knob the CLI reads a few lines
        // later — dropped by the old shallow spread, kept by the per-key merge.
        expect(merged.api.enforceProjectMembership).toBe(false);
    });

    it('lets the boot result win on the keys it decides', () => {
        // Environment scoping is not the author's call on a standalone host.
        const merged: any = mergeBootConfig(
            { api: { enableProjectScoping: true, projectResolution: 'auto', enforceProjectMembership: false } },
            { api: { ...BOOT_API } },
        );

        expect(merged.api.enableProjectScoping).toBe(false);
        expect(merged.api.projectResolution).toBe('none');
        expect(merged.api.enforceProjectMembership).toBe(false); // untouched by boot → survives
    });

    it('still replaces every other top-level key wholesale', () => {
        // The artifact-serve path deliberately serves the boot result's objects /
        // permissions / plugins, so those keep the previous semantics.
        const merged: any = mergeBootConfig(
            { objects: [{ name: 'authored' }], plugins: ['authored'] },
            { objects: [{ name: 'from_artifact' }], plugins: ['from_boot'] },
        );

        expect(merged.objects).toEqual([{ name: 'from_artifact' }]);
        expect(merged.plugins).toEqual(['from_boot']);
    });

    it('does not invent an api block when neither side has one', () => {
        const merged: any = mergeBootConfig({ objects: [] }, { plugins: [] });
        expect('api' in merged).toBe(false);
    });

    it('carries an api block through when only one side has one', () => {
        expect((mergeBootConfig({ api: { enforceProjectMembership: false } }, {}) as any).api)
            .toEqual({ enforceProjectMembership: false });
        expect((mergeBootConfig({}, { api: { ...BOOT_API } }) as any).api)
            .toEqual({ ...BOOT_API });
    });

    it('ignores a non-object api on either side rather than spreading it', () => {
        // Defensive: a malformed authored `api` must not throw or produce
        // character-indexed keys from a string spread.
        expect((mergeBootConfig({ api: 'nonsense' as any }, { api: { ...BOOT_API } }) as any).api)
            .toEqual({ ...BOOT_API });
        expect((mergeBootConfig({ api: { enforceProjectMembership: false } }, { api: null as any }) as any).api)
            .toEqual({ enforceProjectMembership: false });
    });

    it('does not mutate either input', () => {
        const authored = { api: { enforceProjectMembership: false } };
        const boot = { api: { ...BOOT_API } };
        mergeBootConfig(authored, boot);

        expect(authored).toEqual({ api: { enforceProjectMembership: false } });
        expect(boot).toEqual({ api: { ...BOOT_API } });
    });
});
