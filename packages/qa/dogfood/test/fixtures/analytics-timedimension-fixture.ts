// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13714 fixture — the smallest app that reproduces the field report's request.
//
// Shaped after `examples/app-showcase`'s `showcase_delivery` cube, because that
// is what the report was filed against: a cube over one object, with a `date`
// dimension and both a `count` and a `sum` measure. What matters for the defect
// is only that the cube is a CUBE — its measures are addressed on the wire as
// `<cube>.<measure>`, and `ObjectQLStrategy` uses that dotted name verbatim as
// the driver-level aggregation `alias`.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field, defineCube } from '@objectstack/spec/data';

export const TdDelivery = ObjectSchema.create({
  name: 'td_delivery',
  // [ADR-0090 D1] grandfather stamp: this fixture's gate is analytics SQL
  // emission, not owner-sharing.
  sharingModel: 'public_read_write',
  label: 'TD Delivery',
  pluralLabel: 'TD Deliveries',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: Field.text({ label: 'Status' }),
    // `Field.date`, like showcase's `due_date` — the dimension the report
    // buckets. Kept a DATE (not a datetime) so the fixture matches the report.
    due_date: Field.date({ label: 'Due Date' }),
    estimate_hours: Field.number({ label: 'Estimate Hours' }),
  },
});

/** The cube. `showcase_delivery` with the names changed and the joins dropped. */
export const TdDeliveryCube = defineCube({
  name: 'td_delivery_cube',
  title: 'TD Delivery Analytics',
  sql: 'td_delivery',
  measures: {
    count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
    total_estimate_hours: {
      name: 'total_estimate_hours',
      label: 'Total Estimated Hours',
      type: 'sum',
      sql: 'estimate_hours',
    },
  },
  dimensions: {
    status: { name: 'status', label: 'Status', type: 'string', sql: 'status' },
    due_date: { name: 'due_date', label: 'Due Date', type: 'time', sql: 'due_date' },
  },
  public: false,
});

export const tdFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.td_fixture',
    namespace: 'td',
    version: '0.0.0',
    type: 'app',
    name: 'Time-Dimension Fixture',
    // The tracker id lives in the suite's header, not in a runtime string an
    // author or operator would read with no way to resolve it.
    description: 'One object plus one cube, for the analytics granularity gate.',
  },
  objects: [TdDelivery],
});
