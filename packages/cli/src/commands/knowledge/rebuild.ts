// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import {
  describeBuild,
  resolveKnowledgeTarget,
  runKnowledgeAction,
  type KnowledgeBuildView,
  type KnowledgeSourceView,
} from '../../utils/knowledge-actions.js';

/**
 * `os knowledge rebuild <source>` — the administrator's rebuild of one
 * knowledge source (ADR-0161 K7): one complete build, the same walk the
 * server runs at boot for a source that was never built or needs a rebuild.
 *
 * Calls the `knowledge` settings namespace's `rebuild` action, which admits an
 * administrator only and starts the build in the background on the node that
 * answers; then, unless `--no-wait`, reads `index_status` every `--interval`
 * seconds and prints the build's progress until it ends. Exits 0 when the
 * build finished, 1 when it did not run or did not finish. With `--no-wait`
 * it exits 0 once the build has started and reports no outcome: the build
 * may still end `not-run` (another node holds the source's lock) or
 * `failed`, which only `os knowledge status` then shows.
 *
 * A build sends the content fields of every row the source's `where` matches,
 * except those the index already holds unchanged, to the embedding provider,
 * which bills for them.
 */
export default class KnowledgeRebuild extends Command {
  static override description =
    'Rebuild one knowledge source\'s index on the server and follow its progress (sends the source\'s content to the embedding provider, which bills for it)';

  static override examples = [
    '$ os knowledge rebuild support_articles',
    '$ os knowledge rebuild support_articles --no-wait',
  ];

  static override args = {
    source: Args.string({ description: 'The knowledge source, by the name `os knowledge status` lists it under (NAMESPACE-NAME for a package\'s source)', required: true }),
  };

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token (an administrator\'s)', env: 'OS_TOKEN' }),
    wait: Flags.boolean({
      description:
        'Follow the build until it ends (--no-wait exits 0 once it has started and does not report its outcome: read it with os knowledge status)',
      default: true,
      allowNo: true,
    }),
    interval: Flags.integer({ description: 'Seconds between two progress reads', default: 2, min: 1 }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(KnowledgeRebuild);
    const target = resolveKnowledgeTarget(flags);
    const started = await runKnowledgeAction(target, 'rebuild', { source: args.source });
    if (!started.ok) {
      this.error(started.message, { exit: 1 });
      return;
    }
    if (started.message) this.log(started.message);
    const startedBuild = started.details.build as KnowledgeBuildView | null | undefined;
    if (!flags.wait) {
      // Exit 0 here says "started", never "built": the build can still end
      // not-run (another node holds the lock) or failed.
      this.log('Not followed (--no-wait): the build may still not run or fail. Read its outcome with os knowledge status.');
      return;
    }
    const startedAt = startedBuild?.startedAt;

    let lastLine = '';
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, flags.interval * 1000));
      const read = await runKnowledgeAction(target, 'index_status', { source: args.source });
      if (!read.ok) {
        this.error(`The build's progress could not be read: ${read.message}`, { exit: 1 });
        return;
      }
      const entry = (Array.isArray(read.details.sources) ? (read.details.sources as KnowledgeSourceView[]) : [])[0];
      const build = entry?.build ?? undefined;
      if (!build || (startedAt !== undefined && build.startedAt !== startedAt)) {
        this.error(
          'The progress was answered by a server node that is not running this build (behind a load balancer, ' +
            'another node may have taken the request). The build continues on the node that started it; read it there ' +
            'with os knowledge status.',
          { exit: 1 },
        );
        return;
      }
      const line = describeBuild(build);
      if (line !== lastLine) {
        this.log(line);
        lastLine = line;
      }
      if (build.status === 'running') continue;
      if (build.status === 'done') {
        if (build.message) this.log(build.message);
        return;
      }
      this.error(build.message ?? `The build ended ${build.status ?? 'without a status'}.`, { exit: 1 });
      return;
    }
  }
}
