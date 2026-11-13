// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DroppedFieldsEventSchema, type DroppedFieldsEvent } from '@objectstack/spec/data';
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
 * `screen` node still reaches the answer the run finally gives. A delegated
 * write reaches it the same way `summary` credits one: the `subflow` / `map`
 * step carries its child runs' answers ({@link foldDropEvents}).
 */
export function dropEventsOf(steps: readonly StepLogEntry[]): DroppedFieldsEvent[] | undefined {
    return foldDropEvents(steps.map((step) => step.droppedFields));
}

/**
 * The ONE fold (#32861, #33019): every list of drop events a run answers for —
 * its steps' (`dropEventsOf`), a `map` entry's synchronously completed items',
 * a paused child's credited to the step that awaited it (`creditChildRun`) —
 * goes through here, so all of them coalesce under one rule.
 *
 * Coalesced, not concatenated: one event per `(object, reason)`, its `fields`
 * the union in first-seen order. A loop that writes thirty rows and drops
 * `status` on each is one fact for the caller ("status did not take effect"),
 * not thirty, and the answer stays bounded by the schema rather than by the
 * run's length. The element is the engine's own event, unchanged in shape —
 * no new vocabulary. The fields are copied, so no input array is mutated.
 *
 * Total, never throwing: a list or an event that is not well-typed against
 * `DroppedFieldsEventSchema` is skipped. Both in-tree producers are
 * well-typed, but a host-registered executor's `droppedFields` reaches the
 * step unchecked, and the callers run this inside the `try` whose `catch`
 * reads any throw as a node or run failure — a report about values that did
 * not land must never turn a completed run into a failed or retried one.
 *
 * Returns `undefined` — never `[]` — when nothing was dropped, so the member
 * is omitted on every run that dropped nothing.
 */
export function foldDropEvents(lists: Iterable<unknown>): DroppedFieldsEvent[] | undefined {
    const byKey = new Map<string, DroppedFieldsEvent>();
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const raw of list) {
            const parsed = DroppedFieldsEventSchema.safeParse(raw);
            if (!parsed.success) continue;
            const e = parsed.data;
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
