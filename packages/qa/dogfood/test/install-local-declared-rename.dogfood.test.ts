// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — a field's declared `renamedFrom` carries the old
// column's values to the new key when the package upgrades through the
// install-local door, on a real boot over a SQLite file (epic cloud#3652 D3
// 「写进清单 renamedFrom」, #30885).
//
// ## What was measured before the fix
//
// v1 (`dfr_lead.company`, three rows) installed; v2 declaring
// `account_name: { renamedFrom: ['company'] }` answered
// `501 NOT_IMPLEMENTED` (#30884's interim refusal) — and, with that refusal
// lifted alone, the additive schema sync would have added `account_name` as a
// new, empty column beside `company`, the values left behind.
//
// ## What this file pins
//
//   1. the upgrade answers 200 and names the carry (`renamesCarried`);
//   2. `account_name` holds the three rows' values, `company` is gone from the
//      table, and the row count is unchanged;
//   3. a cold boot over the same database file and ledger (the boot sync on
//      the new artifact) serves the same rows and changes nothing: the second
//      sync finds `account_name` and no `company`.
//
// Boots its own showcase (a database file, a ledger directory), so it stays
// out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as ExecutionContext;
const ROUTE = '/marketplace/install-local';
const PACKAGE_ID = 'com.dogfood.declrename';
const OBJECT = 'dfr_lead';

const body = (version: string, fields: Record<string, unknown>) => ({
  manifest: {
    id: PACKAGE_ID,
    namespace: 'dfr',
    name: 'Declared rename probe',
    version,
    type: 'app',
    objects: [{ name: OBJECT, label: 'Lead', fields: { ...fields, score: { type: 'number' } } }],
  },
});
const V1 = body('1.0.0', { company: { type: 'text' } });
const V2 = body('2.0.0', { account_name: { type: 'text', renamedFrom: ['company'] } });

type Answer = { status: number; body: any };
type Engine = {
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
  find(object: string, query?: unknown, options?: unknown): Promise<unknown>;
  getDriverForObject(name: string): { listPhysicalColumns(object: string): Promise<string[]> } | undefined;
};

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

async function read(stack: VerifyStack): Promise<{ columns: string[]; rows: any[] }> {
  const ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
  const columns = (await ql.getDriverForObject(OBJECT)!.listPhysicalColumns(OBJECT)).sort();
  const rows = rowsOf(await ql.find(OBJECT, { orderBy: [{ field: 'score', order: 'asc' }] }, { context: SYS }));
  return { columns, rows };
}

describe('dogfood: install-local carries a declared rename\'s values, and a boot after it changes nothing', () => {
  let tempDir: string;
  let v1: Answer;
  let v2: Answer;
  let carried: { columns: string[]; rows: any[] };
  let rebooted: { columns: string[]; rows: any[] };

  const boot = (storageDir: string, databaseFile: string) => bootShowcase({
    databaseFile,
    extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
  });

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dogfood-declared-rename-'));
    const storageDir = join(tempDir, 'ledger');
    const databaseFile = join(tempDir, 'showcase.db');

    const first = await boot(storageDir, databaseFile);
    try {
      const token = await first.signIn();
      const post = async (b: unknown): Promise<Answer> => {
        const res = await first.apiAs(token, 'POST', ROUTE, b);
        return { status: res.status, body: await res.json().catch(() => null) };
      };
      v1 = await post(V1);
      const ql = (await first.kernel.getServiceAsync('objectql')) as unknown as Engine;
      for (const [i, company] of ['Acme', 'Globex', 'Initech'].entries()) {
        await ql.insert(OBJECT, { company, score: i }, { context: SYS });
      }
      v2 = await post(V2);
      carried = await read(first);
    } finally {
      await first.stop();
    }

    const second = await boot(storageDir, databaseFile);
    try {
      rebooted = await read(second);
    } finally {
      await second.stop();
    }
  }, 300_000);

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('v1 installs (precondition)', () => {
    expect(v1.status, JSON.stringify(v1.body)).toBe(200);
  });

  it('v2 answers 200 and names the carried rename', () => {
    expect(v2.status, JSON.stringify(v2.body)).toBe(200);
    expect(v2.body.data.renamesCarried).toEqual([
      expect.objectContaining({ object: OBJECT, from: 'company', to: 'account_name' }),
    ]);
  });

  it('account_name holds the rows, company is gone, the count is unchanged', () => {
    expect(carried.columns).toContain('account_name');
    expect(carried.columns).not.toContain('company');
    expect(carried.rows.map((r) => r.account_name)).toEqual(['Acme', 'Globex', 'Initech']);
  });

  it('a boot over the same database and ledger serves the same rows and changes nothing', () => {
    expect(rebooted.columns).toEqual(carried.columns);
    expect(rebooted.rows.map((r) => r.account_name)).toEqual(['Acme', 'Globex', 'Initech']);
  });
});
