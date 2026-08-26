// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { RestApiConfigSchema, DiscoverySchema } from '@objectstack/spec/api';
import type { StandaloneStackResult } from '@objectstack/runtime';
import { mergeBootConfig } from './merge-boot-config.js';

/**
 * What `createStandaloneStack()` actually returns for the `api` block.
 *
 * Annotated with the producer's own declared literal type rather than left as
 * a bare `as const`, so this stops being a HAND-COPY that can drift from the
 * thing it claims to mirror. A copy is precisely how #11999 survived: this
 * constant, `merge-boot-config.ts`'s doc block and
 * `StandaloneStackResult.api` each spelled the value separately, and nothing
 * held them equal. Change the runtime's literal without changing this line
 * and `tsc --noEmit` fails here — `packages/cli`'s `typecheck` compiles
 * `include: ["src"]` with no test exclusion, so this pin is live (the build
 * tsconfig excludes tests, this one does not).
 */
const BOOT_API: StandaloneStackResult['api'] = { enableProjectScoping: false, projectResolution: 'auto' };

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
        expect(merged.api.projectResolution).toBe('auto');
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

/**
 * [#11999] The check that did not exist — and whose absence is the whole
 * reason three packages disagreed about `api.projectResolution`'s vocabulary
 * for as long as nothing executed the schema.
 *
 * `@objectstack/spec` declared `z.enum(['required','optional','auto'])`,
 * `@objectstack/runtime` shipped `'none'`, and `os serve` forwarded it
 * unchanged (`apiConfig.projectResolution ?? 'auto'` never fires — `'none'`
 * is not nullish). `RestServer` CAST this config instead of parsing it, so
 * the enum never ran on any deployment path; downstream, every reader that
 * acts on the key is gated on `enableProjectScoping` first, so `'none'`
 * silently took `'auto'`'s branch without ever being named as such.
 *
 * These cases run the declared schema against the value this package
 * actually boots with, which is the one thing none of the three did.
 */
describe('[#11999] the boot api block is a DECLARED config, not just a working one', () => {
    it('parses clean against RestApiConfigSchema', () => {
        const parsed = RestApiConfigSchema.parse({ ...BOOT_API });
        expect(parsed.enableProjectScoping).toBe(false);
        expect(parsed.projectResolution).toBe('auto');
    });

    it('still parses after the merge — the block `serve` actually forwards', () => {
        // Parsing BOOT_API alone would not cover the seam: what reaches
        // `createRestApiPlugin` and the Dispatcher plugin is the MERGED api
        // block, so an authored key surviving the merge must not break it.
        const merged: any = mergeBootConfig(
            { api: { enforceProjectMembership: false } },
            { api: { ...BOOT_API }, plugins: [] },
        );
        const parsed = RestApiConfigSchema.parse(merged.api);
        expect(parsed.projectResolution).toBe('auto');
    });

    it('REFUSES the undeclared `none` this shipped before #11999', () => {
        // A pin is only worth having if it can say no, so the negative is
        // asserted here rather than trusted. Asserted on the refusal's
        // identity — the offending path and the issue code — not on the bare
        // fact that something failed: a `safeParse` that went false for an
        // unrelated key would otherwise read as this case passing.
        const r = RestApiConfigSchema.safeParse({ ...BOOT_API, projectResolution: 'none' });
        expect(r.success).toBe(false);
        const issue = r.success ? undefined : r.error.issues.find(
            (i) => i.path.join('.') === 'projectResolution',
        );
        expect(issue?.code).toBe('invalid_value');
        expect(issue?.message).toContain('auto');
    });

    it('is a value the DISCOVERY advertisement may also carry', () => {
        // The second declared contract this key answers to, and the reason
        // `enableProjectScoping: false` does NOT make the value moot.
        // `RestServer`'s discovery handler copies `api.projectResolution`
        // into `discovery.scoping.resolution` UNCONDITIONALLY — no
        // `enableProjectScoping` guard — and `DiscoverySchema` declares that
        // field as the same three-member enum. Shipping `'none'` therefore
        // published a discovery payload the platform's own schema rejects, on
        // every `os serve` boot.
        const scoping = { enabled: BOOT_API.enableProjectScoping, resolution: BOOT_API.projectResolution, scoped: false };
        const field = DiscoverySchema.shape.scoping.unwrap().shape.resolution;
        expect(field.safeParse(scoping.resolution).success).toBe(true);
        expect(field.safeParse('none').success).toBe(false);
    });
});
