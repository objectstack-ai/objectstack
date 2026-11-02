// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0120, amendment of 2026-11-01 under the business-requirement matrix's
// S10] A create that names an `id` already held answers ONE refusal, whatever
// the caller may see of the row that holds it. This file pins the
// same-organization half on the stock showcase; the cross-organization half is
// `create-caller-id-collision-walled.dogfood.test.ts`.
//
// The record `id` is the one deployment-global key. A create may carry a
// caller-supplied `id`, and one that collides answers `409 UNIQUE_VIOLATION`,
// writes nothing, names no organization or owner, and is the SAME answer when
// the colliding row is the caller's own (visible) and when row-level access
// hides it from the caller (`showcase_private_note` is `private` OWD). The
// existence signal that leaves is accepted and recorded in the ADR, bounded by
// id unguessability rather than by the refusal's shape — extending ruling
// record 5934879010 (rule 2) from upsert to every create door. So what is pinned
// is the IDENTITY of the two answers, and that nothing is written: a refusal
// that differed by visibility, or named the holder, is a defect against that
// record, not a variant of it.
//
// Three create doors, each driven twice (visible collision, hidden collision)
// and compared whole: `POST /data/:object`, `POST /data/:object/batch` with
// `operation: 'create'`, and the cross-object `POST /batch`. A fresh id on each
// door is the control that the caller's `id` is honoured at all.

import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

const OBJECT = 'showcase_private_note';
const SYS = { isSystem: true } as const;
const idOf = (b: any) => b?.id ?? b?.record?.id;
/** A fresh id the shape the SQL driver mints (16 characters, base64url). */
const freshId = () => randomBytes(12).toString('base64url');

interface Answer {
  status: number;
  text: string;
  body: any;
}

/** One create, carrying `id`, through each of the three doors. */
const DOORS: Record<string, (stack: VerifyStack, token: string, id: string, title: string) => Promise<Answer>> = {
  'POST /data/:object': async (stack, token, id, title) =>
    answer(await stack.apiAs(token, 'POST', `/data/${OBJECT}`, { id, title })),
  'POST /data/:object/batch (create)': async (stack, token, id, title) =>
    answer(await stack.apiAs(token, 'POST', `/data/${OBJECT}/batch`, { operation: 'create', records: [{ data: { id, title } }] })),
  'POST /batch (cross-object)': async (stack, token, id, title) =>
    answer(await stack.apiAs(token, 'POST', '/batch', { operations: [{ object: OBJECT, action: 'create', data: { id, title } }] })),
};

async function answer(res: Response): Promise<Answer> {
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, text, body };
}

/** The refusal's code, wherever the door carries it. */
function refusalCode(door: string, a: Answer): unknown {
  return door.startsWith('POST /data/:object/batch') ? a.body?.results?.[0]?.errors?.[0]?.code : a.body?.code;
}

describe('a create naming an id already held: one answer for a visible and a hidden row (ADR-0120 S10 amendment, same organization)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let ownerToken: string;
  let callerToken: string;
  let ownerUserId: string;
  let callerUserId: string;
  let organizationId: string;
  /** The owner's note: hidden from the caller by the `private` OWD. */
  let hiddenId: string;
  /** The caller's own note: visible to the caller. */
  let visibleId: string;

  const rowOf = async (id: string) => ql.findOne(OBJECT, { where: { id }, context: SYS });

  beforeAll(async () => {
    stack = await getSharedShowcase();
    ql = await stack.kernel.getServiceAsync('objectql');
    adminToken = await stack.signIn();
    ownerToken = await stack.signUp('cid-owner@verify.test');
    callerToken = await stack.signUp('cid-caller@verify.test');
    const uid = async (email: string) => String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id);
    ownerUserId = await uid('cid-owner@verify.test');
    callerUserId = await uid('cid-caller@verify.test');

    const hidden = await stack.apiAs(ownerToken, 'POST', `/data/${OBJECT}`, { title: 'cid owner note' });
    expect(hidden.status, await hidden.clone().text()).toBe(201);
    hiddenId = idOf(await hidden.json());
    const visible = await stack.apiAs(callerToken, 'POST', `/data/${OBJECT}`, { title: 'cid caller note' });
    expect(visible.status, await visible.clone().text()).toBe(201);
    visibleId = idOf(await visible.json());
    organizationId = String((await rowOf(hiddenId))?.organization_id ?? '');
  }, 120_000);

  it('PRECONDITION: one organization, the owner\'s row hidden from the caller, the caller\'s own row visible', async () => {
    const hiddenRow = await rowOf(hiddenId);
    const visibleRow = await rowOf(visibleId);
    expect(hiddenRow?.owner_id).toBe(ownerUserId);
    expect(visibleRow?.owner_id).toBe(callerUserId);
    expect(hiddenRow?.organization_id, 'both rows in the same organization').toBe(visibleRow?.organization_id);

    const hiddenRead = await stack.apiAs(callerToken, 'GET', `/data/${OBJECT}/${hiddenId}`);
    expect(hiddenRead.status, 'the caller cannot read the owner\'s note').toBe(404);
    const visibleRead = await stack.apiAs(callerToken, 'GET', `/data/${OBJECT}/${visibleId}`);
    expect(visibleRead.status, 'the caller reads their own note').toBe(200);
    const adminRead = await stack.apiAs(adminToken, 'GET', `/data/${OBJECT}/${hiddenId}`);
    expect(adminRead.status, 'the hidden row exists').toBe(200);
  });

  for (const [door, create] of Object.entries(DOORS)) {
    describe(door, () => {
      it('CONTROL: a fresh caller-supplied id is honoured', async () => {
        const id = freshId();
        const a = await create(stack, callerToken, id, 'cid fresh');
        expect(a.status, a.text).toBeLessThan(300);
        const row = await rowOf(id);
        expect(row?.id, 'the row landed under the caller-supplied id').toBe(id);
        expect(row?.owner_id).toBe(callerUserId);
      });

      it('the hidden-row collision answers exactly what the visible-row collision answers, and writes nothing', async () => {
        const hiddenBefore = JSON.stringify(await rowOf(hiddenId));
        const visibleBefore = JSON.stringify(await rowOf(visibleId));

        const onVisible = await create(stack, callerToken, visibleId, 'cid collide visible');
        const onHidden = await create(stack, callerToken, hiddenId, 'cid collide hidden');

        expect(refusalCode(door, onVisible), onVisible.text).toBe('UNIQUE_VIOLATION');
        if (door === 'POST /data/:object/batch (create)') {
          expect(onVisible.body?.results?.[0]?.errors?.[0]?.httpStatus).toBe(409);
          expect(onVisible.body?.succeeded).toBe(0);
        } else {
          expect(onVisible.status).toBe(409);
        }
        expect(onHidden.status, 'same status').toBe(onVisible.status);
        expect(onHidden.body, 'same body, whole').toEqual(onVisible.body);

        expect(JSON.stringify(await rowOf(hiddenId)), 'the hidden row is byte-identical after').toBe(hiddenBefore);
        expect(JSON.stringify(await rowOf(visibleId)), 'the visible row is byte-identical after').toBe(visibleBefore);
      });

      it('the refusal names no owner and no organization', async () => {
        const onHidden = await create(stack, callerToken, hiddenId, 'cid collide hidden');
        for (const named of [ownerUserId, callerUserId, 'cid-owner@verify.test', 'cid-caller@verify.test', organizationId]) {
          expect(named, 'a value to look for').toBeTruthy();
          expect(onHidden.text).not.toContain(named);
        }
        for (const key of ['owner_id', 'organization_id', 'owner', 'organization']) {
          expect(onHidden.text).not.toContain(`"${key}"`);
        }
      });
    });
  }
});
