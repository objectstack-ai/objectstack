// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectConflict: 'merge'` REFUSES a fixed-shape config object both objects
 * declare with different values (#16075).
 *
 * ## What was wrong
 *
 * #14848 made `'merge'` refuse every object-level COLLECTION two stacks declare
 * differently, and stated in its docblock that everything else keeps
 * later-wins. "Everything else" included eight FIXED-SHAPE CONFIG OBJECTS on
 * `ObjectSchema` — `userActions`, `external`, `tenancy`, `access`,
 * `lifecycle`, `enable`, `publicSharing`, `protection`. Measured on `main` @
 * `44ce049a8` before this change, each of the eight composed to the LATER
 * object's declaration wholesale, with nothing said: `enable: { trackHistory:
 * true }` beside `enable: { apiEnabled: true }` lost `trackHistory`, and an
 * add-on package's `access: { default: 'public' }` switched a core package's
 * `access: { default: 'private' }` off — the posture downgrade the top level
 * already refuses for `api` / `server`.
 *
 * Maintainer ruling 5563452716 (option 1): refused, with #14848's message
 * shape and its identical-passes reading; `fields` keeps its merge.
 *
 * ## What is pinned
 *
 * - MAIN — the ruling's three cases (`access` differing ⇒ refused, `access`
 *   identical ⇒ passes, `fields` still merges), the card's own `enable` case,
 *   and every one of the eight refused / passed by the production composer.
 *   Refusals assert the ADR-0112 envelope (`code`, `status`, `issues`) and the
 *   finding sentence, not the whole message.
 * - DERIVATION — the refused config-object set, read from what the REFUSAL
 *   ENUMERATES, equals an independent walk of `ObjectSchema.shape`: a
 *   wrapper-stripped `object` that is not a collection. The literal list is
 *   the reviewer's copy of the ruling's eight.
 * - ARRIVAL — a config-object key added to the shape (a probe, mocked in a
 *   fresh module graph) is refused by the unedited composer. This is the leg
 *   that tells a derived set from a transcribed one: against today's shape
 *   both answer the same.
 * - BOUNDARY — a key whose type is a UNION admitting an object beside a
 *   non-object form (`systemFields`, `titleFormat`) is not a fixed shape, is
 *   outside the ruling's eight, and stays on later-wins; so does a scalar.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { composeStacks, defineStack, type ObjectStackDefinition } from './stack.zod';
import { ObjectSchema } from './data/object.zod';

/** The error shape the assertions read — the ADR-0112 envelope. */
type Envelope = Error & { code?: string; status?: number; issues?: readonly unknown[] };

const mf = (id: string) => ({ id, name: id.split('.').pop()!, version: '1.0.0', type: 'app' as const });

// `as const` on the field type is load-bearing (see stack.test.ts): hoisted
// without it the literal widens to `string`, which the input type refuses.
const obj = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { title: { type: 'text' as const } },
  ...extra,
});

/** The thrown value, or `null` when the composition is accepted. */
function refusal(fn: () => unknown): Envelope | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const shared = (out: ObjectStackDefinition) =>
  (out.objects ?? []).find((o) => o.name === 'shared') as Record<string, unknown> | undefined;

/** The ruling's eight, in the object shape's declaration order. */
const CONFIG_OBJECT_KEYS_IN_SHAPE_ORDER = [
  'userActions',
  'external',
  'tenancy',
  'access',
  'lifecycle',
  'enable',
  'publicSharing',
  'protection',
] as const;

const A0 = "'com.example.a' (stack #0)";
const B1 = "'com.example.b' (stack #1)";

const FINDING = (key: string, holder: string, later: string) =>
  `object 'shared' is defined in multiple stacks and its '${key}' is declared with different values by ` +
  `${holder} and ${later}.`;

/** The config-object list the refusal message enumerates, split. */
const enumeratedConfigObjects = (message: string): string[] =>
  (/and neither is a fixed-shape config object \(([^)]*)\)/.exec(message)?.[1] ?? '').split(', ').filter(Boolean);

/** Assert a `'merge'` config-object refusal: envelope, finding, fix line. */
function expectRefused(err: Envelope | null, key: string, holder = A0, later = B1): void {
  expect(err, `'${key}' was accepted`).not.toBeNull();
  expect(err!.code).toBe('STACK_COMPOSE_COLLECTION_CONFLICT');
  expect(err!.status).toBe(422);
  expect(err!.issues).toEqual([FINDING(key, holder, later)]);
  expect(err!.message.split('\n')[0]).toBe(`composeStacks conflict: ${FINDING(key, holder, later)}`);
  expect(err!.message).toContain(`silently dropping every member ${holder} set.`);
  expect(err!.message).toContain(`Fix: declare '${key}' on 'shared' in exactly one of the two stacks`);
}

// Strict-parsed: `access` is ADR-0066 D2's exposure posture.
const accessStack = (id: string, posture: 'public' | 'private', extra: Record<string, unknown> = {}) =>
  defineStack({ manifest: mf(id), objects: [obj('shared', { access: { default: posture }, ...extra })] });

describe("composeStacks objectConflict: 'merge' — a fixed-shape config object both objects declare differently is refused", () => {
  it("refuses `access` declared 'private' by one package and 'public' by the next — the posture downgrade", () => {
    const err = refusal(() =>
      composeStacks([accessStack('com.example.a', 'private'), accessStack('com.example.b', 'public')], {
        objectConflict: 'merge',
      }),
    );
    expectRefused(err, 'access');
  });

  it("refuses the card's own `enable` case — `trackHistory` from one stack, `apiEnabled` from the next", () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { enable: { trackHistory: true } })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { enable: { apiEnabled: true } })] });
    expectRefused(refusal(() => composeStacks([a, b], { objectConflict: 'merge' })), 'enable');
  });

  // `strict: false` bypasses the parse: the member SHAPE is not the subject
  // here, the composition is — each pair differs on exactly the named key.
  it.each(CONFIG_OBJECT_KEYS_IN_SHAPE_ORDER)("refuses two objects declaring different '%s'", (key) => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { [key]: { left_member: 1 } })] }, { strict: false });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { [key]: { right_member: 2 } })] }, { strict: false });
    expectRefused(refusal(() => composeStacks([a, b], { objectConflict: 'merge' })), key);
  });

  it('names the FIRST stack that declared the config object against the disagreeing later one (three stacks, two agreeing)', () => {
    const err = refusal(() =>
      composeStacks(
        [accessStack('com.example.a', 'private'), accessStack('com.example.b', 'private'), accessStack('com.example.c', 'public')],
        { objectConflict: 'merge' },
      ),
    );
    expectRefused(err, 'access', A0, "'com.example.c' (stack #2)");
  });
});

describe("composeStacks objectConflict: 'merge' — what stays accepted", () => {
  it('passes an IDENTICAL `access` declared on both sides — carried once, the posture kept', () => {
    const out = composeStacks([accessStack('com.example.a', 'private'), accessStack('com.example.b', 'private')], {
      objectConflict: 'merge',
    });
    expect(shared(out)?.access).toEqual({ default: 'private' });
  });

  it.each(CONFIG_OBJECT_KEYS_IN_SHAPE_ORDER)("passes an identical '%s' on both sides", (key) => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { [key]: { same_member: 1 } })] }, { strict: false });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { [key]: { same_member: 1 } })] }, { strict: false });
    const out = composeStacks([a, b], { objectConflict: 'merge' });
    expect(shared(out)?.[key]).toEqual({ same_member: 1 });
  });

  it('still shallow-merges `fields` beside an identical `access` — later fields win, earlier fields kept', () => {
    const a = accessStack('com.example.a', 'private', {
      fields: { title: { type: 'text' as const }, industry: { type: 'text' as const }, status: { type: 'text' as const } },
    });
    const b = accessStack('com.example.b', 'private', {
      fields: { email: { type: 'email' as const }, status: { type: 'select' as const, options: [{ label: 'Active', value: 'active' }] } },
    });
    const s = shared(composeStacks([a, b], { objectConflict: 'merge' })) as { fields: Record<string, { type: string }>; access: unknown };
    expect(Object.keys(s.fields).sort()).toEqual(['email', 'industry', 'status', 'title']);
    expect(s.fields.status.type).toBe('select');
    expect(s.access).toEqual({ default: 'private' });
  });

  it("keeps the earlier stack's config object when the later object does not declare it", () => {
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { label: 'Shared v2' })] });
    const s = shared(composeStacks([accessStack('com.example.a', 'private'), b], { objectConflict: 'merge' }));
    expect(s?.access).toEqual({ default: 'private' });
    expect(s?.label).toBe('Shared v2');
  });

  it("'override' is unchanged — it hands the whole object, posture included, to the later stack by choice", () => {
    const out = composeStacks([accessStack('com.example.a', 'private'), accessStack('com.example.b', 'public')], {
      objectConflict: 'override',
    });
    expect(shared(out)?.access).toEqual({ default: 'public' });
  });
});

// ── Independent walks — re-implemented, never imported: the production
//    walkers are internal, and a pin that imports its subject cannot state
//    what the subject rejected. ─────────────────────────────────────────────

type Def = { type?: string; innerType?: unknown; in?: unknown; out?: unknown; options?: unknown[]; getter?: () => unknown };

const defOf = (schema: unknown): Def | undefined =>
  schema === null || (typeof schema !== 'object' && typeof schema !== 'function')
    ? undefined
    : (schema as { _zod?: { def?: Def } })._zod?.def;

const WRAPPERS = ['optional', 'nullable', 'default', 'prefault', 'readonly', 'nonoptional', 'catch'];

/** The side of a pipe the author writes: OUT only when IN is a transform stage. */
function authorableSide(def: Def): unknown {
  let node = def.in;
  for (let hops = 0; hops < 8; hops++) {
    const inner = defOf(node);
    if (!inner?.type) break;
    if (inner.type === 'transform') return def.out;
    if (WRAPPERS.includes(inner.type)) node = inner.innerType;
    else if (inner.type === 'lazy') node = inner.getter?.();
    else break;
  }
  return def.in;
}

/** Array or record, through wrappers / lazy / pipe, any union member. */
function isCollection(schema: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  const def = defOf(schema);
  if (!def?.type) return false;
  if (def.type === 'array' || def.type === 'record') return true;
  if (WRAPPERS.includes(def.type)) return isCollection(def.innerType, depth + 1);
  if (def.type === 'lazy') return isCollection(def.getter?.(), depth + 1);
  if (def.type === 'pipe') return isCollection(authorableSide(def), depth + 1);
  if (def.type === 'union') return (def.options ?? []).some((o) => isCollection(o, depth + 1));
  return false;
}

/** A wrapper-stripped `object` — and ⛔ never a union's member. */
function isFixedShapeObject(schema: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  const def = defOf(schema);
  if (!def?.type) return false;
  if (def.type === 'object') return true;
  if (WRAPPERS.includes(def.type)) return isFixedShapeObject(def.innerType, depth + 1);
  if (def.type === 'lazy') return isFixedShapeObject(def.getter?.(), depth + 1);
  if (def.type === 'pipe') return isFixedShapeObject(authorableSide(def), depth + 1);
  return false;
}

const shapeOf = (schema: unknown): Record<string, unknown> => (schema as { shape: Record<string, unknown> }).shape;

/** The fixed-shape config-object keys of a shape, in its declaration order. */
const configObjectKeysOf = (shape: Record<string, unknown>) =>
  Object.keys(shape).filter((key) => key !== 'fields' && !isCollection(shape[key]) && isFixedShapeObject(shape[key]));

/** The config-object set a composer refuses, read from what its refusal ENUMERATES. */
function refusedConfigObjectsOf(compose: typeof composeStacks, define: typeof defineStack): string[] {
  const a = define({ manifest: mf('com.example.a'), objects: [obj('shared', { access: { default: 'private' } })] }, { strict: false });
  const b = define({ manifest: mf('com.example.b'), objects: [obj('shared', { access: { default: 'public' } })] }, { strict: false });
  const err = refusal(() => compose([a, b], { objectConflict: 'merge' }));
  return enumeratedConfigObjects(err?.message ?? '');
}

describe('DERIVATION — the refused config-object set equals the shape walk', () => {
  const derived = configObjectKeysOf(shapeOf(ObjectSchema));

  it("the shape walk yields the ruling's eight, in shape order (a new config object lands here as a one-line diff)", () => {
    expect(derived).toEqual([...CONFIG_OBJECT_KEYS_IN_SHAPE_ORDER]);
  });

  it('the set the refusal enumerates IS the shape walk — read from the production composer', () => {
    expect(refusedConfigObjectsOf(composeStacks, defineStack)).toEqual(derived);
  });

  it("no config object is also counted as a collection — the two lists the refusal prints are disjoint", () => {
    const err = refusal(() =>
      composeStacks([accessStack('com.example.a', 'private'), accessStack('com.example.b', 'public')], { objectConflict: 'merge' }),
    );
    const collections = (/Any other object-level collection \(([^)]*)\) is not merged/.exec(err?.message ?? '')?.[1] ?? '').split(', ');
    expect(collections.length).toBeGreaterThan(0);
    expect(collections.filter((key) => derived.includes(key as never))).toEqual([]);
  });
});

describe('ARRIVAL — a config object added to the shape is refused with no edit to stack.zod.ts', () => {
  it('a probe config-object key joins the refusal; a probe union-with-object key does not', async () => {
    vi.resetModules();
    vi.doMock('./data/object.zod', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./data/object.zod')>();
      const patched = z.object({
        ...(shapeOf(actual.ObjectSchema) as Record<string, z.ZodType>),
        probeConfigObject: z.object({ on: z.boolean().optional() }).optional(),
        probeUnionObject: z.union([z.literal(false), z.object({ on: z.boolean().optional() })]).optional(),
      });
      return { ...actual, ObjectSchema: patched };
    });
    try {
      const fresh = await import('./stack.zod');
      const { ObjectSchema: patchedSchema } = await import('./data/object.zod');
      const patchedShape = shapeOf(patchedSchema);
      expect(Object.keys(patchedShape)).toContain('probeConfigObject');

      const walked = configObjectKeysOf(patchedShape);
      expect(walked).toEqual([...CONFIG_OBJECT_KEYS_IN_SHAPE_ORDER, 'probeConfigObject']);
      expect(refusedConfigObjectsOf(fresh.composeStacks, fresh.defineStack)).toEqual(walked);

      const pair = (key: string, left: unknown, right: unknown) => [
        fresh.defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { [key]: left })] }, { strict: false }),
        fresh.defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { [key]: right })] }, { strict: false }),
      ];
      expectRefused(
        refusal(() => fresh.composeStacks(pair('probeConfigObject', { on: true }, { on: false }), { objectConflict: 'merge' })),
        'probeConfigObject',
      );
      const out = fresh.composeStacks(pair('probeUnionObject', { on: true }, { on: false }), { objectConflict: 'merge' });
      expect(shared(out)?.probeUnionObject).toEqual({ on: false });
    } finally {
      vi.doUnmock('./data/object.zod');
      vi.resetModules();
    }
  });
});

describe("BOUNDARY — a union admitting an object, and a scalar, stay on later-wins", () => {
  it("the two union keys that admit an object are unions on today's shape, not fixed shapes", () => {
    const shape = shapeOf(ObjectSchema);
    for (const key of ['systemFields', 'titleFormat']) {
      expect(defOf(defOf(shape[key])?.innerType)?.type, key).toBe('union');
      expect(isFixedShapeObject(shape[key]), key).toBe(false);
    }
  });

  it("`systemFields` in its options-object form composes by later-wins (strict-parsed)", () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { systemFields: { tenant: false } })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { systemFields: { audit: false } })] });
    expect(shared(composeStacks([a, b], { objectConflict: 'merge' }))?.systemFields).toEqual({ audit: false });
  });

  it('`titleFormat` in its expression-object form composes by later-wins', () => {
    const left = { dialect: 'template', source: '{title}' };
    const right = { dialect: 'template', source: '{title} ({name})' };
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { titleFormat: left })] }, { strict: false });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { titleFormat: right })] }, { strict: false });
    expect(shared(composeStacks([a, b], { objectConflict: 'merge' }))?.titleFormat).toEqual(right);
  });

  it('a scalar composes by later-wins', () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { label: 'Shared v1' })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { label: 'Shared v2' })] });
    expect(shared(composeStacks([a, b], { objectConflict: 'merge' }))?.label).toBe('Shared v2');
  });
});
