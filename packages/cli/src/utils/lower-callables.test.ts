// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { defineStack, normalizeStackInput, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { FlowFunctionEntrySchema } from '@objectstack/spec/automation';
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

// ── #4976: the lowering and the schema must round-trip ──────────────────────
//
// Every test above stops at the shape `lowerCallables` EMITS, and every spec
// test parses only shapes an author WRITES. Nothing crossed the boundary — so
// when #4396 taught this step to keep a declared entry's declaration, and the
// union in `flow-function.zod.ts` was not extended in the same change, both
// halves stayed green and `objectstack build` failed on the join with
// `invalid_union: Invalid input` and no path past `functions`.
//
// These tests are that boundary, driven through the real build pipeline
// (`defineStack` → `normalizeStackInput` → `lowerCallables` → parse) rather
// than a hand-written sample of what the lowering is believed to emit: a
// hand-written sample is a third copy of the truth and drifts exactly the way
// the two halves already did.
//
// SCOPE: all four cells of map/array × bare/declared. The ARRAY form
// (`functions: [{ name, handler }]`) was the last one still broken — in BOTH
// its spellings, because #4343 and #4976 each only ever touched the map, while
// `lowerCallables` has lowered the array branch the whole time. Its member
// lives inline in `stack.zod.ts` rather than in `FlowFunctionEntrySchema`
// (an array entry names itself, so it is a different record, not the same
// schema in a list), which is why widening one did not widen the other. #6238
// widened it; the parametrisation below now covers the array form too.
describe('lowerCallables → the spec parses what it emits (#4976, #6238)', () => {
  const base = {
    manifest: { id: 'com.example.demo', name: 'demo', version: '1.0.0', type: 'app' as const },
  };

  /** Exactly what `objectstack compile` does, in the order it does it. */
  const buildPipeline = (functions: unknown) => {
    const stack = defineStack({ ...base, functions } as never);
    const normalized = normalizeStackInput(stack as Record<string, unknown>);
    return lowerCallables(normalized);
  };

  /**
   * `form` drives the entry-level assertion, which can only run on the map:
   * `FlowFunctionEntrySchema` is the map entry's schema and is exported, while
   * the array member is inline in `ObjectStackDefinitionSchema`. The array
   * cells are pinned by the whole-stack parse below — the assertion the build
   * actually makes.
   */
  const cases: Array<[label: string, form: 'map' | 'array', functions: unknown]> = [
    ['a bare handler', 'map', { scoreLead: () => ({ score: 1 }) }],
    ['a declared writer', 'map', { syncBilling: { handler: () => ({ ok: true }), effect: 'writes' } }],
    ['a declaration that states the pure default', 'map', { scoreLead: { handler: () => ({ score: 1 }), effect: 'pure' } }],
    ['a declaration that states nothing', 'map', { scoreLead: { handler: () => ({ score: 1 }) } }],
    ['both spellings side by side', 'map', {
      scoreLead: () => ({ score: 1 }),
      syncBilling: { handler: () => ({ ok: true }), effect: 'writes' },
    }],
    // ── the array form (#6238) ──
    ['an array entry with a bare handler', 'array', [{ name: 'scoreLead', handler: () => ({ score: 1 }) }]],
    ['an array entry declaring a writer', 'array', [{ name: 'syncBilling', handler: () => ({ ok: true }), effect: 'writes' }]],
    ['an array entry declaring the pure default', 'array', [{ name: 'scoreLead', handler: () => ({ score: 1 }), effect: 'pure' }]],
    ['an array entry carrying a packageId', 'array', [{ name: 'scoreLead', handler: () => ({ score: 1 }), packageId: 'com.example.pkg' }]],
    ['several array entries side by side', 'array', [
      { name: 'scoreLead', handler: () => ({ score: 1 }) },
      { name: 'syncBilling', handler: () => ({ ok: true }), effect: 'writes' },
    ]],
  ];

  for (const [label, form, functions] of cases) {
    if (form === 'map') {
      it(`parses every entry it emits for ${label}`, () => {
        const emitted = (buildPipeline(functions).lowered as {
          functions: Record<string, unknown>;
        }).functions;

        for (const [name, entry] of Object.entries(emitted)) {
          const result = FlowFunctionEntrySchema.safeParse(entry);
          expect(
            result.success,
            `emitted entry '${name}' (${JSON.stringify(entry)}) is not a shape FlowFunctionEntrySchema accepts: `
            + JSON.stringify(result.success ? [] : result.error.issues),
          ).toBe(true);
        }
      });
    }

    it(`parses the whole lowered stack for ${label}`, () => {
      // The assertion the build itself makes (`compile.ts` step 3). Parsing the
      // entries one by one can pass while the stack does not — `functions` is a
      // union of a record and an array, so a rejected entry surfaces only as
      // `invalid_union` on the parent, which is precisely the unreadable error
      // the issue is about.
      const { lowered } = buildPipeline(functions);
      const result = ObjectStackDefinitionSchema.safeParse(lowered);
      expect(
        result.success,
        `lowered stack rejected: ${JSON.stringify(result.success ? [] : result.error.issues)}`,
      ).toBe(true);
    });
  }

  it('carries the declaration into the artifact, not just past the parse', () => {
    // Surviving the parse is worthless if `effect` is dropped on the way — that
    // would re-create #4396's silent un-declaring with a green build. The
    // artifact must still SAY 'writes', because that string is what
    // `mergeRuntimeModule` re-attaches the module's callable to at boot.
    const { lowered } = buildPipeline({
      syncBilling: { handler: () => ({ ok: true }), effect: 'writes' },
    });
    const parsed = ObjectStackDefinitionSchema.parse(lowered) as {
      functions: Record<string, { handler: string; effect: string }>;
    };
    expect(parsed.functions.syncBilling).toEqual({ handler: 'syncBilling', effect: 'writes' });
    // And it is JSON — the artifact is `objectstack.json`, not a module.
    expect(JSON.parse(JSON.stringify(lowered)).functions.syncBilling)
      .toEqual({ handler: 'syncBilling', effect: 'writes' });
  });

  it('carries an ARRAY entry\'s declaration into the artifact too (#6238)', () => {
    // Same guarantee, other spelling. The array branch of `lowerCallables`
    // rewrites `name` to the ref as well as `handler`, so both keys must come
    // back as the ref and `effect` must survive beside them.
    const { lowered } = buildPipeline([
      { name: 'syncBilling', handler: () => ({ ok: true }), effect: 'writes' },
    ]);
    const parsed = ObjectStackDefinitionSchema.parse(lowered) as {
      functions: Array<{ name: string; handler: string; effect: string }>;
    };
    expect(parsed.functions).toEqual([{ name: 'syncBilling', handler: 'syncBilling', effect: 'writes' }]);
    expect(JSON.parse(JSON.stringify(lowered)).functions)
      .toEqual([{ name: 'syncBilling', handler: 'syncBilling', effect: 'writes' }]);
  });
});
