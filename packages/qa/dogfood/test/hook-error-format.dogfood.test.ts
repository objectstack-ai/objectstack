// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Sandboxed-hook error message format, end-to-end through the real stack:
// QuickJS sandbox (SandboxError + innerMessage) → ObjectQL triggerHooks →
// REST mapDataError → HTTP error body.
//
// A hook author writing `throw new Error('业务规则说明')` is expressing a
// deliberate business rule (e.g. referential-integrity "记录被引用,删除被
// 阻断"). The console shows the REST body's `error` string verbatim in its
// toast, so that string must be ONLY the author's message — not the sandbox
// debug wrapper (`hook 'x' threw: Error: …`, which belongs in server logs)
// and not a `code` field an older bundled @objectstack/client would prepend
// as `[ObjectStack] CODE: …`.
//
// [#7543] Non-default error names (`TypeError: …`) are the OPPOSITE case, and
// this file used to assert they were KEPT on the wire "as useful context". They
// are not context for the caller — they are a server-side fault, and shipping
// one as the client-facing message of a 400 with no `code` was the defect #7543
// reports (`POST /data/showcase_task {"title":12345}` →
// `400 {"error":"TypeError: not a function"}`). A body that CRASHES now answers
// the sanitised `500 INTERNAL_ERROR` that `mapDataError`'s terminal branch
// already gives every other handler bug (#5489). The full text still reaches the
// operator's log; only the wire is sanitised.
//
// The distinction this file pins end-to-end is therefore: a hook that REPORTS
// (`throw new Error('业务规则')`) speaks to the caller verbatim at 400, and a
// hook that FAULTS (`throw new TypeError('boom')`) does not speak to the caller
// at all. Classification lives in `packages/rest/src/rest-server.ts`
// (`isScriptFaultMessage`), unit-covered in
// `packages/rest/src/rest-hook-script-fault-envelope.test.ts`; this file is the
// only place the whole chain runs for real.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const BUSINESS_MSG = '制作基地被「项目主计划批次」引用(3 条),删除被阻断,请先解除引用';

const HefBase = ObjectSchema.create({
  name: 'hef_base',
  label: '制作基地',
  fields: {
    name: Field.text({ label: '名称', required: true }),
  },
});

const hefStack = defineStack({
  manifest: {
    id: 'com.dogfood.hook_error_format',
    namespace: 'hef',
    version: '0.0.0',
    type: 'app',
    name: 'Hook Error Format Fixture',
    description: 'Sandboxed hooks throwing business-rule and script-bug errors.',
  },
  objects: [HefBase],
  hooks: [
    {
      // Mirrors the real-world referential-integrity guard (`pm_ref_base`)
      // that motivated the fix: a deliberate business rule thrown as a
      // default `Error`.
      name: 'hef_ref_guard',
      object: 'hef_base',
      events: ['beforeDelete'],
      body: {
        language: 'js',
        source: `throw new Error(${JSON.stringify(BUSINESS_MSG)});`,
        capabilities: [],
      },
    },
    {
      // [#7543] A non-default error name signals a script bug, not a business
      // rule — so it must NOT reach the client. This fixture is the reported
      // defect in miniature: `showcase_normalize_task_title` crashed the same
      // way on `{"title": 12345}` (a truthy number has no `.trim`), and the
      // resulting `TypeError` went out as the 400's message.
      name: 'hef_buggy_guard',
      object: 'hef_base',
      events: ['beforeUpdate'],
      body: {
        language: 'js',
        source: `throw new TypeError('boom');`,
        capabilities: [],
      },
    },
  ],
});

describe('objectstack verify: sandboxed hook error message format (#hef)', () => {
  let stack: VerifyStack;
  let token: string;
  let baseId: string;

  beforeAll(async () => {
    stack = await bootStack(hefStack);
    token = await stack.signIn();

    const created = await stack.apiAs(token, 'POST', '/data/hef_base', { name: '华东制作基地' });
    expect(created.status, `create: ${created.status} ${await created.clone().text()}`).toBeLessThan(300);
    const body = (await created.json()) as any;
    baseId = body.record?.id ?? body.id;
    expect(baseId).toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('DELETE blocked by a sandboxed hook returns ONLY the business message', async () => {
    const r = await stack.apiAs(token, 'DELETE', `/data/hef_base/${baseId}`);
    expect(r.status).toBe(400);

    const body = (await r.json()) as any;
    // The console toast renders this string verbatim — it must be exactly
    // what the hook author threw.
    expect(body.error).toBe(BUSINESS_MSG);
    // No sandbox debug wrapper, no branding, no code for old clients to prepend.
    expect(JSON.stringify(body)).not.toMatch(/threw:|hook '|\[ObjectStack\]/);
    expect(body.code).toBeUndefined();
  });

  it('ground truth: the blocked delete did not remove the record', async () => {
    const r = await stack.apiAs(token, 'GET', `/data/hef_base/${baseId}`);
    expect(r.status).toBe(200);
  });

  // [#7543] REVERSED — see the file header. This case previously asserted
  // `400` + `body.error === 'TypeError: boom'`.
  it('a hook body that CRASHES is sanitised, not echoed to the client', async () => {
    const r = await stack.apiAs(token, 'PATCH', `/data/hef_base/${baseId}`, { name: '改名' });
    expect(r.status).toBe(500);

    const body = (await r.json()) as any;
    // Nothing of the runtime fault survives: not the constructor name, not the
    // thrown text, not the sandbox debug wrapper.
    expect(JSON.stringify(body)).not.toMatch(/TypeError|boom|threw:|hook '/);
    // …and it joins the ledgered envelope, which the old 400 did not: a client
    // keying on `code` got nothing at all from this response.
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('ground truth: the crashing hook still aborted the write', async () => {
    // The status changed; the transactional outcome must not. `onError` defaults
    // to abort, and a sanitised envelope must not be mistaken for a soft failure
    // that let the write through.
    const r = await stack.apiAs(token, 'GET', `/data/hef_base/${baseId}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect((body.record ?? body).name).toBe('华东制作基地');
  });
});
