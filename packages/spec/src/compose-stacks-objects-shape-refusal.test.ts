// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `composeStacks` step 2 (`mergeObjects`) refuses a stack whose `objects` is
 * not an array (#18239, ruling B).
 *
 * ## What was wrong
 *
 * `mergeObjects` iterated `stack.objects` with no shape guard. An input that
 * bypassed the strict `defineStack` parse (a hand-built stack object, or
 * `defineStack(config, { strict: false })`) reached it in one of three ways,
 * none of them a refusal:
 *
 * - a truthy non-iterable (`{ … }`, a number) raised a bare `TypeError`
 *   (`stack.objects is not iterable`) — `code` and `status` both `undefined`,
 *   outside the ADR-0112 envelope every other refusal in the file carries;
 * - a falsy non-array (`null`, `''`, `0`, `false`) hit `if (!stack.objects)
 *   continue` and was skipped IN SILENCE — the composed artifact simply lacked
 *   that stack's objects, and nothing said so;
 * - a non-array iterable (a `Set` of objects) composed as if it were an array.
 *
 * ## What is pinned
 *
 * The ruling: 「A composed artifact is complete or it is refused」. So a
 * non-array `objects` is REFUSED with the envelope the strict parse raises for
 * the very same authored defect — `STACK_SCHEMA_INVALID`, `status: 422`, the
 * zod issue on `issues` with its `path` naming `objects` — and never skipped.
 * The code names the rule (the stack does not match its schema); the message
 * header names the pass (`composeStacks`), the same split
 * `STACK_CROSS_REFERENCE_INVALID` makes across its two raise sites.
 *
 * A non-object ENTRY inside a well-formed `objects` array follows step 3's
 * shape instead: skipped, and reported through the shared malformed-collection
 * warning — the entry carries no object for composition to merge.
 *
 * Every refusal has its CONTROL: the same composition with `objects` authored
 * as an array is accepted, so no refusal can satisfy the assertions for the
 * wrong reason.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { composeStacks, defineStack, type ObjectStackDefinition } from './stack.zod';
import { ERROR_CODE_LEDGER } from './api/error-code-ledger.zod';

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

const obj = (name: string) => ({ name, label: name, fields: { title: { type: 'text' as const } } });

/** A stack object nobody parsed — the shape the card's reproduction used. */
const handBuilt = (overrides: Record<string, unknown>) => overrides as unknown as ObjectStackDefinition;

/** A stack through `defineStack`'s `strict: false` door, which skips the parse. */
const unparsed = (overrides: Record<string, unknown>) =>
  defineStack(overrides as never, { strict: false });

const good = () => defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item')] });

const B1 = "'com.example.b' (stack #1)";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every refusal row: how the malformed `objects` reaches composition. */
const rows: Array<{ label: string; build: () => ObjectStackDefinition }> = [
  { label: 'a hand-built stack whose `objects` is a map', build: () => handBuilt({ manifest: mf('com.example.b'), objects: { b_item: obj('b_item') } }) },
  { label: 'a hand-built stack whose `objects` is a number', build: () => handBuilt({ manifest: mf('com.example.b'), objects: 5 }) },
  { label: 'a hand-built stack whose `objects` is a Set of objects', build: () => handBuilt({ manifest: mf('com.example.b'), objects: new Set([obj('b_item')]) }) },
  // The falsy rows reach composition hand-built: since #19785 the `strict:
  // false` door refuses them itself (`define-stack-non-strict-objects-shape-refusal.test.ts`),
  // so it can no longer carry them this far.
  { label: 'a hand-built stack whose `objects` is null', build: () => handBuilt({ manifest: mf('com.example.b'), objects: null }) },
  { label: "a hand-built stack whose `objects` is ''", build: () => handBuilt({ manifest: mf('com.example.b'), objects: '' }) },
  { label: 'a hand-built stack whose `objects` is 0', build: () => handBuilt({ manifest: mf('com.example.b'), objects: 0 }) },
  { label: 'a hand-built stack whose `objects` is false', build: () => handBuilt({ manifest: mf('com.example.b'), objects: false }) },
];

describe('#18239 — composeStacks refuses a non-array `objects` with an ADR-0112 envelope', () => {
  for (const row of rows) {
    describe(row.label, () => {
      it('is refused with code STACK_SCHEMA_INVALID and status 422 — never a bare TypeError, never a skip', () => {
        const refused = refusal(() => composeStacks([good(), row.build()]));
        expect(refused).toBeInstanceOf(Error);
        expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
        expect(refused?.status).toBe(422);
      });

      it('names the key and the stack — the zod issue rides `issues` with `path: [objects]`', () => {
        const refused = refusal(() => composeStacks([good(), row.build()]));
        expect(refused?.issues).toHaveLength(1);
        expect(refused?.issues?.[0]?.path).toEqual(['objects']);
        expect(refused?.issues?.[0]?.code).toBe('invalid_type');
        expect(refused?.issues?.[0]?.expected).toBe('array');
        expect(refused?.message.startsWith(`composeStacks validation failed: ${B1}`)).toBe(true);
        expect(refused?.message).toContain("'objects'");
      });

      it('is refused whichever position the malformed stack holds', () => {
        const refused = refusal(() => composeStacks([row.build(), good()]));
        expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
        expect(refused?.status).toBe(422);
      });
    });
  }

  it('the control — the same composition with `objects` authored as an array is ACCEPTED', () => {
    const composed = composeStacks([good(), unparsed({ manifest: mf('com.example.b'), objects: [obj('b_item')] })]);
    expect(composed.objects?.map((o) => o.name)).toEqual(['a_item', 'b_item']);
  });

  it('an ABSENT `objects` is not a malformed one — still composed, still silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const composed = composeStacks([good(), unparsed({ manifest: mf('com.example.b') })]);
    expect(composed.objects?.map((o) => o.name)).toEqual(['a_item']);
    expect(warn.mock.calls.map((c) => String(c[0])).some((w) => w.includes("'objects'"))).toBe(false);
  });

  it('the strict door raises the SAME code for the same defect — one dialect for one authored mistake', () => {
    // A number, not a map: the map form (`objects: { name: {…} }`) is a legal
    // AUTHORING spelling that `defineStack` normalizes to the array before any
    // check runs, so only a hand-built stack can carry a map into composition.
    const refused = refusal(() => defineStack({ manifest: mf('com.example.b'), objects: 5 } as never));
    expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refused?.status).toBe(422);
    expect(ERROR_CODE_LEDGER['@objectstack/spec']).toContain('STACK_SCHEMA_INVALID');
  });

  it('a non-object ENTRY inside an array `objects` is skipped and reported — step 3\'s shape', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const composed = composeStacks([
      good(),
      handBuilt({ manifest: mf('com.example.b'), objects: [null, obj('b_item'), 7] }),
    ]);
    expect(composed.objects?.map((o) => o.name)).toEqual(['a_item', 'b_item']);
    const warnings = warn.mock.calls.map((c) => String(c[0]));
    expect(
      warnings.some((w) => w.includes('composeStacks') && w.includes("'objects'") && w.includes('not an object')),
    ).toBe(true);
  });
});
