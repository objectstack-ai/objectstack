// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6969 — `--database-driver` states no driver vocabulary of its own.
 *
 * ## What this covers that `database-driver-allowlist.pin.test.ts` does not
 *
 * The #6860 pin asserts the flag AGREES with `resolveStorageDefinition`, and it
 * still does; it is deliberately untouched by this card. But it compares SETS,
 * from two derivations, and it never reads the flag's `description:` at all. Two
 * things could therefore be wrong while it stayed green:
 *
 *  1. the flag could be re-hand-written with the same members in a different
 *     order, so `os start --help` and `os dev --help` stop agreeing with each
 *     other (oclif prints `options:` verbatim, in array order, three times per
 *     command — usage line, description, `<options: …>` line);
 *  2. the description prose could enumerate a stale list. It did enumerate a
 *     hand-written one before this card, next to the array, with nothing at all
 *     keeping the two in step — the drift that #6860 found in the allowlist, one
 *     string over.
 *
 * ## And the direction that would be a behaviour change, not a refactor
 *
 * Deriving the flag from the CONFIG-CONTRACT face (`DRIVER_ID_ALIASES` /
 * `resolveDriverId`) instead of the SELECTION face would offer `sqlite3`,
 * `better-sqlite3`, `mariadb` and `inmemory` — spellings neither boot host has
 * ever accepted as a selection (#6345 fixes the selection face as the union of
 * what the two hosts accepted the day the ruling was written). The last case here
 * drives oclif's real parser to prove they are still refused at parse time.
 */

import { describe, it, expect } from 'vitest';
import { Parser } from '@oclif/core';
import type { Interfaces } from '@oclif/core';
import { DATABASE_DRIVER_SELECTION_IDS, resolveDatabaseDriverId, resolveDriverId } from '@objectstack/spec/data';
import Start from './start.js';
import Dev from './dev.js';

const COMMANDS = [
  { name: 'os start', flags: Start.flags as Record<string, unknown> },
  { name: 'os dev', flags: Dev.flags as Record<string, unknown> },
] as const;

function driverFlag(flags: Record<string, unknown>): { description?: string; options?: readonly string[] } {
  return flags['database-driver'] as { description?: string; options?: readonly string[] };
}

/**
 * The driver list as the flag's HELP PROSE spells it — `…: a | b | c (overrides
 * $OS_DATABASE_DRIVER)`. Read back out of the rendered string rather than from
 * the constant that built it, so the assertion still means something if a command
 * ever goes back to writing its own sentence.
 */
function enumeratedInDescription(description: string): string[] {
  const match = /:\s*([^:()]+?)\s*\(overrides/.exec(description);
  expect(match, `the description must still enumerate the drivers: ${description}`).toBeTruthy();
  return match![1]!.split('|').map((token) => token.trim());
}

/** Spellings that resolve a config contract but are refused as a boot selection. */
const CONTRACT_ONLY_SPELLINGS = ['sqlite3', 'better-sqlite3', 'mariadb', 'inmemory'] as const;

describe('#6969 — the flag is derived from the shared driver table', () => {
  it('the derived vocabulary is non-empty (guards every assertion below)', () => {
    expect(DATABASE_DRIVER_SELECTION_IDS.length).toBeGreaterThan(0);
  });

  for (const { name, flags } of COMMANDS) {
    describe(name, () => {
      it('offers exactly the shared table\'s selection ids, in the table\'s order', () => {
        // ORDER, not just membership: it is what `--help` prints, and the two
        // commands must not describe the same flag differently.
        expect(driverFlag(flags).options).toEqual([...DATABASE_DRIVER_SELECTION_IDS]);
      });

      it('enumerates the same drivers in its description as it enforces in `options:`', () => {
        const flag = driverFlag(flags);
        expect(enumeratedInDescription(flag.description!)).toEqual([...(flag.options as readonly string[])]);
      });
    });
  }

  it('start and dev publish byte-identical driver enumerations', () => {
    const [start, dev] = COMMANDS.map(({ flags }) => driverFlag(flags).options);
    expect(start).toEqual(dev);
  });

  it('hands each command its own array, so one cannot mutate the other\'s allowlist', () => {
    expect(driverFlag(COMMANDS[0].flags).options).not.toBe(driverFlag(COMMANDS[1].flags).options);
  });

  it.each(CONTRACT_ONLY_SPELLINGS)(
    'still refuses `%s` at parse time — a contract-only spelling is not a boot selection',
    async (spelling) => {
      // The premise, restated from the table so this cannot rot into asserting
      // that a canonical id is refused: these DO resolve a config contract and
      // do NOT resolve a selection.
      expect(resolveDriverId(spelling), `${spelling} must still resolve a config contract`).toBeDefined();
      expect(resolveDatabaseDriverId(spelling), `${spelling} must not be selectable`).toBeUndefined();

      for (const { name, flags } of COMMANDS) {
        // oclif owns this refusal, so there is no ADR-0112 envelope to assert on:
        // the observable contract is the parse-time rejection plus a message that
        // names the rejected value and the legal set. Both are asserted, because
        // a bare "it threw" would also be satisfied by a flag that had lost its
        // `options:` allowlist and failed for some unrelated reason.
        await expect(
          Parser.parse(['--database-driver', spelling], {
            flags: flags as unknown as Interfaces.FlagInput,
            strict: false,
          }),
          `${name} accepted --database-driver ${spelling}`,
        ).rejects.toThrow(new RegExp(`expected .*${spelling}.* to be one of`, 'i'));
      }
    },
  );
});
