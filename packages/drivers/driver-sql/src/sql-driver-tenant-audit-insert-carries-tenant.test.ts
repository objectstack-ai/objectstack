// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 8c-1] The `[tenant-audit]` line skips an INSERT whose row carries
// its tenant column, and only an insert.
//
// An insert names its organization in two places: `options.tenantId`, which
// `injectTenantOnInsert` stamps onto the row, and the row's own tenant column.
// A `create` / `bulkCreate` whose every row already carries that column is
// confined to the organizations it names, so the line had nothing to report —
// yet a walled boot printed one for every elevated seed insert (they reach the
// driver with no `tenantId` and an `organization_id` on the row; a system
// insert with none is refused above the driver, ADR-0131 D9).
//
// The other half is what must NOT move: an update or a delete with no
// `tenantId` still warns whatever its payload says (the row's column is a value
// being written there, not the statement's scope), and so does an upsert, whose
// merge leg can reach another organization's row. The prefix is byte-identical,
// because `delivery-claim-tenant-audit.integration.test.ts` matches it.
//
// Real `SqlDriver` against a real in-memory SQLite; the logger is the
// assertion surface.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;

let driver: SqlDriver;
let warns: Array<{ msg: string; meta: any }>;

/**
 * An organization-less row is refused by the NOT NULL organization column
 * (ADR-0131 D1) — AFTER the audit has run, which is the order these controls
 * read: the line is printed, then the statement fails.
 */
const refused = (write: Promise<unknown>) =>
  write.then(
    () => { throw new Error('expected the organization-less insert to be refused'); },
    () => undefined,
  );

const lines = (op?: string) =>
  warns.filter((w) => w.msg.startsWith(op === undefined ? '[tenant-audit] ' : `[tenant-audit] ${op} on tenant-scoped object "account"`));

beforeEach(async () => {
  process.env.OS_TENANCY_POSTURE = 'isolated';
  driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  warns = [];
  (driver as any).logger = { warn: (msg: string, meta: any) => warns.push({ msg, meta }) };
  await driver.initObjects([
    { name: 'account', fields: { organization_id: { type: 'string' }, name: { type: 'string' } } },
  ]);
});
afterEach(async () => {
  await driver.disconnect();
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
});

describe('[ADR-0131 8c-1] an insert whose row carries its organization is not audited', () => {
  it('create: the row names its organization, no tenantId — no line', async () => {
    await driver.create('account', { id: 'a1', organization_id: 'org_a', name: 'A1' });
    expect(lines()).toEqual([]);
  });

  it('bulkCreate: every row names its organization — no line, across organizations too', async () => {
    await driver.bulkCreate('account', [
      { id: 'a1', organization_id: 'org_a', name: 'A1' },
      { id: 'b1', organization_id: 'org_b', name: 'B1' },
    ]);
    expect(lines()).toEqual([]);
  });

  it('create: a row WITHOUT its organization still warns (control)', async () => {
    await refused(driver.create('account', { id: 'a1', name: 'A1' }));
    expect(lines('create')).toHaveLength(1);
    expect(lines('create')[0].meta).toMatchObject({ object: 'account', op: 'create', tenantField: 'organization_id' });
  });

  it('create: an empty organization is no organization — it still warns', async () => {
    await driver.create('account', { id: 'a1', organization_id: '', name: 'A1' });
    expect(lines('create')).toHaveLength(1);
  });

  it('create: a null organization is no organization — it still warns', async () => {
    await refused(driver.create('account', { id: 'a1', organization_id: null, name: 'A1' }));
    expect(lines('create')).toHaveLength(1);
  });

  it('bulkCreate: ONE row without its organization keeps the line', async () => {
    await refused(driver.bulkCreate('account', [
      { id: 'a1', organization_id: 'org_a', name: 'A1' },
      { id: 'a2', name: 'A2' },
    ]));
    expect(lines('bulkCreate')).toHaveLength(1);
  });

  it('the prefix is byte-identical', async () => {
    await refused(driver.create('account', { id: 'a1', name: 'A1' }));
    expect(lines()[0].msg.startsWith(
      '[tenant-audit] create on tenant-scoped object "account" without options.tenantId — ',
    )).toBe(true);
  });
});

describe('[ADR-0131 8c-1] what must not move: non-insert writes with no tenantId still warn', () => {
  beforeEach(async () => {
    await driver.create('account', { id: 'a1', organization_id: 'org_a', name: 'A1' }, { tenantId: 'org_a' });
    warns = [];
  });

  it('update, even when its payload names an organization', async () => {
    await driver.update('account', 'a1', { organization_id: 'org_a', name: 'renamed' });
    expect(lines('update')).toHaveLength(1);
  });

  it('delete', async () => {
    await driver.delete('account', 'a1');
    expect(lines('delete')).toHaveLength(1);
  });

  it('updateMany', async () => {
    await driver.updateMany('account', { where: { name: 'A1' } } as any, { organization_id: 'org_a', name: 'x' });
    expect(lines('updateMany')).toHaveLength(1);
  });

  it('deleteMany', async () => {
    await driver.deleteMany('account', { where: { name: 'A1' } } as any);
    expect(lines('deleteMany')).toHaveLength(1);
  });

  it('upsert, even when its row names an organization — the merge leg is an update', async () => {
    await driver.upsert('account', { id: 'a1', organization_id: 'org_a', name: 'merged' });
    expect(lines('upsert')).toHaveLength(1);
  });
});
