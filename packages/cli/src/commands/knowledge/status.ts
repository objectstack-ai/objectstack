// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import {
  describeBuild,
  resolveKnowledgeTarget,
  runKnowledgeAction,
  type KnowledgeSourceView,
} from '../../utils/knowledge-actions.js';

/**
 * `os knowledge status [source]` — what each knowledge source's index holds
 * against what the server expects of it, and the last build the answering
 * node ran: its progress while it runs, its result once it ended.
 *
 * Calls the `knowledge` settings namespace's `index_status` action, which
 * admits an administrator only. A build record lives on the node that ran
 * the build: behind a load balancer, the node that answers may not be the one
 * building; the index state it reads is the store's own.
 */
export default class KnowledgeStatus extends Command {
  static override description =
    'Show each knowledge source\'s index state (built, never built, needs a rebuild) and the last build the server ran, with its progress or result';

  static override examples = [
    '$ os knowledge status',
    '$ os knowledge status support_articles',
  ];

  static override args = {
    source: Args.string({ description: 'The knowledge source id; every source when omitted', required: false }),
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
      this.log(`${source.id}  (${source.label ?? source.id}; adapter ${source.adapter ?? '?'}, ${source.kind ?? '?'} source)`);
      const index = source.index;
      this.log(`  index: ${index?.state ?? 'unknown'}${index?.due ? ' — a build is due' : ''}${index?.detail ? ` — ${index.detail}` : ''}`);
      this.log(`  last build on this node: ${source.build ? describeBuild(source.build) : 'none'}`);
      const note = source.build?.message;
      if (note) this.log(`    ${note}`);
    }
  }
}
