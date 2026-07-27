// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3544 — the user-level EXPORT axis, at the evaluator.
 *
 * `allowExport` first shipped as a spec bit and a `/me/permissions` annotation,
 * which hid the client's Export button but enforced nothing: `export ⊆ list`,
 * so a bulk export reaches the engine middleware as an ordinary `find` gated by
 * `allowRead`, and no code path ever read the bit. #3709 added the enforcement;
 * these pin it, now under the OPT-IN posture: export is a grant, and read alone
 * never confers it.
 *
 * The fold must agree, case for case, with the `/me/permissions` per-object
 * merge in `hono-plugin.ts` (`if (v === true) acc[k] = true; …`, read back as
 * `acc.allowExport === true`). A divergence there is the same
 * declared ≠ enforced bug, just inverted: the client would offer a button the
 * server refuses.
 */

import { describe, it, expect } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { PermissionEvaluator, resolveUserExportAllowed } from './permission-evaluator';

const evaluator = new PermissionEvaluator();

/** A permission set granting `objects` as authored (defaults omitted). */
const set = (name: string, objects: Record<string, any>): PermissionSet =>
  ({ name, objects } as unknown as PermissionSet);

/** The read-granting baseline every export case builds on. */
const READER = { allowRead: true };

describe('resolveUserExportAllowed — opt-in grant fold (#3544)', () => {
  it('no set mentions export → NOT granted (read alone never confers it)', () => {
    expect(resolveUserExportAllowed('deal', [set('a', { deal: READER })])).toBe(false);
  });

  it('an explicit true → granted', () => {
    expect(
      resolveUserExportAllowed('deal', [set('a', { deal: { ...READER, allowExport: true } })]),
    ).toBe(true);
  });

  it('an explicit false → not granted (same outcome as silence)', () => {
    // Permission sets are additive capability containers (ADR-0090) — nothing
    // in them is a deny, so `false` documents intent rather than vetoing.
    expect(
      resolveUserExportAllowed('deal', [set('a', { deal: { ...READER, allowExport: false } })]),
    ).toBe(false);
  });

  it('one granting set is enough, regardless of order (most-permissive merge)', () => {
    const plain = set('plain', { deal: { ...READER, allowExport: false } });
    const grant = set('grant', { deal: { ...READER, allowExport: true } });
    expect(resolveUserExportAllowed('deal', [plain, grant])).toBe(true);
    expect(resolveUserExportAllowed('deal', [grant, plain])).toBe(true);
  });

  it('is per-object — a grant on one object does not leak to another', () => {
    const sets = [set('a', { deal: { ...READER, allowExport: true }, lead: READER })];
    expect(resolveUserExportAllowed('deal', sets)).toBe(true);
    expect(resolveUserExportAllowed('lead', sets)).toBe(false);
  });

  it("reads the '*' wildcard when the set has no explicit entry for the object", () => {
    const sets = [set('a', { '*': { ...READER, allowExport: true } })];
    expect(resolveUserExportAllowed('deal', sets)).toBe(true);
  });

  it("an explicit per-object entry overrides the '*' wildcard (lookup, not merge)", () => {
    // resolveObjectPermission returns the explicit entry INSTEAD of the
    // wildcard, so an entry that says nothing about export withholds it even
    // though the wildcard grants it.
    const sets = [set('a', { '*': { ...READER, allowExport: true }, deal: READER })];
    expect(resolveUserExportAllowed('deal', sets)).toBe(false);
  });

  it("a non-super-user '*' does not reach a PRIVATE object (ADR-0066 D2)", () => {
    const sets = [set('a', { '*': { ...READER, allowExport: true } })];
    expect(resolveUserExportAllowed('deal', sets, { isPrivate: true })).toBe(false);
    // …but a super-user wildcard carrying the grant does.
    const superSets = [set('a', { '*': { viewAllRecords: true, allowExport: true } as any })];
    expect(resolveUserExportAllowed('deal', superSets, { isPrivate: true })).toBe(true);
  });
});

describe("checkObjectPermission('export') — export ⊆ list ∧ grant (#3544)", () => {
  const canExport = (sets: PermissionSet[], opts?: { isPrivate?: boolean }) =>
    evaluator.checkObjectPermission('export', 'deal', sets, opts ?? {});

  it('a plain reader may NOT export — this is the opt-in flip', () => {
    // Pre-flip this returned true (unset inherited read). The whole point of
    // the axis is that reading a record and taking a bulk copy of the table
    // are different privileges.
    const sets = [set('a', { deal: READER })];
    expect(canExport(sets)).toBe(false);
    expect(evaluator.checkObjectPermission('find', 'deal', sets)).toBe(true);
  });

  it('allowExport:true + read → granted', () => {
    expect(canExport([set('a', { deal: { ...READER, allowExport: true } })])).toBe(true);
  });

  it('allowExport:false denies export while READ stays granted', () => {
    const sets = [set('a', { deal: { ...READER, allowExport: false } })];
    expect(canExport(sets)).toBe(false);
    // The Salesforce "Export Reports" shape: read is untouched.
    expect(evaluator.checkObjectPermission('find', 'deal', sets)).toBe(true);
  });

  it('no read grant → no export, even with allowExport:true (export ⊆ list)', () => {
    // The grant is one half of a conjunction, not an independent capability.
    // A set that says "may export" but not "may read" exports nothing.
    expect(canExport([set('a', { deal: { allowRead: false, allowExport: true } })])).toBe(false);
  });

  it('viewAllRecords satisfies the read half, but does NOT supply the grant', () => {
    // Separating "may see all data" from "may take a bulk copy" is the
    // segregation-of-duties case the axis exists for.
    expect(canExport([set('a', { deal: { viewAllRecords: true } })])).toBe(false);
    expect(canExport([set('a', { deal: { viewAllRecords: true, allowExport: true } })])).toBe(true);
  });

  it('a modifyAllRecords super-user wildcard does not imply export either', () => {
    const sets = [set('admin', { '*': { modifyAllRecords: true } })];
    expect(canExport(sets)).toBe(false);
    expect(evaluator.checkObjectPermission('find', 'deal', sets)).toBe(true);
  });

  it('the grant may come from a DIFFERENT set than the read grant', () => {
    // Additive containers: the union is what matters, not any single set.
    const sets = [
      set('reader', { deal: READER }),
      set('exporter', { deal: { allowExport: true } }),
    ];
    expect(canExport(sets)).toBe(true);
  });

  it('no matching grant at all → denied', () => {
    expect(canExport([set('a', { other: { ...READER, allowExport: true } })])).toBe(false);
  });

  it('an empty set list denies (the middleware skips its CRUD gate in that case)', () => {
    // Guard rail: the "no sets ⇒ unrestricted" decision belongs to the CALLER
    // (SecurityPlugin.canExport), matching how the middleware guards its whole
    // CRUD block. The evaluator itself never invents a grant.
    expect(canExport([])).toBe(false);
  });

  it('other operations are untouched by the axis', () => {
    const sets = [set('a', { deal: { allowRead: true, allowCreate: true } })];
    expect(evaluator.checkObjectPermission('find', 'deal', sets)).toBe(true);
    expect(evaluator.checkObjectPermission('insert', 'deal', sets)).toBe(true);
    expect(evaluator.checkObjectPermission('export', 'deal', sets)).toBe(false);
  });
});
