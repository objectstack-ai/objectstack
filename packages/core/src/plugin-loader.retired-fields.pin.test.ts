// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins for the ADR-0049 retirements on `PluginMetadata` (#11982), recorded in
// ADR-0025 §3.7.
//
// Two instruments, deliberately different:
//
// 1. COMPILE-TIME pins — the `@ts-expect-error` directives below. Their
//    failure channel is `tsc --noEmit` on this package, which CI runs through
//    the type-check DEBT ratchet (`pnpm check:type-check-coverage`;
//    `@objectstack/core` is a DEBT entry, growth is red). Re-adding a retired
//    field turns each satisfied directive into an "Unused '@ts-expect-error'"
//    error, growing the measured count past the ledger — proven able to fail
//    by ablation on the retirement PR.
// 2. RUNTIME pins — vitest assertions that the security barrel no longer
//    publishes the retired validator. These fail in `pnpm --filter
//    @objectstack/core test` the moment the export returns.
//
// Positive control (compile-time): the `startupTimeout` literal below is a
// LIVE field (read at kernel.ts `startPluginWithTimeout`) and must keep
// compiling with no directive — proving the interface still accepts its real
// members, so the directives above it are readings, not a broken instrument.

import { describe, it, expect } from 'vitest';
import type { PluginMetadata } from './plugin-loader.js';
import * as securityBarrel from './security/index.js';

describe('PluginMetadata retired fields (ADR-0049, ADR-0025 §3.7)', () => {
    it('no longer publishes PluginConfigValidator from the security barrel (#11982)', () => {
        expect((securityBarrel as Record<string, unknown>).PluginConfigValidator).toBeUndefined();
        expect((securityBarrel as Record<string, unknown>).createPluginConfigValidator).toBeUndefined();
        expect(Object.keys(securityBarrel)).not.toContain('PluginConfigValidator');
        expect(Object.keys(securityBarrel)).not.toContain('createPluginConfigValidator');
    });

    it('compile-time: a declared configSchema no longer type-checks (#11982)', () => {
        const declared: PluginMetadata = {
            name: 'retired-configschema-pin',
            version: '1.0.0',
            // @ts-expect-error — `configSchema` was retired under ADR-0049
            // (#11982): the kernel never received a config to validate it
            // against. Parse plugin config at the plugin's own seam instead.
            configSchema: { parse: (v: unknown) => v },
            async init() {},
        };
        // The value exists at runtime (TS types are erased); the pin is the
        // directive above, enforced by tsc through the DEBT ratchet.
        expect(declared.name).toBe('retired-configschema-pin');
    });

    it('positive control: live sibling fields still type-check with no directive', () => {
        const control: PluginMetadata = {
            name: 'live-sibling-control',
            version: '1.0.0',
            startupTimeout: 1000,
            async init() {},
        };
        expect(control.startupTimeout).toBe(1000);
    });
});
