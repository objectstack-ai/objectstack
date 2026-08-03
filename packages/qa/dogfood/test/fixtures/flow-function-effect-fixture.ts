// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Flow-function EFFECT fixture (#4396) — the declaration a run's metrics depend on.
//
// A `script` node's function is contractually pure: it returns a value and a
// later declarative node persists it. #4354's run summary counts on that — a
// `script` step reports no record metrics because every write a pure function
// causes is a downstream node counting itself. A function that writes anyway
// makes its run report `acted: 0`, which is exactly what a dead sweep looks
// like.
//
// So a function that legitimately writes DECLARES it, and this fixture is the
// end-to-end proof that the declaration survives every seam between the author
// and the counter: `defineStack({ functions })` → AppPlugin's bundle collection
// → the ObjectQL function registry → the automation service's resolver bridge →
// the `script` executor → the run summary on the trigger response.
//
// Two flows, identical but for the function they call, so the difference in the
// reported summary can only come from the declaration.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';

/** One object, so the sweep flow has something real to select. */
export const FxInvoice = ObjectSchema.create({
  name: 'fxn_invoice',
  // [ADR-0090 D1] grandfather stamp: the gate under test is run METRICS, not
  // owner-sharing.
  sharingModel: 'public_read_write',
  label: 'Invoice',
  pluralLabel: 'Invoices',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: Field.text({ label: 'Status' }),
  },
});

/** start → get_record → script → end. `fn` is the only thing that varies. */
const sweepFlow = (name: string, fn: string): Flow => ({
  name,
  label: name,
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'select',
      type: 'get_record',
      label: 'Select invoices',
      config: { objectName: 'fxn_invoice', filter: { status: 'open' }, outputVariable: 'invoices' },
    },
    { id: 'run', type: 'script', label: 'Run', config: { function: fn, inputs: { count: '{invoices}' } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'select' },
    { id: 'e2', source: 'select', target: 'run' },
    { id: 'e3', source: 'run', target: 'end' },
  ],
});

export const flowFunctionEffectStack = defineStack({
  manifest: {
    id: 'com.dogfood.flow_function_effect',
    namespace: 'fxn',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Function Effect Fixture',
    description: "Proves a flow function's declared effect reaches the run summary (#4396).",
  },
  objects: [FxInvoice],
  flows: [sweepFlow('fxn_pure_sweep', 'scoreInvoices'), sweepFlow('fxn_writing_sweep', 'syncBilling')],
  functions: {
    // Undeclared ⇒ pure, the contract's default and the short spelling of it.
    scoreInvoices: () => ({ scored: true }),
    // Declared: writes somewhere the platform cannot see or count.
    syncBilling: { handler: () => ({ ok: true }), effect: 'writes' },
  },
});
