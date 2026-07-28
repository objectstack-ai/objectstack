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
