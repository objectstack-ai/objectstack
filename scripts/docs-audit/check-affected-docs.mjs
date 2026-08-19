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
 * other zero-pnpm-setup workflow gate already uses (`check-adr-links.mjs`,
 * `check-partof-closing-keyword.mjs`, …) — never a `pnpm` wrapper, which
 * would reintroduce the exact breakage this file exists to avoid.
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

/**
 * Two runs, because they answer two different questions and only one of them needs the
 * repo (#9572).
 *
 *   --self-test        the classifiers and derivations, pinned against fixtures
 *   --bridge-coverage  the `sdk` bridge's DISCOVERED POPULATION on the real tree
 *
 * The second is here because a discovery scan that comes back structurally empty — no
 * route ledger found, no registrar tail produced, a ledger file the row recognizer can
 * no longer parse — reports `0 of 0 unreachable`, which is arithmetically true and reads
 * exactly like a healthy bridge. That is the false-green shape #9747 catalogues, and the
 * fixtures above cannot catch it: they supply their own population, so they stay green
 * on a tree where the real walk selects nothing.
 *
 * ⛔ What it does NOT do is fail on the coverage ratio itself. Today's tree reaches 45 of
 * 221 client-bound ledger rows; turning that shortfall into a red would be widening the
 * recognizer by CI pressure, which #9747 declines explicitly ("Not a new required
 * context"). The ratio is REPORTED — in the mapper's JSON, in the drift comment, and in
 * `--bridge-coverage`'s own output. Only the broken-scan verdicts exit non-zero, and
 * they cannot fire on a tree where the scan works at all.
 */
const MODES = ['--self-test', '--bridge-coverage'];

for (const mode of MODES) {
  const result = spawnSync(process.execPath, [join(ROOT, MAPPER), mode], { stdio: 'inherit' });
  if (result.error) {
    console.error(`✗ check-affected-docs: could not run ${MAPPER} ${mode} — ${result.error.message}`);
    process.exit(2);
  }
  if (result.signal) {
    console.error(`✗ check-affected-docs: ${MAPPER} ${mode} was killed by ${result.signal}.`);
    process.exit(2);
  }
  if (result.status !== 0) process.exit(result.status ?? 2);
}
process.exit(0);
