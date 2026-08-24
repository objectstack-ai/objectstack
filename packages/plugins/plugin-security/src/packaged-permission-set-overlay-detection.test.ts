// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN 4 of the 2026-08-24 ruling — the detection READING for overlays that
 * already exist in live deployments.
 *
 * Ruled item 3, verbatim from the ruling comment: "implementation includes a
 * detection reading (count + names, reported loudly — e.g. a boot warning or
 * diagnostic listing), but ⛔ no automatic reap/merge — disposition of existing
 * forks is a follow-up reading for the maintainer, not a silent migration."
 *
 * So the pins are, in order of what actually goes wrong:
 *
 *  - ⭐ IDENTITIES, not just a count. Two offsetting errors — one set dropped,
 *    a different one picked up — hold a count perfectly constant while the
 *    listing names the wrong sets, and an operator acting on that listing
 *    would go and look at a healthy set while the forked one stays hidden. So
 *    every pin below asserts NAMES;
 *  - ⛔ it reaps NOTHING. Pinned as a data-level fact: the overlay row is still
 *    there afterwards, and so is the record;
 *  - the reading is LOUD — it reaches the warn channel with the count and the
 *    names on it, not just a return value nobody reads;
 *  - ⭐ the quiet case: an environment with no forks says nothing at all. A
 *    detector that warns unconditionally is a detector operators learn to
 *    ignore, which is the same as no detector.
 *
 * ## It must not depend on `customized`, and that is the card's own measurement
 *
 * `sys_permission_set.customized` is computed as
 * `existing.managed_by === 'package' ? !!customized : false`, so on the exact
 * field-reported shape — a genuinely package-declared set whose row's
 * `managed_by` predates provenance tracking — it is FORCED FALSE while an
 * overlay really is shadowing the row. The card measured it staying `0` for two
 * weeks. A reading built on it would report zero forks on the one environment
 * that had one. `sys_metadata` is therefore checked directly, exactly as
 * #9952's `drift_status` overlay-shadow branch does, and the confounded row is
 * a pin below rather than a footnote.
 *
 * ⛔ Making `customized` itself correct is NOT chartered by this ruling (it is
 * listed among the card's *candidates*), and nothing here touches it.
 */

import { describe, it, expect, vi } from 'vitest';
import { permissionSetRowFields } from './permission-set-projection.js';
import {
  detectPackagedPermissionSetOverlays,
  reportPackagedPermissionSetOverlays,
} from './packaged-permission-set-overlay-detection.js';

/** In-memory ql over `sys_permission_set` + `sys_metadata`, read-only paths. */
function makeQl(declared: any[] = []) {
  const permRows: any[] = [];
  const metaRows: any[] = [];
  const tableFor = (object: string) =>
    object === 'sys_permission_set' ? permRows : object === 'sys_metadata' ? metaRows : null;
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported combinator ${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inList = (v as any).$in;
        if (Array.isArray(inList)) return inList.includes(r[k]);
        throw new Error(`fake driver: unsupported operator ${Object.keys(v).join(',')}`);
      }
      return v === null ? (r[k] ?? null) === null : r[k] === v;
    });
  return {
    permRows,
    metaRows,
    registry: { listItems: (type: string) => (type === 'permission' ? declared : []) },
    async find(object: string, q: any) {
      const rows = tableFor(object);
      if (!rows) return [];
      const hit = rows.filter((r) => matches(r, q?.where));
      return typeof q?.limit === 'number' ? hit.slice(0, q.limit) : hit;
    },
  };
}

const declaredSet = (over: Record<string, any> = {}) => ({
  name: 'ehr_quality_inspector',
  label: 'Quality Inspector',
  objects: { obj_a: { allowRead: true }, obj_b: { allowRead: true } },
  _packageId: 'com.example.ehr',
  ...over,
});

const rowFor = (ps: any, over: Record<string, any> = {}) => ({
  id: `ps_${ps.name}`,
  name: ps.name,
  managed_by: 'package',
  package_id: ps._packageId,
  ...permissionSetRowFields(ps),
  ...over,
});

const overlayFor = (name: string, over: Record<string, any> = {}) => ({
  id: `meta_${name}`,
  type: 'permission',
  name,
  state: 'active',
  organization_id: null,
  metadata: JSON.stringify({ name, label: name, objects: {} }),
  ...over,
});

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('pin 4 — the detection reading NAMES the forked sets', () => {
  it('reports the overlay by NAME and package, not merely a count', async () => {
    const a = declaredSet();
    const b = declaredSet({ name: 'ehr_billing_clerk' });
    const ql = makeQl([a, b]);
    ql.permRows.push(rowFor(a), rowFor(b));
    ql.metaRows.push(overlayFor('ehr_quality_inspector'));

    const reading = await detectPackagedPermissionSetOverlays(ql);

    expect(reading.count).toBe(1);
    // ⭐ Identities. A count alone cannot tell "the right set" from "some set".
    expect(reading.names).toEqual(['ehr_quality_inspector']);
    expect(reading.findings[0]).toMatchObject({
      name: 'ehr_quality_inspector',
      packageId: 'com.example.ehr',
    });
    expect(reading.findings[0].overlayIds).toEqual(['meta_ehr_quality_inspector']);
    // …and the un-forked sibling is NOT named. Without this, a detector that
    // returned every declared set would satisfy the assertions above.
    expect(reading.names).not.toContain('ehr_billing_clerk');
  });

  it('names EVERY forked set when several are forked, sorted so the listing is stable', async () => {
    const a = declaredSet();
    const b = declaredSet({ name: 'ehr_billing_clerk' });
    const c = declaredSet({ name: 'ehr_admin' });
    const ql = makeQl([a, b, c]);
    ql.permRows.push(rowFor(a), rowFor(b), rowFor(c));
    ql.metaRows.push(overlayFor('ehr_quality_inspector'), overlayFor('ehr_admin'));

    const reading = await detectPackagedPermissionSetOverlays(ql);
    expect(reading.count).toBe(2);
    expect(reading.names).toEqual(['ehr_admin', 'ehr_quality_inspector']);
  });

  it('⭐ finds the CONFOUNDED row the card measured — managed_by wrong AND an overlay present', async () => {
    // The field-reported shape. `customized` is forced false here by
    // `upsertEnvPermissionSet`'s `existing.managed_by === 'package'` gate, so a
    // reading that consulted the column would report zero forks on precisely
    // the environment that had one — for two weeks, measured.
    const a = declaredSet();
    const ql = makeQl([a]);
    ql.permRows.push(rowFor(a, { managed_by: 'user', package_id: null, customized: 0 }));
    ql.metaRows.push(overlayFor('ehr_quality_inspector'));

    const reading = await detectPackagedPermissionSetOverlays(ql);
    expect(reading.names).toEqual(['ehr_quality_inspector']);
    expect(
      ql.permRows[0].customized,
      "the column still reads 'not customized' — which is exactly why it is not the source",
    ).toBeFalsy();
  });

  it('an overlay whose name NO package declares is not reported — it is an ordinary env-authored set', async () => {
    // The counter-direction. Every env-authored permission set has a
    // `sys_metadata` row; a reading that listed them all would report a healthy
    // environment as entirely forked, and be discarded within a day.
    const ql = makeQl([declaredSet()]);
    ql.metaRows.push(overlayFor('org_support_agent'));
    const reading = await detectPackagedPermissionSetOverlays(ql);
    expect(reading.count).toBe(0);
    expect(reading.names).toEqual([]);
  });

  it('the legacy plural type spelling is read too', async () => {
    const a = declaredSet();
    const ql = makeQl([a]);
    ql.permRows.push(rowFor(a));
    ql.metaRows.push(overlayFor('ehr_quality_inspector', { id: 'meta_plural', type: 'permissions' }));
    const reading = await detectPackagedPermissionSetOverlays(ql);
    expect(reading.names).toEqual(['ehr_quality_inspector']);
  });

  it('an ORG-scoped overlay row is out of scope, the same as everywhere else in this family', async () => {
    // `reconcilePermissionSetProjection` and `permission-set-drift.ts` both
    // consider env-wide overlays only (#10103 residue, deliberately out of
    // scope). A reading that answered a different question from the reconciler
    // it is reporting on would send an operator to a row the reconciler never
    // touches.
    const a = declaredSet();
    const ql = makeQl([a]);
    ql.permRows.push(rowFor(a));
    ql.metaRows.push(overlayFor('ehr_quality_inspector', { organization_id: 'org_1' }));
    const reading = await detectPackagedPermissionSetOverlays(ql);
    expect(reading.count).toBe(0);
  });
});

describe('⛔ pin 4 — the reading REAPS NOTHING', () => {
  it('the overlay row and the record are both still there afterwards', async () => {
    const a = declaredSet();
    const ql = makeQl([a]);
    ql.permRows.push(rowFor(a));
    ql.metaRows.push(overlayFor('ehr_quality_inspector'));
    const metaBefore = JSON.stringify(ql.metaRows);
    const permBefore = JSON.stringify(ql.permRows);

    await reportPackagedPermissionSetOverlays(ql, { logger: logger() });

    expect(ql.metaRows.length, 'the overlay row is untouched — disposition is the maintainer\'s call').toBe(1);
    expect(JSON.stringify(ql.metaRows)).toBe(metaBefore);
    expect(JSON.stringify(ql.permRows)).toBe(permBefore);
  });

  it('the double exposes no write verb at all, so a reap could not even be expressed', async () => {
    // Stronger than asserting the rows survived: this harness has no `insert`,
    // `update` or `delete`. If a reap is ever added to this reading, it fails
    // here with a TypeError instead of quietly passing on rows that happened
    // not to match.
    const ql = makeQl([declaredSet()]);
    expect((ql as any).update).toBeUndefined();
    expect((ql as any).delete).toBeUndefined();
    expect((ql as any).insert).toBeUndefined();
    await expect(reportPackagedPermissionSetOverlays(ql, { logger: logger() })).resolves.toBeTruthy();
  });
});

describe('pin 4 — the reading is LOUD, and quiet when there is nothing to say', () => {
  it('warns with the count AND the names on the meta', async () => {
    const a = declaredSet();
    const ql = makeQl([a]);
    ql.permRows.push(rowFor(a));
    ql.metaRows.push(overlayFor('ehr_quality_inspector'));
    const log = logger();

    await reportPackagedPermissionSetOverlays(ql, { logger: log });

    expect(log.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = log.warn.mock.calls[0];
    expect(String(message)).toMatch(/package-declared permission set/i);
    // ⭐ The names travel WITH the warning. A count-only line sends an operator
    // looking through every set they own.
    expect(meta).toMatchObject({ count: 1, names: ['ehr_quality_inspector'] });
    // …and it says outright that nothing was reaped, so nobody reads the line
    // as "handled".
    expect(String(message)).toMatch(/nothing (has been |was )?(reaped|removed|changed)/i);
  });

  it('⭐ says NOTHING on a clean environment', async () => {
    const a = declaredSet();
    const ql = makeQl([a]);
    ql.permRows.push(rowFor(a));
    const log = logger();
    const reading = await reportPackagedPermissionSetOverlays(ql, { logger: log });
    expect(reading.count).toBe(0);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('a kernel with no readable artifact registry reports nothing rather than guessing', async () => {
    // No SchemaRegistry means no way to know which names a package declares.
    // The READING is not a write door, so the fail-closed direction here is the
    // opposite one: naming sets it cannot prove are packaged would send
    // operators after env-authored work. It stays silent, which is honest.
    const ql: any = makeQl([]);
    delete ql.registry;
    ql.metaRows.push(overlayFor('ehr_quality_inspector'));
    const log = logger();
    const reading = await reportPackagedPermissionSetOverlays(ql, { logger: log });
    expect(reading.count).toBe(0);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
