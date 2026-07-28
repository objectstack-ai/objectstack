// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { lowerCallables } from './lower-callables.js';

// ── #3713: `target` vs the deprecated `execute` alias — one precedence, one slot ──
//
// `execute` is the deprecated alias of `target`. Before this was aligned, three
// readers resolved "the author declared both" in two directions: the spec
// transform kept `target`, objectui's ActionRunner did `execute || target`, and
// THIS compile step preferred `execute`. The compile-step half was the nastiest:
// it bundled the `execute` function and then overwrote `action.target` with the
// resulting ref, so the function the author actually declared on `target` was
// silently dropped from the build.
describe('lowerCallables — action handler slot precedence (#3713)', () => {
  const actionsOf = (result: { lowered: Record<string, unknown> }) =>
    (result.lowered as { actions: Array<Record<string, unknown>> }).actions;

  it('binds the canonical `target` function when both slots carry a callable', () => {
    const result = lowerCallables({
      actions: [{
        name: 'convert',
        label: 'Convert',
        type: 'script',
        target: function preferredHandler() { return 'preferred'; },
        execute: function legacyHandler() { return 'legacy'; },
      }],
    });

    const [action] = actionsOf(result);
    const ref = action.target as string;
    expect(typeof ref).toBe('string');
    // The bundled function must be the one from `target`, not from `execute`.
    expect(result.functions[ref]()).toBe('preferred');
    expect(Object.values(result.functions).map((fn) => fn())).not.toContain('legacy');
  });

  it('drops the `execute` alias once a ref is bound to `target`', () => {
    const result = lowerCallables({
      actions: [{
        name: 'convert',
        label: 'Convert',
        type: 'script',
        target: function preferredHandler() { return 'preferred'; },
        execute: function legacyHandler() { return 'legacy'; },
      }],
    });

    const [action] = actionsOf(result);
    // A leftover alias is stale by construction — and a function-valued one
    // would fail `ActionSchema` (it expects a string) further down the pipeline.
    expect('execute' in action).toBe(false);
    // The lowered stack must be JSON-safe: no function values survive.
    expect(() => JSON.stringify(result.lowered)).not.toThrow();
    expect(JSON.stringify(result.lowered)).not.toContain('legacy');
  });

  it('still lowers an `execute`-only callable (back-compat) onto `target`', () => {
    const result = lowerCallables({
      actions: [{
        name: 'legacy_only',
        label: 'Legacy',
        type: 'script',
        execute: function legacyHandler() { return 'legacy'; },
      }],
    });

    const [action] = actionsOf(result);
    const ref = action.target as string;
    expect(typeof ref).toBe('string');
    expect(result.functions[ref]()).toBe('legacy');
    expect('execute' in action).toBe(false);
  });

  it('leaves a string-valued handler pair untouched (the spec transform owns it)', () => {
    // No callable to lower here, so the compile step must not editorialise: the
    // spec's `ActionSchema` transform is the single place that resolves a
    // string/string pair (keeping `target`, dropping `execute`).
    const result = lowerCallables({
      actions: [{
        name: 'strings',
        label: 'Strings',
        type: 'script',
        target: 'preferredHandler',
        execute: 'legacyHandler',
      }],
    });

    const [action] = actionsOf(result);
    expect(action.target).toBe('preferredHandler');
    expect(action.execute).toBe('legacyHandler');
    expect(result.count).toBe(0);
  });

  // #3743: "`target` first" meant "a CALLABLE `target` first", which left one
  // combination still resolving the alias's way — a string `target` beside a
  // function `execute` bundled the alias and then overwrote the canonical ref
  // the author wrote. Same inversion as above, one slot type over.
  it('keeps a string `target` when the alias holds an inline function', () => {
    const result = lowerCallables({
      actions: [{
        name: 'mixed',
        label: 'Mixed',
        type: 'script',
        target: 'preferredHandler',
        execute: function legacyHandler() { return 'legacy'; },
      }],
    });

    const [action] = actionsOf(result);
    expect(action.target).toBe('preferredHandler');
    expect(result.count).toBe(0);
    // The losing alias still has to go: a function value is not JSON-safe and
    // `ActionSchema` expects a string, so leaving it would trade the silent
    // discard for a confusing parse error. `lintDeprecatedAliases` is what
    // tells the author which handler they lost (#3743).
    expect('execute' in action).toBe(false);
    expect(() => JSON.stringify(result.lowered)).not.toThrow();
    expect(JSON.stringify(result.lowered)).not.toContain('legacy');
  });

  it('applies the same precedence to actions nested under an object', () => {
    const result = lowerCallables({
      objects: [{
        name: 'crm_deal',
        actions: [{
          name: 'convert',
          label: 'Convert',
          type: 'script',
          target: function preferredHandler() { return 'preferred'; },
          execute: function legacyHandler() { return 'legacy'; },
        }],
      }],
    });

    const objects = (result.lowered as { objects: Array<{ actions: Array<Record<string, unknown>> }> }).objects;
    const [action] = objects[0].actions;
    const ref = action.target as string;
    expect(result.functions[ref]()).toBe('preferred');
    expect('execute' in action).toBe(false);
  });
});
