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
import { markFlowWriteReferenceCheck, vouchForReference, VOUCHED_REFERENCES } from '@objectstack/core';
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

/**
 * [#29029] A task whose validation rules read each reference one hop: each
 * refuses a target named `flagged`. The reference check runs BEFORE them.
 */
const RULED = 'urt_ruled_task';
const RULE_MESSAGE = 'URT29029: the rule refuses the named target';
const TITLE_RULE_MESSAGE = 'URT29029: the rule refuses the title';
const RULED_OBJECT = {
  name: RULED,
  label: 'Ruled task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    duty: { name: 'duty', label: 'Duty', type: 'lookup', reference: TARGET },
    assignee: { name: 'assignee', label: 'Assignee', type: 'user' },
    header: { name: 'header', label: 'Header', type: 'master_detail', reference: TARGET },
  },
  validations: (['duty', 'assignee', 'header'] as const).map((field) => ({
    // Checked only while the reference is set, as an author guards a traversal.
    name: `urt_${field}_when_set`, type: 'conditional', severity: 'error', message: 'unused',
    when: `record.${field} != null`,
    then: { name: `urt_${field}_rule`, type: 'script', severity: 'error', message: RULE_MESSAGE, condition: `record.${field}.name == 'flagged'` },
  })).concat([
    { name: 'urt_title_rule', type: 'script', severity: 'error', message: TITLE_RULE_MESSAGE, condition: "record.title == 'flagged'" } as any,
  ]),
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
    objects: [ownedTarget(TARGET, 'Duty'), ownedTarget(USER, 'User'), ITEM_OBJECT, RULED_OBJECT],
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
    // [#29029] A readable and an unreadable target the ruled task's rules refuse.
    rows.set('t_flagged_mine', { id: 't_flagged_mine', name: 'flagged', owner_name: 'alice' });
    rows.set('t_flagged_other', { id: 't_flagged_other', name: 'flagged', owner_name: 'bob' });
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

  it.each(DOORS)('%s — control: a flow run\'s system write keeps its reference check: a target that exists nowhere is refused', async (door) => {
    const flowRun = markFlowWriteReferenceCheck({ ...SYSTEM });
    expect(envelopeOf(await refusalOf(() => write(door, { duty: NOWHERE }, flowRun)))).toEqual(notFound('duty'));
    expect(storedItems()).toEqual([{ id: 'k1', title: 'stored' }]);
  });
});

describe('[#29029] an unreadable reference answers reference_not_found before the record\'s validation rules', () => {
  let engine: ObjectQL;
  let storeFor: (o: string) => Map<string, Record<string, any>>;

  beforeEach(() => {
    ({ engine, storeFor } = makeEngine());
    storeFor(RULED).set('r1', { id: 'r1', title: 'stored' });
  });

  const write = (door: Door, payload: Record<string, unknown>, context: Record<string, unknown> = ALICE) => {
    if (door === 'insert') return engine.insert(RULED, { title: 'new', ...payload }, { context } as any);
    if (door === 'batch insert') {
      return engine.insert(RULED, [{ title: 'first' }, { title: 'second', ...payload }], { context } as any);
    }
    if (door === 'update by id') return engine.update(RULED, payload, { where: { id: 'r1' }, context } as any);
    return engine.update(RULED, payload, { where: { id: { $in: ['r1'] } }, multi: true, context } as any);
  };

  const storedRuled = () => [...storeFor(RULED).values()];
  const ruleRefusal = (err: unknown) => ({
    code: resolveThrownHttpError(err).code,
    messages: ((err as any)?.fields ?? []).map((f: any) => String(f.message ?? '')),
  });

  describe.each([
    { field: 'duty', kind: 'lookup' },
    { field: 'assignee', kind: 'user' },
    { field: 'header', kind: 'master_detail' },
  ] as const)('a $kind field', ({ field }) => {
    it.each(DOORS)('%s — a target the caller cannot read answers reference_not_found, before the record\'s validation rules', async (door) => {
      const err = await refusalOf(() => write(door, { [field]: 't_flagged_other' }));
      expect(envelopeOf(err)).toEqual(notFound(field));
      expect(String((err as Error).message)).not.toContain(RULE_MESSAGE);
      expect(storedRuled()).toEqual([{ id: 'r1', title: 'stored' }]);
    });

    it.each(DOORS)('%s — control: a readable target reaches the record\'s validation rules', async (door) => {
      const err = await refusalOf(() => write(door, { [field]: 't_flagged_mine' }));
      expect(ruleRefusal(err).code).toBe('VALIDATION_FAILED');
      expect(ruleRefusal(err).messages.some((m: string) => m.includes(RULE_MESSAGE))).toBe(true);
      expect(storedRuled()).toEqual([{ id: 'r1', title: 'stored' }]);
    });

    it.each(DOORS)('%s — control: a system write naming that target answers the rule, as before', async (door) => {
      const err = await refusalOf(() => write(door, { [field]: 't_flagged_other' }, SYSTEM));
      expect(ruleRefusal(err).messages.some((m: string) => m.includes(RULE_MESSAGE))).toBe(true);
      expect(envelopeOf(err).fields.map((f) => f.code)).not.toContain('reference_not_found');
    });
  });

  it.each(DOORS)('%s — a reference to a record that exists nowhere answers reference_not_found, before the record\'s validation rules', async (door) => {
    const err = await refusalOf(() => write(door, { title: 'flagged', duty: 't_missing' }));
    expect(envelopeOf(err)).toEqual(notFound('duty'));
    expect(String((err as Error).message)).not.toContain(TITLE_RULE_MESSAGE);
  });

  it.each(DOORS)('%s — control: a flow run\'s system write keeps the validation rules first', async (door) => {
    const flowRun = markFlowWriteReferenceCheck({ ...SYSTEM });
    const err = await refusalOf(() => write(door, { title: 'flagged', duty: 't_missing' }, flowRun));
    expect(ruleRefusal(err).messages.some((m: string) => m.includes(TITLE_RULE_MESSAGE))).toBe(true);
    expect(envelopeOf(err).fields.map((f) => f.code)).not.toContain('reference_not_found');
  });

  it('the validate preview answers as the insert does: reference_not_found for the unreadable target, the rule for the readable one', async () => {
    const unreadable = (await engine.validate(RULED, { title: 'preview', duty: 't_flagged_other' }, { mode: 'insert', context: ALICE } as any)).results?.[0];
    expect(unreadable?.valid).toBe(false);
    expect((unreadable?.errors ?? []).map((e: any) => ({ field: e.field, code: e.code }))).toEqual([{ field: 'duty', code: 'reference_not_found' }]);
    expect(JSON.stringify(unreadable?.errors ?? [])).not.toContain(RULE_MESSAGE);
    const readable = (await engine.validate(RULED, { title: 'preview', duty: 't_flagged_mine' }, { mode: 'insert', context: ALICE } as any)).results?.[0];
    expect(readable?.valid).toBe(false);
    expect((readable?.errors ?? []).some((e: any) => String(e.message).includes(RULE_MESSAGE))).toBe(true);
  });
});

describe('[#29029] which failures of the reference check fail open, and which fail closed', () => {
  it('a read door that fails for a reason other than access fails CLOSED: the target is not one the caller read', async () => {
    const { engine, storeFor } = makeEngine();
    engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      if (ctx.object === TARGET && ctx.operation === 'find' && !ctx.context?.isSystem) {
        throw new Error('no such table: urt_duty');
      }
      await next();
    });
    const err = await refusalOf(() => engine.insert(ITEM, { title: 'new', duty: 't_mine' }, { context: ALICE } as any));
    expect(envelopeOf(err)).toEqual(notFound('duty'));
    expect([...storeFor(ITEM).values()]).toEqual([]);
  });

  it('a reference to an object the registry does not hold fails OPEN: there is no read door to ask, as the existence probe already answered', async () => {
    const { engine, storeFor } = makeEngine();
    engine.registerApp({
      id: 'urt_unregistered',
      name: 'A reference to an unregistered object',
      objects: [{
        name: 'urt_loose_task',
        label: 'Loose task',
        fields: {
          title: { name: 'title', label: 'Title', type: 'text' },
          loose: { name: 'loose', label: 'Loose', type: 'lookup', reference: 'urt_not_registered' },
        },
      }],
    } as any);
    await engine.insert('urt_loose_task', { title: 'new', loose: 'x_1' }, { context: ALICE } as any);
    expect([...storeFor('urt_loose_task').values()].map((r) => r.loose)).toEqual(['x_1']);
  });
});

/**
 * [#29029, #29062] The update's reference forgiveness compares only stored
 * values the caller may read: the stored rows as the caller's own read door
 * serves them. A middleware here withholds the task's reference columns from
 * Alice's reads of the task, as a field-level read denial does.
 */
describe('[#29029] the update\'s reference forgiveness compares only stored values the caller may read', () => {
  const HIDDEN_FROM_ALICE = ['duty', 'assignee'];
  let engine: ObjectQL;
  let storeFor: (o: string) => Map<string, Record<string, any>>;

  const boot = (itemRead: 'hide columns' | 'fail' | 'serve') => {
    ({ engine, storeFor } = makeEngine());
    engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      const own = ctx.object === ITEM && ['find', 'findOne'].includes(ctx.operation) && ctx.context?.userId === 'alice' && !ctx.context?.isSystem;
      if (own && itemRead === 'fail') throw new Error('the task read failed');
      await next();
      if (own && itemRead === 'hide columns') {
        const strip = (row: any) => { if (row && typeof row === 'object') for (const f of HIDDEN_FROM_ALICE) delete row[f]; };
        if (Array.isArray(ctx.result)) ctx.result.forEach(strip); else strip(ctx.result);
      }
    });
    for (const id of ['k1', 'k2']) storeFor(ITEM).set(id, { id, title: 'stored', duty: UNREADABLE, assignee: UNREADABLE });
  };
  const write = (door: 'update by id' | 'bulk update', payload: Record<string, unknown>, context: Record<string, unknown> = ALICE) =>
    door === 'update by id'
      ? engine.update(ITEM, payload, { where: { id: 'k1' }, context } as any)
      : engine.update(ITEM, payload, { where: { id: { $in: ['k1', 'k2'] } }, multi: true, context } as any);
  const answer = (err: unknown, id: string) => JSON.stringify({ ...envelopeOf(err), sentence: sentence(err, id) });
  const untouched = () => ['k1', 'k2'].map((id) => ({ id, title: 'stored', duty: UNREADABLE, assignee: UNREADABLE }));

  describe.each(FIELDS)('a $kind column', ({ field }) => {
    it.each(['update by id', 'bulk update'] as const)('%s — a column the caller cannot read forgives nothing: the stored value answers as another unreadable one', async (door) => {
      boot('hide columns');
      const storedValue = await refusalOf(() => write(door, { [field]: UNREADABLE }));
      expect(envelopeOf(storedValue)).toEqual(notFound(field));
      const otherValue = await refusalOf(() => write(door, { [field]: 't_flagged_other' }));
      expect(answer(storedValue, UNREADABLE)).toBe(answer(otherValue, 't_flagged_other'));
      expect([...storeFor(ITEM).values()]).toEqual(untouched());
    });

    it('update by id — a read of the stored row that fails forgives nothing', async () => {
      boot('fail');
      expect(envelopeOf(await refusalOf(() => write('update by id', { [field]: UNREADABLE })))).toEqual(notFound(field));
    });

    it.each(['update by id', 'bulk update'] as const)('%s — control: a column the caller reads keeps the forgiveness', async (door) => {
      boot('serve');
      await write(door, { title: 'renamed', [field]: UNREADABLE });
      expect(storeFor(ITEM).get('k1')).toEqual({ id: 'k1', title: 'renamed', duty: UNREADABLE, assignee: UNREADABLE });
    });

    it.each(['update by id', 'bulk update'] as const)('%s — control: a flow run\'s system write compares the rows as stored', async (door) => {
      boot('hide columns');
      const flowRun = markFlowWriteReferenceCheck({ ...SYSTEM });
      await write(door, { title: 'renamed', [field]: UNREADABLE }, flowRun);
      expect(storeFor(ITEM).get('k1')?.title).toBe('renamed');
    });
  });
});

describe('a reference a service verb vouches for on its own write: that one value skips the caller\'s read door, nothing else does', () => {
  let engine: ObjectQL;
  let targetReads: TargetRead[];
  let storeFor: (o: string) => Map<string, Record<string, any>>;

  beforeEach(() => {
    ({ engine, targetReads, storeFor } = makeEngine());
  });

  /** Alice's context, vouching for `id` in `field` of a write to `object`. */
  const vouched = (id: string, field = 'duty', object = ITEM, base: Record<string, unknown> = ALICE) =>
    vouchForReference({ ...base }, { object, field, id });
  const insert = (object: string, payload: Record<string, unknown>, context: Record<string, unknown>) =>
    engine.insert(object, { title: 'new', ...payload }, { context });
  const items = (object = ITEM) => [...storeFor(object).values()];

  it('the vouched value lands although the caller cannot read it; its existence is still probed, elevated', async () => {
    await insert(ITEM, { duty: UNREADABLE }, vouched(UNREADABLE));
    expect(items().some((r) => r.duty === UNREADABLE)).toBe(true);
    // No read door asked for it; the existence probe ran.
    expect(targetReads.map(({ operation, elevated }) => ({ operation, elevated }))).toEqual([
      { operation: 'findOne', elevated: true },
    ]);
  });

  it('a vouched id that names no row is still refused reference_not_found', async () => {
    expect(envelopeOf(await refusalOf(() => insert(ITEM, { duty: NOWHERE }, vouched(NOWHERE))))).toEqual(notFound('duty'));
    expect(items()).toEqual([]);
  });

  it('control: another unreadable id in the vouched field is refused as before', async () => {
    const err = await refusalOf(() => insert(ITEM, { duty: 't_flagged_other' }, vouched(UNREADABLE)));
    expect(envelopeOf(err)).toEqual(notFound('duty'));
    expect(items()).toEqual([]);
  });

  it('control: the vouched id in another field of the same write is refused as before', async () => {
    const err = await refusalOf(() => insert(ITEM, { duty: UNREADABLE, assignee: UNREADABLE }, vouched(UNREADABLE)));
    expect(envelopeOf(err)).toEqual(notFound('assignee'));
    expect(items()).toEqual([]);
  });

  it('control: the vouched id on a write to another object is refused as before', async () => {
    const err = await refusalOf(() => insert(RULED, { duty: UNREADABLE }, vouched(UNREADABLE)));
    expect(envelopeOf(err)).toEqual(notFound('duty'));
    expect(items(RULED)).toEqual([]);
  });

  it('control: a multi-valued field admits the vouched member only, and refuses another unreadable one beside it', async () => {
    const err = await refusalOf(() => insert(ITEM, { duties: [UNREADABLE, 't_flagged_other'] }, vouched(UNREADABLE, 'duties')));
    expect(envelopeOf(err)).toEqual(notFound('duties'));
    await insert(ITEM, { duties: [UNREADABLE, 't_mine'] }, vouched(UNREADABLE, 'duties'));
    expect(items().some((r) => Array.isArray(r.duties) && r.duties.includes(UNREADABLE))).toBe(true);
  });

  it('control: the same value without the mark is refused, and a string key of the same name is no mark', async () => {
    expect(envelopeOf(await refusalOf(() => insert(ITEM, { duty: UNREADABLE }, { ...ALICE })))).toEqual(notFound('duty'));
    // What a JSON body or a stored row could spell: the symbol's description as a plain key.
    const spelled = { ...ALICE, [String(VOUCHED_REFERENCES.description)]: [{ object: ITEM, field: 'duty', id: UNREADABLE }] };
    expect(envelopeOf(await refusalOf(() => insert(ITEM, { duty: UNREADABLE }, spelled)))).toEqual(notFound('duty'));
    expect(items()).toEqual([]);
  });

  describe('the mark is spent on the vouched write: a hook that runs as the user under it is judged as any write is', () => {
    /**
     * An afterInsert hook on the task that, under the vouched insert, inserts
     * a second task naming the SAME vouched id in the SAME field — through the
     * api it is handed (the triggering user's context), or through
     * `withRunAs('user')`, as an app-authored `runAs: 'user'` hook does. Its
     * refusal is captured, and the outer write is left to finish.
     */
    const armEchoHook = (via: 'api' | 'runAs-user') => {
      const refusals: unknown[] = [];
      engine.registerHook('afterInsert', async (ctx: any) => {
        if (ctx.input?.data?.title !== 'outer') return;
        const api = via === 'api' ? ctx.api : ctx.api.withRunAs('user', { hook: 'echo', object: ITEM, event: 'afterInsert' });
        try {
          await api.object(ITEM).insert({ title: 'echo', duty: UNREADABLE });
        } catch (err) {
          refusals.push(err);
        }
      }, { object: ITEM });
      return refusals;
    };

    for (const via of ['api', 'runAs-user'] as const) {
      it(`a hook writing through ${via === 'api' ? 'the api it is handed' : "withRunAs('user')"} that names the vouched id again is refused reference_not_found`, async () => {
        const refusals = armEchoHook(via);
        await insert(ITEM, { title: 'outer', duty: UNREADABLE }, vouched(UNREADABLE));
        expect(refusals).toHaveLength(1);
        expect(envelopeOf(refusals[0])).toEqual(notFound('duty'));
        // The verb's own write landed; the hook's did not.
        expect(items().map((r) => r.title)).toEqual(['outer']);
      });
    }

    it('control: the same hook under an unmarked system write lands its echo (the hook\'s refusal above is the mark being spent, not the hook failing)', async () => {
      const refusals: unknown[] = [];
      engine.registerHook('afterInsert', async (ctx: any) => {
        if (ctx.input?.data?.title !== 'outer') return;
        try {
          await ctx.api.object(ITEM).insert({ title: 'echo', duty: UNREADABLE });
        } catch (err) {
          refusals.push(err);
        }
      }, { object: ITEM });
      await engine.insert(ITEM, { title: 'outer', duty: UNREADABLE }, { context: { isSystem: true } });
      expect(refusals).toEqual([]);
      expect(items().map((r) => r.title).sort()).toEqual(['echo', 'outer']);
    });
  });

  it('control: a caller whose read of the target object is refused outright is admitted for the vouched value only', async () => {
    await insert(ITEM, { duty: 't_mine' }, vouched('t_mine', 'duty', ITEM, CAROL));
    expect(items().some((r) => r.duty === 't_mine')).toBe(true);
    const err = await refusalOf(() => insert(ITEM, { duty: 't_mine_2' }, vouched('t_mine', 'duty', ITEM, CAROL)));
    expect(envelopeOf(err)).toEqual(notFound('duty'));
  });
});
