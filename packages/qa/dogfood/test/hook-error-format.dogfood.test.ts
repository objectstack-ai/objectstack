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
// Non-default error names (`TypeError: …`) are deliberately KEPT: they mark
// a genuine script bug rather than a thrown business rule.

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
      // A non-default error name signals a script bug, not a business rule —
      // the name must survive to the client as useful context.
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

  it('non-default error names (TypeError) survive as script-bug context', async () => {
    const r = await stack.apiAs(token, 'PATCH', `/data/hef_base/${baseId}`, { name: '改名' });
    expect(r.status).toBe(400);

    const body = (await r.json()) as any;
    expect(body.error).toBe('TypeError: boom');
    expect(JSON.stringify(body)).not.toMatch(/threw:|hook '/);
  });
});
