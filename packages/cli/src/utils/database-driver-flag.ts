// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one definition of `--database-driver`'s choices, derived from the shared
 * driver table (#6969).
 *
 * ## Why this file exists
 *
 * `os start` and `os dev` each declared the flag with a hand-written literal
 * array — `options: ['sqlite', 'sqlite-wasm', 'turso', …]` — and each repeated
 * the same ids a second time inside the flag's `description:` prose. #6345 had
 * just collapsed the platform's driver vocabulary into ONE table in
 * `@objectstack/spec`, so those four literals were a second, third, fourth and
 * fifth statement of it living one package away. That is the shape #6535 closed
 * for `IMPORT_JOB_MAX_ROWS`, moved to another package.
 *
 * This is NOT a drift FIX: `commands/database-driver-allowlist.pin.test.ts`
 * (#6860) already asserts the flag agrees with what `resolveStorageDefinition`
 * resolves, and it caught a real regression the day #6345 landed. Nothing an
 * operator can reach today is wrong. The point is narrower and structural — with
 * one definition, there is no second copy left to drift, so the pin guards an
 * agreement that can no longer be broken by editing one file and not the other.
 *
 * ## Which column, and why it matters that it is this one
 *
 * {@link DATABASE_DRIVER_SELECTION_IDS} — the SELECTION face reduced to canonical
 * spellings. Not `DRIVER_ID_ALIASES` and not `resolveDriverId`: those cover the
 * CONFIG-CONTRACT face, which deliberately includes `contractOnlyAliases`
 * (`sqlite3`, `better-sqlite3`, `mariadb`, `inmemory`) — spellings that resolve a
 * stored datasource's config schema but that neither boot host has ever accepted
 * as a selection. Offering them here would widen the flag on no ruling, and would
 * be a behaviour change wearing a refactor's clothes.
 *
 * Every id in the derived set IS offered: no driver is withheld from the flag
 * today. Should one ever need to be, it gets declared on the table's row (the
 * exception belongs next to `hasLocalDefault`, where every host can see it) —
 * never subtracted here, which would recreate the second definition this file
 * deletes.
 */

import { Flags } from '@oclif/core';
import { DATABASE_DRIVER_SELECTION_IDS } from '@objectstack/spec/data';

/**
 * The enforced `options:` allowlist for `--database-driver`, in the shared
 * table's row order — the same order the hosts' "Supported drivers: …" refusal
 * prints, so `--help` and the refusal an operator hits after mistyping enumerate
 * drivers alike.
 *
 * A fresh array per read: oclif stores what it is handed on the flag definition,
 * and two commands must not share one mutable instance.
 */
export function databaseDriverFlagOptions(): string[] {
  return [...DATABASE_DRIVER_SELECTION_IDS];
}

/**
 * Declare `--database-driver` on a command.
 *
 * `options:` is an ENFORCED allowlist — oclif rejects anything outside it at
 * parse time, before the command body runs — so it must offer every driver kind
 * a boot host can actually select, or the flag refuses a driver the equivalent
 * `OS_DATABASE_DRIVER` env var happily accepts (#6860: `mysql` and `sqlite-wasm`
 * were missing and unusable through the flag).
 *
 * `summary` is the one part a command still writes, because the two commands
 * genuinely say different things (`os start` mentions the ambiguous-URL case,
 * `os dev` does not). The enumerated list is appended from the same array
 * `options:` gets, so the prose and the allowlist cannot disagree — the drift
 * that a hand-written description list invites, and that no gate would have
 * caught.
 */
export function databaseDriverFlag(summary: string) {
  const options = databaseDriverFlagOptions();
  return Flags.string({
    description: `${summary}: ${options.join(' | ')} (overrides $OS_DATABASE_DRIVER)`,
    options,
  });
}
