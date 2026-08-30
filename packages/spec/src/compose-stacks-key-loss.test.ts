// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5005 — `composeStacks` must never silently drop a top-level key.
 *
 * Composition is the platform's app-packaging / install story: an author writes
 * `server.security.rateLimit` or `api.enforceProjectMembership`, it works in a
 * single stack, and then composing that stack with any other one made it vanish
 * with no error, no warning, and no way to tell "dropped" apart from "never
 * written". This file pins the three rules adjudicated on 2026-08-04:
 *
 *   1. same value in several stacks → composes fine (pass-through);
 *   2. different values → ERROR naming the key, the two source stacks, and the fix
 *      (NOT last-wins — a silent security downgrade; NOT deep-merge — a new class
 *      of silent ambiguity);
 *   3. a top-level key with no declared composition rule → WARN, always, so the
 *      next new key self-reports instead of being discovered by accident.
 *
 * Plus the control tests: array keys keep their concat semantics, and every key
 * the schema declares is classified (the static pin that makes rule 3 rare).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  composeStacks,
  defineStack,
  ObjectStackDefinitionSchema,
  type ObjectStackDefinition,
} from './stack.zod';

// ─── Helpers ────────────────────────────────────────────────────────

function raw(overrides: Record<string, unknown>): ObjectStackDefinition {
  return defineStack(overrides as never, { strict: false });
}

const manifestA = { id: 'com.example.base', name: 'base', version: '1.0.0', type: 'app' as const };
const manifestB = { id: 'com.example.addon', name: 'addon', version: '1.0.0', type: 'app' as const };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

// ─── Rule 1 — same value passes through ─────────────────────────────

describe('#5005 rule 1 — non-array top-level keys survive composition', () => {
  it('keeps `api` when only one stack declares it (the issue\'s own repro)', () => {
    const a = raw({ manifest: manifestA, api: { enforceProjectMembership: true } });
    const b = raw({ manifest: manifestB });

    // On origin/main this was `undefined` — the 403 gate silently disappeared.
    expect(composeStacks([a, b]).api).toEqual({ enforceProjectMembership: true });
    // Order must not matter: the gate survives from either position.
    expect(composeStacks([b, a]).api).toEqual({ enforceProjectMembership: true });
  });

  it('keeps `server` when only one stack declares it (#4910 rate limiting)', () => {
    const a = raw({
      manifest: manifestA,
      server: { security: { rateLimit: { enabled: true, maxRequests: 5 } } },
    });
    const b = raw({ manifest: manifestB });

    expect(composeStacks([a, b]).server).toEqual({
      security: { rateLimit: { enabled: true, maxRequests: 5 } },
    });
  });

  it('composes fine when several stacks declare the SAME value (deep equality)', () => {
    const value = { enableProjectScoping: true, projectResolution: 'required' as const };
    const a = raw({ manifest: manifestA, api: { ...value } });
    const b = raw({ manifest: manifestB, api: { ...value } });
    const c = raw({ api: { ...value } });

    const composed = composeStacks([a, b, c]);
    expect(composed.api).toEqual(value);
    // Same value is not a conflict, so it must not warn either.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats an absent key and an explicitly-undefined key alike', () => {
    const a = raw({ manifest: manifestA, api: { enforceProjectMembership: true } });
    const b = raw({ manifest: manifestB, api: undefined });

    expect(composeStacks([a, b]).api).toEqual({ enforceProjectMembership: true });
  });

  it('omits the key entirely when no stack declares it', () => {
    const composed = composeStacks([raw({ manifest: manifestA }), raw({ manifest: manifestB })]);
    expect('api' in composed).toBe(false);
    expect('server' in composed).toBe(false);
  });
});

// ─── Rule 2 — conflict is an error with a prescription ──────────────

describe('#5005 rule 2 — conflicting values throw a prescriptive error', () => {
  it('throws naming the key, both source stacks and the fix', () => {
    const a = raw({ manifest: manifestA, api: { enforceProjectMembership: true } });
    const b = raw({ manifest: manifestB, api: { enforceProjectMembership: false } });

    let message = '';
    try {
      composeStacks([a, b]);
      throw new Error('composeStacks should have thrown');
    } catch (err) {
      message = (err as Error).message;
    }

    // Names the conflicting key…
    expect(message).toContain("top-level key 'api'");
    // …names both source stacks by their manifest identity…
    expect(message).toContain('com.example.base');
    expect(message).toContain('com.example.addon');
    // …and prescribes the two ways out.
    expect(message).toMatch(/identical/i);
    expect(message).toMatch(/remove it from/i);
  });

  it('is NOT last-wins — the earlier stack\'s stricter gate is never silently dropped', () => {
    const strict = raw({ manifest: manifestA, api: { enforceProjectMembership: true } });
    const lax = raw({ manifest: manifestB, api: { enforceProjectMembership: false } });

    expect(() => composeStacks([strict, lax])).toThrow(/conflict/i);
    expect(() => composeStacks([lax, strict])).toThrow(/conflict/i);
  });

  it('is NOT deep-merge — disjoint sub-keys still conflict', () => {
    const a = raw({ manifest: manifestA, api: { enableProjectScoping: true } });
    const b = raw({ manifest: manifestB, api: { enforceProjectMembership: true } });

    expect(() => composeStacks([a, b])).toThrow(/conflict/i);
  });

  it('conflicts on `server` too', () => {
    const a = raw({ manifest: manifestA, server: { security: { rateLimit: { maxRequests: 5 } } } });
    const b = raw({ manifest: manifestB, server: { security: { rateLimit: { maxRequests: 500 } } } });

    expect(() => composeStacks([a, b])).toThrow(/top-level key 'server'/);
  });

  it('falls back to a positional label when a stack has no manifest', () => {
    const a = raw({ api: { enforceProjectMembership: true } });
    const b = raw({ api: { enforceProjectMembership: false } });

    expect(() => composeStacks([a, b])).toThrow(/stack #0/);
    expect(() => composeStacks([a, b])).toThrow(/stack #1/);
  });
});

// ─── Rule 3 — unhandled keys warn ───────────────────────────────────

describe('#5005 rule 3 — a key with no declared rule warns', () => {
  it('warns once, names the key and carries the declare-a-rule prescription', () => {
    // A key the schema does not declare: reaches composeStacks only via
    // `strict: false`, which is exactly how a NEW key looks before someone
    // remembers to teach the composer about it.
    const a = raw({ manifest: manifestA, futureThing: { enabled: true } });
    const b = raw({ manifest: manifestB });

    const composed = composeStacks([a, b]) as Record<string, unknown>;

    // One warning that both names the key AND carries the prescription — not
    // two unrelated ones (`defineStack` also warns about undeclared keys).
    // Anchored on the prescription's own words, never on a tracker id the
    // author cannot resolve (#13156's strip).
    const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warnings.some((w) => w.includes('composeStacks') && w.includes("'futureThing'") && w.includes('COMPOSE_KEY_DISPOSITIONS')),
    ).toBe(true);
    // …and it is composed by the default rule rather than dropped.
    expect(composed.futureThing).toEqual({ enabled: true });
  });

  it('applies the default rule to an unknown ARRAY key (concat) and still warns', () => {
    const a = raw({ manifest: manifestA, futureList: [1, 2] });
    const b = raw({ manifest: manifestB, futureList: [3] });

    const composed = composeStacks([a, b]) as Record<string, unknown>;
    expect(composed.futureList).toEqual([1, 2, 3]);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((w) => w.includes("'futureList'"))).toBe(true);
  });

  it('warns rather than skipping a collection key that holds a non-array value', () => {
    const a = raw({ manifest: manifestA, views: [{ name: 'v1' }] });
    const b = raw({ manifest: manifestB, views: 'not-an-array' });

    const composed = composeStacks([a, b]);
    expect(composed.views).toHaveLength(1);
    expect(
      warnSpy.mock.calls
        .map((c) => String(c[0]))
        .some((w) => w.includes('composeStacks') && w.includes("'views'") && w.includes('cannot be composed')),
    ).toBe(true);
  });

  it('does NOT warn for keys the composer has a declared rule for', () => {
    const a = raw({ manifest: manifestA, api: { enableProjectScoping: true }, jobs: [] });
    const b = raw({ manifest: manifestB, server: { trustProxy: true } });

    composeStacks([a, b]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── Control — array keys keep today's concat semantics ─────────────

describe('#5005 control — array keys still concatenate', () => {
  it('concatenates in stack order, unchanged', () => {
    const a = raw({
      manifest: manifestA,
      apps: [{ name: 'a1' }],
      views: [{ name: 'v1' }],
      requires: ['ai'],
    });
    const b = raw({
      manifest: manifestB,
      apps: [{ name: 'a2' }],
      views: [{ name: 'v2' }],
      requires: ['automation'],
    });

    const composed = composeStacks([a, b]);
    expect(composed.apps?.map((x) => x.name)).toEqual(['a1', 'a2']);
    expect(composed.views?.map((x) => x.name)).toEqual(['v1', 'v2']);
    expect(composed.requires).toEqual(['ai', 'automation']);
  });

  it('concatenates the array keys that were previously dropped outright', () => {
    // These are declared `z.array(...)` on ObjectStackDefinitionSchema but were
    // missing from the concat list, so composition deleted them (#5005).
    const a = raw({
      manifest: manifestA,
      jobs: [{ name: 'j1' }],
      docs: [{ name: 'd1' }],
      books: [{ name: 'b1' }],
      datasets: [{ name: 'ds1' }],
      emailTemplates: [{ name: 'e1' }],
      datasourceMapping: [{ namespace: 'crm', datasource: 'memory' }],
      tiers: ['core'],
    });
    const b = raw({
      manifest: manifestB,
      jobs: [{ name: 'j2' }],
      docs: [{ name: 'd2' }],
      books: [{ name: 'b2' }],
      datasets: [{ name: 'ds2' }],
      emailTemplates: [{ name: 'e2' }],
      datasourceMapping: [{ default: true, datasource: 'turso' }],
      tiers: ['ai'],
    });

    const composed = composeStacks([a, b]) as Record<string, unknown[]>;
    expect(composed.jobs).toHaveLength(2);
    expect(composed.docs).toHaveLength(2);
    expect(composed.books).toHaveLength(2);
    expect(composed.datasets).toHaveLength(2);
    expect(composed.emailTemplates).toHaveLength(2);
    expect(composed.datasourceMapping).toHaveLength(2);
    expect(composed.tiers).toEqual(['core', 'ai']);
  });

  it('merges `functions` by name — the handler collection is not an opaque scalar', () => {
    const h1 = () => 'one';
    const h2 = () => 'two';
    const a = raw({ manifest: manifestA, functions: { handler_one: h1 } });
    const b = raw({ manifest: manifestB, functions: { handler_two: h2 } });

    const composed = composeStacks([a, b]) as unknown as {
      functions: Record<string, unknown>;
    };
    expect(Object.keys(composed.functions).sort()).toEqual(['handler_one', 'handler_two']);
  });

  it('errors on a duplicate function NAME rather than picking a winner', () => {
    const a = raw({ manifest: manifestA, functions: { dup: () => 'a' } });
    const b = raw({ manifest: manifestB, functions: { dup: () => 'b' } });

    expect(() => composeStacks([a, b])).toThrow(/dup/);
  });
});

// ─── Control — the pre-existing bespoke strategies are untouched ────

describe('#5005 control — manifest / objects strategies unchanged', () => {
  it('manifest still follows the `manifest` option', () => {
    const a = raw({ manifest: manifestA });
    const b = raw({ manifest: manifestB });
    expect(composeStacks([a, b]).manifest?.id).toBe('com.example.addon');
    expect(composeStacks([a, b], { manifest: 'first' }).manifest?.id).toBe('com.example.base');
    expect(composeStacks([a, b], { manifest: 0 }).manifest?.id).toBe('com.example.base');
  });

  it('objects still follow `objectConflict`', () => {
    const a = raw({ manifest: manifestA, objects: [{ name: 'task', fields: { a: {} } }] });
    const b = raw({ manifest: manifestB, objects: [{ name: 'task', fields: { b: {} } }] });

    expect(() => composeStacks([a, b])).toThrow(/object 'task'/);
    expect(composeStacks([a, b], { objectConflict: 'override' }).objects).toHaveLength(1);
  });

  // `i18n` used to be pinned here as the one bespoke strategy #5005 left alone
  // (last-wins). #5051 retired that strategy — the key is now `'single'` like
  // `api` / `server`, and its coverage lives in
  // `compose-stacks-i18n-merge.test.ts`.
});

// ─── Structural pin — every declared key has a rule ─────────────────

describe('#5005 structural pin — the schema and the composer cannot drift', () => {
  /**
   * The disposition table is typed `Record< keyof ObjectStackDefinition, … >`,
   * so a key added to the schema without a composition rule is already a
   * `tsc --noEmit` error. This is the runtime half: it catches the case the
   * type cannot see — the schema shape and the TS type drifting apart — by
   * asserting the observable contract instead of the table's contents.
   */
  it('composes a stack declaring EVERY schema key with no drops and no warnings', () => {
    const shape = (ObjectStackDefinitionSchema as unknown as { shape: Record<string, unknown> }).shape;
    const sample: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      if (key === 'manifest' || key === 'objects' || key === 'functions') continue;
      sample[key] = key === 'runtimeModule' ? './rt.mjs' : [];
    }

    const a = raw({ manifest: manifestA, ...sample });
    const b = raw({ manifest: manifestB, ...sample });
    const composed = composeStacks([a, b]) as Record<string, unknown>;

    for (const key of Object.keys(sample)) {
      expect(composed, `top-level key '${key}' was dropped by composeStacks`).toHaveProperty(key);
    }

    // Zero warnings ⇒ every schema key hit a DECLARED rule, not the default.
    // A new top-level key that nobody taught composeStacks about fails here,
    // naming itself — that is the whole point of #5005 rule 3.
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).toEqual([]);
  });
});
