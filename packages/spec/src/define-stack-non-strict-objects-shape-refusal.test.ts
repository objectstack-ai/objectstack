// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defineStack(config, { strict: false })` refuses a non-array `objects` with
 * an ADR-0112 envelope (#19785).
 *
 * ## What was wrong
 *
 * The non-strict door skips the parse and hands the normalized input straight
 * to `mergeActionsIntoObjects`, whose only guard was
 * `if (!config.objects || config.objects.length === 0)`. A truthy non-array
 * (`5`, `'abc'`) went on to `config.objects.map(…)` and raised a bare
 * `TypeError` — `code` and `status` both `undefined`, outside the envelope
 * every other refusal in the file carries — and a `null` ENTRY raised one
 * reading `actions` off it. A falsy non-array (`null`, `''`, `0`, `false`) was
 * handed on untouched, to be refused one door later by `composeStacks`.
 *
 * ## What is pinned
 *
 * `strict: false` skips validation; it never promised to accept a shape the
 * merge cannot read. So every non-array `objects` except an absent one is
 * refused here with the strict parse's own envelope — `STACK_SCHEMA_INVALID`,
 * `status: 422`, the zod issue on `issues` at `path: ['objects']` — the same
 * line `composeStacks` step 2 draws for the same key.
 *
 * A non-object ENTRY is handed on exactly as written (nothing is lost at this
 * door; composition is where it would be, and it reports it there).
 *
 * Every refusal has its CONTROL: the same stack with `objects` authored as an
 * array, or as the map form, is accepted and its bound actions are merged.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';

type Envelope = Error & {
  code?: string;
  status?: number;
  issues?: ReadonlyArray<{ code?: string; path?: readonly PropertyKey[]; expected?: string }>;
};

/** The thrown value, or `null` when the call is accepted. */
function refusal(fn: () => unknown): Envelope | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const manifest = { id: 'com.example.b', name: 'b', version: '1.0.0', type: 'app' as const };

const obj = (name: string) => ({ name, label: name, fields: { title: { type: 'text' as const } } });

const bound = { name: 'b_open', label: 'Open', type: 'url' as const, target: 'https://example.com', objectName: 'b_item' };

const nonStrict = (overrides: Record<string, unknown>) =>
  defineStack({ manifest, ...overrides } as never, { strict: false });

const rows: Array<{ label: string; objects: unknown }> = [
  { label: 'a number', objects: 5 },
  { label: 'a string', objects: 'abc' },
  { label: 'null', objects: null },
  { label: "''", objects: '' },
  { label: '0', objects: 0 },
  { label: 'false', objects: false },
];

describe('#19785 — defineStack strict: false refuses a non-array `objects` with an ADR-0112 envelope', () => {
  for (const row of rows) {
    it(`\`objects\` as ${row.label} is refused with code STACK_SCHEMA_INVALID and status 422, the issue at ['objects']`, () => {
      const refused = refusal(() => nonStrict({ objects: row.objects, actions: [bound] }));
      expect(refused).toBeInstanceOf(Error);
      expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
      expect(refused?.status).toBe(422);
      expect(refused?.issues).toHaveLength(1);
      expect(refused?.issues?.[0]?.path).toEqual(['objects']);
      expect(refused?.issues?.[0]?.code).toBe('invalid_type');
      expect(refused?.issues?.[0]?.expected).toBe('array');
      expect(refused?.message).toContain("'objects'");
    });
  }

  it('the control — `objects` as an array is accepted and the bound action is merged into its object', () => {
    const stack = nonStrict({ objects: [obj('b_item')], actions: [bound] });
    expect(stack.objects?.[0]?.actions?.map((a) => a.name)).toEqual(['b_open']);
  });

  it('the control — the map form is normalized first and accepted the same way', () => {
    const stack = nonStrict({ objects: { b_item: obj('b_item') }, actions: [bound] });
    expect(stack.objects?.[0]?.actions?.map((a) => a.name)).toEqual(['b_open']);
  });

  it('an ABSENT `objects` is not a malformed one — accepted', () => {
    const stack = nonStrict({ actions: [bound] });
    expect(stack.objects).toBeUndefined();
    expect(stack.actions?.map((a) => a.name)).toEqual(['b_open']);
  });

  it('a non-object ENTRY is handed on as written, the object beside it still merged — never a bare TypeError', () => {
    const stack = nonStrict({ objects: [null, obj('b_item'), 7], actions: [bound] });
    const objects = stack.objects as unknown[];
    expect(objects).toHaveLength(3);
    expect(objects[0]).toBeNull();
    expect(objects[2]).toBe(7);
    expect((objects[1] as { actions?: Array<{ name: string }> }).actions?.map((a) => a.name)).toEqual(['b_open']);
  });

  it('the strict door raises the SAME code for the same defect — one dialect for one authored mistake', () => {
    const refused = refusal(() => defineStack({ manifest, objects: 5 } as never));
    expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refused?.status).toBe(422);
  });
});
