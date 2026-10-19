// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24120] The two pieces of `bootSchemaStack`'s `composeDeclaredDatasources`
 * that decide something on their own, pinned without a database (the
 * end-to-end pin — `os migrate plan`'s drift set equal to `os dev`'s on a
 * `datasourceMapping`-default datasource — is
 * `commands/migrate/plan.declared-default-datasource.integration.test.ts`):
 *
 *  - `DeclaredDatasourceConnectionPlugin` publishes the `datasource-connection`
 *    service `AppPlugin` connects declared datasources through, and that
 *    service connects a MANAGED datasource and refuses one whose schema the
 *    remote owns — a dry run opens no connection a migration has no table on;
 *  - `distinctDatabaseDrivers` keeps one planned driver per database, so the
 *    unmanaged-table sweep reads the primary and the declared default it was
 *    resolved from — two connections to one file — once.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  DeclaredDatasourceConnectionPlugin,
  distinctDatabaseDrivers,
  type SqlDriverLike,
} from './schema-migrate.js';

/** The service `init()` published, from a context that records registrations. */
async function publishedService(): Promise<{ connect: (record: unknown, opts?: unknown) => Promise<{ status: string }> }> {
  const services = new Map<string, unknown>();
  const ctx = {
    registerService: (name: string, service: unknown) => { services.set(name, service); },
    // No engine: a connect the policy admits stops at "no infrastructure", which
    // is the observable difference from one the policy refuses.
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`no ${name}`);
      return services.get(name);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  await new DeclaredDatasourceConnectionPlugin().init(ctx);
  expect([...services.keys()]).toEqual(['datasource-connection']);
  return services.get('datasource-connection') as never;
}

describe('DeclaredDatasourceConnectionPlugin', () => {
  it('declares the service it publishes', () => {
    expect(new DeclaredDatasourceConnectionPlugin().providesServices).toEqual(['datasource-connection']);
  });

  it.each([
    ['managed (declared)', 'managed', 'skipped-no-infra'],
    ['managed (the default)', undefined, 'skipped-no-infra'],
    ['external', 'external', 'skipped-policy'],
    ['validate-only', 'validate-only', 'skipped-policy'],
  ] as const)('a %s datasource (schemaMode %s) -> %s', async (_label, schemaMode, status) => {
    const service = await publishedService();
    const result = await service.connect(
      { name: 'qa_main', driver: 'sqlite', config: { filename: ':memory:' }, ...(schemaMode ? { schemaMode } : {}) },
      { context: { origin: 'code', trigger: 'declared-auto' } },
    );
    expect(result.status).toBe(status);
  });
});

/** A planned driver with nothing but the config the identity is read from. */
function driver(config: unknown): SqlDriverLike {
  return { config } as SqlDriverLike;
}

describe('distinctDatabaseDrivers', () => {
  it('folds a SQLite file named twice — absolute and relative, flat and knex-shaped — into its first driver', () => {
    const primary = driver({ client: 'better-sqlite3', connection: { filename: resolve('fx-24120', 'main.db') } });
    const declared = driver({ filename: './fx-24120/main.db' });
    const sibling = driver({ client: 'better-sqlite3', connection: { filename: resolve('fx-24120', 'telemetry.db') } });
    expect(distinctDatabaseDrivers([primary, sibling, declared])).toEqual([primary, sibling]);
  });

  it('never folds an in-memory database: each connection is its own', () => {
    const a = driver({ client: 'better-sqlite3', connection: { filename: ':memory:' } });
    const b = driver({ filename: ':memory:' });
    expect(distinctDatabaseDrivers([a, b])).toEqual([a, b]);
  });

  it('folds a server database by the connection it describes, and only that', () => {
    const a = driver({ client: 'pg', connection: 'postgres://app@db.example:5432/main' });
    const b = driver({ client: 'pg', connection: 'postgres://app@db.example:5432/main' });
    const c = driver({ client: 'pg', connection: 'postgres://app@db.example:5432/other' });
    expect(distinctDatabaseDrivers([a, b, c])).toEqual([a, c]);
  });
});
