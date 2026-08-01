// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Durable suspended-run fixture (#4470).
//
// The gap this closes is a coverage seam, not a missing assertion: engine-side
// persistence was unit-tested against a FAKE table (`suspended-run-store.test.ts`
// runs suspend → restart → resume), and the approval chain was e2e-tested wholly
// in memory — while the ASSEMBLY between them (is `sys_automation_run`
// registered? is its table created? is the store actually attached to the
// engine?) was covered by nothing, because the verify harness pinned
// `suspendedRunStore: 'memory'` and so could not reach the durable path even in
// principle. #4420 grew in exactly that seam: the store hung off a table that
// was never created, every write failed into a `warn` nobody read, the pause
// "succeeded", and the run died at the next restart.
//
// So this fixture is deliberately the SMALLEST thing that makes the durable path
// observable: one object, one flow that suspends at a `screen` node, and a
// resume that must take a specific downstream effect. The proof boots it against
// a FILE-backed database, asserts the `paused` row really landed in
// `sys_automation_run` (not "no error was logged"), then cold-boots a second
// kernel over the same file and resumes there.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

/** The record the resumed half of the run stamps, so "it continued" is observable. */
export const SuspendNote = ObjectSchema.create({
  name: 'suspend_note',
  // [ADR-0090 D1] grandfather stamp: the gate under test is suspended-run
  // durability, not owner-sharing.
  sharingModel: 'public_read_write',
  label: 'Suspend Note',
  pluralLabel: 'Suspend Notes',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: Field.text({ label: 'Status' }),
    resolution: Field.text({ label: 'Resolution' }),
  },
});

/**
 * `flow_durable_suspend` — start → screen (SUSPENDS) → update_record → end.
 *
 * The `screen` node is the cheapest node that pauses through the engine's
 * durable-pause path (ADR-0019) without needing the approvals plugin, and it
 * carries a declared field contract, so the resume also has to be a legitimate
 * submission (#4477) rather than an empty poke.
 *
 * `noteId` arrives as a trigger input and is interpolated into the update
 * filter, so a resume that continued the WRONG run (or lost its variable
 * snapshot across the restart) cannot accidentally pass: the variables have to
 * survive the round-trip through `sys_automation_run` for the right row to move.
 */
export const flowDurableSuspend = {
  name: 'flow_durable_suspend',
  label: 'Flow Durable Suspend',
  type: 'screen',
  status: 'active',
  variables: [{ name: 'noteId', type: 'text', isInput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'ask',
      type: 'screen',
      label: 'Resolution',
      config: {
        title: 'How was it resolved?',
        fields: [
          { name: 'resolution', label: 'Resolution', type: 'text', required: true },
        ],
      },
    },
    {
      id: 'apply',
      type: 'update_record',
      label: 'Apply resolution',
      config: {
        objectName: 'suspend_note',
        filter: { id: '{noteId}' },
        fields: { status: 'resolved', resolution: '{resolution}' },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'ask' },
    { id: 'e2', source: 'ask', target: 'apply' },
    { id: 'e3', source: 'apply', target: 'end' },
  ],
};

/** A minimal, self-contained app config the dogfood harness can boot twice. */
export const durableSuspendStack = defineStack({
  manifest: {
    id: 'com.dogfood.durable_suspend',
    namespace: 'suspend',
    version: '0.0.0',
    type: 'app',
    name: 'Durable Suspend Fixture',
    description: 'Single-object app whose screen flow suspends, persists, and resumes after a cold boot (#4470).',
  },
  objects: [SuspendNote],
  flows: [flowDurableSuspend],
});
