// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field-level security covers what a field's value is computed from: a caller
 * who cannot read a field cannot read any computed field — a `formula`, or a
 * stored field declaring an `expression` — whose expression reads it: on its
 * own record, through another computed field, or on the record it reads
 * through a reference. The computed field is withheld exactly as the field it
 * reads is, on every reader: absent from the records the caller is served,
 * refused as a filter, sort, group or aggregate input, absent from the read
 * and query projections, and reported hidden by explain. Where the field it
 * reads is served partially masked, the computed field is absent; where its
 * reads cannot be named, it is withheld whenever any other field is.
 *
 * Measured through a real `ObjectQL` over a real SQL driver, with the real
 * `SecurityPlugin` middleware in front of it; the read set of one expression
 * is pinned against the platform's member reader below.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { analyzeRelationshipTraversals } from '@objectstack/formula';

import { SecurityPlugin } from './security-plugin.js';
import { computedFieldsReadingWithheld, readComputedFieldExpression } from './field-masker.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const OBJ = 'qa_fhf_account';
const REGION = 'qa_fhf_region';
const SET = 'qa_fhf_reader';
const SECOND = 'qa_fhf_second';
const CALLER = { userId: 'usr_fhf', positions: ['qa_fhf_pos'], permissions: [SET], posture: 'MEMBER' };
const TWO_SETS = { ...CALLER, permissions: [SET, SECOND] };

const cel = (source: string) => ({ dialect: 'cel', source });
const num = (source: string) => ({ type: 'formula', returnType: 'number', expression: cel(source) });

type FieldEntries = Record<string, { readable: boolean; editable: boolean }>;

interface BootOptions {
  /** Field-level entries of the caller's permission set. */
  fields?: FieldEntries;
  /** Field-level entries of a second set, held only by {@link TWO_SETS}. */
  secondFields?: FieldEntries;
  /** Capabilities the caller's permission set grants. */
  capabilities?: string[];
  /** The object grant's View All (reads every field of the object). */
  viewAllRecords?: boolean;
}

interface Rig { engine: ObjectQL; plugin: SecurityPlugin; sets: Record<string, PermissionSet> }

const teardowns: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const t of teardowns.splice(0)) await t();
});

async function boot(opts: BootOptions = {}): Promise<Rig> {
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
        name: REGION,
        label: 'Region',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          secret_score: { name: 'secret_score', type: 'number' },
          secret_twice: { name: 'secret_twice', ...num('record.secret_score * 2.0') },
        },
      },
      {
        name: OBJ,
        label: 'Account',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          pick: { name: 'pick', type: 'text' },
          open_cases: { name: 'open_cases', type: 'number' },
          capacity: { name: 'capacity', type: 'number' },
          gated: { name: 'gated', type: 'number', requiredPermissions: ['qa_fhf_gate'] },
          phone: { name: 'phone', type: 'text', maskingRule: 'phone', requiredPermissions: ['qa_fhf_unmask'] },
          tier: {
            name: 'tier', type: 'select',
            options: [{ label: 'Gold', value: 'gold' }, { label: 'Silver', value: 'silver' }],
          },
          region: { name: 'region', type: 'lookup', reference: REGION },
          load: { name: 'load', ...num('record.open_cases / record.capacity') },
          load_pct: { name: 'load_pct', ...num('record.load * 100.0') },
          headroom: { name: 'headroom', ...num('record.capacity - 1.0') },
          gated_double: { name: 'gated_double', ...num('record.gated * 2.0') },
          open_cases_stored: { name: 'open_cases_stored', type: 'number', expression: cel('record.open_cases * 1.0') },
          phone_copy: { name: 'phone_copy', type: 'formula', returnType: 'text', expression: cel('record.phone') },
          tier_label: { name: 'tier_label', type: 'formula', returnType: 'text', expression: cel('label(record.tier)') },
          picked: { name: 'picked', ...num('record[record.pick] * 1.0') },
          region_score: { name: 'region_score', ...num('record.region.secret_score * 1.0') },
          region_twice: { name: 'region_twice', ...num('record.region.secret_twice * 1.0') },
          region_name: { name: 'region_name', type: 'formula', returnType: 'text', expression: cel('record.region.name') },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(REGION, [{ id: 'r1', name: 'North', secret_score: 7 }], SYS);
  await engine.insert(OBJ, [
    { id: 'a1', name: 'Acme', pick: 'capacity', open_cases: 6, capacity: 12, gated: 21, phone: '13812345678', tier: 'gold', region: 'r1' },
  ], SYS);

  const grant = {
    allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
    ...(opts.viewAllRecords ? { viewAllRecords: true } : {}),
  };
  const set = PermissionSetSchema.parse({
    name: SET,
    ...(opts.capabilities ? { systemPermissions: opts.capabilities } : {}),
    objects: { [OBJ]: grant, [REGION]: grant },
    ...(opts.fields ? { fields: opts.fields } : {}),
  });
  const second = PermissionSetSchema.parse({
    name: SECOND,
    objects: { [OBJ]: { allowRead: true }, [REGION]: { allowRead: true } },
    ...(opts.secondFields ? { fields: opts.secondFields } : {}),
  });
  const all = [MEMBER_DEFAULT, set, second];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? all.find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
      list: async () => all,
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
  return { engine, plugin, sets: { [SET]: set as PermissionSet, [SECOND]: second as PermissionSet } };
}

const hide = (object: string, ...names: string[]): FieldEntries =>
  Object.fromEntries(names.map((n) => [`${object}.${n}`, { readable: false, editable: false }]));
const HIDE_OPEN_CASES = hide(OBJ, 'open_cases');

const findAll = (engine: ObjectQL, extra: Record<string, unknown> = {}, caller: object = CALLER) =>
  engine.find(OBJ, { ...extra, context: { ...caller } } as never) as Promise<Record<string, unknown>[]>;
const findA1 = (engine: ObjectQL, caller: object = CALLER) =>
  engine.findOne(OBJ, { where: { id: 'a1' }, context: { ...caller } } as never) as Promise<Record<string, unknown> | null>;
const aggregate = (engine: ObjectQL, query: Record<string, unknown>) =>
  (engine as any).aggregate(OBJ, { ...query, context: { ...CALLER } }) as Promise<unknown>;

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
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    const [row] = await findAll(engine);
    const one = await findA1(engine);
    for (const rec of [row, one]) {
      expect(rec).toBeTruthy();
      expect(rec).not.toHaveProperty('open_cases');
      expect(rec).not.toHaveProperty('load');
      expect(rec).toMatchObject({ name: 'Acme', capacity: 12, headroom: 11 });
    }
  });

  it('a projection naming only the formula serves no value for it', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    const rows = await findAll(engine, { fields: ['load'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('load');
  });

  it('the record an insert echoes back carries no formula over the hidden input', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    const echoed = (await engine.insert(OBJ, { id: 'a2', name: 'Beta', capacity: 4 }, { context: { ...CALLER } } as never)) as any;
    const rec = Array.isArray(echoed) ? echoed[0] : echoed;
    expect(rec).toMatchObject({ name: 'Beta', headroom: 3 });
    expect(rec).not.toHaveProperty('load');
    expect(rec).not.toHaveProperty('load_pct');
  });

  it('the record an update echoes back carries no formula over the hidden input', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    const echoed = (await engine.update(OBJ, { name: 'Acme 2' }, { where: { id: 'a1' }, context: { ...CALLER } } as never)) as any;
    const rec = Array.isArray(echoed) ? echoed[0] : echoed;
    expect(rec).toMatchObject({ name: 'Acme 2', headroom: 11 });
    expect(rec).not.toHaveProperty('load');
    expect(rec).not.toHaveProperty('load_pct');
  });
});

describe('a formula over a formula over a hidden field is absent too (transitive)', () => {
  it('find and findOne withhold the second-level formula', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    const [row] = await findAll(engine);
    const one = await findA1(engine);
    for (const rec of [row, one]) expect(rec).not.toHaveProperty('load_pct');
  });
});

describe('a formula over a field whose requiredPermissions the caller fails is absent', () => {
  it('find and findOne withhold the formula beside its capability-gated input', async () => {
    const { engine } = await boot();
    const [row] = await findAll(engine);
    const one = await findA1(engine);
    for (const rec of [row, one]) {
      expect(rec).not.toHaveProperty('gated');
      expect(rec).not.toHaveProperty('gated_double');
    }
  });

  it('a caller holding the capability reads the formula', async () => {
    const { engine } = await boot({ capabilities: ['qa_fhf_gate'] });
    expect(await findA1(engine)).toMatchObject({ gated: 21, gated_double: 42 });
  });
});

describe('a formula over a field named only through a function is absent', () => {
  it('label(record.tier) is withheld beside the hidden tier; a caller who reads tier reads it', async () => {
    const hidden = await boot({ fields: hide(OBJ, 'tier') });
    expect(await findA1(hidden.engine)).not.toHaveProperty('tier_label');
    const open = await boot();
    expect(await findA1(open.engine)).toMatchObject({ tier: 'gold', tier_label: 'Gold' });
  });
});

describe('a formula over a field read through a reference is absent when the caller cannot read that field', () => {
  it('the referenced field is hidden on its own object: the formula over it is absent, a formula over a readable referenced field stays', async () => {
    const { engine } = await boot({ fields: hide(REGION, 'secret_score') });
    for (const rec of [(await findAll(engine))[0], await findA1(engine)]) {
      expect(rec).not.toHaveProperty('region_score');
      expect(rec).toMatchObject({ region_name: 'North' });
    }
  });

  it('a formula over a referenced formula over the hidden referenced field is absent too', async () => {
    const { engine } = await boot({ fields: hide(REGION, 'secret_score') });
    expect(await findA1(engine)).not.toHaveProperty('region_twice');
  });

  it('a caller who reads the referenced field reads both formulas', async () => {
    const { engine } = await boot();
    expect(await findA1(engine)).toMatchObject({ region_score: 7, region_twice: 14, region_name: 'North' });
  });
});

describe('a stored computed field over a hidden field is withheld as the hidden field is', () => {
  it('it is absent from find and findOne', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    for (const rec of [(await findAll(engine))[0], await findA1(engine)]) expect(rec).not.toHaveProperty('open_cases_stored');
  });

  it('filtering, sorting, grouping and aggregating by it are refused as they are by the hidden field', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    expect(await outcome(findAll(engine, { where: { open_cases_stored: { $gt: 5 } }, fields: ['id'] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await outcome(findAll(engine, { orderBy: [{ field: 'open_cases_stored', order: 'asc' }], fields: ['id'] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await outcome(aggregate(engine, { groupBy: ['open_cases_stored'], aggregations: [{ function: 'count', alias: 'n' }] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['open_cases_stored'] });
    expect(await outcome(aggregate(engine, { aggregations: [{ function: 'sum', field: 'open_cases_stored', alias: 's' }] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['open_cases_stored'] });
  });

  it('control: sorting and grouping by a readable field are admitted', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    expect(await outcome(findAll(engine, { orderBy: [{ field: 'capacity', order: 'asc' }], fields: ['id'] })))
      .toEqual({ landed: [{ id: 'a1' }] });
    expect(await outcome(aggregate(engine, { groupBy: ['capacity'], aggregations: [{ function: 'count', alias: 'n' }] })))
      .toMatchObject({ landed: [{ capacity: 12 }] });
  });
});

describe('a formula over a partially masked field is absent, not partially masked', () => {
  it('the input is served masked; the formula over it is absent', async () => {
    const { engine } = await boot();
    const one = await findA1(engine);
    expect(one).toMatchObject({ phone: '138****5678' });
    expect(one).not.toHaveProperty('phone_copy');
  });

  it('a caller holding the unmask capability reads both in full', async () => {
    const { engine } = await boot({ capabilities: ['qa_fhf_unmask'] });
    expect(await findA1(engine)).toMatchObject({ phone: '13812345678', phone_copy: '13812345678' });
  });
});

describe('a computed field whose reads cannot be named is withheld whenever another field is (fail closed)', () => {
  it('end to end: absent for a caller denied any field; served to a caller denied none', async () => {
    const hidden = await boot({ fields: HIDE_OPEN_CASES });
    expect(await findA1(hidden.engine)).not.toHaveProperty('picked');
    const open = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask'] });
    expect(await findA1(open.engine)).toMatchObject({ picked: 12 });
  });
});

describe('the field projections answer as the read mask does', () => {
  it('getReadableFields leaves out every computed field the read mask deletes, and keeps the rest', async () => {
    const { plugin } = await boot({ fields: { ...HIDE_OPEN_CASES, ...hide(REGION, 'secret_score') } });
    const readable = new Set(await plugin.getReadableFields(OBJ, { ...CALLER }));
    for (const f of ['open_cases', 'load', 'load_pct', 'open_cases_stored', 'phone_copy', 'gated_double', 'picked', 'region_score', 'region_twice']) {
      expect(readable.has(f), f).toBe(false);
    }
    for (const f of ['capacity', 'headroom', 'phone', 'region', 'region_name']) expect(readable.has(f), f).toBe(true);
  });

  it('getQueryableFields no longer lists the stored computed field over the hidden field', async () => {
    const { plugin } = await boot({ fields: HIDE_OPEN_CASES });
    const queryable = new Set(await plugin.getQueryableFields(OBJ, { ...CALLER }));
    expect(queryable.has('open_cases_stored')).toBe(false);
    expect(queryable.has('capacity')).toBe(true);
  });

  it('control: a caller who may read every input is projected every computed field', async () => {
    const { plugin } = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask'] });
    const readable = new Set(await plugin.getReadableFields(OBJ, { ...CALLER }));
    const queryable = new Set(await plugin.getQueryableFields(OBJ, { ...CALLER }));
    for (const f of ['load', 'load_pct', 'open_cases_stored', 'phone_copy', 'gated_double', 'picked', 'region_score', 'region_twice']) {
      expect(readable.has(f), f).toBe(true);
    }
    expect(queryable.has('open_cases_stored')).toBe(true);
  });
});

describe('explain reports the computed fields the read mask deletes', () => {
  it('the fls layer names the formula over the hidden field as masked from responses', async () => {
    const { plugin } = await boot({ fields: HIDE_OPEN_CASES });
    const d: any = await plugin.explainAccessForCaller({ object: OBJ, operation: 'read' } as never, { ...CALLER });
    const fls = d.layers.find((l: any) => l.layer === 'fls');
    for (const f of ['open_cases', 'load', 'load_pct', 'open_cases_stored', 'picked']) expect(fls.detail, f).toContain(f);
    expect(fls.detail).not.toContain('headroom');
  });
});

describe('a delegated caller: the delegator\'s hidden field withholds the formula over it', () => {
  it('the result masker withholds the formula when the delegator, not the agent, cannot read its input', async () => {
    const { plugin, sets } = await boot();
    const posture = await (plugin as any).getObjectSecurityMeta(OBJ);
    const delegator = PermissionSetSchema.parse({ name: 'qa_fhf_delegator', objects: { [OBJ]: { allowRead: true } }, fields: HIDE_OPEN_CASES });
    const row = () => ({ id: 'a1', open_cases: 6, capacity: 12, load: 0.5, load_pct: 50, headroom: 11 });
    const masked = { operation: 'findOne', object: OBJ, result: row() };
    (plugin as any).maskOperationResult(masked, [sets[SET]], posture, [delegator]);
    expect(masked.result).not.toHaveProperty('load');
    expect(masked.result).not.toHaveProperty('load_pct');
    expect(masked.result).toMatchObject({ headroom: 11 });
    // Control: a delegator who reads the input leaves the formula served.
    const open = { operation: 'findOne', object: OBJ, result: row() };
    (plugin as any).maskOperationResult(open, [sets[SET]], posture, [sets[SECOND]]);
    expect(open.result).toMatchObject({ load: 0.5, load_pct: 50 });
  });
});

describe('controls: what the rule leaves unchanged', () => {
  it('a caller who may read every input reads every computed field', async () => {
    const { engine } = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask'] });
    expect(await findA1(engine)).toMatchObject({
      open_cases: 6, load: 0.5, load_pct: 50, headroom: 11, gated_double: 42,
      open_cases_stored: 6, phone_copy: '13812345678', tier_label: 'Gold', picked: 12, region_score: 7,
    });
  });

  it('a caller holding two sets, one of which grants the input, reads the formula (union)', async () => {
    const { engine } = await boot({
      fields: HIDE_OPEN_CASES,
      secondFields: { [`${OBJ}.open_cases`]: { readable: true, editable: false } },
    });
    expect(await findA1(engine, TWO_SETS)).toMatchObject({ open_cases: 6, load: 0.5, load_pct: 50, open_cases_stored: 6 });
  });

  it('a system context reads every field and every computed field', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    const one = await engine.findOne(OBJ, { where: { id: 'a1' }, context: { isSystem: true } } as never);
    expect(one).toMatchObject({
      open_cases: 6, gated: 21, phone: '13812345678',
      load: 0.5, load_pct: 50, headroom: 11, gated_double: 42, open_cases_stored: 6, phone_copy: '13812345678',
    });
  });

  it('a View All holder reads the hidden field and the formulas over it', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES, viewAllRecords: true });
    expect(await findA1(engine)).toMatchObject({ open_cases: 6, load: 0.5, load_pct: 50, open_cases_stored: 6 });
  });

  it("the aggregate path's input gate is unchanged: the hidden field is refused, a readable one admitted", async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    expect(await outcome(aggregate(engine, { aggregations: [{ function: 'sum', field: 'open_cases', alias: 's' }] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['open_cases'] });
    expect(await outcome(aggregate(engine, { aggregations: [{ function: 'sum', field: 'capacity', alias: 's' }] })))
      .toEqual({ landed: [{ s: 12 }] });
  });
});

describe('what a computed field reads, as the masker names it', () => {
  const read = (source: string) => readComputedFieldExpression({ type: 'formula', expression: cel(source) });
  const names = (source: string) => [...(read(source)?.reads ?? [])].sort();

  it('names every member read off the record, in every literal spelling, and the reference read through', () => {
    expect(names('record.a / record.b')).toEqual(['a', 'b']);
    expect(names("record['a'] + record.?b.orValue(0)")).toEqual(['a', 'b']);
    expect(names('has(record.a) ? record.b : 0')).toEqual(['a', 'b']);
    expect(names('label(record.tier)')).toEqual(['tier']);
    expect(names('record.owner.name')).toEqual(['owner']);
    expect([...(read('record.owner.name')?.hops.get('owner') ?? [])]).toEqual(['name']);
    expect([...(readComputedFieldExpression({ type: 'formula', expression: 'record.a * 2' })?.reads ?? [])]).toEqual(['a']);
  });

  it('names exactly what the platform member reader names, for every spelling it reads', () => {
    for (const source of [
      'record.a / record.b', "record['a'] + record.?b.orValue(0)", "record[?'a'].orValue(1)",
      'has(record.a) ? record.b : 0', 'label(record.tier)', 'record.owner.name + record.owner.city', 'record.x.size() > 0',
    ]) {
      const platform = analyzeRelationshipTraversals(source)!;
      expect(names(source), source).toEqual([...new Set([...platform.bareFields, ...platform.traversals.keys()])].sort());
      const hops = Object.fromEntries([...(read(source)?.hops ?? [])].map(([k, v]) => [k, [...v].sort()]));
      expect(hops, source).toEqual(Object.fromEntries([...platform.traversals].map(([k, v]) => [k, [...v].sort()])));
    }
  });

  it('cannot name the reads of a computed key, a method on the record, the record passed whole, or another dialect', () => {
    expect(read('record[record.k]')?.reads).toBeNull();
    expect(read('record.size()')?.reads).toBeNull();
    expect(read('size(record)')?.reads).toBeNull();
    expect(read("record.exists(k, k == 'a')")?.reads).toBeNull();
    expect(readComputedFieldExpression({ type: 'formula', expression: { dialect: 'js', source: 'record.a' } })?.reads).toBeNull();
  });

  it('a field that declares no expression is not computed', () => {
    expect(readComputedFieldExpression({ type: 'number' })).toBeUndefined();
    expect(readComputedFieldExpression(undefined)).toBeUndefined();
  });

  it('a computed field whose reads cannot be named is withheld whenever another field is', () => {
    const inputs = { opaque: { reads: null, hops: new Map() }, plain: { reads: new Set(['capacity']), hops: new Map() } };
    expect([...computedFieldsReadingWithheld(inputs, new Set(['open_cases']))]).toEqual(['opaque']);
    expect([...computedFieldsReadingWithheld(inputs, new Set())]).toEqual([]);
  });
});
