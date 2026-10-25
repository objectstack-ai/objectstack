/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⭐ THE DECLARED DISPLAY-FIELD LEG REACHES THE CHART AXIS — objectui#7435.
 *
 * ## The defect, stated as what the user saw
 *
 * `resolveGroupByLabels`' display-field chain read
 * `fieldDef.reference_field || fieldDef.display_field || 'name'`. Neither leg is
 * a spelling `@objectstack/spec`'s `FieldSchema` declares, so `displayField` —
 * the ONLY display spelling a spec-compliant author can emit, and the one
 * `getObjectSchema` serves — could not reach this reader in any shape. It was
 * not mis-ranked; there was no leg at all. A chart grouped by such a lookup fell
 * through to the generic `'name'` heuristic and drew a label the author had
 * explicitly overridden.
 *
 * ⭐ That is why {@link fallsThroughToTheNameHeuristic} is in this file: it
 * names the value the pre-fix chain actually produced, so the fix is pinned
 * against a MEASURED wrong answer rather than against "something else".
 *
 * ## What each case asserts, and why it is the resolved VALUE
 *
 * Every case reads the axis label the row ended up with — `out[0].stage` — not
 * that the resolver ran. The referenced rows below carry THREE different labels
 * on three different columns, so a chain reading the wrong leg cannot
 * accidentally produce the right string: each assertion identifies exactly one
 * leg.
 *
 *   `title`        → only a `displayField` read finds it
 *   `legacy_title` → only a `reference_field` read, or a `display_field` the
 *                    ingestion fold stamped onto `displayField`, finds it
 *   `name`         → only the generic heuristic at the end of the chain
 *
 * ## Measured, on the pin this tree resolves
 *
 * `@objectstack/spec@17.4.0` (re-measured for this card; the card's own
 * correction was taken on 17.2.0 and asked for exactly this re-run).
 * `FieldSchema.safeParse` over a minimal lookup def ACCEPTS `displayField` and
 * REJECTS `reference_field` / `display_field` with `unrecognized_keys` —
 * controls lit in the same run: the minimal def ACCEPTED, `zzz_not_a_real_key`
 * REJECTED.
 *
 * ## Why the snake legs were kept, and why `display_field` no longer is
 *
 * A per-site producer sweep found no in-repo producer of either snake spelling
 * (every occurrence in this repo is a test fixture) and zero key-position
 * occurrences in the producer repo, control lit. objectui#7435 nevertheless
 * KEPT both, because two producers that can still emit them lie outside what
 * that sweep measures: a document stored before the key was tightened (the
 * serve path runs no parse — objectui#7650) and a host `DataSource` whose
 * `getObjectSchema` is not `ObjectStackAdapter`'s and so never passes through
 * `normalizeSchemaReferenceKeys`.
 *
 * ⭐ objectui#11070 round 6 retired the `display_field` leg. The stored
 * document is now covered by the ingestion fold: objectui#7650 ruling A has
 * `normalizeSchemaReferenceKeys` stamp a stored `display_field` onto
 * `displayField`, so a served def reaches this chain under the declared key
 * (the folded case below keeps the snake spelling as its INPUT). The host
 * `DataSource` is the break the round's changeset states. `reference_field`
 * keeps its fallback case: `FieldSchema` declares no twin the fold could stamp
 * it onto.
 */
import { describe, it, expect, vi } from 'vitest';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { resolveGroupByLabels } from './ObjectChart';

/**
 * The referenced object's rows. Three distinct labels on three columns so that
 * every assertion below identifies ONE leg of the chain and no other.
 */
const PROJECTS = [
  {
    id: 'p1',
    title: 'Apollo',
    legacy_title: 'Apollo (legacy dialect)',
    name: 'Apollo (generic heuristic)',
  },
];

/** One grouped row whose `stage` is the foreign key `PROJECTS[0]` answers to. */
const ROWS = [{ stage: 'p1', amount: 10 }];

/**
 * Resolve one `lookup` dimension whose field def is `fieldDef`, and hand back
 * the axis label the row ended up with.
 *
 * `dataSource.find` answers the referenced rows in the contract's `data`
 * member — the envelope objectui#6839 pinned — so this file measures the
 * display-field chain and nothing else.
 */
async function axisLabel(fieldDef: Record<string, unknown>): Promise<string> {
  const ds = { find: vi.fn(async () => ({ data: PROJECTS, total: PROJECTS.length })) };
  const out = await resolveGroupByLabels(
    ROWS,
    'stage',
    { name: 'crm_opportunity', fields: { stage: { type: 'lookup', reference: 'projects', ...fieldDef } } },
    ds,
  );
  return String(out[0].stage);
}

describe('ObjectChart display-field chain — the declared leg is read, and ranked first (objectui#7435)', () => {
  it('a value authored as `displayField` REACHES the axis', async () => {
    // The acceptance case. Before this change the declared spelling was not on
    // the chain at all, so this def resolved to `'Apollo (generic heuristic)'`.
    expect(
      await axisLabel({ displayField: 'title' }),
      'the spec-declared display spelling must reach the chart axis',
    ).toBe('Apollo');
  });

  it('`displayField` WINS over both snake legs when all three are present', async () => {
    // The ranking needs its own case: a chain that merely CONTAINS the declared
    // leg, appended last, passes the case above whenever nothing else matches
    // and fails only here.
    expect(
      await axisLabel({
        displayField: 'title',
        reference_field: 'legacy_title',
        display_field: 'legacy_title',
      }),
      'the declared spelling must outrank the recorded dialect',
    ).toBe('Apollo');
  });

  it('a `display_field`-only def no longer resolves it — the leg is retired, with no alias (objectui#11070 round 6)', async () => {
    expect(await axisLabel({ display_field: 'legacy_title' })).toBe('Apollo (generic heuristic)');
  });

  it('the same def folded at ingestion resolves it as `displayField` — a served def loses nothing (objectui#11070 round 6)', async () => {
    // The snake spelling is the INPUT. `ObjectStackAdapter.getObjectSchema`
    // runs this fold on every def it serves (objectui#7650 ruling A).
    const folded = normalizeSchemaReferenceKeys({
      name: 'crm_opportunity',
      fields: { stage: { type: 'lookup', reference: 'projects', display_field: 'legacy_title' } },
    });
    const ds = { find: vi.fn(async () => ({ data: PROJECTS, total: PROJECTS.length })) };
    const out = await resolveGroupByLabels(ROWS, 'stage', folded, ds);
    expect(String(out[0].stage)).toBe('Apollo (legacy dialect)');
  });

  it('a `reference_field`-only def still resolves — the fallback is intact', async () => {
    expect(await axisLabel({ reference_field: 'legacy_title' })).toBe('Apollo (legacy dialect)');
  });

  /**
   * The pre-fix answer, named. A def carrying ONLY the declared spelling used to
   * land here; it is what "the label is wrong" meant on this card.
   */
  it('falls through to the `name` heuristic when the def declares no display field at all', async () => {
    expect(
      await axisLabel({}),
      'with no display spelling on the def the generic heuristic is still the last leg',
    ).toBe('Apollo (generic heuristic)');
  });
});
