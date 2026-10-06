// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21910] The referential cascade does not treat a federated object's
 * platform-INJECTED `organization_id` as a reference to `sys_organization`,
 * and treats nothing else that way.
 *
 * The registry injects the tenant anchor (`organization_id`, a lookup to
 * `sys_organization`) into every object it registers, ADR-0015 `external` ones
 * included, and the platform provisions no storage for a federated object. On
 * the showcase, deleting an organization ran the cascade scan's dependents
 * probe against the remote `customers` table on that column. The SQL driver
 * refused it (`INVALID_FILTER`, no such column), the probe's #8895 catch
 * propagated the refusal, and the organization delete answered 500.
 *
 * What this file pins, all through `engine.delete` on a two-driver engine (the
 * default one, and the remote a federated object is bound to by `datasource`):
 *
 *  1. the scan never reads a federated object on its injected anchor, so an
 *     organization delete lands while that read would be refused. A local
 *     object's injected anchor IS read on the same delete, which proves the
 *     scan ran;
 *  2. an `organization_id` the AUTHOR declared on a federated object is still
 *     probed, and a probe failure still propagates (#8895);
 *  3. any other lookup the author declares on a federated object is still
 *     probed, and a probe failure still propagates (#8895);
 *  4. the cascade's atomicity plan agrees with the scan: an organization delete
 *     whose only cross-datasource "participant" was the injected anchor runs
 *     as one transaction, while an author-declared federated lookup still
 *     makes the plan cross-datasource.
 *
 * [#21918] The same four, for every OTHER anchor the registry injects into a
 * federated object and the object does not provision, read from the
 * registry's provenance rather than from a column name: `owning_business_unit_id`
 * on a business-unit delete, and `owner_id` / `created_by` / `updated_by` on a
 * user delete. Their blocks are at the foot of this file, and the predicate's
 * own pin is `federated-object.test.ts`.
 *
 * The seed rows are written straight into the stub's store, so no write path
 * other than the delete under test runs. The door pins are
 * `packages/qa/dogfood/test/organization-delete-federated-fixture.dogfood.test.ts`
 * and `packages/qa/dogfood/test/business-unit-and-user-delete-federated-fixture.dogfood.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { resolveInjectedColumnProvenance } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

/** The remote datasource every federated fixture below is bound to. */
const REMOTE = 'remote_ds';
const PACKAGE_ID = 'test-21910';

type Row = Record<string, unknown>;

/** Every field name a `where` filters on, at any depth, as `object.field`. */
function filteredColumns(object: string, where: unknown, out: string[] = []): string[] {
  if (Array.isArray(where)) {
    for (const w of where) filteredColumns(object, w, out);
  } else if (where && typeof where === 'object') {
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) filteredColumns(object, v, out);
      else out.push(`${object}.${k}`);
    }
  }
  return out;
}

/**
 * A stub driver that records every read into a shared log, with the columns
 * each read filters on, and can be told to refuse reads of one object with an
 * exact error object. Its `find` applies the caller's `limit` after the
 * filter, by presence.
 */
function makeDriver(name: string, log: { reads: string[]; probes: string[]; begun: number }) {
  const tables: Record<string, Row[]> = {};
  const failReads = new Map<string, unknown>();
  const rowsOf = (o: string): Row[] => (tables[o] ??= []);
  const matches = (row: Row, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const exp = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name, version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    registerExternalObject() {},
    async find(o: string, ast: any) {
      log.reads.push(o);
      log.probes.push(...filteredColumns(o, ast?.where));
      const failure = failReads.get(o);
      if (failure !== undefined) throw failure;
      const hit = (tables[o] ?? []).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? hit.slice(0, ast.limit) : hit;
    },
    async findOne(o: string, ast: any) {
      const [first] = await this.find(o, { ...ast, limit: 1 });
      return first ?? null;
    },
    async count(o: string, ast: any) {
      return (await this.find(o, { where: ast?.where })).length;
    },
    async create(o: string, data: Row) {
      const row = { ...data, id: String(data.id) };
      rowsOf(o).push(row);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      const rows = rowsOf(o);
      const at = rows.findIndex((r) => r.id === String(id));
      if (at < 0) throw new Error(`not found ${o}/${id}`);
      rows[at] = { ...rows[at], ...data, id: String(id) };
      return rows[at];
    },
    async upsert(o: string, data: Row) { return this.create(o, data); },
    async delete(o: string, id: string) {
      const rows = rowsOf(o);
      const at = rows.findIndex((r) => r.id === String(id));
      if (at < 0) return false;
      rows.splice(at, 1);
      return true;
    },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { log.begun += 1; return { id: `trx_${log.begun}` }; },
    async commit() {}, async rollback() {},
  };
  return {
    driver,
    failReads,
    has: (o: string, id: string) => rowsOf(o).some((r) => r.id === id),
    seed: (o: string, row: Row) => void rowsOf(o).push(row),
  };
}

/** The deleted object. Its own injected anchor makes it self-referencing, harmlessly. */
const ORGANIZATION = {
  name: 'sys_organization',
  label: 'Organization',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/** A LOCAL object: the registry injects `organization_id`, and storage backs it. */
const LOCAL = {
  name: 'acct',
  label: 'Account',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/** Federated, as the showcase declares it: no `organization_id` of its own. */
const FEDERATED = {
  name: 'ext_customer',
  label: 'External Customer',
  datasource: REMOTE,
  external: { remoteName: 'customers' },
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/** Federated, with an `organization_id` the AUTHOR declared: it maps a real remote column. */
const FEDERATED_DECLARED_ANCHOR = {
  name: 'ext_tenant_customer',
  label: 'External Tenant Customer',
  datasource: REMOTE,
  external: { remoteName: 'tenant_customers' },
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    organization_id: {
      name: 'organization_id',
      label: 'Remote Organization',
      type: 'lookup' as const,
      reference: 'sys_organization',
    },
  },
};

/** Federated, with another lookup the author declared against the organization. */
const FEDERATED_AUTHOR_LOOKUP = {
  name: 'ext_order',
  label: 'External Order',
  datasource: REMOTE,
  external: { remoteName: 'orders' },
  fields: {
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
    org_ref: { name: 'org_ref', label: 'Organization', type: 'lookup' as const, reference: 'sys_organization' },
  },
};

const ORG_ID = 'org_21910';

/** The refusal the SQL driver answers for a filter on a column the remote does not have. */
function unknownColumnRefusal(object: string, column: string) {
  return Object.assign(
    new Error(`A filter on object '${object}' names a column the database could not resolve (${column}).`),
    { code: 'INVALID_FILTER', status: 400 },
  );
}

async function makeEngine(objects: any[]) {
  const log = { reads: [] as string[], probes: [] as string[], begun: 0 };
  const warnings: string[] = [];
  const logger = {
    debug() {}, info() {}, error() {},
    warn: (message: unknown) => void warnings.push(String(message)),
  };
  const engine = new ObjectQL({ logger } as any);
  const local = makeDriver('memory', log);
  const remote = makeDriver(REMOTE, log);
  engine.registerDriver(local.driver, true);
  engine.registerDriver(remote.driver);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o, PACKAGE_ID);
  local.seed('sys_organization', { id: ORG_ID, name: 'Doomed Org' });
  return { engine, local, remote, log, warnings };
}

const NOT_ATOMIC = 'cannot run as one unit of work';

describe('[#21910] the cascade scan skips a federated object\'s injected tenant anchor, and nothing else', () => {
  it('never probes a federated object on its injected organization_id, so the organization delete lands', async () => {
    const { engine, local, remote, log } = await makeEngine([ORGANIZATION, LOCAL, FEDERATED]);
    // PREMISE: the registered schema carries the platform's injected anchor.
    expect(resolveInjectedColumnProvenance(engine.getSchema('ext_customer'), 'organization_id'))
      .toBe('injected-unprovisioned');
    // Any read of the remote table on that column is refused, as the showcase measured.
    remote.failReads.set('ext_customer', unknownColumnRefusal('ext_customer', 'organization_id'));

    log.reads.length = 0;
    await engine.delete('sys_organization', { where: { id: ORG_ID } } as any);

    expect(local.has('sys_organization', ORG_ID)).toBe(false);
    expect(log.reads).not.toContain('ext_customer');
    // CONTROL: the scan ran for this delete, and probed the local object's injected anchor.
    expect(log.reads).toContain('acct');
  });

  it('still probes an organization_id the AUTHOR declared on a federated object, and its failure propagates (#8895)', async () => {
    const { engine, local, remote, log } = await makeEngine([ORGANIZATION, FEDERATED_DECLARED_ANCHOR]);
    expect(resolveInjectedColumnProvenance(engine.getSchema('ext_tenant_customer'), 'organization_id'))
      .toBe('author');
    const injected = unknownColumnRefusal('ext_tenant_customer', 'organization_id');
    remote.failReads.set('ext_tenant_customer', injected);

    log.reads.length = 0;
    const err: any = await engine.delete('sys_organization', { where: { id: ORG_ID } } as any).catch((e) => e);

    expect(err).toBe(injected);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(log.reads).toContain('ext_tenant_customer');
    expect(local.has('sys_organization', ORG_ID)).toBe(true);
  });

  it('still probes any other lookup the author declared on a federated object, and its failure propagates (#8895)', async () => {
    const { engine, local, remote, log } = await makeEngine([ORGANIZATION, FEDERATED_AUTHOR_LOOKUP]);
    const injected = unknownColumnRefusal('ext_order', 'org_ref');
    remote.failReads.set('ext_order', injected);

    log.reads.length = 0;
    const err: any = await engine.delete('sys_organization', { where: { id: ORG_ID } } as any).catch((e) => e);

    expect(err).toBe(injected);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(log.reads).toContain('ext_order');
    expect(local.has('sys_organization', ORG_ID)).toBe(true);
  });
});

describe('[#21910] the cascade atomicity plan agrees with the scan about who takes part', () => {
  it('runs the organization delete as one transaction when the injected anchor was its only cross-datasource reference', async () => {
    const { engine, local, log, warnings } = await makeEngine([ORGANIZATION, LOCAL, FEDERATED]);

    await engine.delete('sys_organization', { where: { id: ORG_ID } } as any);

    expect(local.has('sys_organization', ORG_ID)).toBe(false);
    expect(log.begun).toBe(1);
    expect(warnings.filter((w) => w.includes(NOT_ATOMIC))).toEqual([]);
  });

  it('CONTROL: an author-declared lookup on a federated object still makes the plan cross-datasource', async () => {
    const { engine, local, log, warnings } = await makeEngine([ORGANIZATION, LOCAL, FEDERATED_AUTHOR_LOOKUP]);

    await engine.delete('sys_organization', { where: { id: ORG_ID } } as any);

    expect(local.has('sys_organization', ORG_ID)).toBe(false);
    expect(log.reads).toContain('ext_order');
    expect(log.begun).toBe(0);
    expect(warnings.filter((w) => w.includes(NOT_ATOMIC))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// [#21918] Every other injected anchor of a federated object, read from the
// registry's provenance: `owning_business_unit_id` (ADR-0117 D1) on a business
// unit delete, and the owner and audit lookups `owner_id` / `created_by` /
// `updated_by` on a user delete. #21910's predicate named `organization_id`
// alone, so on the showcase with its federated fixture a business-unit delete
// answered 400 (`INVALID_FILTER` on `showcase_ext_customer.owning_business_unit_id`)
// and a user delete answered 500 (on `created_by`). The door pins are
// `packages/qa/dogfood/test/business-unit-and-user-delete-federated-fixture.dogfood.test.ts`.
// ---------------------------------------------------------------------------

/** The business-unit object a federated object's injected `owning_business_unit_id` names. */
const BUSINESS_UNIT = {
  name: 'sys_business_unit',
  label: 'Business Unit',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/** The user object a federated object's injected `owner_id` / `created_by` / `updated_by` name. */
const USER = {
  name: 'sys_user',
  label: 'User',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/**
 * Federated, with two lookups the AUTHOR declared on the anchors' targets: an
 * `owner_id` of its own (it maps a real remote column) and `unit_ref`.
 */
const FEDERATED_AUTHOR_ANCHORS = {
  name: 'ext_assignment',
  label: 'External Assignment',
  datasource: REMOTE,
  external: { remoteName: 'assignments' },
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' as const },
    owner_id: { name: 'owner_id', label: 'Remote Owner', type: 'lookup' as const, reference: 'sys_user' },
    unit_ref: { name: 'unit_ref', label: 'Unit', type: 'lookup' as const, reference: 'sys_business_unit' },
  },
};

const UNIT_ID = 'bu_21918';
const USER_ID = 'usr_21918';

async function makeAnchorEngine(objects: any[]) {
  const made = await makeEngine([ORGANIZATION, BUSINESS_UNIT, USER, ...objects]);
  made.local.seed('sys_business_unit', { id: UNIT_ID, name: 'Doomed Unit' });
  made.local.seed('sys_user', { id: USER_ID, name: 'Doomed User' });
  return made;
}

/** The columns a delete's scan probed on one object, deduplicated and sorted. */
const probedOn = (log: { probes: string[] }, object: string): string[] =>
  [...new Set(log.probes.filter((p) => p.startsWith(`${object}.`)))].sort();

describe('[#21918] the cascade scan skips every injected anchor a federated object does not provision', () => {
  it('a business-unit delete never probes a federated object on its injected owning_business_unit_id, and lands', async () => {
    const { engine, local, remote, log } = await makeAnchorEngine([LOCAL, FEDERATED]);
    // PREMISE: the registered anchor is the registry's own, and unprovisioned.
    expect(resolveInjectedColumnProvenance(engine.getSchema('ext_customer'), 'owning_business_unit_id'))
      .toBe('injected-unprovisioned');
    remote.failReads.set('ext_customer', unknownColumnRefusal('ext_customer', 'owning_business_unit_id'));

    log.reads.length = 0;
    log.probes.length = 0;
    await engine.delete('sys_business_unit', { where: { id: UNIT_ID } } as any);

    expect(local.has('sys_business_unit', UNIT_ID)).toBe(false);
    expect(log.reads).not.toContain('ext_customer');
    // CONTROL: the scan ran, and probed the LOCAL object's injected anchor of the same name.
    expect(probedOn(log, 'acct')).toContain('acct.owning_business_unit_id');
  });

  it('a user delete never probes a federated object on its injected owner_id, created_by or updated_by, and lands', async () => {
    const { engine, local, remote, log } = await makeAnchorEngine([LOCAL, FEDERATED]);
    const schema = engine.getSchema('ext_customer');
    for (const column of ['owner_id', 'created_by', 'updated_by']) {
      expect(resolveInjectedColumnProvenance(schema, column), column).toBe('injected-unprovisioned');
    }
    remote.failReads.set('ext_customer', unknownColumnRefusal('ext_customer', 'created_by'));

    log.reads.length = 0;
    log.probes.length = 0;
    await engine.delete('sys_user', { where: { id: USER_ID } } as any);

    expect(local.has('sys_user', USER_ID)).toBe(false);
    expect(log.reads).not.toContain('ext_customer');
    // CONTROL: the LOCAL object's injected owner and audit lookups ARE probed.
    expect(probedOn(log, 'acct')).toEqual(
      expect.arrayContaining(['acct.created_by', 'acct.owner_id', 'acct.updated_by']),
    );
  });

  it('still probes lookups the AUTHOR declared on a federated object, and a business-unit probe failure propagates (#8895)', async () => {
    const { engine, local, remote, log } = await makeAnchorEngine([FEDERATED_AUTHOR_ANCHORS]);
    const injected = unknownColumnRefusal('ext_assignment', 'unit_ref');
    remote.failReads.set('ext_assignment', injected);

    log.probes.length = 0;
    const err: any = await engine.delete('sys_business_unit', { where: { id: UNIT_ID } } as any).catch((e) => e);

    expect(err).toBe(injected);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    // The probe that ran is the author's column, never the injected anchor beside it.
    expect(probedOn(log, 'ext_assignment')).toEqual(['ext_assignment.unit_ref']);
    expect(local.has('sys_business_unit', UNIT_ID)).toBe(true);
  });

  it('still probes an owner_id the AUTHOR declared on a federated object, and a user probe failure propagates (#8895)', async () => {
    const { engine, local, remote, log } = await makeAnchorEngine([FEDERATED_AUTHOR_ANCHORS]);
    expect(resolveInjectedColumnProvenance(engine.getSchema('ext_assignment'), 'owner_id')).toBe('author');
    const injected = unknownColumnRefusal('ext_assignment', 'owner_id');
    remote.failReads.set('ext_assignment', injected);

    log.probes.length = 0;
    const err: any = await engine.delete('sys_user', { where: { id: USER_ID } } as any).catch((e) => e);

    expect(err).toBe(injected);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(probedOn(log, 'ext_assignment')).toEqual(['ext_assignment.owner_id']);
    expect(local.has('sys_user', USER_ID)).toBe(true);
  });
});

describe('[#21918] the cascade atomicity plan agrees with the scan for every injected anchor', () => {
  it('runs a business-unit delete as one transaction when injected anchors were its only cross-datasource references', async () => {
    const { engine, local, log, warnings } = await makeAnchorEngine([LOCAL, FEDERATED]);

    await engine.delete('sys_business_unit', { where: { id: UNIT_ID } } as any);

    expect(local.has('sys_business_unit', UNIT_ID)).toBe(false);
    expect(log.begun).toBe(1);
    expect(warnings.filter((w) => w.includes(NOT_ATOMIC))).toEqual([]);
  });

  it('runs a user delete as one transaction when injected anchors were its only cross-datasource references', async () => {
    const { engine, local, log, warnings } = await makeAnchorEngine([LOCAL, FEDERATED]);

    await engine.delete('sys_user', { where: { id: USER_ID } } as any);

    expect(local.has('sys_user', USER_ID)).toBe(false);
    expect(log.begun).toBe(1);
    expect(warnings.filter((w) => w.includes(NOT_ATOMIC))).toEqual([]);
  });

  it('CONTROL: lookups the author declared on a federated object still make both plans cross-datasource', async () => {
    for (const [object, id] of [['sys_business_unit', UNIT_ID], ['sys_user', USER_ID]] as const) {
      const { engine, local, log, warnings } = await makeAnchorEngine([LOCAL, FEDERATED_AUTHOR_ANCHORS]);

      await engine.delete(object, { where: { id } } as any);

      expect(local.has(object, id), object).toBe(false);
      expect(log.reads, object).toContain('ext_assignment');
      expect(log.begun, object).toBe(0);
      expect(warnings.filter((w) => w.includes(NOT_ATOMIC)), object).toHaveLength(1);
    }
  });
});
