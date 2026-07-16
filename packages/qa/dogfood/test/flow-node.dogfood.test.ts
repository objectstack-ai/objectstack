// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLOW NODE execution proof (ADR-0054 Phase 2), exercised end-to-end through the
// real HTTP + automation stack.
//
// @proof: flow-node-execution
// ADR-0054 runtime proof for the flow-node high-risk class (node execution +
// variable wiring). Referenced by the liveness ledger entry `flow.nodes.type`
// (packages/spec/liveness/flow.json); the spec liveness gate fails if this tag
// is removed. See proof-registry.mts.
//
// A flow being `live` means the engine reads its nodes — necessary but not
// sufficient. This authors a flow, triggers it over HTTP, and asserts the
// observable runtime outcome: the `update_record` node ran AND the `noteId`
// input variable wired into its filter, so EXACTLY the targeted record changed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { flowFixtureStack } from './fixtures/flow-touch-fixture.js';

describe('objectstack verify FLOW: node execution + variable wiring (#flow-node)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    // `automation: true` registers @objectstack/service-automation so the app's
    // flows are pulled from the registry and the trigger route runs them.
    stack = await bootStack(flowFixtureStack, { automation: true });
    token = await stack.signIn();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  async function createNote(name: string): Promise<string> {
    const res = await stack.apiAs(token, 'POST', '/data/flow_note', { name, status: 'new' });
    expect(res.status, `create ${name} failed: ${res.status} ${await res.clone().text()}`).toBeLessThan(300);
    const j = (await res.json()) as { id?: string; record?: { id?: string } };
    const id = j.id ?? j.record?.id;
    expect(id, 'no id returned from create').toBeTruthy();
    return id as string;
  }

  async function statusOf(id: string): Promise<unknown> {
    const res = await stack.apiAs(token, 'GET', `/data/flow_note/${id}`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { record?: Record<string, unknown> } & Record<string, unknown>;
    return (j.record ?? j).status;
  }

  it('precondition: the automation service is wired and the flow is registered', async () => {
    // The flow-list route is served by the same dispatcher; if automation were
    // unregistered this would not return the flow (the whole proof would be moot).
    const res = await stack.apiAs(token, 'GET', '/automation/flow_touch');
    expect(res.status, `automation service not wired: ${res.status}`).toBe(200);
  });

  it('runs the update_record node and wires the input variable into the filter', async () => {
    const target = await createNote('target');
    const bystander = await createNote('bystander');
    expect(await statusOf(target)).toBe('new');
    expect(await statusOf(bystander)).toBe('new');

    const res = await stack.apiAs(token, 'POST', '/automation/flow_touch/trigger', {
      params: { noteId: target },
    });
    expect(res.status, `trigger failed: ${res.status} ${await res.clone().text()}`).toBeLessThan(300);
    const body = (await res.json()) as { success?: boolean; data?: { success?: boolean; error?: string } };
    expect(body.success).toBe(true);
    expect(body.data?.success, `flow run not successful: ${JSON.stringify(body.data)}`).toBe(true);

    // The node executed → the targeted record was stamped.
    expect(await statusOf(target)).toBe('processed');
    // Variable wiring is REAL → the filter used noteId, so the bystander is
    // untouched. (A flow that dropped the variable would touch nothing or, with a
    // filterless update, touch every row — both caught here.)
    expect(await statusOf(bystander)).toBe('new');
  });
});
