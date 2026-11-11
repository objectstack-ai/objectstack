// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_sync_run — one row per pull of a `mapping`'s source (ADR-0153 D7).
 *
 * A job's `pull` drives `IAutomationService.pullConnectorSource`
 * (`./connector-pull.ts`), and every call writes one row here through
 * {@link ObjectStoreSyncRunLedger} (`./sync-run-ledger.ts`): opened `running`
 * before the mapping is read, described once the source is known, given the
 * read position at each window's end, and closed `completed`, `degraded` or
 * `failed` when the pull ends.
 *
 * ## Why its own object (ADR-0153 D7)
 *
 * `sys_job_run` is deployment-level (ADR-0131 D7: no organization column),
 * readable only with `manage_platform_settings`, kept 30 days as telemetry and
 * generic to every job. A pull's run is organization data, and its committed
 * read position must outlive a telemetry window. So this object is
 * organization-owned and keeps the position:
 *
 * - **The read position.** A datasource pull commits the canon-step position it
 *   reached at each window's end (ADR-0153 D2, invariants 8 and 9) into
 *   `watermark_committed`, and the next pull of the same mapping in the same
 *   organization starts there (`full: true` excepted). A mapping is addressed
 *   by `(package, name)` (ADR-0150 D3), so the position is kept per holder
 *   package (`mapping_package`), mapping name and organization, and it is
 *   used only by a run that reads the same source object on the same field
 *   into the same target (`target_object`). A run that stops part-way (a
 *   refusal, or a server that stopped) keeps the position of its last
 *   finished window, so the next run reads that window's successors again and
 *   nothing past it is skipped.
 * - **Retention never removes the latest committed run of a mapping.** The
 *   writer keeps `holds_position` true on that one row per holder package,
 *   mapping name and organization, and the retention below exempts it, with
 *   every `running` row. That is how the sweep keeps the read position (the open point ADR-0153
 *   D7 leaves to the engine card): a declared row filter the one platform
 *   sweep applies, not a second sweeper. The window is the job ledger's, 30
 *   days, never shorter (D7).
 * - **A run left `running` by a stopped server** is closed `failed` with
 *   `failure_reason: 'interrupted'` at the next boot of the automation plugin.
 *   Its committed position stands.
 *
 * Not here yet, each with the slice that writes it: the job run that drove the
 * pull and its trigger (`schedule` / `manual`), which need the job service to
 * hand its run to the handler; the marked-deleted count (ADR-0153 D3) and the
 * NULL-watermark count (invariant 11, read with D3's count).
 *
 * Writers: the automation plugin's pull (`./connector-pull.ts`,
 * `./datasource-pull.ts`) and its boot close, under a system context.
 * Readers: the next pull of the mapping, and the run history ADR-0153 D7 has
 * Studio show.
 *
 * @namespace sys
 */
export const SysSyncRun = ObjectSchema.create({
  name: 'sys_sync_run',
  label: 'Sync Run',
  pluralLabel: 'Sync Runs',
  icon: 'refresh-cw',
  isSystem: true,
  managedBy: 'engine-owned',
  // ADR-0057: run history is telemetry, aged out after the job ledger's 30
  // days (ADR-0153 D7: never shorter than `sys_job_run`'s). `onlyWhen` keeps
  // two kinds of row regardless of age: a run still `running` (never matched by
  // the status list), and the one row per holder package, mapping name and
  // organization that holds the read position the next pull starts from
  // (`holds_position: true`).
  lifecycle: {
    class: 'telemetry',
    retention: {
      maxAge: '30d',
      onlyWhen: { status: { $in: ['completed', 'degraded', 'failed'] }, holds_position: false },
    },
  },
  description: 'One row per pull of a mapping: where it read from, what it wrote, how it ended, and the read position the next pull starts from.',
  displayNameField: 'mapping',
  nameField: 'mapping', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['mapping', 'status', 'started_at', 'read_count', 'created_count', 'updated_count', 'refused_count', 'watermark_committed'],

  fields: {
    id: Field.text({ label: 'Run ID', required: true, readonly: true, group: 'System' }),

    // [ADR-0153 D7, ADR-0131] The organization the pull ran in: the job's
    // (`context.tenantId`). A pull in no organization is written with none,
    // and under `single` the engine stamps the Default Organization on that
    // row (ADR-0131 D10): that is why the ledger reads the stored value back
    // when it opens a run and scopes the run by it. Empty only where nothing
    // stamps an organization.
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      readonly: true,
      group: 'System',
      description: 'The organization the pull ran in: the organization of the job that drove it.',
    }),

    mapping: Field.text({
      label: 'Mapping',
      required: true,
      readonly: true,
      maxLength: 255,
      searchable: true,
      group: 'Identity',
      description: 'The mapping whose source was pulled.',
    }),

    // [ADR-0153 D7, ADR-0150 D3] The package that holds the mapping `mapping`
    // names, as the pull resolved it: the holder, not the caller (a job's
    // package reading a dependency's mapping records the dependency). Beside
    // the name, it is the key the read position is kept by. Empty for a
    // mapping the environment authored, or one no package holds. Width: the
    // package-id class.
    mapping_package: Field.text({
      label: 'Mapping Package',
      required: false,
      readonly: true,
      maxLength: 255,
      group: 'Identity',
      description: 'The app the mapping comes from. Filled in by the platform; empty for mappings created here.',
    }),

    // [ADR-0153 D7] The mapping's `targetObject` on this run: a stored
    // position is used only by a run that writes the same target, so a
    // mapping whose target was changed starts its new target from the start.
    target_object: Field.text({
      label: 'Target Object',
      required: false,
      readonly: true,
      maxLength: 255,
      group: 'Identity',
      description: 'The object the pulled rows were written to. Empty when the pull was refused before the mapping was read.',
    }),

    source_kind: Field.select(['connector', 'datasource'], {
      label: 'Source Kind',
      required: false,
      readonly: true,
      group: 'Identity',
      description: 'Which source the mapping declares: `connectorSource` or `datasourceSource`. Empty when the pull was refused before the mapping was read.',
    }),

    source: Field.text({
      label: 'Source',
      required: false,
      readonly: true,
      maxLength: 255,
      group: 'Identity',
      description: 'Where the rows came from: the federated object a datasource source names, or the connector instance a connector source names.',
    }),

    datasource: Field.text({
      label: 'Datasource',
      required: false,
      readonly: true,
      maxLength: 255,
      group: 'Identity',
      description: 'The datasource the federated object lives on. Empty for a connector source.',
    }),

    read_path: Field.select(['builtin', 'floored'], {
      label: 'Read Path',
      required: false,
      readonly: true,
      group: 'Identity',
      // [ADR-0153 D1] The two read paths.
      description: "How a datasource source was read: 'builtin', windows read whole and paged by the key; 'floored', a plugin driver read through the platform's row cap. Empty for a connector source.",
    }),

    status: Field.select(['running', 'completed', 'degraded', 'failed'], {
      label: 'Status',
      required: true,
      defaultValue: 'running',
      readonly: true,
      group: 'State',
      description: "'completed': every row read was written; 'degraded': the pull ended, but the import runner refused some rows (`refused_count`); 'failed': the pull was refused or stopped (`failure_reason`).",
    }),

    started_at: Field.datetime({ label: 'Started At', required: true, readonly: true, group: 'State' }),
    ended_at: Field.datetime({ label: 'Ended At', required: false, readonly: true, group: 'State' }),

    read_count: Field.number({
      label: 'Read',
      required: false,
      readonly: true,
      scale: 0,
      defaultValue: 0,
      group: 'Outcome',
      description: 'Rows the source answered and the pull handed to the writer.',
    }),
    created_count: Field.number({ label: 'Created', required: false, readonly: true, scale: 0, defaultValue: 0, group: 'Outcome' }),
    updated_count: Field.number({ label: 'Updated', required: false, readonly: true, scale: 0, defaultValue: 0, group: 'Outcome' }),
    refused_count: Field.number({
      label: 'Refused',
      required: false,
      readonly: true,
      scale: 0,
      defaultValue: 0,
      group: 'Outcome',
      description: 'Rows the import runner refused (a row verdict, not a refused pull).',
    }),

    watermark_field: Field.text({
      label: 'Watermark Field',
      required: false,
      readonly: true,
      maxLength: 255,
      group: 'Position',
      description: 'The field the read position is a value of: `datasourceSource.watermark.field`, or the connector source\'s watermark target.',
    }),

    watermark_from: Field.text({
      label: 'Read From',
      required: false,
      readonly: true,
      maxLength: 64,
      group: 'Position',
      description: 'Where the pull started reading: the position the last committed run stored, or `watermark.start` when none is stored (or the mapping declares `full: true`). An ISO date-time, an ISO date or an integer.',
    }),

    watermark_committed: Field.text({
      label: 'Committed Position',
      required: false,
      readonly: true,
      maxLength: 64,
      group: 'Position',
      // [ADR-0153 D2, invariants 8 and 9] Committed only at a window's end.
      description: "The read position this run committed at its last finished window: the next pull of the same mapping in this organization starts there, when it reads the same source object and field into the same target. Empty when the run wrote no row, and on a connector source, which keeps no position of its own here.",
    }),

    committed_at: Field.datetime({
      label: 'Committed At',
      required: false,
      readonly: true,
      group: 'Position',
      description: 'When `watermark_committed` was last written. The next pull reads the position of the run committed last.',
    }),

    holds_position: Field.boolean({
      label: 'Holds Read Position',
      required: false,
      readonly: true,
      defaultValue: false,
      group: 'Position',
      description: "True on the one run per mapping (its package and name) and organization whose committed position the next pull starts from. Retention never removes that row.",
    }),

    failure_reason: Field.text({
      label: 'Failure Reason',
      required: false,
      readonly: true,
      maxLength: 64,
      group: 'Outcome',
      description: "Why a failed run ended: the pull's refusal reason (e.g. 'sync_bounds_not_pushed'), 'interrupted' for a run a stopped server left running, or 'failed'.",
    }),

    failure: Field.textarea({
      label: 'Failure',
      required: false,
      readonly: true,
      group: 'Outcome',
      description: "The platform's sentence for a failed run. Never a remote driver's or upstream service's own text.",
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
    // The next pull's read: the latest committed run of a mapping (package and
    // name) in an organization.
    { fields: ['mapping', 'mapping_package', 'organization_id', 'committed_at'] },
    // Run history: the newest runs of a mapping.
    { fields: ['mapping', 'started_at'] },
    // The boot close (`status = 'running'`) and the retention sweep.
    { fields: ['status', 'created_at'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: written only by the pull and its boot close
    // (system context), never through the generic data API. Reads stay open.
    apiMethods: ['get', 'list'],
  },
});
