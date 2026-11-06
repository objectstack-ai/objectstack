// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#30891] The MCP `delete_records` tool, end to end on a booted stack: the
// live `/api/v1/mcp` transport, the runtime's real data bridge, the real
// engine and a package's real locking rule, for an ADMINISTRATOR caller.
//
// ## What this file pins that the package's own pins cannot
//
// `packages/mcp/src/mcp-delete-records.test.ts` drives the tool on an engine
// double. Here the rule that refuses a row is a real `beforeDelete` hook,
// written the way a package writes one: HotCRM's
// `opportunity_line_item_freeze` refuses a USER's change of a closed deal's
// line with `RECORD_LOCKED` / 409 and lets a write with no acting user (a
// seed, a migration) through. So the lock refuses whoever calls as a user,
// administrators included, and only a delete that stopped running as the
// caller could get past it. The maintainer's ruling on the card is that no
// caller bypasses such a rule (「不绕过」); the admin pin below is that ruling's
// executable form.
//
//   • preview: an unconfirmed call answers the count and a sample, and the
//     records are all still readable over REST afterwards;
//   • confirmed: the unlocked rows are deleted, the locked rows are answered
//     as one group (code, status, the hook's own sentence, their ids) and stay;
//   • control: REST `DELETE /data/:object/:id` refuses the same admin on a
//     locked row, so the tool answers what the platform's other door answers;
//   • the cap: 203 matching rows, one call deletes 200 and says 3 remain, the
//     next call deletes the 3 (the count is the runtime's real aggregate).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { MCPServerPlugin } from '@objectstack/mcp';
import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';

const LOCKED = 'dlr_close_task';
const BULK = 'dlr_bulk_row';
const LOCK_SENTENCE = 'This task belongs to a closed period, so it can no longer be deleted.';

const CloseTask = ObjectSchema.create({
  name: LOCKED,
  label: 'Close task',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    batch: Field.text({ label: 'Batch' }),
    period_closed: Field.boolean({ label: 'Period closed' }),
  },
});

const BulkRow = ObjectSchema.create({
  name: BULK,
  label: 'Bulk row',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    batch: Field.text({ label: 'Batch' }),
  },
});

const fixture = defineStack({
  manifest: {
    id: 'com.dogfood.mcp-delete-records',
    namespace: 'dlr',
    version: '0.0.0',
    type: 'app',
    name: 'MCP delete_records fixture',
    description: 'A package locking rule that refuses a user delete of a closed-period row, for #30891.',
  },
  objects: [CloseTask, BulkRow],
  hooks: [
    {
      // A package's locking rule, in HotCRM's shape: a USER's delete of a
      // closed-period row is refused; a write with no acting user passes.
      name: 'dlr_close_period_lock',
      object: LOCKED,
      events: ['beforeDelete'],
      handler: async (ctx: any) => {
        if (!ctx.user?.id) return;
        if (ctx.previous?.period_closed !== true) return;
        throw Object.assign(new Error(LOCK_SENTENCE), { code: 'RECORD_LOCKED', status: 409 });
      },
    },
  ],
});

const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id;

describe('MCP delete_records on a real stack: preview, grouped refusals, an admin under a locking rule, the cap (#30891)', () => {
  let stack: VerifyStack;
  let admin: string;

  /** One `tools/call` over the live MCP transport; the tool's text content, parsed. */
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${admin}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    expect(res.status).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    const text = String(rpc.result?.content?.[0]?.text ?? '');
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
    return { isError: rpc.result?.isError === true, payload, text };
  };

  const create = async (object: string, data: Record<string, unknown>): Promise<string> => {
    const res = await stack.apiAs(admin, 'POST', `/data/${object}`, data);
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const id = idOf(await res.json());
    expect(id, 'created record id').toBeTruthy();
    return String(id);
  };
  const readStatus = async (object: string, id: string) => (await stack.apiAs(admin, 'GET', `/data/${object}/${id}`)).status;

  beforeAll(async () => {
    stack = await bootStack(fixture, { extraPlugins: [new MCPServerPlugin()] });
    admin = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  describe('a selection with locked rows', () => {
    let open: string[];
    let closed: string[];
    let other: string;

    beforeAll(async () => {
      open = [await create(LOCKED, { name: 'open 1', batch: 'q4' }), await create(LOCKED, { name: 'open 2', batch: 'q4' })];
      closed = [
        await create(LOCKED, { name: 'closed 1', batch: 'q4', period_closed: true }),
        await create(LOCKED, { name: 'closed 2', batch: 'q4', period_closed: true }),
      ];
      other = await create(LOCKED, { name: 'another batch', batch: 'q1' });
    }, 60_000);

    it('preview: an unconfirmed call answers the count and a sample, and deletes nothing', async () => {
      const refused = await tool('delete_records', { objectName: LOCKED, where: { batch: 'q4' } });

      expect(refused.isError, refused.text).toBe(true);
      expect(refused.payload.error).toMatchObject({
        code: 'ACTION_CONFIRMATION_REQUIRED',
        status: 428,
        details: { actionName: 'delete_records', objectName: LOCKED, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER },
      });
      expect(refused.payload.preview).toMatchObject({ object: LOCKED, matched: 4, wouldAttempt: 4, cap: 200 });
      expect([...refused.payload.preview.sampleRecordIds].sort()).toEqual([...open, ...closed].sort());

      // Nothing was deleted: every record still reads over REST.
      for (const id of [...open, ...closed, other]) expect(await readStatus(LOCKED, id), `record ${id}`).toBe(200);
    }, 60_000);

    it('control: REST DELETE refuses the same administrator on a locked row', async () => {
      const res = await stack.apiAs(admin, 'DELETE', `/data/${LOCKED}/${closed[0]}`);
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await readStatus(LOCKED, closed[0]!)).toBe(200);
    }, 60_000);

    it('confirmed, as an administrator: the unlocked rows go, the locked rows stay and are answered as one group', async () => {
      const done = await tool('delete_records', {
        objectName: LOCKED,
        where: { batch: 'q4' },
        [AI_ACTION_CONFIRMATION_MEMBER]: true,
      });

      expect(done.isError, done.text).toBe(false);
      expect(done.payload).toMatchObject({ object: LOCKED, matched: 4, attempted: 4, deleted: 2, refused: 2, remaining: 2 });
      expect(done.payload.refusals).toHaveLength(1);
      const [group] = done.payload.refusals;
      expect(group).toMatchObject({ code: 'RECORD_LOCKED', status: 409, reason: LOCK_SENTENCE, count: 2 });
      expect([...group.recordIds].sort()).toEqual([...closed].sort());

      // Ground truth over REST: the administrator's delete did not get past the lock.
      for (const id of closed) expect(await readStatus(LOCKED, id), `locked record ${id}`).toBe(200);
      for (const id of open) expect(await readStatus(LOCKED, id), `open record ${id}`).toBe(404);
      // Outside the selection: untouched.
      expect(await readStatus(LOCKED, other)).toBe(200);
    }, 60_000);
  });

  it('the cap: 203 matching rows, one call deletes 200 and says 3 remain, the next call deletes the 3', async () => {
    const rows = Array.from({ length: 203 }, (_, i) => ({ name: `bulk ${i}`, batch: 'cap' }));
    for (const slice of [rows.slice(0, 200), rows.slice(200)]) {
      const res = await stack.apiAs(admin, 'POST', `/data/${BULK}/createMany`, slice);
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    }

    const preview = await tool('delete_records', { objectName: BULK, where: { batch: 'cap' } });
    expect(preview.isError).toBe(true);
    expect(preview.payload.preview).toMatchObject({ matched: 203, wouldAttempt: 200, cap: 200 });

    const first = await tool('delete_records', { objectName: BULK, where: { batch: 'cap' }, [AI_ACTION_CONFIRMATION_MEMBER]: true });
    expect(first.isError, first.text).toBe(false);
    expect(first.payload).toMatchObject({ matched: 203, attempted: 200, deleted: 200, refused: 0, remaining: 3 });
    expect(first.payload.next).toContain('3 matching record(s) were past this call\'s cap of 200');

    const second = await tool('delete_records', { objectName: BULK, where: { batch: 'cap' }, [AI_ACTION_CONFIRMATION_MEMBER]: true });
    expect(second.payload).toMatchObject({ matched: 3, attempted: 3, deleted: 3, remaining: 0 });

    const after = await tool('delete_records', { objectName: BULK, where: { batch: 'cap' } });
    expect(after.payload.preview).toMatchObject({ matched: 0, wouldAttempt: 0 });
  }, 180_000);
});
