// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22892] A predicate rule that reads one hop through a master-detail FK
 * finds a header the caller cannot read unavailable, exactly as a header that
 * exists nowhere is. Ruling A on #22519 (an unreadable header is a nonexistent
 * one), extended to the rule's related read.
 *
 * ## The defect
 *
 * `resolvePredicateRelated` (#18682) read the related row ELEVATED (tenant
 * kept), with no caller row bound on a walled object, a tenanted master
 * included. Validation rules run before the reference check, so for a caller
 * who may write a detail but cannot read its header the rule judged the
 * header's stored state. Measured on `018b077fbf` with this file's rig and a
 * rule refusing a line under a locked invoice: a header that exists nowhere
 * answered `_record` `rule_violation` (the rule could not be evaluated), an
 * unreadable open header `invoice` `reference_not_found`, and an unreadable
 * locked header `_record` `rule_violation` with the rule's own message. Three
 * answers for "unreadable or nonexistent": one bit of the header's state.
 *
 * ## The fix
 *
 * Through a `master_detail` FK the related read takes the write's two-read
 * shape (`masterDetailHeadersCallerReads`, PR #22891): the caller's read door
 * first, under the caller's own context; a header it does not return is
 * `unresolved`, exactly as a header that exists nowhere is; the elevated,
 * tenant-kept read follows for the headers the door returned only.
 *
 * ## The rig
 *
 * The one #22519's pins use: a store-backed driver and a synthetic read scope
 * shaped like the security/sharing middlewares (a non-system caller reads only
 * the headers it owns; Carol's read of the header object is refused outright).
 *
 * ## Pins
 *
 *  - a header that exists nowhere, an unreadable open header and an unreadable
 *    locked header answer identically: insert, the batch insert, an update by
 *    id, a repoint by id, the bulk update and the `validate()` preview; a
 *    refused read of the header object answers alike; the partial batch;
 *  - the mechanism: the read door first, and no elevated read for a header it
 *    did not return;
 *  CONTROLS: a readable header is judged on its stored values (a column the
 *  read door hides or masks included); a plain `lookup` traversal to the same
 *  object is unchanged; a system caller is unchanged.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

const HEADER = 'ph_invoice';
const LINE = 'ph_line';
const LOOKUP_LINE = 'ph_lookup_line';

const RULE_MESSAGE = 'A locked invoice takes no lines.';

const HEADER_OBJECT = {
  name: HEADER,
  label: 'Invoice',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    owner_name: { name: 'owner_name', label: 'Owner', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

/** The detail: a predicate rule reads its master through the master-detail FK. */
const LINE_OBJECT = {
  name: LINE,
  label: 'Line',
  fields: {
    invoice: { name: 'invoice', label: 'Invoice', type: 'master_detail', reference: HEADER },
    quantity: { name: 'quantity', label: 'Quantity', type: 'number' },
  },
  validations: [{
    name: 'no_lines_on_locked', type: 'script', severity: 'error',
    message: RULE_MESSAGE, condition: "record.invoice.status == 'locked'",
  }],
};

/** The same rule through a plain `lookup` to the same object: not this rule's. */
const LOOKUP_LINE_OBJECT = {
  name: LOOKUP_LINE,
  label: 'Lookup line',
  fields: {
    invoice_ref: { name: 'invoice_ref', label: 'Invoice', type: 'lookup', reference: HEADER },
  },
  validations: [{
    name: 'no_refs_to_locked', type: 'script', severity: 'error',
    message: RULE_MESSAGE, condition: "record.invoice_ref.status == 'locked'",
  }],
};

/** A store-backed driver: what is stored is what a later read answers. */
function makeStoreDriver() {
  const stores = new Map<string, Map<string, Record<string, any>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
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
    name: 'ph-store', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const hits = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return (typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits).map((r) => ({ ...r }));
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `rec_${n}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return { ...row };
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const row = { ...storeFor(o).get(id), ...data, id };
      storeFor(o).set(id, row);
      return { ...row };
    },
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const hits = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of hits) storeFor(o).set(r.id, { ...r, ...data, id: r.id });
      return hits.length;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length;
    },
  };
  return { driver, storeFor };
}

/** The refusal an object-level read denial throws — `PermissionDeniedError`'s declared envelope. */
const readRefusal = () => Object.assign(new Error('[Security] Access denied: read on the header object'), {
  name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403, statusCode: 403,
});

/** Every header read: its operation, whether it ran elevated, and the ids it asked. */
type HeaderRead = { operation: string; elevated: boolean; where: unknown };

function makeEngine() {
  const store = makeStoreDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver, true);
  engine.registerApp({
    id: 'ph',
    name: 'Predicate read through a master-detail FK',
    objects: [HEADER_OBJECT, LINE_OBJECT, LOOKUP_LINE_OBJECT],
  } as any);
  const headerReads: HeaderRead[] = [];
  engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
    if (ctx.object === HEADER && ['find', 'findOne'].includes(ctx.operation)) {
      const elevated = ctx.context?.isSystem === true;
      headerReads.push({ operation: ctx.operation, elevated, where: ctx.ast?.where });
      const userId = ctx.context?.userId;
      if (!elevated && userId === 'carol') throw readRefusal();
      // Read scope shaped like the security/sharing middlewares: a non-system
      // caller reads only the headers it owns.
      if (!elevated && userId) {
        const scoped = { owner_name: userId };
        const ast: any = ctx.ast ?? { object: ctx.object };
        ast.where = ast.where ? { $and: [ast.where, scoped] } : scoped;
        ctx.ast = ast;
      }
    }
    await next();
  });
  const headers = store.storeFor(HEADER);
  for (const [id, owner, status] of [
    ['h_mine_open', 'alice', 'open'],
    ['h_mine_locked', 'alice', 'locked'],
    ['h_other_open', 'bob', 'open'],
    ['h_other_locked', 'bob', 'locked'],
  ] as const) {
    headers.set(id, { id, name: id, owner_name: owner, status });
  }
  return { engine, headerReads, ...store };
}

/** Alice may write every line and reads only the headers she owns. */
const ALICE = { userId: 'alice' };
/** Carol's read of the header object is refused outright. */
const CAROL = { userId: 'carol' };
/** Seed replay / boot. */
const SYSTEM = { isSystem: true, userId: 'alice' };

const NOWHERE = 'h_nowhere';
const UNREADABLE = ['h_other_open', 'h_other_locked'] as const;

type Answer = { status: number; code: string; fields: Array<{ field: string; code: string }>; message: string };

/** The refusal as every HTTP door reads it (ADR-0112), its field codes, and its text with the header id taken out. */
function answerOf(err: unknown, id: string): Answer {
  const thrown = resolveThrownHttpError(err);
  const fields = ((err as any)?.fields ?? []).map((f: any) => ({ field: f.field, code: f.code }));
  return { status: thrown.status, code: thrown.code, fields, message: String((err as Error).message).split(id).join('ID') };
}

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

/** ADR-0137 D2: the rule has no verdict over a header that is not there. */
const UNEVALUABLE = { status: 400, code: 'VALIDATION_FAILED', fields: [{ field: '_record', code: 'rule_violation' }] };

/** The rule's own verdict: it read the header's stored state and refused (the bulk path adds the row id). */
function expectRuleVerdict(answer: Answer): void {
  expect(answer).toMatchObject(UNEVALUABLE);
  expect(answer.message.startsWith(RULE_MESSAGE)).toBe(true);
}

describe('[#22892] a predicate rule reading its master through the master-detail FK finds an unreadable header as a nonexistent one', () => {
  let engine: ObjectQL;
  let headerReads: HeaderRead[];
  let storeFor: (o: string) => Map<string, Record<string, any>>;

  beforeEach(() => {
    ({ engine, headerReads, storeFor } = makeEngine());
  });

  type Door = 'insert' | 'batch insert' | 'update by id' | 'repoint by id' | 'bulk update';
  const DOORS: Door[] = ['insert', 'batch insert', 'update by id', 'repoint by id', 'bulk update'];

  /** One write through `door` that lands the line under `header`. */
  const write = (door: Door, header: string, context: Record<string, unknown> = ALICE) => {
    const lines = storeFor(LINE);
    if (door === 'insert') return engine.insert(LINE, { invoice: header, quantity: 1 }, { context } as any);
    if (door === 'batch insert') {
      return engine.insert(LINE, [{ invoice: 'h_mine_open', quantity: 1 }, { invoice: header, quantity: 2 }], { context } as any);
    }
    if (door === 'repoint by id') {
      lines.set('l_r', { id: 'l_r', invoice: 'h_mine_open', quantity: 1 });
      return engine.update(LINE, { invoice: header }, { where: { id: 'l_r' }, context } as any);
    }
    // The stored line already hangs off `header`; the patch does not name it.
    const id = `l_${door.replace(/ /g, '_')}_${header}`;
    lines.set(id, { id, invoice: header, quantity: 1 });
    const bulk = door === 'bulk update';
    return engine.update(LINE, { quantity: 5 }, { where: bulk ? { id: { $in: [id] } } : { id }, multi: bulk, context } as any);
  };

  describe('the three answers become one', () => {
    it.each(DOORS)('%s — a header that exists nowhere, an unreadable open header and an unreadable locked header answer identically', async (door) => {
      const before = [...storeFor(LINE).values()];
      const nowhere = await refusalOf(() => write(door, NOWHERE));
      expect(nowhere).toBeInstanceOf(ValidationError);
      expect(answerOf(nowhere, NOWHERE)).toMatchObject(UNEVALUABLE);
      expect(answerOf(nowhere, NOWHERE).message).toContain('the related record was not found');
      for (const header of UNREADABLE) {
        expect(answerOf(await refusalOf(() => write(door, header)), header)).toEqual(answerOf(nowhere, NOWHERE));
      }
      // Nothing written: no line added, and every stored line keeps its values.
      const after = [...storeFor(LINE).values()];
      expect(after.filter((r) => r.quantity === 5 || r.quantity === 2)).toEqual([]);
      expect(after.filter((r) => r.id === 'l_r').every((r) => r.invoice === 'h_mine_open')).toBe(true);
      expect(after.length).toBeGreaterThanOrEqual(before.length);
    });

    it.each(DOORS)('%s — a refused read of the header object answers as a header that exists nowhere', async (door) => {
      const nowhere = answerOf(await refusalOf(() => write(door, NOWHERE, CAROL)), NOWHERE);
      expect(nowhere).toMatchObject(UNEVALUABLE);
      // Alice's headers exist; Carol's read door refuses the object, whatever they hold.
      for (const header of ['h_mine_open', 'h_mine_locked']) {
        expect(answerOf(await refusalOf(() => write(door, header, CAROL)), header)).toEqual(nowhere);
      }
    });

    it('the validate() preview answers as the write does', async () => {
      const preview = async (header: string) => {
        const out = await engine.validate(LINE, { invoice: header, quantity: 1 }, { mode: 'insert', context: ALICE } as any);
        return (out.results?.[0]?.errors ?? []).map((e: any) => ({ field: e.field, code: e.code, message: String(e.message).split(header).join('ID') }));
      };
      const nowhere = await preview(NOWHERE);
      expect(nowhere).toEqual([expect.objectContaining({ field: '_record', code: 'rule_violation' })]);
      for (const header of UNREADABLE) expect(await preview(header)).toEqual(nowhere);
      // CONTROL: a readable header is judged on its stored state.
      expect(await preview('h_mine_locked')).toEqual([{ field: '_record', code: 'rule_violation', message: RULE_MESSAGE }]);
      expect(await preview('h_mine_open')).toEqual([]);
    });

    it('the partial batch: unreadable rows fail as a nonexistent row does, and readable rows are judged on their stored state', async () => {
      const out = await engine.insertMany(LINE, [
        { invoice: 'h_other_open', quantity: 1 },
        { invoice: 'h_other_locked', quantity: 2 },
        { invoice: NOWHERE, quantity: 3 },
        { invoice: 'h_mine_locked', quantity: 4 },
        { invoice: 'h_mine_open', quantity: 5 },
      ], { context: ALICE } as any);
      expect(out.map((o) => o.ok)).toEqual([false, false, false, false, true]);
      const errors = out.map((o) => (o.ok ? undefined : o.error));
      const nowhere = answerOf(errors[2], NOWHERE);
      expect(nowhere).toMatchObject(UNEVALUABLE);
      expect(answerOf(errors[0], 'h_other_open')).toEqual(nowhere);
      expect(answerOf(errors[1], 'h_other_locked')).toEqual(nowhere);
      expectRuleVerdict(answerOf(errors[3], 'h_mine_locked'));
      expect([...storeFor(LINE).values()].map((r) => r.invoice)).toEqual(['h_mine_open']);
    });

    it('the mechanism: the caller\'s read door first, and no elevated read of a header it did not return', async () => {
      await refusalOf(() => engine.insert(LINE, { invoice: 'h_other_locked', quantity: 1 }, { context: ALICE } as any));
      expect(headerReads).toEqual([
        { operation: 'find', elevated: false, where: { id: 'h_other_locked' } },
      ]);
      headerReads.length = 0;
      await engine.insert(LINE, { invoice: 'h_mine_open', quantity: 1 }, { context: ALICE } as any);
      expect(headerReads.slice(0, 2)).toEqual([
        // the rule's related read: the read door, then the elevated read of what it returned
        { operation: 'find', elevated: false, where: { id: 'h_mine_open' } },
        { operation: 'find', elevated: true, where: { id: { $in: ['h_mine_open'] } } },
      ]);
    });
  });

  describe('CONTROLS', () => {
    it.each(DOORS)('%s — a readable header is judged on its stored values: locked refuses with the rule\'s message, open lands', async (door) => {
      expectRuleVerdict(answerOf(await refusalOf(() => write(door, 'h_mine_locked')), 'h_mine_locked'));
      await write(door, 'h_mine_open');
    });

    it.each(['hide', 'mask'] as const)('a readable header whose state column the read door %ss is still judged on its stored value', async (how) => {
      engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        await next();
        if (ctx.object !== HEADER || ctx.context?.isSystem || ctx.context?.userId !== 'alice') return;
        const apply = (r: any) => {
          if (!r || typeof r !== 'object') return;
          if (how === 'hide') delete r.status;
          else if (typeof r.status === 'string') r.status = '*'.repeat(r.status.length);
        };
        if (Array.isArray(ctx.result)) ctx.result.forEach(apply);
        else apply(ctx.result);
      });
      // Precondition: the read door serves Alice her header, its state column restricted.
      const served = await engine.findOne(HEADER, { where: { id: 'h_mine_locked' }, context: ALICE });
      expect(served).toMatchObject({ id: 'h_mine_locked' });
      expect(served?.status).not.toBe('locked');
      const err = await refusalOf(() => engine.insert(LINE, { invoice: 'h_mine_locked', quantity: 1 }, { context: ALICE } as any));
      expectRuleVerdict(answerOf(err, 'h_mine_locked'));
    });

    it('a plain lookup traversal to the same object is unchanged: the header\'s stored state is judged, and no read door is asked', async () => {
      const err = await refusalOf(() => engine.insert(LOOKUP_LINE, { invoice_ref: 'h_other_locked' }, { context: ALICE } as any));
      expectRuleVerdict(answerOf(err, 'h_other_locked'));
      await engine.insert(LOOKUP_LINE, { invoice_ref: 'h_other_open' }, { context: ALICE } as any);
      expect([...storeFor(LOOKUP_LINE).values()].map((r) => r.invoice_ref)).toEqual(['h_other_open']);
      expect(headerReads.length).toBeGreaterThan(0);
      expect(headerReads.filter((r) => !r.elevated)).toEqual([]);
    });

    it('a system caller is unchanged: the header is judged whoever owns it, and no read door is asked', async () => {
      const err = await refusalOf(() => engine.insert(LINE, { invoice: 'h_other_locked', quantity: 1 }, { context: SYSTEM } as any));
      expectRuleVerdict(answerOf(err, 'h_other_locked'));
      await engine.insert(LINE, { invoice: 'h_other_open', quantity: 1 }, { context: SYSTEM } as any);
      storeFor(LINE).set('l_s', { id: 'l_s', invoice: 'h_other_locked', quantity: 1 });
      const updated = await refusalOf(() => engine.update(LINE, { quantity: 9 }, { where: { id: 'l_s' }, context: SYSTEM } as any));
      expectRuleVerdict(answerOf(updated, 'h_other_locked'));
      expect([...storeFor(LINE).values()].map((r) => r.invoice)).toEqual(['h_other_open', 'h_other_locked']);
      expect(headerReads.length).toBeGreaterThan(0);
      expect(headerReads.filter((r) => !r.elevated)).toEqual([]);
    });
  });
});
