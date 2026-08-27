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
// NOT here: `@objectstack/core` has no `typecheck` script (type-check DEBT
// ledger entry), so a `@ts-expect-error` in this package is a phantom pin no
// tsc program a `typecheck` script runs would ever evaluate —
// `check:type-check-coverage` refuses exactly that. The rest package's
// `tsconfig.test.json` program is compiled by its `typecheck` script and reads
// core's BUILT `.d.ts`, so the pin over there guards the published contract
// itself.

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
