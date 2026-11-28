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
 * answers. The action answers once the build holds the source's build lease
 * and its start is in the source's sync state, or refuses (exit 1) when the
 * build did not start: another node holds the source's build, or the cluster
 * lock did not answer. Then, unless `--no-wait`, the command reads
 * `index_status` every `--interval` seconds and prints the build's progress
 * until it ends. With `--no-wait` it exits 0 once the build has started and
 * reports no outcome: the build may still end `failed`, `lease-lost` (its
 * cluster lease was lost mid-build), `timed-out` (no page finished within
 * the build's bound) or `interrupted` (its node stopped), which
 * `os knowledge status` then shows.
 *
 * The progress it reads is the source's sync state: one durable record per
 * source, the same whichever node answers a read, so behind a load balancer
 * every poll reads this build. A poll is matched to this build by its start
 * time. What stays per node on the `memory` adapter is the index itself: it
 * lives in each server process, so the build fills the index of the node
 * that ran it only, and the command says so when the build ends.
 *
 * Exits 0 when the record says the build is `done`; 1 when it says the build
 * ended any other way, when the record names a later build (this one's
 * outcome is then not kept: the record holds the last build only), when the
 * server refused, and when `--timeout` seconds of polls (counted as polls
 * times `--interval`) passed without reading this build in the record (the
 * sync state could not be read or written): the command says it stopped
 * following, and the build may still be running.
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
    timeout: Flags.integer({
      description:
        'Seconds of polls (polls times --interval) to keep following while no read finds this build in the source\'s sync state; then exit 1 saying the build may still be running',
      default: 600,
      min: 1,
    }),
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
    if (!flags.wait) {
      // Exit 0 here says "started", never "built": the build can still end
      // failed, lease-lost, timed-out or interrupted.
      this.log('Not followed (--no-wait): the build may still fail. Read its outcome with os knowledge status.');
      return;
    }
    const startedBuild = started.details.build as KnowledgeBuildView | null | undefined;
    const startedAt = startedBuild?.startedAt;
    const startedMs = startedAt === undefined ? NaN : Date.parse(startedAt);

    let lastLine = '';
    let unseenSeconds = 0;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, flags.interval * 1000));
      const read = await runKnowledgeAction(target, 'index_status', { source: args.source });
      if (!read.ok) {
        this.error(`The build's progress could not be read: ${read.message}`, { exit: 1 });
        return;
      }
      const entry = firstSource(read.details);
      const build = entry?.build ?? undefined;
      if (build && (startedAt === undefined || build.startedAt === startedAt)) {
        unseenSeconds = 0;
        const line = describeBuild(build);
        if (line !== lastLine) {
          this.log(line);
          lastLine = line;
        }
        if (build.status === 'running') continue;
        if (build.status === 'done') {
          if (build.message) this.log(build.message);
          if (entry?.adapter === MEMORY_ADAPTER) {
            this.log(
              'The memory adapter keeps its index in each server process: this build filled the index of the node that ran ' +
                'it only, and every other node keeps its own.',
            );
          }
          return;
        }
        this.error(build.message ?? `The build ended ${build.status ?? 'without a status'}.`, { exit: 1 });
        return;
      }
      const laterMs = build?.startedAt === undefined ? NaN : Date.parse(build.startedAt);
      if (build && laterMs > startedMs) {
        this.error(
          `The source's sync state now names a later build (${build.trigger ?? '?'}, started ${build.startedAt}): the build ` +
            'this command started ended before it, and its outcome is not kept (the record holds the last build only). ' +
            'Read the later build with os knowledge status.',
          { exit: 1 },
        );
        return;
      }

      // The record does not name this build: its start was not written, or
      // the sync state could not be read. Never a failure on its own.
      const line =
        "the source's sync state does not name this build" +
        (entry?.syncStateError ? `: ${entry.syncStateError}` : build ? ` (it names one started ${build.startedAt ?? '?'})` : ' (it names no build)');
      if (line !== lastLine) {
        this.log(line);
        lastLine = line;
      }
      unseenSeconds += flags.interval;
      if (unseenSeconds >= flags.timeout) {
        this.error(
          `Stopped following after ${flags.timeout}s of progress reads that did not find this build in the source's sync ` +
            'state. The build may still be running on the node that started it: read its outcome with os knowledge status, ' +
            'and the server log of that node.',
          { exit: 1 },
        );
        return;
      }
    }
  }
}

/** The adapter whose index lives in one process's memory: each node holds its own. */
const MEMORY_ADAPTER = 'memory';

/** The one source of an `index_status` answer for a single source. */
function firstSource(details: Record<string, unknown>): KnowledgeSourceView | undefined {
  return (Array.isArray(details.sources) ? (details.sources as KnowledgeSourceView[]) : [])[0];
}
