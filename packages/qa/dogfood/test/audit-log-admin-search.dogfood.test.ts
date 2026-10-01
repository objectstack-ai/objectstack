// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21154] The stock admin's free-text search over the compliance ledger — the
// Setup audit-log list's search — and over the activity stream answers as
// before, on a stock showcase boot, with no parent object named.
//
// ## Why this file exists
//
// The query guard over those objects' value-bearing columns refuses a query
// that names no parent object unless the reader is served every field those
// rows can carry, on every object the writers can record. Both objects'
// searched sets include those columns, so an unpinned search is exactly such a
// query. The stock admin of the stock app is served every field of every
// object, so its search is admitted; this file holds that on the real
// composition — the showcase's own objects and permission sets, the seeded
// admin, the real security plugin — rather than on a fixture built to admit it.
//
// ## The composition
//
// `bootStack(showcase)` with `AuditPlugin` and the approvals plugin, the two a
// served deployment mounts beside it. Nothing is authored: the ledger and the
// activity rows are the ones the boot's own writes produced.
//
// `@objectstack/plugin-audit` resolves through its BUILT output here (a
// ledgered pair in `scripts/check-test-source-alias.mjs`), so a verdict on a
// change to it is a verdict on its last build. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { assertArmed, armedWhen } from './armed.js';

const SYS = { context: { isSystem: true } } as const;
/** Synthetic: matches nothing the stock boot writes. */
const NOMATCH = 'ALSNOMATCH91';

type Row = Record<string, any>;
interface Answer { status: number; rows: number; text: string }

describe('[#21154] the stock admin searches the ledger and the activity stream with no parent named', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken = '';
  /** A term each table's own rows contain, read at rest under the system context. */
  const term: Record<'sys_audit_log' | 'sys_activity', string> = { sys_audit_log: '', sys_activity: '' };

  const list = async (path: string): Promise<Answer> => {
    const res = await stack.apiAs(adminToken, 'GET', path);
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    const rows = json?.records ?? json?.data;
    return { status: res.status, rows: Array.isArray(rows) ? rows.length : 0, text };
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack as unknown as Parameters<typeof bootStack>[0], {
      extraPlugins: [new AuditPlugin(), new ApprovalsServicePlugin()],
    });
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    for (const table of Object.keys(term) as Array<keyof typeof term>) {
      const rows: Row[] = await ql.find(table, { limit: 1, context: SYS.context });
      term[table] = String(rows[0]?.object_name ?? '');
    }

    await assertArmed([
      armedWhen({
        control: 'the boot wrote ledger and activity rows, and each carries a term its own search can match',
        disarmedBy: 'an empty table would answer every search with no rows, and an answered search would prove nothing',
        observe: async () => ({ ledger: term.sys_audit_log, activity: term.sys_activity }),
        armed: (o) => o.ledger.length > 0 && o.activity.length > 0,
        describe: (o) => JSON.stringify({ ledger: o.ledger.length > 0, activity: o.activity.length > 0 }),
      }),
    ]);
  }, 300_000);

  afterAll(async () => {
    if (stack) await stack.stop();
  });

  it('the ledger list search answers the stock admin as before, matching and not', async () => {
    const hit = await list(`/data/sys_audit_log?$search=${encodeURIComponent(term.sys_audit_log)}`);
    expect(hit.status, hit.text).toBe(200);
    expect(hit.rows).toBeGreaterThan(0);
    const miss = await list(`/data/sys_audit_log?$search=${NOMATCH}`);
    expect(miss.status, miss.text).toBe(200);
    expect(miss.rows).toBe(0);
  });

  it('the activity stream search answers the stock admin as before, matching and not', async () => {
    const hit = await list(`/data/sys_activity?$search=${encodeURIComponent(term.sys_activity)}`);
    expect(hit.status, hit.text).toBe(200);
    expect(hit.rows).toBeGreaterThan(0);
    const miss = await list(`/data/sys_activity?$search=${NOMATCH}`);
    expect(miss.status, miss.text).toBe(200);
    expect(miss.rows).toBe(0);
  });

  it('a filter over the approval snapshot with no subject named answers the stock admin as before', async () => {
    const filter = encodeURIComponent(JSON.stringify({ payload_json: { $contains: NOMATCH } }));
    const answer = await list(`/data/sys_approval_request?$filter=${filter}`);
    expect(answer.status, answer.text).toBe(200);
    expect(answer.rows).toBe(0);
  });
});
