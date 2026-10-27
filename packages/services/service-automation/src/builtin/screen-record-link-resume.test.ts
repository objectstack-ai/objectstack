// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A screen flow ends on a result screen that links the records it created
 * (ruling B on the screen-flow result screen).
 *
 * The flow writes two records, then pauses on a screen of two
 * `type: 'record_link'` fields whose `defaultValue` envelopes read the created
 * records' ids. Pinned here, at the engine:
 *  - the paused screen carries each field typed `record_link`, with its
 *    `reference` and its `defaultValue` already evaluated to the id;
 *  - a resume carrying a value under a link field's name is refused with
 *    `INVALID_SCREEN_INPUT`, nothing after the screen runs, and the pause
 *    survives;
 *  - the resume that leaves the links out completes, and the flow variable the
 *    id came from is the record the run created — the account link is named
 *    after that very variable (`account`), so a bound refused value would have
 *    replaced the record with a string and the audit write after the screen
 *    would not read the created id.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
}

/** A data engine that mints `<object>_<n>` ids and records every insert. */
function fakeData() {
  const inserts: Array<{ obj: string; fields: Record<string, unknown> }> = [];
  const data: any = {
    async insert(obj: string, fields: Record<string, unknown>) {
      inserts.push({ obj, fields });
      return { id: `${obj}_${inserts.length}`, ...fields };
    },
  };
  return { data, inserts };
}

const CEL = (source: string) => ({ dialect: 'cel', source });

/** start → create account → create contact → result screen (two links) → audit write → end. */
function convertFlow() {
  return {
    name: 'convert_with_result',
    label: 'Convert with result screen',
    type: 'screen',
    status: 'active',
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'acc', type: 'create_record', label: 'Account', config: { objectName: 'crm_account', fields: { name: 'Acme' }, outputVariable: 'account' } },
      { id: 'con', type: 'create_record', label: 'Contact', config: { objectName: 'crm_contact', fields: { name: 'Ada' }, outputVariable: 'contact' } },
      {
        id: 'result', type: 'screen', label: 'Created',
        config: {
          fields: [
            { name: 'account', label: 'Account', type: 'record_link', reference: 'crm_account', defaultValue: CEL('account.id') },
            { name: 'contact_link', label: 'Contact', type: 'record_link', reference: 'crm_contact', defaultValue: CEL('contact.id') },
          ],
        },
      },
      { id: 'audit', type: 'create_record', label: 'Audit', config: { objectName: 'audit', fields: { account: CEL('account.id') } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'acc' },
      { id: 'e2', source: 'acc', target: 'con' },
      { id: 'e3', source: 'con', target: 'result' },
      { id: 'e4', source: 'result', target: 'audit' },
      { id: 'e5', source: 'audit', target: 'end' },
    ],
  };
}

function makeEngine() {
  const { data, inserts } = fakeData();
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, { logger: silentLogger(), getService: (n: string) => (n === 'data' ? data : undefined) } as any);
  engine.registerFlow('convert_with_result', convertFlow() as any);
  return { engine, inserts };
}

describe('a screen flow ends on a screen that links the records it created', () => {
  it('pauses with both fields typed `record_link`, each carrying its object and the created id', async () => {
    const { engine, inserts } = makeEngine();
    const started = await engine.execute('convert_with_result', {} as any);
    expect(started.status).toBe('paused');
    expect(started.screen?.fields).toEqual([
      expect.objectContaining({ name: 'account', type: 'record_link', reference: 'crm_account', defaultValue: 'crm_account_1' }),
      expect.objectContaining({ name: 'contact_link', type: 'record_link', reference: 'crm_contact', defaultValue: 'crm_contact_2' }),
    ]);
    expect(started.screen?.fields.every((f) => f.required === false)).toBe(true);
    expect(inserts.map((i) => i.obj)).toEqual(['crm_account', 'crm_contact']);
  });

  it('refuses a resume carrying a link field\'s value, runs nothing after the screen, and keeps the pause', async () => {
    const { engine, inserts } = makeEngine();
    const { runId } = await engine.execute('convert_with_result', {} as any);

    const refused = await engine.resume(runId!, { variables: { account: 'crm_account_999' } });
    expect(refused.success).toBe(false);
    expect(refused.code).toBe('INVALID_SCREEN_INPUT');
    expect(refused.error).toContain('Screen field "account" shows a record and takes no value');
    expect(inserts.map((i) => i.obj)).toEqual(['crm_account', 'crm_contact']);

    // The refusal consumed nothing, and bound nothing: the clean resume
    // completes and the next node reads `account.id` — the record the run
    // created, not the string the refused resume sent under the same name.
    const resumed = await engine.resume(runId!, { variables: {} });
    expect(resumed.success, resumed.error).toBe(true);
    expect(inserts[2]).toEqual({ obj: 'audit', fields: { account: 'crm_account_1' } });
  });
});
