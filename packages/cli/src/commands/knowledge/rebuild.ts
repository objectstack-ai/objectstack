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
 * seconds and prints the build's progress until it ends. With `--no-wait`
 * it exits 0 once the build has started and reports no outcome: the build
 * may still end `not-run` (another node holds the source's lock) or
 * `failed`, which only `os knowledge status` then shows.
 *
 * Behind a load balancer. The build record lives in memory on the node that
 * runs the build, so a progress read can land on a node that holds no record
 * of this build. Such a poll is not a failure: the command falls back to the
 * index state, which the store reports and which is the same on every node.
 * The index state was read once before the rebuild started; when it was not
 * `current` then (never built, a new fingerprint, a changed recipe),
 * `current` now means a complete build has recorded itself (the adapter
 * records it only at a build's end), and the command exits 0, saying the
 * counts were not read. When the index was already `current`, or its state
 * was not read, it cannot tell a running build from a finished one, and the
 * command keeps polling until a read reaches the building node.
 *
 * Exits 0 when the build finished (its record says `done`, or the index
 * turned `current`), 1 when its record says it did not run or did not
 * finish, when the server refused, and when `--timeout` seconds of polls
 * (counted as polls times `--interval`) passed without reading this build's
 * record or seeing the index turn `current`: the command says it stopped
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
    source: Args.string({ description: 'The knowledge source id', required: true }),
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
        'Seconds of polls (polls times --interval) to keep following while no read reaches this build\'s record and the index has not turned current; then exit 1 saying the build may still be running',
      default: 600,
      min: 1,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(KnowledgeRebuild);
    const target = resolveKnowledgeTarget(flags);

    // The index state before the build: the only baseline against which the
    // store's state can say a build completed (due before, current after).
    let indexBefore: KnowledgeSourceView['index'];
    if (flags.wait) {
      const before = await runKnowledgeAction(target, 'index_status', { source: args.source });
      if (!before.ok) {
        this.error(before.message, { exit: 1 });
        return;
      }
      indexBefore = firstSource(before.details)?.index;
    }

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
    const indexWasCurrent = indexBefore?.state === undefined || indexBefore.state === 'current';

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
        // The node that answered is the one running this build: its record decides.
        unseenSeconds = 0;
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

      // Another node answered (behind a load balancer): no record of this
      // build there. Never a failure on its own; the store's index state is.
      const index = entry?.index;
      if (!indexWasCurrent && index?.state === 'current') {
        this.log(
          'The index is current: a complete build has recorded itself in the store. The node that answered holds no ' +
            'record of this build, so its counts are not shown (os knowledge status shows them when it reaches the node that ran it).',
        );
        return;
      }
      const line =
        `answered by a node that is not running this build; the store's index state: ${index?.state ?? 'unknown'}` +
        (!indexWasCurrent
          ? ' (waiting for it to turn current)'
          : ' (it was current, or unread, before this rebuild, so it cannot show when this build ends; waiting for a read that reaches the node running it)');
      if (line !== lastLine) {
        this.log(line);
        lastLine = line;
      }
      unseenSeconds += flags.interval;
      if (unseenSeconds >= flags.timeout) {
        this.error(
          `Stopped following after ${flags.timeout}s of progress reads that reached no record of this build and did not ` +
            'see the index turn current (behind a load balancer, the reads may keep landing on other nodes). The build may ' +
            'still be running on the node that started it: read its outcome with os knowledge status.',
          { exit: 1 },
        );
        return;
      }
    }
  }
}

/** The one source of an `index_status` answer for a single source. */
function firstSource(details: Record<string, unknown>): KnowledgeSourceView | undefined {
  return (Array.isArray(details.sources) ? (details.sources as KnowledgeSourceView[]) : [])[0];
}
