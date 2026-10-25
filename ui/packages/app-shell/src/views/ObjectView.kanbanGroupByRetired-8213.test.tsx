/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8213 — the object page wrote a THIRD spelling of the kanban lane
 * key into the view-level config it hands to `list-view`.
 *
 * `kanbanViewOptions` emitted `{ groupBy: lane, groupByField: lane }`: the
 * spec's own `groupByField`, and beside it `groupBy`, which
 * `@objectstack/spec`'s strict `KanbanConfigSchema` refuses BY NAME. Upstream
 * already knows the OTHER legacy spelling by name — probing `groupField`
 * answers "Did you mean `groupField` → `groupByField`?" — and knows nothing at
 * all about `groupBy`. objectui#8193 had moved this producer onto the canonical
 * key and deliberately left this half for a card of its own, because dropping
 * it needed a census first.
 *
 * ⭐ WHAT THIS FILE ASSERTS, AND WHY IT IS NOT A SOURCE-TEXT SNAPSHOT. Every arm
 * below RUNS the producer and asks `KanbanConfigSchema` about the object it
 * actually returned. Nothing here greps `ObjectView.tsx`, so a reformat, a
 * rename of the local `lane` variable, or a move of the expression cannot make
 * these arms lie in either direction: the claim is about emitted KEYS, and the
 * only way to satisfy it is to emit them.
 *
 * ⚠️ THE CLAIM IS NARROWER THAN "THE EMITTED BAG VALIDATES", and saying so is
 * the point of the ratchet arm. The producer also emits `titleField` and
 * `cardFields`, and `KanbanConfigSchema` — which declared exactly
 * `groupByField` / `summarizeField` / `columns` through `@objectstack/spec`
 * 17.4.0 — refused BOTH of those by name as well. 17.5.0 declares `titleField`
 * (objectui#11073), so the ratchet went DOWN to `cardFields` alone. They were a
 * different question and stayed:
 *   - `cardFields` is a DECLARED deprecated alias of the spec's `columns` in
 *     this repo's own `KanbanConfig` mirror (`@object-ui/types`), i.e. drift
 *     this repo has taken a documented position on;
 *   - `titleField` is live — `ListView` destructures it out of the merged
 *     config and forwards it onto the generated `object-kanban` node — and was
 *     undeclared anywhere until 17.5.0 declared it on `KanbanConfigSchema`.
 * Neither is a second spelling of a key this expression already writes
 * correctly, which is all objectui#8213 was. So the honest assertion is not
 * "nothing is refused" but "the refused set is EXACTLY the known ones" (two
 * through 17.4.0, one since) — which reddens for a new undeclared key, and
 * would have reddened for `groupBy`.
 *
 * ⭐ THE RATCHET REACHED ZERO (objectui#6152 round 12, seat answer Q1 → A). The
 * producer writes the card fields as the spec's `columns` now, because
 * `@object-ui/types` judges this bag as the spec's list overlay does and refuses
 * `options.kanban.cardFields` by name, and `ListView` reads `columns` for the
 * cards (the node and the `$select` measured identical under either spelling).
 * So the refused set is EMPTY, and the arms below say so; any undeclared key
 * the producer emits from here on reddens them.
 *
 * ⚠️ NO ARM HERE ASSERTS THE `...restKanban` OVERRIDE, deliberately. `ListView`
 * spread the rest of the merged kanban config AFTER its own `groupBy:
 * laneField`, so a surviving `groupBy` won over the lane it had just resolved.
 * That override was real, but it could not be pinned FROM THIS PRODUCER: every
 * bag this producer can build has `groupBy` and `groupByField` holding the same
 * value by construction, so an override row driven by it passes with or without
 * the fix — a test that cannot fail. Distinguishing the two spellings needed a
 * hand-built `plugin-list` fixture (`options.kanban.groupBy: 'a'` against
 * `kanban.groupByField: 'b'`), which was a `plugin-list` change on its own card.
 * ⭐ THAT FIXTURE NOW EXISTS and the override is closed — objectui#8365,
 * `plugin-list/src/__tests__/ListView.strayGroupByRefused-8365.test.tsx`. What
 * THIS deletion did remains what it always was: it removed the only producer in
 * this repo that fed the override. The arms below are unchanged by that card,
 * because they measure the producer, not the render branch.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `{ groupBy: lane, groupByField: lane }` in `kanbanViewOptions` and
 * the two discriminating arms plus the ratchet arm go RED by name, while every
 * CONTROL (the schema refusing a bogus key, the schema accepting the canonical
 * config, the lane still resolving) stays GREEN in both worlds. That asymmetry
 * is what makes the controls worth their lines: an instrument that refused
 * everything would satisfy the discriminating arms for the wrong reason.
 */

import { describe, it, expect } from 'vitest';
import { KanbanConfigSchema } from '@objectstack/spec/ui';
import { kanbanViewOptions } from './ObjectView';

/** An object whose lifecycle field the ADR-0085 detector finds by name. */
const OBJECT_WITH_STAGE = {
  name: 'deal',
  fields: { name: { type: 'text' }, stage: { type: 'select' } },
};

/** Every spelling of the ONE lane concept this repo has ever produced. */
const LANE_SPELLINGS = ['groupByField', 'groupField', 'groupBy'] as const;

/**
 * Key-level judgement only. The producer never emits the spec's REQUIRED
 * `columns`, so a full parse of its output is red in every world; reading
 * `unrecognized_keys` is what separates "this key is refused by name" from that
 * orthogonal noise. Same discipline the card's own four probes used.
 */
const refusedKeys = (bag: Record<string, unknown>): string[] => {
  const r = KanbanConfigSchema.safeParse(bag);
  if (r.success) return [];
  return r.error.issues
    .flatMap((i: any) => (i.code === 'unrecognized_keys' ? (i.keys as string[]) : []))
    .sort();
};

/** The lane keys actually PRESENT on a bag, by name, in sorted order. */
const laneKeysOf = (bag: Record<string, unknown>) =>
  LANE_SPELLINGS.filter((k) => k in bag).sort();

/**
 * The keys the producer emits that the spec refuses. Two through
 * `@objectstack/spec` 17.4.0 (`cardFields`, `titleField`); `titleField` left the
 * set when 17.5.0 declared it (objectui#11073), and `cardFields` when the
 * producer moved to the spec's `columns` (objectui#6152 round 12). Empty: the
 * ratchet may only stay here.
 */
const KNOWN_REFUSED_RESIDUAL: string[] = [];

describe('the instrument can answer both ways on this exact call (objectui#8213)', () => {
  it('CONTROL: the strict schema refuses an unknown key BY NAME on the producer output', () => {
    // Fires. Without it, every empty refusal below is indistinguishable from a
    // schema that has stopped judging this call shape at all.
    const emitted = kanbanViewOptions({ kanban: { groupByField: 'stage' } }, OBJECT_WITH_STAGE);
    expect(refusedKeys({ ...emitted, zzzBogusKey: 'x' })).toContain('zzzBogusKey');
  });

  it('CONTROL: the strict schema refuses NOTHING in a canonical config', () => {
    // Accepts. Without it, "refused" could just mean "refuses everything".
    expect(refusedKeys({ groupByField: 'stage', columns: ['name'] })).toEqual([]);
  });

  it('CONTROL: `groupBy` is still not a key the spec declares', () => {
    // The premise tripwire. objectui#7685 moved the resolved spec pin while
    // this card was open, so the measurement was re-run on the installed
    // version — if a later bump ever DECLARES `groupBy`, this reddens first and
    // every arm below stops meaning what it says.
    expect(Object.keys((KanbanConfigSchema as any).shape)).not.toContain('groupBy');
  });
});

describe('the object page emits ONE lane spelling — the spec\'s (objectui#8213)', () => {
  // THE DISCRIMINATING ARMS. Each ran with `groupBy` in the emitted bag before
  // this card, on every path that resolves a lane.
  it('for a view that declared the canonical key', () => {
    const emitted = kanbanViewOptions({ kanban: { groupByField: 'stage' } }, OBJECT_WITH_STAGE);
    expect(laneKeysOf(emitted)).toEqual(['groupByField']);
    expect(refusedKeys(emitted)).not.toContain('groupBy');
  });

  it('for a view that stored the retired LEGACY alias', () => {
    // The alias READ was untouched by this card; objectui#6152 round 14 retired
    // it. The lane is the detector's (a value the alias does not name), and it
    // still leaves under one key only.
    const emitted = kanbanViewOptions({ kanban: { groupField: 'name' } }, OBJECT_WITH_STAGE);
    expect(laneKeysOf(emitted)).toEqual(['groupByField']);
    expect(emitted.groupByField).toBe('stage');
  });

  it('for a lane the ADR-0085 detector supplied', () => {
    // The commonest case in the product — a view with no kanban block at all.
    const emitted = kanbanViewOptions({}, OBJECT_WITH_STAGE);
    expect(laneKeysOf(emitted)).toEqual(['groupByField']);
  });

  it('and emits no lane key at all when no lane resolves', () => {
    // Absence stays absence: a producer that always emitted a lane key — even
    // an empty one — would light the capability gate for every object view.
    const emitted = kanbanViewOptions({}, { name: 'note', fields: { body: { type: 'text' } } });
    expect(laneKeysOf(emitted)).toEqual([]);
  });
});

describe('the one reader of `groupBy` still gets the same value (objectui#8213)', () => {
  it('carries the lane under `groupByField`, the rung the collectors read first', () => {
    // The census question, stated as a property rather than as a claim about
    // call sites. `ListView`'s two projection/expand collectors listed
    // `v.groupByField, v.groupField, v.groupBy` as candidates for the SAME lane
    // value; deleting the third was only safe because the first carries it, and
    // since objectui#6152 round 14 the first is the only one they list. If a
    // future edit moved the value onto `groupBy` alone, this reddens.
    expect(kanbanViewOptions({}, OBJECT_WITH_STAGE).groupByField).toBe('stage');
  });

  it('CONTROL: a lane really did resolve, so the arm above is not an empty agreeing with an empty', () => {
    const emitted = kanbanViewOptions({}, OBJECT_WITH_STAGE);
    expect(Object.keys(emitted).length).toBeGreaterThan(0);
    expect(emitted.groupByField).toBeTruthy();
  });
});

describe('the RATCHET on what the spec still refuses here (objectui#8213)', () => {
  // ⭐ THE DURABLE ARM. Not "the emitted bag validates" — it does not, and this
  // file's header says why. This is the exact refused SET, so `groupBy` cannot
  // come back and a FOURTH undeclared key cannot join quietly.
  it('refuses nothing the producer emits: the residual set is empty', () => {
    const emitted = kanbanViewOptions({ kanban: { groupByField: 'stage' } }, OBJECT_WITH_STAGE);
    expect(refusedKeys(emitted)).toEqual(KNOWN_REFUSED_RESIDUAL);
  });

  it('holds on the detector path and the no-lane path too', () => {
    expect(refusedKeys(kanbanViewOptions({}, OBJECT_WITH_STAGE))).toEqual(KNOWN_REFUSED_RESIDUAL);
    expect(
      refusedKeys(kanbanViewOptions({}, { name: 'note', fields: { body: { type: 'text' } } })),
    ).toEqual(KNOWN_REFUSED_RESIDUAL);
  });

  it('CONTROL: the residual set is what it says it is: empty, so neither `groupBy` nor `cardFields` is in it', () => {
    // Guards the ratchet against being satisfied by a residual list that
    // quietly grew to include a key this card or objectui#6152 retired.
    expect(KNOWN_REFUSED_RESIDUAL).toEqual([]);
  });

  it('writes the card fields under the spec\'s `columns`, never the retired `cardFields` (objectui#6152 round 12)', () => {
    const emitted = kanbanViewOptions({ kanban: { groupByField: 'stage', columns: ['name', 'amount'] } }, OBJECT_WITH_STAGE);
    expect(emitted.columns).toEqual(['name', 'amount']);
    expect('cardFields' in emitted).toBe(false);
  });
});
