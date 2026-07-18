import { describe, expect, it } from 'vitest';
import Serve from '../src/commands/serve.js';

// #1597 — optional-plugin loading is INTENT-driven: an app that declares it
// REQUIRES a capability fails fast when the provider package is missing, while a
// package that is merely present (but undeclared) never auto-enables a feature.
// The decision itself lives in two pure static helpers so it is unit-testable
// without booting a kernel; the boot path is a thin mapping over them.

describe('Serve.resolveOptionalPluginLoad — intent-driven optional-plugin gating (#1597)', () => {
  it('tier deny wins over everything: tierAllowed=false ⇒ off', () => {
    // The tier is the orthogonal DENY — a Community-Edition deployment whose
    // `tiers` omit the feature never loads it, whatever the intent or presence.
    for (const required of [true, false]) {
      for (const declared of [true, false]) {
        expect(
          Serve.resolveOptionalPluginLoad({ tierAllowed: false, required, declared }),
        ).toBe('off');
      }
    }
  });

  it('explicit requirement ⇒ required (fail-fast), even without the package declared', () => {
    // This is the bug the issue targets: an app that genuinely requires AI but
    // ships without the package must NOT boot silently degraded.
    expect(
      Serve.resolveOptionalPluginLoad({ tierAllowed: true, required: true, declared: false }),
    ).toBe('required');
  });

  it('required takes precedence over mere declaration', () => {
    expect(
      Serve.resolveOptionalPluginLoad({ tierAllowed: true, required: true, declared: true }),
    ).toBe('required');
  });

  it('declared-but-not-required ⇒ auto (opt-in convenience, best-effort)', () => {
    expect(
      Serve.resolveOptionalPluginLoad({ tierAllowed: true, required: false, declared: true }),
    ).toBe('auto');
  });

  it('neither declared nor required ⇒ off (skip with NO speculative import)', () => {
    // Presence is never the enable signal on its own; an app that declares
    // nothing gets nothing — this is the control-plane host clean-boot path.
    expect(
      Serve.resolveOptionalPluginLoad({ tierAllowed: true, required: false, declared: false }),
    ).toBe('off');
  });
});

describe('Serve.isModuleNotFoundError — missing-vs-crashed classification (#1595 regression guard)', () => {
  it('detects the ESM "Cannot find package" shape by err.code (the #1595 bug)', () => {
    // ESM throws `Cannot find package '...'` with the code on err.code — matching
    // only the older "Cannot find module" string mis-classified this as a crash
    // and logged a scary boot error on control-plane hosts.
    const err = Object.assign(
      new Error("Cannot find package '@objectstack/service-ai-studio' imported from /app"),
      { code: 'ERR_MODULE_NOT_FOUND' },
    );
    expect(Serve.isModuleNotFoundError(err)).toBe(true);
  });

  it('detects the classic CJS "Cannot find module" message and code', () => {
    expect(
      Serve.isModuleNotFoundError(
        Object.assign(new Error("Cannot find module 'x'"), { code: 'MODULE_NOT_FOUND' }),
      ),
    ).toBe(true);
    // message-only (no code) still classifies as missing
    expect(Serve.isModuleNotFoundError(new Error("Cannot find module 'x'"))).toBe(true);
  });

  it('a real crash (package present but throwing) is NOT missing', () => {
    expect(Serve.isModuleNotFoundError(new TypeError('undefined is not a function'))).toBe(false);
    expect(Serve.isModuleNotFoundError(new Error('boom during construction'))).toBe(false);
  });

  it('tolerates non-Error throwables', () => {
    expect(Serve.isModuleNotFoundError(undefined)).toBe(false);
    expect(Serve.isModuleNotFoundError(null)).toBe(false);
    expect(Serve.isModuleNotFoundError('Cannot find package "x"')).toBe(true);
    expect(Serve.isModuleNotFoundError('some other string')).toBe(false);
  });
});
