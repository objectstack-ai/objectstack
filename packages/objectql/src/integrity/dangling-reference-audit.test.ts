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
 *  - drop the empty-value skip → "empty is not a reference" fails
 *  - restore the readonly SKIP → every [#4743] test below fails: the provenance
 *    bucket goes empty and the probe is never issued
 *  - merge provenance into `dangling` → the [#4743] separation tests fail
 *  - drop the `unscannedObjects` filing → the [#5718] tests fail: the budget
 *    stop goes back to being silent about the objects it never opened
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
    // stamps `created_by` exactly like this). #4441 still skips it on the WRITE
    // path — the value there is never the caller's. The audit no longer skips
    // it (#4743): it holds a genuine user id, and a deleted user dangles it.
    created_by: { type: 'lookup', reference: 'sys_user', readonly: true },
  },
};

/**
 * [#4743] A table whose ONLY reference field is the injected provenance family
 * — what `applySystemFields` leaves on an object that declares no lookup of its
 * own. Before #4743 the audit read zero rows of a table shaped like this.
 */
const note: AuditableObject = {
  name: 'showcase_note',
  fields: {
    id: { type: 'text', primaryKey: true },
    body: { type: 'text' },
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

  // The former "a READONLY reference field is not audited" case lived here. It
  // was retired by #4743 rather than re-spelled: its `dangling: []` assertion
  // still PASSES under the new behaviour — the finding simply moved one bucket
  // over — so keeping it would have been a test that is green because nothing
  // is produced rather than because the logic is right. Its replacements, which
  // assert where the value actually goes, are in the [#4743] block below.

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

/**
 * [#4747] "The datasource refused" and "nobody asked" are different facts.
 *
 * The audit reads through a live engine, and the engine outlives it only until
 * the host closes the pool. Before this, every `os migrate` invocation ended
 * with `unreadableObjects: ['sys_metadata', 'sys_view_definition']` — the sweep
 * fired 60s after boot, inside a process whose datasource had already been
 * disconnected. An `unreadableObjects` that is non-empty on every healthy run
 * is not a cautious report; it is a broken alarm, and it costs exactly the
 * signal #4551 built the bucket for.
 *
 * The pair of tests that opens this block is the whole point: BEFORE the fix
 * the two runs were indistinguishable, and after it they must never again be
 * confusable. Deleting the abort handling makes the second one fail; deleting
 * the `unreadableObjects` push makes the first one fail.
 */
describe('[#4747] a run that was called off is not a finding about the data', () => {
  /** A port whose listing always fails — the two runs below differ ONLY in why. */
  const unreadablePort = () => makePort({
    objects: [binding],
    rows: {},
    unreadable: new Set(['sys_position_permission_set']),
  });

  it('a REAL datasource fault still lands in `unreadableObjects`, loudly', async () => {
    // The case the bucket exists for, and the one that must survive the fix:
    // the audit tried, the store would not answer, and the report must not read
    // as a clean bill of health on an object nothing could look at.
    const port = unreadablePort();

    const out = await auditDanglingReferences(port);

    expect(out.unreadableObjects).toEqual(['sys_position_permission_set']);
    expect(out.aborted).toBe(false);
    expect(port.warnings.map((w) => w[0])).toContain(
      '[integrity] dangling-reference audit could not list an object',
    );
  });

  it('the SAME failure, raced by a teardown, is dropped instead of filed', async () => {
    // Identical throw from identical code — the only difference is that the
    // caller had called the run off, which is what closing a connection pool on
    // purpose looks like from in here. It is not evidence about the datasource,
    // so it must not spend the bucket that only holds evidence.
    const signal = { aborted: false };
    const port = unreadablePort();
    const failing = port.find.bind(port);
    port.find = async (o, opts) => {
      signal.aborted = true;          // the pool closes mid-query
      return failing(o, opts);        // …and the query fails because of it
    };

    const out = await auditDanglingReferences(port, { signal });

    expect(out.unreadableObjects).toEqual([]);
    // Not silence either: the run says it did not finish, so nothing can read
    // `dangling: []` as "everything is fine".
    expect(out.aborted).toBe(true);
    expect(port.warnings).toEqual([]);
  });

  it('called off BEFORE a read: no query is issued at all', async () => {
    // This is what removes the `ERROR Find operation failed` line from a
    // SUCCESSFUL command — the engine never gets asked, so it never logs.
    const reads: string[] = [];
    const port = makePort({
      objects: [binding, task],
      rows: { sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_gone' }] },
    });
    const findSpy = port.find.bind(port);
    port.find = async (o, opts) => { reads.push(o); return findSpy(o, opts); };

    const out = await auditDanglingReferences(port, { signal: { aborted: true } });

    expect(reads).toEqual([]);
    expect(port.probes).toEqual([]);
    expect(out.aborted).toBe(true);
    expect(out.unreadableObjects).toEqual([]);
  });

  it('called off MID-run keeps what it already proved and stops there', async () => {
    // A finding is a finding whenever it was made; only the SILENCE about the
    // rest of the run becomes unreliable, which is what `aborted` records. So
    // an abort must not discard the first object's verdict — and must not turn
    // the second object into a report about the datasource.
    const signal = { aborted: false };
    const reads: string[] = [];
    const port = makePort({
      objects: [binding, task],   // binding is scanned first (security surface)
      rows: {
        sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_gone' }],
        showcase_task: [{ id: 't1', title: 'T', project: 'proj_gone' }],
      },
      unreadable: new Set(['showcase_task']),
    });
    const findSpy = port.find.bind(port);
    port.find = async (o, opts) => {
      reads.push(o);
      // Teardown lands as the second listing is issued — so that listing fails
      // BECAUSE the run was called off, which is the production race exactly.
      if (o === 'showcase_task') signal.aborted = true;
      return findSpy(o, opts);
    };

    const out = await auditDanglingReferences(port, { signal });

    expect(reads).toEqual(['sys_position_permission_set', 'showcase_task']);
    expect(out.dangling).toHaveLength(1);
    expect(out.dangling[0]).toMatchObject({ recordId: 'ppr_1', value: 'ps_gone' });
    expect(out.aborted).toBe(true);
    // The object the teardown cut short is NOT reported as unreadable.
    expect(out.unreadableObjects).toEqual([]);
    // The real finding is still reported, and the summary line carries the
    // incompleteness so the log cannot read as a finished run either.
    const summary = port.warnings.find((w) => w[0].includes('#4551'));
    expect(summary).toBeDefined();
    expect((summary![1] as any).aborted).toBe(true);
  });

  it('a probe that fails under a teardown is not `undetermined` either', async () => {
    // `undetermined` means "the probe RAN and could not tell". A withdrawn
    // question did not run, so counting it there would repeat the same category
    // error one bucket over.
    const signal = { aborted: false };
    const port = makePort({
      objects: [binding],
      rows: { sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_x' }] },
      throwingTargets: new Set(['sys_permission_set']),
    });
    const probeSpy = port.probe.bind(port);
    port.probe = async (target, id) => {
      signal.aborted = true;
      return probeSpy(target, id);
    };

    const out = await auditDanglingReferences(port, { signal });

    expect(out.undetermined).toBe(0);
    expect(out.dangling).toEqual([]);
    expect(out.aborted).toBe(true);
  });

  it('a run nobody called off says so explicitly — `aborted: false`, not absent', async () => {
    // The flag is a positive statement about completeness, so a consumer never
    // has to guess whether `undefined` meant "finished" or "old report shape".
    const port = makePort({
      objects: [binding],
      rows: { sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_real' }] },
      existing: new Set(['sys_permission_set ps_real']),
    });

    const out = await auditDanglingReferences(port, { signal: { aborted: false } });
    expect(out.aborted).toBe(false);

    const noSignal = await auditDanglingReferences(port);
    expect(noSignal.aborted).toBe(false);
  });
});

/**
 * [#4743] "The user who created this is gone" is a finding, and it is not the
 * same finding as a broken business foreign key.
 *
 * The `readonly` family used to be skipped whole. Two grounds; #4556 deleted
 * one of them (the platform stopped writing the `recorded_by` SENTINEL STRING
 * into a lookup column), and what the skip covered afterwards was only the
 * audit-provenance family — genuine user/organization ids that genuinely
 * dangle the moment their target row is deleted.
 *
 * Reverse verification, direction predicted BEFORE running it: restoring the
 * wholesale skip turns every test in this block RED — `provenance` goes empty
 * and the probe is never issued. Note the direction the *retired* test would
 * have gone instead: its `dangling: []` assertion stays GREEN under the new
 * behaviour, because the finding moved rather than vanished. That is exactly
 * the "green because nothing is produced" trap, which is why it was replaced
 * rather than re-spelled.
 */
describe('[#4743] provenance references are audited, in their OWN bucket', () => {
  it('a dangling `created_by` is reported — in `provenance`, not in `dangling`', async () => {
    // Delete a user and every row they created points at a row that is gone.
    // "Who made this" failing to resolve is what an audit trail exists for.
    const port = makePort({
      objects: [task],
      rows: {
        showcase_task: [
          { id: 't1', title: 'T', project: 'proj_real', created_by: 'usr_deleted' },
        ],
      },
      existing: new Set(['showcase_project proj_real']),
    });

    const out = await auditDanglingReferences(port);

    // The business link is fine, so `dangling` must stay empty — and it must be
    // empty for the RIGHT reason, which the bucket below is what proves.
    expect(out.dangling).toEqual([]);
    expect(out.provenance).toEqual([{
      objectName: 'showcase_task',
      recordId: 't1',
      field: 'created_by',
      target: 'sys_user',
      value: 'usr_deleted',
    }]);
    // …and it really was probed, which the old wholesale skip never did.
    expect(port.probes).toContain('sys_user usr_deleted');
  });

  it('a resolvable `created_by` is not reported at all', async () => {
    const port = makePort({
      objects: [task],
      rows: { showcase_task: [{ id: 't1', title: 'T', created_by: 'usr_alive' }] },
      existing: new Set(['sys_user usr_alive']),
    });

    const out = await auditDanglingReferences(port);
    expect(out.provenance).toEqual([]);
    expect(out.dangling).toEqual([]);
    // Silent because it RESOLVED, not because nobody looked — without this the
    // case would pass just as well under the old wholesale skip.
    expect(port.probes).toContain('sys_user usr_alive');
  });

  it('the two buckets never merge — a broken FK and a deleted user are filed apart', async () => {
    // The whole point of B over C: one report, two questions, two remedies
    // (re-seed the project vs. nothing to do about a user who left).
    const port = makePort({
      objects: [task],
      rows: {
        showcase_task: [
          { id: 't1', title: 'T', project: 'proj_gone', created_by: 'usr_deleted' },
        ],
      },
    });

    const out = await auditDanglingReferences(port);

    expect(out.dangling.map((d) => d.field)).toEqual(['project']);
    expect(out.provenance!.map((d) => d.field)).toEqual(['created_by']);
  });

  it('an unprobeable provenance target counts in `provenanceUndetermined`, never in `undetermined`', async () => {
    // `sys_user` unregistered is a fact about which platform tables are
    // mounted, not about the audited data — and `undetermined` raises the
    // summary warning, so folding it in there would ring an alarm about the
    // wrong thing on every run of a stack that never mounts `sys_user`.
    const port = makePort({
      objects: [task],
      rows: {
        showcase_task: [
          { id: 't1', title: 'T', project: 'proj_real', created_by: 'usr_x' },
        ],
      },
      unprobeable: new Set(['sys_user']),
      existing: new Set(['showcase_project proj_real']),
    });

    const out = await auditDanglingReferences(port);

    expect(out.provenanceUndetermined).toBe(1);
    expect(out.undetermined).toBe(0);
    expect(out.provenance).toEqual([]);   // unknown is not a verdict, here either
  });

  it('a table whose ONLY reference is provenance is now read — it used to be skipped whole', async () => {
    const reads: string[] = [];
    const port = makePort({
      objects: [note],
      rows: { showcase_note: [{ id: 'n1', body: 'b', created_by: 'usr_deleted' }] },
    });
    const findSpy = port.find.bind(port);
    port.find = async (o, opts) => { reads.push(o); return findSpy(o, opts); };

    const out = await auditDanglingReferences(port);

    expect(reads).toEqual(['showcase_note']);
    expect(out.scanned).toBe(1);
    expect(out.provenance).toHaveLength(1);
  });

  it('provenance-only tables are scanned LAST, so a finite budget still answers the business question', async () => {
    // Admitting the family means nearly every object has an auditable field,
    // so without this the budget would be spent on tables carrying only
    // provenance and the business findings would be what a bounded run never
    // reached. Same argument as the security surface, one tier down.
    const reads: string[] = [];
    const port = makePort({
      // Registration order is deliberately the WORST case: provenance-only
      // first, security surface last.
      objects: [note, task, binding],
      rows: {
        showcase_note: [{ id: 'n1', body: 'b', created_by: 'usr_deleted' }],
        showcase_task: [{ id: 't1', title: 'T', project: 'proj_gone' }],
        sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_gone' }],
      },
    });
    const findSpy = port.find.bind(port);
    port.find = async (o, opts) => { reads.push(o); return findSpy(o, opts); };

    await auditDanglingReferences(port);

    expect(reads).toEqual(['sys_position_permission_set', 'showcase_task', 'showcase_note']);
  });

  it('provenance ALONE does not raise the summary warning', async () => {
    // On a database of any age this bucket is non-empty on every healthy run.
    // A line that always fires is #4747's broken alarm, and it would train its
    // reader straight past the run where `dangling` had something in it.
    const port = makePort({
      objects: [note],
      rows: { showcase_note: [{ id: 'n1', body: 'b', created_by: 'usr_deleted' }] },
    });

    const out = await auditDanglingReferences(port);

    expect(out.provenance).toHaveLength(1);   // found, and reported in the report
    expect(port.warnings).toEqual([]);        // …just not shouted about
  });

  it('…but rides along in the payload once the line fires for a real finding', async () => {
    const port = makePort({
      objects: [task],
      rows: {
        showcase_task: [
          { id: 't1', title: 'T', project: 'proj_gone', created_by: 'usr_deleted' },
        ],
      },
      unprobeable: new Set(['sys_user']),
    });

    const out = await auditDanglingReferences(port);

    const summary = port.warnings.find((w) => w[0].includes('#4551'));
    expect(summary).toBeDefined();
    const meta = summary![1] as Record<string, unknown>;
    expect(meta.dangling).toBe(1);
    expect(meta.provenanceUndetermined).toBe(1);
    // Counted, never itemised: on an aged database this outnumbers every other
    // finding, and the rows themselves are in the returned report.
    expect(meta.provenance).toBe(0);
    expect(meta.references).toEqual([
      'showcase_task#t1.project → showcase_project#proj_gone',
    ]);
    expect(out.provenanceUndetermined).toBe(1);
  });

  it('a run with nothing to say still states both provenance buckets explicitly', async () => {
    // Same reason `aborted: false` is explicit: a consumer must never have to
    // guess whether `undefined` meant "clean" or "old report shape".
    const port = makePort({
      objects: [binding],
      rows: { sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_real' }] },
      existing: new Set(['sys_permission_set ps_real']),
    });

    const out = await auditDanglingReferences(port);
    expect(out.provenance).toEqual([]);
    expect(out.provenanceUndetermined).toBe(0);
  });
});

/**
 * [#5718] A budget that runs out BETWEEN objects used to end the run in
 * silence.
 *
 * `truncatedObjects` covers the budget running out INSIDE a table. The overall
 * `maxRows` budget also runs out between tables — the loop just stopped, and
 * every object behind the stop left no trace in the report at all. Their
 * `dangling: []` was indistinguishable from the `dangling: []` of a table that
 * really was read and really was clean, which is the exact confusion every
 * bucket in this file exists to prevent.
 *
 * Reverse verification, direction predicted BEFORE running it: delete the
 * `fileUnscanned` call at the budget stop and every test in this block goes
 * RED — the list empties while the run keeps returning `dangling: []`. Note
 * which assertion does the work: a test that only checked `dangling` (or
 * `scanned`) would stay GREEN under the old silent break, because nothing about
 * the findings changes. The names ARE the behaviour under test.
 */
describe('[#5718] objects a finite budget never reached are named, not dropped', () => {
  /** Every object below carries a reference field, so all three are scannable. */
  const budgetPort = (objects: AuditableObject[]) => makePort({
    objects,
    rows: {
      sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_real' }],
      showcase_task: [{ id: 't1', title: 'T', project: 'proj_real' }],
      showcase_note: [{ id: 'n1', body: 'b', created_by: 'usr_alive' }],
    },
    existing: new Set([
      'sys_permission_set ps_real', 'showcase_project proj_real', 'sys_user usr_alive',
    ]),
  });

  it('the objects behind the stop are listed, in the order the run would have read them', async () => {
    // Registration order is the worst case (provenance-only first, security
    // surface last) so the list can only be right if it comes from the SCAN
    // order — which is what makes it feedable straight back as `objects` on a
    // second run.
    const reads: string[] = [];
    const port = budgetPort([note, task, binding]);
    const findSpy = port.find.bind(port);
    port.find = async (o, opts) => { reads.push(o); return findSpy(o, opts); };

    const out = await auditDanglingReferences(port, { maxRows: 1 });

    expect(reads).toEqual(['sys_position_permission_set']);   // budget bought one table
    expect(out.scanned).toBe(1);
    // …and the report SAYS the other two were never opened, instead of leaving
    // them inside an empty `dangling`.
    expect(out.unscannedObjects).toEqual(['showcase_task', 'showcase_note']);
    expect(out.dangling).toEqual([]);
  });

  it('a run that reached everything says so explicitly — `[]`, never absent', async () => {
    // Same reason `aborted: false` is explicit: `undefined` must never be the
    // consumer's only clue, because it cannot tell "complete" from "a report
    // shape that predates the key".
    const port = budgetPort([binding, task, note]);

    const out = await auditDanglingReferences(port);

    expect(out.unscannedObjects).toEqual([]);
    expect('unscannedObjects' in out).toBe(true);
  });

  it('an object with NO reference field is not listed — its silence was already proven', async () => {
    // Nothing referential can break on it, so `prioritise` drops it before the
    // loop and the audit reads zero rows of it by design. Filing it as
    // "unscanned" would report a table that has nothing to find as a gap.
    const plain: AuditableObject = {
      name: 'plain', fields: { id: { type: 'text' }, n: { type: 'number' } },
    };
    const port = budgetPort([binding, plain, task]);

    const out = await auditDanglingReferences(port, { maxRows: 1 });

    expect(out.unscannedObjects).toEqual(['showcase_task']);
    expect(out.unscannedObjects).not.toContain('plain');
  });

  it('an object the CALLER excluded is not listed — that narrowing is not the audit missing it', async () => {
    const port = budgetPort([binding, task, note]);

    const out = await auditDanglingReferences(port, {
      maxRows: 1,
      objects: ['sys_position_permission_set', 'showcase_task'],
    });

    // `showcase_note` was never on this run's list, so it is not something the
    // run failed to reach; `showcase_task` was, and the budget ate it.
    expect(out.unscannedObjects).toEqual(['showcase_task']);
  });

  it('a zero budget reads nothing and names EVERYTHING — the whole report is "not looked at"', async () => {
    const reads: string[] = [];
    const port = budgetPort([binding, task, note]);
    const findSpy = port.find.bind(port);
    port.find = async (o, opts) => { reads.push(o); return findSpy(o, opts); };

    const out = await auditDanglingReferences(port, { maxRows: 0 });

    expect(reads).toEqual([]);
    expect(out.scanned).toBe(0);
    expect(out.dangling).toEqual([]);   // …and this says NOTHING, which is the point
    expect(out.unscannedObjects).toEqual([
      'sys_position_permission_set', 'showcase_task', 'showcase_note',
    ]);
  });

  it('a called-off run names what it never reached too, so empty keeps meaning "reached"', async () => {
    // The bucket would be a liar otherwise: `unscannedObjects: []` next to
    // `aborted: true` reads as "stopped early, but missed nothing". The object
    // whose listing the teardown cut off is in the list as well — its rows were
    // never examined either (#4747 keeps it out of `unreadableObjects`, which
    // is a different fact: the datasource refused).
    const signal = { aborted: false };
    const port = makePort({
      objects: [binding, task, note],
      rows: { sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_gone' }] },
      unreadable: new Set(['showcase_task']),
    });
    const findSpy = port.find.bind(port);
    port.find = async (o, opts) => {
      if (o === 'showcase_task') signal.aborted = true;   // the pool closes mid-query
      return findSpy(o, opts);
    };

    const out = await auditDanglingReferences(port, { signal });

    expect(out.aborted).toBe(true);
    expect(out.unreadableObjects).toEqual([]);
    expect(out.unscannedObjects).toEqual(['showcase_task', 'showcase_note']);
    // The finding made before the teardown is untouched by any of this.
    expect(out.dangling).toHaveLength(1);
  });

  it('called off MID-object lists what is BEHIND it, not the object it was inside', async () => {
    // The `i` vs `i + 1` distinction, pinned: this object was opened and partly
    // examined — its findings so far are real and `aborted` is what says the
    // rest of it is unreliable. Listing it as "never reached" would be a
    // different lie from the one #5718 fixes.
    const signal = { aborted: false };
    const port = makePort({
      objects: [binding, task, note],
      rows: { sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_x' }] },
      // The probe blows up because the pool went away under it — the #4747
      // race, which is what makes the answer "withdrawn" rather than a verdict.
      throwingTargets: new Set(['sys_permission_set']),
    });
    const probeSpy = port.probe.bind(port);
    port.probe = async (target, id) => { signal.aborted = true; return probeSpy(target, id); };

    const out = await auditDanglingReferences(port, { signal });

    expect(out.aborted).toBe(true);
    expect(out.unscannedObjects).toEqual(['showcase_task', 'showcase_note']);
    expect(out.unscannedObjects).not.toContain('sys_position_permission_set');
  });

  it('called off BEFORE the registry was enumerated: `aborted` carries it, the list is empty', async () => {
    // The one boundary of "empty means reached", pinned rather than left to be
    // discovered: this run never asked which objects exist, so it has no names
    // to give. Completeness is read from `aborted === false` AND an empty list,
    // exactly as `truncatedObjects` / `unreadableObjects` are already composed.
    const port = budgetPort([binding, task, note]);

    const out = await auditDanglingReferences(port, { signal: { aborted: true } });

    expect(out.aborted).toBe(true);
    expect(out.unscannedObjects).toEqual([]);
  });

  it('a truncated run and an unscanned run are DIFFERENT reports', async () => {
    // The distinction this bucket exists for: `truncatedObjects` = "this table
    // was sampled", `unscannedObjects` = "this table was not opened". Before
    // #5718 the second case had no field of its own and borrowed nothing —
    // it simply vanished.
    const port = makePort({
      objects: [task, note],
      rows: {
        showcase_task: [
          { id: 't1', title: 'A', project: 'proj_real' },
          { id: 't2', title: 'B', project: 'proj_real' },
        ],
        showcase_note: [{ id: 'n1', body: 'b', created_by: 'usr_alive' }],
      },
      existing: new Set(['showcase_project proj_real', 'sys_user usr_alive']),
    });

    // Budget of 2 rows: `showcase_task` is read to its budget (sampled), and
    // `showcase_note` never comes up at all.
    const out = await auditDanglingReferences(port, { maxRows: 2, rowsPerObject: 2 });

    expect(out.truncatedObjects).toEqual(['showcase_task']);
    expect(out.unscannedObjects).toEqual(['showcase_note']);
  });

  it('rides along in the warning payload, and does NOT raise the line on its own', async () => {
    // Same judgement as `truncatedObjects` and as #4743's provenance bucket: a
    // large database exhausts a finite budget on EVERY healthy run, so an alarm
    // fired by this alone would be #4747's broken alarm — the reader would be
    // trained straight past the run that had a real finding in it.
    const quiet = budgetPort([binding, task, note]);
    await auditDanglingReferences(quiet, { maxRows: 1 });
    expect(quiet.warnings).toEqual([]);   // budget exhausted, nothing found, silence

    const loud = makePort({
      objects: [binding, task, note],
      rows: {
        sys_position_permission_set: [{ id: 'ppr_1', permission_set_id: 'ps_gone' }],
        showcase_task: [{ id: 't1', title: 'T', project: 'proj_gone' }],
        showcase_note: [{ id: 'n1', body: 'b', created_by: 'usr_deleted' }],
      },
    });
    await auditDanglingReferences(loud, { maxRows: 1 });

    const summary = loud.warnings.find((w) => w[0].includes('#4551'));
    expect(summary).toBeDefined();
    const meta = summary![1] as Record<string, unknown>;
    // Itemised, not merely counted: object-scale, and a reader who has to act
    // on it needs the names to re-run them.
    expect(meta.unscannedObjects).toEqual(['showcase_task', 'showcase_note']);
  });
});
