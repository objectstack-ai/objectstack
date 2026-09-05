// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14877 — the compose-key disposition table is a PUBLIC, FROZEN export that
 * cannot drift from `ObjectStackDefinitionSchema`.
 *
 * `COMPOSE_KEY_DISPOSITIONS` is the one place that enumerates every top-level
 * key of the artifact envelope together with its composition rule. Until
 * #14877 it was module-private, so a downstream seam that walks an artifact's
 * top level (a hosted publish, an artifact merge, an assembler) could derive
 * the COLLECTION half of that key set from `PLURAL_TO_SINGULAR` /
 * `METADATA_ALIASES` and had to hand-copy the rest — and the copy drifted
 * silently twice (cloud#897, cloud#1888). The maintainer's ruling
 * (2026-09-04, decision batch #38 item 3): export a read-only view of the
 * table plus the derived key set — derived from the same table, never a
 * second literal.
 *
 * What this file pins, each a way the export could go quietly wrong:
 *
 *   1. the exported key set and the schema's declared key set are EQUAL, in
 *      both directions — a key added to either side without the other reds
 *      here naming the key. The `satisfies Record<StackDefinitionKey, …>` on
 *      the table is the compile-time half; this is the runtime half, read off
 *      the schema's ACTUAL shape rather than the TS type derived from it;
 *   2. the view is frozen — a consumer cannot widen or retarget the contract
 *      by assignment (existing key or new key), and the derived key list
 *      cannot be pushed to;
 *   3. every value is one of the declared dispositions — the runtime table and
 *      the `ComposeDisposition` union name the same vocabulary, and the table
 *      is assignable to the ruling's declared shape;
 *   4. the dispositions are the composer's RULES, not labels: every `'concat'`
 *      key is what `composeStacks` concatenates, every `'single'` key is what
 *      it passes through when identical and refuses when different — so the
 *      `'concat'` subset a consumer reads off the export is exactly the
 *      module-private `CONCAT_ARRAY_FIELDS` the composer walks;
 *   5. the derived key list is DERIVED — same members, same order as
 *      `Object.keys` of the table — and both symbols reach the package surface
 *      (`./index`) as the SAME objects, not copies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  COMPOSE_KEY_DISPOSITIONS,
  STACK_DEFINITION_KEYS,
  ObjectStackDefinitionSchema,
  composeStacks,
  defineStack,
  type ComposeDisposition,
  type StackDefinitionKey,
  type ObjectStackDefinition,
} from './stack.zod';

// ─── Helpers ────────────────────────────────────────────────────────

/** A hand-built stack: `strict: false` so no element schema runs — the sweep is about keys, not values. */
function raw(overrides: Record<string, unknown>): ObjectStackDefinition {
  return defineStack(overrides as never, { strict: false });
}

const manifestA = { id: 'com.example.base', name: 'base', version: '1.0.0', type: 'app' as const };
const manifestB = { id: 'com.example.addon', name: 'addon', version: '1.0.0', type: 'app' as const };

/** The schema's declared top-level keys, read off its shape — the same reading the #8687 accept-side sweep uses. */
function schemaTopLevelKeys(): string[] {
  const shape = (ObjectStackDefinitionSchema as unknown as { shape: Record<string, unknown> }).shape;
  return Object.keys(shape);
}

const sorted = (keys: readonly string[]): string[] => [...keys].sort();

/**
 * The disposition vocabulary, stated ONCE as a total record over the exported
 * union: tsc reds this literal when `ComposeDisposition` gains a member this
 * object does not name (missing key) or loses one it still names (excess
 * property), so the runtime check below cannot fall behind the type.
 */
const DECLARED_DISPOSITIONS: Record<ComposeDisposition, true> = {
  concat: true,
  single: true,
  manifest: true,
  objects: true,
  functions: true,
};

const keysWith = (disposition: ComposeDisposition): StackDefinitionKey[] =>
  STACK_DEFINITION_KEYS.filter((key) => COMPOSE_KEY_DISPOSITIONS[key] === disposition);

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

// ─── 1. Key-set parity with the schema, both directions ─────────────

describe('#14877 pin 1 — the exported key set equals the schema\'s declared top-level key set', () => {
  it('COMPOSE_KEY_DISPOSITIONS names every key the schema declares, and no other', () => {
    const schemaKeys = schemaTopLevelKeys();
    // Non-vacuity: the schema really is the 40+-key envelope, not an empty shape agreeing with anything.
    expect(schemaKeys.length).toBeGreaterThan(40);

    const tableKeys = Object.keys(COMPOSE_KEY_DISPOSITIONS);
    // Sorted equality is set equality in BOTH directions once neither side repeats a key.
    expect(new Set(tableKeys).size).toBe(tableKeys.length);
    expect(new Set(schemaKeys).size).toBe(schemaKeys.length);
    expect(sorted(tableKeys)).toEqual(sorted(schemaKeys));
  });

  it('names the drift in each direction, not just "arrays differ"', () => {
    const schemaKeys = new Set(schemaTopLevelKeys());
    const tableKeys = new Set(Object.keys(COMPOSE_KEY_DISPOSITIONS));
    const onlyInSchema = [...schemaKeys].filter((key) => !tableKeys.has(key));
    const onlyInTable = [...tableKeys].filter((key) => !schemaKeys.has(key));
    expect(onlyInSchema, 'declared on ObjectStackDefinitionSchema but absent from COMPOSE_KEY_DISPOSITIONS').toEqual([]);
    expect(onlyInTable, 'in COMPOSE_KEY_DISPOSITIONS but not declared on ObjectStackDefinitionSchema').toEqual([]);
  });

  it('STACK_DEFINITION_KEYS is that same key set', () => {
    expect(sorted(STACK_DEFINITION_KEYS)).toEqual(sorted(schemaTopLevelKeys()));
  });

  it('the envelope-only keys the incidents were about are in the set', () => {
    // The five members cloud's hand-copied list had grown to by cloud#1888,
    // each present here without anyone having listed them.
    for (const key of ['manifest', 'packages', 'requires', 'positions', 'data', 'datasets']) {
      expect(STACK_DEFINITION_KEYS, `${key} must be a declared top-level key`).toContain(key);
    }
  });
});

// ─── 2. Frozen ──────────────────────────────────────────────────────

describe('#14877 pin 2 — the view is frozen', () => {
  it('COMPOSE_KEY_DISPOSITIONS is frozen and refuses assignment to an existing key', () => {
    expect(Object.isFrozen(COMPOSE_KEY_DISPOSITIONS)).toBe(true);
    const mutable = COMPOSE_KEY_DISPOSITIONS as unknown as Record<string, string>;
    // ESM modules are strict-mode code, so a write to a frozen object THROWS
    // rather than being silently ignored — the loud direction.
    expect(() => { mutable.packages = 'single'; }).toThrow(TypeError);
    expect(COMPOSE_KEY_DISPOSITIONS.packages).toBe('concat');
  });

  it('refuses a NEW key too — a consumer cannot widen the contract from outside', () => {
    const mutable = COMPOSE_KEY_DISPOSITIONS as unknown as Record<string, string>;
    expect(() => { mutable.grantedPermissions = 'concat'; }).toThrow(TypeError);
    expect('grantedPermissions' in COMPOSE_KEY_DISPOSITIONS).toBe(false);
    expect(() => { delete mutable.manifest; }).toThrow(TypeError);
    expect(COMPOSE_KEY_DISPOSITIONS.manifest).toBe('manifest');
  });

  it('STACK_DEFINITION_KEYS is frozen and cannot be pushed to', () => {
    expect(Object.isFrozen(STACK_DEFINITION_KEYS)).toBe(true);
    const mutable = STACK_DEFINITION_KEYS as unknown as string[];
    expect(() => { mutable.push('grantedPermissions'); }).toThrow(TypeError);
    expect(STACK_DEFINITION_KEYS).not.toContain('grantedPermissions');
  });
});

// ─── 3. Every value is a declared disposition ───────────────────────

describe('#14877 pin 3 — every value is one of the declared dispositions', () => {
  it('no key carries a disposition outside the ComposeDisposition vocabulary', () => {
    const vocabulary = new Set(Object.keys(DECLARED_DISPOSITIONS));
    for (const [key, disposition] of Object.entries(COMPOSE_KEY_DISPOSITIONS)) {
      expect(vocabulary.has(disposition), `'${key}' carries disposition '${disposition}'`).toBe(true);
    }
  });

  it('every declared disposition is used by at least one key (the vocabulary carries no dead word)', () => {
    for (const disposition of Object.keys(DECLARED_DISPOSITIONS) as ComposeDisposition[]) {
      expect(keysWith(disposition).length, `no key composes as '${disposition}'`).toBeGreaterThan(0);
    }
  });

  it('is assignable to the ruled shape — a read-only record from the key union to the disposition union', () => {
    // The ruling's declared type. Literal typing on the export is a SUBTYPE of
    // it (each key's disposition rather than the union), which is what keeps
    // the module's own derivations mechanical; this line is the compile-time
    // proof the widening direction still holds.
    const view: Readonly<Record<StackDefinitionKey, ComposeDisposition>> = COMPOSE_KEY_DISPOSITIONS;
    expect(Object.keys(view).length).toBe(STACK_DEFINITION_KEYS.length);
  });
});

// ─── 4. The dispositions are the composer's rules ───────────────────

describe('#14877 pin 4 — each disposition is what composeStacks actually does', () => {
  it("every 'concat' key concatenates in stack order — the export's concat subset IS the composer's", () => {
    const concatKeys = keysWith('concat');
    // Non-vacuity: the concat family is the bulk of the table.
    expect(concatKeys.length).toBeGreaterThan(30);
    expect(concatKeys).toContain('packages');
    expect(concatKeys).toContain('requires');

    // Elements are named objects with distinct names per side: composition
    // walks some collections' contents after the concat pass (a cross-stack
    // `actions` name collision is refused), so the marker must be a legal,
    // non-colliding element for every key, not a bare string.
    const element = (key: string, side: 'a' | 'b') => ({ name: `${key}_${side}` });
    const a = raw({ manifest: manifestA, ...Object.fromEntries(concatKeys.map((key) => [key, [element(key, 'a')]])) });
    const b = raw({ manifest: manifestB, ...Object.fromEntries(concatKeys.map((key) => [key, [element(key, 'b')]])) });
    const composed = composeStacks([a, b]) as unknown as Record<string, unknown>;

    for (const key of concatKeys) {
      expect(composed[key], `'${key}' must concatenate in stack order`).toEqual([element(key, 'a'), element(key, 'b')]);
    }
    // Zero warnings: every concat key hit a DECLARED rule, not the
    // undeclared-key default that happens to concatenate arrays too.
    expect(warnSpy.mock.calls.map((c: readonly unknown[]) => String(c[0]))).toEqual([]);
  });

  it("every 'single' key passes through when identical and refuses, naming the key, when different", () => {
    const singleKeys = keysWith('single');
    expect(singleKeys.length).toBeGreaterThan(3);
    expect(singleKeys).toContain('api');
    expect(singleKeys).toContain('i18n');

    const sharedHook = () => {};
    const valueFor = (key: string, variant: 'same' | 'other'): unknown => {
      if (key === 'runtimeModule') return variant === 'same' ? './rt.mjs' : './other.mjs';
      if (key === 'onEnable') return variant === 'same' ? sharedHook : () => {};
      return { probe: variant === 'same' ? key : `${key}:other` };
    };

    // Identical → pass-through, for every single key at once.
    const same = Object.fromEntries(singleKeys.map((key) => [key, valueFor(key, 'same')]));
    const composed = composeStacks([raw({ manifest: manifestA, ...same }), raw({ manifest: manifestB, ...same })]) as unknown as Record<string, unknown>;
    for (const key of singleKeys) {
      expect(composed[key], `'${key}' must pass through when identical`).toEqual(same[key]);
    }
    expect(warnSpy.mock.calls.map((c: readonly unknown[]) => String(c[0]))).toEqual([]);

    // Different → refused, naming the key — one key at a time so the message is attributable.
    for (const key of singleKeys) {
      const a = raw({ manifest: manifestA, [key]: valueFor(key, 'same') });
      const b = raw({ manifest: manifestB, [key]: valueFor(key, 'other') });
      expect(() => composeStacks([a, b]), `'${key}' must refuse differing values`).toThrow(`top-level key '${key}'`);
    }
  });

  it("the three bespoke dispositions name their own strategies: 'manifest' picks, 'objects' merges by name, 'functions' merges by handler", () => {
    expect(keysWith('manifest')).toEqual(['manifest']);
    expect(keysWith('objects')).toEqual(['objects']);
    expect(keysWith('functions')).toEqual(['functions']);

    const a = raw({ manifest: manifestA, objects: [{ name: 'task', fields: { a: {} } }], functions: { one: () => 1 } });
    const b = raw({ manifest: manifestB, objects: [{ name: 'task', fields: { b: {} } }], functions: { two: () => 2 } });
    // manifest: picked by the option (default 'last'), never concatenated.
    expect(composeStacks([a, b], { objectConflict: 'override' }).manifest?.id).toBe(manifestB.id);
    expect(composeStacks([a, b], { manifest: 'first', objectConflict: 'override' }).manifest?.id).toBe(manifestA.id);
    // objects: the conflict strategy decides — error by default, one object under override.
    expect(() => composeStacks([a, b])).toThrow(/object 'task'/);
    expect(composeStacks([a, b], { objectConflict: 'override' }).objects).toHaveLength(1);
    // functions: merged by handler name.
    const composed = composeStacks([a, b], { objectConflict: 'override' }) as unknown as { functions: Record<string, unknown> };
    expect(Object.keys(composed.functions).sort()).toEqual(['one', 'two']);
  });
});

// ─── 5. Derived, and reaching the surface as the same objects ───────

describe('#14877 pin 5 — STACK_DEFINITION_KEYS is derived, and both symbols reach the package surface', () => {
  it('STACK_DEFINITION_KEYS is Object.keys of the table — same members, same order, no second literal', () => {
    expect([...STACK_DEFINITION_KEYS]).toEqual(Object.keys(COMPOSE_KEY_DISPOSITIONS));
  });

  it('the root entry re-exports the SAME objects, not copies', async () => {
    const surface = await import('./index');
    expect(surface.COMPOSE_KEY_DISPOSITIONS).toBe(COMPOSE_KEY_DISPOSITIONS);
    expect(surface.STACK_DEFINITION_KEYS).toBe(STACK_DEFINITION_KEYS);
    // Anti-vacuity: the namespace probed is the real root surface.
    expect(typeof surface.composeStacks).toBe('function');
  });
});
