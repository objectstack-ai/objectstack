// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A declared `state_machine` judges every write from the record's STORED
 * state, and clearing the state field is itself a transition the machine must
 * admit — so no sequence of writes leaves a state the machine would refuse to
 * leave in one write.
 *
 * ## The rig
 *
 * The real `ObjectQL` engine over a store-backed driver (what is stored is
 * what a later read answers), one object whose state field is NOT required, so
 * the field validator never refuses an empty value on its own. Its machine:
 * `open → closed`, `closed` a declared dead-end (`[]`), and `paused`, which
 * lists the empty value `''` and so may be cleared.
 *
 * ## Pins
 *
 *  - a clear from a declared state is refused with the transition refusal
 *    (`VALIDATION_FAILED` / 400, field code `invalid_transition`, `from → ''`),
 *    by id and through the bulk door, for an elevated caller too, written as
 *    `null` or as `''`; nothing is written, so the next write is judged from
 *    the state still stored;
 *  - the direct illegal transition is still refused (control);
 *  CONTROLS: a declared transition lands; a clear the machine lists lands; an
 *  empty field written empty again, and a write that does not touch the state
 *  field, are not judged.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

const OBJ = 'smss_ticket';

const TICKET = {
  name: OBJ,
  label: 'Ticket',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'paused', label: 'Paused' },
        { value: 'closed', label: 'Closed' },
      ],
    },
  },
  validations: [{
    type: 'state_machine',
    name: 'smss_flow',
    message: 'That status change is not allowed.',
    field: 'status',
    events: ['update'],
    transitions: { open: ['closed', 'paused'], paused: ['open', ''], closed: [] },
  }],
};

/** A store-backed driver: what is stored is what a later read answers. */
function makeStoreDriver() {
  const rows = new Map<string, Record<string, any>>();
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`store driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return Object.entries(v).every(([op, target]) => {
          if (op === '$eq') return row?.[k] === target;
          if (op === '$in') return Array.isArray(target) && target.includes(row?.[k]);
          throw new Error(`store driver: unsupported operator ${op}`);
        });
      }
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'smss-store', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async find(_o: string, ast: any) {
      const hits = Array.from(rows.values()).filter((r) => matches(r, ast?.where));
      return (typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits).map((r) => ({ ...r }));
    },
    async findOne(_o: string, ast: any) {
      for (const r of rows.values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(_o: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `rec_${n}`;
      const row = { ...data, id };
      rows.set(id, row);
      return { ...row };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      const row = { ...rows.get(id), ...data, id };
      rows.set(id, row);
      return { ...row };
    },
    async updateMany(_o: string, ast: any, data: Record<string, unknown>) {
      const hits = Array.from(rows.values()).filter((r) => matches(r, ast?.where));
      for (const r of hits) rows.set(r.id, { ...r, ...data, id: r.id });
      return hits.length;
    },
    async delete(_o: string, id: string) { return rows.delete(id); },
    async count(_o: string, ast: any) {
      return Array.from(rows.values()).filter((r) => matches(r, ast?.where)).length;
    },
  };
  return { driver, rows };
}

type Envelope = { status: number; code: string; fields: Array<{ field: string; code: string; constraint?: unknown }> };

/** The refusal as every HTTP door reads it (ADR-0112), plus its field codes. */
function envelopeOf(err: unknown): Envelope {
  const thrown = resolveThrownHttpError(err);
  const fields = ((err as any)?.fields ?? []).map((f: any) => ({ field: f.field, code: f.code, constraint: f.constraint }));
  return { status: thrown.status, code: thrown.code, fields };
}

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

const transitionRefusal = (from: string, to: string): Envelope => ({
  status: 400, code: 'VALIDATION_FAILED', fields: [{ field: 'status', code: 'invalid_transition', constraint: { from, to } }],
});

const ALICE = { userId: 'alice' };
const SYSTEM = { isSystem: true, userId: 'alice' };

type Door = 'update by id' | 'bulk update';
const DOORS: Door[] = ['update by id', 'bulk update'];

describe('a state machine judges every write from the stored state, a clear included', () => {
  let engine: ObjectQL;
  let rows: Map<string, Record<string, any>>;

  beforeEach(() => {
    const store = makeStoreDriver();
    rows = store.rows;
    engine = new ObjectQL();
    engine.registerDriver(store.driver, true);
    engine.registerApp({ id: 'smss', name: 'State machine stored state', objects: [TICKET] } as any);
  });

  const seed = (status: string | null) => rows.set('t1', { id: 't1', title: 'stored', status });
  const write = (door: Door, payload: Record<string, unknown>, context: Record<string, unknown> = ALICE) => {
    if (door === 'update by id') return engine.update(OBJ, payload, { where: { id: 't1' }, context } as any);
    return engine.update(OBJ, payload, { where: { id: { $in: ['t1'] } }, multi: true, context } as any);
  };
  const stored = () => rows.get('t1')?.status;

  describe.each(DOORS)('%s', (door) => {
    it.each([['null', null], ['the empty string', '']] as const)(
      'a clear (written as %s) from a declared dead-end is refused as a transition, and the state stays stored',
      async (_label, empty) => {
        seed('closed');
        const err = await refusalOf(() => write(door, { status: empty }));
        expect(err).toBeInstanceOf(ValidationError);
        expect(envelopeOf(err)).toEqual(transitionRefusal('closed', ''));
        expect(stored()).toBe('closed');
        // The next write is judged from the state still stored: leaving it is refused.
        expect(envelopeOf(await refusalOf(() => write(door, { status: 'open' })))).toEqual(transitionRefusal('closed', 'open'));
        expect(stored()).toBe('closed');
      },
    );

    it('a clear from a state that does not list the empty value is refused', async () => {
      seed('open');
      expect(envelopeOf(await refusalOf(() => write(door, { status: null })))).toEqual(transitionRefusal('open', ''));
      expect(stored()).toBe('open');
    });

    it('an elevated caller is judged the same way', async () => {
      seed('closed');
      expect(envelopeOf(await refusalOf(() => write(door, { status: null }, SYSTEM)))).toEqual(transitionRefusal('closed', ''));
      expect(stored()).toBe('closed');
    });

    it('control: the direct illegal transition is still refused', async () => {
      seed('closed');
      expect(envelopeOf(await refusalOf(() => write(door, { status: 'open' })))).toEqual(transitionRefusal('closed', 'open'));
      expect(stored()).toBe('closed');
    });

    it('control: a declared transition lands', async () => {
      seed('open');
      await write(door, { status: 'closed' });
      expect(stored()).toBe('closed');
    });

    it('control: a clear the machine lists lands', async () => {
      seed('paused');
      await write(door, { status: null });
      expect(stored() ?? null).toBeNull();
    });

    it('control: an empty field written empty again, and a write that leaves the state alone, are not judged', async () => {
      seed(null);
      await write(door, { status: null });
      expect(stored() ?? null).toBeNull();
      seed('closed');
      await write(door, { title: 'renamed' });
      expect(rows.get('t1')).toMatchObject({ title: 'renamed', status: 'closed' });
    });
  });
});
