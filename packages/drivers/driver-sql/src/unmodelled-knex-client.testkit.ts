// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A knex client this driver does NOT model — the `'unknown'` dialect, built
 * without a server or a database binding.
 *
 * Suites that pin what the driver does on a dialect it does not model used to
 * borrow `mssql` for this (knex resolves `tedious` from the workspace, so the
 * client builds offline). #31327 made `mssql` a modelled, federation-only
 * dialect, so the borrowed stand-in would now test SQL Server instead of the
 * unmodelled arm. This one cannot be modelled by accident: it is knex's own
 * base `Client` (the generic ANSI compiler), passed as a CONSTRUCTOR, so
 * `config.client` carries no spelling any of the driver's client tables can
 * ever contain.
 *
 * Test-only: not exported from `index.ts`.
 */

import knexPkg from 'knex';
import type { SqlDriverConfig } from './sql-driver.js';

const BaseClient = (knexPkg as unknown as { Client: new (config: unknown) => object }).Client;

/** knex's base client, given a dialect name no table in this driver spells and a no-op binding. */
export class UnmodelledKnexClient extends BaseClient {}
Object.assign(UnmodelledKnexClient.prototype, {
  dialect: 'os-unmodelled',
  driverName: 'os-unmodelled',
  _driver: () => ({}),
});

/** A driver config whose dialect this driver reads as `'unknown'`. */
export const UNMODELLED_CLIENT_CONFIG = {
  client: UnmodelledKnexClient,
  connection: {},
} as unknown as SqlDriverConfig;
