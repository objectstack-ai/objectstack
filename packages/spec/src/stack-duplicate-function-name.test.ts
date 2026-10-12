/**
 * `defineStack` refuses two entries of one stack's `functions` ARRAY that
 * author the same `name` — and only those.
 *
 * Functions are one flat namespace resolved by name (a hook's `handler`, an
 * action's `target`, a flow `script` node's `config.function`), so one name
 * can own one handler. Measured on main `7dbb89dc5` before the check existed,
 * with `[{ name: 'kc_a', handler: first }, { name: 'kc_a', handler: second }]`:
 *
 * ```
 * os validate --json                   : exit 0  valid: true
 * os build → loadArtifactBundle        : exit 0  [{ name: 'kc_a' }, { name: 'kc_a__2' }]  kc_a → first
 * source boot (os serve, no build)     : boots   kc_a → second, first dropped, no notice
 * ```
 *
 * The map form cannot author one name twice (an object key is unique) and is
 * never visited; the cross-stack case is `composeStacks`' own refusal
 * (`STACK_COMPOSE_FUNCTION_CONFLICT`). This is the one-stack sibling of the
 * duplicate action-key check, raised in the same cross-reference aggregate.
 *
 * Refusals assert the ADR-0112 envelope (`code` + `status`) and the named
 * subjects of each finding — the colliding name and every index — rather than
 * a bare `toThrow()`, which a refusal for any other reason would also satisfy.
 * Every refusal fixture differs from an accepted CONTROL by one name.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';

const manifest = {
  id: 'com.example.dupfn',
  name: 'duplicate-function-name-test',
  version: '1.0.0',
  type: 'app' as const,
};

// `as const` on the field type is load-bearing (see stack.test.ts).
const probeItem = { name: 'probe_item', label: 'Probe Item', fields: { title: { type: 'text' as const } } };

const first = () => 'first';
const second = () => 'second';
const third = () => 'third';

interface Refusal {
  name?: string;
  code?: string;
  status?: number;
  issues?: readonly string[];
  message: string;
}

/** The thrown refusal, or `null` when the stack is accepted. */
function refusal(config: Parameters<typeof defineStack>[0]): Refusal | null {
  try {
    defineStack(config);
    return null;
  } catch (e) {
    return e as Refusal;
  }
}

function expectCrossReferenceEnvelope(r: Refusal | null, issueCount: number): asserts r is Refusal {
  expect(r).not.toBeNull();
  expect(r!.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  expect(r!.status).toBe(422);
  expect(r!.issues).toHaveLength(issueCount);
  expect(r!.message).toContain(
    `defineStack cross-reference validation failed (${issueCount} issue${issueCount === 1 ? '' : 's'}):`,
  );
}

/** The one finding naming `name`, which must name exactly `indices`. */
function findingFor(r: Refusal, name: string, indices: number[]): string {
  const found = (r.issues ?? []).filter((issue) => issue.startsWith(`Function '${name}' `));
  expect(found, `exactly one finding for '${name}'`).toHaveLength(1);
  const finding = found[0];
  for (const i of indices) expect(finding).toContain(`stack.functions[${i}]`);
  const named = [...finding.matchAll(/stack\.functions\[(\d+)\]/g)].map((m) => Number(m[1]));
  expect(named, `the indices '${name}' names`).toEqual(indices);
  // The finding reaches the message too, as one `✗` line.
  expect(r.message).toContain(`  ✗ ${finding}`);
  return finding;
}

describe('defineStack - duplicate name in one stack\'s `functions` array', () => {
  it('refuses two entries authoring one name, naming the name and both indices', () => {
    const r = refusal({
      manifest,
      objects: [probeItem],
      functions: [{ name: 'kc_a', handler: first }, { name: 'kc_a', handler: second }],
    });
    expectCrossReferenceEnvelope(r, 1);
    expect(r.name).toBe('StackCrossReferenceError');
    const finding = findingFor(r, 'kc_a', [0, 1]);
    expect(finding).toContain('declared twice');
  });

  it('refuses one finding per colliding name, each listing every index, and leaves a unique name alone', () => {
    const r = refusal({
      manifest,
      objects: [probeItem],
      functions: [
        { name: 'kc_a', handler: first },
        { name: 'kc_b', handler: second },
        { name: 'kc_a', handler: third },
        { name: 'kc_b', handler: second },
        { name: 'kc_a', handler: first },
        { name: 'kc_c', handler: third },
      ],
    });
    expectCrossReferenceEnvelope(r, 2);
    expect(findingFor(r, 'kc_a', [0, 2, 4])).toContain('declared 3 times');
    expect(findingFor(r, 'kc_b', [1, 3])).toContain('declared twice');
    expect(r.issues!.some((issue) => issue.includes("'kc_c'"))).toBe(false);
  });

  it('refuses byte-identical twins — two registrations under one name whatever they hold', () => {
    const entry = { name: 'kc_twin', handler: first, effect: 'writes' as const };
    const r = refusal({ manifest, objects: [probeItem], functions: [entry, { ...entry }] });
    expectCrossReferenceEnvelope(r, 1);
    findingFor(r, 'kc_twin', [0, 1]);
  });

  it('refuses in an object-less stack — the check needs no object to resolve against', () => {
    const r = refusal({
      manifest,
      functions: [{ name: 'kc_a', handler: first }, { name: 'kc_a', handler: second }],
    });
    expectCrossReferenceEnvelope(r, 1);
    findingFor(r, 'kc_a', [0, 1]);
  });

  it('refuses the lowered (string-ref) array form too, when it repeats a name', () => {
    const r = refusal({
      manifest,
      objects: [probeItem],
      functions: [{ name: 'kc_a', handler: 'kc_a' }, { name: 'kc_a', handler: 'kc_a' }],
    });
    expectCrossReferenceEnvelope(r, 1);
    findingFor(r, 'kc_a', [0, 1]);
  });

  it('joins the existing aggregate: one envelope with the duplicate action-key finding', () => {
    const act = (name: string) => ({ name, label: name, type: 'script' as const, target: 'noop' });
    const r = refusal({
      manifest,
      objects: [probeItem],
      actions: [act('dup_r'), act('dup_r')],
      functions: [{ name: 'kc_a', handler: first }, { name: 'kc_a', handler: second }],
    });
    expectCrossReferenceEnvelope(r, 2);
    findingFor(r, 'kc_a', [0, 1]);
    expect(r.issues!.some((issue) => issue.startsWith("Action key 'global:dup_r' is declared twice"))).toBe(true);
  });

  it('is skipped under `strict: false`, like every other cross-reference check', () => {
    expect(() => defineStack(
      { manifest, objects: [probeItem], functions: [{ name: 'kc_a', handler: first }, { name: 'kc_a', handler: second }] },
      { strict: false },
    )).not.toThrow();
  });
});

describe('defineStack - CONTROL: distinct names and the map form are accepted unchanged', () => {
  it('accepts two distinct names in the array form, in order, with what each entry declared', () => {
    const out = defineStack({
      manifest,
      objects: [probeItem],
      functions: [{ name: 'kc_a', handler: first }, { name: 'kc_b', handler: second, effect: 'writes' }],
    });
    const fns = out.functions as Array<{ name: string; handler: unknown; effect?: string }>;
    expect(fns.map((e) => e.name)).toEqual(['kc_a', 'kc_b']);
    expect(fns.map((e) => typeof e.handler)).toEqual(['function', 'function']);
    expect(fns.map((e) => e.effect)).toEqual([undefined, 'writes']);
  });

  it('accepts the map form, keys unchanged', () => {
    const out = defineStack({
      manifest,
      objects: [probeItem],
      functions: { kc_a: first, kc_b: { handler: second, effect: 'writes' } },
    });
    expect(Object.keys(out.functions as Record<string, unknown>)).toEqual(['kc_a', 'kc_b']);
  });

  it('accepts the suffixed internal refs a build emits — distinct names, not a duplicate', () => {
    const out = defineStack({
      manifest,
      objects: [probeItem],
      functions: [{ name: 'kc_a', handler: 'kc_a' }, { name: 'kc_a__2', handler: 'kc_a__2' }],
    });
    expect((out.functions as Array<{ name: string }>).map((e) => e.name)).toEqual(['kc_a', 'kc_a__2']);
  });
});
