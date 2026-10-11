// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22726] An advisory validation rule's hit reaches the WRITE ANSWER.
 *
 * A `severity: 'warning'` / `'info'` rule never blocks a write. Until this card
 * its hit was only logged, so no client could show the person who saved what the
 * rule says. The channel, as ruled (route L, preview P2):
 *
 *   evaluateValidationRules  → returns this evaluation's advisory hits
 *   engine (insert / update) → hands them to THIS write's own
 *                              `onValidationAdvisory` listener
 *                              (`WriteObservabilityOptions`, beside `onFieldsDropped`)
 *   createData / updateData / cloneData → answer them as `warnings`, omit-when-empty
 *   engine.validate (preview) → appends them to the row's `warnings`
 *
 * Everything below runs a REAL `ObjectQL` engine and the REAL
 * `ObjectStackProtocolImplementation` over it; nothing asserts against a double of
 * the thing under test. The pins, in the card's order:
 *
 *  1. a warning rule's hit appears in the write answer and the write succeeds
 *     (create, update, clone);
 *  2. CONTROL: an `error` rule still refuses;
 *  3. CONTROL: a write with no hit carries NO `warnings` key;
 *  4. nested isolation: a hook's nested write — cross-object AND same-object —
 *     adds nothing to the outer answer, though its hits DID fire (they are in
 *     the log, measured below, so the pin cannot pass by nested writes simply
 *     not tripping anything);
 *  5. the server-side reporting is byte-identical: the per-write `warn` line,
 *     and #13889's seed / boot aggregation (seed-load control).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation, SeedLoaderService } from '@objectstack/metadata-protocol';
import { runWithAdvisoryAggregation, type AdvisoryGroup } from '@objectstack/core';
import {
  CreateDataResponseSchema,
  UpdateDataResponseSchema,
  CloneDataResponseSchema,
  ValidateDataIssueSchema,
} from '@objectstack/spec/api';
import { ObjectQL } from '../engine.js';
import { evaluateValidationRules } from './rule-validator.js';

const ADVISED = {
  rule: 'industry_advised',
  severity: 'warning' as const,
  field: '_record',
  code: 'rule_violation',
  message: 'Industry should be set.',
};
const TASK_ADVISED_RULE = 'related_advised';

const ACCT = {
  name: 'adv_acct',
  label: 'Account',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    industry: { name: 'industry', label: 'Industry', type: 'text' },
    // A covered value-shape type: the preview's warn-first admission (P2 order).
    parent_account: { name: 'parent_account', label: 'Parent', type: 'lookup', reference: 'adv_acct' },
  },
  validations: [
    {
      type: 'script' as const,
      name: ADVISED.rule,
      severity: 'warning' as const,
      condition: { dialect: 'cel', source: 'record.industry == null' },
      message: ADVISED.message,
      events: ['insert', 'update'] as Array<'insert' | 'update'>,
    },
    {
      type: 'script' as const,
      name: 'name_noted',
      severity: 'info' as const,
      condition: { dialect: 'cel', source: 'record.name == "noted"' },
      message: 'Noted for review.',
      events: ['insert', 'update'] as Array<'insert' | 'update'>,
    },
    {
      // The CONTROL: an `error` rule refuses, whatever the advisories say.
      type: 'script' as const,
      name: 'name_not_forbidden',
      severity: 'error' as const,
      condition: { dialect: 'cel', source: 'record.name == "forbidden"' },
      message: 'That name is not allowed.',
      events: ['insert', 'update'] as Array<'insert' | 'update'>,
    },
  ],
};

const TASK = {
  name: 'adv_task',
  label: 'Task',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    related_to: { name: 'related_to', label: 'Related to', type: 'text' },
  },
  validations: [{
    type: 'script' as const,
    name: TASK_ADVISED_RULE,
    severity: 'warning' as const,
    condition: { dialect: 'cel', source: 'record.related_to == null' },
    message: 'Related should be set.',
    events: ['insert', 'update'] as Array<'insert' | 'update'>,
  }],
};

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) return true;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      return (row[k] ?? null) === (expected ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = [...storeFor(object).values()].filter((r) => matches(r, ast?.where));
      // The caller's bound, AFTER the filter and by PRESENCE.
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const row = { ...data, id: (data.id as string) ?? `r_${nextId}` };
      storeFor(object).set(row.id as string, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const row = { ...storeFor(object).get(id), ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      let n = 0;
      for (const [id, row] of [...storeFor(object).entries()]) {
        if (!matches(row, ast?.where)) continue;
        storeFor(object).set(id, { ...row, ...data, id });
        n += 1;
      }
      return n;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

/** The keys a schema declares, for the "nothing undeclared" half of conformance. */
const declaredKeys = (schema: unknown) =>
  new Set(Object.keys((schema as { shape: Record<string, unknown> }).shape));

let warns: string[];
let engine: ObjectQL;
let protocol: ObjectStackProtocolImplementation;
let storeFor: ReturnType<typeof makeMemoryDriver>['storeFor'];

async function boot() {
  warns = [];
  const logger = {
    info() {}, debug() {}, error() {},
    warn(message: string) { warns.push(String(message)); },
  };
  engine = new ObjectQL({ logger } as any);
  const d = makeMemoryDriver();
  storeFor = d.storeFor;
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject(ACCT as never, 'com.objectstack.test.22726');
  engine.registry.registerObject(TASK as never, 'com.objectstack.test.22726');
  protocol = new ObjectStackProtocolImplementation(engine as never);
}

/** The per-write line the evaluator has always logged for an advisory hit. */
const perWriteLine = (rule: string, severity: string, message: string) =>
  `Validation rule '${rule}' (${severity}): ${message}`;

afterEach(() => {
  delete process.env.OS_ALLOW_LAX_VALUE_SHAPES;
});

describe('[#22726] PIN 1 — a warning rule\'s hit appears in the write answer, and the write succeeds', () => {
  beforeEach(boot);

  it('createData answers the hit as `warnings` and the record is stored', async () => {
    const res: any = await protocol.createData({ object: 'adv_acct', data: { name: 'Acme' } });

    expect(res.warnings).toEqual([ADVISED]);
    expect(storeFor('adv_acct').get(res.id)).toMatchObject({ name: 'Acme' });
    // Declared AS PRODUCED: the answer parses, and it emits no key the schema lacks.
    expect(CreateDataResponseSchema.safeParse(res).success).toBe(true);
    expect(Object.keys(res).filter((k) => !declaredKeys(CreateDataResponseSchema).has(k))).toEqual([]);
  });

  it('an `info` rule is answered too, with its own severity, in evaluation order', async () => {
    const res: any = await protocol.createData({ object: 'adv_acct', data: { name: 'noted' } });
    expect(res.warnings).toEqual([
      ADVISED,
      { rule: 'name_noted', severity: 'info', field: '_record', code: 'rule_violation', message: 'Noted for review.' },
    ]);
  });

  it('updateData (by id) answers the hit of the MERGED record, and the update is stored', async () => {
    const created: any = await protocol.createData({ object: 'adv_acct', data: { name: 'Acme', industry: 'retail' } });
    expect(created).not.toHaveProperty('warnings');

    const res: any = await protocol.updateData({ object: 'adv_acct', id: created.id, data: { industry: null } });

    expect(res.warnings).toEqual([ADVISED]);
    expect(storeFor('adv_acct').get(created.id)).toMatchObject({ industry: null });
    expect(UpdateDataResponseSchema.safeParse(res).success).toBe(true);
    expect(Object.keys(res).filter((k) => !declaredKeys(UpdateDataResponseSchema).has(k))).toEqual([]);
  });

  it('cloneData — a create on the same insert path — answers the copy\'s hit', async () => {
    const source: any = await protocol.createData({ object: 'adv_acct', data: { name: 'Acme' } });

    const res: any = await protocol.cloneData({ object: 'adv_acct', id: source.id });

    expect(res.warnings).toEqual([ADVISED]);
    expect(storeFor('adv_acct').get(res.id)).toMatchObject({ name: 'Acme' });
    expect(CloneDataResponseSchema.safeParse(res).success).toBe(true);
    expect(Object.keys(res).filter((k) => !declaredKeys(CloneDataResponseSchema).has(k))).toEqual([]);
  });

  it('every answered entry is a `ValidateDataIssue` — the element the preview reports', async () => {
    const res: any = await protocol.createData({ object: 'adv_acct', data: { name: 'noted' } });
    for (const entry of res.warnings) {
      expect(ValidateDataIssueSchema.safeParse(entry)).toMatchObject({ success: true, data: entry });
    }
  });
});

describe('[#22726] PIN 2 — CONTROL: an `error` rule still refuses', () => {
  beforeEach(boot);

  it('refuses with the ValidationError envelope, stores nothing, and answers no warnings', async () => {
    // `industry` absent, so the advisory ALSO trips: a refusal is still a refusal.
    const attempt = protocol.createData({ object: 'adv_acct', data: { name: 'forbidden' } });

    await expect(attempt).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ field: '_record', code: 'rule_violation', message: 'That name is not allowed.' }],
    });
    expect(storeFor('adv_acct').size).toBe(0);
  });

  it('refuses an update the same way, and the stored row is unchanged', async () => {
    const created: any = await protocol.createData({ object: 'adv_acct', data: { name: 'Acme', industry: 'retail' } });

    await expect(protocol.updateData({ object: 'adv_acct', id: created.id, data: { name: 'forbidden' } }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(storeFor('adv_acct').get(created.id)).toMatchObject({ name: 'Acme' });
  });
});

describe('[#22726] PIN 3 — CONTROL: a write with no hit carries no `warnings` key', () => {
  beforeEach(boot);

  it('create, update and clone each omit the key (absent, not `[]`)', async () => {
    const created: any = await protocol.createData({ object: 'adv_acct', data: { name: 'Acme', industry: 'retail' } });
    const updated: any = await protocol.updateData({ object: 'adv_acct', id: created.id, data: { name: 'Acme Corp' } });
    const cloned: any = await protocol.cloneData({ object: 'adv_acct', id: created.id });

    for (const res of [created, updated, cloned]) {
      expect(Object.keys(res)).not.toContain('warnings');
    }
  });
});

describe('[#22726] PIN 4 — a nested write\'s hits stay out of the outer answer', () => {
  beforeEach(async () => {
    await boot();
    // One CROSS-object nested write before the outer row is judged, and one
    // SAME-object nested write after it is stored. Each trips its own advisory.
    engine.registerHook('beforeInsert', async (ctx: any) => {
      if (ctx.input?.data?.name === 'outer') await engine.insert('adv_task', { name: 'nested-task' });
    }, { object: 'adv_acct' });
    engine.registerHook('afterInsert', async (ctx: any) => {
      if ((ctx.result?.name ?? ctx.input?.data?.name) === 'outer') {
        await engine.insert('adv_acct', { name: 'nested-sibling' });
      }
    }, { object: 'adv_acct' });
    engine.registerHook('afterUpdate', async (ctx: any) => {
      if (ctx.input?.data?.name === 'outer-renamed') {
        await engine.insert('adv_task', { name: 'nested-task-u' });
        await engine.insert('adv_acct', { name: 'nested-sibling-u' });
      }
    }, { object: 'adv_acct' });
  });

  it('create: only the outer row\'s hit is answered; both nested hits fired and were logged', async () => {
    const res: any = await protocol.createData({ object: 'adv_acct', data: { name: 'outer' } });

    expect(res.warnings).toEqual([ADVISED]);
    // The nested writes happened and DID trip their rules — so the answer above
    // excludes them, rather than having had nothing to exclude.
    expect([...storeFor('adv_task').values()].map((r) => r.name)).toEqual(['nested-task']);
    expect([...storeFor('adv_acct').values()].map((r) => r.name).sort()).toEqual(['nested-sibling', 'outer']);
    expect(warns.filter((l) => l === perWriteLine(TASK_ADVISED_RULE, 'warning', 'Related should be set.'))).toHaveLength(1);
    expect(warns.filter((l) => l === perWriteLine(ADVISED.rule, 'warning', ADVISED.message))).toHaveLength(2);
  });

  it('create: an outer write with NO hit of its own answers no key, though both nested writes hit', async () => {
    const res: any = await protocol.createData({ object: 'adv_acct', data: { name: 'outer', industry: 'retail' } });

    expect(Object.keys(res)).not.toContain('warnings');
    expect(warns.filter((l) => l.startsWith('Validation rule '))).toHaveLength(2);
  });

  it('update: only the updated row\'s hit is answered; the hook\'s cross- and same-object writes are not', async () => {
    const created: any = await protocol.createData({ object: 'adv_acct', data: { name: 'start', industry: 'retail' } });
    warns.length = 0;

    const res: any = await protocol.updateData({ object: 'adv_acct', id: created.id, data: { name: 'outer-renamed', industry: null } });

    expect(res.warnings).toEqual([ADVISED]);
    expect([...storeFor('adv_task').values()].map((r) => r.name)).toEqual(['nested-task-u']);
    expect(warns.filter((l) => l.startsWith('Validation rule '))).toHaveLength(3);
  });
});

describe('[#22726] PIN 5 — the server-side reporting is byte-identical', () => {
  beforeEach(boot);

  it('an ordinary write still logs the per-write line, once, beside the answer', async () => {
    const res: any = await protocol.createData({ object: 'adv_acct', data: { name: 'Acme' } });

    expect(res.warnings).toEqual([ADVISED]);
    expect(warns).toEqual([perWriteLine(ADVISED.rule, 'warning', ADVISED.message)]);
  });

  it('inside the #13889 aggregation scope the hit is folded, not logged per write — and still answered', async () => {
    let groups: AdvisoryGroup[] = [];
    const res: any = await runWithAdvisoryAggregation(
      () => protocol.createData({ object: 'adv_acct', data: { name: 'Acme' } }),
      (g) => { groups = g; },
    );

    expect(groups).toEqual([{
      object: 'adv_acct', rule: ADVISED.rule, severity: 'warning', message: ADVISED.message,
      rows: 1, sampleRows: ['name=Acme'],
    }]);
    expect(warns.filter((l) => l.startsWith('Validation rule '))).toEqual([]);
    expect(res.warnings).toEqual([ADVISED]);
  });

  it('seed-load control: a seed load reports ONE summary line for the rule and no per-row line', async () => {
    const metadata = { getObject: async () => ACCT, listObjects: async () => [ACCT] };
    const loader = new SeedLoaderService(engine as never, metadata as never, {
      info() {}, debug() {}, error() {}, warn(m: string) { warns.push(String(m)); },
    } as never);

    const result = await loader.load({
      seeds: [{
        object: 'adv_acct', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'],
        records: [{ name: 'Seed A' }, { name: 'Seed B' }],
      }],
      config: { dryRun: false, haltOnError: false, multiPass: true, defaultMode: 'upsert', batchSize: 1000, transaction: false },
    } as never);

    expect(result.summary.totalInserted).toBe(2);
    expect(warns.filter((l) => l.startsWith('Validation rule '))).toEqual([]);
    const summary = warns.filter((l) => l.includes('[SeedLoader]') && l.includes(ADVISED.rule));
    expect(summary).toHaveLength(1);
  });
});

describe('[#22726] the engine listener and the evaluator\'s return value', () => {
  beforeEach(boot);

  it('a multi update reports one event per matched row', async () => {
    await engine.insert('adv_acct', { name: 'a', industry: 'x' });
    await engine.insert('adv_acct', { name: 'b', industry: 'x' });
    const events: unknown[] = [];

    await engine.update('adv_acct', { industry: null }, {
      where: { industry: 'x' }, multi: true, onValidationAdvisory: (e: unknown) => { events.push(e); },
    } as never);

    expect(events).toEqual([ADVISED, ADVISED]);
  });

  it('a listener that throws never breaks the write: logged and ignored', async () => {
    const created = await engine.insert('adv_acct', { name: 'Acme' }, {
      onValidationAdvisory: () => { throw new Error('listener bug'); },
    } as never);

    expect(storeFor('adv_acct').get(created.id)).toMatchObject({ name: 'Acme' });
    expect(warns).toContain('onValidationAdvisory listener threw — ignored');
  });

  it('evaluateValidationRules returns [] for a write with no hit, and the hits otherwise', () => {
    expect(evaluateValidationRules(ACCT as never, { name: 'Acme', industry: 'retail' }, 'insert')).toEqual([]);
    expect(evaluateValidationRules(ACCT as never, null, 'insert')).toEqual([]);
    expect(evaluateValidationRules({ fields: {} } as never, { name: 'x' }, 'insert')).toEqual([]);
    expect(evaluateValidationRules(ACCT as never, { name: 'Acme' }, 'insert')).toEqual([ADVISED]);
  });

  it('an advisory rule that cannot be EVALUATED is not a hit: logged, never answered', async () => {
    const broken = {
      ...ACCT,
      name: 'adv_broken',
      validations: [{
        type: 'script' as const,
        name: 'reads_undeclared',
        severity: 'warning' as const,
        condition: { dialect: 'cel', source: 'record.no_such_field == 1' },
        message: 'Never shown.',
        events: ['insert'] as Array<'insert' | 'update'>,
      }],
    };
    engine.registry.registerObject(broken as never, 'com.objectstack.test.22726');

    const res: any = await protocol.createData({ object: 'adv_broken', data: { name: 'Acme' } });

    expect(Object.keys(res)).not.toContain('warnings');
    expect(warns.some((l) => l.startsWith("Validation rule 'reads_undeclared'"))).toBe(true);
  });
});

describe('[#22726] P2 — the preview appends the same hits to the row\'s `warnings`', () => {
  beforeEach(boot);

  it('an accepted row carries the hit; a clean row none; a refused row its error and no hit', async () => {
    const out: any = await protocol.validateData({
      object: 'adv_acct',
      data: [{ name: 'Acme' }, { name: 'Clean', industry: 'retail' }, { name: 'forbidden' }],
    });

    expect(out.results[0]).toMatchObject({ valid: true, errors: [], warnings: [ADVISED] });
    expect(out.results[1]).toMatchObject({ valid: true, errors: [], warnings: [] });
    expect(out.results[2].valid).toBe(false);
    expect(out.results[2].warnings).toEqual([]);
  });

  it('the preview\'s entry is the entry the write answers — one evaluation, one vocabulary', async () => {
    const preview: any = await protocol.validateData({ object: 'adv_acct', data: { name: 'noted' } });
    const written: any = await protocol.createData({ object: 'adv_acct', data: { name: 'noted' } });

    expect(preview.results[0].warnings).toEqual(written.warnings);
  });

  it('rule hits come AFTER the value-shape findings a warn-first deployment admits', async () => {
    process.env.OS_ALLOW_LAX_VALUE_SHAPES = '1';
    const out: any = await protocol.validateData({
      object: 'adv_acct',
      data: { name: 'Acme', parent_account: { nope: true } },
    });

    expect(out.results[0].valid).toBe(true);
    const warnings = out.results[0].warnings;
    expect(warnings.map((w: any) => [w.field, w.code, w.rule])).toEqual([
      ['parent_account', 'invalid_type', undefined],
      ['_record', 'rule_violation', ADVISED.rule],
    ]);
  });
});
