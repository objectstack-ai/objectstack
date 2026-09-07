/**
 * `objectConflict: 'merge'` merges `fields` and REFUSES every other
 * object-level collection two stacks declare differently (#14848).
 *
 * Measured on `main` @ `53cbad9f7` before the change, `'merge'` was
 * `{ ...existing, ...obj, fields: { ...existing.fields, ...obj.fields } }`:
 * `fields` was the one key merged, and every other key the later object
 * carried — `actions`, `indexes`, `listViews`, `validations`, … — REPLACED the
 * earlier package's value wholesale, with nothing at compose, build or boot
 * saying so (the issue's own case: `[approve]` + `[archive]` composed to
 * `[archive]`). Maintainer ruling (2026-09-04, option 4): refuse, in the shape
 * `'error'` uses, naming the object, the colliding collection and both
 * package ids; `fields` keeps its shallow merge; identical declarations pass
 * (as `composeSingleValue` passes identical top-level values); scalars and
 * fixed-shape config objects stay on later-wins.
 *
 * The refusal set is DERIVED from `ObjectSchema`'s shape (every array- or
 * record-typed key but `fields`), so the last block pins it against the shape
 * in BOTH directions with an independent walk: every collection key refuses,
 * every other key composes. The literal list beside it is the reviewer's copy
 * — a new collection key on the object schema joins the refusal without an
 * edit to `stack.zod.ts`, and shows up here as a one-line diff.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack, type ObjectStackDefinition } from './stack.zod';
import { ObjectSchema } from './data/object.zod';

const mf = (id: string) => ({ id, name: id.split('.').pop()!, version: '1.0.0', type: 'app' as const });

const act = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type: 'script' as const, target: 'noop', ...extra });

// `as const` on the field type is load-bearing (see stack.test.ts): hoisted
// without it the literal widens to `string`, which the input type refuses.
const obj = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { title: { type: 'text' as const } },
  ...extra,
});

/** The thrown message, or `null` when the composition is accepted. */
function refusal(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const shared = (out: ObjectStackDefinition) => (out.objects ?? []).find((o) => o.name === 'shared');

/**
 * The derived set, in the object shape's declaration order — the order the
 * refusal prints it in. `fields` is absent by rule.
 */
const COLLECTION_KEYS_IN_SHAPE_ORDER = [
  'indexes',
  'fieldGroups',
  'requiredPermissions',
  'validations',
  'activityMilestones',
  'highlightFields',
  'listViews',
  'searchableFields',
  'actions',
] as const;

const REFUSED = (key: string, holder: string, later: string) =>
  `composeStacks conflict: object 'shared' is defined in multiple stacks and its '${key}' is declared with ` +
  `different values by ${holder} and ${later}.`;
const WHY = (holder: string) =>
  "objectConflict: 'merge' shallow-merges 'fields' only. Any other object-level collection " +
  `(${COLLECTION_KEYS_IN_SHAPE_ORDER.join(', ')}) is not merged: the later declaration would replace the ` +
  `earlier one wholesale, silently dropping every entry ${holder} wrote.`;
const FIX = (key: string) =>
  `Fix: declare '${key}' on 'shared' in exactly one of the two stacks, make the two declarations identical, ` +
  "or use { objectConflict: 'override' } to hand the whole object to the later stack.";

const A0 = "'com.example.a' (stack #0)";
const B1 = "'com.example.b' (stack #1)";

// The card's own case: two packages, one object, an embedded action each.
const approveA = () => defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { actions: [act('approve')] })] });
const archiveB = () => defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { actions: [act('archive')] })] });

describe("composeStacks objectConflict: 'merge' — a collection both objects declare differently is refused", () => {
  it("refuses [approve] + [archive] on one object, naming the object, 'actions' and both manifest ids — the full message", () => {
    const msg = refusal(() => composeStacks([approveA(), archiveB()], { objectConflict: 'merge' }));
    expect(msg).toBe(`${REFUSED('actions', A0, B1)}\n${WHY(A0)}\n${FIX('actions')}`);
  });

  it("refuses at compose — before the cross-stack action-key check, whose envelope never appears", () => {
    const msg = refusal(() => composeStacks([approveA(), archiveB()], { objectConflict: 'merge' }));
    expect(msg).not.toContain('action key');
  });

  it("refuses two objects declaring different 'indexes' (strict-parsed inputs)", () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { indexes: [{ fields: ['title'] }] })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { indexes: [{ fields: ['title'], unique: true }] })] });
    const msg = refusal(() => composeStacks([a, b], { objectConflict: 'merge' }));
    expect(msg).toContain(REFUSED('indexes', A0, B1));
    expect(msg).toContain(FIX('indexes'));
  });

  // `strict: false` bypasses the parse: the fixture SHAPE is not the subject
  // here, the composition is — each pair differs on exactly the named key.
  it.each([
    ['validations', [{ type: 'script', name: 'v_a', condition: 'record.amount < 0' }], [{ type: 'script', name: 'v_b', condition: 'record.amount > 0' }]],
    ['listViews', { all: { label: 'All' } }, { mine: { label: 'Mine' } }],
    ['fieldGroups', [{ name: 'g_a', fields: ['title'] }], [{ name: 'g_b', fields: ['title'] }]],
    ['searchableFields', ['title'], ['title', 'body']],
    ['highlightFields', ['title'], ['body']],
    ['activityMilestones', [{ name: 'm_a' }], [{ name: 'm_b' }]],
    ['requiredPermissions', ['crm.read'], ['billing.read']],
  ] as const)("refuses two objects declaring different '%s'", (key, left, right) => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { [key]: left })] }, { strict: false });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { [key]: right })] }, { strict: false });
    const msg = refusal(() => composeStacks([a, b], { objectConflict: 'merge' }));
    expect(msg).toContain(REFUSED(key, A0, B1));
    expect(msg).toContain(WHY(A0));
    expect(msg).toContain(FIX(key));
  });

  it('names the FIRST stack that declared the collection against the disagreeing later one (three stacks, two agreeing)', () => {
    const idx = [{ fields: ['title'] }];
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { indexes: idx })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { indexes: [{ fields: ['title'] }] })] });
    const c = defineStack({ manifest: mf('com.example.c'), objects: [obj('shared', { indexes: [{ fields: ['title'], unique: true }] })] });
    const msg = refusal(() => composeStacks([a, b, c], { objectConflict: 'merge' }));
    expect(msg).toContain(REFUSED('indexes', A0, "'com.example.c' (stack #2)"));
  });

  it('names a manifest-less input by position', () => {
    const a = defineStack({ objects: [obj('shared', { actions: [act('approve')] })] }, { strict: false });
    const b = defineStack({ objects: [obj('shared', { actions: [act('archive')] })] }, { strict: false });
    const msg = refusal(() => composeStacks([a, b], { objectConflict: 'merge' }));
    expect(msg).toContain(REFUSED('actions', 'stack #0', 'stack #1'));
  });
});

describe("composeStacks objectConflict: 'merge' — what stays accepted", () => {
  it('shallow-merges `fields` (later fields win, earlier fields kept) and lets a later scalar win', () => {
    const a = defineStack({
      manifest: mf('com.example.a'),
      objects: [{ name: 'shared', label: 'Shared v1', fields: { title: { type: 'text' as const }, industry: { type: 'text' as const }, status: { type: 'text' as const } } }],
    });
    const b = defineStack({
      manifest: mf('com.example.b'),
      objects: [{ name: 'shared', label: 'Shared v2', fields: { email: { type: 'email' as const }, status: { type: 'select' as const, options: [{ label: 'Active', value: 'active' }] } } }],
    });
    const out = composeStacks([a, b], { objectConflict: 'merge' });
    const s = shared(out)!;
    expect(Object.keys(s.fields).sort()).toEqual(['email', 'industry', 'status', 'title']);
    expect(s.fields.status.type).toBe('select');
    expect(s.label).toBe('Shared v2');
  });

  it('passes an IDENTICAL collection declared on both sides — carried once, nothing dropped', () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { actions: [act('approve')], indexes: [{ fields: ['title'] }] })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { actions: [act('approve')], indexes: [{ fields: ['title'] }] })] });
    const out = composeStacks([a, b], { objectConflict: 'merge' });
    const s = shared(out)!;
    expect((s.actions ?? []).map((x) => x.name)).toEqual(['approve']);
    // The strict parse fills `unique: false`; the subject is one entry, carried once.
    expect(s.indexes).toHaveLength(1);
    expect(s.indexes?.[0].fields).toEqual(['title']);
  });

  it("keeps the earlier stack's collection when the later object does not declare it", () => {
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { label: 'Shared v2' })] });
    const out = composeStacks([approveA(), b], { objectConflict: 'merge' });
    const s = shared(out)!;
    expect((s.actions ?? []).map((x) => x.name)).toEqual(['approve']);
    expect(s.label).toBe('Shared v2');
  });

  it("reads an explicit `undefined` on the later object as no declaration — neither refused nor erased", () => {
    // Zod v4 keeps an explicitly-undefined input key as an own property, so a
    // built stack CAN carry `actions: undefined`; the bare spread used to let
    // it erase the earlier array.
    const b = defineStack({ manifest: mf('com.example.b'), objects: [{ ...obj('shared'), actions: undefined }] });
    const out = composeStacks([approveA(), b], { objectConflict: 'merge' });
    expect((shared(out)!.actions ?? []).map((x) => x.name)).toEqual(['approve']);
  });

  it("two built stacks each binding one standalone action to the same object carry identical copies — the object merge passes them and the action-key check is what refuses", () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared')], actions: [act('dup_s', { objectName: 'shared' })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared')], actions: [act('dup_s', { objectName: 'shared' })] });
    const msg = refusal(() => composeStacks([a, b], { objectConflict: 'merge' }));
    expect(msg).toContain('composeStacks conflict: cross-stack action key collision (1 issue):');
    expect(msg).not.toContain("its 'actions' is declared with different values");
  });
});

describe('composeStacks — the other two strategies are unchanged', () => {
  it("default 'error' still refuses the duplicate object with its own message", () => {
    const msg = refusal(() => composeStacks([approveA(), archiveB()]));
    expect(msg).toBe(
      "composeStacks conflict: object 'shared' is defined in multiple stacks. " +
        "Use { objectConflict: 'override' } or { objectConflict: 'merge' } to resolve.",
    );
  });

  it("'override' still hands the whole object to the later stack — the earlier collection is replaced, by choice", () => {
    const out = composeStacks([approveA(), archiveB()], { objectConflict: 'override' });
    expect((shared(out)!.actions ?? []).map((x) => x.name)).toEqual(['archive']);
  });
});

describe('the refusal set is derived from ObjectSchema.shape — pinned in both directions', () => {
  /** Independent walk: strip wrappers, read through lazy/pipe, any union member counts. */
  function isCollection(schema: unknown, depth = 0): boolean {
    if (depth > 8) return false;
    const def = (schema as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    const type = def?.type as string | undefined;
    if (!type) return false;
    if (type === 'array' || type === 'record') return true;
    if (['optional', 'nullable', 'default', 'prefault', 'readonly', 'nonoptional', 'catch'].includes(type)) return isCollection(def!.innerType, depth + 1);
    if (type === 'lazy') return isCollection((def!.getter as () => unknown)(), depth + 1);
    if (type === 'pipe') return isCollection(def!.in, depth + 1);
    if (type === 'union') return (def!.options as unknown[]).some((o) => isCollection(o, depth + 1));
    return false;
  }

  const shapeKeys = Object.keys(ObjectSchema.shape);
  const derived = shapeKeys.filter((k) => k !== 'fields' && isCollection((ObjectSchema.shape as Record<string, unknown>)[k]));

  it('the literal list equals the shape walk, in shape order (a new collection key on the object schema lands here as a one-line diff)', () => {
    expect(derived).toEqual([...COLLECTION_KEYS_IN_SHAPE_ORDER]);
  });

  it("'fields' is a record on the shape and is the one collection excluded by rule", () => {
    expect(isCollection((ObjectSchema.shape as Record<string, unknown>).fields)).toBe(true);
    expect(derived).not.toContain('fields');
  });

  // Dummy values by kind — `strict: false` inputs, so the shape of the value
  // is irrelevant; only "differs on exactly this key" matters.
  const valuesFor = (key: string): [unknown, unknown] => {
    const s = (ObjectSchema.shape as Record<string, unknown>)[key];
    if (!isCollection(s)) return ['x', 'y'];
    return key === 'listViews' ? [{ x: {} }, { y: {} }] : [[{ name: 'x' }], [{ name: 'y' }]];
  };

  it.each(shapeKeys.filter((k) => k !== 'name' && k !== 'fields'))(
    "'%s': refused under 'merge' iff the shape declares it as a collection",
    (key) => {
      const [left, right] = valuesFor(key);
      const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { [key]: left })] }, { strict: false });
      const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { [key]: right })] }, { strict: false });
      const msg = refusal(() => composeStacks([a, b], { objectConflict: 'merge' }));
      if (derived.includes(key)) {
        expect(msg).toContain(REFUSED(key, A0, B1));
      } else {
        expect(msg).toBeNull();
        expect((shared(composeStacks([a, b], { objectConflict: 'merge' })) as Record<string, unknown>)[key]).toEqual(right);
      }
    },
  );
});
