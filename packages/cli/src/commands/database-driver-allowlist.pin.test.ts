// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE #6860 PIN: `--database-driver`'s allowlist offers exactly the driver kinds
 * `resolveStorageDefinition` can actually resolve.
 *
 * `--database-driver` is declared with oclif's `options:`, which is an **enforced
 * allowlist**, not a help string: a value outside it is refused during flag
 * parsing, before the command body ever runs. So the allowlist is a second,
 * independent statement of "which drivers exist" — and it had drifted from the
 * first one. `mysql` and `sqlite-wasm` are resolved by `resolveStorageDefinition`
 * and selectable through `OS_DATABASE_DRIVER`, but were missing from the flag, so
 *
 *     os start --database-driver mysql
 *     → Expected --database-driver=mysql to be one of: sqlite, turso, postgres,
 *       mongodb, memory                                        (exit 2, oclif)
 *
 * while `OS_DATABASE_DRIVER=mysql os start` on the same command booted straight
 * into the MySQL driver. One thing, two answers — and the flag's answer was the
 * wrong one, phrased in oclif's generic vocabulary rather than anything this repo
 * wrote.
 *
 * The pin therefore asserts the AGREEMENT between the two sides rather than
 * checking either against a list written out here. A hard-coded expected list
 * would just relocate the divergence into this file: adding a driver branch to
 * `resolveStorageDefinition` would leave the flag AND this test both stale, and
 * both silent. Instead each side is derived from the code that owns it —
 *
 *   - the allowlist, from the oclif flag definitions themselves;
 *   - the driver kinds, by asking `resolveStorageDefinition` which tokens it
 *     recognizes and what canonical `driverId` each collapses to.
 *
 * so a new driver kind makes this file go red until the flag offers it too.
 *
 * BOTH commands are covered on purpose: the flag is declared twice, once in
 * `start.ts` and once in `dev.ts`, and that duplication is exactly how the two
 * can drift apart from each other as well as from the resolver.
 *
 * SCOPE (#6860 vs #6345): this pins the CANONICAL kinds — the `driverId` values
 * the resolver produces. The resolver also accepts aliases (`pg`, `mysql2`,
 * `libsql`, `mingo`, `wasm`, …) which the flag deliberately does not offer;
 * converging that vocabulary is #6345's job, and this pin is written so it does
 * not prejudge it — an alias collapses to its canonical id and is not demanded
 * of the flag.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from '@oclif/core';
import type { Interfaces } from '@oclif/core';
import Start from './start.js';
import Dev from './dev.js';
import { resolveStorageDefinition, UnsupportedDriverError } from '../utils/storage-driver.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DRIVER_SRC = path.join(HERE, '..', 'utils', 'storage-driver.ts');

/** The two places the flag is declared — the duplication this pin exists to watch. */
const COMMANDS = [
  { name: 'os start', flags: Start.flags as Record<string, unknown> },
  { name: 'os dev', flags: Dev.flags as Record<string, unknown> },
] as const;

/** The enforced `options:` allowlist as oclif itself will apply it. */
function allowlistOf(flags: Record<string, unknown>): string[] {
  const flag = flags['database-driver'] as { options?: readonly string[] } | undefined;
  expect(flag, 'the --database-driver flag must exist on this command').toBeDefined();
  const options = flag?.options;
  // `options: undefined` would make the flag free text — a different (and much
  // looser) contract than the one this pin describes. Fail rather than pass
  // vacuously.
  expect(Array.isArray(options), 'the --database-driver flag must keep an enforced `options:` allowlist').toBe(true);
  return [...(options as readonly string[])];
}

/**
 * Every lowercase single-quoted token in `storage-driver.ts` — a deliberately
 * over-broad candidate net. It does not need to be precise: the next step uses
 * `resolveStorageDefinition` ITSELF as the oracle for which candidates are real
 * driver kinds, so config keys, driver ids and stray literals all wash out. That
 * keeps the derivation working when the dispatch is rewritten (a lookup table,
 * a switch, more aliases) instead of pattern-matching one particular shape.
 */
function candidateTokens(): string[] {
  const src = readFileSync(STORAGE_DRIVER_SRC, 'utf8');
  const matches = src.match(/'[a-z0-9][a-z0-9-]*'/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1, -1)))];
}

/**
 * Ask the resolver what a token resolves to.
 *
 * `isDev: false` is load-bearing: in dev mode an UNRECOGNIZED kind falls through
 * to the sqlite dev default, so every token would look recognized and the whole
 * derivation would go vacuous. In production an unrecognized kind returns null.
 *
 * A recognized kind that cannot become a definition still counts as recognized —
 * today that is `turso` with no URL, which throws `UnsupportedDriverError`. A URL
 * is supplied so it resolves normally; the catch is kept so the derivation
 * survives another kind growing the same "recognized but unusable" shape.
 */
function canonicalDriverIdOf(token: string): string | null {
  try {
    const resolution = resolveStorageDefinition(token, {
      isDev: false,
      databaseUrl: 'libsql://pin.turso.io',
    });
    return resolution?.driverId ?? null;
  } catch (err) {
    if (err instanceof UnsupportedDriverError) return err.driverType;
    throw err;
  }
}

/** The canonical driver ids `resolveStorageDefinition` can actually produce. */
function canonicalDriverIds(): Set<string> {
  const ids = new Set<string>();
  for (const token of candidateTokens()) {
    const id = canonicalDriverIdOf(token);
    if (id) ids.add(id);
  }
  return ids;
}

/** Run a value through oclif's real parser, exactly as the command does. */
async function parseDriverFlag(flags: Record<string, unknown>, value: string): Promise<string | undefined> {
  const parsed = await Parser.parse(['--database-driver', value], {
    flags: flags as unknown as Interfaces.FlagInput,
    strict: false,
  });
  return (parsed.flags as Record<string, string | undefined>)['database-driver'];
}

describe('#6860 — --database-driver allowlist agrees with resolveStorageDefinition', () => {
  it('derives a non-empty set of driver kinds from the resolver', () => {
    // Guards the derivation itself. If storage-driver.ts is restructured such
    // that the candidate net catches nothing, every assertion below would pass
    // vacuously — so state the precondition out loud instead.
    const ids = canonicalDriverIds();
    expect(
      ids.size,
      'derived no driver kinds from storage-driver.ts — the candidate scan in this file needs updating, '
        + 'not deleting: without it the allowlist assertions below are vacuous',
    ).toBeGreaterThan(0);
  });

  for (const { name, flags } of COMMANDS) {
    describe(name, () => {
      it('offers every driver kind the resolver can produce, and no kind it cannot', () => {
        // THE assertion. Both sides derived; neither written out here.
        expect(new Set(allowlistOf(flags))).toEqual(canonicalDriverIds());
      });

      it('lists only canonical kinds — every option resolves to itself', () => {
        // Makes the comparison above meaningful: an allowlist entry that is an
        // ALIAS (`pg`) would resolve to a different id (`postgres`) and quietly
        // satisfy nothing. Also catches an option the resolver does not know at
        // all, which is the "flag advertises a driver that cannot boot" bug in
        // the opposite direction from #6860.
        for (const option of allowlistOf(flags)) {
          expect(canonicalDriverIdOf(option), `--database-driver ${option}`).toBe(option);
        }
      });

      it('parses every offered driver kind', async () => {
        // Behavioral half: #6860 was a PARSE-time refusal, so drive oclif's
        // parser rather than reading the options array back.
        for (const kind of canonicalDriverIds()) {
          await expect(parseDriverFlag(flags, kind), `--database-driver ${kind}`).resolves.toBe(kind);
        }
      });

      it('still refuses a value that is not a driver kind', async () => {
        // Keeps the test above honest: if `options:` were dropped, everything
        // would parse and "parses every offered kind" would prove nothing.
        await expect(parseDriverFlag(flags, 'not-a-driver')).rejects.toThrow(/expected .*not-a-driver.* to be one of/i);
      });
    });
  }

  it('start and dev offer the same kinds as each other', () => {
    // The flag is declared once per command; nothing but this makes the two
    // copies stay in step.
    const [start, dev] = COMMANDS.map(({ flags }) => allowlistOf(flags));
    expect(new Set(start)).toEqual(new Set(dev));
  });
});
