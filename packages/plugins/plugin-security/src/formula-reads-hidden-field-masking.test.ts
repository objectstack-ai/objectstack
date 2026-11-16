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
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const OBJ = 'qa_fhf_account';
const REGION = 'qa_fhf_region';
const NOTE = 'qa_fhf_note';
const SOURCE = 'qa_fhf_source';
const RELAY = 'qa_fhf_relay';
const VAULT = 'qa_fhf_vault';
const LOOP = 'qa_fhf_loop';
const CYCLE = 'qa_fhf_cycle';
const OPAQUE = 'qa_fhf_opaque';
const SET = 'qa_fhf_reader';
const SECOND = 'qa_fhf_second';
const DELEGATOR_SET = 'qa_fhf_delegator';
const DELEGATOR = 'usr_fhf_delegator';
const CALLER = { userId: 'usr_fhf', positions: ['qa_fhf_pos'], permissions: [SET], posture: 'MEMBER' };
const TWO_SETS = { ...CALLER, permissions: [SET, SECOND] };

const cel = (source: string) => ({ dialect: 'cel', source });
const num = (source: string) => ({ type: 'formula', returnType: 'number', expression: cel(source) });

type FieldEntries = Record<string, { readable: boolean; editable: boolean }>;

/** The shapes of expression whose reads cannot be named, each gating a read through the reference. */
const UNNAMED_SHAPES: Record<string, string> = {
  computed_key: "string(record[record.pick]) != ''",
  method: 'record.size() > 0',
  macro: "record.exists(k, k == 'pick')",
  whole: 'size(record) > 0',
};
/** The literal spellings of one read through the reference. */
const SPELLINGS: Record<string, string> = {
  dot: 'record.region.secret_score',
  index_leaf: "record.region['secret_score']",
  index_ref: "record['region'].secret_score",
  index_both: "record['region']['secret_score']",
};
const unnamedThroughReference = () => Object.fromEntries(Object.entries(UNNAMED_SHAPES).flatMap(([shape, test]) => {
  const source = `${test} ? record.region.secret_score * 1.0 : 0.0`;
  return [
    [`opaque_${shape}`, { name: `opaque_${shape}`, ...num(source) }],
    [`opaque_${shape}_stored`, { name: `opaque_${shape}_stored`, type: 'number', expression: cel(source) }],
  ];
}));
const spelledThroughReference = () => Object.fromEntries(Object.entries(SPELLINGS).flatMap(([spelling, read]) => [
  [`spelled_${spelling}`, { name: `spelled_${spelling}`, ...num(`${read} * 1.0`) }],
  [`spelled_${spelling}_stored`, { name: `spelled_${spelling}_stored`, type: 'number', expression: cel(`${read} * 1.0`) }],
]));
const OPAQUE_FIELDS = Object.keys(UNNAMED_SHAPES).flatMap((s) => [`opaque_${s}`, `opaque_${s}_stored`]);
const SPELLED_FIELDS = Object.keys(SPELLINGS).flatMap((s) => [`spelled_${s}`, `spelled_${s}_stored`]);

interface BootOptions {
  /** Field-level entries of the caller's permission set. */
  fields?: FieldEntries;
  /** Field-level entries of a second set, held only by {@link TWO_SETS}. */
  secondFields?: FieldEntries;
  /** Capabilities the caller's permission set grants. */
  capabilities?: string[];
  /**
   * The object grant's View All. It reads every field of the object the set's
   * own rows do not declare `readable: false` (ADR-0066 D2 ⑧).
   */
  viewAllRecords?: boolean;
  /** View All on the object in the second set, held only by {@link TWO_SETS}. */
  secondViewAll?: boolean;
  /**
   * Boot the identity objects and a delegator user holding {@link DELEGATOR_SET}
   * with these field entries, so an on-behalf-of read resolves its delegator
   * through the engine as the middleware does.
   */
  delegatorFields?: FieldEntries;
  /** `false`: the caller's set grants no read on the referenced object at all. */
  regionRead?: boolean;
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
        name: SOURCE,
        label: 'Source',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          secret: { name: 'secret', type: 'number' },
        },
      },
      {
        name: RELAY,
        label: 'Relay',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          source: { name: 'source', type: 'lookup', reference: SOURCE },
          // A stored field over a field of the record ITS reference points at.
          t: { name: 't', type: 'number', expression: cel('record.source.secret * 1.0') },
          cycle: { name: 'cycle', type: 'lookup', reference: CYCLE },
          // Over a field of the record that points BACK here: the chain returns to the relay.
          w: { name: 'w', type: 'number', expression: cel('record.cycle.u * 1.0') },
        },
      },
      {
        // Every other field served whole, so only what the shapes read through the reference can withhold them.
        name: OPAQUE,
        label: 'Opaque',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          pick: { name: 'pick', type: 'text' },
          region: { name: 'region', type: 'lookup', reference: REGION },
          // Each shape whose reads cannot be named, reading through the reference too.
          ...unnamedThroughReference(),
        },
      },
      {
        name: CYCLE,
        label: 'Cycle',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          relay: { name: 'relay', type: 'lookup', reference: RELAY },
          u: { name: 'u', type: 'number', expression: cel('record.relay.t * 1.0') },
        },
      },
      {
        name: LOOP,
        label: 'Loop',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          // A reference BACK to the account: a chain from the account returns to it.
          back: { name: 'back', type: 'lookup', reference: OBJ },
          // Over an account field withheld only for what IT reads through a reference.
          u: { name: 'u', type: 'number', expression: cel('record.back.region_score_stored * 1.0') },
          // Over an account field withheld for a reason on its own record.
          v: { name: 'v', type: 'number', expression: cel('record.back.open_cases * 1.0') },
        },
      },
      {
        name: VAULT,
        label: 'Vault',
        sharingModel: 'public_read_write',
        nameField: 'title',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          secret: { name: 'secret', type: 'text' },
          title: { name: 'title', type: 'formula', returnType: 'text', expression: cel("record.secret + ' vault'") },
        },
      },
      {
        name: NOTE,
        label: 'Note',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          plain: { name: 'plain', type: 'text' },
          // A masking rule with no unmask gate: served masked to every non-system caller.
          code: { name: 'code', type: 'text', maskingRule: { keepHead: 1, keepTail: 1 } },
          code_copy: { name: 'code_copy', type: 'formula', returnType: 'text', expression: cel('record.code') },
          code_stored: { name: 'code_stored', type: 'text', expression: cel('record.code') },
          // A stored field served masked itself (no gate), over a field every caller reads.
          plain_masked: { name: 'plain_masked', type: 'text', expression: cel('record.plain'), maskingRule: { keepHead: 1, keepTail: 1 } },
          plain_copy: { name: 'plain_copy', type: 'formula', returnType: 'text', expression: cel('record.plain') },
        },
      },
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
          capacity: { name: 'capacity', type: 'number', label: 'Capacity' },
          gated: { name: 'gated', type: 'number', requiredPermissions: ['qa_fhf_gate'] },
          phone: { name: 'phone', type: 'text', maskingRule: 'phone', requiredPermissions: ['qa_fhf_unmask'] },
          tier: {
            name: 'tier', type: 'select',
            options: [{ label: 'Gold', value: 'gold' }, { label: 'Silver', value: 'silver' }],
          },
          region: { name: 'region', type: 'lookup', reference: REGION },
          relay: { name: 'relay', type: 'lookup', reference: RELAY },
          loop: { name: 'loop', type: 'lookup', reference: LOOP },
          loop_u: { name: 'loop_u', type: 'number', expression: cel('record.loop.u * 1.0') },
          loop_v: { name: 'loop_v', type: 'number', expression: cel('record.loop.v * 1.0') },
          vault_ref: { name: 'vault_ref', type: 'lookup', reference: VAULT, referenceNameVisible: true },
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
          region_score_stored: { name: 'region_score_stored', label: 'Region Score', type: 'number', expression: cel('record.region.secret_score * 1.0') },
          // The literal spellings of a read through the reference.
          ...spelledThroughReference(),
          // Through a reference to a stored field that reads through a reference of its own.
          relay_stored: { name: 'relay_stored', type: 'number', expression: cel('record.relay.t * 1.0') },
          relay_formula: { name: 'relay_formula', ...num('record.relay.t * 1.0') },
          // Through a chain that returns to an object other than this one (relay, cycle, relay).
          relay_w: { name: 'relay_w', type: 'number', expression: cel('record.relay.w * 1.0') },
          // A stored copy of a field served masked on the referenced object.
          region_phone_stored: { name: 'region_phone_stored', type: 'text', expression: cel('record.region.region_phone') },
          // Stored computed fields over each same-record kind.
          gated_stored: { name: 'gated_stored', type: 'number', expression: cel('record.gated * 2.0') },
          phone_stored: { name: 'phone_stored', type: 'text', expression: cel('record.phone') },
          tier_label_stored: { name: 'tier_label_stored', type: 'text', expression: cel('label(record.tier)') },
          picked_stored: { name: 'picked_stored', type: 'number', expression: cel('record[record.pick] * 1.0') },
          load_stored: { name: 'load_stored', type: 'number', expression: cel('record.open_cases_stored * 1.0') },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(NOTE, [{ id: 'n1', plain: 'open', code: 'ABCDEFG' }], SYS);
  await engine.insert(SOURCE, [{ id: 's1', secret: 5 }], SYS);
  await engine.insert(RELAY, [{ id: 'rl1', source: 's1' }], SYS);
  await engine.insert(CYCLE, [{ id: 'cy1', relay: 'rl1' }], SYS);
  await engine.update(RELAY, { cycle: 'cy1' }, { where: { id: 'rl1' }, context: { isSystem: true } } as never);
  await engine.insert(VAULT, [{ id: 'v1', secret: 'S' }], SYS);
  await engine.insert(REGION, [{ id: 'r1', name: 'North', secret_score: 7, gated_score: 3, region_phone: '13900001111' }], SYS);
  await engine.insert(OPAQUE, [{ id: 'o1', pick: 'id', region: 'r1' }], SYS);
  if (opts.delegatorFields) {
    await engine.insert('sys_user', { id: DELEGATOR, name: DELEGATOR, email: `${DELEGATOR}@example.test` }, SYS);
    await engine.insert('sys_member', { id: `mem_${DELEGATOR}`, user_id: DELEGATOR, organization_id: DEFAULT_ORGANIZATION_ID, role: 'member' }, SYS);
    await engine.insert('sys_user_permission_set', {
      id: `ups_${DELEGATOR}`, user_id: DELEGATOR, permission_set: DELEGATOR_SET, organization_id: DEFAULT_ORGANIZATION_ID,
    }, SYS);
  }
  await engine.insert(OBJ, [
    {
      id: 'a1', name: 'Acme', pick: 'capacity', open_cases: 6, capacity: 12, gated: 21, phone: '13812345678', tier: 'gold',
      region: 'r1', relay: 'rl1', vault_ref: 'v1',
    },
  ], SYS);
  await engine.insert(LOOP, [{ id: 'l1', back: 'a1' }], SYS);
  await engine.update(OBJ, { loop: 'l1' }, { where: { id: 'a1' }, context: { isSystem: true } } as never);

  const grant = {
    allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
    ...(opts.viewAllRecords ? { viewAllRecords: true } : {}),
  };
  const set = PermissionSetSchema.parse({
    name: SET,
    ...(opts.capabilities ? { systemPermissions: opts.capabilities } : {}),
    // No grant on VAULT: its records are read only by name, through `referenceNameVisible`.
    objects: { [OBJ]: grant, ...(opts.regionRead === false ? {} : { [REGION]: grant }), [NOTE]: grant, [SOURCE]: grant, [RELAY]: grant, [CYCLE]: grant, [OPAQUE]: grant, [LOOP]: grant },
    ...(opts.fields ? { fields: opts.fields } : {}),
  });
  const second = PermissionSetSchema.parse({
    name: SECOND,
    objects: { [OBJ]: { allowRead: true, ...(opts.secondViewAll ? { viewAllRecords: true } : {}) }, [REGION]: { allowRead: true } },
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
    registerService: vi.fn((name: string, svc: unknown) => { if (name === 'security') security = svc; }),
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  let security: unknown;
  wireEngineSecuritySource(engine, () => security);
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
async function outcome(p: Promise<unknown>): Promise<{ landed: unknown } | { code?: string; status?: number; forbiddenFields?: unknown; userMessage?: string }> {
  try {
    return { landed: await p };
  } catch (e: any) {
    return { code: e?.code, status: e?.statusCode ?? e?.status, forbiddenFields: e?.details?.forbiddenFields, userMessage: e?.userMessage };
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
  // The grant admits the form object's create alone, so a submission cannot
  // name a record the submitter cannot read: the reference stays empty, and
  // the engine computes a formula reading through it as `null`.
  const GRANT = { publicFormGrant: { object: OBJ }, permissions: [SET], anonymous: true };
  const THROUGH_A_REFERENCE = ['region_name', 'region_score', 'region_twice', 'region_gated', 'region_phone_copy', 'region_ghost'];

  it('the submitter\'s echo carries no key for a formula reading through a reference; a formula over its own record stays', async () => {
    const { engine } = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask', 'qa_fhf_region_gate'] });
    const echoed = (await engine.insert(OBJ, { id: 'a9', name: 'Form', capacity: 5 }, { context: { ...GRANT } } as never)) as any;
    const rec = Array.isArray(echoed) ? echoed[0] : echoed;
    expect(rec).toMatchObject({ name: 'Form', headroom: 4 });
    for (const f of THROUGH_A_REFERENCE) expect(rec, f).not.toHaveProperty(f);
  });

  it('control: a signed-in caller\'s echo of the same insert carries each of them, as null', async () => {
    const { engine } = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask', 'qa_fhf_region_gate'] });
    const echoed = (await engine.insert(OBJ, { id: 'a9', name: 'Form', capacity: 5 }, { context: { ...CALLER } } as never)) as any;
    const rec = Array.isArray(echoed) ? echoed[0] : echoed;
    for (const f of THROUGH_A_REFERENCE) expect(rec, f).toHaveProperty(f, null);
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

describe('a formula over a field served masked to every caller (a masking rule with no unmask gate) is absent', () => {
  it('find: the input is served masked, the formula over it is absent, a formula over a plain field stays; the projection leaves it out', async () => {
    const { engine, plugin } = await boot();
    const note = await engine.findOne(NOTE, { where: { id: 'n1' }, context: { ...CALLER } } as never) as Record<string, unknown>;
    expect(note).toMatchObject({ code: 'A*****G', plain_copy: 'open' });
    expect(note).not.toHaveProperty('code_copy');
    const readable = new Set(await plugin.getReadableFields(NOTE, { ...CALLER }));
    expect(readable.has('code_copy')).toBe(false);
    expect(readable.has('plain_copy')).toBe(true);
  });

  it('control: a system context reads the input and the formula in full', async () => {
    const { engine } = await boot();
    expect(await engine.findOne(NOTE, { where: { id: 'n1' }, context: { isSystem: true } } as never))
      .toMatchObject({ code: 'ABCDEFG', code_copy: 'ABCDEFG' });
  });
});

describe('a STORED computed field over each kind of same-record input is withheld as a formula is', () => {
  const STORED = ['gated_stored', 'phone_stored', 'tier_label_stored', 'picked_stored', 'load_stored'];

  it('absent from find, not queryable, and refused as a filter, for a caller not served the input whole', async () => {
    const { engine, plugin } = await boot({ fields: { ...HIDE_OPEN_CASES, ...hide(OBJ, 'tier') } });
    const one = await findA1(engine);
    for (const f of STORED) expect(one, f).not.toHaveProperty(f);
    const queryable = new Set(await plugin.getQueryableFields(OBJ, { ...CALLER }));
    for (const f of STORED) expect(queryable.has(f), f).toBe(false);
    // The stored copy of a field served masked is a full value: refused as a predicate.
    expect(await outcome(findAll(engine, { where: { phone_stored: { $eq: '13812345678' } }, fields: ['id'] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('control: a caller served every input whole reads and queries each of them', async () => {
    const { engine, plugin } = await boot({ capabilities: ['qa_fhf_gate', 'qa_fhf_unmask', 'qa_fhf_region_gate'] });
    expect(await findA1(engine)).toMatchObject({
      gated_stored: 42, phone_stored: '13812345678', tier_label_stored: 'Gold', picked_stored: 12, load_stored: 6,
    });
    const queryable = new Set(await plugin.getQueryableFields(OBJ, { ...CALLER }));
    for (const f of STORED) expect(queryable.has(f), f).toBe(true);
  });

  it('a stored copy of a field masked for every caller: absent; control a system context reads it', async () => {
    const { engine } = await boot();
    expect(await engine.findOne(NOTE, { where: { id: 'n1' }, context: { ...CALLER } } as never)).not.toHaveProperty('code_stored');
    expect(await engine.findOne(NOTE, { where: { id: 'n1' }, context: { isSystem: true } } as never)).toMatchObject({ code_stored: 'ABCDEFG' });
  });
});

describe('a computed field reading through a reference to an object the caller may not read at all is withheld', () => {
  it('formula and stored alike: absent from find and the read projection; control a caller who reads the object', async () => {
    const { engine, plugin } = await boot({ regionRead: false });
    const one = await findA1(engine);
    // Every computed field reading through the reference, a field the object does not declare included.
    for (const f of ['region_name', 'region_score', 'region_score_stored', 'region_ghost']) expect(one, f).not.toHaveProperty(f);
    const readable = new Set(await plugin.getReadableFields(OBJ, { ...CALLER }));
    for (const f of ['region_name', 'region_score', 'region_score_stored']) expect(readable.has(f), f).toBe(false);
    const open = await boot();
    expect(await findA1(open.engine)).toMatchObject({ region_name: 'North', region_score: 7, region_score_stored: 7 });
  });
});

describe('the projections that answer about a field without reading it leave a withheld computed field out', () => {
  const WITHHELD = ['load', 'load_pct', 'open_cases_stored', 'region_score', 'region_score_stored'];
  const WHO = { fields: { ...HIDE_OPEN_CASES, ...hide(REGION, 'secret_score') } };

  it('getMetadataReadableFields, getWritableFields and getRecordFieldAccess (read and edit halves)', async () => {
    const { plugin } = await boot(WHO);
    const metadata = new Set(await plugin.getMetadataReadableFields(OBJ, { ...CALLER }));
    const writable = new Set(await plugin.getWritableFields(OBJ, { ...CALLER }));
    const access: any = await plugin.getRecordFieldAccess(OBJ, 'a1', { ...CALLER });
    for (const f of WITHHELD) {
      expect(metadata.has(f), `metadata ${f}`).toBe(false);
      expect(writable.has(f), `writable ${f}`).toBe(false);
      expect(access.readable, `record readable ${f}`).not.toContain(f);
      expect(access.editable, `record editable ${f}`).not.toContain(f);
    }
    expect(metadata.has('headroom')).toBe(true);
    expect(access.readable).toContain('headroom');
  });

  it('control: a caller served every input whole is answered each of them', async () => {
    const { plugin } = await boot();
    const metadata = new Set(await plugin.getMetadataReadableFields(OBJ, { ...CALLER }));
    const writable = new Set(await plugin.getWritableFields(OBJ, { ...CALLER }));
    const access: any = await plugin.getRecordFieldAccess(OBJ, 'a1', { ...CALLER });
    for (const f of WITHHELD) {
      expect(metadata.has(f), `metadata ${f}`).toBe(true);
      expect(writable.has(f), `writable ${f}`).toBe(true);
      expect(access.readable, `record readable ${f}`).toContain(f);
    }
  });
});

describe('through a reference to a stored field that reads through a reference of its own (a chain of two)', () => {
  it('the hidden field two references away withholds the stored and the formula copy; control a caller who reads it', async () => {
    const { engine, plugin } = await boot({ fields: hide(SOURCE, 'secret') });
    const one = await findA1(engine);
    expect(one).not.toHaveProperty('relay_stored');
    expect(one).not.toHaveProperty('relay_formula');
    expect(new Set(await plugin.getQueryableFields(OBJ, { ...CALLER })).has('relay_stored')).toBe(false);
    expect(await outcome(findAll(engine, { where: { relay_stored: { $eq: 5 } }, fields: ['id'] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    const open = await boot();
    expect(await findA1(open.engine)).toMatchObject({ relay_stored: 5, relay_formula: 5 });
  });
});

describe('a stored copy of a field served masked on the referenced object is withheld', () => {
  it('absent and not queryable without the unmask capability; control with it, the full value', async () => {
    const { engine, plugin } = await boot();
    expect(await findA1(engine)).not.toHaveProperty('region_phone_stored');
    expect(new Set(await plugin.getQueryableFields(OBJ, { ...CALLER })).has('region_phone_stored')).toBe(false);
    const open = await boot({ capabilities: ['qa_fhf_unmask'] });
    expect(await findA1(open.engine)).toMatchObject({ region_phone_stored: '13900001111' });
  });
});

describe('the reference name door serves no title computed from a field the reader cannot read', () => {
  const expandVault = (engine: ObjectQL) =>
    engine.findOne(OBJ, { where: { id: 'a1' }, expand: { vault_ref: { object: VAULT } }, context: { ...CALLER } } as never) as Promise<any>;

  it('a refused target whose title is a formula over a hidden field is served by id with the floor name', async () => {
    const { engine } = await boot({ fields: hide(VAULT, 'secret') });
    const served = (await expandVault(engine)).vault_ref;
    expect(served).toEqual({ id: 'v1', name: 'Record #v1', readRefused: true });
  });

  it('control: a reader who may read that field is served the title', async () => {
    const { engine } = await boot();
    expect((await expandVault(engine)).vault_ref).toMatchObject({ id: 'v1', name: 'S vault', readRefused: true });
  });
});

describe('a payload naming a computed field the caller is not served whole is refused, whatever its value', () => {
  it('update and insert: 403 naming the field, for a matching and a differing value alike', async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES });
    for (const value of [6, 7]) {
      expect(await outcome(engine.update(OBJ, { open_cases_stored: value }, { where: { id: 'a1' }, context: { ...CALLER } } as never)))
        .toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['open_cases_stored'] });
    }
    expect(await outcome(engine.update(OBJ, { load: 0.5 }, { where: { id: 'a1' }, context: { ...CALLER } } as never)))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['load'] });
    expect(await outcome(engine.insert(OBJ, { id: 'a4', name: 'D', open_cases_stored: 1 }, { context: { ...CALLER } } as never)))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['open_cases_stored'] });
  });

  it('control: a caller served the input whole may name it; the engine recomputes the stored value', async () => {
    const { engine } = await boot();
    const landed = await outcome(engine.update(OBJ, { open_cases_stored: 99 }, { where: { id: 'a1' }, context: { ...CALLER } } as never));
    expect(landed).toHaveProperty('landed');
    const stored = await engine.findOne(OBJ, { where: { id: 'a1' }, context: { isSystem: true } } as never) as any;
    expect(stored.open_cases_stored).toBe(6);
  });
});

describe('a chain of references that returns to an object withholds as any chain does, however it returns', () => {
  it('back to the record read: a field withheld there for what it reads through a reference withholds the chain, as one withheld on its own record does', async () => {
    const { engine, plugin } = await boot({ fields: { ...HIDE_OPEN_CASES, ...hide(REGION, 'secret_score') } });
    const one = await findA1(engine);
    expect(one).not.toHaveProperty('loop_v');
    expect(one).not.toHaveProperty('loop_u');
    expect(new Set(await plugin.getQueryableFields(OBJ, { ...CALLER })).has('loop_u')).toBe(false);
  });

  it('back to an object along the chain: the field withheld there withholds the chain', async () => {
    const { engine, plugin } = await boot({ fields: hide(SOURCE, 'secret') });
    expect(await findA1(engine)).not.toHaveProperty('relay_w');
    expect(new Set(await plugin.getQueryableFields(OBJ, { ...CALLER })).has('relay_w')).toBe(false);
    expect(await outcome(findAll(engine, { where: { relay_w: { $eq: 5 } }, fields: ['id'] })))
      .toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('control: a caller served every input whole reads each of them', async () => {
    const { engine, plugin } = await boot();
    expect(await findA1(engine)).toMatchObject({ loop_u: 7, loop_v: 6, relay_w: 5 });
    const queryable = new Set(await plugin.getQueryableFields(OBJ, { ...CALLER }));
    for (const f of ['loop_u', 'relay_w']) expect(queryable.has(f), f).toBe(true);
  });
});

describe('every shape of expression reads through a reference as a named read does', () => {
  const findO1 = (engine: ObjectQL) =>
    engine.findOne(OPAQUE, { where: { id: 'o1' }, context: { ...CALLER } } as never) as Promise<Record<string, unknown> | null>;

  it('a shape whose reads cannot be named, formula and stored alike: absent and not queryable for a caller not served the referenced field', async () => {
    const { engine, plugin } = await boot({ fields: hide(REGION, 'secret_score') });
    const one = await findO1(engine);
    expect(one).toMatchObject({ id: 'o1', pick: 'id', region: 'r1' });
    const queryable = new Set(await plugin.getQueryableFields(OPAQUE, { ...CALLER }));
    for (const f of OPAQUE_FIELDS) {
      expect(one, f).not.toHaveProperty(f);
      expect(queryable.has(f), f).toBe(false);
    }
  });

  it('every literal spelling of the read, formula and stored alike: absent for a caller not served the referenced field', async () => {
    const { engine } = await boot({ fields: hide(REGION, 'secret_score') });
    const one = await findA1(engine);
    for (const f of SPELLED_FIELDS) expect(one, f).not.toHaveProperty(f);
  });

  it('control: a caller served the referenced field whole reads each of them', async () => {
    const { engine } = await boot();
    const opaque = await findO1(engine);
    for (const f of OPAQUE_FIELDS) expect(opaque, f).toHaveProperty(f, 7);
    const one = await findA1(engine);
    for (const f of SPELLED_FIELDS) expect(one, f).toHaveProperty(f, 7);
  });
});

describe('the sentence a write refusal shows names no field the caller is not served whole', () => {
  it('a computed field withheld for what it reads through a reference is not named, even by label', async () => {
    const { engine } = await boot({ fields: hide(REGION, 'secret_score') });
    const refused: any = await outcome(engine.update(OBJ, { region_score_stored: 1 }, { where: { id: 'a1' }, context: { ...CALLER } } as never));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['region_score_stored'] });
    expect(typeof refused.userMessage).toBe('string');
    expect(refused.userMessage).not.toContain('Region Score');
  });

  it('control: a field the caller reads but may not edit is named by its label', async () => {
    const { engine } = await boot({ fields: { [`${OBJ}.capacity`]: { readable: true, editable: false } } });
    const refused: any = await outcome(engine.update(OBJ, { capacity: 1 }, { where: { id: 'a1' }, context: { ...CALLER } } as never));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: ['capacity'] });
    expect(refused.userMessage).toContain('Capacity');
  });
});

describe('one write verdict: the preview, the write and the write projections agree on a computed field the caller is not served whole', () => {
  it('withheld for its input, or served masked itself: the preview refuses, the write refuses, the projections leave it out', async () => {
    const { engine, plugin } = await boot({ fields: HIDE_OPEN_CASES });
    for (const [object, id, field] of [[OBJ, 'a1', 'open_cases_stored'], [NOTE, 'n1', 'plain_masked']] as const) {
      const payload = { [field]: 'x' };
      expect(await plugin.canWriteObject(object, 'update', { ...CALLER }, payload), `preview ${field}`).toBe(false);
      expect(await outcome(engine.update(object, payload, { where: { id }, context: { ...CALLER } } as never)), `write ${field}`)
        .toMatchObject({ code: 'PERMISSION_DENIED', status: 403, forbiddenFields: [field] });
      expect(new Set(await plugin.getWritableFields(object, { ...CALLER })).has(field), `writable ${field}`).toBe(false);
      const access: any = await plugin.getRecordFieldAccess(object, id, { ...CALLER });
      expect(access.editable, `record editable ${field}`).not.toContain(field);
    }
  });

  it('control: a payload naming only a field the caller may edit is admitted by the preview and the write alike', async () => {
    const { engine, plugin } = await boot({ fields: HIDE_OPEN_CASES });
    expect(await plugin.canWriteObject(OBJ, 'update', { ...CALLER }, { name: 'Acme 5' })).toBe(true);
    expect(await outcome(engine.update(OBJ, { name: 'Acme 5' }, { where: { id: 'a1' }, context: { ...CALLER } } as never))).toHaveProperty('landed');
    expect(new Set(await plugin.getWritableFields(OBJ, { ...CALLER })).has('name')).toBe(true);
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

  it("a holder of another set's View All reads the hidden field and the formulas over it", async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES, secondViewAll: true });
    expect(await findA1(engine, TWO_SETS)).toMatchObject({ open_cases: 6, load: 0.5, load_pct: 50, open_cases_stored: 6 });
  });

  it("View All on the set that hides the field does not read it: the field and the computed fields over it stay withheld", async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES, viewAllRecords: true });
    const one = await findA1(engine);
    expect(one).toMatchObject({ capacity: 12 });
    for (const f of ['open_cases', 'load', 'load_pct', 'open_cases_stored', 'load_stored']) expect(one, f).not.toHaveProperty(f);
  });

  it("a holder of another set's View All is still withheld a computed field over a capability-gated or masked field (the vote lifts readable: false only)", async () => {
    const { engine } = await boot({ fields: HIDE_OPEN_CASES, secondViewAll: true });
    const one = await findA1(engine, TWO_SETS);
    expect(one).toMatchObject({ open_cases: 6, load: 0.5, phone: '138****5678' });
    for (const f of ['gated', 'gated_double', 'gated_stored', 'phone_copy', 'phone_stored']) expect(one, f).not.toHaveProperty(f);
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
    // ...and still names the references they read through, as the platform member reader does.
    for (const source of ['size(record) > 0 ? record.owner.name : 0', "record[record.k] + record['owner'].name", 'record.size() + record.owner.name']) {
      expect(read(source)?.reads, source).toBeNull();
      const hops = Object.fromEntries([...(read(source)?.hops ?? [])].map(([k, v]) => [k, [...v].sort()]));
      expect(hops, source).toEqual(Object.fromEntries([...analyzeRelationshipTraversals(source)!.traversals].map(([k, v]) => [k, [...v].sort()])));
    }
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
