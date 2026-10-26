// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Load-failure vs validation-error gate.
 *
 * Regression: when the layered/draft fetch fails (network/500/timeout) the
 * editor renders the form on empty defaults and the client Zod validator
 * fires "name/label/regions required" — making a transport failure look like
 * a structurally broken item. `shouldRenderDiagnostics` suppresses the
 * validation-diagnostics banner whenever the load failed, so only the
 * explicit "failed to load" error banner shows.
 */

import { describe, it, expect } from 'vitest';
import { shouldRenderDiagnostics } from './ResourceEditPage';

describe('shouldRenderDiagnostics — load-failure suppression', () => {
  it('suppresses the diagnostics banner when the load failed, even with a client validator', () => {
    // The bug: a failed load + a type that has a client validator would
    // otherwise surface spurious required-field issues.
    expect(
      shouldRenderDiagnostics({
        loadFailed: true,
        hasDiag: false,
        hasClientValidator: true,
      }),
    ).toBe(false);
  });

  it('suppresses the diagnostics banner on load failure even when server diagnostics are present', () => {
    expect(
      shouldRenderDiagnostics({
        loadFailed: true,
        hasDiag: true,
        hasClientValidator: true,
      }),
    ).toBe(false);
  });

  it('renders diagnostics for a genuinely-invalid item that DID load (client validator)', () => {
    // Happy path unaffected: a real validation problem on a loaded item
    // still shows.
    expect(
      shouldRenderDiagnostics({
        loadFailed: false,
        hasDiag: false,
        hasClientValidator: true,
      }),
    ).toBe(true);
  });

  it('renders diagnostics for a loaded item with server-computed diagnostics', () => {
    expect(
      shouldRenderDiagnostics({
        loadFailed: false,
        hasDiag: true,
        hasClientValidator: false,
      }),
    ).toBe(true);
  });

  it('renders nothing when there is no diagnostics source at all', () => {
    expect(
      shouldRenderDiagnostics({
        loadFailed: false,
        hasDiag: false,
        hasClientValidator: false,
      }),
    ).toBe(false);
  });
});
