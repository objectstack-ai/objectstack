// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import {
  describeBuild,
  describeFailures,
  resolveKnowledgeTarget,
  runKnowledgeAction,
  type KnowledgeQueueView,
  type KnowledgeSourceView,
} from '../../utils/knowledge-actions.js';

/**
 * `os knowledge status [source]` — what each knowledge source's index holds
 * against what the server expects of it, the source's last build (its
 * progress while it runs, its result once it ended), its record syncs that
 * failed and are not yet repaired, and the record syncs waiting on the queue.
 *
 * Calls the `knowledge` settings namespace's `index_status` action, which
 * admits an administrator only. The last build and the failed syncs are the
 * source's sync state: one durable record per source, the same whichever
 * node answers and kept across restarts. The index state is the store's own:
 * the same on every node when the adapter's store is shared, and per node on
 * the `memory` adapter, whose index lives in each process.
 */
export default class KnowledgeStatus extends Command {
  static override description =
    'Show each knowledge source\'s index state (built, never built, needs a rebuild), its last build with its progress or result, and its record syncs that failed';

  static override examples = [
    '$ os knowledge status',
    '$ os knowledge status support_articles',
  ];

  static override args = {
    source: Args.string({ description: 'The knowledge source, by the name this command lists it under (NAMESPACE-NAME for a package\'s source); every source when omitted', required: false }),
  };

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token (an administrator\'s)', env: 'OS_TOKEN' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(KnowledgeStatus);
    const target = resolveKnowledgeTarget(flags);
    const answer = await runKnowledgeAction(target, 'index_status', args.source ? { source: args.source } : {});
    if (!answer.ok) {
      this.error(answer.message, { exit: 1 });
      return;
    }
    const sources = Array.isArray(answer.details.sources) ? (answer.details.sources as KnowledgeSourceView[]) : [];
    if (sources.length === 0) {
      this.log('No knowledge source is registered on this server.');
      return;
    }
    for (const source of sources) {
      const held = source.packageId ? `, package ${source.packageId}` : '';
      this.log(`${source.id}  (${source.label ?? source.id}; adapter ${source.adapter ?? '?'}${held})`);
      const index = source.index;
      this.log(`  index: ${index?.state ?? 'unknown'}${index?.due ? ' — a build is due' : ''}${index?.detail ? ` — ${index.detail}` : ''}`);
      this.log(source.build ? `  last build: ${describeBuild(source.build)}` : '  last build: none recorded');
      const note = source.build?.message;
      if (note) this.log(`    ${note}`);
      if (source.failures) {
        this.log(`  failed syncs: ${describeFailures(source.failures)}`);
        if ((source.failures.count ?? 0) > 0 && source.failures.lastError) this.log(`    ${source.failures.lastError}`);
      } else {
        this.log(`  sync state: not read${source.syncStateError ? ` — ${source.syncStateError}` : ''}`);
      }
      if (source.adapter === 'memory') {
        this.log('  (the memory adapter keeps its index in each server process: the index state above is the answering node\'s own)');
      }
    }
    const queue = answer.details.queue as KnowledgeQueueView | undefined;
    if (queue) {
      this.log(
        queue.pending !== undefined
          ? `record syncs waiting on queue ${queue.queue ?? '?'}: ${queue.pending} (every source's together)`
          : `record syncs waiting on queue ${queue.queue ?? '?'}: not read${queue.error ? ` — ${queue.error}` : ''}`,
      );
    }
  }
}
