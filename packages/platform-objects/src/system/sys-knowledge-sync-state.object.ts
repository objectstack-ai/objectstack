// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_knowledge_sync_state — one row per knowledge source: its last build and
 * its record syncs that failed (ADR-0161).
 *
 * Declared here, beside the other deployment-level plumbing and its
 * translations, and registered by `KnowledgeServicePlugin`
 * (`@objectstack/service-knowledge`) with its manifest, the way the queue
 * plugin registers `sys_job_queue`: the object exists only where the
 * knowledge service is mounted.
 *
 * Row identity: one row per source, keyed by the source's index key (the key
 * its index is held under in the store, never its display name), so two
 * packages' sources of one name keep two rows. Every node of a deployment
 * reads and writes the same row, so every node answers the same, and a
 * restart forgets nothing.
 *
 * What a row holds:
 *
 * - **The source** as callers name it (`source`), the package that holds it,
 *   the adapter it binds to and the object it indexes.
 * - **The last build** (`build_*`): who started it (`boot`, `reload`,
 *   `operator`, `reconcile`), how it ended, when it started and ended, its
 *   counts, and one sentence. Written by the build when it starts, at most
 *   every ten seconds while it walks, and when it ends. A build a node that
 *   died left `running` is closed `interrupted` by the next boot, or by the
 *   next node that takes the source's build lease.
 * - **Sync failures** (`failure_count`, `first_failed_at`, `last_failed_at`,
 *   `last_error`): record syncs that spent every attempt and are dead letters
 *   on the record-sync queue, not yet repaired. One per dead letter, never one
 *   per attempt. A reconcile of the source that completes clears those that
 *   failed before its walk began (and removes their dead letters).
 *
 * ⛔ No row holds record content. `build_message` and `last_error` are the
 * platform's own sentences: an embedding provider's or a store's text, which
 * may quote a record, stays in the server log and is never written here.
 *
 * Deployment-level: no organization column (ADR-0131 D7). A source and its
 * index serve the whole deployment, and the service writes every row under
 * the system identity. Who may read is object permission: the platform-only
 * capability below. Nothing but the service writes a row: the object is
 * engine-owned (the engine-owned write guard refuses every write that is not
 * the system's) and the data API offers it `get` and `list` only.
 *
 * Lifecycle: no `lifecycle` block on purpose (never swept). The service
 * removes a source's row when the source is removed. No run history is kept
 * here: the reconcile job's history is the job service's.
 *
 * @namespace sys
 */
export const SysKnowledgeSyncState = ObjectSchema.create({
  name: 'sys_knowledge_sync_state',
  label: 'Knowledge Sync State',
  pluralLabel: 'Knowledge Sync States',
  icon: 'activity',
  isSystem: true,
  managedBy: 'engine-owned',
  // [ADR-0131 D7] Deployment-level state: NO tenant column. The sole writer is
  // the knowledge service, under a system context, for a source that serves
  // every organization; there is no organization to stamp.
  systemFields: { tenant: false },
  requiredPermissions: ['manage_platform_settings'],
  description:
    'One row per knowledge source: its last build and its record syncs that failed and were not yet repaired. ' +
    'Written by the knowledge service only.',
  nameField: 'source', // [ADR-0079] canonical primary-title pointer
  highlightFields: ['source', 'build_status', 'build_finished_at', 'failure_count', 'last_failed_at'],

  fields: {
    id: Field.text({
      label: 'Source Key',
      required: true,
      readonly: true,
      maxLength: 255,
      group: 'Source',
      description: 'The key the source\'s index is held under in its store. One row per source.',
    }),

    source: Field.text({
      label: 'Source',
      required: true,
      readonly: true,
      maxLength: 255,
      searchable: true,
      group: 'Source',
      description: 'The source as callers name it: NAMESPACE-NAME for a package\'s source, the bare name otherwise.',
    }),

    package_id: Field.text({
      label: 'Package',
      required: false,
      readonly: true,
      maxLength: 255,
      group: 'Source',
      description: 'The package that holds the source. Empty for a source no package holds.',
    }),

    adapter: Field.text({
      label: 'Adapter',
      required: false,
      readonly: true,
      maxLength: 255,
      group: 'Source',
      description: 'The store the source\'s index lives in. Empty when the source names none and none could be placed.',
    }),

    object: Field.text({
      label: 'Object',
      required: false,
      readonly: true,
      maxLength: 255,
      group: 'Source',
      description: 'The object whose records the source indexes.',
    }),

    build_id: Field.text({
      label: 'Build ID',
      required: false,
      readonly: true,
      maxLength: 64,
      group: 'Last Build',
      description: 'Names the last build. A build writes its progress and its end only while this still names it.',
    }),

    build_trigger: Field.select(['boot', 'reload', 'operator', 'reconcile'], {
      label: 'Started By',
      required: false,
      readonly: true,
      group: 'Last Build',
      description:
        "Who started the last build: 'boot', the first build of a source at startup; 'reload', a source added or " +
        "changed while the server ran; 'operator', an administrator's rebuild; 'reconcile', the reconcile.",
    }),

    build_status: Field.select([
      'running',
      { label: 'done', value: 'done', color: 'green' },
      { label: 'failed', value: 'failed', color: 'red' },
      'lease_lost',
      'timed_out',
      { label: 'interrupted', value: 'interrupted', color: 'red' },
    ], {
      label: 'Build Status',
      required: false,
      readonly: true,
      group: 'Last Build',
      description:
        "How the last build ended: 'running' while it walks; 'done', every row was read and the index recorded the " +
        "build; 'failed', it did not finish; 'lease_lost', another node may build the source now; 'timed_out', no " +
        "page finished in time; 'interrupted', the node running it stopped. After any but 'done', the index keeps " +
        'what it held and the next reconcile, boot or rebuild builds again. Empty until the first build.',
    }),

    build_started_at: Field.datetime({ label: 'Build Started At', required: false, readonly: true, group: 'Last Build' }),
    build_finished_at: Field.datetime({ label: 'Build Finished At', required: false, readonly: true, group: 'Last Build' }),

    build_discovered: Field.number({
      label: 'Rows Read',
      required: false,
      readonly: true,
      scale: 0,
      group: 'Last Build',
      description: 'Rows the last build read.',
    }),
    build_indexed: Field.number({
      label: 'Documents Written',
      required: false,
      readonly: true,
      scale: 0,
      group: 'Last Build',
      description: 'Documents the last build wrote to the index (each one sent to the embedding provider).',
    }),
    build_skipped: Field.number({
      label: 'Unchanged',
      required: false,
      readonly: true,
      scale: 0,
      group: 'Last Build',
      description: 'Documents the index already held unchanged, so not written again.',
    }),
    build_purged: Field.number({
      label: 'Purged',
      required: false,
      readonly: true,
      scale: 0,
      group: 'Last Build',
      description: 'Documents removed because their row is gone or no longer matches. Empty when the build purged nothing.',
    }),
    build_failed: Field.number({
      label: 'Cannot Be Indexed',
      required: false,
      readonly: true,
      scale: 0,
      group: 'Last Build',
      description: 'Documents that cannot be indexed under the source\'s split, removed from the index.',
    }),

    build_message: Field.textarea({
      label: 'Build Message',
      required: false,
      readonly: true,
      maxLength: 1000,
      group: 'Last Build',
      description:
        "The platform's sentence for the last build. Never an embedding provider's or a store's own text: that is in " +
        'the server log of the node that ran the build.',
    }),

    failure_count: Field.number({
      label: 'Failed Syncs',
      required: false,
      readonly: true,
      scale: 0,
      defaultValue: 0,
      group: 'Sync Failures',
      description:
        "Record syncs that spent every attempt and wait as dead letters on the record-sync queue, not yet repaired. " +
        'A reconcile of the source that completes clears those that failed before it began.',
    }),
    first_failed_at: Field.datetime({
      label: 'First Failed At',
      required: false,
      readonly: true,
      group: 'Sync Failures',
      description: 'When the oldest failure counted above failed.',
    }),
    last_failed_at: Field.datetime({
      label: 'Last Failed At',
      required: false,
      readonly: true,
      group: 'Sync Failures',
      description: 'When the newest failure counted above failed.',
    }),
    last_error: Field.textarea({
      label: 'Last Error',
      required: false,
      readonly: true,
      maxLength: 500,
      group: 'Sync Failures',
      description:
        "The platform's sentence for the newest failure: the record, the attempts and the kind of error. Never a " +
        "field value of a record, and never the provider's own text.",
    }),

    created_at: Field.datetime({ label: 'Created At', readonly: true, group: 'System' }),
    updated_at: Field.datetime({ label: 'Updated At', readonly: true, group: 'System' }),
  },

  indexes: [
    // The boot close of builds a stopped node left running.
    { fields: ['build_status'] },
  ],

  enable: {
    trackHistory: false,
    fieldHistory: false, // [#36290] keeps this object's "no history": values off in the activity stream
    searchable: false,
    // [ADR-0103] Engine-owned: written only by the knowledge service (system
    // context), never through the generic data API. Reads stay open for the
    // Setup list, behind the object's permission.
    apiMethods: ['get', 'list'],
  },
});
