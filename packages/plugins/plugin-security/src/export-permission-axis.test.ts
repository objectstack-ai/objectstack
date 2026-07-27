// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3544 — the user-level EXPORT axis, at the evaluator.
 *
 * `allowExport` shipped as a spec bit and a `/me/permissions` annotation, which
 * hid the client's Export button but enforced nothing: `export ⊆ list`, so a
 * bulk export reaches the engine middleware as an ordinary `find` gated by
 * `allowRead`, and no code path ever read the bit. These pin the enforcement
 * half — the evaluator's `export` branch and the tri-state fold it rests on.
 *
 * The fold must agree, case for case, with the `/me/permissions` per-object
 * merge in `hono-plugin.ts` (`if (v === true) acc[k] = true; else if
 * (acc[k] === undefined) acc[k] = v`, read back as `acc.allowExport !== false`).
 * A divergence there is the same declared ≠ enforced bug, just inverted: the
 * client would offer a button the server refuses.
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

describe('resolveUserExportAllowed — tri-state fold (#3544)', () => {
  it('all sets unset → undefined (inherit read, backward-compatible)', () => {
    expect(resolveUserExportAllowed('deal', [set('a', { deal: READER })])).toBeUndefined();
  });

  it('an explicit false → false', () => {
    expect(
      resolveUserExportAllowed('deal', [set('a', { deal: { ...READER, allowExport: false } })]),
    ).toBe(false);
  });

  it('an explicit true → true', () => {
    expect(
      resolveUserExportAllowed('deal', [set('a', { deal: { ...READER, allowExport: true } })]),
    ).toBe(true);
  });

  it('true outranks false regardless of set order (most-permissive merge)', () => {
    const deny = set('deny', { deal: { ...READER, allowExport: false } });
    const grant = set('grant', { deal: { ...READER, allowExport: true } });
    expect(resolveUserExportAllowed('deal', [deny, grant])).toBe(true);
    expect(resolveUserExportAllowed('deal', [grant, deny])).toBe(true);
  });

  it('false outranks silence — one opt-out set denies even alongside plain readers', () => {
    expect(
      resolveUserExportAllowed('deal', [
        set('reader', { deal: READER }),
        set('no_export', { deal: { ...READER, allowExport: false } }),
      ]),
    ).toBe(false);
  });

  it('is per-object — a deny on one object leaves another untouched', () => {
    const sets = [set('a', { deal: { ...READER, allowExport: false }, lead: READER })];
    expect(resolveUserExportAllowed('deal', sets)).toBe(false);
    expect(resolveUserExportAllowed('lead', sets)).toBeUndefined();
  });

  it("reads the '*' wildcard when the set has no explicit entry for the object", () => {
    const sets = [set('a', { '*': { ...READER, allowExport: false } })];
    expect(resolveUserExportAllowed('deal', sets)).toBe(false);
  });

  it("an explicit per-object entry overrides the '*' wildcard", () => {
    const sets = [set('a', { '*': { ...READER, allowExport: false }, deal: { ...READER, allowExport: true } })];
    expect(resolveUserExportAllowed('deal', sets)).toBe(true);
  });

  it("a non-super-user '*' does not reach a PRIVATE object (ADR-0066 D2)", () => {
    const sets = [set('a', { '*': { ...READER, allowExport: false } })];
    expect(resolveUserExportAllowed('deal', sets, { isPrivate: true })).toBeUndefined();
    // …but a super-user wildcard does.
    const superSets = [set('a', { '*': { viewAllRecords: true, allowExport: false } as any })];
    expect(resolveUserExportAllowed('deal', superSets, { isPrivate: true })).toBe(false);
  });
});

describe("checkObjectPermission('export') — export ⊆ list ∧ allowExport (#3544)", () => {
  const canExport = (sets: PermissionSet[], opts?: { isPrivate?: boolean }) =>
    evaluator.checkObjectPermission('export', 'deal', sets, opts ?? {});

  it('unset allowExport inherits read — a plain reader may still export', () => {
    // The whole point of the opt-out default: every permission set authored
    // before this axis existed keeps working unchanged.
    expect(canExport([set('a', { deal: READER })])).toBe(true);
  });

  it('allowExport:false denies export while READ stays granted', () => {
    const sets = [set('a', { deal: { ...READER, allowExport: false } })];
    expect(canExport(sets)).toBe(false);
    // The Salesforce "Export Reports" shape: read is untouched.
    expect(evaluator.checkObjectPermission('find', 'deal', sets)).toBe(true);
  });

  it('allowExport:true grants export', () => {
    expect(canExport([set('a', { deal: { ...READER, allowExport: true } })])).toBe(true);
  });

  it('no read grant → no export, even with allowExport:true (export ⊆ list)', () => {
    // The axis NARROWS read; it is not an independent grant. A set that says
    // "may export" but not "may read" exports nothing.
    expect(canExport([set('a', { deal: { allowRead: false, allowExport: true } })])).toBe(false);
  });

  it('no matching grant at all → denied', () => {
    expect(canExport([set('a', { other: READER })])).toBe(false);
  });

  it('viewAllRecords satisfies the read half', () => {
    expect(canExport([set('a', { deal: { viewAllRecords: true } })])).toBe(true);
  });

  it('a super-user wildcard does NOT bypass an explicit per-object export deny', () => {
    // modifyAllRecords is a bypass for the CRUD bits, not a licence to exfiltrate
    // an object whose set explicitly opted out of export.
    const sets = [
      set('admin', { '*': { modifyAllRecords: true } }),
      set('no_export', { deal: { ...READER, allowExport: false } }),
    ];
    expect(canExport(sets)).toBe(false);
    expect(evaluator.checkObjectPermission('find', 'deal', sets)).toBe(true);
  });

  it('an empty set list denies (the middleware skips its CRUD gate in that case)', () => {
    // Guard rail: the "no sets ⇒ unrestricted" decision belongs to the CALLER
    // (SecurityPlugin.canExport), matching how the middleware guards its whole
    // CRUD block. The evaluator itself never invents a grant.
    expect(canExport([])).toBe(false);
  });

  it('other operations are untouched by the axis', () => {
    const sets = [set('a', { deal: { allowRead: true, allowCreate: true, allowExport: false } })];
    expect(evaluator.checkObjectPermission('find', 'deal', sets)).toBe(true);
    expect(evaluator.checkObjectPermission('insert', 'deal', sets)).toBe(true);
    expect(evaluator.checkObjectPermission('export', 'deal', sets)).toBe(false);
  });
});
