// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The reference-value shape family (ADR-0104 D1) — what it derives, what it
// proves on a real stack, and the two controls that keep its green honest:
//
//   • the NEGATIVE control: the same metadata on a stack whose posture admits
//     wrong-shaped references (`OS_ALLOW_LAX_VALUE_SHAPES=1`, ADR-0104's
//     declared escape hatch) must be reported with holes, and must count as
//     hard failures;
//   • the ATTRIBUTION control: an engine that refuses every write without
//     naming the probed field must not read as proven.
//
// The positive half boots the real stack: a fresh datastore is born attested
// (ADR-0104, 2026-07-30 addendum), so the engine's shape gate is strict there,
// and every probe has to come back refused WITH the field named.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { valueSchemaFor } from '@objectstack/spec/data';

import { bootStack, type VerifyStack } from './harness.js';
import {
  deriveReferenceShapeCases,
  referenceShapeProbeValue,
  runReferenceShapeProofs,
  formatReferenceShapeReport,
  REFERENCE_SHAPE_PROBE_ID,
  type ReferenceShapeReport,
} from './reference-shape.js';

const LAX = 'OS_ALLOW_LAX_VALUE_SHAPES';

/** Every single-valued reference type the engine stores as one record id, plus one excluded field. */
const app = {
  manifest: { id: 'com.example.reference-shape', namespace: 'refshape', version: '0.0.1', type: 'app', name: 'Reference Shape Fixture' },
  objects: [
    { name: 'rs_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } },
    {
      name: 'rs_contact',
      label: 'Contact',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        account: { type: 'lookup', reference: 'rs_account', label: 'Account' },
        parent: { type: 'master_detail', reference: 'rs_account', label: 'Parent', required: true },
        assignee: { type: 'user', label: 'Assignee' },
        stamped_account: { type: 'lookup', reference: 'rs_account', label: 'Stamped Account', readonly: true },
      },
    },
  ],
};

const PROBED = ['account', 'parent', 'assignee'] as const;
/** 2 doors × 2 operations × 3 probe kinds. */
const PROBES_PER_FIELD = 12;

const resultFor = (report: ReferenceShapeReport, field: string) => {
  const r = report.results.find((x) => x.object === 'rs_contact' && x.field === field);
  if (!r) throw new Error(`no result for rs_contact.${field}`);
  return r;
};

describe('deriveReferenceShapeCases — what the family derives from the metadata', () => {
  it('covers every declared reference field, and names the ones outside the property', () => {
    const config = {
      objects: [
        ...app.objects,
        {
          name: 'rs_board',
          fields: {
            accounts: { type: 'lookup', reference: 'rs_account', multiple: true },
            parent_board: { type: 'tree', reference: 'rs_board' },
            owner_ref: { type: 'lookup', reference: 'rs_account', system: true },
            title: { type: 'text' },
          },
        },
      ],
    };
    const cases = deriveReferenceShapeCases(config);
    const byKey = new Map(cases.map((c) => [`${c.object}.${c.field}`, c]));

    expect([...byKey.keys()].sort()).toEqual([
      'rs_board.accounts', 'rs_board.owner_ref', 'rs_board.parent_board',
      'rs_contact.account', 'rs_contact.assignee', 'rs_contact.parent', 'rs_contact.stamped_account',
    ]);
    expect(byKey.get('rs_contact.stamped_account')).toMatchObject({ excluded: expect.stringMatching(/^readonly/), probes: [] });
    expect(byKey.get('rs_board.owner_ref')).toMatchObject({ excluded: expect.stringMatching(/^system/), probes: [] });
    expect(byKey.get('rs_contact.assignee')).toMatchObject({ type: 'user', target: 'sys_user', multiple: false });
    expect(byKey.get('rs_board.accounts')).toMatchObject({ multiple: true, target: 'rs_account' });
    for (const c of cases.filter((x) => !x.excluded)) {
      expect(c.probes, `${c.object}.${c.field}`).toEqual(['boolean', 'number', 'embedded-record']);
      expect(c.droppedProbes).toBeUndefined();
    }
  });

  it('writes each probe in the declared cardinality, and the spec contract refuses every one', () => {
    for (const multiple of [false, true]) {
      const stored = valueSchemaFor({ type: 'lookup', multiple }, 'stored');
      for (const kind of ['boolean', 'number', 'embedded-record'] as const) {
        const value = referenceShapeProbeValue(kind, multiple, REFERENCE_SHAPE_PROBE_ID);
        expect(Array.isArray(value), `${kind} multiple=${multiple}`).toBe(multiple);
        expect(stored.safeParse(value).success, `${kind} multiple=${multiple}`).toBe(false);
      }
      // The control on the contract read: a record id in the declared
      // cardinality is a value the same schema accepts.
      const id = multiple ? [REFERENCE_SHAPE_PROBE_ID] : REFERENCE_SHAPE_PROBE_ID;
      expect(stored.safeParse(id).success).toBe(true);
    }
  });
});

describe('runReferenceShapeProofs — on a real stack', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(app as never);
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('proves every client-writable reference field refuses each wrong shape, on both doors, naming the field', async () => {
    const report = await runReferenceShapeProofs(stack, token, app);

    for (const field of PROBED) {
      const r = resultFor(report, field);
      expect(r.status, `${field}:\n${formatReferenceShapeReport(report)}`).toBe('proven');
      expect(r.probes).toHaveLength(PROBES_PER_FIELD);
      // The engine's shape gate answered, not a later one: the code it located
      // the refusal with is the value-shape verdict's.
      expect(new Set(r.probes.map((p) => `${p.outcome}:${p.code}`))).toEqual(new Set(['refused:invalid_type']));
      // Both doors and both operations really ran.
      expect(new Set(r.probes.map((p) => `${p.door}/${p.operation}`))).toEqual(
        new Set(['rest/insert', 'rest/update', 'system/insert', 'system/update']),
      );
    }
    expect(resultFor(report, 'stamped_account')).toMatchObject({ status: 'excluded', probes: [] });
    expect(report.summary).toMatchObject({
      fields: 4, proven: 3, holes: 0, failed: 0, inconclusive: 0, excluded: 1,
      probes: 3 * PROBES_PER_FIELD, refused: 3 * PROBES_PER_FIELD, admitted: 0, unattributed: 0, notRun: 0,
      hardFailures: 0,
    });
  }, 120_000);

  it('NEGATIVE CONTROL: the same metadata on a posture that admits wrong shapes is reported with holes', async () => {
    const prior = process.env[LAX];
    process.env[LAX] = '1';
    let report: ReferenceShapeReport;
    try {
      report = await runReferenceShapeProofs(stack, token, app);
    } finally {
      if (prior === undefined) delete process.env[LAX];
      else process.env[LAX] = prior;
    }

    for (const field of PROBED) {
      const r = resultFor(report, field);
      expect(r.status, `${field}:\n${formatReferenceShapeReport(report)}`).toBe('holes');
      // The system door runs no reference-existence check, so with the shape
      // gate relaxed a wrong-shaped value lands there.
      const systemInsertBoolean = r.probes.find((p) => p.door === 'system' && p.operation === 'insert' && p.probe === 'boolean');
      expect(systemInsertBoolean?.outcome).toBe('admitted');
    }
    expect(report.summary.holes).toBe(3);
    expect(report.summary.hardFailures).toBe(3);
    expect(formatReferenceShapeReport(report)).toMatch(/✗ rs_contact\.account <lookup>\s+ADMITTED/);
  }, 120_000);
});

describe('runReferenceShapeProofs — attribution is the control', () => {
  /** Whether the double has already answered the base record's create. */
  let probing = false;

  /**
   * A stack double whose every probe is refused, but for a field the probe did
   * not write. The base record is created (so every probe runs), and nothing
   * else is answered. An engine that refuses EVERYTHING would satisfy each
   * probe if a bare refusal counted; it must read as inconclusive instead.
   */
  function refuseNamingAnotherField(): VerifyStack {
    const refusal = { code: 'VALIDATION_FAILED', fields: [{ field: 'name', code: 'required' }] };
    return {
      async apiAs(_token: string, method: string, path: string) {
        if (method === 'POST' && path === '/data/rs_account') return Response.json({ id: 'acc_1' }, { status: 201 });
        if (method === 'POST' && path === '/data/rs_contact' && !probing) {
          probing = true;
          return Response.json({ id: 'con_1' }, { status: 201 });
        }
        return Response.json({ error: 'Name is required', ...refusal }, { status: 400 });
      },
      hooks: {
        async run() {
          throw Object.assign(new Error('Name is required'), refusal);
        },
      },
    } as unknown as VerifyStack;
  }
  it('a refusal that does not name the probed field is unattributed, never proven', async () => {
    probing = false;
    const report = await runReferenceShapeProofs(refuseNamingAnotherField(), 'token', app);
    for (const field of PROBED) {
      const r = resultFor(report, field);
      expect(r.status).toBe('inconclusive');
      expect(r.probes.every((p) => p.outcome === 'unattributed' && p.code === 'VALIDATION_FAILED')).toBe(true);
    }
    expect(report.summary).toMatchObject({ proven: 0, refused: 0, hardFailures: 0, inconclusive: 3 });
  });
});
