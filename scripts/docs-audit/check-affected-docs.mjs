#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-affected-docs (#9187) — the discoverable name for affected-docs.mjs's
 * own `--self-test`, which pins the change classifiers, the package-root derivation
 * and (since #9192) the symbol / route / SDK anchor derivation that decides which
 * hand-written pages a code change is advertised against.
 *
 *   node scripts/docs-audit/check-affected-docs.mjs
 *
 * ## Why this file exists instead of calling affected-docs.mjs directly
 *
 * `docs-drift-check.yml`'s job checks out the repo and sets up Node — nothing
 * else. No `pnpm install`, no `corepack enable`, deliberately: the mapper this
 * job self-tests is dependency-free (`node:child_process`/`node:fs`/`node:path`
 * only), so the job skips the cost of a full workspace install to stay fast on
 * every PR touching `packages/**`. A `pnpm check:NAME` invocation would break
 * that job outright (`pnpm: command not found`) — measured, not hypothetical:
 * that is exactly what happened the first time this gate was made discoverable
 * through a `pnpm` script instead of this file.
 *
 * `scripts/pm/dispatch-gates.mjs` discovers a check family from exactly two
 * shapes: `pnpm check:NAME` or `node scripts/**check-NAME.mjs` — and the
 * mapper's own filename, `affected-docs.mjs`, carries no `check-` segment, so
 * its self-test contributed zero discovered families despite being a real,
 * one-second-local verification with a verdict (#9187). This thin wrapper is
 * the fix: it satisfies the naming convention AND stays runnable in a job that
 * never installs pnpm, by using the SAME direct-`node`-invocation shape every
 * other zero-pnpm-setup workflow gate already uses
 * (`check-adr-merge-approval.mjs`, `check-adr-links.mjs`, …) — never a `pnpm`
 * wrapper, which would reintroduce the exact breakage this file exists to
 * avoid.
 *
 * Spawned, not imported, so a card that touches the mapper's own logic is
 * matched via the CI trigger `docs-drift-check.yml` already declares
 * (`scripts/docs-audit/**`) rather than depending on this wrapper's own watch
 * hints to carry that weight.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = new URL('../..', import.meta.url).pathname;

/** The script under test — also this gate's one watch hint. */
const MAPPER = 'scripts/docs-audit/affected-docs.mjs';

const result = spawnSync(process.execPath, [join(ROOT, MAPPER), '--self-test'], { stdio: 'inherit' });

if (result.error) {
  console.error(`✗ check-affected-docs: could not run ${MAPPER} — ${result.error.message}`);
  process.exit(2);
}
if (result.signal) {
  console.error(`✗ check-affected-docs: ${MAPPER} --self-test was killed by ${result.signal}.`);
  process.exit(2);
}
process.exit(result.status ?? 2);
