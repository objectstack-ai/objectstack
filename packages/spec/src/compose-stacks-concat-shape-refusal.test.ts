// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `composeStacks` step 3 (the `concat` pass) refuses a stack whose value for a
 * concatenated collection key is not an array (#19784 — ruling C, the
 * follow-up the #18239 ruling routed here).
 *
 * ## What was wrong
 *
 * Step 3 kept only the array values it found for each `concat` key and
 * announced the rest with a one-time `console.warn`. So a stack reaching
 * composition with `permissions: { … }` or `data: 42` (a hand-built stack
 * object, or `defineStack(config, { strict: false })`) composed "successfully"
 * into an artifact that simply lacked that stack's grants or seed rows — and
 * the same for every other concatenated key. Under `manifest: 'preserve'` the
 * dropped value survived only inside that stack's package body, so the
 * artifact's top level and its package list disagreed.
 *
 * ## What is pinned
 *
 * The ruling: 「A composed artifact is complete or it is refused」. Every key the
 * composer concatenates (derived from `COMPOSE_KEY_DISPOSITIONS`, never
 * transcribed — a key added to the table is covered the day it lands) refuses a
 * non-array value with step 2's envelope for the same defect on `objects`:
 * `STACK_SCHEMA_INVALID`, `status: 422`, one zod issue rooted at the key.
 *
 * Every refusal has its CONTROL: the same composition with the key authored as
 * an array is accepted with both stacks' content, so no refusal can satisfy
 * the assertions for the wrong reason.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { composeStacks, defineStack, COMPOSE_KEY_DISPOSITIONS, type ObjectStackDefinition } from './stack.zod';

type Envelope = Error & {
  code?: string;
  status?: number;
  issues?: ReadonlyArray<{ code?: string; path?: readonly PropertyKey[]; expected?: string }>;
};

/** The thrown value, or `null` when the composition is accepted. */
function refusal(fn: () => unknown): Envelope | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const mf = (id: string) => ({ id, name: id.split('.').pop()!, version: '1.0.0', type: 'app' as const });

/** A stack object nobody parsed. */
const handBuilt = (overrides: Record<string, unknown>) => overrides as unknown as ObjectStackDefinition;

/** A stack through `defineStack`'s `strict: false` door, which skips the parse. */
const unparsed = (overrides: Record<string, unknown>) => defineStack(overrides as never, { strict: false });

const CONCAT_KEYS = Object.entries(COMPOSE_KEY_DISPOSITIONS)
  .filter(([, rule]) => rule === 'concat')
  .map(([key]) => key);

const B1 = "'com.example.b' (stack #1)";

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#19784 — composeStacks refuses a non-array concatenated collection', () => {
  it('covers every concat key the composer declares (the table is the census, not a transcription)', () => {
    expect(CONCAT_KEYS).toContain('permissions');
    expect(CONCAT_KEYS).toContain('data');
    expect(CONCAT_KEYS.length).toBeGreaterThanOrEqual(30);
  });

  for (const key of CONCAT_KEYS) {
    describe(`'${key}'`, () => {
      const a = () => handBuilt({ manifest: mf('com.example.a'), [key]: [{ name: 'a_item' }] });
      const b = (value: unknown) => handBuilt({ manifest: mf('com.example.b'), [key]: value });

      it('a map-shaped value is refused with STACK_SCHEMA_INVALID / 422 — never skipped', () => {
        const refused = refusal(() => composeStacks([a(), b({ b_item: { name: 'b_item' } })]));
        expect(refused).toBeInstanceOf(Error);
        expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
        expect(refused?.status).toBe(422);
        expect(refused?.issues).toHaveLength(1);
        expect(refused?.issues?.[0]?.path).toEqual([key]);
        expect(refused?.issues?.[0]?.code).toBe('invalid_type');
        expect(refused?.issues?.[0]?.expected).toBe('array');
        expect(refused?.message.startsWith(`composeStacks validation failed: ${B1} declares '${key}'`)).toBe(true);
      });

      it("is refused under `manifest: 'preserve'` too", () => {
        const refused = refusal(() =>
          composeStacks([a(), b({ b_item: { name: 'b_item' } })], { manifest: 'preserve' }),
        );
        expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
        expect(refused?.status).toBe(422);
      });

      it('the control — the same key authored as an array composes the entries of BOTH stacks', () => {
        const composed = composeStacks([a(), b([{ name: 'b_item' }])]) as Record<string, unknown>;
        expect(composed[key]).toEqual([{ name: 'a_item' }, { name: 'b_item' }]);
      });
    });
  }

  /** The value shapes, on the two keys the ruling's measurement named. */
  //  A Set rides a hand-built stack only: `defineStack`'s map-form normalizer
  //  reads any object through `Object.entries`, so a Set entering through the
  //  `strict: false` door arrives here already flattened to `[]` — upstream of
  //  composition, and not this pass's finding.
  const shapes: Array<{ label: string; value: () => unknown; door: typeof handBuilt }> = [
    { label: 'a number, through `strict: false`', value: () => 42, door: unparsed },
    { label: 'a string, through `strict: false`', value: () => 'not-an-array', door: unparsed },
    { label: 'null, through `strict: false`', value: () => null, door: unparsed },
    { label: 'false, through `strict: false`', value: () => false, door: unparsed },
    { label: 'a Set of entries, on a hand-built stack', value: () => new Set([{ name: 'b_item' }]), door: handBuilt },
  ];
  for (const key of ['permissions', 'data']) {
    for (const shape of shapes) {
      it(`'${key}' as ${shape.label} is refused, whichever position it holds`, () => {
        const good = () => handBuilt({ manifest: mf('com.example.a'), [key]: [{ name: 'a_item' }] });
        const bad = () => shape.door({ manifest: mf('com.example.b'), [key]: shape.value() });
        for (const run of [() => composeStacks([good(), bad()]), () => composeStacks([bad(), good()])]) {
          const refused = refusal(run);
          expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
          expect(refused?.status).toBe(422);
          expect(refused?.issues?.[0]?.path).toEqual([key]);
        }
      });
    }
  }

  it('an ABSENT key is not a malformed one — composed from the stacks that declare it, silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const composed = composeStacks([
      handBuilt({ manifest: mf('com.example.a'), permissions: [{ name: 'a_item' }] }),
      handBuilt({ manifest: mf('com.example.b'), permissions: undefined }),
    ]);
    expect(composed.permissions).toEqual([{ name: 'a_item' }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a non-object ENTRY inside an array is carried as-is — the composed content is unchanged', () => {
    const composed = composeStacks([
      handBuilt({ manifest: mf('com.example.a'), permissions: [{ name: 'a_item' }] }),
      handBuilt({ manifest: mf('com.example.b'), permissions: [null, { name: 'b_item' }] }),
    ]);
    expect(composed.permissions).toEqual([{ name: 'a_item' }, null, { name: 'b_item' }]);
  });

  it('the strict door raises the SAME code for the same defect — one dialect for one authored mistake', () => {
    const refused = refusal(() => defineStack({ manifest: mf('com.example.b'), permissions: 42 } as never));
    expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refused?.status).toBe(422);
  });
});
