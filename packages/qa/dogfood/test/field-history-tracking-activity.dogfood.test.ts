// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.field-history-tracking` (#26573): its api
// clauses at the REST doors of the booted showcase, as shipped.
// `showcase_account` declares `enable.trackHistory: true` and per-field
// `trackHistory` on `industry` and `status` (labels Industry / Lifecycle);
// `website` is untracked. `showcase_task` declares per-field trackHistory and
// NO object-level opt-in — the natural negative for the derived operation.
//
//   acceptance[0], negative[2] — a tracked edit made through
//     `PATCH /data/showcase_account/:id` lands its sys_activity row with the
//     ADR-0052 §5b summary in DISPLAY values: the field label and the option
//     labels ('Industry: Retail → Finance'), never the raw option values.
//   acceptance[1], negative[0] — a website-only edit lands no old → new diff:
//     the row carries the #25787 generic frame, which names the changed
//     field's LABEL and never its values.
//   acceptance[3] — the derived `history` operation follows get ∧
//     enable.trackHistory: present in showcase_account's effective operation
//     vocabulary and absent from showcase_task's, read off
//     `GET /auth/me/permissions`.
//
// The plugin-audit unit pins drive the summary renderer below the data door
// (RUNNER rule 6). The History-tab clauses (acceptance[2], negative[1]) stay
// browser legs; acceptance[4] stays the unit pin's (no showcase object tracks
// a reference field).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { AuditPlugin } from '@objectstack/plugin-audit';

const SYS = { context: { isSystem: true } } as const;
const ACCOUNT = 'showcase_account';

describe('records-forms.field-history-tracking — the activity summary and the derived op over REST', () => {
  let stack: VerifyStack;
  let ql: any;
  let token = '';

  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  /** The account's activity rows, newest last — written by plugin-audit's CRUD mirror, which may settle a tick later. */
  const activityOf = async (recordId: string, atLeast: number): Promise<any[]> => {
    for (let i = 0; i < 40; i++) {
      const rows = await ql.find('sys_activity', { where: { object_name: ACCOUNT, record_id: recordId } }, SYS);
      if (rows.length >= atLeast) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return ql.find('sys_activity', { where: { object_name: ACCOUNT, record_id: recordId } }, SYS);
  };
  const createAccount = async (): Promise<{ id: string; name: string; baseline: number }> => {
    const name = uniq('fht');
    const res = await stack.apiAs(token, 'POST', `/data/${ACCOUNT}`, {
      name, industry: 'retail', status: 'active', website: 'https://before.example',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const [row] = await stack.rows(ACCOUNT, { name });
    const id = String(row.id);
    return { id, name, baseline: (await activityOf(id, 1)).length };
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await stack.apiAs(token, 'PATCH', `/data/${ACCOUNT}/${id}`, body);
    expect(res.status, await res.clone().text()).toBe(200);
  };

  beforeAll(async () => {
    // The showcase boot composes no audit plugin of its own; `objectstack serve` does.
    stack = await bootShowcase({ extraPlugins: [new AuditPlugin()] });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[0], negative[2]: a tracked edit lands the old → new summary in labels, never raw values', async () => {
    const { id, baseline } = await createAccount();
    await patch(id, { industry: 'finance' });
    const rows = await activityOf(id, baseline + 1);
    expect(rows.length, JSON.stringify(rows)).toBe(baseline + 1);
    const row = rows[rows.length - 1];
    expect(row.summary, JSON.stringify(row)).toBe('Industry: Retail → Finance');
    expect(JSON.parse(row.metadata).summary_message.key).toBe('fieldChanges');
    expect(row.changed_fields).toEqual(['industry']);
  });

  it('acceptance[1], negative[0]: a website-only edit lands the generic frame, never an old → new diff', async () => {
    const { id, name, baseline } = await createAccount();
    await patch(id, { website: 'https://after.example' });
    const rows = await activityOf(id, baseline + 1);
    expect(rows.length, JSON.stringify(rows)).toBe(baseline + 1);
    const row = rows[rows.length - 1];
    // The #25787 generic update summary names WHICH field changed (its label),
    // never its values: no arrow, neither URL.
    expect(row.summary, JSON.stringify(row)).toBe(`Updated Account (Success Overlay) "${name}": Website`);
    expect(row.summary).not.toContain('→');
    expect(row.summary).not.toContain('before.example');
    expect(row.summary).not.toContain('after.example');
    expect(JSON.parse(row.metadata).summary_message.key).toBe('activityUpdatedFields');
  });

  it('acceptance[3]: the derived history operation is offered on showcase_account and not on showcase_task', async () => {
    const res = await stack.apiAs(token, 'GET', '/auth/me/permissions');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const opsOf = (object: string): string[] => body.objects?.[object]?.apiOperations;
    expect(opsOf(ACCOUNT), 'showcase_account declares enable.trackHistory').toContain('history');
    expect(opsOf('showcase_task'), 'showcase_task has per-field flags only').not.toContain('history');
    expect(opsOf('showcase_task'), 'the control: the task is readable').toContain('get');
  });
});
