// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defineStack(config, { strict: false })` refuses a malformed `actions` —
 * top-level or an object's own — with an ADR-0112 envelope (#19799).
 *
 * ## What was wrong
 *
 * The non-strict door skips the parse and hands the normalized input straight
 * to `mergeActionsIntoObjects`, which stable-sorts every `actions` array via
 * `sortActionsByOrder` — `actions.some(…)` with no shape guard. A non-array
 * `actions` (`5`, `'abc'`), top-level or on an object, raised a bare
 * `TypeError: actions.some is not a function`, and a `null` entry one reading
 * `order` off it — `code` and `status` both `undefined`. Any other non-object
 * entry (`[5]`) was handed on inside a success.
 *
 * ## What is pinned
 *
 * Every such shape is refused with the strict parse's own envelope —
 * `STACK_SCHEMA_INVALID`, `status: 422` — and the zod issue at the strict
 * parse's own path: `['actions']` / `['actions', index]` for the top-level
 * collection, `['objects', i, 'actions']` / `['objects', i, 'actions', index]`
 * for an object's own. The top-level line is the one `composeStacks` step 3
 * draws for the same key. Every refusal has its CONTROL: the same stack with
 * `actions` authored as an array of action objects is accepted, merged and
 * ordered.
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

const obj = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { title: { type: 'text' as const } },
  ...extra,
});

const url = { type: 'url' as const, target: 'https://example.com' };
const bound = { name: 'b_open', label: 'Open', ...url, objectName: 'b_item', order: 2 };
const embedded = { name: 'b_first', label: 'First', ...url, order: 1 };
const global = { name: 'b_home', label: 'Home', ...url };

const nonStrict = (overrides: Record<string, unknown>) =>
  defineStack({ manifest, ...overrides } as never, { strict: false });

const strictParse = (overrides: Record<string, unknown>) => defineStack({ manifest, ...overrides } as never);

function expectEnvelope(refused: Envelope | null, paths: PropertyKey[][], expected: 'array' | 'object'): void {
  expect(refused).toBeInstanceOf(Error);
  expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
  expect(refused?.status).toBe(422);
  expect(refused?.issues?.map((issue) => issue.path)).toEqual(paths);
  expect(refused?.issues?.every((issue) => issue.code === 'invalid_type' && issue.expected === expected)).toBe(true);
}

const nonArrays: Array<{ label: string; value: unknown }> = [
  { label: 'a number', value: 5 },
  { label: 'a string', value: 'abc' },
  { label: 'null', value: null },
  { label: 'false', value: false },
];

describe('#19799 — defineStack strict: false refuses a malformed top-level `actions` with an ADR-0112 envelope', () => {
  for (const row of nonArrays) {
    it(`top-level \`actions\` as ${row.label} is refused at ['actions'] — never a bare TypeError`, () => {
      const refused = refusal(() => nonStrict({ objects: [obj('b_item')], actions: row.value }));
      expectEnvelope(refused, [['actions']], 'array');
      expect(refused?.message).toContain("'actions'");
    });
  }

  it('a non-object ENTRY is refused, one issue per entry at [actions, index] — the card\'s `[null]` repro and a `[5]` that used to pass', () => {
    const refused = refusal(() => nonStrict({ objects: [obj('b_item')], actions: [null, global, 5] }));
    expectEnvelope(refused, [['actions', 0], ['actions', 2]], 'object');
  });

  it('the strict door answers the same path with the same code — one dialect for one authored mistake', () => {
    expectEnvelope(refusal(() => strictParse({ actions: 5 })), [['actions']], 'array');
    expectEnvelope(refusal(() => strictParse({ actions: [null] })), [['actions', 0]], 'object');
  });
});

describe("#19799 — defineStack strict: false refuses a malformed object's own `actions` with the same envelope", () => {
  for (const row of nonArrays) {
    it(`an object's \`actions\` as ${row.label} is refused at ['objects', i, 'actions']`, () => {
      const refused = refusal(() => nonStrict({ objects: [obj('b_other'), obj('b_item', { actions: row.value })] }));
      expectEnvelope(refused, [['objects', 1, 'actions']], 'array');
      expect(refused?.message).toContain("object 'b_item'");
    });
  }

  it("a non-object entry in an object's `actions` is refused at ['objects', i, 'actions', index]", () => {
    const refused = refusal(() => nonStrict({ objects: [obj('b_item', { actions: [embedded, null, 7] })] }));
    expectEnvelope(refused, [['objects', 0, 'actions', 1], ['objects', 0, 'actions', 2]], 'object');
  });

  it('findings at several sites are reported in ONE refusal, top-level first, as the strict parse reports them', () => {
    const refused = refusal(() =>
      nonStrict({ objects: [obj('b_item', { actions: 'x' }), obj('b_two', { actions: [null] })], actions: [5] }),
    );
    expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues?.map((issue) => issue.path)).toEqual([
      ['actions', 0],
      ['objects', 0, 'actions'],
      ['objects', 1, 'actions', 0],
    ]);
  });

  it('the strict door answers the same paths with the same code', () => {
    expectEnvelope(refusal(() => strictParse({ objects: [obj('b_item', { actions: 5 })] })), [['objects', 0, 'actions']], 'array');
    expectEnvelope(
      refusal(() => strictParse({ objects: [obj('b_item', { actions: [null] })] })),
      [['objects', 0, 'actions', 0]],
      'object',
    );
  });
});

describe('#19799 — the controls: well-formed `actions` are accepted, merged and ordered', () => {
  it('arrays of action objects at both sites: the bound action is merged and every group is sorted by `order`', () => {
    const stack = nonStrict({
      objects: [obj('b_item', { actions: [embedded] })],
      actions: [bound, global],
    });
    expect(stack.objects?.[0]?.actions?.map((a) => a.name)).toEqual(['b_first', 'b_open']);
    expect(stack.actions?.map((a) => a.name)).toEqual(['b_home', 'b_open']);
  });

  it('an ABSENT `actions` at either site is not a malformed one — accepted', () => {
    const stack = nonStrict({ objects: [obj('b_item')] });
    expect(stack.actions).toBeUndefined();
    expect(stack.objects?.[0]?.actions).toBeUndefined();
  });

  it('an empty `actions` array is accepted at either site', () => {
    const stack = nonStrict({ objects: [obj('b_item', { actions: [] })], actions: [] });
    expect(stack.actions).toEqual([]);
    expect(stack.objects?.[0]?.actions).toEqual([]);
  });
});
