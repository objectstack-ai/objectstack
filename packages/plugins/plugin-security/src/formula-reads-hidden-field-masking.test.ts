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
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const OBJ = 'qa_fhf_account';
const REGION = 'qa_fhf_region';
const SET = 'qa_fhf_reader';
const SECOND = 'qa_fhf_second';
const DELEGATOR_SET = 'qa_fhf_delegator';
const DELEGATOR = 'usr_fhf_delegator';
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
  /**
   * Boot the identity objects and a delegator user holding {@link DELEGATOR_SET}
   * with these field entries, so an on-behalf-of read resolves its delegator
   * through the engine as the middleware does.
   */
  delegatorFields?: FieldEntries;
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
      ...(opts.delegatorFields ? [SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet, SysOrganization, SysUser, SysMember] : []),
      {
        name: REGION,
        label: 'Region',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          secret_score: { name: 'secret_score', type: 'number' },
          secret_twice: { name: 'secret_twice', ...num('record.secret_score * 2.0') },
          gated_score: { name: 'gated_score', type: 'number', requiredPermissions: ['qa_fhf_region_gate'] },
          region_phone: { name: 'region_phone', type: 'text', maskingRule: 'phone', requiredPermissions: ['qa_fhf_unmask'] },
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
          region_gated: { name: 'region_gated', ...num('record.region.gated_score * 1.0') },
          region_phone_copy: { name: 'region_phone_copy', type: 'formula', returnType: 'text', expression: cel('record.region.region_phone') },
          region_ghost: { name: 'region_ghost', ...num('record.region.no_such_field * 1.0') },
          region_score_stored: { name: 'region_score_stored', type: 'number', expression: cel('record.region.secret_score * 1.0') },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(REGION, [{ id: 'r1', name: 'North', secret_score: 7, gated_score: 3, region_phone: '13900001111' }], SYS);
  if (opts.delegatorFields) {
    await engine.insert('sys_user', { id: DELEGATOR, name: DELEGATOR, email: `${DELEGATOR}@example.test` }, SYS);
    await engine.insert('sys_member', { id: `mem_${DELEGATOR}`, user_id: DELEGATOR, organization_id: DEFAULT_ORGANIZATION_ID, role: 'member' }, SYS);
    await engine.insert('sys_user_permission_set', {
      id: `ups_${DELEGATOR}`, user_id: DELEGATOR, permission_set: DELEGATOR_SET, organization_id: DEFAULT_ORGANIZATION_ID,
    }, SYS);
  }
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
  const delegatorSet = PermissionSetSchema.parse({
    name: DELEGATOR_SET,
    objects: { [OBJ]: { allowRead: true }, [REGION]: { allowRead: true } },
    ...(opts.delegatorFields ? { fields: opts.delegatorFields } : {}),
  });
  const all = [MEMBER_DEFAULT, set, second, delegatorSet];
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

describe('a formula reading through a reference: every kind of field the caller is not served whole there', () => {
  it('a field whose requiredPermissions the caller fails on the referenced object: absent; control with the capability', async () => {
    const gated = await boot();
    expect(await findA1(gated.engine)).not.toHaveProperty('region_gated');
    const open = await boot({ capabilities: ['qa_fhf_region_gate'] });
    expect(await findA1(open.engine)).toMatchObject({ region_gated: 3 });
  });

  it('a field served masked on the referenced object: absent, not computed over the mask; control with the unmask capability', async () => {
    const masked = await boot();
    expect(await findA1(masked.engine)).not.toHaveProperty('region_phone_copy');
    const open = await boot({ capabilities: ['qa_fhf_unmask'] });
    expect(await findA1(open.engine)).toMatchObject({ region_phone_copy: '13900001111' });
  });

  it('the insert and update echoes carry no formula reading a hidden field through the reference; a readable one stays', async () => {
    const { engine } = await boot({ fields: hide(REGION, 'secret_score') });
    const inserted = (await engine.insert(OBJ, { id: 'a3', name: 'Gamma', capacity: 2, region: 'r1' }, { context: { ...CALLER } } as never)) as any;
    const updated = (await engine.update(OBJ, { name: 'Acme 3' }, { where: { id: 'a1' }, context: { ...CALLER } } as never)) as any;
    for (const echoed of [inserted, updated]) {
      const rec = Array.isArray(echoed) ? echoed[0] : echoed;
      expect(rec).toMatchObject({ region_name: 'North' });
      expect(rec).not.toHaveProperty('region_score');
      expect(rec).not.toHaveProperty('region_score_stored');
    }
  });

  it('a field the referenced object does not declare is no field to withhold: the formula reads null, for every caller', async () => {
    const restricted = await boot({ fields: hide(REGION, 'secret_score') });
    const one = await findA1(restricted.engine);
    expect(one).toHaveProperty('region_ghost', null);
    // ...beside a DECLARED field the caller may not read there, which is withheld.
    expect(one).not.toHaveProperty('region_score');
    const open = await boot();
    expect(await findA1(open.engine)).toHaveProperty('region_ghost', null);
  });

  it('a stored computed field reading through the reference: absent, refused as a filter, not queryable; control for a caller who reads the referenced field', async () => {
    const { engine, plugin } = await boot({ fields: hide(REGION, 'secret_score') });
    expect(await findA1(engine)).not.toHaveProperty('region_score_stored');
    expect(await outcome(findAll(engine, { where: { region_score_stored: { $gt: 5 } }, fields: ['id'] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await outcome(findAll(engine, { orderBy: [{ field: 'region_score_stored', order: 'asc' }], fields: ['id'] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await outcome(aggregate(engine, { groupBy: ['region_score_stored'], aggregations: [{ function: 'count', alias: 'n' }] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['region_score_stored'] });
    expect(await outcome(aggregate(engine, { aggregations: [{ function: 'sum', field: 'region_score_stored', alias: 's' }] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['region_score_stored'] });
    expect(new Set(await plugin.getQueryableFields(OBJ, { ...CALLER })).has('region_score_stored')).toBe(false);
    const open = await boot();
    expect(await findA1(open.engine)).toMatchObject({ region_score_stored: 7 });
    expect(new Set(await open.plugin.getQueryableFields(OBJ, { ...CALLER })).has('region_score_stored')).toBe(true);
  });

  it('explain names the formula reading through the reference as masked from responses', async () => {
    const { plugin } = await boot({ fields: hide(REGION, 'secret_score') });
    const d: any = await plugin.explainAccessForCaller({ object: OBJ, operation: 'read' } as never, { ...CALLER });
    const fls = d.layers.find((l: any) => l.layer === 'fls');
    for (const f of ['region_score', 'region_twice', 'region_score_stored']) expect(fls.detail, f).toContain(f);
    expect(fls.detail).not.toContain('region_name');
  });
});

describe('the public-form echo withholds every computed field that reads through a reference, for every submitter', () => {
  const GRANT = { publicFormGrant: { object: OBJ }, permissions: [SET], anonymous: true };

  it('the submitter\'s echo carries no formula reading through a reference, readable there or not; a formula over its own record stays', async () => {
    const { engine } = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask', 'qa_fhf_region_gate'] });
    const echoed = (await engine.insert(OBJ, { id: 'a9', name: 'Form', capacity: 5, region: 'r1' }, { context: { ...GRANT } } as never)) as any;
    const rec = Array.isArray(echoed) ? echoed[0] : echoed;
    expect(rec).toMatchObject({ name: 'Form', headroom: 4 });
    for (const f of ['region_name', 'region_score', 'region_twice', 'region_gated', 'region_phone_copy', 'region_ghost', 'region_score_stored']) {
      expect(rec, f).not.toHaveProperty(f);
    }
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
    const open = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask', 'qa_fhf_region_gate'] });
    expect(await findA1(open.engine)).toMatchObject({ picked: 12 });
  });
});

describe('the field projections answer as the read mask does', () => {
  it('getReadableFields leaves out every computed field the read mask deletes, and keeps the rest', async () => {
    const { plugin } = await boot({ fields: { ...HIDE_OPEN_CASES, ...hide(REGION, 'secret_score') } });
    const readable = new Set(await plugin.getReadableFields(OBJ, { ...CALLER }));
    for (const f of [
      'open_cases', 'load', 'load_pct', 'open_cases_stored', 'phone_copy', 'gated_double', 'picked',
      'region_score', 'region_twice', 'region_gated', 'region_phone_copy', 'region_score_stored',
    ]) {
      expect(readable.has(f), f).toBe(false);
    }
    for (const f of ['capacity', 'headroom', 'phone', 'region', 'region_name', 'region_ghost']) expect(readable.has(f), f).toBe(true);
  });

  it('getQueryableFields no longer lists the stored computed field over the hidden field', async () => {
    const { plugin } = await boot({ fields: HIDE_OPEN_CASES });
    const queryable = new Set(await plugin.getQueryableFields(OBJ, { ...CALLER }));
    expect(queryable.has('open_cases_stored')).toBe(false);
    expect(queryable.has('capacity')).toBe(true);
  });

  it('control: a caller who may read every input is projected every computed field', async () => {
    const { plugin } = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask', 'qa_fhf_region_gate'] });
    const readable = new Set(await plugin.getReadableFields(OBJ, { ...CALLER }));
    const queryable = new Set(await plugin.getQueryableFields(OBJ, { ...CALLER }));
    for (const f of [
      'load', 'load_pct', 'open_cases_stored', 'phone_copy', 'gated_double', 'picked',
      'region_score', 'region_twice', 'region_gated', 'region_phone_copy', 'region_score_stored',
    ]) {
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

describe('a delegated read through the engine: the delegator\'s hidden field withholds the formula over it', () => {
  const DELEGATED = { ...CALLER, tenantId: DEFAULT_ORGANIZATION_ID, onBehalfOf: { userId: DELEGATOR } };

  it('the agent reads every input, the delegator cannot read open_cases: the formulas over it are absent', async () => {
    const { engine } = await boot({ delegatorFields: HIDE_OPEN_CASES });
    const one = await findA1(engine, DELEGATED);
    expect(one).toMatchObject({ capacity: 12, headroom: 11 });
    expect(one).not.toHaveProperty('open_cases');
    expect(one).not.toHaveProperty('load');
    expect(one).not.toHaveProperty('load_pct');
  });

  it('the delegator cannot read the referenced field: the formula reading through the reference is absent', async () => {
    const { engine } = await boot({ delegatorFields: hide(REGION, 'secret_score') });
    const one = await findA1(engine, DELEGATED);
    expect(one).not.toHaveProperty('region_score');
    expect(one).toMatchObject({ region_name: 'North' });
  });

  it('control: a delegator who reads every input leaves every formula served', async () => {
    const { engine } = await boot({ delegatorFields: {} });
    expect(await findA1(engine, DELEGATED)).toMatchObject({ open_cases: 6, load: 0.5, load_pct: 50, region_score: 7 });
  });
});

describe('controls: what the rule leaves unchanged', () => {
  it('a caller who may read every input reads every computed field', async () => {
    const { engine } = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask', 'qa_fhf_region_gate'] });
    expect(await findA1(engine)).toMatchObject({
      open_cases: 6, load: 0.5, load_pct: 50, headroom: 11, gated_double: 42,
      open_cases_stored: 6, phone_copy: '13812345678', tier_label: 'Gold', picked: 12, region_score: 7,
      region_twice: 14, region_gated: 3, region_phone_copy: '13900001111', region_score_stored: 7,
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
