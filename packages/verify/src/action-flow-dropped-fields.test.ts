// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #32861 — a record button (an action of `type: 'flow'`) whose autolaunched
 * flow writes a `readonly: true` field, on the real kernel through
 * `actions.run` — the in-process twin of `POST /api/v1/actions/:object/:action`
 * (`handle.ts` drives the runtime's `HttpDispatcher`, so it answers through the
 * same `dispatchFlowAction` the MCP `run_action` bridge reaches).
 *
 * The shape is #32666's: an object whose `status` is `readonly: true`, a flow
 * whose `update_record` step writes `status` (and a writable `note` beside it,
 * the control that the write itself landed), and a record action naming the
 * flow. The engine strips `status` for a non-system caller, the step succeeds
 * with a warning, and the run completes.
 *
 * Before the run's answer carried the drop (origin/main 04c35f09, and the
 * ablation leg of this branch, which strips the carry): the click answered
 * a plain success — no word that `status` never landed — while the record
 * stayed `draft`. The answer now
 * carries `droppedFields`, the data engine's own drop events; the outcome
 * (`success`, `summary`) is unchanged, and a click whose write drops nothing
 * answers without the member.
 *
 * ⚠️ This suite resolves `@objectstack/runtime` and
 * `@objectstack/service-automation` through their BUILT `dist/`. Rebuild both
 * before trusting a run of this file — and especially an ablated one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';

import { bootStack, type VerifyStack } from './harness.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

// The boot's first load, paid during collection (see `boot-warm-up.testkit.ts`).
await warmUpBoot({ automation: true }, { requires: ['automation'] });

const REPORT = 'afd_report';

/** `status` is read-only to every non-system writer; `note` is writable. */
const Report = ObjectSchema.create({
  name: REPORT,
  sharingModel: 'public_read_write',
  label: 'Report',
  pluralLabel: 'Reports',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: Field.text({ label: 'Status', readonly: true }),
    note: Field.text({ label: 'Note' }),
  },
});

/** start → update_record(the clicked report, `fields`) → end. */
function writer(name: string, fields: Record<string, unknown>): Flow {
  return {
    name,
    label: name,
    type: 'autolaunched',
    status: 'active',
    runAs: 'user',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'write',
        type: 'update_record',
        label: 'Write',
        config: { objectName: REPORT, filter: { id: { dialect: 'cel', source: 'record.id' } }, fields },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'write' },
      { id: 'e2', source: 'write', target: 'end' },
    ],
  } as Flow;
}

const SUBMIT = 'afd_submit';
const ADD_NOTE = 'afd_add_note';

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.action-flow-dropped-fields',
    namespace: 'afd',
    version: '0.0.0',
    type: 'app',
    name: 'Action Flow Dropped Fields Fixture',
    description: 'A report whose status is read-only, and two record buttons whose flows write it.',
  },
  requires: ['automation'],
  objects: [Report],
  flows: [writer(SUBMIT, { status: 'submitted', note: 'submitted by the button' }), writer(ADD_NOTE, { note: 'noted by the button' })],
  actions: [
    { name: 'submit_for_approval', label: 'Submit for approval', objectName: REPORT, type: 'flow', target: SUBMIT, locations: ['record_header'] },
    { name: 'add_note', label: 'Add note', objectName: REPORT, type: 'flow', target: ADD_NOTE, locations: ['record_header'] },
  ],
} as never);

let stack: VerifyStack;
let admin: string;

beforeAll(async () => {
  stack = await bootStack(fixtureStack as never, { automation: true });
  // The seeded dev admin: a signed-in person, NOT the system principal, so the
  // engine strips a read-only field it writes.
  admin = await stack.signIn();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop().catch(() => undefined);
});

/** A fresh `draft` report, seeded by the system principal (who may write `status`). */
async function draftReport(name: string): Promise<string> {
  const row = await stack.hooks.run(REPORT, 'insert', { name, status: 'draft' }, { system: true });
  return String((row as { id: unknown }).id);
}

async function reportRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await stack.rows(REPORT, { id });
  return row as Record<string, unknown>;
}

describe('a record button whose flow drops a read-only field (#32861, the #32666 shape)', () => {
  it('answers the drop to the person who clicked: droppedFields names `status`, and the run still succeeded', async () => {
    const id = await draftReport('drop');

    const answer = (await stack.actions.run(REPORT, 'submit_for_approval', { as: admin, recordId: id })) as Record<string, any>;

    expect(answer.success).toBe(true);
    expect(answer.droppedFields).toEqual([{ object: REPORT, fields: ['status'], reason: 'readonly' }]);
    // The outcome semantics are unchanged: a dropped field is not a failure.
    expect(answer.summary?.failed).toBe(0);
    // The record: `status` never landed, the writable field beside it did.
    const row = await reportRow(id);
    expect(row.status).toBe('draft');
    expect(row.note).toBe('submitted by the button');
  });

  it('a click whose write drops nothing answers without the member', async () => {
    const id = await draftReport('clean');

    const answer = (await stack.actions.run(REPORT, 'add_note', { as: admin, recordId: id })) as Record<string, any>;

    expect(answer.success).toBe(true);
    expect('droppedFields' in answer).toBe(false);
    expect((await reportRow(id)).note).toBe('noted by the button');
  });
});
