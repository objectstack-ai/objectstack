// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry, parseFQN } from './registry.js';

/**
 * #10945 — the short-name→FQN index behind `SchemaRegistry.resolveObjectKey`.
 *
 * `resolveObjectKey` used to answer the short-name direction by walking EVERY
 * key of `objectContributors` and calling `parseFQN` on each. It is reached
 * from seven call sites, `getObject` among them, so a kernel boot that
 * registers N objects and resolves O(N) names did O(N²) string work — measured
 * at exponent ≈1.89 against stored `sys_metadata` rows, with `parseFQN` the
 * largest non-database entry in the CPU profile. The consequence was not a
 * failure but a silence: a hosted environment's bootstrap outgrew its 20s
 * request waiter (134s in production), so every request answered
 * `kernel_warming` and the environment could never be opened, with no error
 * anywhere.
 *
 * The fix is an index `Map` maintained beside `objectContributors`. This file
 * pins the two properties triage named as required, plus the curve itself:
 *
 *   (a) a lookup does not depend on registration order — asserted as EXACT
 *       equivalence with the scan it replaces, over every permutation, so
 *       "which FQN wins for an ambiguous short name" cannot change silently;
 *   (b) the removal verbs keep both maps in step — asserted structurally, by
 *       deriving the index from `objectContributors` and comparing.
 *
 * (a) is deliberately written as an equivalence rather than a fixed
 * expectation. The pre-fix scan returned `matches[0]`, i.e. the FIRST key
 * registered under an ambiguous short name; an index could as easily have
 * become last-writer-wins without anything failing. The reference
 * implementation below IS the old loop, so any such drift reds here.
 */

const quiet = () => {
  const r = new SchemaRegistry({ multiTenant: false });
  (r as any).logLevel = 'silent';
  return r;
};

const objectBody = (name: string) => ({
  name,
  label: name,
  fields: { name: { name: 'name', type: 'text', label: 'name' } },
}) as any;

/**
 * The pre-#10945 resolution, verbatim: scan every contributor key, keep the
 * ones whose short name matches, take the first. Kept as the oracle the index
 * is measured against — a hand-written expectation would only pin what the
 * author of the fix believed, which is the drift this file exists to catch.
 */
const scanResolve = (r: SchemaRegistry, name: string): string | undefined => {
  const contributors: Map<string, unknown> = (r as any).objectContributors;
  const matches: string[] = [];
  for (const fqn of contributors.keys()) {
    if (parseFQN(fqn).shortName === name) matches.push(fqn);
  }
  if (matches.length > 0) return matches[0];
  return contributors.has(name) ? name : undefined;
};

/** The index `objectContributors` implies, rebuilt from scratch. */
const derivedIndex = (r: SchemaRegistry): Map<string, string[]> => {
  const contributors: Map<string, unknown> = (r as any).objectContributors;
  const index = new Map<string, string[]>();
  for (const fqn of contributors.keys()) {
    const { shortName } = parseFQN(fqn);
    const bucket = index.get(shortName);
    if (bucket) bucket.push(fqn);
    else index.set(shortName, [fqn]);
  }
  return index;
};

const liveIndex = (r: SchemaRegistry): Map<string, string[]> =>
  (r as any).objectKeysByShortName;

const resolveKey = (r: SchemaRegistry, name: string): string | undefined =>
  (r as any).resolveObjectKey(name);

/** Every ordering of `items` — the input to the order-independence pin. */
const permutations = <T,>(items: readonly T[]): T[][] => {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
};

describe('#10945 — short-name index: property (a), resolution is the scan it replaced', () => {
  /**
   * `computeFQN` is the identity function (Prime Directive #6), so a
   * contributor key differs from its short name only for LEGACY `<ns>__<name>`
   * names — which is precisely where a short name becomes ambiguous, and
   * therefore where an index can change the answer. The name set below mixes
   * all three shapes on purpose: a plain key, two legacy keys colliding on one
   * short name, and a plain key colliding with a legacy one.
   */
  const NAMES = ['invoice', 'crm__account', 'erp__account', 'account'] as const;
  const PROBES = ['invoice', 'account', 'crm__account', 'erp__account', 'absent'] as const;

  it('resolves identically to the full-registry scan, for EVERY registration order', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const orders = permutations(NAMES);
      expect(orders).toHaveLength(24);

      for (const order of orders) {
        const r = quiet();
        for (const name of order) r.registerObject(objectBody(name), `app.${order.indexOf(name)}`);

        for (const probe of PROBES) {
          expect(
            resolveKey(r, probe),
            `probe "${probe}" after registering ${order.join(' → ')}`,
          ).toBe(scanResolve(r, probe));
        }
      }
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * The behaviour that equivalence pins, stated in the open so a future reader
   * does not have to run the oracle in their head: for an ambiguous short name
   * the FIRST key registered under it wins, and the loser is still reachable
   * by its full key. This is unchanged from before the index — recorded here
   * because it is observable through the public `getObject`.
   */
  it('an ambiguous short name resolves to the FIRST key registered under it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const crmFirst = quiet();
      crmFirst.registerObject(objectBody('crm__account'), 'app.crm');
      crmFirst.registerObject(objectBody('erp__account'), 'app.erp');
      expect((crmFirst.getObject('account') as any).name).toBe('crm__account');

      const erpFirst = quiet();
      erpFirst.registerObject(objectBody('erp__account'), 'app.erp');
      erpFirst.registerObject(objectBody('crm__account'), 'app.crm');
      expect((erpFirst.getObject('account') as any).name).toBe('erp__account');

      // The loser stays addressable by its full key — the disambiguation form.
      expect((erpFirst.getObject('crm__account') as any).name).toBe('crm__account');
    } finally {
      warn.mockRestore();
    }
  });

  it('still warns on an ambiguous short name, naming every match in registry order', () => {
    const r = quiet();
    r.registerObject(objectBody('crm__account'), 'app.crm');
    r.registerObject(objectBody('erp__account'), 'app.erp');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      r.getObject('account');
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]?.[0]);
      expect(msg).toContain('Ambiguous short name "account"');
      expect(msg).toContain('crm__account, erp__account');
    } finally {
      warn.mockRestore();
    }
  });

  it('an unambiguous short name warns not at all', () => {
    const r = quiet();
    r.registerObject(objectBody('invoice'), 'app.billing');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(r.getObject('invoice')).toBeDefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('#10945 — short-name index: property (b), both maps move together', () => {
  /**
   * The #6808 contract one layer down: the read path and the name-addressed
   * removal path must not disagree about which contributor a bare name
   * addresses. A second index is exactly where that could drift, so every
   * mutation verb is asserted structurally — the live index must equal the one
   * `objectContributors` implies — rather than only through its symptoms.
   */
  const assertInStep = (r: SchemaRegistry, where: string) => {
    expect(liveIndex(r), where).toEqual(derivedIndex(r));
  };

  it('holds across register → unregisterObject → re-register', () => {
    const r = quiet();
    r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
    r.registerObject(objectBody('myapp_line'), 'app.myapp');
    assertInStep(r, 'after registering two objects');

    expect(r.unregisterObject('myapp_invoice')).toBe(true);
    assertInStep(r, 'after unregisterObject');
    expect(r.getObject('myapp_invoice')).toBeUndefined();
    expect(resolveKey(r, 'myapp_invoice')).toBeUndefined();
    // The sibling is untouched — one name removed, not the bucket's neighbours.
    expect(r.getObject('myapp_line')).toBeDefined();

    r.registerObject(objectBody('myapp_invoice'), 'app.myapp');
    assertInStep(r, 'after re-registering');
    expect(r.getObject('myapp_invoice')).toBeDefined();
  });

  it('holds when a legacy key leaves a bucket its plain twin still occupies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = quiet();
      r.registerObject(objectBody('crm__account'), 'app.crm');
      r.registerObject(objectBody('account'), 'app.core');
      assertInStep(r, 'both keys registered');

      // Addressed by its FULL key, so the ambiguous short name is not consulted.
      expect(r.unregisterObject('crm__account')).toBe(true);
      assertInStep(r, 'after the legacy key left');

      // The survivor is now unambiguous and resolves to itself.
      expect(resolveKey(r, 'account')).toBe('account');
      expect(r.getObject('account')).toBeDefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('holds when the LAST key of a bucket leaves — no stale empty bucket', () => {
    const r = quiet();
    r.registerObject(objectBody('crm__account'), 'app.crm');
    expect(resolveKey(r, 'account')).toBe('crm__account');

    expect(r.unregisterObject('account')).toBe(true);
    assertInStep(r, 'after the only key left');
    expect(liveIndex(r).has('account')).toBe(false);
    expect(resolveKey(r, 'account')).toBeUndefined();
    expect(resolveKey(r, 'crm__account')).toBeUndefined();
  });

  it('holds through unregisterObjectsByPackage', () => {
    const r = quiet();
    r.registerObject(objectBody('crm_account'), 'app.crm');
    r.registerObject(objectBody('crm_contact'), 'app.crm');
    r.registerObject(objectBody('billing_invoice'), 'app.billing');

    r.unregisterObjectsByPackage('app.crm');
    assertInStep(r, 'after the package uninstall');
    expect(r.getObject('crm_account')).toBeUndefined();
    expect(r.getObject('crm_contact')).toBeUndefined();
    expect(r.getObject('billing_invoice')).toBeDefined();
  });

  it('holds through reset()', () => {
    const r = quiet();
    r.registerObject(objectBody('crm_account'), 'app.crm');
    r.reset();
    assertInStep(r, 'after reset');
    expect(liveIndex(r).size).toBe(0);
    expect(resolveKey(r, 'crm_account')).toBeUndefined();
  });

  /**
   * The read verb and the removal verb resolve through the SAME method, so a
   * removal always takes the entry that was being served. Asserted end-to-end
   * on the ambiguous case, where "the served one" and "some matching one" can
   * differ.
   */
  it('removal takes exactly the entry the read was serving, ambiguity included', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = quiet();
      r.registerObject(objectBody('crm__account'), 'app.crm');
      r.registerObject(objectBody('erp__account'), 'app.erp');

      const served = (r.getObject('account') as any).name as string;
      expect(r.unregisterObject('account')).toBe(true);
      assertInStep(r, 'after the ambiguous removal');

      expect(r.resolveObject(served)).toBeUndefined();
      expect((r.getObject('account') as any).name).not.toBe(served);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('#10945 — the curve flattens', () => {
  /**
   * The defect is a SHAPE, not a constant, so this asserts a shape: the cost of
   * resolving one name per registered object, at two registry sizes 8x apart.
   *
   * Measured here, one container, same run: with the index the ratio is
   * **5.7–11.1**; with `resolveObjectKey` reverted to the full-registry scan it
   * is **62.5** — 8x more lookups, each scanning an 8x longer registry, which
   * is the quadratic signature exactly. (Absolutes, big window: **2.3ms** with
   * the index, **4,888ms** without.) The healthy ratio sits above a flat 8x
   * because a 4,000-entry `Map` has worse locality than a 500-entry one, which
   * is real and does not average away.
   *
   * The 30x ceiling is placed between those two populations rather than close
   * to either: ~2.7x above the worst healthy sample, ~2x below the ablated one.
   * Erring toward the quadratic side is deliberate and follows the same
   * reasoning as `protocol-handshake.test.ts` — a scaling assertion that reds
   * on scheduler noise gets weakened or deleted, so the flake margin is worth
   * more than the last factor of detection sensitivity.
   *
   * Method follows `packages/metadata-core/src/protocol-handshake.test.ts`: the
   * registries and name lists are built ONCE outside the clock, the JIT is
   * warmed, and the ratio is reduced by MINIMUM over repeats — a scheduler
   * steal can only ever make a timing longer, so the cheapest observed pair is
   * the one iteration that ran cleanest end to end. Both scans are taken
   * back-to-back inside one iteration so a steal landing in one window does not
   * skew a ratio assembled from independently-minimised timings.
   */
  it('resolves N names over N objects in time that grows ~linearly, not quadratically', () => {
    const SMALL = 500;
    const BIG = 4_000; // 8x
    // Lifts both windows clear of timer noise (the small one measured 0.15ms at
    // PASSES=8, low enough for scheduler jitter to move the ratio); scales both
    // alike, so the 8x the ratio is testing is untouched.
    const PASSES = 40;

    const build = (n: number) => {
      const r = quiet();
      const names: string[] = [];
      for (let i = 0; i < n; i++) {
        const name = `perf_obj_${i}`;
        r.registerObject(objectBody(name), 'app.perf');
        names.push(name);
      }
      return { r, names };
    };

    const small = build(SMALL);
    const big = build(BIG);

    const scan = ({ r, names }: { r: SchemaRegistry; names: string[] }): number => {
      const t = performance.now();
      for (let pass = 0; pass < PASSES; pass++) {
        for (const name of names) r.getObject(name);
      }
      return performance.now() - t;
    };

    // Warm the JIT and fill `mergedObjectCache`, so the clocked windows measure
    // name RESOLUTION and not first-touch merging.
    for (let i = 0; i < 5; i++) {
      scan(small);
      scan(big);
    }

    let ratio = Infinity;
    for (let i = 0; i < 12; i++) {
      ratio = Math.min(ratio, scan(big) / scan(small));
    }

    expect(ratio).toBeLessThan(30);
  });
});
