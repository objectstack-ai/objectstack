// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_automation_run — Durable state of a **suspended** automation flow run.
 *
 * ADR-0019: a flow that reaches a long-lived pause node (an `approval` node,
 * `wait`, `screen`, …) suspends. Without persistence the continuation lives
 * only in the engine's in-memory map, so a process restart (e.g. a hibernating
 * Cloudflare Worker) loses the run and `resume(runId)` fails even though the
 * approval record survives. Persisting the run here makes the pause **durable**:
 * the engine writes a row on suspend and deletes it on terminal completion, so a
 * cold-booted kernel can rehydrate and continue.
 *
 * Lifecycle: one row per *currently* suspended run. The row is removed when the
 * run resumes to completion or fails — only live pauses are stored. `id` is the
 * `runId`; `correlation` ties back to the pausing node's external state (e.g.
 * `sys_approval_request.id`, mirrored by `sys_approval_request.flow_run_id`).
 *
 * The resumable state (`variables` / `steps` / `context` / `screen`) is stored
 * JSON-serialized — the engine works with a `Map`, which round-trips through
 * these `*_json` columns.
 *
 * Writers: the automation engine's durable {@link SuspendedRunStore}.
 * Readers: operability surfaces (a "pending/suspended runs" view), the engine on
 * resume after a restart.
 *
 * @namespace sys
 */
export const SysAutomationRun = ObjectSchema.create({
  name: 'sys_automation_run',
  label: 'Automation Run',
  pluralLabel: 'Automation Runs',
  icon: 'pause-circle',
  isSystem: true,
  managedBy: 'system',
  description: 'Durable automation run state: live suspended runs (resumable, ADR-0019) and terminal run history (completed / failed, for observability).',
  displayNameField: 'id',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{flow_name} · {node_id}',
  highlightFields: ['flow_name', 'node_id', 'status', 'correlation', 'started_at', 'updated_at'],

  fields: {
    id: Field.text({ label: 'Run ID', required: true, readonly: true, group: 'System' }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      description: 'Tenant that owns this run (propagated from the trigger context)',
    }),

    flow_name: Field.text({
      label: 'Flow',
      required: true,
      maxLength: 255,
      searchable: true,
      group: 'Identity',
    }),

    flow_version: Field.number({ label: 'Flow Version', required: false, group: 'Identity' }),

    node_id: Field.text({
      label: 'Node',
      required: false,
      maxLength: 255,
      description: 'For a suspended run, the node it is paused at (resume continues from its out-edges); for a terminal run, the last node reached.',
      group: 'State',
    }),

    status: Field.select(
      ['running', 'paused', 'completed', 'failed'],
      {
        label: 'Status',
        required: true,
        defaultValue: 'paused',
        description: 'paused = a live suspended run (resumable); completed / failed = a terminal run kept as durable history.',
        group: 'State',
      },
    ),

    correlation: Field.text({
      label: 'Correlation',
      required: false,
      maxLength: 255,
      description: 'Correlation key from the pausing node (e.g. approval request id).',
      group: 'State',
    }),

    user_id: Field.text({
      label: 'User',
      required: false,
      maxLength: 255,
      description: 'User who triggered the run (from context.userId).',
      group: 'State',
    }),

    variables_json: Field.textarea({
      label: 'Variables',
      required: false,
      description: 'JSON snapshot of the flow variable map at suspend time.',
      group: 'State',
    }),

    steps_json: Field.textarea({
      label: 'Steps',
      required: false,
      description: 'JSON snapshot of the executed step logs so far.',
      group: 'State',
    }),

    context_json: Field.textarea({
      label: 'Context',
      required: false,
      description: 'JSON snapshot of the trigger / automation context.',
      group: 'State',
    }),

    screen_json: Field.textarea({
      label: 'Screen',
      required: false,
      description: 'JSON snapshot of the screen spec the run is waiting on (screen-flow runtime).',
      group: 'State',
    }),

    started_at: Field.datetime({ label: 'Started At', required: true, group: 'State' }),

    start_time: Field.number({
      label: 'Start Time (epoch ms)',
      required: false,
      description: 'Epoch ms when the run started; used to compute duration on resume.',
      group: 'State',
    }),

    finished_at: Field.datetime({
      label: 'Finished At',
      required: false,
      description: 'When a terminal run (completed / failed) ended. Null while running / paused.',
      group: 'Outcome',
    }),

    duration_ms: Field.number({
      label: 'Duration (ms)',
      required: false,
      description: 'Wall-clock duration of a terminal run.',
      group: 'Outcome',
    }),

    error: Field.textarea({
      label: 'Error',
      required: false,
      description: 'Failure reason for a `failed` run — the message a designer needs to fix it.',
      group: 'Outcome',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({ label: 'Updated At', required: false, group: 'System' }),
  },

  indexes: [
    // "Which runs are suspended for this flow?" — operability / resume sweeps.
    { fields: ['flow_name', 'status'] },
    { fields: ['status', 'updated_at'] },
    // Run-history reads for the Studio "Runs" tab: newest terminal runs per flow.
    { fields: ['flow_name', 'started_at'] },
    // Look up a suspended run by the pausing node's correlation key.
    { fields: ['correlation'] },
  ],
});
