// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "declared ≠ enforced" surfacing (field report: rc→GA upgraded envs freeze
 * a package-declared permission set's grants, silently). Pins, one per test
 * group:
 *
 *  1. a set whose enforced grants differ from the artifact is surfaced,
 *     naming the set AND the cause;
 *  2. ⭐ the counter-direction — an in-sync set is NOT surfaced (`in_sync` is
 *     persisted as `null`, never a value that reads as a badge);
 *  3. both mechanisms are detected AND correctly attributed, including the
 *     CONFOUNDED case where `managed_by` is wrong AND an overlay exists
 *     (the exact field-reported shape) — a detector that finds drift but
 *     mislabels the cause sends the operator to the wrong remedy.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  computePermissionSetDriftDiagnostics,
  persistPermissionSetDriftDiagnostics,
  runPermissionSetDriftDiagnostics,
} from './permission-set-drift.js';
import { permissionSetRowFields } from './permission-set-projection.js';

/** Minimal in-memory ql: sys_permission_set + sys_metadata + $in support. */
function makeQl(declared: any[] = []) {
  const permRows: any[] = [];
  const metaRows: any[] = [];
  const tableFor = (object: string) =>
    object === 'sys_permission_set' ? permRows : object === 'sys_metadata' ? metaRows : null;
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      // REFUSE the combinators this double does not implement rather than
      // reading `$and`/`$or` as a column name (check:where-matcher /
      // #8494) -- neither code path under test here (drift detection reads
      // sys_permission_set/sys_metadata by id/name/type/state, batched by
      // `$in` via `buildExistingByName`) ever issues one; a matcher that
      // silently treated a combinator as a field name would let a future
      // combinator query pass this suite while answering the wrong rows.
      if (k.startsWith('$')) {
        throw new Error(`fake driver: unsupported combinator ${k}`);
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inList = (v as any).$in;
        if (Array.isArray(inList)) return inList.includes(r[k]);
        throw new Error(`fake driver: unsupported operator ${Object.keys(v).join(',')}`);
      }
      return r[k] === v;
    });
  return {
    permRows,
    metaRows,
    registry: { listItems: (type: string) => (type === 'permission' ? declared : []) },
    async find(object: string, q: any) {
      const rows = tableFor(object);
      return rows ? rows.filter((r) => matches(r, q?.where)) : [];
    },
    // Routed through the real dispatch predicate (#4434 / check:engine-double-contract):
    // a fake looser than ObjectQL.update would let persistPermissionSetDriftDiagnostics
    // drift to a call shape the real engine refuses while this suite stayed green.
    async update(object: string, data: any, options?: any) {
      const rows = tableFor(object);
      const dispatch = assertEngineUpdateDispatch(data, options);
      const targets = dispatch.kind === 'by-id'
        ? (rows ?? []).filter((r: any) => r.id === dispatch.id)
        : (rows ?? []).filter((r: any) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
  };
}

const declaredSet = (over: Record<string, any> = {}) => ({
  name: 'ehr_quality_inspector',
  label: 'Quality Inspector',
  objects: {
    obj_a: { allowRead: true }, obj_b: { allowRead: true }, obj_c: { allowRead: true },
  }, // 3 objects — "the artifact" (stands in for the field report's 49)
  _packageId: 'com.example.ehr',
  ...over,
});

/**
 * A row whose stored facets equal `declaredSet()`'s — built from the SAME
 * `permissionSetRowFields` projection the real boot seeders write, so this
 * fixture cannot drift from what `recordDiffersFromBody` actually compares
 * (label / description / all five JSON facet columns).
 */
const inSyncRow = (over: Record<string, any> = {}) => ({
  id: 'ps_1',
  name: 'ehr_quality_inspector',
  managed_by: 'package',
  package_id: 'com.example.ehr',
  ...permissionSetRowFields(declaredSet()),
  ...over,
});

describe('computePermissionSetDriftDiagnostics — pin 2 (quiet case): an in-sync set is NOT surfaced', () => {
  it('a package-owned row whose content matches the artifact reports in_sync (persisted as null)', async () => {
    const ql = makeQl([declaredSet()]);
    ql.permRows.push(inSyncRow());
    const diagnostics = await computePermissionSetDriftDiagnostics(ql);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].status).toBe('in_sync');
    expect(diagnostics[0].detail).toBeNull();

    const { updated } = await persistPermissionSetDriftDiagnostics(ql, diagnostics);
    expect(updated).toBe(0); // row already had no drift_status — nothing to write
    expect(ql.permRows[0].drift_status).toBeUndefined();
  });

  it('a steady-state re-run issues ZERO writes once drift_status already reflects the truth (#10946 discipline)', async () => {
    const ql = makeQl([declaredSet()]);
    ql.permRows.push(inSyncRow({ drift_status: null, drift_detail: null }));
    const { updated } = await runPermissionSetDriftDiagnostics(ql);
    expect(updated).toBe(0);
  });
});

describe('computePermissionSetDriftDiagnostics — pin 1 & 3: both mechanisms detected AND correctly attributed', () => {
  it("overlay_shadow: an active sys_metadata overlay shadows a managed_by:'package' row", async () => {
    const artifact = declaredSet(); // 3-object artifact
    const ql = makeQl([artifact]);
    // row currently enforces only 2 objects (the overlay's stale content)
    ql.permRows.push(inSyncRow({
      object_permissions: JSON.stringify({ obj_a: { allowRead: true }, obj_b: { allowRead: true } }),
    }));
    ql.metaRows.push({
      id: 'meta_1', type: 'permission', name: 'ehr_quality_inspector', state: 'active',
      organization_id: null,
      metadata: JSON.stringify({ name: 'ehr_quality_inspector', objects: { obj_a: {}, obj_b: {} } }),
    });

    const [d] = await computePermissionSetDriftDiagnostics(ql);
    expect(d.status).toBe('overlay_shadow');
    expect(d.detail).toContain('overlay');
    expect(d.detail).toContain('Discard');
  });

  it("provenance_skip: managed_by is NOT 'package' (legacy row), no overlay present", async () => {
    const artifact = declaredSet();
    const ql = makeQl([artifact]);
    ql.permRows.push(inSyncRow({
      managed_by: 'admin', // legacy / pre-provenance insert
      object_permissions: JSON.stringify({ obj_a: { allowRead: true } }), // frozen at an old, smaller snapshot
    }));
    // no sys_metadata overlay row at all

    const [d] = await computePermissionSetDriftDiagnostics(ql);
    expect(d.status).toBe('provenance_skip');
    expect(d.detail).toContain('managed_by');
    expect(d.detail).not.toContain('overlay is shadowing'); // never conflate the two causes' wording
  });

  it('CONFOUNDED case (the exact field-reported shape): managed_by is wrong AND an overlay exists — attributed as overlay_shadow, not provenance_skip', async () => {
    const artifact = declaredSet();
    const ql = makeQl([artifact]);
    // The row's managed_by is wrong (provenance-skip candidate) …
    ql.permRows.push(inSyncRow({
      managed_by: 'admin',
      object_permissions: JSON.stringify({ obj_a: { allowRead: true }, obj_b: { allowRead: true } }),
    }));
    // … AND an active overlay is ALSO present for the same name — the
    // decisive stale source per the field follow-up. Detection must not be
    // fooled by the wrong managed_by into calling this provenance_skip.
    ql.metaRows.push({
      id: 'meta_1', type: 'permission', name: 'ehr_quality_inspector', state: 'active',
      organization_id: null,
      metadata: JSON.stringify({ name: 'ehr_quality_inspector', objects: { obj_a: {}, obj_b: {} } }),
    });

    const [d] = await computePermissionSetDriftDiagnostics(ql);
    expect(d.status).toBe('overlay_shadow'); // correctly attributed despite the confound
  });

  it('a set with no owning package is never diagnosed (nothing to compare against)', async () => {
    const ql = makeQl([declaredSet({ _packageId: undefined, packageId: undefined })]);
    ql.permRows.push(inSyncRow({ managed_by: 'admin', object_permissions: '{}' }));
    const diagnostics = await computePermissionSetDriftDiagnostics(ql);
    expect(diagnostics).toHaveLength(0);
  });

  it('a name with no materialized row yet is skipped (boot seeding will create it, nothing to diagnose)', async () => {
    const ql = makeQl([declaredSet()]);
    const diagnostics = await computePermissionSetDriftDiagnostics(ql);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('persistPermissionSetDriftDiagnostics — writes are equality-gated', () => {
  it('writes drift_status/drift_detail once, then issues zero further writes on an unchanged re-run', async () => {
    const artifact = declaredSet();
    const ql = makeQl([artifact]);
    ql.permRows.push(inSyncRow({
      managed_by: 'admin',
      object_permissions: JSON.stringify({ obj_a: { allowRead: true } }),
    }));

    const first = await runPermissionSetDriftDiagnostics(ql);
    expect(first.updated).toBe(1);
    expect(ql.permRows[0].drift_status).toBe('provenance_skip');
    expect(typeof ql.permRows[0].drift_detail).toBe('string');

    const second = await runPermissionSetDriftDiagnostics(ql);
    expect(second.updated).toBe(0); // nothing changed — no round trip
  });
});
