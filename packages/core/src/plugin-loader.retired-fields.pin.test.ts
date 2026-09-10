// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// RUNTIME pins for the ADR-0049 retirements on `PluginMetadata` (#11982,
// #12587), recorded in ADR-0025 §3.7: the security barrel must not publish the
// retired validator again. These fail in `pnpm --filter @objectstack/core test`
// the moment the export returns.
//
// The COMPILE-TIME half — a declared `configSchema` / `hotReloadable` no
// longer type-checks against the published `PluginMetadata` — lives in
// `packages/rest/src/plugin-metadata-retired-fields.pin.test.ts`, deliberately
// NOT here. The rest package's `tsconfig.test.json` program is compiled by its
// `typecheck` script and resolves `@objectstack/core` to core's BUILT
// `dist/index.d.ts`, so the pin over there guards the published contract
// itself.
//
// ⚠️ This used to read as though the split were forced — that
// `@objectstack/core` "has no `typecheck` script (type-check DEBT ledger
// entry)", making a `@ts-expect-error` here a phantom pin
// `check:type-check-coverage` refuses. False on this tree in BOTH halves:
// #14613 split a `tsconfig.test.json` out of the build config,
// `package.json`'s `typecheck` NAMES it (via `check:test-typecheck
// --project`), and this package holds no DEBT entry. A directive here WOULD be
// evaluated — against `./plugin-loader.ts`, this package's own SOURCE, which
// `tsc --listFiles` puts in that program alongside ZERO files under
// `packages/core/dist/`. The published `.d.ts` is what these pins are about
// and only the rest program reads it, which is a reason that outlives any
// package's script list.

import { describe, it, expect } from 'vitest';
import * as securityBarrel from './security/index.js';

describe('PluginConfigValidator retirement (ADR-0049, ADR-0025 §3.7)', () => {
    it('no longer publishes PluginConfigValidator from the security barrel (#11982)', () => {
        expect((securityBarrel as Record<string, unknown>).PluginConfigValidator).toBeUndefined();
        expect((securityBarrel as Record<string, unknown>).createPluginConfigValidator).toBeUndefined();
        expect(Object.keys(securityBarrel)).not.toContain('PluginConfigValidator');
        expect(Object.keys(securityBarrel)).not.toContain('createPluginConfigValidator');
    });

    it('positive control: the barrel still publishes its live siblings', () => {
        // Proves the absence assertions above read a populated namespace, not
        // an accidentally-empty import.
        expect(Object.keys(securityBarrel)).toContain('PluginSignatureVerifier');
        expect(Object.keys(securityBarrel)).toContain('PluginPermissionEnforcer');
    });
});
