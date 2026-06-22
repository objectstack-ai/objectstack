// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { SqlDriver } from '@objectstack/driver-sql';

/**
 * Fixture provisioning for the external-datasource federation demo
 * (ADR-0015 / ADR-0062).
 *
 * This is the "remote database" stand-in: it idempotently creates the separate
 * SQLite file with `customers` / `orders` tables + a little seed data (a MANAGED
 * driver — DDL allowed) so `os dev` needs no external server. It runs from the
 * stack's `onEnable` hook at boot.
 *
 * **It no longer registers a driver or syncs object schemas (ADR-0062 D8).** The
 * declared `external` datasource (see `showcase-external.datasource.ts`) now
 * AUTO-CONNECTS: at boot the runtime's `DatasourceConnectionService` builds the
 * read-only `schemaMode:'external'` driver, registers it under the datasource
 * name, and registers the federated objects' read metadata — with zero app code.
 * The old `onEnable` + `ctx.drivers.register` bridge is gone; `onEnable` +
 * `ctx.drivers.register` remains *supported* only as an advanced escape hatch
 * (drivers built dynamically at runtime).
 */

// Same relative path as the datasource config — resolved against the project
// cwd by better-sqlite3. `connect()` creates the parent dir if missing.
const EXTERNAL_DB_FILE = '.objectstack/data/showcase_external.db';

const CUSTOMER_TABLE = {
  name: 'customers',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    email: { type: 'text' },
    region: { type: 'text' },
    lifetime_value: { type: 'number' },
  },
};

const ORDER_TABLE = {
  name: 'orders',
  fields: {
    id: { type: 'text' },
    customer_id: { type: 'text' },
    amount: { type: 'number' },
    status: { type: 'text' },
    placed_on: { type: 'date' },
  },
};

const CUSTOMER_ROWS = [
  { id: 'c1', name: 'Aurora Labs', email: 'ap@aurora.example', region: 'NA', lifetime_value: 480000 },
  { id: 'c2', name: 'Borealis GmbH', email: 'billing@borealis.example', region: 'EU', lifetime_value: 312000 },
  { id: 'c3', name: 'Cyan Pacific', email: 'accounts@cyan.example', region: 'APAC', lifetime_value: 95000 },
];

const ORDER_ROWS = [
  { id: 'o1', customer_id: 'c1', amount: 12000, status: 'paid', placed_on: '2026-01-12' },
  { id: 'o2', customer_id: 'c1', amount: 8400, status: 'paid', placed_on: '2026-02-03' },
  { id: 'o3', customer_id: 'c2', amount: 21500, status: 'pending', placed_on: '2026-02-20' },
  { id: 'o4', customer_id: 'c3', amount: 3300, status: 'paid', placed_on: '2026-03-01' },
];

/** Stack `onEnable` payload (subset we use — provisioning only logs). */
interface OnEnableContext {
  logger?: { info?: (msg: string, meta?: unknown) => void; warn?: (msg: string, meta?: unknown) => void };
}

/**
 * Provision the "remote" fixture database. Idempotent: creates the tables and
 * seeds them only when empty. Does NOT register a driver — the declared external
 * datasource auto-connects at boot (ADR-0062 D1/D8).
 */
export async function setupShowcaseExternalDatasource(ctx: OnEnableContext): Promise<void> {
  const fixture = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: EXTERNAL_DB_FILE },
    useNullAsDefault: true,
  }) as unknown as {
    name: string;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    initObjects: (objs: unknown[]) => Promise<void>;
    count: (object: string, query: unknown) => Promise<number>;
    bulkCreate: (object: string, rows: unknown[]) => Promise<unknown>;
  };
  fixture.name = 'showcase_external_fixture';
  await fixture.connect();
  try {
    await fixture.initObjects([CUSTOMER_TABLE, ORDER_TABLE]);
    if ((await fixture.count('customers', {})) === 0) {
      await fixture.bulkCreate('customers', CUSTOMER_ROWS);
      await fixture.bulkCreate('orders', ORDER_ROWS);
    }
  } finally {
    await fixture.disconnect();
  }

  ctx.logger?.info?.(
    '[showcase] external fixture provisioned — datasource "showcase_external" auto-connects (ADR-0062)',
  );
}
