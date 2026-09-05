// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Is the SQLite file I opened still the file at my path?" — the one question
 * a live boot cannot answer for itself, and the one whose wrong answer costs a
 * whole investigation.
 *
 * ## The measured state
 *
 * The documented dev loop deletes the database directory (`rm -rf
 * .objectstack/data` — it is in hotcrm's own `demo:reset` script and in the
 * repro block of the card this module was written for). Running it while a
 * server still holds the database unlinks the inode without touching the
 * process: SQLite keeps reading and writing the now-invisible file, the
 * process keeps three `(deleted)` descriptors open (`objectstack.db`, `-wal`,
 * `-shm`), and `GET /api/v1/health` keeps answering `200`. A later boot then
 * creates a brand-new `objectstack.db` at the same path.
 *
 * From that moment the two halves of any investigation describe DIFFERENT
 * files, with nothing saying so — reproduced end to end while writing this:
 *
 * ```text
 * live server  GET /api/v1/data/crm_account  -> ["Acme Corp","Globex Ltd","Initech"]
 * file at the same path (server stopped)     -> ["EDITED_WITH_SERVER_STOPPED", ...]
 * live server  session user id               -> d7ZOOTvRfxl8exw2f8TGvX7J8iincNRb
 * that id in the file at the same path       -> 0 rows
 * ```
 *
 * So "a row edit made with the server stopped has no observable effect" and "a
 * user that authenticates against the live server is not in the database" are
 * both TRUE readings of one healthy deployment — and both were reported as
 * evidence of a broken write path in a card that then burned a full P0 cycle.
 * Nothing in the product is wrong at that point; the deployment simply has no
 * way to notice.
 *
 * ## Why the check is periodic and not on-error
 *
 * There is no error to hang it on. Measured: after the unlink every read and
 * write still succeeds, health still answers `200`, and no exception is thrown
 * anywhere — that is the whole defect. A condition that never produces a
 * failure can only be found by asking, so the watch below asks on a timer.
 *
 * ## Why it reports and refuses nothing
 *
 * The running server is still CORRECT — it is merely invisible. Refusing to
 * serve, or restarting, would break a working dev loop to fix a reporting gap.
 * The level is `error` by the AGENTS.md degradation rule ("after the
 * degradation, does the system still look normal from the outside, while
 * something it claims is persisted has not actually landed?" — yes: every
 * external observation of this deployment is now false), and it is said ONCE,
 * at the first divergence, per that same rule.
 *
 * ## What is compared, and the direction it fails in
 *
 * The identity captured at boot is `stat(path)` taken right after the driver
 * connected — the device+inode pair of the file at the configured path, plus
 * its birth time where that field is trustworthy ({@link captureServedDatabaseFile}
 * says what arms the second rung, and why inodes alone are not enough) — not
 * the inode behind the driver's own descriptor, which no portable Node API
 * exposes. If a swap happened in the window between the driver's `open()` and
 * that first `stat()`, the capture records the NEW file and the watch never
 * fires. That direction is deliberate, and it is the direction every
 * uncertainty here is resolved in: a missed report costs what today already
 * costs, while a false report would send an operator to restart a server whose
 * database is fine. Silence from this watch is therefore never a claim that
 * the file is intact — it is only the absence of a claim that it is not.
 */

import { statSync, type Stats } from 'node:fs';

/** The identity of the database file this boot is serving. */
export interface ServedDatabaseFile {
  /** Absolute on-disk path the driver was pointed at. */
  path: string;
  /** `stat.dev` at capture time. */
  dev: number;
  /** `stat.ino` at capture time. */
  ino: number;
  /**
   * `stat.birthtimeMs` at capture time — the SECOND rung, present only when
   * this filesystem's birth time is trustworthy here. See
   * {@link captureServedDatabaseFile} for what arms it and why.
   */
  birthtimeMs?: number;
}

/**
 * What a later look at the same path found.
 *
 * `unreadable` is deliberately its own verdict rather than folded into
 * `unchanged`: "I could not judge" and "I judged, and it is fine" are
 * different facts, and only the second one licenses silence as an answer.
 */
export type ServedDatabaseFileVerdict =
  | { kind: 'unchanged' }
  | { kind: 'missing' }
  | { kind: 'replaced'; onDisk: { dev: number; ino: number }; inodeReused: boolean }
  | { kind: 'unreadable'; reason: string };

/** Seam for tests — the real `statSync` by default. */
export interface ServedDatabaseFileDeps {
  stat?: (path: string) => Stats;
}

/**
 * How often the watch asks. A `stat` of one path is far below the noise floor
 * of a serving process, and the watch stops itself at the first divergence, so
 * the cost is bounded by the time the deployment spends healthy.
 */
export const SERVED_DATABASE_FILE_CHECK_INTERVAL_MS = 30_000;

/**
 * Capture the identity of the file at `path`, or `undefined` when this
 * platform cannot answer.
 *
 * `undefined` means the watch must not run at all: an unreadable path, or a
 * filesystem that reports no usable inode (`ino === 0`, seen on some Windows
 * volumes). A watch seeded from an unjudgeable identity would report every
 * later look as a divergence, which is the one failure this must not have.
 */
export function captureServedDatabaseFile(
  path: string,
  deps: ServedDatabaseFileDeps = {},
): ServedDatabaseFile | undefined {
  const stat = deps.stat ?? statSync;
  try {
    const s = stat(path);
    if (!Number.isFinite(s.ino) || s.ino === 0) return undefined;
    return { path, dev: Number(s.dev), ino: Number(s.ino), birthtimeMs: armBirthtime(s) };
  } catch {
    return undefined;
  }
}

/**
 * The birth time, when it can be trusted here — otherwise `undefined`.
 *
 * ⚠️ Inode numbers are RECYCLED, and the recycling is not exotic: measured on
 * this repo's own CI-shaped filesystem, deleting a file and recreating one at
 * the same path in the same millisecond handed back the SAME inode. So "a
 * later boot created a brand-new database at this path" — the card's own
 * second half — can be invisible to a dev+inode comparison alone. Birth time
 * separates them: the same measurement showed it moving on the recreate
 * (…634434.566 to …634438.940) while staying put across an ordinary write to
 * a live inode, which is exactly the discrimination wanted.
 *
 * The hazard is that `birthtimeMs` is not universally real. Node documents
 * two fallbacks for filesystems that do not store it: the epoch, or a copy of
 * `ctime`. The epoch one is harmless (a constant compares equal forever); the
 * `ctime` one is NOT — `ctime` moves on every write, so a healthy serving
 * database would report itself replaced every interval.
 *
 * So the rung ARMS ITSELF on evidence, and only on evidence: if birth time is
 * a copy of `ctime` it equals `ctime` by construction, and the two being
 * different at capture proves this filesystem keeps them apart. A file whose
 * `ctime` has not yet moved past its birth time is simply left on one rung —
 * conservative, never wrong. The whole design is one-directional: it can only
 * ever add detections, never a false one.
 */
function armBirthtime(s: Stats): number | undefined {
  const birth = Number(s.birthtimeMs);
  if (!Number.isFinite(birth)) return undefined;
  if (birth === Number(s.ctimeMs)) return undefined;
  return birth;
}

/** Ask whether the file at `opened.path` is still the file `opened` names. */
export function checkServedDatabaseFile(
  opened: ServedDatabaseFile,
  deps: ServedDatabaseFileDeps = {},
): ServedDatabaseFileVerdict {
  const stat = deps.stat ?? statSync;
  let s: Stats;
  try {
    s = stat(opened.path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    // Nothing at the path is the headline case — the unlink itself.
    if (code === 'ENOENT') return { kind: 'missing' };
    // Anything else (a permission change, a vanished mount) is a failure to
    // MEASURE, never a measurement. Reporting divergence off it would be
    // inventing an answer the read never produced.
    return { kind: 'unreadable', reason: code ?? String((err as Error | undefined)?.message ?? err) };
  }
  const dev = Number(s.dev);
  const ino = Number(s.ino);
  if (!Number.isFinite(ino) || ino === 0) {
    return { kind: 'unreadable', reason: 'filesystem reports no usable inode' };
  }
  if (dev !== opened.dev || ino !== opened.ino) {
    return { kind: 'replaced', onDisk: { dev, ino }, inodeReused: false };
  }
  // Same dev+inode — which is NOT the same as the same file. Second rung.
  if (opened.birthtimeMs !== undefined) {
    const birth = Number(s.birthtimeMs);
    if (Number.isFinite(birth) && birth !== opened.birthtimeMs) {
      return { kind: 'replaced', onDisk: { dev, ino }, inodeReused: true };
    }
  }
  return { kind: 'unchanged' };
}

/**
 * The line an operator reads, or `undefined` when there is nothing to say.
 *
 * It owes two things and carries both, per the degradation-log-level rule:
 * the CONSEQUENCE (concretely: every external observation of this deployment
 * is now false, and it will keep looking healthy) and the FIX.
 */
export function describeServedDatabaseFileDivergence(
  opened: ServedDatabaseFile,
  verdict: ServedDatabaseFileVerdict,
): string | undefined {
  const what =
    verdict.kind === 'missing'
      ? `nothing exists at ${opened.path} any more`
      : verdict.kind === 'replaced'
        ? (verdict.inodeReused
            ? `${opened.path} is now a DIFFERENT file created since boot (the filesystem recycled inode ${opened.ino}, so only its creation time tells them apart)`
            : `${opened.path} is now a DIFFERENT file (opened dev/inode ${opened.dev}/${opened.ino}, on disk now ${verdict.onDisk.dev}/${verdict.onDisk.ino})`)
        : undefined;
  if (!what) return undefined;
  return [
    `Database file identity lost: this server is still serving the SQLite file it opened at boot, but ${what}.`,
    `  Consequence: every filesystem inspection of that path — sqlite3, a table scan, a row edit, a hash transplant —`,
    `  now describes a different database than this process serves, so an edit made there has no observable effect here`,
    `  and a user authenticated here is not in that file. This server keeps answering 200 and nothing else will say so.`,
    `  Fix: restart this server so it opens the file that is at that path now. Deleting the data directory`,
    `  (rm -rf .objectstack/data, as demo:reset does) while a server is running is what produces this state.`,
  ].join('\n');
}

/** A running watch. `stop()` is idempotent. */
export interface ServedDatabaseFileWatch {
  stop: () => void;
}

/**
 * Watch `opened` until it diverges, report once, and stop.
 *
 * Returns `undefined` when there is nothing to watch, so a caller can wire it
 * unconditionally. The timer is `unref`'d: this must never be the reason a
 * process stays alive.
 */
export function watchServedDatabaseFile(opts: {
  opened: ServedDatabaseFile;
  onDiverged: (message: string, verdict: ServedDatabaseFileVerdict) => void;
  intervalMs?: number;
  deps?: ServedDatabaseFileDeps;
}): ServedDatabaseFileWatch | undefined {
  const intervalMs = opts.intervalMs ?? SERVED_DATABASE_FILE_CHECK_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return undefined;

  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    const verdict = checkServedDatabaseFile(opts.opened, opts.deps);
    const message = describeServedDatabaseFileDivergence(opts.opened, verdict);
    if (!message) return;
    // Said ONCE, at the first divergence — the condition is permanent until a
    // restart, so a repeat every interval would be the same fact re-logged
    // until it is unreadable.
    stop();
    opts.onDiverged(message, verdict);
  }, intervalMs);
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  }

  return { stop };
}
