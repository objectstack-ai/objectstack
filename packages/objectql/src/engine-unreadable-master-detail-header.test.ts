// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22519] A write of a master-detail detail whose header the caller cannot
 * read answers exactly what a write naming a header that exists nowhere
 * answers — for every detail, `controlled_by_parent` or not, on insert,
 * update (a repoint included) and the bulk paths.
 *
 * ## The defect
 *
 * The write read the header ELEVATED (tenant kept, #19837): the reference
 * check's probe and the `parent` binding of a parent-scoped `requiredWhen` /
 * `readonlyWhen` both bypassed the caller's row-level access. Their docblock
 * declared that safe because the caller's right to write the detail was
 * "settled upstream" — but ADR-0055 §3 gates a detail write on its header only
 * for a `controlled_by_parent` detail. So for a caller who may write a detail
 * but cannot read its header, the write admitted a header id a nonexistent one
 * would refuse, and a parent-scoped rule judged the header's stored state: one
 * bit of a row the caller cannot read, per write.
 *
 * ## The fix
 *
 * The write's header read takes the two-read shape the preview already uses
 * (`resolvePreviewParents`): first the caller's read door, under the caller's
 * own context — a header it does not return binds as a missing header binds;
 * then the write's own elevated, tenant-kept read for the headers read 1
 * returned only. A header the caller CAN read is still judged on its stored
 * values, a column the read door masks for the caller included.
 *
 * ## The rig
 *
 * A store-backed driver, and a synthetic read scope shaped like the
 * security/sharing middlewares (the one #22474's preview pins use): a
 * non-system caller reads only the headers it owns. A second shape refuses the
 * caller's read of the header object outright, as an object-level denial does.
 *
 * ## Pins
 *
 *  (a) the reference check: insert, the batch insert, a repoint by id and in
 *      bulk — an unreadable header answers `reference_not_found`, the answer of
 *      a nonexistent header id;
 *  (b) `requiredWhen` over `parent`: insert, update by id, a repoint, bulk —
 *      an unreadable header in either state answers what a nonexistent one does;
 *  (c) `readonlyWhen` over `parent`: by id and bulk, lenient and strict;
 *  the mechanism: the read door first, then the elevated read;
 *  CONTROLS: a readable header unchanged (its stored values judged, a masked
 *  column included); a nonexistent id; a `controlled_by_parent` detail
 *  unchanged; a system caller unchanged (no read door asked); a plain `lookup`
 *  to the same object keeps its elevated probe (not this rule's).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

const HEADER = 'uh_invoice';
const PLAIN_LINE = 'uh_line';
const REQ_LINE = 'uh_req_line';
const RO_ITEM = 'uh_ro_item';
const CBP_LINE = 'uh_cbp_line';
const LOOKUP_NOTE = 'uh_lookup_note';

const HEADER_OBJECT = {
  name: HEADER,
  label: 'Invoice',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    owner_name: { name: 'owner_name', label: 'Owner', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

const invoiceField = { name: 'invoice', label: 'Invoice', type: 'master_detail', reference: HEADER };

/** A detail with no parent-scoped rule: the reference check alone speaks. */
const PLAIN_LINE_OBJECT = {
  name: PLAIN_LINE,
  label: 'Line',
  fields: {
    invoice: invoiceField,
    quantity: { name: 'quantity', label: 'Quantity', type: 'number' },
  },
};

/** `requiredWhen` over `parent`. */
const REQ_LINE_OBJECT = {
  name: REQ_LINE,
  label: 'Required line',
  fields: {
    invoice: invoiceField,
    note: { name: 'note', label: 'Note', type: 'text', requiredWhen: "parent.status == 'locked'" },
    quantity: { name: 'quantity', label: 'Quantity', type: 'number' },
  },
};

/** `readonlyWhen` over `parent`. */
const RO_ITEM_OBJECT = {
  name: RO_ITEM,
  label: 'Item',
  fields: {
    invoice: invoiceField,
    memo: { name: 'memo', label: 'Memo', type: 'text', readonlyWhen: "parent.status == 'locked'" },
  },
};

/** The ADR-0055 §3 detail: the same rule, and the same answers. */
const CBP_LINE_OBJECT = {
  ...REQ_LINE_OBJECT,
  name: CBP_LINE,
  label: 'Controlled line',
  sharingModel: 'controlled_by_parent',
};

/** A plain `lookup` to the same object: its probe is not this rule's. */
const LOOKUP_NOTE_OBJECT = {
  name: LOOKUP_NOTE,
  label: 'Lookup note',
  fields: {
    invoice_ref: { name: 'invoice_ref', label: 'Invoice', type: 'lookup', reference: HEADER },
  },
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
    name: 'uh-store', version: '0.0.0', supports: {},
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

/** Every header read, with whether it ran under the caller's own context or elevated. */
type HeaderRead = { operation: string; elevated: boolean };

function makeEngine() {
  const store = makeStoreDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver, true);
  engine.registerApp({
    id: 'uh',
    name: 'Unreadable master-detail header',
    objects: [HEADER_OBJECT, PLAIN_LINE_OBJECT, REQ_LINE_OBJECT, RO_ITEM_OBJECT, CBP_LINE_OBJECT, LOOKUP_NOTE_OBJECT],
  } as any);
  const headerReads: HeaderRead[] = [];
  engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
    if (ctx.object === HEADER && ['find', 'findOne'].includes(ctx.operation)) {
      const elevated = ctx.context?.isSystem === true;
      headerReads.push({ operation: ctx.operation, elevated });
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

/** Alice may write every detail object and reads only the headers she owns. */
const ALICE = { userId: 'alice' };
/** Carol's read of the header object is refused outright. */
const CAROL = { userId: 'carol' };
/** Seed replay / boot. */
const SYSTEM = { isSystem: true, userId: 'alice' };

const NOWHERE = 'h_nowhere';
const UNREADABLE = ['h_other_open', 'h_other_locked'] as const;

type Envelope = { status: number; code: string; fields: Array<{ field: string; code: string }> };

/** The refusal as every HTTP door reads it (ADR-0112), plus its field codes. */
function envelopeOf(err: unknown): Envelope {
  const thrown = resolveThrownHttpError(err);
  const fields = ((err as any)?.fields ?? []).map((f: any) => ({ field: f.field, code: f.code }));
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

/** The message with the header id taken out: what else a caller could compare. */
const sentence = (err: unknown, id: string) => String((err as Error).message).split(id).join('ID');

const NOT_FOUND: Envelope = { status: 400, code: 'VALIDATION_FAILED', fields: [{ field: 'invoice', code: 'reference_not_found' }] };
/** ADR-0137 D2: an unbound `parent` leaves the requirement without a verdict. */
const UNEVALUABLE: Envelope = { status: 400, code: 'VALIDATION_FAILED', fields: [{ field: 'note', code: 'rule_violation' }] };
const REQUIRED: Envelope = { status: 400, code: 'VALIDATION_FAILED', fields: [{ field: 'note', code: 'required' }] };

describe('[#22519] an unreadable master-detail header answers what a nonexistent header id answers', () => {
  let engine: ObjectQL;
  let headerReads: HeaderRead[];
  let storeFor: (o: string) => Map<string, Record<string, any>>;

  beforeEach(() => {
    ({ engine, headerReads, storeFor } = makeEngine());
  });

  describe('(a) the reference check', () => {
    type Door = 'insert' | 'batch insert' | 'repoint by id' | 'bulk repoint';
    const DOORS: Door[] = ['insert', 'batch insert', 'repoint by id', 'bulk repoint'];

    const write = (door: Door, invoice: string, context: Record<string, unknown> = ALICE) => {
      if (door === 'insert') return engine.insert(PLAIN_LINE, { invoice, quantity: 1 }, { context } as any);
      if (door === 'batch insert') {
        return engine.insert(PLAIN_LINE, [{ invoice: 'h_mine_open', quantity: 1 }, { invoice, quantity: 2 }], { context } as any);
      }
      if (door === 'repoint by id') return engine.update(PLAIN_LINE, { invoice }, { where: { id: 'l1' }, context } as any);
      return engine.update(PLAIN_LINE, { invoice }, { where: { id: { $in: ['l1'] } }, multi: true, context } as any);
    };

    beforeEach(() => {
      storeFor(PLAIN_LINE).set('l1', { id: 'l1', invoice: 'h_mine_open', quantity: 1 });
    });

    it.each(DOORS)('%s — an unreadable header in either state is refused as a nonexistent header id is', async (door) => {
      const nowhere = await refusalOf(() => write(door, NOWHERE));
      expect(nowhere).toBeInstanceOf(ValidationError);
      expect(envelopeOf(nowhere)).toEqual(NOT_FOUND);
      for (const header of UNREADABLE) {
        const err = await refusalOf(() => write(door, header));
        expect(envelopeOf(err)).toEqual(NOT_FOUND);
        expect(sentence(err, header)).toBe(sentence(nowhere, NOWHERE));
      }
      // Nothing written: the stored line stays home, and no line was added.
      expect([...storeFor(PLAIN_LINE).values()]).toEqual([{ id: 'l1', invoice: 'h_mine_open', quantity: 1 }]);
    });

    it.each(DOORS)('%s — a refused read of the header object answers as a nonexistent header id', async (door) => {
      const nowhere = envelopeOf(await refusalOf(() => write(door, NOWHERE, CAROL)));
      expect(nowhere).toEqual(NOT_FOUND);
      // Alice's own header: it exists, and Carol's read door refuses the object.
      expect(envelopeOf(await refusalOf(() => write(door, 'h_mine_open', CAROL)))).toEqual(nowhere);
    });

    it('the partial batch insert: an unreadable row fails as a nonexistent row does, and a readable row lands', async () => {
      const out = await engine.insertMany(PLAIN_LINE, [
        { invoice: 'h_other_locked', quantity: 1 },
        { invoice: NOWHERE, quantity: 2 },
        { invoice: 'h_mine_locked', quantity: 3 },
      ], { context: ALICE } as any);
      expect(out.map((o) => o.ok)).toEqual([false, false, true]);
      const [unreadable, nowhere] = out.map((o) => (o.ok ? undefined : o.error));
      expect(envelopeOf(nowhere)).toEqual(NOT_FOUND);
      expect(envelopeOf(unreadable)).toEqual(envelopeOf(nowhere));
      expect([...storeFor(PLAIN_LINE).values()].map((r) => r.invoice)).toEqual(['h_mine_open', 'h_mine_locked']);
    });

    it.each(DOORS)('%s — control: a readable header still lands', async (door) => {
      await write(door, 'h_mine_locked');
      expect([...storeFor(PLAIN_LINE).values()].some((r) => r.invoice === 'h_mine_locked')).toBe(true);
    });

    it('control: a plain lookup to the same object keeps its elevated probe — not this rule\'s', async () => {
      await engine.insert(LOOKUP_NOTE, { invoice_ref: 'h_other_open' }, { context: ALICE } as any);
      expect([...storeFor(LOOKUP_NOTE).values()].map((r) => r.invoice_ref)).toEqual(['h_other_open']);
      const nowhere = await refusalOf(() => engine.insert(LOOKUP_NOTE, { invoice_ref: NOWHERE }, { context: ALICE } as any));
      expect(envelopeOf(nowhere)).toEqual({ ...NOT_FOUND, fields: [{ field: 'invoice_ref', code: 'reference_not_found' }] });
      // No read door was asked for it.
      expect(headerReads.filter((r) => !r.elevated)).toEqual([]);
    });
  });

  describe('(b) requiredWhen over parent', () => {
    it('insert — an unreadable header in either state answers what a nonexistent one does', async () => {
      const nowhere = await refusalOf(() => engine.insert(REQ_LINE, { invoice: NOWHERE, quantity: 1 }, { context: ALICE } as any));
      expect(envelopeOf(nowhere)).toEqual(UNEVALUABLE);
      for (const header of UNREADABLE) {
        const err = await refusalOf(() => engine.insert(REQ_LINE, { invoice: header, quantity: 1 }, { context: ALICE } as any));
        expect(envelopeOf(err)).toEqual(envelopeOf(nowhere));
        expect(sentence(err, header)).toBe(sentence(nowhere, NOWHERE));
      }
      expect(storeFor(REQ_LINE).size).toBe(0);
    });

    it('update by id and bulk — a stored unreadable header in either state is judged as a stored nonexistent one', async () => {
      const lines = storeFor(REQ_LINE);
      const clear = async (id: string, header: string, bulk: boolean) => {
        lines.set(id, { id, invoice: header, note: 'n', quantity: 1 });
        const where = bulk ? { id: { $in: [id] } } : { id };
        return envelopeOf(await refusalOf(() => engine.update(REQ_LINE, { note: '' }, { where, multi: bulk, context: ALICE } as any)));
      };
      for (const bulk of [false, true]) {
        const nowhere = await clear(`ln_gone_${bulk}`, NOWHERE, bulk);
        expect(nowhere).toEqual(UNEVALUABLE);
        for (const header of UNREADABLE) expect(await clear(`ln_${header}_${bulk}`, header, bulk)).toEqual(nowhere);
      }
      expect([...lines.values()].every((r) => r.note === 'n')).toBe(true);
    });

    it('a repoint by id and in bulk — onto an unreadable header in either state answers what one onto a nonexistent header does', async () => {
      const lines = storeFor(REQ_LINE);
      const repoint = async (header: string, bulk: boolean) => {
        lines.set('ln_r', { id: 'ln_r', invoice: 'h_mine_open', note: null, quantity: 1 });
        const where = bulk ? { id: { $in: ['ln_r'] } } : { id: 'ln_r' };
        return refusalOf(() => engine.update(REQ_LINE, { invoice: header }, { where, multi: bulk, context: ALICE } as any));
      };
      for (const bulk of [false, true]) {
        const nowhere = await repoint(NOWHERE, bulk);
        expect(envelopeOf(nowhere)).toEqual(UNEVALUABLE);
        for (const header of UNREADABLE) {
          const err = await repoint(header, bulk);
          expect(envelopeOf(err)).toEqual(envelopeOf(nowhere));
          expect(sentence(err, header)).toBe(sentence(nowhere, NOWHERE));
        }
      }
      expect(lines.get('ln_r')?.invoice).toBe('h_mine_open');
    });

    it('a refused read of the header object answers as a nonexistent header', async () => {
      const nowhere = envelopeOf(await refusalOf(() => engine.insert(REQ_LINE, { invoice: NOWHERE, quantity: 1 }, { context: CAROL } as any)));
      expect(envelopeOf(await refusalOf(() => engine.insert(REQ_LINE, { invoice: 'h_mine_locked', quantity: 1 }, { context: CAROL } as any)))).toEqual(nowhere);
      expect(envelopeOf(await refusalOf(() => engine.insert(REQ_LINE, { invoice: 'h_mine_open', quantity: 1 }, { context: CAROL } as any)))).toEqual(nowhere);
    });

    it('control: a readable header is judged on its stored state — locked requires, open lands', async () => {
      const err = await refusalOf(() => engine.insert(REQ_LINE, { invoice: 'h_mine_locked', quantity: 1 }, { context: ALICE } as any));
      expect(envelopeOf(err)).toEqual(REQUIRED);
      await engine.insert(REQ_LINE, { invoice: 'h_mine_open', quantity: 1 }, { context: ALICE } as any);
      expect([...storeFor(REQ_LINE).values()].map((r) => r.invoice)).toEqual(['h_mine_open']);
    });

    it('the mechanism: the caller\'s read door first, then the elevated read — for the binding and for the reference check', async () => {
      await engine.insert(REQ_LINE, { invoice: 'h_mine_open', quantity: 1 }, { context: ALICE } as any);
      expect(headerReads).toEqual([
        // the `parent` binding, batched
        { operation: 'find', elevated: false },
        { operation: 'find', elevated: true },
        // the reference check
        { operation: 'find', elevated: false },
        { operation: 'findOne', elevated: true },
      ]);
    });

    it.each(['hide', 'mask'] as const)('control: a readable header whose state column the read door %ss is still judged on its stored value', async (how) => {
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
      const err = await refusalOf(() => engine.insert(REQ_LINE, { invoice: 'h_mine_locked', quantity: 1 }, { context: ALICE } as any));
      expect(envelopeOf(err)).toEqual(REQUIRED);
    });

    it('control: a controlled_by_parent detail is unchanged under a readable header', async () => {
      expect(envelopeOf(await refusalOf(() => engine.insert(CBP_LINE, { invoice: 'h_mine_locked', quantity: 1 }, { context: ALICE } as any)))).toEqual(REQUIRED);
      await engine.insert(CBP_LINE, { invoice: 'h_mine_open', quantity: 1 }, { context: ALICE } as any);
      expect([...storeFor(CBP_LINE).values()].map((r) => r.invoice)).toEqual(['h_mine_open']);
    });

    it('a controlled_by_parent detail takes the same rule under an unreadable header', async () => {
      const nowhere = envelopeOf(await refusalOf(() => engine.insert(CBP_LINE, { invoice: NOWHERE, quantity: 1 }, { context: ALICE } as any)));
      expect(nowhere).toEqual(UNEVALUABLE);
      for (const header of UNREADABLE) {
        expect(envelopeOf(await refusalOf(() => engine.insert(CBP_LINE, { invoice: header, quantity: 1 }, { context: ALICE } as any)))).toEqual(nowhere);
      }
    });

    it('control: a system caller is unchanged — the header is bound whoever owns it, and no read door is asked', async () => {
      const err = await refusalOf(() => engine.insert(REQ_LINE, { invoice: 'h_other_locked', quantity: 1 }, { context: SYSTEM } as any));
      expect(envelopeOf(err)).toEqual(REQUIRED);
      await engine.insert(REQ_LINE, { invoice: 'h_other_open', quantity: 1 }, { context: SYSTEM } as any);
      storeFor(REQ_LINE).set('ln_s', { id: 'ln_s', invoice: 'h_other_locked', note: 'n', quantity: 1 });
      const cleared = await refusalOf(() => engine.update(REQ_LINE, { note: '' }, { where: { id: 'ln_s' }, context: SYSTEM } as any));
      expect(envelopeOf(cleared)).toEqual(REQUIRED);
      await engine.insert(PLAIN_LINE, { invoice: 'h_other_open', quantity: 1 }, { context: SYSTEM } as any);
      expect([...storeFor(PLAIN_LINE).values()].map((r) => r.invoice)).toEqual(['h_other_open']);
      expect(headerReads.length).toBeGreaterThan(0);
      expect(headerReads.filter((r) => !r.elevated)).toEqual([]);
    });
  });

  describe('(c) readonlyWhen over parent', () => {
    const memoAfter = async (header: string, bulk: boolean, strict = false) => {
      const items = storeFor(RO_ITEM);
      const id = `it_${header}_${bulk}`;
      items.set(id, { id, invoice: header, memo: 'orig' });
      const drops: unknown[] = [];
      const where = bulk ? { id: { $in: [id] } } : { id };
      try {
        await engine.update(RO_ITEM, { memo: 'new' }, {
          where, multi: bulk, context: ALICE, onFieldsDropped: (d: unknown) => drops.push(d), strictReadonlyWrites: strict,
        } as any);
      } catch (e) {
        const { status, code } = envelopeOf(e);
        return { memo: items.get(id)?.memo, drops, refused: { status, code } };
      }
      return { memo: items.get(id)?.memo, drops, refused: undefined };
    };

    it.each([false, true])('bulk: %s — a stored unreadable header in either state locks the field as a stored nonexistent one does', async (bulk) => {
      const nowhere = await memoAfter(NOWHERE, bulk);
      expect(nowhere).toEqual({ memo: 'orig', drops: [{ object: RO_ITEM, fields: ['memo'], reason: 'readonly_when' }], refused: undefined });
      for (const header of UNREADABLE) expect(await memoAfter(header, bulk)).toEqual(nowhere);
    });

    it('strict: an unreadable header in either state is refused as a nonexistent one is', async () => {
      const nowhere = await memoAfter(NOWHERE, false, true);
      expect(nowhere.refused).toEqual({ status: 500, code: 'ERR_READONLY_FIELD_REJECTED' });
      for (const header of UNREADABLE) expect(await memoAfter(header, false, true)).toEqual(nowhere);
    });

    it.each([false, true])('bulk: %s — control: a readable locked header still locks, an open one lets the field through', async (bulk) => {
      expect((await memoAfter('h_mine_locked', bulk)).memo).toBe('orig');
      expect((await memoAfter('h_mine_open', bulk)).memo).toBe('new');
    });
  });
});
