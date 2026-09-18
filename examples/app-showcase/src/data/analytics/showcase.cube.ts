// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineCube } from '@objectstack/spec/data';

/**
 * Delivery cube — the analytics semantic layer (`defineCube`) over the
 * project-delivery backbone. Sits alongside the `dataset` demos
 * (src/ui/datasets/) to show BOTH analytics surfaces: datasets feed
 * reports/dashboards (ADR-0021), cubes feed the analytics service
 * (`/api/v1/analytics/*` — the CLI auto-loads the foundational analytics
 * capability and registers `analyticsCubes` with it).
 *
 * Base table = `showcase_task` (object name IS the table name, Prime
 * Directive #6); the join reaches the parent project through the
 * master-detail column.
 */
export const DeliveryCube = defineCube({
  name: 'showcase_delivery',
  title: 'Delivery Analytics',
  description: 'Task throughput and effort analytics across the delivery backbone.',
  sql: 'showcase_task',
  measures: {
    count: {
      name: 'count',
      label: 'Task Count',
      type: 'count',
      sql: '*',
    },
    total_estimate_hours: {
      name: 'total_estimate_hours',
      label: 'Total Estimated Hours',
      type: 'sum',
      sql: 'estimate_hours',
    },
    avg_estimate_hours: {
      name: 'avg_estimate_hours',
      label: 'Average Estimate (h)',
      type: 'avg',
      sql: 'estimate_hours',
    },
    done_rate: {
      name: 'done_rate',
      label: 'Done Rate (%)',
      type: 'number',
      sql: "SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)",
      format: 'percent',
    },
  },
  dimensions: {
    status: {
      name: 'status',
      label: 'Status',
      type: 'string',
      sql: 'status',
    },
    priority: {
      name: 'priority',
      label: 'Priority',
      type: 'string',
      sql: 'priority',
    },
    due_date: {
      name: 'due_date',
      label: 'Due Date',
      type: 'time',
      sql: 'due_date',
    },
    assignee: {
      name: 'assignee',
      label: 'Assignee',
      type: 'string',
      sql: 'assignee',
    },
  },
  // The ON clause is DERIVED, never authored: the runtime builds a foreign-key
  // equality from the declared relationship between the two cubes' objects. A
  // join declares only WHICH object it reaches (#18612 removed `sql` and
  // `relationship`; before that, the ON clause written here was silently
  // replaced by exactly this derivation).
  //
  // The record KEY is the FOREIGN-KEY FIELD on the base object —
  // `showcase_task.project`, declared as `Field.masterDetail('showcase_project')`
  // — never a second spelling of the object it reaches. Both strategies read it
  // that way: NativeSQLStrategy emits
  // `LEFT JOIN "showcase_project" "project" ON "showcase_task"."project" = "project"."id"`
  // and ObjectQLStrategy lowers `fkField: 'project'`. Keyed `showcase_project`
  // (as it was until #18612) the derivation asked for a
  // `showcase_task.showcase_project` column that does not exist, so the join
  // never resolved and the example demonstrated nothing.
  joins: {
    project: {
      name: 'showcase_project',
    },
  },
  refreshKey: {
    every: '1 hour',
  },
  public: false,
});

export const allCubes = [DeliveryCube];
