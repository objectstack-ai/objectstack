// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4551] Dangling stored references are FOUND, and nothing is rewritten.
 *
 * #4441 made the write path refuse an unresolvable lookup id, but exempted
 * `isSystem` writes so seed replay / package install / boot provisioning keep
 * their ordering freedom. Correct — and it leaves the platform itself able to
 * write a reference into the void with nothing saying so. This suite pins the
 * "something says so".
 *
 * Every assertion here is written to FAIL if the corresponding judgment is
 * removed from the audit:
 *
 *  - drop the probe verdict  → "finds a dangling reference" fails
 *  - condemn on a failed probe → "an unprobeable target is undetermined" fails
 *  - report on an existing row → "does NOT report a reference that resolves" fails
 *  - add any write            → "NEVER rewrites" fails (data JSON compared)
 *  - drop the readonly skip   → "a readonly reference is not audited" fails
 *  - drop the empty-value skip → "empty is not a reference" fails
 */

import { describe, it, expect } from 'vitest';
import {
  auditDanglingReferences,
  SECURITY_SURFACE_OBJECTS,
  type AuditableObject,
  type DanglingReferenceAuditPort,
} from './dangling-reference-audit.js';

/** The RBAC link-table shape #4551 calls out as the priority case. */
const binding: AuditableObject = {
  name: 'sys_position_permission_set',
  fields: {
    id: { type: 'text', primaryKey: true },
    position_id: { type: 'lookup', reference: 'sys_position' },
    permission_set_id: { type: 'lookup', reference: 'sys_permission_set' },
    note: { type: 'text' },
  },
};

/** An ordinary business object with an optional lookup and a multi-value one. */
const task: AuditableObject = {
  name: 'showcase_task',
  fields: {
    id: { type: 'text', primaryKey: true },
    title: { type: 'text' },
    project: { type: 'lookup', reference: 'showcase_project' },
    tags: { type: 'lookup', reference: 'showcase_tag', multiple: true },
    // Audit-provenance shape: readonly, platform-minted (`applySystemFields`
    // stamps `created_by` exactly like this). #4441 skips it on the write path
    // because the value there is never the caller's; the audit skips it for the
    // same reason — `sys_metadata_history.recorded_by` legitimately holds the
    // SENTINEL STRING 'system'.
    created_by: { type: 'lookup', reference: 'sys_user', readonly: true },
  },
};

/**
 * A test double whose probe answers with EXACTLY the three-valued contract the
 * real `ObjectQL.referenceExists` answers with — `true` / `false` / `null` for
 * "could not run". #4550's failure mode is a double looser than the real
 * implementation; a two-valued probe here would quietly delete the entire
 * `undetermined` axis from the suite.
 */
function makePort(opts: {
  objects: AuditableObject[];
  rows: Record<string, Array<Record<string, unknown>>>;
  /** Ids that exist, as `${target} ${id}`. Anything else probes `false`. */
  existing?: Set<string>;
  /** Targets whose probe cannot run at all → `null`. */
  unprobeable?: Set<string>;
  /** Targets whose probe THROWS (must be read as unknown, never as absent). */
  throwingTargets?: Set<string>;
  /** Objects whose row listing throws. */
  unreadable?: Set<string>;
}): DanglingReferenceAuditPort & { probes: string[]; warnings: Array<[string, unknown]> } {
  const probes: string[] = [];
  const warnings: Array<[string, unknown]> = [];
  return {
    probes,
    warnings,
    objects: () => opts.objects,
    async find(object) {
      if (opts.unreadable?.has(object)) throw new Error(`no driver for ${object}`);
      // Returned by reference on purpose: a mutating audit would be visible in
      // the caller's own `rows` snapshot.
      return opts.rows[object] ?? [];
    },
    async probe(target, id) {
      probes.push(`${target} ${String(id)}`);
      if (opts.throwingTargets?.has(target)) throw new Error(`probe blew up on ${target}`);
      if (opts.unprobeable?.has(target)) return null;
      return opts.existing?.has(`${target} ${String(id)}`) ?? false;
    },
    warn: (m, meta) => { warnings.push([m, meta]); },
  };
}

describe('[#4551] dangling stored references are reported, never rewritten', () => {
  it('finds a dangling reference and reports its FULL location', async () => {
    // The residual #4441 left: a system write put a permission-set id here that
    // names no row. On an RBAC link table that is a security-surface record
    // resolving to nothing — the audience-anchor gate has to resolve exactly
    // that set to evaluate the grant.
    const port = makePort({
      objects: [binding],
      rows: {
        sys_position_permission_set: [
          { id: 'ppr_1', position_id: 'pos_real', permission_set_id: 'ps_does_not_exist_at_all' },
        ],
      },
      existing: new Set(['sys_position pos_real']),
    });

    const out = await auditDanglingReferences(port);

    expect(out.scanned).toBe(1);
    expect(out.undetermined).toBe(0);
    expect(out.dangling).toHaveLength(1);
    // Which object, which record, which field, which id, which target object —
    // the report is addressed to a human who has to go fix it.
    expect(out.dangling[0]).toEqual({
      objectName: 'sys_position_permission_set',
      recordId: 'ppr_1',
      field: 'permission_set_id',
      target: 'sys_permission_set',
      value: 'ps_does_not_exist_at_all',
    });
  });

  it('does NOT report a reference that resolves', async () => {
    const port = makePort({
      objects: [binding],
      rows: {
        sys_position_permission_set: [
          { id: 'ppr_1', position_id: 'pos_real', permission_set_id: 'ps_real' },
        ],
      },
      existing: new Set(['sys_position pos_real', 'sys_permission_set ps_real']),
    });

    const out = await auditDanglingReferences(port);
    expect(out.dangling).toEqual([]);
    expect(out.undetermined).toBe(0);
    expect(out.scanned).toBe(1);
  });

  it('an unprobeable TARGET is `undetermined`, never a verdict of dangling', async () => {
    // Target object not registered / on an unreachable datasource. An integrity
    // report that cannot run must not invent a finding — otherwise a
    // connectivity problem publishes every reference through it as broken.
    const port = makePort({
      objects: [binding],
      rows: {
        sys_position_permission_set: [
          { id: 'ppr_1', position_id: 'pos_1', permission_set_id: 'ps_1' },
        ],
      },
      unprobeable: new Set(['sys_permission_set']),
      existing: new Set(['sys_position pos_1']),
    });

    const out = await auditDanglingReferences(port);
    expect(out.dangling).toEqual([]);
    // …and it is COUNTED, so "0 dangling" can never be read as "all clear"
    // when nothing could actually be checked.
    expect(out.undetermined).toBe(1);
  });

  it('a probe that THROWS is `undetermined` too — same reasoning, second failure mode', async () => {
    const port = makePort({
      objects: [binding],
      rows: {
        sys_position_permission_set: [
          { id: 'ppr_1', position_id: 'pos_1', permission_set_id: 'ps_1' },
        ],
      },
      throwingTargets: new Set(['sys_permission_set', 'sys_position']),
    });

    const out = await auditDanglingReferences(port);
    expect(out.dangling).toEqual([]);
    expect(out.undetermined).toBe(2);
  });

  it('an object whose rows cannot be listed is named, not silently counted as clean', async () => {
    const port = makePort({
      objects: [binding, task],
      rows: { showcase_task: [{ id: 't1', title: 'T', project: 'proj_real' }] },
      unreadable: new Set(['sys_position_permission_set']),
      existing: new Set(['showcase_project proj_real']),
    });

    const out = await auditDanglingReferences(port);
    expect(out.unreadableObjects).toEqual(['sys_position_permission_set']);
    expect(out.dangling).toEqual([]);
  });

  it('NEVER rewrites — the stored data is byte-identical before and after', async () => {
    // The rows were genuinely written. Auto-nulling a dangling id would make
    // the stored data disagree with what actually happened, and the remedy
    // (re-seed the target vs clear the link) is an operator judgement call.
    const rows: Record<string, Array<Record<string, unknown>>> = {
      sys_position_permission_set: [
        { id: 'ppr_1', position_id: 'pos_gone', permission_set_id: 'ps_gone' },
      ],
      showcase_task: [
        { id: 't1', title: 'T', project: 'proj_gone', tags: ['tag_gone'], created_by: 'system' },
      ],
    };
    const before = JSON.stringify(rows);
    const port = makePort({ objects: [binding, task], rows });

    const out = await auditDanglingReferences(port);

    expect(out.dangling.length).toBeGreaterThan(0);   // it really did find things
    expect(JSON.stringify(rows)).toBe(before);        // …and changed none of them
  });

  it('a READONLY reference field is not audited — its value was minted by the platform', async () => {
    // Same judgment #4441 makes on the write path, and for the same reason:
    // `stripReadonlyFields` removes a caller's value first, so what remains is
    // the platform's. `sys_metadata_history.recorded_by` is the real case — a
    // `lookup('sys_user')` filled with the SENTINEL STRING `actor ?? 'system'`.
    const port = makePort({
      objects: [task],
      rows: { showcase_task: [{ id: 't1', title: 'T', created_by: 'system' }] },
    });

    const out = await auditDanglingReferences(port);
    expect(out.dangling).toEqual([]);
    // Not merely unreported — never even probed.
    expect(port.probes).not.toContain('sys_user system');
  });

  it('empty values are not references — null / "" / [] are skipped', async () => {
    // `deleteBehavior: 'set_null'` writes exactly these. Matching #4441's
    // `isEmptyReferenceValue` is the point: one predicate, two consumers.
    const port = makePort({
      objects: [task],
      rows: {
        showcase_task: [
          { id: 't1', title: 'A', project: null, tags: [] },
          { id: 't2', title: 'B', project: '', tags: [null, ''] },
          { id: 't3', title: 'C' },
        ],
      },
    });

    const out = await auditDanglingReferences(port);
    expect(out.scanned).toBe(3);
    expect(out.dangling).toEqual([]);
    expect(port.probes).toEqual([]);
  });

  it('every element of a multi-value reference is checked', async () => {
    const port = makePort({
      objects: [task],
      rows: { showcase_task: [{ id: 't1', title: 'T', tags: ['tag_real', 'tag_gone'] }] },
      existing: new Set(['showcase_tag tag_real']),
    });

    const out = await auditDanglingReferences(port);
    expect(out.dangling).toHaveLength(1);
    expect(out.dangling[0]).toMatchObject({ field: 'tags', value: 'tag_gone' });
  });

  it('an already-expanded record in the slot is a read shape, not an id', async () => {
    const port = makePort({
      objects: [task],
      rows: { showcase_task: [{ id: 't1', title: 'T', project: { id: 'proj_1', name: 'P' } }] },
    });

    const out = await auditDanglingReferences(port);
    expect(out.dangling).toEqual([]);
    expect(port.probes).toEqual([]);
  });

  it('an object with no reference fields is never read at all', async () => {
    const reads: string[] = [];
    const plain: AuditableObject = { name: 'plain', fields: { id: { type: 'text' }, n: { type: 'number' } } };
    const port = makePort({ objects: [plain], rows: { plain: [{ id: 'p1', n: 1 }] } });
    const findSpy = port.find.bind(port);
    port.find = async (o, opts) => { reads.push(o); return findSpy(o, opts); };

    const out = await auditDanglingReferences(port);
    expect(reads).toEqual([]);
    expect(out.scanned).toBe(0);
  });

  it('RBAC link tables are scanned FIRST when the budget is finite', async () => {
    // A dangling row on the security surface is an unevaluable gate input, so
    // it must not be the thing a bounded scan runs out of budget before seeing.
    const reads: string[] = [];
    const port = makePort({
      objects: [task, binding],   // registration order puts the business object first
      rows: {
        showcase_task: [{ id: 't1', title: 'T', project: 'p' }],
        sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_1' }],
      },
    });
    const findSpy = port.find.bind(port);
    port.find = async (o, opts) => { reads.push(o); return findSpy(o, opts); };

    await auditDanglingReferences(port);
    expect(reads[0]).toBe('sys_position_permission_set');
    // …and the priority set is DERIVED from the platform-object registry, not
    // hand-listed here, so a new plugin-security table is covered for free.
    expect(SECURITY_SURFACE_OBJECTS.has('sys_position_permission_set')).toBe(true);
    expect(SECURITY_SURFACE_OBJECTS.has('sys_user_permission_set')).toBe(true);
  });

  it('a bounded scan says so — `truncatedObjects` stops a SAMPLE reading as a proof', async () => {
    const port = makePort({
      objects: [task],
      rows: {
        showcase_task: [
          { id: 't1', title: 'A', project: 'proj_real' },
          { id: 't2', title: 'B', project: 'proj_real' },
        ],
      },
      existing: new Set(['showcase_project proj_real']),
    });

    // The port ignores `limit` (a real driver would not), so a budget of 2 with
    // 2 rows returned is exactly the "budget reached" signal.
    const out = await auditDanglingReferences(port, { rowsPerObject: 2 });
    expect(out.dangling).toEqual([]);
    expect(out.truncatedObjects).toEqual(['showcase_task']);
  });

  it('the same (target, id) is probed once per run', async () => {
    // A link table is by definition many rows pointing at few ids; re-probing
    // would also multiply a storage outage by the row count.
    const port = makePort({
      objects: [binding],
      rows: {
        sys_position_permission_set: [
          { id: 'a', permission_set_id: 'ps_gone' },
          { id: 'b', permission_set_id: 'ps_gone' },
          { id: 'c', permission_set_id: 'ps_gone' },
        ],
      },
    });

    const out = await auditDanglingReferences(port);
    expect(port.probes).toEqual(['sys_permission_set ps_gone']);
    // Memoisation is an optimisation, never a loss of findings: all three rows
    // are still reported individually.
    expect(out.dangling.map((d) => d.recordId)).toEqual(['a', 'b', 'c']);
  });

  it('the report is logged when there is anything to say, and silent otherwise', async () => {
    const clean = makePort({
      objects: [binding],
      rows: { sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_real' }] },
      existing: new Set(['sys_permission_set ps_real']),
    });
    await auditDanglingReferences(clean);
    expect(clean.warnings).toEqual([]);

    const dirty = makePort({
      objects: [binding],
      rows: { sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_gone' }] },
    });
    await auditDanglingReferences(dirty);
    expect(dirty.warnings).toHaveLength(1);
    expect(dirty.warnings[0][0]).toContain('#4551');
    expect((dirty.warnings[0][1] as any).references).toEqual([
      'sys_position_permission_set#ppr_1.permission_set_id → sys_permission_set#ps_gone',
    ]);
  });
});
