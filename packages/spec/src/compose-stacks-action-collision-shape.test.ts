// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `composeStacks` refuses a malformed `actions` with the ADR-0112 envelope,
 * never a bare `TypeError` out of its action-key collision pass (#19816).
 *
 * ## What was wrong
 *
 * Step 6 of `composeStacks` (`collectComposedActionKeyCollisions`) walked
 * every input's top-level `actions` and every composed object's own `actions`
 * with no element-shape guard, and it runs BEFORE step 7, the bound-action
 * merge whose guard (#19799) refuses exactly these shapes. So on a hand-built
 * input the collision pass crashed first, `code` and `status` both
 * `undefined`:
 *
 * - top-level `actions: [null]` / `[undefined]`: reading `objectName`;
 * - an object's `actions: 5` / `'abc'` / `{}` / `true`:
 *   `(obj.actions ?? []).entries is not a function`;
 * - an object's `actions: [null]` / `[undefined]`: reading `name`.
 *
 * A non-object entry it could read (`'x'`) was keyed `global:undefined`, so
 * two stacks each carrying one were refused as a cross-stack ACTION KEY
 * COLLISION — the wrong code for a schema defect.
 *
 * ## What is pinned
 *
 * The pass skips what declares no key, and every such input reaches step 7,
 * which answers it with its one refusal: `STACK_SCHEMA_INVALID`, `status:
 * 422`, the zod issue at the composed artifact's own path. The last block is
 * the control: well-formed stacks still compose, and a real cross-stack
 * collision — including one sitting beside a skipped entry — is still
 * refused with the collision code at the declaring stack's own index.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks } from './stack.zod';

type Envelope = Error & {
  code?: string;
  status?: number;
  issues?: ReadonlyArray<{ code?: string; path?: readonly PropertyKey[]; expected?: string } | string>;
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

const act = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type: 'script' as const, target: 'noop', ...extra });

const obj = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { title: { type: 'text' as const } },
  ...extra,
});

/** Stack A — well-formed, one object and one global action. */
const valid = () => ({ manifest: mf('com.example.a'), objects: [obj('a_item')], actions: [act('a_home')] });
/** Stack B, hand-built, with the given top-level `actions`. */
const withTop = (actions: unknown) => ({ manifest: mf('com.example.b'), objects: [obj('b_item')], actions });
/** Stack B, hand-built, whose object `b_item` carries the given `actions`. */
const withOwn = (actions: unknown) => ({ manifest: mf('com.example.b'), objects: [obj('b_item', { actions })] });

const compose = (stacks: unknown[], options?: Record<string, unknown>) =>
  composeStacks(stacks as never, options as never);

function expectSchemaEnvelope(refused: Envelope | null, paths: PropertyKey[][], expected: 'array' | 'object'): void {
  expect(refused).toBeInstanceOf(Error);
  expect(refused).not.toBeInstanceOf(TypeError);
  expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
  expect(refused?.status).toBe(422);
  const issues = (refused?.issues ?? []) as ReadonlyArray<{ code?: string; path?: readonly PropertyKey[]; expected?: string }>;
  expect(issues.map((issue) => issue.path)).toEqual(paths);
  expect(issues.every((issue) => issue.code === 'invalid_type' && issue.expected === expected)).toBe(true);
}

// Stack A contributes one top-level action, so stack B's first entry sits at
// composed index 1 — the index the artifact carries and the refusal names.
const topEntries: Array<{ label: string; value: unknown }> = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'a string', value: 'x' },
  { label: 'a number', value: 5 },
  { label: 'an array', value: [] },
];

describe('#19816 — a non-object top-level `actions` entry is refused with the envelope, not a TypeError', () => {
  for (const row of topEntries) {
    it(`entry ${row.label} is refused at ['actions', 1]`, () => {
      const refused = refusal(() => compose([valid(), withTop([row.value])]));
      expectSchemaEnvelope(refused, [['actions', 1]], 'object');
      expect(refused?.message).toContain("'actions'");
      expect(refused?.message).toContain('#1 (');
    });
  }

  it('a malformed entry beside a well-formed one is refused at its own composed index', () => {
    const refused = refusal(() => compose([valid(), withTop([act('b_home'), null])]));
    expectSchemaEnvelope(refused, [['actions', 2]], 'object');
  });

  it("two stacks each carrying a non-object entry are a schema defect, NOT a 'global:undefined' key collision", () => {
    const refused = refusal(() => compose([{ ...valid(), actions: ['x'] }, withTop(['x'])]));
    expectSchemaEnvelope(refused, [['actions', 0], ['actions', 1]], 'object');
    expect(refused?.message).not.toContain('global:undefined');
  });
});

describe("#19816 — a malformed object's own `actions` is refused with the envelope, not a TypeError", () => {
  const nonArrays: Array<{ label: string; value: unknown }> = [
    { label: 'a number', value: 5 },
    { label: 'a string', value: 'abc' },
    { label: 'a plain object', value: {} },
    { label: 'a boolean', value: true },
  ];
  for (const row of nonArrays) {
    it(`\`actions\` as ${row.label} is refused at ['objects', 1, 'actions']`, () => {
      const refused = refusal(() => compose([valid(), withOwn(row.value)]));
      expectSchemaEnvelope(refused, [['objects', 1, 'actions']], 'array');
      expect(refused?.message).toContain("object 'b_item'");
    });
  }

  const entries: Array<{ label: string; value: unknown }> = [
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'a string', value: 'x' },
  ];
  for (const row of entries) {
    it(`entry ${row.label} is refused at ['objects', 1, 'actions', 0]`, () => {
      const refused = refusal(() => compose([valid(), withOwn([row.value])]));
      expectSchemaEnvelope(refused, [['objects', 1, 'actions', 0]], 'object');
      expect(refused?.message).toContain("object 'b_item'");
    });
  }

  it("under objectConflict 'override' and 'merge' the answer is the same envelope", () => {
    expectSchemaEnvelope(
      refusal(() => compose([valid(), withOwn(5)], { objectConflict: 'override' })),
      [['objects', 1, 'actions']],
      'array',
    );
    expectSchemaEnvelope(
      refusal(() => compose([valid(), withOwn([null])], { objectConflict: 'merge' })),
      [['objects', 1, 'actions', 0]],
      'object',
    );
  });
});

describe('#19816 — the controls: well-formed stacks compose, and a real collision is still refused', () => {
  it('a valid pair composes, every action carried', () => {
    const composed = compose([valid(), withTop([act('b_home')])]);
    expect(composed.actions?.map((a) => a.name)).toEqual(['a_home', 'b_home']);
  });

  it('a real cross-stack collision is still refused with the collision code', () => {
    const refused = refusal(() => compose([valid(), withTop([act('a_home')])]));
    expect(refused?.code).toBe('STACK_COMPOSE_ACTION_KEY_COLLISION');
    expect(refused?.status).toBe(422);
    expect(refused?.issues).toHaveLength(1);
    expect(String(refused?.issues?.[0])).toContain("'global:a_home'");
  });

  it("the walk goes on past a skipped top-level entry — the collision names the declaring stack's own index", () => {
    const refused = refusal(() => compose([valid(), withTop([null, act('a_home')])]));
    expect(refused?.code).toBe('STACK_COMPOSE_ACTION_KEY_COLLISION');
    expect(String(refused?.issues?.[0])).toContain('stack.actions[1]');
  });

  it("the walk goes on past a skipped embedded entry — an object's own collision is still found", () => {
    const refused = refusal(() =>
      compose([
        { ...valid(), actions: [act('b_go', { objectName: 'b_item' })] },
        withOwn([null, act('b_go')]),
      ]),
    );
    expect(refused?.code).toBe('STACK_COMPOSE_ACTION_KEY_COLLISION');
    expect(String(refused?.issues?.[0])).toContain("'b_item:b_go'");
    expect(String(refused?.issues?.[0])).toContain("objects['b_item'].actions[1]");
  });
});
