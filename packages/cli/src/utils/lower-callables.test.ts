// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { lowerCallables } from './lower-callables.js';

// ── #3855: `target` is the only handler slot ────────────────────────────────
//
// `execute` was the deprecated alias of `target`. #3713/#3742/#3743 aligned the
// three readers that disagreed about it; protocol 17 removes it outright.
//
// The load-bearing rule for THIS step: lowering runs BEFORE the parse, so it
// must not bind a function-valued `execute`. Doing so would consume the key and
// the schema tombstone would never fire — the removed alias would keep working
// in one authoring style (inline function) while being rejected in every other,
// which is the dialect split the removal exists to end.
describe('lowerCallables — only `target` binds a handler (#3855)', () => {
  const actionsOf = (result: { lowered: Record<string, unknown> }) =>
    (result.lowered as { actions: Array<Record<string, unknown>> }).actions;

  it('binds an inline function on the canonical `target`', () => {
    const result = lowerCallables({
      actions: [{
        name: 'convert',
        label: 'Convert',
        type: 'script',
        target: function preferredHandler() { return 'preferred'; },
      }],
    });

    const [action] = actionsOf(result);
    const ref = action.target as string;
    expect(typeof ref).toBe('string');
    expect(result.functions[ref]()).toBe('preferred');
    expect(() => JSON.stringify(result.lowered)).not.toThrow();
  });

  it('leaves a function on the removed `execute` alias for the parse to reject', () => {
    // Binding it here would be the alias quietly surviving its own removal.
    const result = lowerCallables({
      actions: [{
        name: 'legacy_only',
        label: 'Legacy',
        type: 'script',
        execute: function legacyHandler() { return 'legacy'; },
      }],
    });

    const [action] = actionsOf(result);
    expect(result.count).toBe(0);
    expect(action.target).toBeUndefined();
    expect(typeof action.execute).toBe('function');
  });

  it('leaves a string `execute` alone too — the parse owns the rejection', () => {
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

  it('binds a callable `target` on an action nested under an object', () => {
    const result = lowerCallables({
      objects: [{
        name: 'crm_deal',
        actions: [{
          name: 'convert',
          label: 'Convert',
          type: 'script',
          target: function preferredHandler() { return 'preferred'; },
        }],
      }],
    });

    const objects = (result.lowered as { objects: Array<{ actions: Array<Record<string, unknown>> }> }).objects;
    const [action] = objects[0].actions;
    const ref = action.target as string;
    expect(result.functions[ref]()).toBe('preferred');
  });
});

// ── #4396: a function's DECLARATION survives lowering ───────────────────────
//
// `functions: { syncBilling: { handler, effect: 'writes' } }` is how a function
// that legitimately writes keeps its run's metrics honest. Lowering is the
// first place a built artifact could lose that: the map branch bound only bare
// callables, so a declared entry was dropped entirely — the function then went
// missing from `objectstack.json` AND from the runtime bundle, and every
// `script` node calling it failed on a built deployment while working from
// source.
describe('lowerCallables — declared `functions` entries (#4396)', () => {
  const functionsOf = (result: { lowered: Record<string, unknown> }) =>
    (result.lowered as { functions: Record<string, unknown> }).functions;

  it('lowers a bare handler to its ref, unchanged', () => {
    const result = lowerCallables({ functions: { scoreLead: () => 'scored' } });
    expect(functionsOf(result).scoreLead).toBe('scoreLead');
    expect((result.functions.scoreLead as () => string)()).toBe('scored');
  });

  it('lowers a declared entry and keeps what it declared', () => {
    const result = lowerCallables({
      functions: { syncBilling: { handler: () => 'synced', effect: 'writes' } },
    });
    expect(functionsOf(result).syncBilling).toEqual({ handler: 'syncBilling', effect: 'writes' });
    expect((result.functions.syncBilling as () => string)()).toBe('synced');
    expect(result.count).toBe(1);
  });

  it('keeps `effect` on the array form too', () => {
    const result = lowerCallables({
      functions: [{ name: 'syncBilling', handler: () => 'synced', effect: 'writes' }],
    });
    const [entry] = functionsOf(result) as unknown as Array<Record<string, unknown>>;
    expect(entry).toEqual({ name: 'syncBilling', handler: 'syncBilling', effect: 'writes' });
  });
});
