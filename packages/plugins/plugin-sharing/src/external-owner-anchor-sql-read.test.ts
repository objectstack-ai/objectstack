// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27425] The SQL-driver half of the pin, over `private` federated objects
 * whose remote rows carry an owner.
 *
 * - The remote column is literally `owner_id` and `fields` do not declare it:
 *   the driver serves it, but the registered field is the platform's injected
 *   anchor and nothing declared says the column exists. Before the fix that
 *   read as "ownership contributes nothing" (`null`), so a member read every
 *   row; now the scope narrows to none.
 * - `external.columnMap` maps the remote owner column onto `owner_id`: the map
 *   is declared metadata, the SQL driver applies it, and the member reads own
 *   rows only, as with a declared field.
 * - `owner_id` declared in `fields`: the control, own rows only.
 *
 * Real `ObjectQL`, real `SqlDriver` on `better-sqlite3`, the real sharing
 * middleware: the registry's injection, the driver's remap and the composed
 * filter are each the shipped code, not a fixture of it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { SharingService } from './sharing-service.js';
import { buildSharingMiddleware } from './sharing-plugin.js';
import { hasPhantomOwnerAnchor } from './federated-phantom-anchors.js';

const MEMBER = 'u_member';
const ADMIN = 'u_admin';

/** The remote table: its owner column is called `assignee`. */
const REMOTE = {
  name: 'remote_rows',
  fields: {
    id: { type: 'text', name: 'id', label: 'Id', primary: true },
    name: { type: 'text', name: 'name', label: 'Name' },
    assignee: { type: 'text', name: 'assignee', label: 'Assignee' },
  },
};

const SHARE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  object_name: { type: 'text', name: 'object_name', label: 'Object' },
  record_id: { type: 'text', name: 'record_id', label: 'Record' },
  recipient_type: { type: 'text', name: 'recipient_type', label: 'Recipient type' },
  recipient_id: { type: 'text', name: 'recipient_id', label: 'Recipient' },
  access_level: { type: 'text', name: 'access_level', label: 'Access' },
};

/** A second remote table whose owner column is literally `owner_id`. */
const REMOTE_OWNED = {
  name: 'remote_owned',
  fields: {
    id: { type: 'text', name: 'id', label: 'Id', primary: true },
    name: { type: 'text', name: 'name', label: 'Name' },
    owner_id: { type: 'text', name: 'owner_id', label: 'Owner' },
  },
};

const binding = { remoteName: REMOTE.name, columnMap: { assignee: 'owner_id' } };

/** Served but undeclared: no map, no field, the registry injects its anchor. */
const SERVED_UNDECLARED = {
  name: 'ext_owned',
  label: 'External owned rows',
  sharingModel: 'private',
  external: { remoteName: REMOTE_OWNED.name },
  fields: { name: { type: 'text', label: 'Name' } },
};

/** `owner_id` undeclared, but the columnMap names the remote owner column. */
const MAPPED = {
  name: 'ext_rows',
  label: 'External rows',
  sharingModel: 'private',
  external: binding,
  fields: { name: { type: 'text', label: 'Name' } },
};

/** The control: `owner_id` declared, the author vouches for the column. */
const DECLARED = {
  name: 'ext_rows_declared',
  label: 'External rows (declared owner)',
  sharingModel: 'private',
  external: binding,
  fields: {
    name: { type: 'text', label: 'Name' },
    owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
  },
};

describe('[#27425] a private SQL federated object whose remote rows carry an owner', () => {
  let driver: SqlDriver;
  let ql: ObjectQL;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    ql = new ObjectQL();
    ql.registerDriver(driver as never, true);
    await ql.init();

    await driver.initObjects([
      REMOTE as never,
      REMOTE_OWNED as never,
      { name: 'sys_record_share', fields: SHARE_FIELDS } as never,
    ]);
    await driver.create(REMOTE.name, { id: 'r_mine', name: 'Mine', assignee: MEMBER });
    await driver.create(REMOTE.name, { id: 'r_theirs', name: 'Theirs', assignee: ADMIN });
    await driver.create(REMOTE_OWNED.name, { id: 'r_mine', name: 'Mine', owner_id: MEMBER });
    await driver.create(REMOTE_OWNED.name, { id: 'r_theirs', name: 'Theirs', owner_id: ADMIN });

    ql.registerObject({ name: 'sys_record_share', label: 'Record share', isSystem: true, fields: SHARE_FIELDS } as never);
    for (const object of [SERVED_UNDECLARED, MAPPED, DECLARED]) {
      ql.registerObject(object as never);
      // What the schema sync does for a federated object: bind it, no DDL.
      driver.registerExternalObject(ql.getSchema(object.name) as never);
    }
    ql.registerMiddleware(buildSharingMiddleware(new SharingService({ engine: ql as never })) as never, { object: '*' });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  const memberReads = async (object: string): Promise<string[]> => {
    const rows = (await ql.find(object, { context: { userId: MEMBER } } as never)) as Array<{ id: string }>;
    return rows.map((r) => r.id).sort();
  };

  it('PREMISE: the driver serves owner_id on all three, and only the unmapped, undeclared one is the injected anchor', async () => {
    for (const object of [SERVED_UNDECLARED.name, MAPPED.name, DECLARED.name]) {
      const served = (await driver.find(object, {} as never)) as Array<Record<string, unknown>>;
      expect(served.map((r) => [r.id, r.owner_id]).sort()).toEqual([
        ['r_mine', MEMBER],
        ['r_theirs', ADMIN],
      ]);
    }
    expect(hasPhantomOwnerAnchor(ql.getSchema(SERVED_UNDECLARED.name))).toBe(true);
    expect(hasPhantomOwnerAnchor(ql.getSchema(MAPPED.name))).toBe(false);
    expect(hasPhantomOwnerAnchor(ql.getSchema(DECLARED.name))).toBe(false);
  });

  it('owner_id served but neither declared nor mapped: the member reads no row (it read 2 of 2 before)', async () => {
    expect(await memberReads(SERVED_UNDECLARED.name)).toEqual([]);
  });

  it('columnMap → owner_id with no declared field: own rows only (it read 2 of 2 before)', async () => {
    expect(await memberReads(MAPPED.name)).toEqual(['r_mine']);
  });

  it('ANTI-VACUITY: owner_id declared over the same table reads own-only', async () => {
    expect(await memberReads(DECLARED.name)).toEqual(['r_mine']);
  });
});
