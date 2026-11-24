// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [latest per group] The remote face compiles its own reads and no window, so
 * a `find` handed the engine's one-row-per-group directive is refused with
 * `INVALID_QUERY` / 400 before a statement goes out — never answered as an
 * ordinary read (every row instead of one per group). The engine refuses this
 * face first (`packages/objectql/src/latest-per.test.ts`); this is the driver's
 * own word for a caller that reaches it directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { LATEST_PER_DIRECTIVE } from '@objectstack/driver-sql';
import { TursoDriver } from './turso-driver.js';

const DEAL = { name: 'deal', fields: { account: { type: 'text' }, close_date: { type: 'date' } } };

async function remoteDriver() {
  const statements: string[] = [];
  const record = (stmt: any) => {
    statements.push(String(stmt?.sql ?? stmt));
    return { rows: [], columns: [], rowsAffected: 0 };
  };
  const client = {
    execute: vi.fn(async (stmt: any) => record(stmt)),
    batch: vi.fn(async (stmts: any[]) => stmts.map(record)),
    close: vi.fn(),
  };
  const driver = new TursoDriver({ url: 'libsql://latest-per.turso.io', client: client as never });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  await driver.syncSchema(DEAL.name, DEAL);
  statements.length = 0;
  return { driver, statements };
}

describe('[latest per group] driver-turso remote face', () => {
  it('refuses the directive with INVALID_QUERY / 400 and sends no statement', async () => {
    const { driver, statements } = await remoteDriver();
    const query = {
      [LATEST_PER_DIRECTIVE]: { by: ['account'], orderBy: [{ field: 'close_date', order: 'desc' }] },
    } as never;
    const err: any = await driver.find('deal', query).then(() => null, (e: unknown) => e);
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_QUERY', status: 400 });
    expect(statements).toEqual([]);
  });

  it('control: the same read without the directive goes out', async () => {
    const { driver, statements } = await remoteDriver();
    await driver.find('deal', {} as never);
    expect(statements.some((s) => /select/i.test(s))).toBe(true);
  });
});
