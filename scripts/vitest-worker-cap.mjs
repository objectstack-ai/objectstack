// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Prints the value for `VITEST_MAX_WORKERS` — the bound on vitest's INNER
 * worker pool — for the root `test` script to export into `turbo run test`.
 *
 * ## Why this exists at all (#11958)
 *
 * Two fan-outs multiply and neither bounds the other:
 *
 *   OUTER  `turbo run test --concurrency=50%`  — how many package `test` tasks
 *          run at once. Bounded as a share of the host's cores (#11954/#11938).
 *   INNER  vitest's own pool inside EACH of those tasks. Unbounded: 40 of this
 *          repo's 41 `vitest.config.ts` files say nothing about pool sizing
 *          (the one mention, in `packages/cli`, is a COMMENT recording a
 *          rejected lever), so every package takes vitest's default, which is
 *          `max(availableParallelism() - 1, 1)` — i.e. it scales with the
 *          HOST's core count, not with the shard it was given.
 *
 * Peak concurrent test-worker processes is therefore `outer × inner`, and both
 * terms grow with core count, so the product grows QUADRATICALLY. Measured on
 * a 4-CPU/15GB container, the product law holds exactly — 2×3=6, 4×3=12,
 * 4×2=8, 4×1=4 workers observed for those combinations.
 *
 * ## Why a CAP, computed here, and not a flat pinned number
 *
 * ⚠️ vitest's `maxWorkers` is a PIN, not a ceiling: `resolveMaxWorkers()`
 * returns the configured value outright rather than `min()`-ing it with the
 * default. Measured: `VITEST_MAX_WORKERS=4` on this 4-core box produced 8
 * concurrent workers at outer=2, where the DEFAULT produces 6. A flat number
 * small enough to protect a 64-core box would tax every small box, and a flat
 * number chosen for comfort would RAISE the count on small boxes. So the cap is
 * applied here, against this host's own core count, and only ever lowers.
 *
 * The ceiling is 4 rather than 1-2 because oversubscription is what makes this
 * suite fast — its cost is dominated by module IMPORT, not CPU. Holding the
 * ceiling at 4 keeps today's oversubscription ratio roughly constant as core
 * count grows (total ≈ 2 × cores) instead of letting it grow with the box.
 *
 * ## What it buys, measured in the regime where it binds
 *
 * On the 7-package fleet at outer=2, emulating a larger box by setting the
 * inner pool explicitly (peak RSS is of the vitest processes only):
 *
 *   inner=8 (a 9-core box's default)   16 workers   5700 MB workers   93s
 *   inner=4 (this cap)                  8 workers   2475 MB workers   95s
 *
 * -57% worker RSS for ~0 wall-clock (93s vs 95s is inside this box's run-to-run
 * noise; two same-config repeats differed by 17s). On a host with <= 5 cores
 * this file returns the default unchanged, so it is a NO-OP for every box the
 * project runs on today, CI runners included — which is the point: it bounds
 * growth without taxing anyone now.
 *
 * ## The silent no-op this is paired with
 *
 * ⚠️ Exporting this variable does NOTHING on its own. Turbo filters task
 * environments, so the variable must also be declared in `turbo.json`
 * (`globalPassThroughEnv`). Measured before that line existed:
 * `VITEST_MAX_WORKERS=1` through turbo spawned 3 workers — the unbounded
 * default — while the same variable on a direct `vitest run` spawned 1. If you
 * change either half, verify by OBSERVING the worker count (`ps` for
 * `--experimental-import-meta-resolve` children), never by the value being
 * accepted without error.
 *
 * ⚠️ The value must be a plain integer. vitest reads this variable with
 * `Number.parseInt`, so a percentage — the spelling turbo's `--concurrency`
 * accepts — is silently truncated: `VITEST_MAX_WORKERS=50%` means FIFTY
 * workers, not half the box.
 */

import os from 'node:os';
import { isEntrypoint } from './invoked-as.mjs';

/** vitest's own default: `max(availableParallelism() - 1, 1)` (non-watch). */
export function vitestDefaultWorkers(cores) {
  return Math.max(cores - 1, 1);
}

/** The ceiling. Only ever lowers vitest's default — never raises it. */
export const WORKER_CEILING = 4;

export function workerCap(cores) {
  return Math.min(vitestDefaultWorkers(cores), WORKER_CEILING);
}

/**
 * Resolves the value to print. An explicit value from the environment wins: a
 * developer profiling one package, or a CI job that knows its own runner, is a
 * better judge of its shard than this file's host-relative guess. Only a
 * positive integer is honoured — anything else falls through to the computed
 * cap rather than reaching vitest as NaN.
 */
export function resolveValue(env = process.env) {
  const override = Number.parseInt(env.VITEST_MAX_WORKERS ?? '', 10);
  if (Number.isInteger(override) && override > 0) return override;
  const cores =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return workerCap(cores);
}

// Guarded per `check:entry-guard`: this file exports bindings, so its top level
// must not run inside an importer.
if (isEntrypoint(import.meta.url)) {
  // A non-integer here would reach vitest as NaN and break the pool, so the
  // output is validated rather than trusted. An empty value is vitest's own
  // "use the default" signal, which is the safe way to fail.
  const value = resolveValue();
  process.stdout.write(Number.isInteger(value) && value > 0 ? String(value) : '');
}
