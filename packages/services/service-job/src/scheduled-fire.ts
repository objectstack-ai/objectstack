// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/** A scheduled fire still running: when it started, for the skipped-tick warning. */
export interface ScheduledFire {
  readonly startedAt: string;
}

/**
 * The one line a skipped tick leaves (#31811): which job, and which run of it
 * is still in flight. Shared by both timer adapters so the two spell it alike.
 */
export function skippedTickMessage(adapter: string, name: string, running: ScheduledFire): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(running.startedAt).getTime()) / 1000));
  return (
    `${adapter}: scheduled fire of "${name}" skipped — its run started at ${running.startedAt} ` +
    `(${seconds} s ago) is still in flight on this node. The next tick tries again.`
  );
}
