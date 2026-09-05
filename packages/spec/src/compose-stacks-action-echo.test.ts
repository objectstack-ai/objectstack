/**
 * `composeStacks` carries each bound standalone action ONCE in the composed
 * object — the second `mergeActionsIntoObjects` no longer re-appends the copy
 * each input's own build already put there (#14847).
 *
 * `defineStack` ends with `mergeActionsIntoObjects`: every standalone action
 * carrying `objectName` is copied into that object's `actions` on the way out,
 * and the standalone stays in `stack.actions`. `composeStacks` concatenates its
 * inputs' `actions` and ends with the same merge, so before this change every
 * bound action was appended to its object a SECOND time beside the copy the
 * input's build had already made. Measured on `main` @ `6392b9c2`, `defineStack`
 * outputs as inputs (the shape `examples/app-multi-package` composes):
 *
 * ```
 * two stacks, default                    : a_item.actions=["dup_x/BOUND","dup_x/BOUND"]  two copies, one declaration
 * … with manifest: 'preserve'            : same on `objects`; packages[].manifest.objects carry ONE each
 * three stacks binding b1/b2/b3 to one object, override / merge
 *                                        : shared.actions=["emb3/EMB","b3/BOUND","b1/BOUND","b2/BOUND","b3/BOUND"]
 * defineStack(composeStacks([a, b]))     : REFUSED  'a_item:dup_x' is declared 3 times
 * defineStack(a)   (a lone built input)  : REFUSED  'a_item:dup_x' is declared twice   ← #14686's landed pin
 * ```
 *
 * The three-stack `merge` row above is a refusal since #14848: `'merge'` no
 * longer hands `actions` to the later object when both declare it differently
 * (the lost `emb1` / `emb2` were exactly that), so that arm pins the refusal
 * and the echo-once reading stays on `'override'`, whose semantics did not
 * move.
 *
 * The discriminator is IDENTITY against the standalone list, not equality
 * (the triage ruling on the card): the only way an entry of `stack.actions` is
 * the very same object as an entry of `object.actions` is that a previous merge
 * put it there. A strict parse produces fresh objects, so a hand-written twin —
 * the same action authored in both positions — never shares identity, and
 * #14686's same-key refusal, which runs before the merge, still refuses it. A
 * marker key cannot do this job: `ActionSchema` is a strict object, so the key
 * is refused before it could travel (measured below).
 *
 * What does NOT change: `defineStack`'s refusal of a built stack fed back in
 * (`stack-duplicate-action-key.test.ts` pins it — a built artifact carries each
 * bound action in both positions by design; author the source shape, not the
 * artifact). So the composed output round-trips through `defineStack` exactly
 * as far as any single built input does: cleanly when no input binds an action,
 * otherwise refused with the SAME "declared twice" line a lone build gets — no
 * longer "3 times". `collectComposedActionKeyCollisions` (#14854) and its
 * message are untouched: it runs before the merge and counts distinct stacks
 * per key.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack, type ObjectStackDefinition } from './stack.zod';

const mf = (id: string) => ({ id, name: id.split('.').pop()!, version: '1.0.0', type: 'app' as const });

const act = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type: 'script' as const, target: 'noop', ...extra });

// `as const` on the field type is load-bearing (see stack.test.ts): hoisted
// without it the literal widens to `string`, which the input type refuses.
const obj = (name: string, actions?: ReturnType<typeof act>[]) => ({
  name,
  label: name,
  fields: { title: { type: 'text' as const } },
  ...(actions ? { actions } : {}),
});

/** The runtime keys a stack would register, per position. */
const keysOf = (s: ObjectStackDefinition) => ({
  top: (s.actions ?? []).map((a) => `${a.objectName ?? 'global'}:${a.name}`),
  embedded: Object.fromEntries(
    (s.objects ?? []).map((o) => [o.name, (o.actions ?? []).map((a) => `${a.name}/${a.objectName ? 'BOUND' : 'EMB'}`)]),
  ),
});

/** The thrown message, or `null` when the call is accepted. */
function refusal(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const boundA = () =>
  defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item')], actions: [act('dup_x', { objectName: 'a_item' })] });
const boundB = () =>
  defineStack({ manifest: mf('com.example.b'), objects: [obj('b_item')], actions: [act('dup_y', { objectName: 'b_item' })] });

describe('composeStacks - a bound standalone action appears once in the composed object (#14847)', () => {
  it("carries each input's own bound action once under the default strategy, and the standalone once at the top", () => {
    const a = boundA();
    const b = boundB();
    // Each input's build already carries the echo — one copy, the very same object.
    expect(keysOf(a).embedded).toEqual({ a_item: ['dup_x/BOUND'] });
    expect(a.objects![0].actions![0]).toBe(a.actions![0]);

    const out = composeStacks([a, b]);
    expect(keysOf(out)).toEqual({
      top: ['a_item:dup_x', 'b_item:dup_y'],
      embedded: { a_item: ['dup_x/BOUND'], b_item: ['dup_y/BOUND'] },
    });
    // The carried copy IS the input's declaration, not a re-appended clone.
    const aItem = out.objects!.find((o) => o.name === 'a_item')!;
    expect(aItem.actions![0]).toBe(a.actions![0]);
  });

  it("carries it once under manifest: 'preserve' too, and the packages[] halves agree with the composed objects", () => {
    const out = composeStacks([boundA(), boundB()], { manifest: 'preserve' });
    expect(keysOf(out).embedded).toEqual({ a_item: ['dup_x/BOUND'], b_item: ['dup_y/BOUND'] });
    const perPackage = (out.packages ?? []).map((p) =>
      ((p.manifest as { objects?: ObjectStackDefinition['objects'] }).objects ?? []).map((o) => [o.name, (o.actions ?? []).length]),
    );
    expect(perPackage).toEqual([[['a_item', 1]], [['b_item', 1]]]);
  });

  // Three stacks each declaring `shared`, each embedding one action on it and
  // binding one standalone to it — distinct names, so no key collides and the
  // object strategy alone decides what survives.
  const s = (n: 1 | 2 | 3) =>
    defineStack({
      manifest: mf(`com.example.s${n}`),
      objects: [obj('shared', [act(`emb${n}`)])],
      actions: [act(`b${n}`, { objectName: 'shared' })],
    });

  it("with three stacks under objectConflict: 'override', the surviving object carries the surviving stack's declared actions plus each concatenated standalone once", () => {
    const out = composeStacks([s(1), s(2), s(3)], { objectConflict: 'override' });
    expect(keysOf(out).top).toEqual(['shared:b1', 'shared:b2', 'shared:b3']);
    // s3's object survives with its built array as-is (embedded `emb3`, then
    // the echo of its own `b3`); s1's and s2's bound actions join it once
    // each, in concatenation order. The lost `emb1` / `emb2` are the object
    // strategy's own semantics, not this merge's. Before: `b3/BOUND` twice.
    expect(keysOf(out).embedded).toEqual({ shared: ['emb3/EMB', 'b3/BOUND', 'b1/BOUND', 'b2/BOUND'] });
  });

  it("with three stacks under objectConflict: 'merge', the composition is refused at the object merge — each built object carries a different `actions` array (#14848)", () => {
    // s1's `shared` carries [emb1, b1/BOUND], s2's [emb2, b2/BOUND]: two
    // declarations `'merge'` used to resolve by replacement, dropping `emb1`.
    let msg: string | null = null;
    try {
      composeStacks([s(1), s(2), s(3)], { objectConflict: 'merge' });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain(
      "composeStacks conflict: object 'shared' is defined in multiple stacks and its 'actions' is declared " +
        "with different values by 'com.example.s1' (stack #0) and 'com.example.s2' (stack #1).",
    );
  });

  it("still binds another stack's standalone to an object it does not own — the add-on shape — once", () => {
    const core = defineStack({ manifest: mf('com.example.core'), objects: [obj('core_item', [act('archive')])] });
    const addon = defineStack({ manifest: mf('com.example.addon'), actions: [act('approve', { objectName: 'core_item' })] }, { strict: false });
    const out = composeStacks([core, addon]);
    expect(keysOf(out).embedded).toEqual({ core_item: ['archive/EMB', 'approve/BOUND'] });
  });

  it('still honours `order` across the once-merged set', () => {
    const base = defineStack({
      manifest: mf('com.example.base'),
      objects: [obj('deal', [act('inline', { order: 0 })])],
      actions: [act('own_bound', { objectName: 'deal' })],
    });
    const approvals = defineStack({ manifest: mf('com.example.approvals'), actions: [act('approve', { objectName: 'deal', order: -100 })] }, { strict: false });
    const out = composeStacks([base, approvals]);
    // Before: `own_bound/BOUND` twice, the stable sort keeping both.
    expect(keysOf(out).embedded).toEqual({ deal: ['approve/BOUND', 'inline/EMB', 'own_bound/BOUND'] });
  });
});

describe('composeStacks - what the identity skip does NOT fold', () => {
  it("refuses a hand-written twin — the same action authored standalone AND on its object — through #14686's rule, unchanged", () => {
    const msg = refusal(() =>
      defineStack({
        manifest: mf('com.example.t'),
        objects: [obj('t_item', [act('tw', { objectName: 't_item' })])],
        actions: [act('tw', { objectName: 't_item' })],
      }),
    );
    expect(msg).toContain('defineStack cross-reference validation failed (1 issue):');
    expect(msg).toContain(
      "  ✗ Action key 't_item:tw' is declared twice: stack.actions[0] (objectName 't_item') and " +
        "objects['t_item'].actions[0] (embedded on the object). ",
    );
  });

  it('cannot be done by marking: a marker key on the standalone is refused by the strict parse before it could travel', () => {
    const msg = refusal(() =>
      defineStack({ manifest: mf('com.example.m'), objects: [obj('m_item')], actions: [act('mk', { objectName: 'm_item', __echo: true })] }),
    );
    expect(msg).toContain('actions.0: Unrecognized key(s) on this action: `__echo`.');
  });

  it('under strict: false, ONE action object placed in both positions is one declaration — carried once (before: twice)', () => {
    // No parse clones it, so it shares identity exactly as a build's echo does.
    // #14686's walk does not run in this mode by the author's choice, and the
    // runtime dedupes a standalone against an embedded entry by key anyway.
    const shared = act('sh', { objectName: 'n_item' });
    const out = defineStack({ manifest: mf('com.example.n'), objects: [obj('n_item', [shared])], actions: [shared] }, { strict: false });
    expect(keysOf(out)).toEqual({ top: ['n_item:sh'], embedded: { n_item: ['sh/BOUND'] } });
  });

  it('is idempotent: re-merging a built stack (strict: false) leaves the object untouched, by reference', () => {
    const built = boundA();
    const again = defineStack(built, { strict: false });
    expect(keysOf(again).embedded).toEqual({ a_item: ['dup_x/BOUND'] });
    expect(again.objects![0]).toBe(built.objects![0]);
  });
});

describe('composeStacks - round trip through defineStack', () => {
  it('parses cleanly when no input binds a standalone action to an object — no echo exists to double', () => {
    const g1 = defineStack({ manifest: mf('com.example.g1'), objects: [obj('g_item', [act('e1')])], actions: [act('glob1')] });
    const g2 = defineStack({ manifest: mf('com.example.g2'), objects: [obj('h_item', [act('e2')])], actions: [act('glob2')] });
    const out = composeStacks([g1, g2]);
    expect(refusal(() => defineStack(out))).toBeNull();
    expect(keysOf(defineStack(out))).toEqual(keysOf(out));
  });

  it("with bound actions, is refused exactly as far as a lone built input is — 'declared twice' by #14686's landed pin, never '3 times'", () => {
    const a = boundA();
    const LINE =
      "  ✗ Action key 'a_item:dup_x' is declared twice: stack.actions[0] (objectName 'a_item') and " +
      "objects['a_item'].actions[0] (embedded on the object). ";
    expect(refusal(() => defineStack(a))).toContain(LINE);

    const composed = refusal(() => defineStack(composeStacks([a, boundB()])));
    expect(composed).toContain('defineStack cross-reference validation failed (2 issues):');
    expect(composed).toContain(LINE);
    expect(composed).toContain("  ✗ Action key 'b_item:dup_y' is declared twice: ");
    expect(composed).not.toContain('is declared 3 times');
  });
});
