// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Cron } from 'croner';
import type { JobSchedule } from '@objectstack/spec/contracts';

/**
 * [#25235] How far the count of DROPPED due times is walked before the trigger
 * says "at least" instead. A walk bound, not a record bound: what is recorded is
 * capped by the caller's `limit` (the run history's own per-flow cap), and this
 * only keeps the count from costing the bind real time — `croner` steps a
 * pattern at roughly a quarter millisecond per occurrence, so a cron firing
 * every minute across a week-long outage would otherwise hold the event loop
 * for seconds to say how many it did not record. The earliest dropped due time
 * is exact either way: it is the first step of the walk.
 */
export const DROPPED_DUE_TIME_COUNT_CEILING = 1_000;

/** The due times of a silence that were NOT recorded, past the caller's limit. */
export interface DroppedDueTimes {
    /** How many — exact unless {@link atLeast}. */
    readonly count: number;
    /** The earliest due time of the silence: the first one not recorded. */
    readonly earliest: Date;
    /** The count stopped at {@link DROPPED_DUE_TIME_COUNT_CEILING}; more passed. */
    readonly atLeast: boolean;
}

/** The due times of a schedule that fell inside a silence. */
export interface DueTimesInSilence {
    /** Chronological; at most the `limit` most recent. */
    readonly dueTimes: readonly Date[];
    /** The older due times past `limit`, oldest first dropped; `null` when none was. */
    readonly dropped: DroppedDueTimes | null;
}

/**
 * The due times of `schedule` strictly after `after` and at or before `upTo` —
 * the instants a fire was owed while nothing was ticking — capped at the
 * `limit` most recent, with what the cap dropped counted beside them.
 *
 * "Due time" means exactly what the dispatch ledger keys on, so every instant
 * returned here has one tick window (`computeTickWindow`) and the caller
 * can ask the ledger whether it was delivered:
 *
 *  - **cron** — each occurrence of the expression in its timezone (`UTC` when
 *    absent, the window math's own default), by the same library.
 *  - **interval** — each epoch-anchored bucket start. A restarted kernel arms
 *    its timer at a new offset, so the bucket a silence ends inside is not
 *    delivered by the next kernel either: its first fire lands one interval
 *    after it starts, in a later bucket.
 *  - **once** — the one instant, when it fell inside.
 */
export function dueTimesInSilence(
    schedule: JobSchedule,
    after: Date,
    upTo: Date,
    limit: number,
): DueTimesInSilence {
    const afterMs = after.getTime();
    const upToMs = upTo.getTime();
    const none: DueTimesInSilence = { dueTimes: [], dropped: null };
    if (!Number.isFinite(afterMs) || !Number.isFinite(upToMs) || upToMs <= afterMs || limit <= 0) return none;

    if (schedule.type === 'cron') {
        if (!schedule.expression) return none;
        // Same at-or-before adjustment as `computeTickWindow`: croner answers
        // strictly before the reference second.
        const reference = new Date(Math.floor(upToMs / 1000) * 1000 + 1000);
        let pattern: Cron;
        try {
            pattern = new Cron(schedule.expression, { timezone: schedule.timezone ?? 'UTC' });
        } catch {
            return none; // unparseable — the job could not have been armed with it
        }
        try {
            const inside = pattern.previousRuns(limit + 1, reference).filter((d) => d.getTime() > afterMs);
            if (inside.length <= limit) return { dueTimes: inside.reverse(), dropped: null };
            const dueTimes = inside.slice(0, limit).reverse();
            return { dueTimes, dropped: countCronDropped(pattern, after, dueTimes[0].getTime()) };
        } finally {
            pattern.stop();
        }
    }

    if (schedule.type === 'interval') {
        const intervalMs = schedule.intervalMs;
        if (!intervalMs || intervalMs <= 0) return none;
        const first = Math.floor(afterMs / intervalMs) + 1;
        const last = Math.floor(upToMs / intervalMs);
        if (last < first) return none;
        const from = Math.max(first, last - limit + 1);
        const dueTimes: Date[] = [];
        for (let k = from; k <= last; k++) dueTimes.push(new Date(k * intervalMs));
        return {
            dueTimes,
            dropped: from > first ? { count: from - first, earliest: new Date(first * intervalMs), atLeast: false } : null,
        };
    }

    if (schedule.type === 'once') {
        if (!schedule.at) return none;
        const atMs = new Date(schedule.at).getTime();
        if (!Number.isFinite(atMs) || atMs <= afterMs || atMs > upToMs) return none;
        return { dueTimes: [new Date(atMs)], dropped: null };
    }

    return none;
}

/**
 * The cron occurrences strictly after `after` and before `beforeMs` — the ones
 * a capped silence did not record — walked forward from the silence's start,
 * up to {@link DROPPED_DUE_TIME_COUNT_CEILING}.
 */
function countCronDropped(pattern: Cron, after: Date, beforeMs: number): DroppedDueTimes | null {
    const page = 250;
    let earliest: Date | null = null;
    let count = 0;
    let cursor: Date = after;
    while (count < DROPPED_DUE_TIME_COUNT_CEILING) {
        const next = pattern.nextRuns(Math.min(page, DROPPED_DUE_TIME_COUNT_CEILING - count), cursor);
        for (const due of next) {
            if (due.getTime() >= beforeMs) return earliest ? { count, earliest, atLeast: false } : null;
            earliest ??= due;
            count++;
        }
        if (next.length === 0) break;
        cursor = next[next.length - 1];
    }
    return earliest ? { count, earliest, atLeast: count >= DROPPED_DUE_TIME_COUNT_CEILING } : null;
}
