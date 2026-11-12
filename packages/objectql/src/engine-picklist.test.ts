// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared picklists at runtime, against the real engine and registry.
 *
 * A select field authors `picklist: '<name>'` instead of `options`; the
 * registry resolves the list — its own options plus every
 * `picklistExtensions` entry's — onto the served field, and the write door
 * judges against that same field. Pinned here, one block per obligation:
 *
 *  - the served shape (`options` resolved, `picklist` kept), on every read
 *    path the fold reaches, independent of the order things registered in;
 *  - the additive merge, and the refusal of a repeated value in either
 *    registration order (never last-wins);
 *  - the unknown-name audit (the boot refusal lives in
 *    `plugin-picklist-boot-audit.test.ts`);
 *  - write validation against the resolved set, the refusal naming the list,
 *    and a list that did not resolve accepting nothing;
 *  - a stale served copy never standing in for the list.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';
import { describeDisagreeingPicklistReference, describeUnresolvedPicklistReferences } from './picklist-resolution.js';

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string) { return Array.from(storeFor(object).values()); },
    async findOne(object: string) { return storeFor(object).values().next().value ?? null; },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update() { return null; },
    async upsert(object: string, data: Record<string, unknown>) { return this.create(object, data); },
    async delete() { return true; },
    async count(object: string) { return storeFor(object).size; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany() { return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

const sys = { context: { isSystem: true } } as any;

const INDUSTRY = {
  name: 'industry',
  label: 'Industry',
  options: [
    { label: 'Technology', value: 'technology', default: true },
    { label: 'Finance', value: 'finance' },
  ],
};

const HEALTHCARE_EXTENSION = { extend: 'industry', options: [{ label: 'Healthcare', value: 'healthcare' }] };

const account = {
  name: 'pk_account',
  label: 'Account',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    industry: { name: 'industry', label: 'Industry', type: 'select' as const, picklist: 'industry' },
  },
};

const lead = {
  name: 'pk_lead',
  label: 'Lead',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    industries: { name: 'industries', label: 'Industries', type: 'multiselect' as const, picklist: 'industry' },
  },
};

/** The manifest of the package that owns the list and the first object. */
const CORE = {
  id: 'com.test.picklist.core',
  name: 'core',
  picklists: [INDUSTRY],
  objects: [account],
};

/**
 * A second package: adds a value to the list and binds a second object to it.
 * It declares its dependency on CORE: a field's `picklist` resolves from its
 * package's declared closure (ADR-0150 D3), so binding a field to another
 * package's list takes the dependency.
 */
const HEALTH = {
  id: 'com.test.picklist.health',
  name: 'health',
  dependencies: { 'com.test.picklist.core': '^1.0.0' },
  picklistExtensions: [HEALTHCARE_EXTENSION],
  objects: [lead],
};

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(makeStubDriver().driver, true);
  await engine.init();
  return engine;
}

const values = (field: any) => (field?.options ?? []).map((o: any) => o.value);

async function refusal(promise: Promise<unknown>): Promise<ValidationError> {
  const err = await promise.then(
    () => { throw new Error('expected the write to be refused'); },
    (e) => e,
  );
  expect(err).toBeInstanceOf(ValidationError);
  return err as ValidationError;
}

describe('picklist — the served shape', () => {
  let engine: ObjectQL;
  beforeEach(async () => {
    engine = await bootEngine();
    engine.registerApp(CORE);
    engine.registerApp(HEALTH);
  });

  it('serves the field with the merged options and keeps `picklist`', () => {
    const field: any = engine.registry.getObject('pk_account')!.fields.industry;
    expect(field.picklist).toBe('industry');
    expect(values(field)).toEqual(['technology', 'finance', 'healthcare']);
    // The option shape is carried verbatim, `default` included.
    expect(field.options[0]).toEqual({ label: 'Technology', value: 'technology', default: true });
  });

  it('resolves the SAME set onto a second object bound to the list', () => {
    expect(values(engine.registry.getObject('pk_lead')!.fields.industries)).toEqual(['technology', 'finance', 'healthcare']);
  });

  it('serves the registry list through resolvePicklistOptions, and nothing for an unknown name', () => {
    expect(engine.registry.resolvePicklistOptions('industry')!.map((o) => o.value)).toEqual(['technology', 'finance', 'healthcare']);
    expect(engine.registry.resolvePicklistOptions('nope')).toBeUndefined();
  });

  it('a body the registry never saw is resolved by the fold too — by reference when nothing is bound', () => {
    const body = { name: 'loose', fields: { f: { name: 'f', type: 'select', picklist: 'industry' } } };
    const folded: any = engine.registry.foldObjectExtendersOnto('loose', body);
    expect(values(folded.fields.f)).toEqual(['technology', 'finance', 'healthcare']);
    const plain = { name: 'plain', fields: { f: { name: 'f', type: 'text' } } };
    expect(engine.registry.foldObjectExtendersOnto('plain', plain)).toBe(plain);
  });

  it('an object that binds no picklist is served exactly as before', () => {
    engine.registry.registerObject({ name: 'pk_plain', fields: { s: { name: 's', type: 'select', options: [{ label: 'A', value: 'a' }] } } } as any, 'p');
    expect(values(engine.registry.getObject('pk_plain')!.fields.s)).toEqual(['a']);
    expect((engine.registry.getObject('pk_plain')!.fields.s as any).picklist).toBeUndefined();
  });
});

describe('picklist — load order', () => {
  it('an object registered BEFORE its list still resolves once the list arrives', async () => {
    const engine = await bootEngine();
    // The object is the list's own package's (a field's `picklist` resolves
    // from its package's declared closure, ADR-0150 D3); only the ORDER is
    // under test.
    engine.registry.registerObject(account as any, 'com.test.core');
    // Read before the list exists: nothing to serve yet …
    expect((engine.registry.getObject('pk_account')!.fields.industry as any).options).toBeUndefined();
    // … then the list and an extension land, in the "wrong" order.
    engine.registry.registerPicklistExtension(HEALTHCARE_EXTENSION, 'com.test.health');
    engine.registry.registerItem('picklist', { ...INDUSTRY }, 'name', 'com.test.core');
    expect(values(engine.registry.getObject('pk_account')!.fields.industry)).toEqual(['technology', 'finance', 'healthcare']);
  });

  it('a nested plugin\'s lists register under the parent package, through the same seam', async () => {
    const engine = await bootEngine();
    engine.registerApp({ id: 'com.test.nested', name: 'nested', objects: [account], plugins: [{ name: 'inner', picklists: [INDUSTRY], picklistExtensions: [HEALTHCARE_EXTENSION] }] });
    expect(values(engine.registry.getObject('pk_account')!.fields.industry)).toEqual(['technology', 'finance', 'healthcare']);
  });
});

describe('picklist — the additive merge refuses a repeated value', () => {
  it('an extension repeating one of the list\'s own values', async () => {
    const engine = await bootEngine();
    engine.registerApp(CORE);
    const err: any = (() => {
      try { engine.registerApp({ id: 'com.test.dup', name: 'dup', picklistExtensions: [{ extend: 'industry', options: [{ label: 'Fintech', value: 'finance' }] }] }); }
      catch (e) { return e; }
      return undefined;
    })();
    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(err.message).toContain("Picklist 'industry' would carry the value 'finance' twice");
    expect(err.message).toContain("package 'com.test.picklist.core'");
    expect(err.message).toContain("package 'com.test.dup'");
    // Not last-wins: the owner's option is untouched.
    expect(engine.registry.resolvePicklistOptions('industry')).toEqual([
      { label: 'Technology', value: 'technology', default: true },
      { label: 'Finance', value: 'finance' },
    ]);
  });

  it('the list registering AFTER an extension that already added one of its values', async () => {
    const engine = await bootEngine();
    engine.registry.registerPicklistExtension({ extend: 'industry', options: [{ label: 'Tech', value: 'technology' }] }, 'com.test.early');
    expect(() => engine.registry.registerItem('picklist', { ...INDUSTRY }, 'name', 'com.test.core'))
      .toThrow(expect.objectContaining({ code: 'INVALID_METADATA', status: 422 }));
    expect(engine.registry.resolvePicklistOptions('industry')).toBeUndefined();
  });

  it('two packages\' extensions adding the same value', async () => {
    const engine = await bootEngine();
    engine.registerApp(CORE);
    engine.registerApp(HEALTH);
    expect(() => engine.registry.registerPicklistExtension(HEALTHCARE_EXTENSION, 'com.test.other'))
      .toThrow(/Picklist 'industry' would carry the value 'healthcare' twice/);
  });

  it('a value repeated inside one extension', async () => {
    const engine = await bootEngine();
    engine.registerApp(CORE);
    expect(() => engine.registry.registerPicklistExtension({ extend: 'industry', options: [{ label: 'X', value: 'x' }, { label: 'X2', value: 'x' }] }, 'p'))
      .toThrow(expect.objectContaining({ code: 'INVALID_METADATA' }));
  });

  it('a package re-registering its own extension is a replay, not a duplicate', async () => {
    const engine = await bootEngine();
    engine.registerApp(CORE);
    engine.registerApp(HEALTH);
    engine.registerApp(HEALTH);
    expect(engine.registry.resolvePicklistOptions('industry')!.map((o) => o.value)).toEqual(['technology', 'finance', 'healthcare']);
  });

  it('uninstalling the extending package takes its values out of every bound field', async () => {
    const engine = await bootEngine();
    engine.registerApp(CORE);
    engine.registry.registerPicklistExtension(HEALTHCARE_EXTENSION, 'com.test.health');
    engine.registry.unregisterItemsByPackage('com.test.health');
    expect(values(engine.registry.getObject('pk_account')!.fields.industry)).toEqual(['technology', 'finance']);
  });
});

describe('picklist — an unknown name', () => {
  it('names every unresolved field with the package that declared it', async () => {
    const engine = await bootEngine();
    engine.registerApp({ id: 'com.test.broken', name: 'broken', objects: [account, lead] });
    const unresolved = engine.registry.findUnresolvedPicklistReferences();
    expect(unresolved).toEqual([
      { object: 'pk_account', field: 'industry', picklist: 'industry', packageId: 'com.test.broken' },
      { object: 'pk_lead', field: 'industries', picklist: 'industry', packageId: 'com.test.broken' },
    ]);
    const err = describeUnresolvedPicklistReferences(unresolved)!;
    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(err.message).toContain("field 'pk_account.industry' (package 'com.test.broken') references picklist 'industry'");
    // Never served as a select with an empty list.
    expect((engine.registry.getObject('pk_account')!.fields.industry as any).options).toBeUndefined();
  });

  it('an extension field from another package is attributed to THAT package', async () => {
    const engine = await bootEngine();
    engine.registerApp({ id: 'com.test.owner', name: 'owner', objects: [{ name: 'pk_x', fields: { a: { name: 'a', type: 'text' } } }] });
    engine.registerApp({
      id: 'com.test.ext', name: 'ext',
      objectExtensions: [{ extend: 'pk_x', fields: { tier: { name: 'tier', type: 'select', picklist: 'tier' } } }],
    });
    expect(engine.registry.findUnresolvedPicklistReferences()).toEqual([
      { object: 'pk_x', field: 'tier', picklist: 'tier', packageId: 'com.test.ext' },
    ]);
  });

  it('a tenant overlay never fails the audit — the write door refuses it instead', async () => {
    const engine = await bootEngine();
    engine.registry.registerObject({ name: 'pk_tenant', fields: { f: { name: 'f', type: 'select', picklist: 'gone' } } } as any, undefined, undefined, 'overlay');
    expect(engine.registry.findUnresolvedPicklistReferences()).toEqual([]);
  });

  it('an extension of a list nothing declares is reported with its package — its values would go nowhere', async () => {
    const engine = await bootEngine();
    engine.registerApp({ id: 'com.test.orphan', name: 'orphan', picklistExtensions: [{ extend: 'industy', options: [{ label: 'X', value: 'x' }] }] });
    const orphans = engine.registry.findOrphanPicklistExtensions();
    expect(orphans).toEqual([{ picklist: 'industy', packageId: 'com.test.orphan' }]);
    expect(describeUnresolvedPicklistReferences([], orphans)!.message)
      .toContain("a `picklistExtensions` entry (package 'com.test.orphan') extends picklist 'industy'");
  });

  it('nothing is reported once every list resolves', async () => {
    const engine = await bootEngine();
    engine.registerApp(CORE);
    engine.registerApp(HEALTH);
    expect(engine.registry.findUnresolvedPicklistReferences()).toEqual([]);
    expect(engine.registry.findOrphanPicklistExtensions()).toEqual([]);
  });
});

describe('picklist — the write door judges the resolved set', () => {
  let engine: ObjectQL;
  beforeEach(async () => {
    engine = await bootEngine();
    engine.registerApp(CORE);
    engine.registerApp(HEALTH);
  });

  it('accepts the list\'s own value and an extension\'s value', async () => {
    expect(((await engine.insert('pk_account', { name: 'A', industry: 'finance' }, sys)) as any).industry).toBe('finance');
    expect(((await engine.insert('pk_account', { name: 'B', industry: 'healthcare' }, sys)) as any).industry).toBe('healthcare');
    expect(((await engine.insert('pk_lead', { name: 'L', industries: ['healthcare', 'technology'] }, sys)) as any).industries).toEqual(['healthcare', 'technology']);
  });

  it('refuses a value outside the set, and the refusal names the picklist', async () => {
    const err = await refusal(engine.insert('pk_lead', { name: 'L', industries: ['retail'] }, sys));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields[0]).toMatchObject({ field: 'industries', code: 'invalid_option', options: ['technology', 'finance', 'healthcare'] });
    expect(err.fields[0].message).toBe('Industries: "retail" is not a value of picklist "industry": technology, finance, healthcare');
    const single = await refusal(engine.insert('pk_account', { name: 'A', industry: 'retail' }, sys));
    expect(single.fields[0]).toMatchObject({ field: 'industry', code: 'invalid_option' });
    expect(single.fields[0].message).toBe('Industry must be one of the values of picklist "industry": technology, finance, healthcare');
  });

  it('fills an omitted field from the list\'s option marked `default: true`', async () => {
    expect(((await engine.insert('pk_account', { name: 'D' }, sys)) as any).industry).toBe('technology');
  });

  it('a field whose list does not resolve accepts NO value — never read as free-form', async () => {
    // Outside a kernel nothing audits the boot, so the engine is the last door.
    const bare = await bootEngine();
    bare.registry.registerObject({ name: 'pk_orphan', fields: { f: { name: 'f', label: 'F', type: 'select', picklist: 'gone' } } } as any, 'p');
    const err = await refusal(bare.insert('pk_orphan', { f: 'anything' }, sys));
    expect(err.fields[0]).toMatchObject({ field: 'f', code: 'invalid_option' });
    expect(err.fields[0].message).toBe('F takes its values from picklist "gone", which no loaded package declares, so no value can be accepted');
  });
});

describe('picklist — a stale served copy never stands in for the list', () => {
  it('a body already carrying options beside `picklist` gets the CURRENT list', async () => {
    const engine = await bootEngine();
    engine.registerApp(CORE);
    const stale = { name: 'pk_account', fields: { industry: { name: 'industry', type: 'select', picklist: 'industry', options: [{ label: 'Old', value: 'old' }] } } };
    expect(values((engine.registry.foldObjectExtendersOnto('pk_account', stale) as any).fields.industry)).toEqual(['technology', 'finance']);
  });

  it('…and loses them when the list is gone, so the write door refuses instead of accepting a stale value', async () => {
    const engine = await bootEngine();
    const stale = { name: 'pk_s', fields: { f: { name: 'f', type: 'select', picklist: 'gone', options: [{ label: 'Old', value: 'old' }] } } };
    const folded: any = engine.registry.foldObjectExtendersOnto('pk_s', stale);
    expect('options' in folded.fields.f).toBe(false);
    expect(folded.fields.f.picklist).toBe('gone');
  });

  it('handles the array spelling of `fields` a served body may carry', async () => {
    const engine = await bootEngine();
    engine.registerApp(CORE);
    const body = { name: 'pk_arr', fields: [{ name: 'f', type: 'select', picklist: 'industry' }, { name: 'g', type: 'text' }] };
    const folded: any = engine.registry.foldObjectExtendersOnto('pk_arr', body);
    expect(values(folded.fields[0])).toEqual(['technology', 'finance']);
    expect(folded.fields[1]).toBe(body.fields[1]);
  });
});

/**
 * [ADR-0150 D3/D4, child E6] A field's `picklist` resolves through the
 * package-scoped resolver from the package that WROTE the reference: its own
 * list, else the unique holder in its declared dependency closure (plus
 * `sys`), else a refusal naming every candidate. Phase 1 keeps one holder per
 * name, so what moves is the declared narrowing alone.
 */
describe('picklist — resolved from the package that writes the reference (ADR-0150 D3)', () => {
  const ENV_LIST = { name: 'env_tier', label: 'Tier', options: [{ label: 'Gold', value: 'gold' }] };
  const member = (picklist: string) => ({
    name: 'pk_member',
    label: 'Member',
    fields: {
      name: { name: 'name', label: 'Name', type: 'text' as const },
      tier: { name: 'tier', label: 'Tier', type: 'select' as const, picklist },
    },
  });

  it('D3 (a): a package field whose list only the environment holds is served with no options, and its values are refused', async () => {
    const engine = await bootEngine();
    // An environment-authored list: bound to no package (the bare slot).
    engine.registry.registerItem('picklist', { ...ENV_LIST }, 'name');
    engine.registerApp({ id: 'com.test.pkg', name: 'pkg', objects: [member('env_tier')] });

    const field: any = engine.registry.getObject('pk_member')!.fields.tier;
    expect(field.picklist).toBe('env_tier');
    expect(field.options).toBeUndefined();
    const verdict = engine.registry.picklistReferenceVerdict('env_tier', 'com.test.pkg');
    expect(verdict).toMatchObject({ status: 'refused', reason: 'outside-closure', candidates: [{ kind: 'environment' }] });
    const err = await refusal(engine.insert('pk_member', { name: 'M', tier: 'gold' }, sys));
    expect(err.fields[0]).toMatchObject({ field: 'tier' });
    // Named for the boot's warning (never a boot refusal), not as an unresolved reference.
    expect(engine.registry.findUnresolvedPicklistReferences()).toEqual([]);
    expect(engine.registry.findOutsideClosurePicklistReferences()).toEqual([
      expect.objectContaining({ object: 'pk_member', field: 'tier', picklist: 'env_tier', packageId: 'com.test.pkg' }),
    ]);
  });

  it('a package field whose list a package OUTSIDE its declared closure holds is refused, naming that package', async () => {
    const engine = await bootEngine();
    engine.registerApp({ id: 'com.test.lists', name: 'lists', picklists: [{ ...ENV_LIST }] });
    engine.registerApp({ id: 'com.test.pkg', name: 'pkg', objects: [member('env_tier')] });

    expect((engine.registry.getObject('pk_member')!.fields.tier as any).options).toBeUndefined();
    // A refused reference, named for the boot's warning — never a boot refusal (N2).
    expect(engine.registry.findUnresolvedPicklistReferences()).toEqual([]);
    const [outside] = engine.registry.findOutsideClosurePicklistReferences();
    expect(outside).toMatchObject({ object: 'pk_member', field: 'tier', packageId: 'com.test.pkg' });
    expect(outside.refusal).toContain('package "com.test.lists"');
  });

  it('CONTROL — the same field, its package declaring the holder as a dependency, is served the list', async () => {
    const engine = await bootEngine();
    engine.registerApp({ id: 'com.test.lists', name: 'lists', picklists: [{ ...ENV_LIST }] });
    engine.registerApp({
      id: 'com.test.pkg', name: 'pkg', dependencies: { 'com.test.lists': '^1.0.0' }, objects: [member('env_tier')],
    });
    expect(values(engine.registry.getObject('pk_member')!.fields.tier)).toEqual(['gold']);
    expect(engine.registry.findUnresolvedPicklistReferences()).toEqual([]);
  });

  it('CONTROL — a referrer with no package (a body only the environment writes) is served the environment\'s list, as before', async () => {
    const engine = await bootEngine();
    engine.registry.registerItem('picklist', { ...ENV_LIST }, 'name');
    const body = member('env_tier');
    // A body this registry never saw: no packaged layer wrote its reference.
    const folded: any = engine.registry.foldObjectExtendersOnto('pk_member', body);
    expect(values(folded.fields.tier)).toEqual(['gold']);
    expect(engine.registry.resolvePicklistOptions('env_tier')!.map((o) => o.value)).toEqual(['gold']);
  });

  // [epic seat review on #31731] An owner and an extender in different
  // packages both write the field's reference: neither is picked by fold
  // order. The field is served only when every referrer reaches the same list.
  it('two packages writing one field\'s reference: served no options unless BOTH reach the list (no fold-order pick)', async () => {
    const engine = await bootEngine();
    engine.registerApp({ id: 'com.test.lists', name: 'lists', picklists: [{ ...ENV_LIST }] });
    // The owner does not depend on the list's package; the extender (folded LAST) does.
    engine.registerApp({ id: 'com.test.pkg', name: 'pkg', objects: [member('env_tier')] });
    engine.registerApp({
      id: 'com.test.ext', name: 'ext', dependencies: { 'com.test.lists': '^1.0.0' },
      objectExtensions: [{ extend: 'pk_member', fields: { tier: { name: 'tier', type: 'select', picklist: 'env_tier' } } }],
    });
    expect((engine.registry.getObject('pk_member')!.fields.tier as any).options).toBeUndefined();
    expect(engine.registry.findOutsideClosurePicklistReferences()).toEqual([
      expect.objectContaining({ object: 'pk_member', field: 'tier', packageId: 'com.test.pkg' }),
    ]);
  });

  it('CONTROL — the same owner and extender, both depending on the list\'s package, are served the list', async () => {
    const engine = await bootEngine();
    engine.registerApp({ id: 'com.test.lists', name: 'lists', picklists: [{ ...ENV_LIST }] });
    engine.registerApp({
      id: 'com.test.pkg', name: 'pkg', dependencies: { 'com.test.lists': '^1.0.0' }, objects: [member('env_tier')],
    });
    engine.registerApp({
      id: 'com.test.ext', name: 'ext', dependencies: { 'com.test.lists': '^1.0.0' },
      objectExtensions: [{ extend: 'pk_member', fields: { tier: { name: 'tier', type: 'select', picklist: 'env_tier' } } }],
    });
    expect(values(engine.registry.getObject('pk_member')!.fields.tier)).toEqual(['gold']);
    expect(engine.registry.findUnresolvedPicklistReferences()).toEqual([]);
  });

  // [#31700] Two namespaces may each hold one name now: an owner and an
  // extender that each reach THEIR OWN list disagree. Every referrer
  // resolves, so neither half of the audit names it; the boot's third check
  // does (`findDisagreeingPicklistReferences`), and the field stays unserved.
  const SILVER = { name: 'tier', label: 'Tier', options: [{ label: 'Silver', value: 'silver' }] };
  const TIER_EXTENSION = { extend: 'pk_member', fields: { tier: { name: 'tier', type: 'select', picklist: 'tier' } } };

  it('[#31700] an owner and an extender each reaching its own namespace\'s list: served no options, named as disagreeing', async () => {
    const engine = await bootEngine();
    engine.registerApp({
      id: 'com.acme.alpha', name: 'alpha', namespace: 'alpha', picklists: [{ ...ENV_LIST, name: 'tier' }], objects: [member('tier')],
    });
    engine.registerApp({
      id: 'com.beta.ext', name: 'ext', namespace: 'beta', picklists: [SILVER], objectExtensions: [TIER_EXTENSION],
    });

    expect((engine.registry.getObject('pk_member')!.fields.tier as any).options).toBeUndefined();
    const err = await refusal(engine.insert('pk_member', { name: 'M', tier: 'gold' }, sys));
    expect(err.fields[0]).toMatchObject({ field: 'tier' });
    expect(engine.registry.findUnresolvedPicklistReferences()).toEqual([]);
    expect(engine.registry.findOutsideClosurePicklistReferences()).toEqual([]);
    const disagreeing = engine.registry.findDisagreeingPicklistReferences();
    expect(disagreeing).toEqual([{
      object: 'pk_member',
      field: 'tier',
      picklist: 'tier',
      referrers: [
        { packageId: 'com.acme.alpha', holder: { kind: 'package', packageId: 'com.acme.alpha' } },
        { packageId: 'com.beta.ext', holder: { kind: 'package', packageId: 'com.beta.ext' } },
      ],
    }]);
    const warning = describeDisagreeingPicklistReference(disagreeing[0]);
    expect(warning).toContain("Field 'pk_member.tier' is served with no options and refuses every value");
    expect(warning).toContain('package \'com.acme.alpha\' reaches the list of package "com.acme.alpha"');
    expect(warning).toContain('package \'com.beta.ext\' reaches the list of package "com.beta.ext"');
  });

  it('CONTROL — the extender depending on the owner and holding no list of its own: served the list, nothing disagrees', async () => {
    const engine = await bootEngine();
    engine.registerApp({
      id: 'com.acme.alpha', name: 'alpha', namespace: 'alpha', picklists: [{ ...ENV_LIST, name: 'tier' }], objects: [member('tier')],
    });
    engine.registerApp({
      id: 'com.beta.ext', name: 'ext', namespace: 'beta', dependencies: { 'com.acme.alpha': '^1.0.0' },
      objectExtensions: [TIER_EXTENSION],
    });
    expect(values(engine.registry.getObject('pk_member')!.fields.tier)).toEqual(['gold']);
    expect(engine.registry.findDisagreeingPicklistReferences()).toEqual([]);
  });

  it('a package\'s `picklistExtensions` target resolves caller-less: it extends the one holder\'s list, dependency or not', async () => {
    const engine = await bootEngine();
    engine.registerApp(CORE);
    engine.registerApp({ id: 'com.test.addon', name: 'addon', picklistExtensions: [HEALTHCARE_EXTENSION] });
    expect(values(engine.registry.getObject('pk_account')!.fields.industry)).toEqual(['technology', 'finance', 'healthcare']);
    expect(engine.registry.findOrphanPicklistExtensions()).toEqual([]);
  });
});
