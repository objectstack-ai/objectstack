/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-grid` — the LEGACY `defaultFilters` leg must reach `$filter` through
 * the same lowering sink as the canonical `filter` key (objectui#4082).
 *
 * ⚠️ RETIRED since objectui#12030. `@objectstack/spec` 18 tombstones
 * `object-grid.defaultFilters` (objectstack#11509), refusing it by name, and
 * the grid no longer reads it: the leg this file was written for is gone. The
 * cases below now pin that absence for every shape the leg used to lower,
 * beside the canonical `filter` cases, which are unchanged. The history below
 * is kept as the record of what the leg did while it stood.
 *
 * ## What was wrong
 *
 * objectui#4041 converged the declared `filter` key onto `toFilterNode`, the
 * repo's single "last hop before the wire". The legacy branch sitting directly
 * beside it was left assigning byte-for-byte:
 *
 *   if (schemaFilter !== undefined) {
 *     params.$filter = schemaFilter;            // lowered
 *   } else if (schema.defaultFilters) {
 *     params.$filter = schema.defaultFilters;   // NOT lowered
 *   }
 *
 * That made this the one leg on the chain reaching the wire unlowered —
 * `plugin-list`'s `buildEffectiveFilter` and `plugin-view`'s non-grid fetch
 * both already route the same value through `toFilterNode`/`mergeFilterNodes`.
 *
 * `isFilterAST` refuses BOTH shapes this slot carries, so either one sent raw
 * is the `400 INVALID_FILTER` measured against a real backend in
 * objectui#3431:
 *
 *   - the `Record<string, any>` (MongoDB-style) the key was declared as until
 *     objectui#6152 round 10 — a plain OBJECT where the wire expects an AST
 *     node (the key is the row's `ViewFilterRule` array since, and the record
 *     no longer validates, but the sink still lowers one that reaches the slot);
 *   - a `ViewFilterRule[]` — an array of rule OBJECTS, which `plugin-view`
 *     forwards into this slot for an active named view (`ObjectView.tsx`, the
 *     `gridSchema` memo: `defaultFilters: viewFilter || …`).
 *
 * The second one is why this is not purely dormant. The card was filed on "no
 * measured producer", reasoning that `defaultFilters` is not in `object-grid`'s
 * registered `inputs` so an author writing it only draws a save-gate warning.
 * That covers authors, not the framework: `plugin-view`'s README documents
 * `listViews.<name>.filter` as `[{ field, operator, value }, …]`, and the
 * registered `object-view` renderer passes no `renderListView`, so that path
 * falls through to `ObjectGrid` rather than to `ListView`.
 *
 * ## What these tests pin
 *
 * That the legacy slot is lowered — the assertion is `$filter` carrying AST,
 * never merely `$filter` being present, for the same reason the sibling
 * `gridFilterInputSpelling.test.tsx` states: "it arrived" and "it arrived in a
 * shape the server accepts" are different claims, and only the second is worth
 * anything here.
 *
 * And two NEGATIVE CONTROLS, which are the half that would rot silently:
 *
 *   1. the canonical `filter` path is untouched — it still wins over the
 *      legacy slot, and its own lowering / pass-through / empty-fold behaviour
 *      is unchanged;
 *   2. an already-AST value in the legacy slot is NOT lowered a second time.
 *      A sink applied twice is the mirror-image defect of a sink not applied,
 *      and it is what a careless "just wrap it in toFilterNode" would produce.
 *
 * ## Reverse verification (prediction recorded BEFORE the run)
 *
 * Restoring the raw assignment (`} else if (schema.defaultFilters) { params.
 * $filter = schema.defaultFilters; }`) was predicted to move exactly three
 * cases and no others:
 *
 *   RED   — the `Record` case (`$filter` arrives as the plain object)
 *   RED   — the `ViewFilterRule[]` case (`$filter` arrives as rule objects)
 *   RED   — the empty-object case (`$filter` arrives as `{}` rather than absent)
 *   GREEN — every already-AST case, both slots: the pre-fix code passed AST
 *           through verbatim too, so a control that MOVED here would mean the
 *           change double-lowers rather than that it works
 *   GREEN — every canonical-`filter` case: the change does not touch that branch
 *
 * "Everything turns red" would have been the wrong outcome, not a stronger
 * one — it would say the controls are not controls. Observed result is
 * recorded on the PR.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-grid` and its `view:grid` alias.
import '../index';

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({
      data: [{ id: '1', name: 'Acme', status: 'active', stage: 'won' }],
      total: 1,
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        status: { type: 'text' },
        stage: { type: 'text' },
        amount: { type: 'number' },
      },
    }),
  };
}

/**
 * Render the block and return the params of its first `find` call.
 *
 * Deliberately the SAME harness shape as `gridFilterInputSpelling.test.tsx`,
 * so the canonical and legacy spellings are observed through one lens — the
 * whole subject here is that the two legs disagreed.
 */
async function findParamsFor(schema: Record<string, unknown>) {
  const adapter = makeAdapter();
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return (adapter.find.mock.calls[0] as [string, any])[1];
}

const BASE = { type: 'object-grid', objectName: 'account', columns: [{ field: 'name' }] };

describe('object-grid — the retired `defaultFilters` is not read (objectui#12030)', () => {
  // Each shape the legacy leg used to lower (objectui#4082): the record it was
  // declared as until objectui#6152 round 10, the rule array, an already
  // composed AST, a flat array of AST nodes. None of them reaches `$filter`.
  it.each([
    ['a `Record`', { status: 'active' }],
    ['a multi-key `Record`', { status: 'active', stage: 'won' }],
    ['a `ViewFilterRule[]`', [{ field: 'status', operator: 'equals', value: 'in_progress' }]],
    ['a composed AST', ['and', ['stage', '=', 'won'], ['amount', '>', 100]]],
    ['a flat array of AST nodes', [['status', '=', 'active']]],
  ])('%s in `defaultFilters` sends no `$filter`', async (_shape, defaultFilters) => {
    const params = await findParamsFor({ ...BASE, defaultFilters });
    expect(params.$filter).toBeUndefined();
  });

  it('LIT CONTROL: the same rule array written as `filter` is lowered and sent', async () => {
    const params = await findParamsFor({
      ...BASE,
      filter: [{ field: 'status', operator: 'equals', value: 'in_progress' }],
    });
    expect(params.$filter).toEqual([['status', 'equals', 'in_progress']]);
  });

  it('omits `$filter` when neither slot is written', async () => {
    const params = await findParamsFor({ ...BASE });
    expect(params.$filter).toBeUndefined();
  });
});

describe('object-grid — NEGATIVE CONTROL: the declared `filter` path is unchanged (objectui#4082)', () => {
  it('the canonical `filter` answers alone when the retired slot is also written', async () => {
    // The retired value must not appear at all, merged or as a fallback.
    const params = await findParamsFor({
      ...BASE,
      filter: [['stage', '=', 'won']],
      defaultFilters: { status: 'active', amount: { $gt: 100 } },
    });
    expect(params.$filter).toEqual([['stage', '=', 'won']]);
  });

  it('a canonical `filter` that folds away does not fall back to the retired slot', async () => {
    // `filter: []` folds to `undefined`. Until objectui#12030 the legacy slot
    // answered here; it is not read now, so no `$filter` goes out.
    const params = await findParamsFor({
      ...BASE,
      filter: [],
      defaultFilters: { status: 'active' },
    });
    expect(params.$filter).toBeUndefined();
  });

  it('still lowers the canonical `filter` itself', async () => {
    const params = await findParamsFor({
      ...BASE,
      filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
    });
    expect(params.$filter).toEqual([['stage', 'equals', 'won']]);
  });

  it('still passes an already-composed canonical AST through untouched', async () => {
    const params = await findParamsFor({
      ...BASE,
      filter: ['and', ['stage', '=', 'won'], ['amount', '>', 100]],
    });
    expect(params.$filter).toEqual(['and', ['stage', '=', 'won'], ['amount', '>', 100]]);
  });

  it('still omits `$filter` for a declared-but-empty canonical filter', async () => {
    const params = await findParamsFor({ ...BASE, filter: [] });
    expect(params.$filter).toBeUndefined();
  });
});

describe('object-grid — the legacy `defaultSort` leg is NOT filter-lowered (objectui#4082), and is now RETIRED (objectui#5861)', () => {
  it('a retired `defaultSort` reaches neither `$orderby` nor `$filter`', async () => {
    // The sibling leg triage asked to grade with this one (objectui#4082). It
    // used to feed `$orderby` as the declared `"field order"` clause string,
    // and was pinned here so a later pass could not pattern-match the filter
    // fix onto sort. objectui#5861 then retired the key under ADR-0049 —
    // `@objectstack/spec` refuses it by name on `object-grid` — so this cell
    // is FLIPPED: the leg is gone, and it must not resurface as a filter
    // either. Canonical control: the next cell, same document shape.
    const params = await findParamsFor({
      ...BASE,
      defaultSort: { field: 'name', order: 'desc' } as unknown as Record<string, unknown>,
    });
    expect(params.$orderby).toBeUndefined();
    expect(params.$filter).toBeUndefined();
  });

  it('keeps the canonical `sort` emitting the clause-string vocabulary', async () => {
    // CONTROL for the cell above. Unlike filter — where canonical is lowered
    // and legacy was raw — the sort legs emitted the identical shape, which is
    // why there was never an asymmetry to fix; only the canonical leg is left.
    const params = await findParamsFor({
      ...BASE,
      sort: [{ field: 'name', order: 'desc' }],
    });
    expect(params.$orderby).toBe('name desc');
  });
});
