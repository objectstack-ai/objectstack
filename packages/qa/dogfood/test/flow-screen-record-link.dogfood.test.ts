// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLOW SCREEN RECORD LINK (#25872, contract half #26304) — a screen flow that
// creates records ends on a result screen that links them. Driven end to end
// through a REAL boot: the real trigger and resume doors, real writes, and the
// record read back through the data door the console's record page reads.
//
// The chain, each link asserted where it lands rather than as "no error":
//
//   • the run writes an account and a contact, then pauses on the result
//     screen. Each of its two fields arrives typed `record_link`, naming its
//     object (`reference`) and carrying the id of the record THIS run created
//     (`defaultValue`, evaluated before the screen went on the wire), with no
//     `required` to meet;
//   • each id is a record of that object, readable through the data door, and
//     its display name (the object's `nameField`, ADR-0079) is the name the
//     author typed — what the console draws as the link text, linking to that
//     object's record page;
//   • a resume carrying a value under a link field's name is refused 400
//     `INVALID_SCREEN_INPUT` naming the field, and the pause survives it;
//   • the resume that leaves the links out completes the run.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { screenRecordLinkStack } from './fixtures/flow-screen-record-link-fixture.js';

const SYS = { isSystem: true } as const;
const FLOW = 'srl_convert';

describe('objectstack verify FLOW SCREEN RECORD LINK (#25872): a result screen links the records the run created', () => {
  let stack: VerifyStack;
  let ql: any;
  let token: string;

  /** Trigger the flow; returns the paused result. */
  async function start(): Promise<any> {
    const triggered = await stack.apiAs(token, 'POST', `/automation/${FLOW}/trigger`, { params: {} });
    expect(triggered.status, await triggered.clone().text()).toBeLessThan(300);
    const tj = (await triggered.json()) as any;
    const result = tj.result ?? tj.data ?? tj;
    expect(result.status).toBe('paused');
    expect(result.runId, 'no runId on the paused result').toBeTruthy();
    return result;
  }

  const resume = (runId: string, inputs: Record<string, unknown>) =>
    stack.apiAs(token, 'POST', `/automation/${FLOW}/runs/${runId}/resume`, { inputs });

  /** Answer the first screen and return the paused result screen. */
  async function convert(company: string, contactName: string): Promise<{ runId: string; screen: any }> {
    const { runId } = await start();
    const answered = await resume(runId, { company, contact_name: contactName });
    expect(answered.status, await answered.clone().text()).toBeLessThan(300);
    const aj = (await answered.json()) as any;
    const result = aj.result ?? aj.data ?? aj;
    expect(result.status, `the run did not pause on the result screen: ${JSON.stringify(result)}`).toBe('paused');
    expect(result.screen?.nodeId).toBe('result');
    return { runId: result.runId ?? runId, screen: result.screen };
  }

  /** The record behind an id, read as the console's record page reads it. */
  async function readRecord(objectName: string, id: string): Promise<Record<string, unknown>> {
    const read = await stack.apiAs(token, 'GET', `/data/${objectName}/${id}`);
    expect(read.status, await read.clone().text()).toBe(200);
    const body = (await read.json()) as any;
    return body.record ?? body;
  }

  beforeAll(async () => {
    stack = await bootStack(screenRecordLinkStack as never, { automation: true });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('pauses on a result screen whose two fields carry the created records, each named and linkable', async () => {
    const { screen } = await convert('Acme Corp', 'Ada Lovelace');
    const fields: any[] = screen.fields ?? [];
    expect(fields.map((f) => [f.name, f.type, f.reference])).toEqual([
      ['account_link', 'record_link', 'srl_account'],
      ['contact_link', 'record_link', 'srl_contact'],
    ]);
    expect(fields.every((f) => f.required !== true), 'a record link asks nothing of the user').toBe(true);

    // The ids are the records this run wrote — no other row could carry these names.
    const [accounts, contacts] = await Promise.all([
      ql.find('srl_account', { where: { company_name: 'Acme Corp' }, context: SYS }),
      ql.find('srl_contact', { where: { full_name: 'Ada Lovelace' }, context: SYS }),
    ]);
    expect(accounts).toHaveLength(1);
    expect(contacts).toHaveLength(1);
    const [accountLink, contactLink] = fields;
    expect(String(accountLink.defaultValue)).toBe(String(accounts[0].id));
    expect(String(contactLink.defaultValue)).toBe(String(contacts[0].id));

    // What the link shows: each record's `nameField` value, read through the
    // data door the record page it links to reads.
    const account = await readRecord('srl_account', String(accountLink.defaultValue));
    expect(account.company_name).toBe('Acme Corp');
    const contact = await readRecord('srl_contact', String(contactLink.defaultValue));
    expect(contact.full_name).toBe('Ada Lovelace');
  }, 60_000);

  it('refuses a resume that carries a link field\'s value, keeps the pause, and completes on the clean resume', async () => {
    const { runId, screen } = await convert('Globex', 'Grace Hopper');
    const createdAccountId = String(screen.fields[0].defaultValue);

    for (const inputs of [{ account_link: createdAccountId }, { contact_link: null }]) {
      const refused = await resume(runId, inputs);
      expect(refused.status, JSON.stringify(inputs)).toBe(400);
      const text = await refused.text();
      expect(text).toContain('INVALID_SCREEN_INPUT');
      expect(text).toContain(`Screen field "${Object.keys(inputs)[0]}" shows a record and takes no value`);
    }

    // Refused, not consumed: the resume that leaves the links out finishes the run.
    const done = await resume(runId, {});
    expect(done.status, await done.clone().text()).toBeLessThan(300);
    const dj = (await done.json()) as any;
    const result = dj.result ?? dj.data ?? dj;
    expect(result.status ?? 'completed').toBe('completed');
    expect(await ql.find('srl_account', { where: { company_name: 'Globex' }, context: SYS })).toHaveLength(1);
  }, 60_000);
});
