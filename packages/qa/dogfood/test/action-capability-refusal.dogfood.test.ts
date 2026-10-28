// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26965] An action body refused for a missing capability, end to end through
// the real stack: QuickJS capability gate → the action body runner → the
// `/actions` door → the HTTP body a client reads.
//
// The gate stays as strict as it is. What this file pins is the ANSWER: an
// action whose body calls `ctx.api` without `api.read` used to get
// `500 INTERNAL_ERROR` ("Internal server error"), while a hook making the same
// call got `403 INSUFFICIENT_PRIVILEGES` naming the hook and the capability
// (#26903). One gate, one answer: the action's denial is the same coded
// refusal now, naming the action and the capability, with the remedy on the
// action's own `body.capabilities`. The same body WITH the capability runs.
//
// The composition pins (every gate, action and job, the log lines) live in
// `packages/runtime/src/sandbox/action-job-capability-denial-is-a-refusal.integration.test.ts`;
// this file is the one place the whole HTTP chain runs for an action.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const READ_SOURCE = "const rows = await ctx.api.object('acr_note').find({}); return { seen: rows.length };";

const acrStack = defineStack({
  manifest: {
    id: 'com.dogfood.action-capability-refusal',
    namespace: 'acr',
    version: '0.0.0',
    type: 'app',
    name: 'Action Capability Refusal Fixture',
    description: 'Sandboxed actions calling ctx.api with and without the api.read capability.',
  },
  objects: [
    ObjectSchema.create({ name: 'acr_note', label: 'Note', fields: { title: Field.text({ label: 'Title', required: true }) } }),
  ],
  actions: [
    {
      name: 'acr_count_denied',
      label: 'Count notes (no capability)',
      objectName: 'acr_note',
      type: 'script',
      body: { language: 'js', source: READ_SOURCE, capabilities: [] },
    },
    {
      name: 'acr_count_granted',
      label: 'Count notes',
      objectName: 'acr_note',
      type: 'script',
      body: { language: 'js', source: READ_SOURCE, capabilities: ['api.read'] },
    },
  ],
} as any);

describe('objectstack verify: an action refused for a missing capability (#26965)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(acrStack);
    token = await stack.signIn();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('POST /actions answers 403 INSUFFICIENT_PRIVILEGES naming the action and api.read', async () => {
    const r = await stack.apiAs(token, 'POST', '/actions/acr_note/acr_count_denied', {});
    const body = (await r.json()) as any;
    expect(r.status, JSON.stringify(body)).toBe(403);
    expect(body.error.code).toBe('INSUFFICIENT_PRIVILEGES');
    expect(body.error.message).toContain("capability 'api.read' not granted to action 'acr_count_denied'");
    expect(body.error.message).toContain("adding 'api.read' to the action's body.capabilities");
    expect(JSON.stringify(body)).not.toMatch(/threw:|SandboxError|Internal server error/);
  });

  it('control — the same body WITH api.read runs', async () => {
    const r = await stack.apiAs(token, 'POST', '/actions/acr_note/acr_count_granted', {});
    const body = (await r.json()) as any;
    expect(r.status, JSON.stringify(body)).toBe(200);
    expect(JSON.stringify(body)).toContain('"seen":0');
  });
});
