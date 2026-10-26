// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The delete-behaviour family — what it reads from the metadata, what it
// proves on a real stack, and the two controls that keep its green honest:
//
//   • the NEGATIVE control: a stack whose `beforeDelete` hook rewrites the
//     dependents before the engine's referential pass runs (it detaches the
//     `cascade` and `restrict` holders, and deletes the `set_null` one) must be
//     reported contradicted on every behaviour, and counted as hard failures;
//   • the ATTRIBUTION control: a delete a hook vetoes for its own reason must
//     not read as a proven `restrict` (nor as a contradicted `cascade`).
//
// The positive half boots the real stack with no hook in the way, so every
// probed declaration has to hold through both doors.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { bootStack, type VerifyStack } from './harness.js';
import {
  deriveDeleteBehaviorCases,
  runDeleteBehaviorProofs,
  formatDeleteBehaviorReport,
  type DeleteBehaviorReport,
} from './delete-behavior.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;
const RUN_TIMEOUT = 120_000;

// The boot's first load, paid during collection rather than in the first
// `beforeAll` (see `boot-warm-up.testkit.ts`). Both boots below use the
// default options.
await warmUpBoot();

/** One holder per shape the family probes, and one per shape it names instead. */
const app = {
  manifest: { id: 'com.example.delete-behavior', namespace: 'dbp', version: '0.0.1', type: 'app', name: 'Delete Behaviour Fixture' },
  objects: [
    { name: 'dbp_target', label: 'Target', fields: { name: { type: 'text', label: 'Name' } } },
    {
      name: 'dbp_holder',
      label: 'Holder',
      fields: {
        name: { type: 'text', label: 'Name' },
        cascade_ref: { type: 'lookup', reference: 'dbp_target', label: 'Cascade', deleteBehavior: 'cascade' },
        cascade_many: { type: 'lookup', reference: 'dbp_target', label: 'Cascade many', multiple: true, deleteBehavior: 'cascade' },
        restrict_ref: { type: 'lookup', reference: 'dbp_target', label: 'Restrict', deleteBehavior: 'restrict' },
        // Nothing authored: the spec's parse states `set_null` for a lookup.
        setnull_ref: { type: 'lookup', reference: 'dbp_target', label: 'Set null' },
        setnull_many: { type: 'lookup', reference: 'dbp_target', label: 'Set null many', multiple: true },
        assignee: { type: 'user', label: 'Assignee' },
        stamped_ref: { type: 'lookup', reference: 'dbp_target', label: 'Stamped', readonly: true, deleteBehavior: 'cascade' },
        colleague: { type: 'lookup', reference: 'sys_user', label: 'Colleague', deleteBehavior: 'cascade' },
      },
    },
    {
      name: 'dbp_detail',
      label: 'Detail',
      fields: {
        name: { type: 'text', label: 'Name' },
        parent: { type: 'master_detail', reference: 'dbp_target', label: 'Parent', deleteBehavior: 'cascade' },
      },
    },
    {
      name: 'dbp_guarded',
      label: 'Guarded',
      fields: {
        name: { type: 'text', label: 'Name' },
        parent: { type: 'master_detail', reference: 'dbp_target', label: 'Parent', deleteBehavior: 'restrict' },
      },
    },
    {
      name: 'dbp_bare',
      label: 'Bare detail',
      fields: {
        name: { type: 'text', label: 'Name' },
        parent: { type: 'master_detail', reference: 'dbp_target', label: 'Parent' },
      },
    },
    {
      name: 'dbp_required',
      label: 'Required',
      fields: {
        name: { type: 'text', label: 'Name' },
        parent: { type: 'lookup', reference: 'dbp_target', label: 'Parent', required: true },
      },
    },
  ],
};

const PROBED = [
  ['dbp_holder', 'cascade_ref', 'cascade'],
  ['dbp_holder', 'cascade_many', 'cascade'],
  ['dbp_holder', 'restrict_ref', 'restrict'],
  ['dbp_holder', 'setnull_ref', 'set_null'],
  ['dbp_holder', 'setnull_many', 'set_null'],
  ['dbp_detail', 'parent', 'cascade'],
  ['dbp_guarded', 'parent', 'restrict'],
] as const;

const resultFor = (report: DeleteBehaviorReport, object: string, field: string) => {
  const r = report.results.find((x) => x.object === object && x.field === field);
  if (!r) throw new Error(`no result for ${object}.${field}`);
  return r;
};

describe('deriveDeleteBehaviorCases — what the family reads from the metadata', () => {
  it("reads each reference field's declaration through the spec's parse, and names what it cannot compare", () => {
    const config = {
      objects: [
        ...app.objects,
        { name: 'dbp_tree', fields: { parent_node: { type: 'tree', reference: 'dbp_tree' }, title: { type: 'text' } } },
      ],
    };
    const byKey = new Map(deriveDeleteBehaviorCases(config).map((c) => [`${c.object}.${c.field}`, c]));

    // Every reference field, and nothing else (`name`, `title` are not references).
    expect([...byKey.keys()].sort()).toEqual([
      'dbp_bare.parent', 'dbp_detail.parent', 'dbp_guarded.parent',
      'dbp_holder.assignee', 'dbp_holder.cascade_many', 'dbp_holder.cascade_ref', 'dbp_holder.colleague',
      'dbp_holder.restrict_ref', 'dbp_holder.setnull_many', 'dbp_holder.setnull_ref', 'dbp_holder.stamped_ref',
      'dbp_required.parent', 'dbp_tree.parent_node',
    ]);
    for (const [object, field, declared] of PROBED) {
      const c = byKey.get(`${object}.${field}`)!;
      expect(c, `${object}.${field}`).toMatchObject({ declared, target: 'dbp_target' });
      expect(c.excluded, `${object}.${field}`).toBeUndefined();
      expect(c.notDerivable, `${object}.${field}`).toBeUndefined();
    }
    // A lookup that authors nothing, and a tree, carry the spec's `set_null`.
    expect(byKey.get('dbp_holder.setnull_ref')).toMatchObject({ declared: 'set_null', multiple: false });
    expect(byKey.get('dbp_holder.setnull_many')).toMatchObject({ declared: 'set_null', multiple: true });
    expect(byKey.get('dbp_tree.parent_node')).toMatchObject({ declared: 'set_null', target: 'dbp_tree' });
    // Excluded: the declaration states no outcome of its own.
    expect(byKey.get('dbp_bare.parent')).toMatchObject({ excluded: expect.stringMatching(/^declares no deleteBehavior/) });
    expect(byKey.get('dbp_bare.parent')!.declared).toBeUndefined();
    expect(byKey.get('dbp_holder.assignee')).toMatchObject({ target: 'sys_user', excluded: expect.stringMatching(/^declares no deleteBehavior/) });
    expect(byKey.get('dbp_required.parent')).toMatchObject({
      declared: 'set_null',
      required: true,
      excluded: expect.stringMatching(/^set_null on a required reference/),
    });
    // Not derivable: no fixture can be built from the metadata.
    expect(byKey.get('dbp_holder.stamped_ref')).toMatchObject({ declared: 'cascade', notDerivable: expect.stringMatching(/^readonly/) });
    expect(byKey.get('dbp_holder.colleague')).toMatchObject({
      declared: 'cascade',
      notDerivable: expect.stringMatching(/"sys_user" is not an object this app declares/),
    });
  });

  it('names a declaration the spec refuses, rather than reading a behaviour into it', () => {
    const cases = deriveDeleteBehaviorCases({
      objects: [
        { name: 'x_parent', fields: { name: { type: 'text' } } },
        { name: 'x_child', fields: { parent: { type: 'master_detail', reference: 'x_parent', deleteBehavior: 'set_null' } } },
      ],
    });
    expect(cases).toEqual([
      expect.objectContaining({
        object: 'x_child',
        field: 'parent',
        excluded: expect.stringMatching(/^the declaration does not parse under the spec's FieldSchema \(deleteBehavior: /),
      }),
    ]);
    expect(cases[0]!.declared).toBeUndefined();
  });
});

describe('runDeleteBehaviorProofs — on a real stack', () => {
  let stack: VerifyStack;
  let report: DeleteBehaviorReport;

  beforeAll(async () => {
    stack = await bootStack(app as never);
    report = await runDeleteBehaviorProofs(stack, await stack.signIn(), app);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('proves every probed declaration through both doors', () => {
    for (const [object, field, declared] of PROBED) {
      const r = resultFor(report, object, field);
      expect(r.status, `${object}.${field}: ${JSON.stringify(r.probes)}`).toBe('proven');
      expect(r.declared).toBe(declared);
      expect(r.probes.map((p) => p.door)).toEqual(['rest', 'system']);
      expect(r.probes.every((p) => p.outcome === 'held')).toBe(true);
    }
  });

  it('reads what each delete left: the holder gone, cleared, or kept with the refusal named', () => {
    for (const door of ['rest', 'system'] as const) {
      const at = (object: string, field: string) => resultFor(report, object, field).probes.find((p) => p.door === door)!;
      expect(at('dbp_holder', 'cascade_ref')).toMatchObject({ answer: { kind: 'deleted' }, targetRemains: false, holderRemains: false });
      expect(at('dbp_holder', 'setnull_ref')).toMatchObject({ answer: { kind: 'deleted' }, holderRemains: true, holderValue: null });
      expect(at('dbp_holder', 'setnull_many')).toMatchObject({ answer: { kind: 'deleted' }, holderRemains: true });
      expect(at('dbp_holder', 'restrict_ref')).toMatchObject({
        answer: { kind: 'refused', code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'dbp_holder', object: 'dbp_target' },
        targetRemains: true,
        holderRemains: true,
      });
      expect(at('dbp_guarded', 'parent')).toMatchObject({
        answer: { kind: 'refused', code: 'DELETE_RESTRICTED', dependentObject: 'dbp_guarded' },
      });
    }
  });

  it('counts the shapes it names instead of probing, and reports no hard failure', () => {
    expect(resultFor(report, 'dbp_bare', 'parent')).toMatchObject({ status: 'excluded', probes: [] });
    expect(resultFor(report, 'dbp_required', 'parent')).toMatchObject({ status: 'excluded', probes: [] });
    expect(resultFor(report, 'dbp_holder', 'assignee')).toMatchObject({ status: 'excluded', probes: [] });
    expect(resultFor(report, 'dbp_holder', 'stamped_ref')).toMatchObject({ status: 'not-derivable', probes: [] });
    expect(resultFor(report, 'dbp_holder', 'colleague')).toMatchObject({ status: 'not-derivable', probes: [] });
    expect(report.summary).toEqual({
      fields: 12,
      probed: { cascade: 3, set_null: 2, restrict: 2 },
      proven: 7,
      contradicted: 0,
      failed: 0,
      inconclusive: 0,
      excluded: 3,
      notDerivable: 2,
      probes: 14,
      held: 14,
      contradictions: 0,
      unattributed: 0,
      faults: 0,
      notRun: 0,
      hardFailures: 0,
    });
    const text = formatDeleteBehaviorReport(report);
    expect(text).toContain('7 proven, 0 CONTRADICTED, 0 FAILED');
    expect(text).toContain('probed: 3 cascade, 2 set_null, 2 restrict');
  });
});

/**
 * The negative and attribution controls share one stack. `nc_target`'s
 * `beforeDelete` hook rewrites the dependents before the engine's referential
 * pass runs, so each declared outcome is undone by the app, not by the engine;
 * `nc_vault`'s refuses every delete with its own code.
 */
const controlApp = {
  manifest: { id: 'com.example.delete-behavior-control', namespace: 'nc', version: '0.0.1', type: 'app', name: 'Delete Behaviour Controls' },
  objects: [
    { name: 'nc_target', label: 'Target', fields: { name: { type: 'text', label: 'Name' } } },
    { name: 'nc_vault', label: 'Vault', fields: { name: { type: 'text', label: 'Name' } } },
    {
      name: 'nc_holder',
      label: 'Holder',
      fields: {
        name: { type: 'text', label: 'Name' },
        cascade_ref: { type: 'lookup', reference: 'nc_target', label: 'Cascade', deleteBehavior: 'cascade' },
        restrict_ref: { type: 'lookup', reference: 'nc_target', label: 'Restrict', deleteBehavior: 'restrict' },
        setnull_ref: { type: 'lookup', reference: 'nc_target', label: 'Set null' },
        vetoed_restrict: { type: 'lookup', reference: 'nc_vault', label: 'Vetoed restrict', deleteBehavior: 'restrict' },
        vetoed_cascade: { type: 'lookup', reference: 'nc_vault', label: 'Vetoed cascade', deleteBehavior: 'cascade' },
      },
    },
  ],
  hooks: [
    {
      name: 'nc_target_rewrites_dependents',
      object: 'nc_target',
      events: ['beforeDelete'],
      handler: async (ctx: { input: { id?: unknown }; api: any }) => {
        const id = ctx.input.id;
        const holders = ctx.api.object('nc_holder');
        for (const row of await holders.find({ where: { cascade_ref: id } })) await holders.updateById(row.id, { cascade_ref: null });
        for (const row of await holders.find({ where: { restrict_ref: id } })) await holders.updateById(row.id, { restrict_ref: null });
        for (const row of await holders.find({ where: { setnull_ref: id } })) await holders.deleteById(row.id);
      },
    },
    {
      name: 'nc_vault_refuses_deletes',
      object: 'nc_vault',
      events: ['beforeDelete'],
      handler: async () => {
        throw Object.assign(new Error('A vault record is never deleted'), { code: 'VALIDATION_FAILED', status: 400 });
      },
    },
  ],
};

describe('runDeleteBehaviorProofs — the controls', () => {
  let stack: VerifyStack;
  let report: DeleteBehaviorReport;

  beforeAll(async () => {
    stack = await bootStack(controlApp as never);
    report = await runDeleteBehaviorProofs(stack, await stack.signIn(), controlApp);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('NEGATIVE CONTROL: reports every undone declaration contradicted, through both doors', () => {
    const expected = {
      cascade_ref: /^declared cascade, and the holder survived/,
      restrict_ref: /^declared restrict, and the delete was not refused/,
      setnull_ref: /^declared set_null, and the holder was deleted/,
    };
    for (const [field, detail] of Object.entries(expected)) {
      const r = resultFor(report, 'nc_holder', field);
      expect(r.status, `${field}: ${JSON.stringify(r.probes)}`).toBe('contradicted');
      expect(r.probes.map((p) => [p.door, p.outcome])).toEqual([['rest', 'contradicted'], ['system', 'contradicted']]);
      for (const p of r.probes) expect(p.detail, `${field} ${p.door}`).toMatch(detail);
    }
  });

  it('ATTRIBUTION CONTROL: a delete a hook refuses for its own reason proves nothing either way', () => {
    for (const field of ['vetoed_restrict', 'vetoed_cascade']) {
      const r = resultFor(report, 'nc_holder', field);
      expect(r.status, `${field}: ${JSON.stringify(r.probes)}`).toBe('inconclusive');
      for (const p of r.probes) {
        expect(p).toMatchObject({ outcome: 'unattributed', answer: { kind: 'refused', code: 'VALIDATION_FAILED' } });
      }
    }
  });

  it('counts the contradictions as hard failures, and the vetoes as neither', () => {
    expect(report.summary).toMatchObject({
      probed: { cascade: 2, set_null: 1, restrict: 2 },
      proven: 0,
      contradicted: 3,
      failed: 0,
      inconclusive: 2,
      contradictions: 6,
      unattributed: 4,
      hardFailures: 3,
    });
    expect(formatDeleteBehaviorReport(report)).toContain('✗ nc_holder.restrict_ref <lookup → nc_target> restrict  CONTRADICTED on 2 of 2 delete(s):');
  });
});
