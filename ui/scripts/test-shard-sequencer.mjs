// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * test-shard-sequencer -- the vitest `sequence.sequencer` that makes
 * `--shard=N/M` split by measured duration (objectui#12208, ruling 6121816480,
 * letter B). Wired in `vitest.config.mts`; the decision itself is
 * `scripts/test-shard-partition.mjs`, which says why the hash split had to go.
 *
 * Vitest 4.1.10 reads `config.sequence.sequencer` from the ROOT config only,
 * constructs it once per run, and calls its `shard(files)` with every test
 * specification of the run whenever `--shard` is set, before `sort(files)`.
 * `sort()` is inherited unchanged: the order WITHIN a leg (failed first, then
 * slowest first, from vitest's own cache) is not this card's subject.
 *
 * The timings are imported, not read off the disk at run time, so the root
 * config's relative import closure reaches `scripts/test-shard-timings.json`:
 * `scripts/select-affected-tests.mjs` treats a change to anything in that
 * closure as a full run, which is what a pull request that moves the
 * partition owes -- every file lands on a new leg next to new neighbours.
 *
 * A leg prints one line naming its share of the plan (`describePlan`). That is
 * a reading for the person staring at a long leg, never a verdict.
 *
 * A dataset with no file in it -- the shape before the first measurement was
 * committed -- falls back to vitest's own `BaseSequencer.shard()`, unchanged:
 * the partition moves only when there is a measurement to move it by.
 */

import path from 'node:path';

import { BaseSequencer } from 'vitest/node';

import { datasetWeights, describePlan, planShards } from './test-shard-partition.mjs';
import timings from './test-shard-timings.json' with { type: 'json' };

const toPosix = (/** @type {string} */ p) => p.split(path.sep).join('/');

export default class TestShardSequencer extends BaseSequencer {
  /**
   * @param {import('vitest/node').TestSpecification[]} files
   * @returns {Promise<import('vitest/node').TestSpecification[]>}
   */
  async shard(files) {
    const { config } = this.ctx;
    const { index, count } = /** @type {{ index: number, count: number }} */ (config.shard);
    const specs = files.map((spec) => ({
      path: toPosix(path.relative(config.root, spec.moduleId)),
      project: spec.project.name,
    }));
    // A dataset that holds no measurement yet is not a reason to invent one:
    // the split is then vitest's own, byte for byte, and the leg says so.
    if (datasetWeights(timings).size === 0) {
      this.ctx.logger.log(`test-shard-sequencer: shard ${index}/${count}: the timings hold no file yet, so this is vitest's own path-hash split`);
      return super.shard(files);
    }
    const plan = planShards(specs, timings, count);
    this.ctx.logger.log(describePlan(plan, index, timings));
    return plan.bins[index - 1].map((i) => files[i]);
  }
}
