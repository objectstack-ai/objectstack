// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Flags } from '@oclif/core';
import type { AuditSealLockEngine, AuditSealLockFinish } from '@objectstack/plugin-audit';

/**
 * [ADR-0154 D3 as amended, seat ruling 6885005594] What an `os migrate audit-*`
 * ledger-copy rewrite holds so that no sealer pass seals a row while it
 * rewrites it: the audit seal lock (`holdAuditSealLock` in
 * `@objectstack/plugin-audit`), from before the run's first write to after its
 * last, its archive runs included.
 *
 *  - E: on Postgres and MySQL the `--apply` run takes the lock on the database
 *    of each sealed object it rewrites, waits for a sealer pass in flight, and
 *    refuses when the wait runs out, having changed nothing.
 *  - B: where that database offers no session lock (SQLite, Turso), an
 *    `--apply` run that rewrites a sealed object is refused unless the operator
 *    passes {@link sealerStoppedFlag}, and with it says on whose word it runs.
 *
 * A dry run writes nothing and takes nothing. A run whose lock's session ended
 * before it finished is told so ({@link AuditSealLockRun.lostLock}), and the
 * command prints that line and exits non-zero.
 */

/** `--sealer-stopped`: the operator's word that no server seals the database while the run lasts (B). */
export const sealerStoppedFlag = Flags.boolean({
  description:
    'With --apply on a database that offers no session lock (SQLite, Turso): rewrite objects declaring ' +
    'lifecycle.seal anyway, on your word that every server sealing this database is stopped. Postgres and MySQL ' +
    'take the audit seal lock instead.',
  default: false,
});

export interface AuditSealLockRun<T> {
  readonly result: T;
  /** The line to print, and exit non-zero on, when the lock's session ended before the run finished; else `null`. */
  readonly lostLock: string | null;
}

/**
 * Run `rewrite` under the audit seal lock when `apply`; a dry run runs it bare.
 * A refusal (contention past the wait, or B without `sealerStopped`) is thrown
 * before `rewrite` starts.
 */
export async function underAuditSealLock<T>(
  engine: unknown,
  options: { apply: boolean; sealerStopped: boolean; objects: readonly string[]; warn(line: string): void },
  rewrite: () => Promise<T>,
): Promise<AuditSealLockRun<T>> {
  if (!options.apply) return { result: await rewrite(), lostLock: null };
  const { holdAuditSealLock } = await import('@objectstack/plugin-audit');
  const hold = await holdAuditSealLock(engine as AuditSealLockEngine, {
    objects: options.objects,
    sealerStopped: options.sealerStopped,
    warn: options.warn,
  });
  let finished: AuditSealLockFinish | undefined;
  try {
    const result = await rewrite();
    finished = await hold.finish();
    return { result, lostLock: finished.lost ? finished.line : null };
  } finally {
    if (!finished) await hold.finish();
  }
}
