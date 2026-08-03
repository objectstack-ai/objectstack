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

  it('rejects a declaration whose handler is not callable', () => {
    expect(FlowFunctionEntrySchema.safeParse({ handler: 'scoreLead' }).success).toBe(false);
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

  it('drops a lowered ref when normalizing — it names a function without carrying one', () => {
    // The callable for that name comes from the sidecar ESM module the build
    // emits; binding the string would register a name pointing at nothing.
    expect(normalizeFlowFunctionEntry('scoreLead')).toBeUndefined();
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
// keeping #4354's broken-sweep query silent on the one run that needed it.
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
