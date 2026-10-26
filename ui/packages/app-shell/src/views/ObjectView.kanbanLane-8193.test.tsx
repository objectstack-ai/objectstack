/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8193 — the object page emitted the DEPRECATED view-level kanban
 * alias, into the one bag the alias fold is told not to reach.
 *
 * `ObjectView` built `options.kanban` and wrote `groupField` — never the
 * spec-canonical `groupByField` — even though it already READ the canonical key
 * first. Its sibling producer in this same package, `defaultKanbanFromObject`
 * (`InterfaceListPage`), had migrated long before and left the reasoning in a
 * comment: "that read-site now prefers the spec key, so one key is enough."
 * The twin twelve hundred lines away was not carried along, so one producer
 * surface spoke two vocabularies for one concept depending on which entry point
 * the user arrived through.
 *
 * ⭐ THE ANTI-FORK ARM IS THE DURABLE HALF OF THIS CARD. Pinning only
 * `kanbanViewOptions` would pin today's spelling; the defect was that the two
 * producers DRIFTED. So the vocabulary of both is derived and compared here —
 * whichever one a future edit moves, this file reddens.
 *
 * ⚠️ WHY `normalizeListViewSchema` COULD NOT SAVE THIS. Its alias fold mapped
 * `kanban.groupField` to `groupByField` on the DECLARED path only, and its own
 * suite pins that boundary as intentional ("does not reach into the legacy
 * `options.*` twin"). `ObjectView` writes into `options.kanban`, on the far
 * side of that boundary, so nothing folded it and the alias read was
 * load-bearing purely because of where this producer wrote. (The fold retired
 * in objectui#6152 round 14, with the alias reads.)
 *
 * ⚠️ THIS CARD RETIRED NO ALIAS READ: it changed what this face WRITES. The
 * reads went later, on their own ruling (objectui#6152 round 14): this face,
 * `ListView` and `ObjectView` read the lane from `groupByField` alone now. The
 * legacy-alias arm below was re-judged then: it pins that the alias names no
 * lane, with a value the detector would never pick.
 *
 * ⚠️ `groupBy` WAS STILL WRITTEN WHEN THIS FILE LANDED, and is not any more:
 * objectui#8213 ran the producer census this file deferred and retired the
 * third spelling. The arms below that named it have been re-judged rather than
 * spelling-swapped — the spec-refusal arm is still true and still here, the
 * producer arm that asserted the write is gone, and the anti-fork arm no longer
 * has to filter `groupBy` out before comparing the two producers. What that
 * retirement asserts is pinned in `ObjectView.kanbanGroupByRetired-8213`.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `return lane ? { groupBy: lane, groupField: lane } : {}` and the
 * canonical arms below go RED (the emitted bag loses `groupByField` and grows
 * `groupField` back), while the ADR-0085 lane-RESOLUTION controls stay GREEN in
 * either world — those read which FIELD was chosen, which the defect never
 * changed. That asymmetry is the point: this defect was never about the value,
 * only ever about the key it was filed under, so a test asserting the lane
 * field alone would have passed against the unfixed producer.
 */

import { describe, it, expect } from 'vitest';
import { KanbanConfigSchema } from '@objectstack/spec/ui';
import { kanbanViewOptions } from './ObjectView';
import { defaultKanbanFromObject } from './InterfaceListPage';

/** An object whose lifecycle field the ADR-0085 detector finds by name. */
const OBJECT_WITH_STAGE = {
  name: 'deal',
  fields: { name: { type: 'text' }, stage: { type: 'select' } },
};

/** The lane-bearing keys, in every spelling this repo has ever used. */
const LANE_KEYS = ['groupByField', 'groupField', 'groupBy'] as const;
const laneKeysOf = (bag: Record<string, unknown>) =>
  LANE_KEYS.filter((k) => bag[k] !== undefined).sort();

describe('the object page writes the SPEC lane key (objectui#8193)', () => {
  // THE DISCRIMINATING ARM — the card's defect, stated directly. Before the fix
  // this bag was `{ groupBy: 'stage', groupField: 'stage' }`: the canonical key
  // the spec declares was the one spelling it never wrote.
  it('emits `groupByField` for a view that declared the canonical key', () => {
    const out = kanbanViewOptions({ kanban: { groupByField: 'stage' } }, OBJECT_WITH_STAGE);
    expect(out.groupByField).toBe('stage');
    expect(out).not.toHaveProperty('groupField');
  });

  it('a view that stored the retired LEGACY alias gets the detector\'s lane, not the alias\'s (objectui#6152 round 14)', () => {
    // When this card landed the alias was still READ (the value came in legacy
    // and left canonical), and this arm wrote `stage`, the very field the
    // detector picks, so it could not tell a read alias from an ignored one.
    // Re-judged with a value the detector never picks: the alias names no lane.
    const out = kanbanViewOptions({ kanban: { groupField: 'name' } }, OBJECT_WITH_STAGE);
    expect(out.groupByField).toBe('stage');
    expect(out).not.toHaveProperty('groupField');
  });

  it('emits `groupByField` for a lane the ADR-0085 detector supplied', () => {
    // The commonest case in the product: a view that declared no kanban block
    // at all, on an object whose lifecycle field the detector finds.
    const out = kanbanViewOptions({}, OBJECT_WITH_STAGE);
    expect(out.groupByField).toBe('stage');
    expect(out).not.toHaveProperty('groupField');
  });

  it('emits NO lane key at all when no lane resolves', () => {
    // The other half. A producer that always emitted `groupByField` — even
    // empty — would pass every arm above and light the capability gate for
    // every object view, which is the objectui#7547 defect one visualization
    // over. Absence must stay absence.
    const out = kanbanViewOptions({}, { name: 'note', fields: { body: { type: 'text' } } });
    expect(laneKeysOf(out)).toEqual([]);
  });

  it('respects the strict `stageField: false` lane suppression', () => {
    // ADR-0085: the object declared its status-shaped field non-linear, so the
    // detector must not offer it as a lane. Pinned here because the rewrite
    // moved this expression into a named function.
    const out = kanbanViewOptions(
      {},
      { name: 'deal', stageField: false, fields: { stage: { type: 'select' } } },
    );
    expect(laneKeysOf(out)).toEqual([]);
  });

  it('keeps the non-lane forwards the inline expression carried', () => {
    const out = kanbanViewOptions(
      { kanban: { groupByField: 'stage', titleField: 'subject', columns: ['amount'] } },
      OBJECT_WITH_STAGE,
    );
    expect(out.titleField).toBe('subject');
    expect(out.columns).toEqual(['amount']);
  });

  it('floors `titleField` at `name`, as the four sibling faces do', () => {
    expect(kanbanViewOptions({}, OBJECT_WITH_STAGE).titleField).toBe('name');
  });
});

describe('the two app-shell kanban producers speak ONE vocabulary (objectui#8193)', () => {
  // ⭐ THE ANTI-FORK PIN. This is the arm that would have caught the original
  // drift, and the one that catches the next one: it names neither spelling,
  // it asserts the two producers AGREE. `defaultKanbanFromObject` is the
  // sibling that migrated first and whose comment set the precedent.
  it('derive the same lane key from the same object', () => {
    const viaObjectPage = kanbanViewOptions({}, OBJECT_WITH_STAGE);
    const viaInterfacePage = defaultKanbanFromObject(OBJECT_WITH_STAGE);

    // objectui#8213 removed the `.filter((k) => k !== 'groupBy')` that stood
    // here. It existed only because this face emitted a third spelling the
    // sibling never did; with the write gone the comparison is unfiltered, so
    // re-introducing ANY lane spelling on either side now reddens this arm.
    const objectPageLaneKeys = laneKeysOf(viaObjectPage);
    const interfacePageLaneKeys = laneKeysOf(
      viaInterfacePage as unknown as Record<string, unknown>,
    );

    expect(interfacePageLaneKeys).toEqual(['groupByField']);
    expect(objectPageLaneKeys).toEqual(interfacePageLaneKeys);
  });

  it('CONTROL: both actually resolved a lane, so the agreement is not two empties', () => {
    // Without this, a future edit that made BOTH producers emit nothing would
    // satisfy the arm above — two empty sets are equal. The agreement has to be
    // an agreement about a value that exists.
    expect(kanbanViewOptions({}, OBJECT_WITH_STAGE).groupByField).toBe('stage');
    expect(defaultKanbanFromObject(OBJECT_WITH_STAGE)?.groupByField).toBe('stage');
  });
});

describe('the emitted lane key is the one `@objectstack/spec` declares (objectui#8193)', () => {
  /** Key-level judgement only: does the strict schema recognize this NAME? */
  const unrecognized = (cfg: Record<string, unknown>): string[] => {
    const r = KanbanConfigSchema.safeParse(cfg);
    if (r.success) return [];
    return r.error.issues.flatMap((i: any) => (i.code === 'unrecognized_keys' ? i.keys : []));
  };

  // A config complete enough to parse GREEN, so the arms below separate "this
  // key is refused" from "this fixture is missing a required key".
  const complete = (extra: Record<string, unknown>) => ({
    groupByField: 'stage',
    columns: ['name'],
    ...extra,
  });

  it('CONTROL: the strict schema accepts the canonical config outright', () => {
    // Establishes the schema can say YES on this exact call shape. Without it,
    // every refusal below is indistinguishable from a schema that refuses all.
    expect(KanbanConfigSchema.safeParse(complete({})).success).toBe(true);
  });

  it('CONTROL: the strict schema refuses a bogus key BY NAME on the same call', () => {
    // Establishes the schema can say NO, and names what it refused. Without
    // this arm, an acceptance below means nothing.
    expect(unrecognized(complete({ zzzBogusKey: 'stage' }))).toContain('zzzBogusKey');
  });

  it('accepts the key this face now emits', () => {
    const emitted = kanbanViewOptions({}, OBJECT_WITH_STAGE);
    expect(emitted.groupByField).toBe('stage');
    expect(unrecognized({ groupByField: emitted.groupByField as string, columns: ['name'] })).toEqual([]);
  });

  it('refuses the key this face used to emit, by name', () => {
    // The spec-side statement of the whole card. Its own message even names the
    // migration: "Did you mean `groupField` to `groupByField`?"
    expect(unrecognized(complete({ groupField: 'stage' }))).toContain('groupField');
  });

  it('refuses `groupBy` by name too — the finding this file made, objectui#8213', () => {
    // The card's one explicitly unmeasured question, answered here so the
    // answer cannot be lost: `groupBy` is not a spec key at view level either.
    // ⚠️ The second half of this arm used to assert the producer STILL wrote it
    // (`kanbanViewOptions({}, OBJECT_WITH_STAGE).groupBy === 'stage'`).
    // objectui#8213 ran the census and deleted the write, so that half was
    // replaced rather than re-spelled — asserting the retirement belongs with
    // the rest of it, in `ObjectView.kanbanGroupByRetired-8213`.
    expect(unrecognized(complete({ groupBy: 'stage' }))).toContain('groupBy');
  });

  it('declares exactly the four keys this file reasons about', () => {
    // A tripwire on the premise itself: if a future spec bump declares
    // `groupBy` (or drops `groupByField`), the arms above stop meaning what
    // they say and this reddens first. It fired at the 17.5.0 bump
    // (objectui#11073) for a key that is NOT a lane spelling: 17.5.0 declares
    // `titleField` (the card-title binding, falling back to the record display
    // name). Re-read: every arm above is about the lane key and still holds, so
    // the pin moves from three keys to four and nothing else does.
    expect(Object.keys((KanbanConfigSchema as any).shape).sort()).toEqual([
      'columns',
      'groupByField',
      'summarizeField',
      'titleField',
    ]);
  });
});
