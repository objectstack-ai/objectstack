// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Flow-node execution fixture — the deterministic ADR-0054 Phase-2 flow proof.
//
// A flow is `live` in the ledger because the automation engine *reads* its
// nodes — but "reads" is not "runs correctly end-to-end". A node's value
// crosses flow-trigger → variable context → CEL/template interpolation → the
// data engine, and the break can live in any seam (e.g. an input variable that
// never reaches a node's config, or an `update_record` that ignores its
// filter). This fixture proves the integrated path with ZERO dependence on an
// example app: one object `flow_note` and one `autolaunched` flow whose single
// `update_record` node stamps `status: 'processed'` on the record whose id was
// passed in as the `noteId` input variable.
//
// The proof asserts BOTH directions, mirroring the RLS fixture's rigor:
//   • the targeted record IS mutated  → the node executed,
//   • a bystander record is NOT       → the input variable actually flowed into
//     the node's filter (not a blanket update). A flow that didn't wire the
//     variable would either touch nothing or touch everything; only correct
//     execution + wiring flips exactly the target.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

/** The one object under test: a note the flow stamps as processed. */
export const FlowNote = ObjectSchema.create({
  name: 'flow_note',
  // [ADR-0090 D1] grandfather stamp: this fixture's gate under test is
  // permission-set RLS / flow scoping, not owner-sharing.
  sharingModel: 'public_read_write',
  label: 'Flow Note',
  pluralLabel: 'Flow Notes',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: Field.text({ label: 'Status' }),
  },
});

/**
 * `flow_touch` — start → update_record → end. The `noteId` input variable is
 * interpolated into the update filter (`{noteId}` template), and the node sets
 * `status` to `processed`. Triggered via `POST /automation/flow_touch/trigger`
 * with `{ params: { noteId } }`.
 */
export const flowTouch = {
  name: 'flow_touch',
  // [ADR-0090 D1] grandfather stamp: this fixture's gate under test is
  // permission-set RLS / flow scoping, not owner-sharing.
  sharingModel: 'public_read_write',
  label: 'Flow Touch',
  type: 'autolaunched',
  variables: [{ name: 'noteId', type: 'text', isInput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'mark_processed',
      type: 'update_record',
      label: 'Mark processed',
      config: {
        objectName: 'flow_note',
        filter: { id: '{noteId}' },
        fields: { status: 'processed' },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mark_processed' },
    { id: 'e2', source: 'mark_processed', target: 'end' },
  ],
};

/** A minimal, self-contained app config the dogfood harness can boot. */
export const flowFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.flow_fixture',
    namespace: 'flow',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Node Fixture',
    description: 'Single-object app whose flow exercises node execution + variable wiring (ADR-0054 Phase 2).',
  },
  objects: [FlowNote],
  flows: [flowTouch],
});
