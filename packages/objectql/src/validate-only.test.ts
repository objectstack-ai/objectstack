// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `engine.validate()` — validate-only (#6037, #4633 ruling D).
 *
 * The operation exists so a dry run can stop PREDICTING the write's verdict
 * and start ASKING for it. Two properties therefore carry the whole design,
 * and both are pinned here rather than described:
 *
 *  1. **Nothing is written.** A preview that persists is #4052's retired
 *     `validateOnly` all over again — a flag that promised a dry run while the
 *     batch surfaces persisted regardless.
 *  2. **The verdict is the TARGET DEPLOYMENT'S.** ADR-0104 value shapes are
 *     rejected on a self-certified deployment and admitted on a warn-first
 *     one, and the ruling rejected option B (unconditional strict) precisely
 *     because it would fail rows that the local write would accept.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from './engine';
import type { IDataDriver } from '@objectstack/spec/contracts';

/** Records every write the driver is asked to make, so "wrote nothing" is provable. */
function makeDriver(writes: string[]): IDataDriver {
  return {
    name: 'default',
    version: '1.0.0',
    async connect() {},
    async disconnect() {},
    async find() { return []; },
    async findOne() { return null; },
    async count() { return 0; },
    async create(o: string, data: any) { writes.push(`create:${o}`); return { ...data, id: 'rec_1' }; },
    async update(o: string, id: string, data: any) { writes.push(`update:${o}`); return { ...data, id }; },
    async delete(o: string) { writes.push(`delete:${o}`); return true; },
    async bulkCreate(o: string, rows: any[]) { writes.push(`bulkCreate:${o}`); return rows; },
    async syncSchema() {},
    async dropTable() {},
  } as unknown as IDataDriver;
}

const LEAD = {
  name: 'lead',
  fields: {
    id: { type: 'text' },
    email: { type: 'email' },
    company: { type: 'text', required: true },
    score: { type: 'number', min: 0, max: 100 },
    // A covered value-shape type — this is the field the posture cases use.
    account: { type: 'lookup', reference: 'account' },
  },
};

function makeEngine(objects: any[] = [LEAD]) {
  const writes: string[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(writes), true);
  engine.registerApp({ id: 'vp', name: 'Validate Preview', objects } as any);
  return { engine, writes };
}

afterEach(() => {
  delete process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED;
  delete process.env.OS_ALLOW_LAX_VALUE_SHAPES;
});

describe('engine.validate() — validate-only (#6037)', () => {
  it('accepts a well-formed row and reports no findings', async () => {
    const { engine } = makeEngine();
    const out = await engine.validate('lead', { company: 'Acme', email: 'a@b.com', score: 10 });
    expect(out.valid).toBe(true);
    expect(out.results).toHaveLength(1);
    expect(out.results![0].errors).toEqual([]);
    expect(out.results![0].warnings).toEqual([]);
    expect(out.object).toBe('lead');
    expect(out.mode).toBe('insert');
  });

  it('reports the same field findings the write path would reject with', async () => {
    const { engine } = makeEngine();
    const out = await engine.validate('lead', { email: 'not-an-email', score: 999 });
    expect(out.valid).toBe(false);
    const codes = Object.fromEntries(out.results![0].errors.map((e) => [e.field, e.code]));
    expect(codes.email).toBe('invalid_email');
    expect(codes.score).toBe('max_value');
    // `company` is required and absent — an insert walks every declared field.
    expect(codes.company).toBe('required');
  });

  it('writes NOTHING — not even for a row that would have been accepted', async () => {
    const { engine, writes } = makeEngine();
    const out = await engine.validate('lead', [{ company: 'Acme' }, { company: 'Globex' }]);
    expect(out.valid).toBe(true);
    expect(writes).toEqual([]);
  });

  it('returns one verdict per row, in submission order', async () => {
    const { engine } = makeEngine();
    const out = await engine.validate('lead', [
      { company: 'Acme' },
      { company: 'Globex', email: 'bad' },
      { company: 'Initech' },
    ]);
    expect(out.results!.map((r) => r.valid)).toEqual([true, false, true]);
    expect(out.valid).toBe(false);
    expect(out.results![1].errors[0].field).toBe('email');
  });

  // [#4633] The preview must walk the pre-validation steps `insert()` walks,
  // or it reports findings on rows the write creates. Discovered by the import
  // dry run this operation exists to serve: a required-but-defaulted column
  // left unmapped was previewed `failed` and written `created`.
  describe('insert-time preparation the write does before it validates', () => {
    const DEFAULTED = {
      ...LEAD,
      fields: {
        ...LEAD.fields,
        tier: { type: 'text', required: true, defaultValue: 'standard' },
      },
    };

    it('a required field with a `defaultValue` is NOT reported missing — the write defaults it first', async () => {
      const { engine } = makeEngine([DEFAULTED]);
      const out = await engine.validate('lead', { company: 'Acme' });
      expect(out.results![0].errors).toEqual([]);
      expect(out.valid).toBe(true);
    });

    it('agrees with the write on that row — preview and insert, one engine', async () => {
      const { engine } = makeEngine([DEFAULTED]);
      const previewValid = (await engine.validate('lead', { company: 'Acme' })).valid;
      let writeSucceeded = true;
      try { await engine.insert('lead', { company: 'Acme' }); } catch { writeSucceeded = false; }
      expect(previewValid).toBe(writeSucceeded);
      expect(writeSucceeded).toBe(true);
    });

    it('does not default in `update` mode — a PATCH never re-applies defaults (#2706)', async () => {
      const { engine } = makeEngine([DEFAULTED]);
      // Supplying an explicit null on update means "clear it", so the preview
      // must judge the null the caller sent, not a default it never gets.
      const out = await engine.validate('lead', { tier: null }, { mode: 'update' });
      expect(out.results![0].errors.some((e) => e.field === 'tier')).toBe(true);
    });

    it('never mutates the caller’s row objects', async () => {
      const { engine } = makeEngine([DEFAULTED]);
      const row: Record<string, unknown> = { company: 'Acme' };
      await engine.validate('lead', row);
      expect(row).toEqual({ company: 'Acme' });
    });
  });

  it('judges only supplied keys in `update` mode, matching a PATCH', async () => {
    const { engine } = makeEngine();
    // `company` is required but absent. An insert rejects that; a PATCH that
    // does not mention the field must not.
    expect((await engine.validate('lead', { email: 'a@b.com' }, { mode: 'insert' })).valid).toBe(false);
    expect((await engine.validate('lead', { email: 'a@b.com' }, { mode: 'update' })).valid).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ADR-0104 posture — the reason option B was rejected. Same row, same
  // engine, two deployments, two legitimate verdicts.
  // ──────────────────────────────────────────────────────────────────────────
  describe('ADR-0104 posture is the deployment’s, not a constant', () => {
    // A `lookup` whose value is not a well-formed reference.
    const badShape = { company: 'Acme', account: { nope: true } };

    it('REJECTS a bad value shape on a self-certified (strict) deployment', async () => {
      process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED = '1';
      const { engine } = makeEngine();
      const out = await engine.validate('lead', badShape);
      expect(out.posture.valueShapeStrict).toBe(true);
      expect(out.valid).toBe(false);
      expect(out.results![0].errors.some((e) => e.field === 'account')).toBe(true);
      expect(out.results![0].warnings).toEqual([]);
    });

    it('ADMITS the same row on a warn-first deployment, and says so as a warning', async () => {
      process.env.OS_ALLOW_LAX_VALUE_SHAPES = '1';
      const { engine } = makeEngine();
      const out = await engine.validate('lead', badShape);
      expect(out.posture.valueShapeStrict).toBe(false);
      // Valid — because the WRITE here would store it. Reporting `failed`
      // would be the false alarm the ruling rejected (#4633 option B).
      expect(out.valid).toBe(true);
      expect(out.results![0].errors).toEqual([]);
      const warning = out.results![0].warnings.find((w) => w.field === 'account');
      expect(warning).toBeDefined();
      // Same code as the strict rejection — one finding that changed buckets,
      // not two vocabularies for one bad value.
      expect(warning!.code).toBe('invalid_type');
    });

    it('agrees with what the real write does, in BOTH postures', async () => {
      // The property the whole ruling rests on: preview == write. Asserted by
      // running both against the same engine rather than by reasoning about it.
      for (const [envVar, expectWriteToSucceed] of [
        ['OS_ALLOW_LAX_VALUE_SHAPES', true],
        ['OS_DATA_VALUE_SHAPE_STRICT_ENABLED', false],
      ] as const) {
        delete process.env.OS_ALLOW_LAX_VALUE_SHAPES;
        delete process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED;
        process.env[envVar] = '1';

        const { engine } = makeEngine();
        const previewValid = (await engine.validate('lead', badShape)).valid;

        let writeSucceeded = true;
        try {
          await engine.insert('lead', { ...badShape });
        } catch {
          writeSucceeded = false;
        }

        expect(previewValid, `preview under ${envVar}`).toBe(expectWriteToSucceed);
        expect(writeSucceeded, `write under ${envVar}`).toBe(expectWriteToSucceed);
        expect(previewValid, `preview must match write under ${envVar}`).toBe(writeSucceeded);
      }
    });

    it('does not record a warn-first admission as certification evidence (#4769)', async () => {
      // The sink exists so a boot cannot certify a contract it has just
      // written against. A preview writes nothing, so letting it record an
      // admission would let a PREVIEW block a later migration.
      process.env.OS_ALLOW_LAX_VALUE_SHAPES = '1';
      const { engine } = makeEngine();
      const sink: unknown[] = [];
      (engine as any).admittedViolationSink = () => (v: unknown) => { sink.push(v); };
      await engine.validate('lead', badShape);
      expect(sink).toEqual([]);
    });
  });

  it('surfaces object-level validation rules, not just field checks', async () => {
    // One of the family the hand-copied mirror structurally could not predict.
    const { engine } = makeEngine([{
      ...LEAD,
      validations: [{
        name: 'score_needs_email',
        type: 'cross_field',
        // A `cross_field` predicate states the VIOLATION: `checkPredicate`
        // reports a finding when the condition evaluates true.
        condition: 'record.score > 50 && (record.email == null || record.email == "")',
        message: 'A lead scored above 50 must carry an email.',
        active: true,
      }],
    }]);
    const out = await engine.validate('lead', { company: 'Acme', score: 80 });
    expect(out.valid).toBe(false);
    expect(out.results![0].errors.some((e) => e.message.includes('must carry an email'))).toBe(true);
  });
});
