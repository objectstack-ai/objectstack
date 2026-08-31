// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
// `.js` extension, deliberately: under `moduleResolution: NodeNext` a relative
// import without it does not RESOLVE, so every symbol it names becomes `any` —
// and the type-layer ratchet reads this file (`TEST_DEBT`, via the package's
// tsconfig with the test exclusion lifted). The bare specifier here was
// costing 1 × TS2835 plus one TS7006 per callback parameter in the file.
import { deriveCrudCases } from './derive.js';

describe('deriveCrudCases — federated (external) objects (ADR-0015)', () => {
  it('blocks a read-only external object so verify never probe-inserts it', () => {
    const config = {
      datasources: [{ name: 'wh', schemaMode: 'external', external: { allowWrites: false } }],
      objects: [
        { name: 'wh_order', datasource: 'wh', external: { remoteName: 'orders' }, fields: { amount: { type: 'number' } } },
      ],
    };
    const c = deriveCrudCases(config).find((x) => x.object === 'wh_order');
    expect(c?.blocked).toMatch(/external read-only/);
  });

  it('blocks when the object opts in but the datasource does not', () => {
    const config = {
      datasources: [{ name: 'wh', schemaMode: 'external', external: { allowWrites: false } }],
      objects: [
        { name: 'wh_order', datasource: 'wh', external: { remoteName: 'orders', writable: true }, fields: { amount: { type: 'number' } } },
      ],
    };
    const c = deriveCrudCases(config).find((x) => x.object === 'wh_order');
    expect(c?.blocked).toMatch(/external read-only/);
  });

  it('does NOT block a fully write-opted-in external object (datasource + object)', () => {
    const config = {
      datasources: [{ name: 'wh', schemaMode: 'external', external: { allowWrites: true } }],
      objects: [
        { name: 'wh_order', datasource: 'wh', external: { remoteName: 'orders', writable: true }, fields: { amount: { type: 'number' } } },
      ],
    };
    const c = deriveCrudCases(config).find((x) => x.object === 'wh_order');
    expect(c?.blocked).toBeFalsy();
  });

  it('leaves managed objects unaffected', () => {
    const config = { objects: [{ name: 'task', fields: { title: { type: 'text' } } }] };
    const c = deriveCrudCases(config).find((x) => x.object === 'task');
    expect(c?.blocked).toBeFalsy();
  });
});

/**
 * [#13250] `reference_to` / `referenceTo` are REJECTED aliases of `reference`
 * (#11567 — "one key, one answer"), and this deriver used to read them as
 * accepted fallbacks. It was narrowed (maintainer ruling, 2026-08-30) because
 * its failure mode is a report line rather than a refusal — but the narrowing
 * is only safe if the report says WHY.
 *
 * ## What each half of this suite is for
 *
 * The NARROWING alone would be indistinguishable from a bug: an alias-spelled
 * required relation would become `blocked` with the same generic "has no
 * `reference` target" sentence an object with no relationship metadata at all
 * gets. The operator would read "this object could not be derived" and never
 * learn the cause was a key the platform refuses — one silent seam traded for
 * another (#5262's defect). So every test that pins the narrowing has a
 * partner pinning the REASON, and the reason assertions are written against
 * the sentence's meaning (it names the alias, and names `reference` as what to
 * write instead), not against its punctuation.
 *
 * The alias is genuinely reachable here — `loadConfig()` does not parse, and
 * both a plain-object config and `defineStack(cfg, { strict: false })` carry an
 * unparsed shape into `deriveCrudCases` — so these are not hypothetical
 * fixtures.
 */
describe('deriveCrudCases — rejected `reference` aliases are narrowed AND named (#13250)', () => {
  const withRef = (fieldDef: Record<string, unknown>) => ({
    objects: [
      { name: 'company', fields: { title: { type: 'text' } } },
      { name: 'contact', fields: { company_id: fieldDef } },
    ],
  });

  it('a REQUIRED alias-spelled relation is blocked — the alias no longer derives a target', () => {
    const c = deriveCrudCases(
      withRef({ type: 'lookup', required: true, reference_to: 'company' }),
    ).find((x) => x.object === 'contact');
    expect(c?.blocked).toBeTruthy();
    // ⛔ NOT a relationalRef: the whole point of the narrowing is that the
    // alias stops resolving a target here.
    expect(c?.relationalRefs).toBeUndefined();
  });

  it('…and the block says WHY — it names the alias and names `reference` as the fix', () => {
    const c = deriveCrudCases(
      withRef({ type: 'lookup', required: true, reference_to: 'company' }),
    ).find((x) => x.object === 'contact');
    expect(c?.blocked).toContain('reference_to');
    expect(c?.blocked).toMatch(/rejected alias/i);
    expect(c?.blocked).toContain('company_id');
    // The target the app MEANT is echoed, so the reader can see the rename is
    // mechanical rather than a metadata investigation.
    expect(c?.blocked).toContain('company');
    // ⛔ The load-bearing NEGATIVE: it must not degrade to the generic sentence
    // an object with no relationship metadata at all receives. Without this,
    // narrowing to the generic message would pass every assertion above.
    expect(c?.blocked).not.toMatch(/has no `reference` target/);
  });

  it('`referenceTo` is named too — the alias list is not just the snake_case one', () => {
    const c = deriveCrudCases(
      withRef({ type: 'master_detail', required: true, referenceTo: 'company' }),
    ).find((x) => x.object === 'contact');
    expect(c?.blocked).toContain('referenceTo');
    expect(c?.blocked).toMatch(/rejected alias/i);
  });

  it('an OPTIONAL alias-spelled relation is skipped under its OWN reason, not the generic one', () => {
    const c = deriveCrudCases(
      withRef({ type: 'lookup', reference_to: 'company' }),
    ).find((x) => x.object === 'contact');
    expect(c?.blocked).toBeFalsy();
    const reasons = (c?.skippedFields ?? []).map((s) => s.reason);
    expect(reasons).toContain('relation-rejected-reference-alias:reference_to');
    expect(reasons).not.toContain('relation-missing-reference');
  });

  it('a relation with NO target at all keeps the generic reason — the two findings stay distinct', () => {
    const blocked = deriveCrudCases(
      withRef({ type: 'lookup', required: true }),
    ).find((x) => x.object === 'contact');
    expect(blocked?.blocked).toMatch(/has no `reference` target/);
    expect(blocked?.blocked).not.toMatch(/rejected alias/i);

    const skipped = deriveCrudCases(
      withRef({ type: 'lookup' }),
    ).find((x) => x.object === 'contact');
    expect((skipped?.skippedFields ?? []).map((s) => s.reason)).toContain('relation-missing-reference');
  });

  it('the canonical `reference` still derives a target — the narrowing did not break the live path', () => {
    const c = deriveCrudCases(
      withRef({ type: 'lookup', required: true, reference: 'company' }),
    ).find((x) => x.object === 'contact');
    expect(c?.blocked).toBeFalsy();
    expect(c?.relationalRefs).toEqual([
      { field: 'company_id', target: 'company', required: true, multiple: false },
    ]);
  });

  it('canonical WINS over a stale alias on the same field, and reports nothing', () => {
    const c = deriveCrudCases(
      withRef({ type: 'lookup', required: true, reference: 'company', reference_to: 'stale_legacy' }),
    ).find((x) => x.object === 'contact');
    expect(c?.blocked).toBeFalsy();
    expect(c?.relationalRefs?.[0]?.target).toBe('company');
  });

  it('an EMPTY alias value is not a finding — there is no spelling to rename', () => {
    const c = deriveCrudCases(
      withRef({ type: 'lookup', required: true, reference_to: '' }),
    ).find((x) => x.object === 'contact');
    expect(c?.blocked).toMatch(/has no `reference` target/);
    expect(c?.blocked).not.toMatch(/rejected alias/i);
  });
});
