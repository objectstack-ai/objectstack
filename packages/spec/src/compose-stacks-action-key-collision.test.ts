/**
 * `composeStacks` refuses two INPUT STACKS whose action declarations resolve
 * to one scope-qualified runtime key — and only those (#14662).
 *
 * `defineStack` refuses the same collision within one stack
 * (`stack-duplicate-action-key.test.ts`); the runtime keys a composed artifact
 * the same way (`objectName:name`, `global:name` for an object-less action),
 * so two packages that are each legal on their own and both declare
 * `global:shared_refresh` composed into one collapsed handler key — the same
 * dead button, arriving one composition step later.
 *
 * Measured on `main` @ `f3ae441fa` before the check existed, `defineStack`
 * outputs as inputs (the shape `examples/app-multi-package` composes):
 *
 * ```
 * P1 global(A) + global(B)                          : ACCEPTED  actions=["global:shared_refresh","global:shared_refresh"]
 * P1 … with manifest: 'preserve'                     : ACCEPTED  same
 * P4 bound(A→shared) + bound(B→shared), merge        : ACCEPTED  shared.actions=[dup_s/BOUND ×3]
 * P5b bound(B→shared) + embedded(A on shared), merge : ACCEPTED  shared.actions=[dup_m/EMB, dup_m/BOUND]
 * P2 bound(A→a_item) + global(B)                     : ACCEPTED  two keys — stays accepted
 * P3 embedded(A on shared) + embedded(B on shared)   : merge/override ACCEPTED — B's array REPLACES A's
 * ```
 *
 * Every refusal case pins the full line — the key, both manifest ids, and
 * where each declaration sits — rather than `toThrow()` alone: a bare throw
 * cannot tell "refused for the right reason" from "refused because the fixture
 * is broken" (`objectConflict: 'error'` throws on several of these fixtures
 * for a different reason).
 *
 * The inputs are BUILT stacks on purpose: `defineStack` copies each bound
 * standalone action into its object's `actions` on the way out, so a built
 * input already carries one declaration in two sites. That echo must never
 * read as a collision — the check counts distinct stacks per key, not sites.
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

/** The runtime keys a composed stack would register, per position. */
const keysOf = (s: ObjectStackDefinition) => ({
  top: (s.actions ?? []).map((a) => `${a.objectName ?? 'global'}:${a.name}`),
  embedded: Object.fromEntries(
    (s.objects ?? []).map((o) => [o.name, (o.actions ?? []).map((a) => `${a.name}/${a.objectName ? 'BOUND' : 'EMB'}`)]),
  ),
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

const ENVELOPE_ONE = 'composeStacks conflict: cross-stack action key collision (1 issue):';
const WHY =
  "The runtime registers and dispatches every action under one exact-string key — the owning object's name " +
  "(or 'global' for an object-less action), a colon, then the action name — so only one of these handlers " +
  'would be reachable in the composed artifact and the other declaration is a dead button: the collision ' +
  'defineStack refuses within one stack, arriving one composition step later. Each stack is legal on its own; ' +
  'the collision is between them.';
const FIX =
  'Fix: rename one of the colliding actions within its scope, bind one of them to a different object, or ' +
  'remove the duplicate from one of the stacks. composeStacks does not pick a winner for actions.';

// Two legal packages, each declaring one global `shared_refresh` — the card's case.
const globalA = () => defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item')], actions: [act('shared_refresh')] });
const globalB = () => defineStack({ manifest: mf('com.example.b'), objects: [obj('b_item')], actions: [act('shared_refresh')] });

describe('composeStacks - two stacks declaring one global action key', () => {
  it('refuses two legal stacks each declaring global:shared_refresh, naming both manifest ids and both sites', () => {
    const a = globalA();
    const b = globalB();
    const msg = refusal(() => composeStacks([a, b]));
    expect(msg).toBe(
      `${ENVELOPE_ONE}\n\n` +
        "  ✗ Action key 'global:shared_refresh' is declared by 2 stacks: " +
        "'com.example.a' (stack #0) at stack.actions[0] and 'com.example.b' (stack #1) at stack.actions[0].\n\n" +
        `${WHY}\n${FIX}`,
    );
  });

  it("refuses the same pair under manifest: 'preserve' — the shape app-multi-package composes", () => {
    const msg = refusal(() => composeStacks([globalA(), globalB()], { manifest: 'preserve' }));
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'global:shared_refresh' is declared by 2 stacks: " +
        "'com.example.a' (stack #0) at stack.actions[0] and 'com.example.b' (stack #1) at stack.actions[0].",
    );
  });

  it('names no strategy option — there is none for actions by ruling', () => {
    const msg = refusal(() => composeStacks([globalA(), globalB()]));
    expect(msg).not.toMatch(/actionConflict|objectConflict/);
  });

  it('lists all three stacks when three declare the key, still as one issue', () => {
    const c = defineStack({ manifest: mf('com.example.c'), actions: [act('shared_refresh')] });
    const msg = refusal(() => composeStacks([globalA(), globalB(), c]));
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'global:shared_refresh' is declared by 3 stacks: " +
        "'com.example.a' (stack #0) at stack.actions[0], 'com.example.b' (stack #1) at stack.actions[0] " +
        "and 'com.example.c' (stack #2) at stack.actions[0].",
    );
  });

  it('reports two colliding keys as two issues, one line each', () => {
    const a = defineStack({ manifest: mf('com.example.a'), actions: [act('refresh'), act('export')] });
    const b = defineStack({ manifest: mf('com.example.b'), actions: [act('export'), act('refresh')] });
    const msg = refusal(() => composeStacks([a, b]));
    expect(msg).toContain('composeStacks conflict: cross-stack action key collision (2 issues):');
    expect(msg).toContain(
      "  ✗ Action key 'global:refresh' is declared by 2 stacks: " +
        "'com.example.a' (stack #0) at stack.actions[0] and 'com.example.b' (stack #1) at stack.actions[1].",
    );
    expect(msg).toContain(
      "  ✗ Action key 'global:export' is declared by 2 stacks: " +
        "'com.example.a' (stack #0) at stack.actions[1] and 'com.example.b' (stack #1) at stack.actions[0].",
    );
  });

  it("keys an empty-string objectName as global — the sibling walk, the merge and the runtime ladder all resolve '' by truthiness", () => {
    // Type-legal, refused by ActionSchema's regex only under a strict parse,
    // so reachable through `strict: false`; `??` would have keyed it as ':dup_g'.
    const a = defineStack({ manifest: mf('com.example.a'), actions: [act('dup_g', { objectName: '' })] }, { strict: false });
    const b = defineStack({ manifest: mf('com.example.b'), actions: [act('dup_g')] }, { strict: false });
    const msg = refusal(() => composeStacks([a, b]));
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'global:dup_g' is declared by 2 stacks: " +
        "'com.example.a' (stack #0) at stack.actions[0] and 'com.example.b' (stack #1) at stack.actions[0].",
    );
  });

  it('names a manifest-less input by position', () => {
    const a = defineStack({ actions: [act('dup_n')] }, { strict: false });
    const b = defineStack({ actions: [act('dup_n')] }, { strict: false });
    const msg = refusal(() => composeStacks([a, b]));
    expect(msg).toContain(
      "  ✗ Action key 'global:dup_n' is declared by 2 stacks: stack #0 at stack.actions[0] and stack #1 at stack.actions[0].",
    );
  });
});

describe('composeStacks - object-scoped keys across stacks, judged on what the composition carries', () => {
  // Both stacks declare object `shared` and bind a standalone `dup_s` to it.
  // `objectConflict: 'merge'` / `'override'` keep the later stack's object
  // (whose built copy of its own bound action is the echo in `objects[...]`),
  // and both standalone declarations concatenate — two stacks, one key.
  const boundA = () => defineStack({ manifest: mf('com.example.a'), objects: [obj('shared')], actions: [act('dup_s', { objectName: 'shared' })] });
  const boundB = () => defineStack({ manifest: mf('com.example.b'), objects: [obj('shared')], actions: [act('dup_s', { objectName: 'shared' })] });

  it.each(['merge', 'override'] as const)(
    'refuses two stacks each binding a standalone action to the same object (objectConflict: %s)',
    (objectConflict) => {
      const msg = refusal(() => composeStacks([boundA(), boundB()], { objectConflict }));
      expect(msg).toContain(ENVELOPE_ONE);
      expect(msg).toContain(
        "  ✗ Action key 'shared:dup_s' is declared by 2 stacks: " +
          "'com.example.a' (stack #0) at stack.actions[0] and " +
          "'com.example.b' (stack #1) at stack.actions[0] + objects['shared'].actions[0].",
      );
    },
  );

  it("under objectConflict: 'error' the object conflict is what throws — the fixtures are legal on their own", () => {
    const msg = refusal(() => composeStacks([boundA(), boundB()]));
    expect(msg).toContain("composeStacks conflict: object 'shared' is defined in multiple stacks.");
    expect(msg).not.toContain('action key');
  });

  // A embeds `dup_m` on `shared`; B binds a standalone `dup_m` to `shared`.
  const embeddedA = () => defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', [act('dup_m')])] });
  const boundToSharedB = () => defineStack({ manifest: mf('com.example.b'), objects: [obj('shared')], actions: [act('dup_m', { objectName: 'shared' })] });

  it.each(['merge', 'override'] as const)(
    "refuses an embedded action the composed object carries from one stack beside the other stack's standalone bound to it (objectConflict: %s, embedding stack last)",
    (objectConflict) => {
      // B first, A last: A's object wins the merge / override, so the composed
      // `shared` carries A's embedded `dup_m` (B's built copy of its own bound
      // action is NOT carried — B's object lost); B's standalone joins it at
      // `mergeActionsIntoObjects` — two handlers, one key.
      const msg = refusal(() => composeStacks([boundToSharedB(), embeddedA()], { objectConflict }));
      expect(msg).toContain(ENVELOPE_ONE);
      expect(msg).toContain(
        "  ✗ Action key 'shared:dup_m' is declared by 2 stacks: " +
          "'com.example.b' (stack #0) at stack.actions[0] and " +
          "'com.example.a' (stack #1) at objects['shared'].actions[0].",
      );
    },
  );

  it.each(['merge', 'override'] as const)(
    "accepts the same pair the other way round: the strategy hands `shared` to B, A's embedded action is not carried, one handler remains (objectConflict: %s)",
    (objectConflict) => {
      // A first, B last: B's built object carries `actions` (the echo of its
      // own bound action), so both `'override'` and the `'merge'` spread hand
      // the composed object's `actions` to B. A's embedded `dup_m` is not in
      // the artifact — the object strategy's own loss, not a collision — so
      // only B's handler reaches the runtime key.
      const out = composeStacks([embeddedA(), boundToSharedB()], { objectConflict });
      const shared = (out.objects ?? []).find((o) => o.name === 'shared');
      expect(keysOf(out).top).toEqual(['shared:dup_m']);
      // No embedded (object-less) entry survives: every carried declaration is B's bound one.
      expect((shared?.actions ?? []).every((a) => a.objectName === 'shared')).toBe(true);
      expect((shared?.actions ?? []).length).toBeGreaterThan(0);
    },
  );

  it.each(['merge', 'override'] as const)(
    "accepts two stacks each EMBEDDING the same name on one object — the later object's array replaces the earlier (measured), one handler reaches the artifact (objectConflict: %s)",
    (objectConflict) => {
      const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', [act('dup_e')])] });
      const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', [act('dup_e')])] });
      const out = composeStacks([a, b], { objectConflict });
      expect(keysOf(out).embedded).toEqual({ shared: ['dup_e/EMB'] });
      expect(keysOf(out).top).toEqual([]);
    },
  );

  it('refuses a standalone bound to an object the OTHER stack owns when that object embeds the same name', () => {
    // An add-on package (strict: false — it does not declare `core_item`
    // itself) binds `approve` to the core package's object, which already
    // embeds an `approve`. Composition merges the add-on's action into the
    // core object at `mergeActionsIntoObjects`: two stacks, one key.
    const core = defineStack({ manifest: mf('com.example.core'), objects: [obj('core_item', [act('approve')])] });
    const addon = defineStack({ manifest: mf('com.example.addon'), actions: [act('approve', { objectName: 'core_item' })] }, { strict: false });
    const msg = refusal(() => composeStacks([core, addon]));
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'core_item:approve' is declared by 2 stacks: " +
        "'com.example.core' (stack #0) at objects['core_item'].actions[0] and " +
        "'com.example.addon' (stack #1) at stack.actions[0].",
    );
  });
});

describe('composeStacks - what stays accepted', () => {
  it('accepts the cross-scope pair: one stack binds a name to its object, the other declares it global — two keys', () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item')], actions: [act('dup_x', { objectName: 'a_item' })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('b_item')], actions: [act('dup_x')] });
    const out = composeStacks([a, b]);
    expect(keysOf(out).top).toEqual(['a_item:dup_x', 'global:dup_x']);
  });

  it('accepts one name bound to two different objects from two stacks — two keys', () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item')], actions: [act('dup_o', { objectName: 'a_item' })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('b_item')], actions: [act('dup_o', { objectName: 'b_item' })] });
    const out = composeStacks([a, b]);
    expect(keysOf(out).top).toEqual(['a_item:dup_o', 'b_item:dup_o']);
  });

  it("does not read a built input's own echo (a bound standalone plus the copy defineStack put on its object) as a collision", () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item')], actions: [act('bound_one', { objectName: 'a_item' })] });
    // The build already carries the declaration twice — one stack, one key.
    expect(keysOf(a).embedded).toEqual({ a_item: ['bound_one/BOUND'] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('b_item')], actions: [act('other')] });
    expect(refusal(() => composeStacks([a, b]))).toBeNull();
    expect(refusal(() => composeStacks([a, b], { manifest: 'preserve' }))).toBeNull();
  });

  it("leaves a key one input repeats WITHIN itself to defineStack's door — composeStacks reports cross-stack collisions only", () => {
    // `strict: false` opted out of defineStack's walk; composition does not
    // re-run it, and the repeat is one stack, not two.
    const a = defineStack({ manifest: mf('com.example.a'), actions: [act('dup_n'), act('dup_n')] }, { strict: false });
    const b = defineStack({ manifest: mf('com.example.b'), actions: [act('other')] });
    expect(refusal(() => composeStacks([a, b]))).toBeNull();
  });

  it('accepts distinct keys in every position across stacks', () => {
    const a = defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item', [act('embedded_a')])], actions: [act('global_a'), act('bound_a', { objectName: 'a_item' })] });
    const b = defineStack({ manifest: mf('com.example.b'), objects: [obj('b_item', [act('embedded_b')])], actions: [act('global_b'), act('bound_b', { objectName: 'b_item' })] });
    const out = composeStacks([a, b]);
    expect(keysOf(out).top).toEqual(['global_a', 'a_item:bound_a', 'global_b', 'b_item:bound_b'].map((k) => (k.includes(':') ? k : `global:${k}`)));
  });

  it("composes the app-multi-package shape unchanged — an App and a Module sharing a namespace, no action key in common, manifest: 'preserve'", () => {
    // A mirror of `examples/app-multi-package` (the one shipped composer): the
    // example itself declares no action at all, so it is composed as-is by the
    // corpus run recorded on the PR; this mirror gives each package one
    // distinct action so the check has something to walk.
    const core = defineStack({
      manifest: { ...mf('com.example.multi.core'), namespace: 'crm' },
      objects: [obj('crm_account', [act('archive_account')])],
      apps: [{ name: 'crm_app', label: 'CRM', navigation: [{ id: 'nav_accounts', type: 'object' as const, objectName: 'crm_account', label: 'Accounts' }] }],
    });
    const orders = defineStack({
      manifest: { ...mf('com.example.multi.orders'), namespace: 'crm', type: 'module' as const, dependencies: { 'com.example.multi.core': '^1.0.0' } },
      objects: [obj('crm_order')],
      actions: [act('ship_order', { objectName: 'crm_order' })],
    });
    const out = composeStacks([orders, core], { manifest: 'preserve' });
    expect(out.packages).toHaveLength(2);
    expect(keysOf(out).top).toEqual(['crm_order:ship_order']);
    // Each package's action is carried exactly once — the bound one no longer
    // doubled by the composed merge (#14847), the embedded one as before.
    expect(keysOf(out).embedded).toEqual({ crm_order: ['ship_order/BOUND'], crm_account: ['archive_account/EMB'] });
  });
});
