// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import type { StepLogEntry } from './engine.js';

/**
 * Fold a run's step log into the `droppedFields` its terminal answer carries
 * (#32861, `AutomationResult.droppedFields`).
 *
 * A write step whose caller-supplied values the data engine legally stripped
 * (a `readonly` field, a `readonlyWhen` lock, …) succeeds and says so in its
 * `warnings` (#3407); the structured events behind those warnings ride the
 * step as `droppedFields`. Before this fold they stopped there, so the run
 * answered a plain success and a record button whose flow wrote a read-only
 * `status` told the person who clicked it nothing.
 *
 * The fold is over the FLAT step log, like `summarizeRun`: a structured
 * region's body steps are already spliced into it, and a run resumed from a
 * pause carries the steps it ran before the pause — so a drop before a
 * `screen` node still reaches the answer the run finally gives.
 *
 * Coalesced, not concatenated: one event per `(object, reason)`, its `fields`
 * the union in first-seen order. A loop that writes thirty rows and drops
 * `status` on each is one fact for the caller ("status did not take effect"),
 * not thirty, and the answer stays bounded by the schema rather than by the
 * run's length. The element is the engine's own event, unchanged in shape —
 * no new vocabulary.
 *
 * Returns `undefined` — never `[]` — when nothing was dropped, so the member
 * is omitted on every run that dropped nothing.
 */
export function dropEventsOf(steps: readonly StepLogEntry[]): DroppedFieldsEvent[] | undefined {
    const byKey = new Map<string, DroppedFieldsEvent>();
    for (const step of steps) {
        for (const e of step.droppedFields ?? []) {
            const key = `${e.reason}\u0000${e.object}`;
            const held = byKey.get(key);
            if (!held) {
                byKey.set(key, { object: e.object, fields: [...e.fields], reason: e.reason });
                continue;
            }
            for (const f of e.fields) if (!held.fields.includes(f)) held.fields.push(f);
        }
    }
    const events = [...byKey.values()].filter((e) => e.fields.length > 0);
    return events.length > 0 ? events : undefined;
}

/**
 * The spread every terminal-success exit applies: `{ droppedFields }` when
 * {@link dropEventsOf} found any, `{}` otherwise — one spelling for the
 * omit-when-empty rule at all three exits (`execute()`, a retried attempt,
 * a resumed run).
 */
export function withDroppedFields(steps: readonly StepLogEntry[]): { droppedFields?: DroppedFieldsEvent[] } {
    const droppedFields = dropEventsOf(steps);
    return droppedFields ? { droppedFields } : {};
}
