/**
 * `defineStack` refuses two actions that resolve to the same scope-qualified
 * runtime key — and ONLY those.
 *
 * The runtime registers and dispatches every action under one exact-string
 * key, `<scope>:<name>` (`executeAction` is a `Map` lookup with no wildcard
 * semantics; the scope is the owning object's name, or `'global'` for an
 * object-less action — objectql's `GLOBAL_ACTION_OBJECT_KEY`). Two
 * declarations under one key collapse to one handler registration: the second
 * to register wins, and the other stays a live, declared, permission-gated
 * button whose handler is unreachable — failing only when a user clicks it.
 *
 * Measured on `main` @ `2aa8456cf` before the check existed, one probe per row:
 *
 * ```
 * (a) two standalone globals, one name            : ACCEPTED  stack.actions=["global:dup_a","global:dup_a"]
 * (b) two standalone bound to the same object     : ACCEPTED  object.actions=["dup_b/BOUND","dup_b/BOUND"]
 * (c) standalone bound to X + embedded on X        : ACCEPTED  object.actions=["dup_c/EMB","dup_c/BOUND"]  ← merge APPENDS
 * (d) two embedded on one object                   : ACCEPTED  object.actions=["dup_d/EMB","dup_d/EMB"]
 * (z) object-less stack, two globals               : ACCEPTED  stack.actions=["global:dup_z","global:dup_z"]
 * (x) cross-scope: global + bound to X             : ACCEPTED  stack.actions=["global:dup_x","probe_item:dup_x"]
 * (y) cross-scope: global + embedded on X          : ACCEPTED  stack.actions=["global:dup_y"], object.actions=["dup_y/EMB"]
 * ```
 *
 * Rows (a)–(d) and (z) each yield ONE runtime key and are refused here. Rows
 * (x) and (y) yield TWO keys and stay accepted by ruling: the precedence the
 * runtime already implements for by-name readers (the object's own `actions`
 * first — `resolveRouteActionDeclaration`) is documented on the collection,
 * not changed.
 *
 * One carve-out inside row (c), measured against the #7397 vacuity guard in
 * `stack-inline-action-crossref.test.ts`: `mergeActionsIntoObjects` copies a
 * bound standalone action into its object's `actions` on the way OUT of
 * `defineStack`, so a built stack fed back in carries that action in both
 * positions, byte-identical. That echo is one declaration seen twice — the
 * runtime, too, skips a standalone whose object-embedded key is already
 * registered — and it is absorbed; an embedded twin that differs in any field
 * is the authored collision and stays refused.
 *
 * Message shape is contract (one condition ⇒ one wording), so the refusal
 * cases pin the full line — the key, and where each declaration was written —
 * rather than `toThrow()` alone: a bare throw cannot tell "refused for the
 * right reason" from "refused because the fixture is broken", and every
 * refusal fixture below differs from an accepted twin by exactly one name.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';

const manifest = {
  id: 'com.example.dupkey',
  name: 'duplicate-action-key-test',
  version: '1.0.0',
  type: 'app' as const,
};

// `as const` on the field type is load-bearing (see stack.test.ts): hoisted
// without it the literal widens to `string`, which the input type refuses.
const probeItem = { name: 'probe_item', label: 'Probe Item', fields: { title: { type: 'text' as const } } };
const probeOther = { name: 'probe_other', label: 'Probe Other', fields: { title: { type: 'text' as const } } };

const act = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type: 'script' as const, target: 'noop', ...extra });

/** The thrown message, or `null` when the stack is accepted. */
function refusal(config: Parameters<typeof defineStack>[0]): string | null {
  try {
    defineStack(config);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const ENVELOPE_ONE = 'defineStack cross-reference validation failed (1 issue):';
const TAIL =
  'The runtime registers and dispatches every action under this one exact-string key, ' +
  'so only one of these handlers is reachable and the other declaration is a dead button. ' +
  'Rename one of them within this scope, or bind one to a different object.';

describe('defineStack - duplicate scope-qualified action key', () => {
  it('(a) refuses two standalone globals sharing a name, naming the global key and both origins', () => {
    const msg = refusal({ manifest, objects: [probeItem], actions: [act('dup_a'), act('dup_a')] });
    expect(msg).not.toBeNull();
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'global:dup_a' is declared twice: " +
        "stack.actions[0] (no objectName, so scope 'global') and " +
        "stack.actions[1] (no objectName, so scope 'global'). " +
        TAIL,
    );
  });

  it('(b) refuses two standalone actions bound to the same object', () => {
    const msg = refusal({
      manifest,
      objects: [probeItem],
      actions: [act('dup_b', { objectName: 'probe_item' }), act('dup_b', { objectName: 'probe_item' })],
    });
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'probe_item:dup_b' is declared twice: " +
        "stack.actions[0] (objectName 'probe_item') and stack.actions[1] (objectName 'probe_item'). " +
        TAIL,
    );
  });

  it('(c) refuses a bound standalone beside a DIFFERING embedded twin on the same object — the merge appends, one key', () => {
    const msg = refusal({
      manifest,
      objects: [{ ...probeItem, actions: [act('dup_c')] }],
      actions: [act('dup_c', { objectName: 'probe_item' })],
    });
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'probe_item:dup_c' is declared twice: " +
        "stack.actions[0] (objectName 'probe_item') and " +
        "objects['probe_item'].actions[0] (embedded on the object). " +
        TAIL,
    );
  });

  it('(d) refuses two embedded twins on one object', () => {
    const msg = refusal({
      manifest,
      objects: [{ ...probeItem, actions: [act('dup_d'), act('dup_d')] }],
    });
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'probe_item:dup_d' is declared twice: " +
        "objects['probe_item'].actions[0] (embedded on the object) and " +
        "objects['probe_item'].actions[1] (embedded on the object). " +
        TAIL,
    );
  });

  it('(z) refuses two globals in an object-less stack — the check does not need an object to resolve against', () => {
    const msg = refusal({ manifest, actions: [act('dup_z'), act('dup_z')] });
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain("  ✗ Action key 'global:dup_z' is declared twice: ");
  });

  it('counts three declarations under one key as one issue, listing every origin', () => {
    const msg = refusal({
      manifest,
      objects: [{ ...probeItem, actions: [act('dup_t')] }],
      actions: [act('dup_t', { objectName: 'probe_item' }), act('dup_t', { objectName: 'probe_item' })],
    });
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'probe_item:dup_t' is declared 3 times: " +
        "stack.actions[0] (objectName 'probe_item'), stack.actions[1] (objectName 'probe_item') and " +
        "objects['probe_item'].actions[0] (embedded on the object). ",
    );
  });

  it('scopes an embedded action by the object it is written on, not by its own objectName', () => {
    // An embedded action may name a DIFFERENT declared object (existence is
    // all the walk checks there); the runtime still keys it by the owner.
    const msg = refusal({
      manifest,
      objects: [{ ...probeItem, actions: [act('dup_e', { objectName: 'probe_other' })] }, probeOther],
      actions: [act('dup_e', { objectName: 'probe_item' })],
    });
    expect(msg).toContain("  ✗ Action key 'probe_item:dup_e' is declared twice: ");
  });
});

describe('defineStack - the cross-scope pair stays accepted (two keys, documented precedence)', () => {
  it('(x) accepts one global and one object-bound action sharing a name, and emits both keys', () => {
    const out = defineStack({
      manifest,
      objects: [probeItem],
      actions: [act('dup_x'), act('dup_x', { objectName: 'probe_item' })],
    });
    expect((out.actions ?? []).map((a) => `${a.objectName ?? 'global'}:${a.name}`)).toEqual([
      'global:dup_x',
      'probe_item:dup_x',
    ]);
    // The bound twin is what the object carries; the global one never merges in.
    const item = (out.objects ?? []).find((o) => o.name === 'probe_item');
    expect((item?.actions ?? []).map((a) => `${a.name}/${a.objectName ? 'BOUND' : 'EMB'}`)).toEqual(['dup_x/BOUND']);
  });

  it('(y) accepts one global standalone beside an embedded twin on an object', () => {
    const out = defineStack({
      manifest,
      objects: [{ ...probeItem, actions: [act('dup_y')] }],
      actions: [act('dup_y')],
    });
    expect((out.actions ?? []).map((a) => `${a.objectName ?? 'global'}:${a.name}`)).toEqual(['global:dup_y']);
    const item = (out.objects ?? []).find((o) => o.name === 'probe_item');
    expect((item?.actions ?? []).map((a) => a.name)).toEqual(['dup_y']);
  });

  it("absorbs the merge's echo: a built stack (bound action copied into its object) re-enters defineStack clean", () => {
    const built = defineStack({
      manifest,
      objects: [probeItem],
      actions: [act('echo_one', { objectName: 'probe_item' }), act('echo_two', { objectName: 'probe_item' })],
    });
    const item = (built.objects ?? []).find((o) => o.name === 'probe_item');
    expect((item?.actions ?? []).map((a) => a.name)).toEqual(['echo_one', 'echo_two']);
    expect(refusal(built)).toBeNull();
  });

  it('absorbs a hand-written embedded copy only when it is identical to the bound standalone', () => {
    const bound = act('twin', { objectName: 'probe_item' });
    expect(refusal({
      manifest,
      objects: [{ ...probeItem, actions: [{ ...bound }] }],
      actions: [bound],
    })).toBeNull();
    // One field apart (a different label) and it is two declarations again.
    const msg = refusal({
      manifest,
      objects: [{ ...probeItem, actions: [{ ...bound, label: 'Twin (embedded)' }] }],
      actions: [bound],
    });
    expect(msg).toContain("  ✗ Action key 'probe_item:twin' is declared twice: ");
  });

  it('names only the distinct declarations when an echo sits beside a real collision', () => {
    const bound = act('mixed', { objectName: 'probe_item' });
    const msg = refusal({
      manifest,
      objects: [{ ...probeItem, actions: [{ ...bound }, act('mixed')] }],
      actions: [bound],
    });
    expect(msg).toContain(ENVELOPE_ONE);
    expect(msg).toContain(
      "  ✗ Action key 'probe_item:mixed' is declared twice: " +
        "stack.actions[0] (objectName 'probe_item') and " +
        "objects['probe_item'].actions[1] (embedded on the object). ",
    );
  });

  it('accepts the same name bound to two different objects — two keys', () => {
    expect(refusal({
      manifest,
      objects: [probeItem, probeOther],
      actions: [act('dup_o', { objectName: 'probe_item' }), act('dup_o', { objectName: 'probe_other' })],
    })).toBeNull();
  });

  it('accepts distinct names in every position', () => {
    expect(refusal({
      manifest,
      objects: [{ ...probeItem, actions: [act('embedded_one')] }],
      actions: [act('global_one'), act('bound_one', { objectName: 'probe_item' })],
    })).toBeNull();
  });
});

describe('defineStack - the duplicate-key check joins the existing walk', () => {
  it('aggregates with the runAction-to-missing-action refusal in one envelope, and that refusal still fires', () => {
    const msg = refusal({
      manifest,
      objects: [probeItem],
      actions: [act('dup_r'), act('dup_r')],
      apps: [{
        name: 'probe_app',
        label: 'Probe',
        navigation: [{ id: 'nav_probe', type: 'object' as const, label: 'Probe', objectName: 'probe_item', runAction: 'ghost_action' }],
      }],
    });
    expect(msg).toContain('defineStack cross-reference validation failed (2 issues):');
    expect(msg).toContain("  ✗ Action key 'global:dup_r' is declared twice: ");
    expect(msg).toContain(
      "  ✗ App 'probe_app' navigation deep-link references action 'ghost_action' (via runAction) " +
        "which is not defined in actions (neither stack.actions nor any object's actions).",
    );
  });

  it('is skipped under `strict: false`, like every other cross-reference check', () => {
    expect(() => defineStack(
      { manifest, objects: [probeItem], actions: [act('dup_n'), act('dup_n')] },
      { strict: false },
    )).not.toThrow();
  });
});
