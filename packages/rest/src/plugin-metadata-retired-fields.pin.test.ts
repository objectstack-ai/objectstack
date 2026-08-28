// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// COMPILE-TIME pins for the ADR-0049 retirements on the PUBLISHED
// `PluginMetadata` surface of `@objectstack/core` (#11982 `configSchema`,
// #12587 `hotReloadable`), recorded in ADR-0025 §3.7.
//
// Why the pins live in THIS package: `@objectstack/core` has no `typecheck`
// script (it is a type-check DEBT ledger entry), so a `@ts-expect-error` there
// is a phantom pin — no tsc program a `typecheck` script runs ever evaluates
// it, and `check:type-check-coverage` refuses it. This package's
// `tsconfig.test.json` program IS run by its `typecheck` script
// (`check:test-typecheck`, EXACT per-file ratchet: an unlisted file must stay
// at zero errors), and it resolves `@objectstack/core` to the BUILT
// `dist/index.d.ts` — so these directives pin the contract consumers actually
// see. This package is also the retirement's worked replacement: the REST
// server parses its own config at its own seam (#11637,
// `rest-config-parse-not-cast.test.ts`) precisely because the kernel-side
// validator could never run.
//
// Failure channel, proven able to fail by ablation on the retirement PR:
// re-adding a retired field to `PluginMetadata` (and rebuilding core's dist)
// turns the matching directive into TS2578 "Unused '@ts-expect-error'
// directive", giving this file 1 error where the ratchet requires 0.
//
// Positive control: the `startupTimeout` literal below is a LIVE field (read
// by the kernel's startup timeout guard) and must keep compiling with no
// directive — proving the interface still accepts its real members, so the
// directives above it are readings, not a broken instrument.

import { describe, it, expect } from 'vitest';
import type { PluginMetadata } from '@objectstack/core';

describe('PluginMetadata retired fields — published-surface pins (ADR-0049, ADR-0025 §3.7)', () => {
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
        // directive above, enforced by this package's test-typecheck program.
        expect(declared.name).toBe('retired-configschema-pin');
    });

    it('compile-time: a declared hotReloadable no longer type-checks (#12587)', () => {
        const declared: PluginMetadata = {
            name: 'retired-hotreloadable-pin',
            version: '1.0.0',
            // @ts-expect-error — `hotReloadable` was retired under ADR-0049
            // (#12587): nothing ever read it. Reload participation is governed
            // solely by `HotReloadManager.registerReloadConfig`.
            hotReloadable: false,
            async init() {},
        };
        expect(declared.name).toBe('retired-hotreloadable-pin');
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
