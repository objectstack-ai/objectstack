// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26903] A hook refused for a missing capability, end to end through the real
// stack: QuickJS capability gate → ObjectQL triggerHooks → the data door → the
// HTTP body a client reads.
//
// The gate stays as strict as it is. What this file pins is the ANSWER: a save
// on an object whose `beforeInsert` body calls `ctx.api` without `api.read`
// used to get `500 INTERNAL_ERROR` ("Internal server error"), telling neither
// the caller nor the author which hook or which capability. It is a refusal
// now, `403 INSUFFICIENT_PRIVILEGES` (a standard catalog code), naming both,
// and nothing is written. Under `onError: 'log'` the save proceeds. The same
// body WITH the capability runs.
//
// The composition pins (every gate, the log line) live in
// `packages/runtime/src/sandbox/hook-capability-denial-is-a-refusal.integration.test.ts`;
// this file is the one place the whole HTTP chain runs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const READ_SOURCE = "const rows = await ctx.api.object('hcr_note').find({}); ctx.input.title = ctx.input.title + ' (' + rows.length + ')';";

const note = (name: string, label: string) =>
  ObjectSchema.create({ name, label, fields: { title: Field.text({ label: 'Title', required: true }) } });

const hcrStack = defineStack({
  manifest: {
    id: 'com.dogfood.hook-capability-refusal',
    namespace: 'hcr',
    version: '0.0.0',
    type: 'app',
    name: 'Hook Capability Refusal Fixture',
    description: 'Sandboxed hooks calling ctx.api with and without the api.read capability.',
  },
  objects: [note('hcr_note', 'Note'), note('hcr_logged', 'Logged'), note('hcr_granted', 'Granted')],
  hooks: [
    {
      name: 'hcr_note_guard',
      object: 'hcr_note',
      events: ['beforeInsert'],
      body: { language: 'js', source: READ_SOURCE, capabilities: [] },
    },
    {
      name: 'hcr_logged_guard',
      object: 'hcr_logged',
      events: ['beforeInsert'],
      onError: 'log',
      body: { language: 'js', source: READ_SOURCE, capabilities: [] },
    },
    {
      name: 'hcr_granted_guard',
      object: 'hcr_granted',
      events: ['beforeInsert'],
      body: { language: 'js', source: READ_SOURCE, capabilities: ['api.read'] },
    },
  ],
});

describe('objectstack verify: a hook refused for a missing capability (#26903)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(hcrStack);
    token = await stack.signIn();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  const titles = async (object: string): Promise<string[]> => {
    const r = await stack.apiAs(token, 'GET', `/data/${object}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    return (body.records ?? body.data ?? []).map((row: any) => row.title);
  };

  it('onError: abort — POST answers 403 INSUFFICIENT_PRIVILEGES naming the hook and api.read', async () => {
    const r = await stack.apiAs(token, 'POST', '/data/hcr_note', { title: 'refused' });
    const body = (await r.json()) as any;
    expect(r.status, JSON.stringify(body)).toBe(403);
    expect(body.code).toBe('INSUFFICIENT_PRIVILEGES');
    expect(body.error).toContain("capability 'api.read' not granted to hook 'hcr_note_guard'");
    expect(body.error).toContain("adding 'api.read' to the hook's body.capabilities");
    expect(JSON.stringify(body)).not.toMatch(/threw:|SandboxError|Internal server error/);
  });

  it('ground truth: the refused save wrote nothing', async () => {
    expect(await titles('hcr_note')).toEqual([]);
  });

  it('onError: log — the save proceeds', async () => {
    const r = await stack.apiAs(token, 'POST', '/data/hcr_logged', { title: 'logged' });
    expect(r.status, await r.clone().text()).toBeLessThan(300);
    expect(await titles('hcr_logged')).toEqual(['logged']);
  });

  it('control — the same body WITH api.read runs', async () => {
    const r = await stack.apiAs(token, 'POST', '/data/hcr_granted', { title: 'granted' });
    expect(r.status, await r.clone().text()).toBeLessThan(300);
    expect(await titles('hcr_granted')).toEqual(['granted (0)']);
  });
});
