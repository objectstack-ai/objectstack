// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21197] The compliance ledger carries no `internal` field, through the
// public doors, on a real boot — ruling record 5942811916 (C2).
//
// The ledger's CRUD mirror omits fields declared `internal: true` from both
// snapshot sides, so a ledger row about a record of such an object carries
// none of them — at rest, and therefore for every reader. The admin, who is
// served every field the ledger holds, is the reader asserted here: if the
// admin is served none, no narrower reader is.
//
// Two credential classes, minted through their own real doors:
//   - an API key (`POST /keys`) — its stored digest is the column the ledger's
//     by-id door used to serve the admin;
//   - a password-protected share link (`POST /share-links`) — its capability
//     token and password hash.
// A non-credential column of each row is the control, so "nothing recorded"
// cannot pass for "nothing leaked".
//
// `@objectstack/plugin-audit` resolves through its BUILT output here (a
// ledgered pair in `scripts/check-test-source-alias.mjs`), so a verdict on a
// change to it is a verdict on its last build. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;
const LEDGER = 'sys_audit_log';
const PUBLISHED_BRIEF = 'Northwind — Website Relaunch brief';

type Row = Record<string, any>;
const recordOf = (b: any): Row => b?.record ?? b?.data ?? b;
const rowsOf = (b: any): Row[] => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);
const snapshot = (v: unknown): Row => (v == null ? {} : typeof v === 'string' ? JSON.parse(v) : (v as Row));

describe('[#21197] ledger rows about internal-declared objects carry none of those fields, for the admin', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  const cases: Array<{ object: string; recordId: string; internal: string[]; control: string; controlValue: unknown; secrets: string[] }> = [];

  const ledgerAtRest = (object: string, recordId: string): Promise<Row[]> =>
    ql.find(LEDGER, { where: { object_name: object, record_id: recordId }, context: { ...SYS } });

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      security: showcaseAppDefaultSecurity(),
      extraPlugins: [new AuditPlugin()],
    });
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    // An API key, through its one mint path. The show-once secret is never
    // written anywhere; the ledger is judged on the stored digest.
    const keyName = `ledger-internal-${Date.now()}`;
    const minted = await stack.apiAs(adminTok, 'POST', '/keys', { name: keyName });
    expect(minted.status, await minted.clone().text()).toBe(201);
    const keyId = String(((await minted.json()) as any)?.data?.id);
    const [keyRow] = await ql.getDriver('sys_api_key').find('sys_api_key', { where: { id: keyId } });
    expect(keyRow?.key, 'the digest is stored').toBeTruthy();
    cases.push({ object: 'sys_api_key', recordId: keyId, internal: ['key'], control: 'name', controlValue: keyName, secrets: [String(keyRow.key)] });

    // A password-protected share link on a record whose object opts in.
    const briefId = String((await ql.findOne('showcase_client_brief', { where: { title: PUBLISHED_BRIEF }, context: SYS }))?.id ?? '');
    expect(briefId, 'the seeded published brief').toBeTruthy();
    const shared = await stack.apiAs(adminTok, 'POST', '/share-links', {
      object: 'showcase_client_brief',
      recordId: briefId,
      password: 'ledger-internal-21197',
    });
    expect(shared.status, await shared.clone().text()).toBe(201);
    const linkId = String(((await shared.json()) as any)?.data?.id);
    const [linkRow] = await ql.getDriver('sys_share_link').find('sys_share_link', { where: { id: linkId } });
    expect(linkRow?.token && linkRow?.password_hash, 'token and hash are stored').toBeTruthy();
    cases.push({
      object: 'sys_share_link', recordId: linkId, internal: ['token', 'password_hash'],
      control: 'object_name', controlValue: 'showcase_client_brief', secrets: [String(linkRow.token), String(linkRow.password_hash)],
    });

    for (const c of cases) {
      const rows = await ledgerAtRest(c.object, c.recordId);
      expect(rows.filter((r) => r.action === 'create'), `${c.object}: the mirror wrote its create row`).toHaveLength(1);
    }
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('at rest: the create row records the control column and none of the internal ones', async () => {
    for (const c of cases) {
      const [create] = (await ledgerAtRest(c.object, c.recordId)).filter((r) => r.action === 'create');
      const after = snapshot(create.new_value);
      expect(after[c.control], `${c.object}: control`).toEqual(c.controlValue);
      for (const field of c.internal) expect(after, `${c.object}.${field}`).not.toHaveProperty(field);
      const text = JSON.stringify(create);
      for (const secret of c.secrets) expect(text.includes(secret), `${c.object}: no stored credential value at rest`).toBe(false);
    }
  });

  it('by id: the admin is served the row, with the control column and none of the internal ones', async () => {
    for (const c of cases) {
      const [create] = (await ledgerAtRest(c.object, c.recordId)).filter((r) => r.action === 'create');
      const res = await stack.apiAs(adminTok, 'GET', `/data/${LEDGER}/${create.id}`);
      expect(res.status, `${c.object}: by-id door`).toBe(200);
      const served = recordOf(await res.json());
      const after = snapshot(served.new_value);
      expect(after[c.control], `${c.object}: control served`).toEqual(c.controlValue);
      for (const field of c.internal) expect(after, `${c.object}.${field} served by id`).not.toHaveProperty(field);
      for (const secret of c.secrets) expect(JSON.stringify(served).includes(secret)).toBe(false);
    }
  });

  it('list: the admin is served the rows, with none of the internal fields', async () => {
    for (const c of cases) {
      const res = await stack.apiAs(adminTok, 'POST', `/data/${LEDGER}/query`, {
        where: { object_name: c.object, record_id: c.recordId },
      });
      expect(res.status, `${c.object}: query door`).toBe(200);
      const rows = rowsOf(await res.json());
      expect(rows.length, `${c.object}: rows served`).toBeGreaterThan(0);
      for (const row of rows) {
        for (const side of ['old_value', 'new_value']) {
          const s = snapshot(row[side]);
          for (const field of c.internal) expect(s, `${c.object}.${field} on ${side}`).not.toHaveProperty(field);
        }
        for (const secret of c.secrets) expect(JSON.stringify(row).includes(secret)).toBe(false);
      }
    }
  });
});
