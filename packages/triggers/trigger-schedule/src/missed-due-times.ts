// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Cron } from 'croner';
import type { JobSchedule } from '@objectstack/spec/contracts';

/**
 * [#25235] At most this many `missed` entries are recorded per flow when a
 * kernel finds a silence — the most recent ones.
 *
 * A silence long enough to exceed it (a minute-interval flow across a
 * week-long eviction) is an outage, not a list: past this many rows the run
 * history — capped per flow, 100 rows by default — would hold nothing BUT the
 * silence and lose every real run it was showing. The trigger says the count
 * it did not record in its log line, so the entries are the recent end of the
 * silence and never the whole claim.
 */
export const MAX_MISSED_ENTRIES_PER_FLOW = 20;

/** The due times of a schedule that fell inside a silence. */
export interface DueTimesInSilence {
    /** Chronological; at most the `limit` most recent. */
    readonly dueTimes: readonly Date[];
    /** More due times fell inside the silence than {@link dueTimes} holds. */
    readonly truncated: boolean;
}

/**
 * The due times of `schedule` strictly after `after` and at or before `upTo` —
 * the instants a fire was owed while nothing was ticking — capped at the
 * `limit` most recent.
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
    limit: number = MAX_MISSED_ENTRIES_PER_FLOW,
): DueTimesInSilence {
    const afterMs = after.getTime();
    const upToMs = upTo.getTime();
    const none: DueTimesInSilence = { dueTimes: [], truncated: false };
    if (!Number.isFinite(afterMs) || !Number.isFinite(upToMs) || upToMs <= afterMs || limit <= 0) return none;

    if (schedule.type === 'cron') {
        if (!schedule.expression) return none;
        // Same at-or-before adjustment as `computeTickWindow`: croner answers
        // strictly before the reference second.
        const reference = new Date(Math.floor(upToMs / 1000) * 1000 + 1000);
        let previous: Date[];
        try {
            const pattern = new Cron(schedule.expression, { timezone: schedule.timezone ?? 'UTC' });
            previous = pattern.previousRuns(limit + 1, reference);
            pattern.stop();
        } catch {
            return none; // unparseable — the job could not have been armed with it
        }
        const inside = previous.filter((d) => d.getTime() > afterMs);
        return {
            dueTimes: inside.slice(0, limit).reverse(),
            truncated: inside.length > limit,
        };
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
        return { dueTimes, truncated: from > first };
    }

    if (schedule.type === 'once') {
        if (!schedule.at) return none;
        const atMs = new Date(schedule.at).getTime();
        if (!Number.isFinite(atMs) || atMs <= afterMs || atMs > upToMs) return none;
        return { dueTimes: [new Date(atMs)], truncated: false };
    }

    return none;
}
