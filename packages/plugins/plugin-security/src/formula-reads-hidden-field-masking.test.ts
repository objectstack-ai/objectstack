// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field-level security covers what a field's value is computed from: a caller
 * who cannot read a field cannot read any computed field — a `formula`, or a
 * stored field declaring an `expression` — whose expression reads it, directly
 * or through another computed field. The computed field is withheld exactly as
 * the field it reads is: absent from the records the caller is served, and
 * refused as a filter or aggregate input. Where the field it reads is served
 * partially masked, the computed field is absent: a mask written for the input
 * does not describe a value computed from it.
 *
 * Measured through a real `ObjectQL` over a real SQL driver, with the real
 * `SecurityPlugin` middleware in front of it; the read set of one expression
 * is pinned against the masker's own helpers below.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { computedFieldReads, computedFieldsReadingWithheld } from './field-masker.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const OBJ = 'qa_fhf_account';
const SET = 'qa_fhf_reader';
const CALLER = { userId: 'usr_fhf', positions: ['qa_fhf_pos'], permissions: [SET], posture: 'MEMBER' };

const cel = (source: string) => ({ dialect: 'cel', source });

interface BootOptions {
  /** Field-level entries of the caller's permission set. */
  fields?: Record<string, { readable: boolean; editable: boolean }>;
  /** Capabilities the caller's permission set grants. */
  capabilities?: string[];
  /** The object grant's View All (reads every field of the object). */
  viewAllRecords?: boolean;
}

const teardowns: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const t of teardowns.splice(0)) await t();
});

async function boot(opts: BootOptions = {}): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.formula-reads-hidden-field',
    name: 'A computed field over a hidden field is hidden',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJ,
        label: 'Account',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          open_cases: { name: 'open_cases', type: 'number' },
          capacity: { name: 'capacity', type: 'number' },
          gated: { name: 'gated', type: 'number', requiredPermissions: ['qa_fhf_gate'] },
          phone: { name: 'phone', type: 'text', maskingRule: 'phone', requiredPermissions: ['qa_fhf_unmask'] },
          load: { name: 'load', type: 'formula', returnType: 'number', expression: cel('record.open_cases / record.capacity') },
          load_pct: { name: 'load_pct', type: 'formula', returnType: 'number', expression: cel('record.load * 100.0') },
          headroom: { name: 'headroom', type: 'formula', returnType: 'number', expression: cel('record.capacity - 1.0') },
          gated_double: { name: 'gated_double', type: 'formula', returnType: 'number', expression: cel('record.gated * 2.0') },
          open_cases_stored: { name: 'open_cases_stored', type: 'number', expression: cel('record.open_cases * 1.0') },
          phone_copy: { name: 'phone_copy', type: 'formula', returnType: 'text', expression: cel('record.phone') },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(OBJ, [
    { id: 'a1', name: 'Acme', open_cases: 6, capacity: 12, gated: 21, phone: '13812345678' },
  ], SYS);

  const set = PermissionSetSchema.parse({
    name: SET,
    ...(opts.capabilities ? { systemPermissions: opts.capabilities } : {}),
    objects: {
      [OBJ]: {
        allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
        ...(opts.viewAllRecords ? { viewAllRecords: true } : {}),
      },
    },
    ...(opts.fields ? { fields: opts.fields } : {}),
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? ([MEMBER_DEFAULT, set]).find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  teardowns.push(async () => { try { await engine.destroy(); } catch { /* noop */ } });
  return engine;
}

const HIDE_OPEN_CASES = { [`${OBJ}.open_cases`]: { readable: false, editable: false } };

const findAll = (engine: ObjectQL, extra: Record<string, unknown> = {}) =>
  engine.find(OBJ, { ...extra, context: { ...CALLER } } as never) as Promise<Record<string, unknown>[]>;
const findA1 = (engine: ObjectQL) =>
  engine.findOne(OBJ, { where: { id: 'a1' }, context: { ...CALLER } } as never) as Promise<Record<string, unknown> | null>;

/** What a refused call carries (the ADR-0112 envelope), or `landed`. */
async function outcome(p: Promise<unknown>): Promise<{ landed: unknown } | { code?: string; status?: number; forbiddenFields?: unknown }> {
  try {
    return { landed: await p };
  } catch (e: any) {
    return { code: e?.code, status: e?.statusCode ?? e?.status, forbiddenFields: e?.details?.forbiddenFields };
  }
}

describe('a formula over a field the caller cannot read is absent for that caller', () => {
  it('find and findOne: the formula is absent beside its hidden input; readable fields stay', async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES });
    const [row] = await findAll(engine);
    const one = await findA1(engine);
    for (const rec of [row, one]) {
      expect(rec).toBeTruthy();
      expect(rec).not.toHaveProperty('open_cases');
      expect(rec).not.toHaveProperty('load');
      expect(rec).toMatchObject({ name: 'Acme', capacity: 12 });
    }
  });

  it('a projection naming only the formula serves no value for it', async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES });
    const rows = await findAll(engine, { fields: ['load'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('load');
  });

  it('the record a write echoes back carries no formula over the hidden input', async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES });
    const echoed = (await engine.update(OBJ, { name: 'Acme 2' }, { where: { id: 'a1' }, context: { ...CALLER } } as never)) as any;
    const rec = Array.isArray(echoed) ? echoed[0] : echoed;
    expect(rec).toMatchObject({ name: 'Acme 2' });
    expect(rec).not.toHaveProperty('load');
    expect(rec).not.toHaveProperty('load_pct');
  });
});

describe('a formula over a formula over a hidden field is absent too (transitive)', () => {
  it('find and findOne withhold the second-level formula', async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES });
    const [row] = await findAll(engine);
    const one = await findA1(engine);
    for (const rec of [row, one]) expect(rec).not.toHaveProperty('load_pct');
  });
});

describe('a formula over a field whose requiredPermissions the caller fails is absent', () => {
  it('find and findOne withhold the formula beside its capability-gated input', async () => {
    const engine = await boot();
    const [row] = await findAll(engine);
    const one = await findA1(engine);
    for (const rec of [row, one]) {
      expect(rec).not.toHaveProperty('gated');
      expect(rec).not.toHaveProperty('gated_double');
    }
  });

  it('a caller holding the capability reads the formula', async () => {
    const engine = await boot({ capabilities: ['qa_fhf_gate'] });
    expect(await findA1(engine)).toMatchObject({ gated: 21, gated_double: 42 });
  });
});

describe('a stored computed field over a hidden field is withheld as the hidden field is', () => {
  it('it is absent from find and findOne', async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES });
    const [row] = await findAll(engine);
    const one = await findA1(engine);
    for (const rec of [row, one]) expect(rec).not.toHaveProperty('open_cases_stored');
  });

  it('filtering and aggregating by it are refused as they are by the hidden field', async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES });
    const filtered = await outcome(findAll(engine, { where: { open_cases_stored: { $gt: 5 } }, fields: ['id'] }));
    expect(filtered).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    const summed = await outcome((engine as any).aggregate(OBJ, {
      aggregations: [{ function: 'sum', field: 'open_cases_stored', alias: 's' }],
      context: { ...CALLER },
    }));
    expect(summed).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['open_cases_stored'] });
  });
});

describe('a formula over a partially masked field is absent, not partially masked', () => {
  it('the input is served masked; the formula over it is absent', async () => {
    const engine = await boot();
    const one = await findA1(engine);
    expect(one).toMatchObject({ phone: '138****5678' });
    expect(one).not.toHaveProperty('phone_copy');
  });

  it('a caller holding the unmask capability reads both in full', async () => {
    const engine = await boot({ capabilities: ['qa_fhf_unmask'] });
    expect(await findA1(engine)).toMatchObject({ phone: '13812345678', phone_copy: '13812345678' });
  });
});

describe('controls: what the rule leaves unchanged', () => {
  it('a caller who may read every input reads every computed field', async () => {
    const engine = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask'] });
    const one = await findA1(engine);
    expect(one).toMatchObject({
      open_cases: 6, load: 0.5, load_pct: 50, headroom: 11, gated_double: 42,
      open_cases_stored: 6, phone_copy: '13812345678',
    });
  });

  it('a formula over readable fields only is served to the restricted caller unchanged', async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES });
    expect(await findA1(engine)).toMatchObject({ headroom: 11 });
  });

  it('a system context reads every field and every computed field', async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES });
    const one = await engine.findOne(OBJ, { where: { id: 'a1' }, context: { isSystem: true } } as never);
    expect(one).toMatchObject({
      open_cases: 6, gated: 21, phone: '13812345678',
      load: 0.5, load_pct: 50, headroom: 11, gated_double: 42, open_cases_stored: 6, phone_copy: '13812345678',
    });
  });

  it('a View All holder reads the hidden field and the formulas over it', async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES, viewAllRecords: true });
    expect(await findA1(engine)).toMatchObject({ open_cases: 6, load: 0.5, load_pct: 50, open_cases_stored: 6 });
  });

  it("the aggregate path's input gate is unchanged: the hidden field is refused, a readable one admitted", async () => {
    const engine = await boot({ fields: HIDE_OPEN_CASES });
    const hidden = await outcome((engine as any).aggregate(OBJ, {
      aggregations: [{ function: 'sum', field: 'open_cases', alias: 's' }],
      context: { ...CALLER },
    }));
    expect(hidden).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['open_cases'] });
    const readable = await outcome((engine as any).aggregate(OBJ, {
      aggregations: [{ function: 'sum', field: 'capacity', alias: 's' }],
      context: { ...CALLER },
    }));
    expect(readable).toEqual({ landed: [{ s: 12 }] });
  });
});

describe('what a computed field reads, as the masker names it', () => {
  const reads = (source: string) => computedFieldReads({ type: 'formula', expression: cel(source) });

  it('names every member read off the record, in every literal spelling, and the reference read through', () => {
    expect([...(reads('record.a / record.b') ?? [])].sort()).toEqual(['a', 'b']);
    expect([...(reads("record['a'] + record.?b.orValue(0)") ?? [])].sort()).toEqual(['a', 'b']);
    expect([...(reads('has(record.a) ? record.b : 0') ?? [])].sort()).toEqual(['a', 'b']);
    expect([...(reads('record.owner.name') ?? [])]).toEqual(['owner']);
    expect([...(computedFieldReads({ type: 'formula', expression: 'record.a * 2' }) ?? [])]).toEqual(['a']);
  });

  it('cannot name the reads of a computed key, a method on the record, the record passed whole, or another dialect', () => {
    expect(reads('record[record.k]')).toBeNull();
    expect(reads('record.size()')).toBeNull();
    expect(reads('size(record)')).toBeNull();
    expect(reads("record.exists(k, k == 'a')")).toBeNull();
    expect(computedFieldReads({ type: 'formula', expression: { dialect: 'js', source: 'record.a' } })).toBeNull();
  });

  it('a field that declares no expression is not computed', () => {
    expect(computedFieldReads({ type: 'number' })).toBeUndefined();
    expect(computedFieldReads(undefined)).toBeUndefined();
  });

  it('a computed field whose reads cannot be named is withheld whenever another field is', () => {
    const map = { opaque: null, plain: new Set(['capacity']) };
    expect([...computedFieldsReadingWithheld(map, new Set(['open_cases']))]).toEqual(['opaque']);
    expect([...computedFieldsReadingWithheld(map, new Set())]).toEqual([]);
  });
});
