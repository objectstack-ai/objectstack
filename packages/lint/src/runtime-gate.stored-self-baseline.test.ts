// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22118 — the object-write differential judges a sibling's finding against
 * the STORED universe, which includes the written object's stored self.
 *
 * ## The state this closes
 *
 * `buildRuntimeWriteSnapshots` drops the written item's stored self from the
 * baseline, so the baseline is the universe WITHOUT the written object. A
 * stored sibling whose finding only shows when that object is present — a
 * detail's `lookupColumns` entry, judged against its master only when the
 * master is in the snapshot; a detail's `readonlyWhen` read through `parent`
 * — therefore had its finding absent from the baseline and present in the
 * candidate, and a label-only save of the master answered 422 for a detail
 * the author never touched. That contradicts the gate's own contract: a
 * stored object already in violation is never charged to someone else's write.
 *
 * ## The ruling this pins
 *
 * - The baseline keeps the written object's stored self: a finding located on
 *   another object that already exists against the stored universe is not new.
 * - Findings located on the written object itself are judged as before.
 * - No per-rule exemptions: every door rule reads the one differential, so
 *   the location is read off the finding's path spelling, never its rule.
 *
 * The protocol-level half — the same verdicts through the real `saveMetaItem`,
 * with the 422 envelope's `code` and `status` — is the #22118 block of
 * `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { AuthoringFinding } from './authoring-rules.js';
import {
  buildRuntimeWriteSnapshotSet,
  buildRuntimeWriteSnapshots,
  isLocatedOnAnotherEntry,
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
} from './runtime-gate.js';

type Fields = Record<string, Record<string, unknown>>;

/** The master. `sharingModel` keeps `security-owd-unset` quiet on every fixture here. */
const master = (fields: Fields = {}, over: Record<string, unknown> = {}) => ({
  name: 'fx_master',
  label: 'Master',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    code: { type: 'text', label: 'Code' },
    status: { type: 'text', label: 'Status' },
    acct: { type: 'lookup', label: 'Account', reference: 'fx_account' },
    ...fields,
  },
  ...over,
});

/** The master as the author re-saves it: only its label changed. */
const relabelled = (stored: ReturnType<typeof master>) => ({ ...stored, label: 'Master (renamed)' });

/** The master without one of its fields. */
const without = (stored: ReturnType<typeof master>, field: string) => {
  const fields = { ...stored.fields } as Fields;
  delete fields[field];
  return { ...stored, label: 'Master (renamed)', fields };
};

const account = {
  name: 'fx_account',
  label: 'Account',
  sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' } },
};

/** Measured case 1: a lookup into the master whose picker names `columns`. */
const pickerDetail = (columns: string[]) => ({
  name: 'fx_detail2',
  label: 'Picker Detail',
  sharingModel: 'private',
  fields: { m: { type: 'lookup', label: 'Master', reference: 'fx_master', lookupColumns: columns } },
});

/** Measured case 2: a detail (one `master_detail`) whose `readonlyWhen` reads through `parent`. */
const parentDetail = (predicate: string) => ({
  name: 'fx_detail',
  label: 'Parent Detail',
  sharingModel: 'private',
  fields: {
    hdr: { type: 'master_detail', label: 'Header', reference: 'fx_master' },
    qty: { type: 'number', label: 'Quantity', readonlyWhen: predicate },
  },
});

const gateObject = (item: unknown, objects: unknown[]) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects } });

/** The door's own rules run over ONE snapshot — what that snapshot holds, not a verdict. */
const findingsIn = (stack: Record<string, unknown>, type = 'object'): AuthoringFinding[] =>
  runtimeAuthoringRulesFor(type).flatMap((r) => r.run(stack, { runtimeWriteType: type }));

const dump = (r: unknown) => JSON.stringify(r, null, 2);

/** The two measured cases: the stored detail, and the finding it carries. */
const MEASURED = [
  {
    label: 'an unknown `lookupColumns` entry on a detail',
    detail: pickerDetail(['nope_col']),
    rule: 'object-field-ref-unknown',
    rawPath: 'objects[1].fields.m.lookupColumns[0]',
  },
  {
    label: 'a `readonlyWhen` read through `parent`',
    detail: parentDetail("parent.acct.name == 'x'"),
    rule: 'expression-invalid',
    rawPath: "object 'fx_detail' · field 'qty' readonlyWhen",
  },
] as const;

describe('#22118 — a label-only master save is not charged with a stored detail\'s finding', () => {
  for (const { label, detail, rule, rawPath } of MEASURED) {
    it(`⭐ RESOLVES — ${label}`, () => {
      const stored = [master(), account, detail];
      const snapshots = buildRuntimeWriteSnapshotSet({
        type: 'object',
        item: relabelled(master()),
        context: { objects: stored },
      })!;

      // Non-vacuous: the detail's finding is NEW against the universe without
      // the master — the state that answered 422 — and the stored universe
      // already holds it, at the same raw path.
      const at = (stack: Record<string, unknown>) =>
        findingsIn(stack).filter((f) => f.rule === rule && f.path === rawPath);
      expect(at(snapshots.baseline), dump(findingsIn(snapshots.baseline))).toEqual([]);
      expect(at(snapshots.candidate), dump(findingsIn(snapshots.candidate))).toHaveLength(1);
      expect(at(snapshots.stored!), dump(findingsIn(snapshots.stored!))).toHaveLength(1);

      const result = gateObject(relabelled(master()), stored);

      expect(result.rulesRun.length).toBeGreaterThan(0);
      expect(result.errors, dump(result)).toEqual([]);
      expect(result.advisories, dump(result)).toEqual([]);
    });
  }
});

describe('#22118 — the controls: what the write changes is still the write\'s', () => {
  it('⭐ CONTROL — a write that newly breaks a sibling is still REFUSED (positional path)', () => {
    // The stored master has `code`, so the stored universe holds no finding;
    // the write removes it, so the picker column now names nothing.
    const result = gateObject(without(master(), 'code'), [master(), account, pickerDetail(['code'])]);

    expect(result.errors, dump(result)).toEqual([
      expect.objectContaining({
        severity: 'error',
        rule: 'object-field-ref-unknown',
        path: 'objects.fx_detail2.fields.m.lookupColumns[0]',
      }),
    ]);
    expect(result.errors[0]!.message).toContain('"code" is not a field on object "fx_master"');
  });

  it('⭐ CONTROL — a write that newly breaks a sibling is still REFUSED (an object named in prose)', () => {
    // The stored master's `status` is text, so `parent.status.name` traverses
    // nothing; the write turns it into a lookup, and the detail's predicate
    // now reads through a reference field.
    const before = master();
    const after = master({ status: { type: 'lookup', label: 'Status', reference: 'fx_account' } }, { label: 'Master (renamed)' });
    const result = gateObject(after, [before, account, parentDetail("parent.status.name == 'x'")]);

    const where = "object 'fx_detail' · field 'qty' readonlyWhen";
    expect(result.errors, dump(result)).toEqual([
      expect.objectContaining({ severity: 'error', rule: 'expression-invalid', where, path: where }),
    ]);
    expect(result.errors[0]!.message).toContain('through `parent.status`');
  });

  // The written object's own finding, carried identically by its stored self:
  // one body per path spelling the location reader reads, so each arm's
  // written-item answer is exercised through the gate.
  const OWN = [
    {
      spelling: 'positional',
      fields: { acct: { type: 'lookup', label: 'Account', reference: 'fx_account', lookupColumns: ['nope'] } },
      over: {},
      rule: 'object-field-ref-unknown',
      path: 'objects.fx_master.fields.acct.lookupColumns[0]',
    },
    {
      spelling: 'name-keyed',
      fields: {},
      over: { validations: [{ name: 'code_shape', type: 'format', field: 'code', regex: '(', message: 'Bad code' }] },
      rule: 'validation-rule-regex-uncompilable',
      path: 'objects.fx_master.validations.code_shape.regex',
    },
    {
      spelling: 'an object named in prose',
      fields: { code: { type: 'text', label: 'Code', readonlyWhen: "record.acct.name == 'x'" } },
      over: {},
      rule: 'expression-invalid',
      path: "object 'fx_master' · field 'code' readonlyWhen",
    },
  ] as const;

  for (const { spelling, fields, over, rule, path } of OWN) {
    it(`⭐ CONTROL — a finding on the written object itself is still REFUSED, though its stored self carries it (${spelling})`, () => {
      const stored = master(fields as Fields, over);
      // Non-vacuous: the stored self carries the identical finding, so a
      // baseline that let it cancel would wave this write through.
      const snapshots = buildRuntimeWriteSnapshotSet({
        type: 'object',
        item: relabelled(stored),
        context: { objects: [stored, account] },
      })!;
      expect(findingsIn(snapshots.stored!).filter((f) => f.rule === rule).length).toBeGreaterThan(0);

      const result = gateObject(relabelled(stored), [stored, account]);

      expect(result.errors, dump(result)).toEqual([expect.objectContaining({ severity: 'error', rule, path })]);
    });
  }

  it('a CREATE is judged as before: no stored self, so the stored universe is the baseline', () => {
    // Creating the master makes the stored detail's picker column judgeable;
    // the stored universe never held that finding, so it is this write's.
    const snapshots = buildRuntimeWriteSnapshotSet({
      type: 'object',
      item: master(),
      context: { objects: [account, pickerDetail(['nope_col'])] },
    })!;
    expect(snapshots.stored).toBeUndefined();

    const result = gateObject(master(), [account, pickerDetail(['nope_col'])]);

    expect(result.errors, dump(result)).toEqual([
      expect.objectContaining({ rule: 'object-field-ref-unknown', path: 'objects.fx_detail2.fields.m.lookupColumns[0]' }),
    ]);
  });
});

describe('#22118 — the same differential on a PERMISSION write', () => {
  // `security-master-detail-ungranted` is silent while the stack authors no
  // permission set at all, so with the tenant's only set dropped from the
  // baseline every ungranted detail read as this write's advisory.
  const objects = [
    master(),
    {
      name: 'fx_line',
      label: 'Line',
      sharingModel: 'controlled_by_parent',
      fields: { hdr: { type: 'master_detail', label: 'Header', reference: 'fx_master', required: true } },
    },
  ];
  const set = { name: 'fx_ops', label: 'Ops', objects: { fx_master: { allowRead: true, readScope: 'org' } } };
  const gatePermission = (permissions: unknown[]) =>
    runRuntimeAuthoringRules({ type: 'permission', item: { ...set, label: 'Ops (renamed)' }, context: { objects, permissions } });

  it('a label-only re-save of the only set carries no stored detail\'s advisory', () => {
    const result = gatePermission([set]);

    expect(result.rulesRun).toContain('validateSecurityPosture');
    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });

  it('CONTROL — creating that set still reports it: the stored universe never held the finding', () => {
    const result = gatePermission([]);

    expect(result.advisories, dump(result)).toEqual([
      expect.objectContaining({ rule: 'security-master-detail-ungranted', path: 'objects.fx_line.fields.hdr' }),
    ]);
  });
});

describe('#22118 — the snapshot shape', () => {
  it('`stored` puts the stored self at the slot the item takes in the candidate; siblings keep theirs', () => {
    const stored = master();
    const s = buildRuntimeWriteSnapshotSet({
      type: 'object',
      item: relabelled(stored),
      context: { objects: [stored, account, pickerDetail([])] },
    })!;
    const names = (stack: Record<string, unknown>) => (stack.objects as { name: string }[]).map((o) => o.name);

    expect(names(s.baseline)).toEqual(['fx_account', 'fx_detail2']);
    expect(names(s.candidate)).toEqual(['fx_account', 'fx_detail2', 'fx_master']);
    expect(names(s.stored!)).toEqual(['fx_account', 'fx_detail2', 'fx_master']);
    expect((s.stored!.objects as unknown[])[2]).toBe(stored);
    expect((s.candidate.objects as { label: string }[])[2]!.label).toBe('Master (renamed)');
  });

  it('the published builder still returns exactly its baseline/candidate pair — `stored` is the gate\'s own', () => {
    const args = { type: 'object', item: relabelled(master()), context: { objects: [master(), account] } };
    const published = buildRuntimeWriteSnapshots(args)!;
    const set = buildRuntimeWriteSnapshotSet(args)!;

    expect(Object.keys(published)).toEqual(['baseline', 'candidate']);
    expect(set.stored).toBeDefined();
    expect(published.baseline).toEqual(set.baseline);
    expect(published.candidate).toEqual(set.candidate);
  });

  it('`stored` is absent for a write whose type is not a context collection', () => {
    const s = buildRuntimeWriteSnapshotSet({
      type: 'flow',
      item: { name: 'f1' },
      context: { objects: [master()] },
    })!;
    expect(s.stored).toBeUndefined();
  });
});

describe('#22118 — `isLocatedOnAnotherEntry` reads the location off the path spelling', () => {
  const snapshot = { objects: [{}, {}, {}], permissions: [{}], books: [], datasets: [] };
  const located = { snapshot, stackKey: 'objects', itemName: 'fx_master', writtenSlot: 2 };

  const CASES: ReadonlyArray<readonly [string, boolean]> = [
    // positional
    ['objects[2].fields.acct.lookupColumns[0]', false],
    ['objects[1].fields.m.lookupColumns[0]', true],
    ['permissions[0].objects.fx_master.readScope', true],
    // name-keyed
    ['objects.fx_master.validations.v.regex', false],
    ['objects.fx_detail.validations.v.regex', true],
    // an object named in prose
    ["object 'fx_master' · field 'code' readonlyWhen", false],
    ["object 'fx_detail' · field 'qty' readonlyWhen", true],
    // NOT positively located: today's verdict, never a cancellation
    ['flows[0].nodes[1].config', false],
    ['packages/lint/src/validate-expressions.ts', false],
    ['object "fx_detail" › fields.m', false],
    ["flow 'f1' · node 'n1'", false],
    ['', false],
  ];

  for (const [path, another] of CASES) {
    it(`${JSON.stringify(path)} → ${another}`, () => {
      expect(isLocatedOnAnotherEntry(path, located)).toBe(another);
    });
  }
});
