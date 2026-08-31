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
 * Lifecycle: one row per *currently* suspended run (`status: 'paused'`, id =
 * raw `runId`, removed on terminal completion) plus bounded terminal history
 * (`status: 'completed' | 'failed'`, id = `run_`-prefixed). History rows are
 * subject to retention (#2585, ADR-0057 posture): a write-time per-flow cap
 * (default 100) plus a periodic age sweep (default 30 days) — see
 * `ObjectStoreSuspendedRunStore` / `AutomationServicePluginOptions`. Paused
 * rows are live resumable state and are never pruned. `correlation` ties back
 * to the pausing node's external state (e.g. `sys_approval_request.id`,
 * mirrored by `sys_approval_request.flow_run_id`).
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
  managedBy: 'engine-owned',
  // ADR-0057 (#2834): MIXED table — live suspended runs (resumable workflow
  // state, record semantics: an approval may legitimately stay paused for
  // months) interleaved with terminal run history (telemetry semantics).
  // `retention.onlyWhen` scopes the age sweep to TERMINAL statuses only, so
  // the platform Reaper prunes 30d-old history while suspended (`paused`) and
  // in-flight (`running`) rows never match. The write-time per-flow overflow
  // cap (ObjectStoreSuspendedRunStore.pruneFlowOverflow, #2585) stays in the
  // store — a count bound the declarative contract can't express.
  lifecycle: {
    class: 'telemetry',
    retention: {
      maxAge: '30d',
      onlyWhen: { status: { $in: ['completed', 'failed'] } },
    },
  },
  description: 'Durable automation run state: live suspended runs (resumable, ADR-0019) and terminal run history (completed / failed, for observability).',
  displayNameField: 'id',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{flow_name} · {node_id}',
  // `selected_count`/`acted_count` sit in the highlight set on purpose (#4354):
  // "selected 30, acted 0" has to be visible on the run row itself, not one
  // drill-down away — a signal you must click to find is a signal nobody sees.
  highlightFields: ['flow_name', 'node_id', 'status', 'selected_count', 'acted_count', 'correlation', 'started_at', 'updated_at'],

  fields: {
    id: Field.text({ label: 'Run ID', required: true, readonly: true, group: 'System' }),

    // [#10101, the cloud#1395 Option A ruling] The SUBJECT record's
    // organization, with the acting context as fallback — resolved by the
    // SHARED platform-row resolver (`resolveRecordOrganizationField`,
    // `@objectstack/metadata-core`) in `ObjectStoreSuspendedRunStore`, from
    // the trigger-record snapshot, on BOTH write paths (a paused row's
    // `serialize()` and a terminal row's `recordTerminal()` — same inputs,
    // same precedence, so the two rows of one run agree by construction).
    //
    // Why subject-first: the schedule, time-relative and api triggers carry no
    // acting tenant at all, by construction, so the pre-#10101 actor-only read
    // measured 31 of 31 rows org-less on a walled HotCRM SaaS boot — each row
    // naming a `trigger_object` / `trigger_record_id` that DOES belong to a
    // specific customer. Subject-first is what `sys_audit_log`'s writer
    // already did (#8707 honouring #8287's ruling); three platform side
    // tables, one answer now. A trigger with no record (a plain scheduled
    // sweep has no ONE subject) keeps the acting-context fallback — NULL there
    // stays NULL: fabricating an acting organization stays vetoed (Option C).
    //
    // Promoted from the cloud#1395 pinned-defect state by #10101: the
    // framework pin (`suspended-run-store.test.ts`, formerly 'PINNED: a
    // tenant-less trigger context…') now asserts the resolved organization;
    // the two cloud-side pins (`hotcrm-multitenant.acceptance.ts`, check `a4`
    // in `verify-hotcrm-saas.mjs`) are tracked on cloud#1395 and follow at the
    // next `.objectstack-sha` bump.
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      // Reworded with the #10101 write-side fix (was "Tenant that owns this
      // run (propagated from the trigger context)" — ADR-0120 §Terminology
      // requires "organization", and the value is subject-first now).
      // Extracted into the generated i18n bundles as `help`; the four locales
      // regenerate in the same pass.
      description: 'Organization of the record that triggered this run (falls back to the acting context when the trigger has none)',
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

    node_type: Field.text({
      label: 'Node Type',
      required: false,
      maxLength: 255,
      description: 'Registry type of the node a suspended run paused at (approval / screen / wait / …). Keys the resume authorization gate (#3801) — captured at suspend time rather than re-read from a flow that may have been republished since. Null on rows written before the gate shipped, and on terminal history rows — except (since #13909) the one class of terminal row that carries a restorable consumed suspension (a run whose resume consumed its pause and then failed downstream), which keeps the paused node\'s type so a restore re-arms the gate.',
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

    // ── Trigger attribution (#7533) ────────────────────────────────────────
    // COLUMNS for the same reason `selected_count` / `acted_count` are (#4354),
    // and the reason is sharper here: both questions this answers are QUERIES,
    // not readings of a single row. "Which runs did this record provoke?" is a
    // filter on `trigger_object` + `trigger_record_id`; "was last night's
    // failure storm scheduled or record-driven?" is a group-by on
    // `trigger_type`. Folded into `context_json` they would be legible one row
    // at a time and unqueryable in aggregate — and `context_json` is not
    // written on terminal history rows (except, since #13909, the one class of
    // terminal row that carries a restorable consumed suspension — a run whose
    // resume consumed its pause and then failed downstream; every other
    // terminal row still has none), which is how the durable copy of the run
    // log ended up strictly less informative than the in-memory one.
    trigger_type: Field.text({
      label: 'Trigger Type',
      required: false,
      maxLength: 255,
      description: 'What fired this run — the runtime trigger event (record-after-update / schedule / api / time_relative / manual / …). Null on rows written before #7533, which is NOT the same as "no trigger": every run has one.',
      group: 'Trigger',
    }),

    trigger_object: Field.text({
      label: 'Trigger Object',
      required: false,
      maxLength: 255,
      description: 'Object whose record fired this run. Null for kinds that carry no record (schedule, api without a record context).',
      group: 'Trigger',
    }),

    // [#11386] DELIBERATELY NOT DECLARED `referenceVia: 'trigger_object'` —
    // the recorded "stays undeclared" verdict the card's acceptance sketch
    // asks for, kept at the site so the next survey of this idiom finds the
    // reasoning instead of re-deriving it (or sweeping it).
    //
    // The SHAPE fits: `serialize()` stamps `trigger_object: ctx.object` beside
    // `trigger_record_id: ctx.record.id`, so this really is the same (object
    // half, id half) pointer `sys_activity`, `sys_audit_log`,
    // `sys_approval_request`, `sys_record_share` and `sys_share_link` carry,
    // and the `{trigger_object, trigger_record_id}` index queries it the same
    // way. The four objects adopted in #11386 declared on exactly that basis.
    //
    // What does NOT fit is the only thing the declaration currently ENFORCES:
    // seed-time resolution of an AUTHORED pointer. A `sys_automation_run` row
    // is not content about a record — it is the engine's own run state:
    //  - a `paused` row IS a live continuation. `SuspendedRunStore` loads
    //    every `{ status: 'paused' }` row on boot and rehydrates it, so an
    //    authored one is not sample data, it is a fabricated continuation the
    //    engine will try to resume against `variables_json` / `steps_json` /
    //    `context_json` snapshots no real run produced.
    //  - a terminal row is telemetry under this object's own retention
    //    contract (`class: 'telemetry'`, 30d sweep scoped to
    //    completed/failed), so seeded run history deletes itself on the first
    //    Reaper pass that reaches its age.
    //  - the row has no natural key to be addressed BY: `nameField: 'id'`,
    //    the id is the engine's raw `runId`, and the object declares no `name`
    //    field at all — the seed loader's default externalId does not exist
    //    here.
    // Declaring would therefore not make a real corpus resolvable; it would
    // advertise run rows as authorable seed content — precisely the wrong
    // signal for a metadata author (human or AI) reading the declaration as
    // permission.
    //
    // To flip this: land a consumer that reads the pair for something other
    // than seed authoring (the #5180 delete-cascade carrier is the live
    // candidate — that card needs to know which columns form the pointer),
    // or a measured case for seeding runs. Not by sweep.
    trigger_record_id: Field.text({
      label: 'Trigger Record',
      required: false,
      maxLength: 255,
      description: 'Id of the record that fired this run — the correlation from a run back to its cause, and the reason the run log is usable as an audit trail for record_change flows. Null for record-less trigger kinds and for rows written before #7533.',
      group: 'Trigger',
    }),

    variables_json: Field.textarea({
      label: 'Variables',
      required: false,
      description: 'JSON snapshot of the flow variable map at suspend time. On a terminal row its PRESENCE is the discriminator (#13909): nothing but the consumed-suspension path writes it there, so variables_json present on a completed/failed row ⇔ the row carries a restorable suspension — the store\'s deserializer keys off exactly this.',
      group: 'State',
    }),

    steps_json: Field.textarea({
      label: 'Steps',
      required: false,
      description: 'JSON step log: for a paused run, the steps executed so far (resume state); for a terminal history row, the bounded per-node step log (durable run detail, #2585).',
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

    // ── Run summary (#4354) ────────────────────────────────────────────────
    // COLUMNS, not just a blob: `selected_count > 0 AND acted_count = 0` is the
    // first FILTER of the broken-sweep detector, and an operator can only alert
    // on what is filterable. Buried inside `summary_json` these would be
    // readable but not queryable — the difference between a dashboard and an
    // alarm.
    //
    // [#12685] A filter, not the detector — and the description used to say
    // otherwise. Measured A/B through the real engine (pinned in
    // `run-summary.test.ts`, and downstream in hotcrm's
    // `flow-run-summary.test.ts`): a healthy idempotent sweep — re-select the
    // same records, gate each one on "already handled" — and a dead gate BOTH
    // report `selected > 0, acted 0, unmeasured 0`. "Over N consecutive runs"
    // does not separate them: the healthy steady state is persistent for as
    // long as the outstanding work stands, so it trips on EVERY run;
    // consecutiveness filters flapping, which is a different failure. The
    // discrimination lives in the per-node fold (`summary_json.nodes[]` /
    // `gates[]`) and is spelled out in `acted_count`'s description, which is
    // what an operator wiring an alert actually reads. Worth the words because
    // the failure mode is silent: a detector that fires during normal operation
    // gets muted, and a muted broken-sweep detector is the same silence #4347
    // produced — except it now looks monitored.
    selected_count: Field.number({
      label: 'Records Selected',
      required: false,
      description: 'Records this run READ across its data nodes. Null on rows written before run summaries existed — which is NOT the same as zero.',
      group: 'Outcome',
    }),

    acted_count: Field.number({
      label: 'Records Acted On',
      required: false,
      description: 'Records this run created / updated / deleted, plus effects dispatched (notifications delivered). `selected_count > 0 AND acted_count = 0 AND unmeasured_count = 0` is the FIRST FILTER for a broken sweep, not a verdict: a healthy idempotent sweep that re-selects the same records and gates each one on "already handled" satisfies it on every run while that work stands, so "over N consecutive runs" does not separate the two. `summary_json` does: a healthy skip is accounted for by a read this run performed — the lookup the gate depends on shows `runs > 0` and `selected > 0` in `nodes[]` — while a dead gate skips just as often with nothing behind it (`runs: 0`, or `selected: 0`).',
      group: 'Outcome',
    }),

    skipped_count: Field.number({
      label: 'Gate Skips',
      required: false,
      description: 'Node executions a closed gate prevented — one per loop iteration whose conditional edge evaluated false. Many skips with no writes names the gate as the suspect; `summary_json` is what convicts or clears it — `gates[]` names which edge closed and how often, and `nodes[]` says whether the lookup that gate depends on ran and found anything (see `acted_count`).',
      group: 'Outcome',
    }),

    unmeasured_count: Field.number({
      label: 'Uncountable Effects',
      required: false,
      description: 'Executions that reached something the platform cannot count (a `connector_action`, a mutating `http` call whose response was lost). The qualifier `acted_count` needs to be trusted: the broken-sweep filter is `selected_count > 0 AND acted_count = 0 AND unmeasured_count = 0` (a filter, not a verdict — see `acted_count`), because a run with uncountable effects has an INCOMPLETE acted count, not a zero one. Null on rows written before this was tracked.',
      group: 'Outcome',
    }),

    summary_json: Field.textarea({
      label: 'Run Summary',
      required: false,
      description: 'JSON per-node breakdown (terminal status, runs, failures, selected/acted) plus which gates closed and how often. Folded from the FULL step log, so its counts stay exact even when `steps_json` is compacted.',
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
    // Retention age sweep: delete terminal rows older than the window (#2585).
    { fields: ['status', 'created_at'] },
    // Look up a suspended run by the pausing node's correlation key.
    { fields: ['correlation'] },
    // "Which runs did this record provoke?" (#7533) — the reverse-correlation
    // read an audit of a suspicious record starts from. Object first: it is the
    // lower-cardinality prefix, and it also serves the object-only scan
    // ("everything automation did to crm_deal").
    { fields: ['trigger_object', 'trigger_record_id'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: written only by the automation runner / suspended
    // run store (SYSTEM_CTX), never via the generic data API. Reads stay open.
    apiMethods: ['get', 'list'],
  },
});
