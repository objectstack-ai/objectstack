// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9934] The producer-side user-facing marking, end-to-end through the real
// stack — the producer half of the objectui#5210 ruling (maintainer,
// 2026-08-19, option 1: producer-side opt-in).
//
// The problem the marking solves: the console form deliberately discards the
// server `message` on 403 and substitutes a generic string — the recorded
// #3821 fix for platform diagnostics leaking to end users — so a hook GUARD's
// deliberate, localized refusal never reached users, and authors were
// incentivized to misuse 400. The contract now gives the author a way to say,
// AT THROW TIME, "this exact text is addressed to the end user": set
// `userMessage` on the thrown error.
//
// This file pins the card's executable criterion, producer side, through the
// real runtime hook path (real kernel, real hook dispatch, real REST door):
//
//   • a hook refusal WITH the marking carries its EXACT text to the wire error
//     payload (`body.userMessage`), at the status the hook declared;
//   • the SAME throw WITHOUT the marking carries no user-facing marking at all
//     — which is what preserves #3821 by construction (unmarked stays generic
//     at the console).
//
// The console render half — showing `userMessage` instead of the generic
// `form.noPermissionToSave` — is objectui#5210's card, keyed on these bodies.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const USER_TEXT = '该任务已进入月末结账期，暂不能修改；请联系财务主管解锁。';
const BODY_USER_TEXT = '该任务被 3 条子任务引用，删除被阻断；请先处理子任务。';

const UfmTask = ObjectSchema.create({
  name: 'ufm_task',
  label: '结账任务',
  fields: {
    name: Field.text({ label: '名称', required: true }),
  },
});

const UfmPlain = ObjectSchema.create({
  name: 'ufm_plain',
  label: '普通任务',
  fields: {
    name: Field.text({ label: '名称', required: true }),
  },
});

const ufmStack = defineStack({
  manifest: {
    id: 'com.dogfood.user_facing_marking',
    namespace: 'ufm',
    version: '0.0.0',
    type: 'app',
    name: 'User-Facing Refusal Marking Fixture',
    description: 'Hooks refusing writes with and without the #9934 user-facing marking.',
  },
  objects: [UfmTask, UfmPlain],
  hooks: [
    {
      // The ruling's example shape: a beforeUpdate guard refusing with a 403.
      // MARKED — the author opts the message in for end users at throw time.
      name: 'ufm_close_period_guard',
      object: 'ufm_task',
      events: ['beforeUpdate'],
      handler: async () => {
        throw Object.assign(new Error('close-period guard refused the write'), {
          statusCode: 403,
          userMessage: USER_TEXT,
        });
      },
    },
    {
      // The SAME throw, UNMARKED — the #3821-preservation half of the pin.
      name: 'ufm_plain_guard',
      object: 'ufm_plain',
      events: ['beforeUpdate'],
      handler: async () => {
        throw Object.assign(new Error('close-period guard refused the write'), {
          statusCode: 403,
        });
      },
    },
    {
      // A sandboxed L2 BODY hook — the metadata-app authoring surface the
      // marking exists for. Its marking must survive the QuickJS boundary
      // (the #9934 side-channel) and ride the sandbox-unwrap envelope.
      name: 'ufm_ref_guard',
      object: 'ufm_task',
      events: ['beforeDelete'],
      body: {
        language: 'js',
        source: `var e = new Error('删除被阻断：存在未完成的子任务');
                 e.userMessage = ${JSON.stringify(BODY_USER_TEXT)};
                 throw e;`,
        capabilities: [],
      },
    },
  ],
});

describe('objectstack verify: hook refusal user-facing marking (#9934)', () => {
  let stack: VerifyStack;
  let token: string;
  let taskId: string;
  let plainId: string;

  beforeAll(async () => {
    stack = await bootStack(ufmStack);
    token = await stack.signIn();

    const t = await stack.apiAs(token, 'POST', '/data/ufm_task', { name: '十二月对账' });
    expect(t.status, `create: ${t.status} ${await t.clone().text()}`).toBeLessThan(300);
    const tBody = (await t.json()) as any;
    taskId = tBody.record?.id ?? tBody.id;
    expect(taskId).toBeTruthy();

    const p = await stack.apiAs(token, 'POST', '/data/ufm_plain', { name: '普通记录' });
    expect(p.status).toBeLessThan(300);
    const pBody = (await p.json()) as any;
    plainId = pBody.record?.id ?? pBody.id;
    expect(plainId).toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('MARKED: the 403 refusal carries the exact author text in `userMessage`', async () => {
    const r = await stack.apiAs(token, 'PATCH', `/data/ufm_task/${taskId}`, { name: '改名' });
    expect(r.status).toBe(403);

    const body = (await r.json()) as any;
    // The executable criterion, first half: exact text, on the wire payload.
    expect(body.userMessage).toBe(USER_TEXT);
    // The diagnostic channel is untouched — the marking never replaces it.
    expect(body.error).toBe('close-period guard refused the write');
  });

  it('UNMARKED: the same throw carries NO user-facing marking — #3821 preserved', async () => {
    const r = await stack.apiAs(token, 'PATCH', `/data/ufm_plain/${plainId}`, { name: '改名' });
    expect(r.status).toBe(403);

    const body = (await r.json()) as any;
    // Second half: nothing marks this message user-facing, so the console
    // keeps its generic substitution for it.
    expect('userMessage' in body).toBe(false);
  });

  it('a sandboxed BODY hook keeps its marking across the QuickJS boundary', async () => {
    const r = await stack.apiAs(token, 'DELETE', `/data/ufm_task/${taskId}`);
    // The sandbox-unwrap envelope: a body's deliberate throw answers 400 with
    // the business message verbatim (see hook-error-format.dogfood.test.ts);
    // the marking rides that envelope — status-agnostic by design.
    expect(r.status).toBe(400);

    const body = (await r.json()) as any;
    expect(body.error).toBe('删除被阻断：存在未完成的子任务');
    expect(body.userMessage).toBe(BODY_USER_TEXT);
  });

  it('ground truth: both refusals actually aborted their writes', async () => {
    const r = await stack.apiAs(token, 'GET', `/data/ufm_task/${taskId}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect((body.record ?? body).name).toBe('十二月对账');

    const p = await stack.apiAs(token, 'GET', `/data/ufm_plain/${plainId}`);
    expect(p.status).toBe(200);
    const pBody = (await p.json()) as any;
    expect((pBody.record ?? pBody).name).toBe('普通记录');
  });
});
