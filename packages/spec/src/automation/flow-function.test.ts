// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FLOW_FUNCTION_EFFECT,
  FlowFunctionDeclarationSchema,
  FlowFunctionEffectSchema,
  FlowFunctionEntrySchema,
  isFlowFunctionEffect,
  normalizeFlowFunctionEntry,
} from './flow-function.zod';
import { defineStack } from '../stack.zod';

describe('FlowFunctionEffectSchema (#4396)', () => {
  it('declares exactly the two effects the runtime acts on', () => {
    expect(FlowFunctionEffectSchema.options).toEqual(['pure', 'writes']);
  });

  it('rejects a near-miss spelling instead of reading it as the pure default', () => {
    // 'write' singular would otherwise silently mean "wrote nothing" — the
    // under-report this whole declaration exists to stop.
    expect(FlowFunctionEffectSchema.safeParse('write').success).toBe(false);
    expect(isFlowFunctionEffect('write')).toBe(false);
  });

  it('assumes purity when nothing is declared', () => {
    expect(DEFAULT_FLOW_FUNCTION_EFFECT).toBe('pure');
    expect(FlowFunctionDeclarationSchema.parse({ handler: () => 1 }).effect).toBe('pure');
  });
});

describe('normalizeFlowFunctionEntry', () => {
  it('reads a bare handler as the pure declaration, written the short way', () => {
    const fn = () => 1;
    expect(normalizeFlowFunctionEntry(fn)).toEqual({ handler: fn, effect: 'pure' });
  });

  it('carries a declared effect through', () => {
    const fn = () => 1;
    expect(normalizeFlowFunctionEntry({ handler: fn, effect: 'writes' }))
      .toEqual({ handler: fn, effect: 'writes' });
  });

  it('drops an entry with no callable — there is nothing to invoke', () => {
    expect(normalizeFlowFunctionEntry(undefined)).toBeUndefined();
    expect(normalizeFlowFunctionEntry({ effect: 'writes' })).toBeUndefined();
    expect(normalizeFlowFunctionEntry('nope')).toBeUndefined();
  });

  it('reads an UNRECOGNIZED effect as an uncountable write, and says which value it was', () => {
    // Reachable only off the `defineStack` parse (a hand-built bundle). The safe
    // direction is "cannot say this ran clean", never "it wrote nothing" —
    // and the raw value is surfaced so the typo gets fixed.
    const fn = () => 1;
    expect(normalizeFlowFunctionEntry({ handler: fn, effect: 'write' })).toEqual({
      handler: fn,
      effect: 'writes',
      unrecognizedEffect: 'write',
    });
  });
});

describe('FlowFunctionEntrySchema', () => {
  it('accepts both spellings of one entry', () => {
    expect(FlowFunctionEntrySchema.safeParse(() => 1).success).toBe(true);
    expect(FlowFunctionEntrySchema.safeParse({ handler: () => 1, effect: 'writes' }).success).toBe(true);
  });

  it('rejects a declaration whose handler is neither a callable nor a ref', () => {
    // Narrowed in #4976, and the narrowing is the point rather than a
    // concession. This assertion used to read `{ handler: 'scoreLead' }` —
    // "handler is not callable" — but a string handler is exactly what
    // `objectstack build` emits for a declared entry, so the union now accepts
    // it (see the lowered-declaration cases below). What survives is the
    // verdict on a handler that is neither: no callable, no name.
    expect(FlowFunctionEntrySchema.safeParse({ handler: 42 }).success).toBe(false);
    expect(FlowFunctionEntrySchema.safeParse({ handler: '' }).success).toBe(false);
    expect(FlowFunctionEntrySchema.safeParse({ effect: 'writes' }).success).toBe(false);
  });

  it('accepts a hand-authored `{ handler: <name> }` for the same reason it accepts a bare name', () => {
    // The inversion #4976 causes, stated plainly rather than left as a
    // surprise. Hand-authoring the lowered form registers nothing — but that
    // was ALREADY true of the bare string member (`functions: { foo: 'foo' }`),
    // which has been accepted since #4343 with exactly that caveat. Rejecting
    // the record spelling while accepting the string spelling of one mistake
    // was two dialects for one contract; the loud failure is the same either
    // way, at execute: "no function named '…' is registered" (#1870).
    expect(FlowFunctionEntrySchema.safeParse({ handler: 'scoreLead' }).success).toBe(true);
    expect(FlowFunctionEntrySchema.safeParse('scoreLead').success).toBe(true);
  });

  // #4343 — what `objectstack build` produces. The CLI lowers every inline
  // callable to a serialisable ref BEFORE the stack is parsed, so a built
  // manifest holds `{ scoreLead: 'scoreLead' }`. Rejecting that made
  // `defineStack({ functions })` — a documented, first-class mechanism —
  // unbuildable, which #4343 turned from latent into blocking by making
  // `config.function` the only thing a `script` node can run.
  it('accepts a lowered handler ref, the form a built artifact carries', () => {
    expect(FlowFunctionEntrySchema.safeParse('scoreLead').success).toBe(true);
    // Empty is not a name.
    expect(FlowFunctionEntrySchema.safeParse('').success).toBe(false);
  });

  // #4976 — the other half of what `objectstack build` emits. #4396 taught
  // `lowerCallables` to keep a declared entry's declaration beside its lowered
  // ref; this union was not extended in the same change, so the artifact
  // `{ syncBilling: { handler: 'syncBilling', effect: 'writes' } }` failed the
  // build with `invalid_union: Invalid input` — no path past `functions`, no
  // key named. An author who cannot read that error deletes the declaration and
  // ships an undeclared writer, which is the exact state `effect` exists to
  // prevent (#4354).
  it('accepts a lowered DECLARATION, the other form a built artifact carries', () => {
    expect(FlowFunctionEntrySchema.safeParse({ handler: 'syncBilling', effect: 'writes' }).success).toBe(true);
    expect(FlowFunctionEntrySchema.safeParse({ handler: 'syncBilling', effect: 'pure' }).success).toBe(true);
  });

  it('applies the pure default to a lowered declaration that states no effect', () => {
    // `defineStack`'s parse normally materialises `effect` before the lowering
    // ever runs, but `{ strict: false }` skips that parse — so the member must
    // accept the shape without it, or that path keeps the failure this fixes.
    const parsed = FlowFunctionEntrySchema.parse({ handler: 'syncBilling' });
    expect(parsed).toEqual({ handler: 'syncBilling', effect: 'pure' });
  });

  it('keeps the declaration strict once lowered — a typo in a built artifact still names itself', () => {
    // Derived from `FlowFunctionDeclarationSchema` rather than re-typed, so the
    // surface name, the alias table and the prescription travel with it.
    const result = FlowFunctionEntrySchema.safeParse({ handler: 'syncBilling', efect: 'writes' });
    expect(result.success).toBe(false);
    const messages = JSON.stringify(result.error!.issues);
    expect(messages).toContain('`functions` entry');
    expect(messages).toContain('`efect` → `effect`');
    // And a value the runtime has no meaning for is still refused.
    expect(FlowFunctionEntrySchema.safeParse({ handler: 'syncBilling', effect: 'write' }).success).toBe(false);
  });

  it('drops BOTH lowered shapes when normalizing — each names a function without carrying one', () => {
    // The callable for that name comes from the sidecar ESM module the build
    // emits; binding the ref would register a name pointing at nothing. This is
    // not where `effect` is lost on the built path — `mergeRuntimeModule` has
    // already re-attached the callable to the declaration by the time a boot
    // normalizes anything (pinned in `packages/runtime`'s
    // `artifact-function-declarations.test.ts`).
    expect(normalizeFlowFunctionEntry('scoreLead')).toBeUndefined();
    expect(normalizeFlowFunctionEntry({ handler: 'syncBilling', effect: 'writes' })).toBeUndefined();
  });
});

describe('defineStack({ functions }) — the authoring surface (#4396)', () => {
  const base = {
    manifest: { id: 'com.example.demo', name: 'demo', version: '1.0.0', type: 'app' as const },
  };

  it('accepts a bare handler and a declared writer side by side', () => {
    const stack = defineStack({
      ...base,
      functions: {
        scoreLead: () => ({ score: 1 }),
        syncBilling: { handler: () => ({ ok: true }), effect: 'writes' },
      },
    });
    const functions = stack.functions as Record<string, unknown>;
    expect(typeof functions.scoreLead).toBe('function');
    expect(normalizeFlowFunctionEntry(functions.syncBilling)?.effect).toBe('writes');
  });

  it('accepts `effect` on the array form too', () => {
    const stack = defineStack({
      ...base,
      functions: [{ name: 'syncBilling', handler: () => ({ ok: true }), effect: 'writes' }],
    });
    expect((stack.functions as Array<{ effect?: string }>)[0].effect).toBe('writes');
  });

  it('rejects an effect the runtime has no meaning for, at authoring time', () => {
    expect(() => defineStack({
      ...base,
      functions: { syncBilling: { handler: () => ({ ok: true }), effect: 'sometimes' } },
    } as never)).toThrow();
  });
});

// #4001 batch 11. Worth being precise about WHERE this binds, because the
// campaign's rule is that a tightening claims no reach it does not have:
// authoring only. `defineStack` parses the entry; the boot path
// (`AppPlugin` / `hook-binder`) reads it with the hand-written
// `normalizeFlowFunctionEntry` instead.
//
// Which is exactly why it is not redundant. That reader takes TWO keys and
// ignores everything else by construction, so a misspelled `effect` was
// dropped at the schema and then not looked for — and the failure is the quiet
// direction: the function registers, runs, and its writes are counted as none,
// so the run reports `selected > 0, acted 0, unmeasured 0` — which SATISFIES
// #4354's broken-sweep FIRST FILTER. The run lands in the candidate set
// reading exactly like a dead sweep, on a flow that did its work; the `effect`
// declaration is what would have kept it out (`unmeasured > 0`), and the
// misspelling is what dropped it.
describe('unknown keys are rejected, not stripped (#4001 batch 11)', () => {
  const base = {
    manifest: { id: 'com.example.demo', name: 'demo', version: '1.0.0', type: 'app' as const },
  };
  const unknownKeyIssue = (value: unknown) => {
    const result = FlowFunctionDeclarationSchema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i) => i.code === 'unrecognized_keys');
  };

  it('rejects a misspelled `effect` instead of silently reading it as pure', () => {
    const issue = unknownKeyIssue({ handler: () => 1, efect: 'writes' });
    expect(issue!.message).toContain('`functions` entry');
    expect(issue!.message).toContain('`efect` → `effect`');
  });

  it('points the short words for "the callable" at `handler`', () => {
    for (const key of ['fn', 'callback', 'execute']) {
      expect(unknownKeyIssue({ handler: () => 1, [key]: () => 2 })!.message)
        .toContain(`\`${key}\` → \`handler\``);
    }
  });

  it('explains that a function is named by its MAP KEY, not by a `name` inside', () => {
    const issue = unknownKeyIssue({ handler: () => 1, name: 'scoreLead' });
    expect(issue!.message).toContain('named by its KEY');
    // A rename would be wrong: `name` is real on the ARRAY form, and pointing
    // at a declared key of this record would be inventing one.
    expect(issue!.message).not.toContain('`name` → ');
  });

  it('binds through defineStack — the authoring door this actually gates', () => {
    expect(() => defineStack({
      ...base,
      functions: { syncBilling: { handler: () => ({ ok: true }), efect: 'writes' } },
    } as never)).toThrow();
  });

  it('leaves the two spellings an author actually writes alone', () => {
    expect(FlowFunctionDeclarationSchema.safeParse({ handler: () => 1 }).success).toBe(true);
    expect(FlowFunctionDeclarationSchema.safeParse({ handler: () => 1, effect: 'writes' }).success).toBe(true);
    // The array form keeps its own shape — `name`/`packageId` live there, not
    // on this record, and strictness here must not reach across.
    expect(defineStack({
      ...base,
      functions: [{ name: 'syncBilling', handler: () => ({ ok: true }), packageId: 'p', effect: 'writes' }],
    })).toBeTruthy();
  });
});
