// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14176 — the primary datasource's knex pool had no operator-facing size.
//
// What the reporter measured (a live 3-replica EE cluster, Postgres 16 with
// `max_connections=200`, 2026-09-01) and what this file does NOT re-measure:
// authed data throughput plateaued at ~25 rps while Postgres held ~9-21 of its
// 200 connections, i.e. the ceiling was the client pool, not the server. Those
// are the REPORTER'S numbers. No test here reproduces them — there is no
// cluster and no live database in this suite, and a fabricated local rerun
// would be evidence of nothing. What is pinnable here is the MECHANISM the
// throughput number rests on: which pool size actually reaches knex.
//
// The card blamed `SqlDriver.withConnectBound` for setting no pool size. That
// is falsified for this path and the pins below say why: the CLI composes the
// primary datasource as `config: { url, ...autoMigrate }` with no `pool` block
// (`packages/cli/src/utils/storage-driver.ts`, the `postgres` arm), so
// `buildSqlPool` — not knex's own `{min:2,max:10}` default, and not the driver
// — decides the size, and it decided `{min:0,max:5}` for every deployment.
// An env read in the driver would have been dead code behind that explicit
// object. Maintainer ruling 2026-09-02 (「同意」, option A): read one variable,
// `OS_DATABASE_POOL_MAX`, in `buildSqlPool`, precedence declared `pool` > env >
// `{min:0,max:5}`.
//
// ⚠️ The first pin below is the load-bearing one. An unset env is the upgrade
// path for every existing deployment, so "unset means exactly what it meant
// before" is the whole safety argument for this change; if it ever goes red,
// the change is silently altering production connection counts on upgrade.

import { describe, it, expect, afterEach } from 'vitest';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

const POOL_MAX_ENV = 'OS_DATABASE_POOL_MAX';

/** The knex config a constructed SqlDriver was built from (as the sibling suite reads it). */
function knexConfigOf(driver: any): any {
  return driver?.config ?? driver?.knexConfig ?? driver?.options ?? {};
}

/**
 * Build a datasource the way the CLI composes the PRIMARY one — a url and
 * nothing else, in particular no `pool` block — and return its knex pool.
 * Never connects: `create` constructs the driver, and the pool is read off the
 * config it was built from.
 */
async function primaryPool(
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const handle: any = await factory().create({
    driver: 'postgres',
    config: { url: 'postgres://app@db.internal:5432/app' },
    ...extra,
  });
  try {
    return knexConfigOf(handle.driver ?? handle).pool;
  } finally {
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  }
}

function setEnv(value: string | undefined): void {
  if (value === undefined) delete process.env[POOL_MAX_ENV];
  else process.env[POOL_MAX_ENV] = value;
}

afterEach(() => { delete process.env[POOL_MAX_ENV]; });

describe('OS_DATABASE_POOL_MAX — the primary datasource pool ceiling (#14176)', () => {
  // ⭐ THE DEFAULT-PRESERVATION PIN. Do not relax this one.
  it('with the env UNSET, the pool is byte-identical to the pre-change default', async () => {
    setEnv(undefined);
    expect(await primaryPool()).toEqual({ min: 0, max: 5 });
  });

  it('reads a blank value as unset rather than as garbage', async () => {
    // `OS_DATABASE_POOL_MAX=` in a compose file is a declared-but-unfilled
    // variable asking for today's behaviour, not a misconfiguration.
    setEnv('');
    expect(await primaryPool()).toEqual({ min: 0, max: 5 });
    setEnv('   ');
    expect(await primaryPool()).toEqual({ min: 0, max: 5 });
  });

  it('raises the ceiling the operator asked for, leaving the floor alone', async () => {
    setEnv('40');
    // The floor stays 0 — `OS_DATABASE_POOL_MIN` is deliberately NOT exposed
    // (ruling 2026-09-02: today's path runs `min: 0`; a later patch if needed).
    expect(await primaryPool()).toEqual({ min: 0, max: 40 });
  });

  it("a datasource's own declared pool outranks the operator env", async () => {
    setEnv('40');
    const pool = await primaryPool({ pool: { min: 2, max: 9 } });
    expect(pool).toMatchObject({ min: 2, max: 9 });
  });

  it('refuses a non-integer value loudly instead of silently keeping the default', async () => {
    // The failure this rejects is the lenient `Number(process.env.X ?? d)`
    // shape: a typo becomes NaN, knex gets an unsizable pool, and the operator
    // who was TRYING to raise the ceiling silently keeps the one they wanted
    // to leave. A pool ceiling is only ever measured in production.
    for (const bad of ['abc', '10.5', '-4', '0', '1e3', '0x10', '10 20']) {
      setEnv(bad);
      await expect(
        factory().create({ driver: 'postgres', config: { url: 'postgres://app@db.internal:5432/app' } }),
      ).rejects.toThrow(/OS_DATABASE_POOL_MAX must be a positive integer/);
    }
  });

  it('names the variable, the value it rejected and the sizing rule in the refusal', async () => {
    setEnv('lots');
    await expect(
      factory().create({ driver: 'postgres', config: { url: 'postgres://app@db.internal:5432/app' } }),
    ).rejects.toThrow(/got "lots"[\s\S]*max_connections/);
  });

  it('applies to the mysql arm on the same terms', async () => {
    setEnv('12');
    const handle: any = await factory().create({
      driver: 'mysql',
      config: { url: 'mysql://app@db.internal:3306/app' },
    });
    try {
      expect(knexConfigOf(handle.driver ?? handle).pool).toEqual({ min: 0, max: 12 });
    } finally {
      try { await handle.disconnect?.(); } catch { /* pool never opened */ }
    }
  });

  // ⛔ The guard for the constraint this change must not breach. `sqlite` /
  // `sqlite-wasm` / `memory` / `turso` REJECT a declared `pool` outright under
  // three maintainer rulings (#5714 / #5931 / #7243), and knex's better-sqlite3
  // dialect pins `{min:1,max:1}` on purpose — two connections to `:memory:` are
  // two separate databases. The env is read inside `buildSqlPool`, which only
  // the `postgres` / `mysql` arms call, so those arms structurally cannot see
  // it. This pin is what makes "structurally" a measurement.
  it('does not leak a pool onto an arm that refuses to be pooled', async () => {
    setEnv('40');
    const handle: any = await factory().create({ driver: 'sqlite', config: { filename: ':memory:' } });
    try {
      const cfg = knexConfigOf(handle.driver ?? handle);
      expect(cfg.pool?.max).not.toBe(40);
    } finally {
      try { await handle.disconnect?.(); } catch { /* pool never opened */ }
    }
  });
});
