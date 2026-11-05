// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29029] A non-system write may name, in a `lookup` or `user` field, only a
 * record the caller's own read door returns — the rule #22519 (ruling A) set
 * for a `master_detail` header, made the default for `lookup` and `user` by
 * ruling record 6573561091, with no field-level opt-out. A target the caller
 * cannot read answers `reference_not_found`, exactly what a target that exists
 * nowhere answers. A system write keeps its exemption.
 *
 * ## The rig
 *
 * A store-backed driver, and a synthetic read scope shaped like the
 * security/sharing middlewares (the one the #22519 pins use): a non-system
 * caller reads only the target rows it owns, on both target objects (a plain
 * object and `sys_user`). A second caller's read of either target object is
 * refused outright, as an object-level denial is.
 *
 * ## Pins
 *
 *  - a `lookup` and a `user` value: insert, batch insert, update by id and
 *    bulk update — a target the caller cannot read answers what a target that
 *    exists nowhere answers (`code`, `status`, field code and the sentence);
 *  - a refused read of the target object answers the same;
 *  - a multi-valued field: one unreadable member refuses the whole write;
 *  - the mechanism: the caller's read door first, then the elevated probe;
 *  CONTROLS: a readable target lands; a system write naming an unreadable
 *  target lands and asks no read door; an update that carries a stored value
 *  back is not judged again (#29062), as for a `master_detail` header.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

const TARGET = 'urt_duty';
const USER = 'sys_user';
const ITEM = 'urt_task';

const ownedTarget = (name: string, label: string) => ({
  name,
  label,
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    owner_name: { name: 'owner_name', label: 'Owner', type: 'text' },
  },
});

const ITEM_OBJECT = {
  name: ITEM,
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    duty: { name: 'duty', label: 'Duty', type: 'lookup', reference: TARGET },
    duties: { name: 'duties', label: 'Duties', type: 'lookup', reference: TARGET, multiple: true },
    assignee: { name: 'assignee', label: 'Assignee', type: 'user' },
    watchers: { name: 'watchers', label: 'Watchers', type: 'user', multiple: true },
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
    name: 'urt-store', version: '0.0.0', supports: {},
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
const readRefusal = () => Object.assign(new Error('[Security] Access denied: read on the target object'), {
  name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403, statusCode: 403,
});

/** Every target read, with whether it ran under the caller's own context or elevated. */
type TargetRead = { object: string; operation: string; elevated: boolean };

function makeEngine() {
  const store = makeStoreDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver, true);
  engine.registerApp({
    id: 'urt',
    name: 'Unreadable reference target',
    objects: [ownedTarget(TARGET, 'Duty'), ownedTarget(USER, 'User'), ITEM_OBJECT],
  } as any);
  const targetReads: TargetRead[] = [];
  engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
    if ([TARGET, USER].includes(ctx.object) && ['find', 'findOne'].includes(ctx.operation)) {
      const elevated = ctx.context?.isSystem === true;
      targetReads.push({ object: ctx.object, operation: ctx.operation, elevated });
      const userId = ctx.context?.userId;
      if (!elevated && userId === 'carol') throw readRefusal();
      // Read scope shaped like the security/sharing middlewares: a non-system
      // caller reads only the target rows it owns.
      if (!elevated && userId) {
        const scoped = { owner_name: userId };
        const ast: any = ctx.ast ?? { object: ctx.object };
        ast.where = ast.where ? { $and: [ast.where, scoped] } : scoped;
        ctx.ast = ast;
      }
    }
    await next();
  });
  for (const object of [TARGET, USER]) {
    const rows = store.storeFor(object);
    rows.set('t_mine', { id: 't_mine', name: 'mine', owner_name: 'alice' });
    rows.set('t_mine_2', { id: 't_mine_2', name: 'mine too', owner_name: 'alice' });
    rows.set('t_other', { id: 't_other', name: 'other', owner_name: 'bob' });
  }
  return { engine, targetReads, ...store };
}

/** Alice may write every task and reads only the target rows she owns. */
const ALICE = { userId: 'alice' };
/** Carol's read of either target object is refused outright. */
const CAROL = { userId: 'carol' };
/** Seed replay / boot. */
const SYSTEM = { isSystem: true, userId: 'alice' };

const NOWHERE = 't_nowhere';
const UNREADABLE = 't_other';

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

/** The message with the target id taken out: what else a caller could compare. */
const sentence = (err: unknown, id: string) => String((err as Error).message).split(id).join('ID');

const notFound = (field: string): Envelope => ({
  status: 400, code: 'VALIDATION_FAILED', fields: [{ field, code: 'reference_not_found' }],
});

type Door = 'insert' | 'batch insert' | 'update by id' | 'bulk update';
const DOORS: Door[] = ['insert', 'batch insert', 'update by id', 'bulk update'];
const FIELDS = [
  { field: 'duty', kind: 'lookup', target: TARGET },
  { field: 'assignee', kind: 'user', target: USER },
] as const;

describe('[#29029] a non-system lookup or user write may name only a record the caller can read', () => {
  let engine: ObjectQL;
  let targetReads: TargetRead[];
  let storeFor: (o: string) => Map<string, Record<string, any>>;

  beforeEach(() => {
    ({ engine, targetReads, storeFor } = makeEngine());
    storeFor(ITEM).set('k1', { id: 'k1', title: 'stored' });
  });

  const write = (door: Door, payload: Record<string, unknown>, context: Record<string, unknown> = ALICE) => {
    if (door === 'insert') return engine.insert(ITEM, { title: 'new', ...payload }, { context } as any);
    if (door === 'batch insert') {
      return engine.insert(ITEM, [{ title: 'first' }, { title: 'second', ...payload }], { context } as any);
    }
    if (door === 'update by id') return engine.update(ITEM, payload, { where: { id: 'k1' }, context } as any);
    return engine.update(ITEM, payload, { where: { id: { $in: ['k1'] } }, multi: true, context } as any);
  };

  const storedItems = () => [...storeFor(ITEM).values()];

  describe.each(FIELDS)('a $kind field', ({ field }) => {
    it.each(DOORS)('%s — a target the caller cannot read is refused as a target that exists nowhere is', async (door) => {
      const nowhere = await refusalOf(() => write(door, { [field]: NOWHERE }));
      expect(nowhere).toBeInstanceOf(ValidationError);
      expect(envelopeOf(nowhere)).toEqual(notFound(field));
      const unreadable = await refusalOf(() => write(door, { [field]: UNREADABLE }));
      expect(envelopeOf(unreadable)).toEqual(notFound(field));
      expect(sentence(unreadable, UNREADABLE)).toBe(sentence(nowhere, NOWHERE));
      // Nothing written: the stored task is untouched, and no task was added.
      expect(storedItems()).toEqual([{ id: 'k1', title: 'stored' }]);
    });

    it.each(DOORS)('%s — a refused read of the target object answers as a target that exists nowhere', async (door) => {
      const nowhere = envelopeOf(await refusalOf(() => write(door, { [field]: NOWHERE }, CAROL)));
      expect(nowhere).toEqual(notFound(field));
      expect(envelopeOf(await refusalOf(() => write(door, { [field]: 't_mine' }, CAROL)))).toEqual(nowhere);
    });

    it.each(DOORS)('%s — control: a target the caller can read lands', async (door) => {
      await write(door, { [field]: 't_mine' });
      expect(storedItems().some((r) => r[field] === 't_mine')).toBe(true);
    });

    it.each(DOORS)('%s — control: a system write naming a target the caller cannot read lands, and asks no read door', async (door) => {
      await write(door, { [field]: UNREADABLE }, SYSTEM);
      expect(storedItems().some((r) => r[field] === UNREADABLE)).toBe(true);
      // The system caller's exemption: no read door asked (nor a probe at all).
      expect(targetReads.filter((r) => !r.elevated)).toEqual([]);
    });

    it.each(['update by id', 'bulk update'] as const)('%s — control: a stored value carried back is not judged again', async (door) => {
      storeFor(ITEM).set('k1', { id: 'k1', title: 'stored', [field]: UNREADABLE });
      await write(door, { title: 'renamed', [field]: UNREADABLE });
      expect(storedItems()).toEqual([{ id: 'k1', title: 'renamed', [field]: UNREADABLE }]);
    });

    it('the mechanism: the caller\'s read door first, then the elevated probe', async () => {
      await write('insert', { [field]: 't_mine' });
      expect(targetReads.map(({ operation, elevated }) => ({ operation, elevated }))).toEqual([
        { operation: 'find', elevated: false },
        { operation: 'findOne', elevated: true },
      ]);
    });
  });

  describe.each([
    { field: 'duties', kind: 'lookup' },
    { field: 'watchers', kind: 'user' },
  ] as const)('a multi-valued $kind field', ({ field }) => {
    it.each(['insert', 'update by id'] as const)('%s — one member the caller cannot read refuses the whole write', async (door) => {
      const err = await refusalOf(() => write(door, { [field]: ['t_mine', UNREADABLE, 't_mine_2'] }));
      expect(envelopeOf(err)).toEqual(notFound(field));
      expect(storedItems()).toEqual([{ id: 'k1', title: 'stored' }]);
    });

    it.each(['insert', 'update by id'] as const)('%s — control: every member readable lands', async (door) => {
      await write(door, { [field]: ['t_mine', 't_mine_2'] });
      expect(storedItems().some((r) => Array.isArray(r[field]) && r[field].length === 2)).toBe(true);
    });

    it('update — control: a stored member carried back beside a new readable one is not judged again', async () => {
      storeFor(ITEM).set('k1', { id: 'k1', title: 'stored', [field]: [UNREADABLE] });
      await write('update by id', { [field]: [UNREADABLE, 't_mine'] });
      expect(storeFor(ITEM).get('k1')?.[field]).toEqual([UNREADABLE, 't_mine']);
    });
  });
});
