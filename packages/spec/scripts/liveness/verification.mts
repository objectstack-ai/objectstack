// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `verifiedAt` — the re-verification clock on a liveness ledger entry.
//
// WHY THIS EXISTS. Twice now a ledger entry has been falsified by code moving
// under it, in both directions:
//
//   - `flow.status` (#3711) — the file note said "status/active gate nothing";
//     true when written, falsified a month later by 497bda853 (UNDERSTATED).
//   - `action.undoable` (#3714) — marked `experimental` on a #1992-era "no
//     runtime reader yet" note; objectui had since wired two (UNDERSTATED).
//
// Both were found by a sweep aimed at the OPPOSITE failure (the #3686
// preview-renderer over-claims). Nothing in the gate ever asks "how old is this
// claim?", so a stale entry is invisible until someone happens to trip over it.
//
// `verifiedAt` makes the age of a claim a first-class, machine-readable fact.
// It deliberately does NOT fail CI on age: re-verification is a judgement call
// on a worklist, not a merge blocker. What DOES fail is a *malformed* value —
// an unparseable or future-dated `verifiedAt` silently disables the staleness
// check for that entry, which is precisely the silent-no-op failure mode this
// whole ledger exists to prevent.

/** Entries older than this are surfaced on the re-verification worklist. */
export const DEFAULT_STALE_DAYS = 180;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export type VerifiedAtResult =
  | { ok: true; date: Date }
  | { ok: false; error: string };

/**
 * Parse a ledger `verifiedAt` value. Strict `YYYY-MM-DD` — no timestamps, no
 * `YYYY-MM`, no slop. A future date is rejected: it would park the entry
 * outside every staleness window forever, which is worse than no value at all
 * (an absent `verifiedAt` at least reports as unverified).
 */
export function parseVerifiedAt(value: unknown, now: Date = new Date()): VerifiedAtResult {
  if (typeof value !== 'string') return { ok: false, error: `verifiedAt must be a "YYYY-MM-DD" string, got ${typeof value}` };
  const m = ISO_DATE.exec(value);
  if (!m) return { ok: false, error: `verifiedAt "${value}" is not a "YYYY-MM-DD" date` };

  const [, y, mo, d] = m;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { ok: false, error: `verifiedAt "${value}" is not a real date` };
  // `new Date('2026-02-30')` rolls over to March 2 rather than throwing, so
  // round-trip the parts to reject calendar-invalid dates.
  const roundTrip =
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() + 1 === Number(mo) &&
    date.getUTCDate() === Number(d);
  if (!roundTrip) return { ok: false, error: `verifiedAt "${value}" is not a real calendar date` };

  if (date.getTime() > now.getTime()) return { ok: false, error: `verifiedAt "${value}" is in the future` };
  return { ok: true, date };
}

/** Whole days between a verification date and `now` (never negative). */
export function verificationAgeDays(date: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY));
}

export interface VerificationEntry {
  /** `<type>/<propPath>` — the ledger coordinate. */
  key: string;
  status: string;
  verifiedAt?: unknown;
}

export interface VerificationReport {
  /** Malformed `verifiedAt` values — these FAIL the gate. */
  errors: string[];
  /** Parsed and older than the threshold — the re-verification worklist. */
  stale: Array<{ key: string; verifiedAt: string; ageDays: number }>;
  /** Parsed and inside the threshold. */
  fresh: number;
  /**
   * No `verifiedAt` at all. Counted, not listed: most of the ledger predates
   * the field, so listing every one would drown the signal. They join the
   * worklist only under `--stale-verification`.
   */
  unverified: string[];
}

/**
 * Fold a flat list of ledger entries into a verification report. Pure — `now`
 * and the threshold are injected so the gate, the tests, and any future sweep
 * script all see the same arithmetic.
 */
export function buildVerificationReport(
  entries: VerificationEntry[],
  { now = new Date(), staleDays = DEFAULT_STALE_DAYS }: { now?: Date; staleDays?: number } = {},
): VerificationReport {
  const report: VerificationReport = { errors: [], stale: [], fresh: 0, unverified: [] };

  for (const entry of entries) {
    if (entry.verifiedAt === undefined) {
      report.unverified.push(entry.key);
      continue;
    }
    const parsed = parseVerifiedAt(entry.verifiedAt, now);
    if (!parsed.ok) {
      report.errors.push(`${entry.key} → ${parsed.error}`);
      continue;
    }
    const ageDays = verificationAgeDays(parsed.date, now);
    if (ageDays > staleDays) report.stale.push({ key: entry.key, verifiedAt: String(entry.verifiedAt), ageDays });
    else report.fresh++;
  }

  report.stale.sort((a, b) => b.ageDays - a.ageDays);
  return report;
}
