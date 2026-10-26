/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⭐ `listCellRendererTypes()` IS A READING, NOT A SNAPSHOT (objectui#8734).
 *
 * Two censuses — `cellRenderers.objectLiteral-8596` here and
 * `summaryChip.badgeFitCensus-8464` in `@object-ui/plugin-detail` — used to
 * enforce their declared population ("every type `getCellRenderer` resolves to
 * a renderer of its own") with the literal `53`. Both now reconcile against
 * this function instead, which moves the whole weight of that repair onto ONE
 * property: that this function answers about the registry as it is AT CALL
 * TIME. A frozen `Object.freeze(Object.keys(...))` constant would satisfy every
 * assertion in both censuses today and re-introduce the identical defect one
 * level down — silently, because a census reconciled against a stale reading
 * is green for exactly the same reason a census with a stale literal is.
 *
 * So the discriminating case is the one below: register a renderer AFTER this
 * module was evaluated and require the answer to grow. A snapshot fails it; the
 * live read passes. The control leg — the same query before the registration —
 * is what makes the growth attributable to the registration and not to a type
 * that was there all along.
 *
 * ⚠️ `registerFieldRenderer` has no inverse, so this file registers a spelling
 * no product type uses and relies on per-file module isolation. That is why it
 * is a `.tsx`: `vitest.config.mts` runs `packages/**\/*.test.ts` in the `unit`
 * project under `isolate: false` — one module graph shared across the worker's
 * files — where a registration made here would still be installed when an
 * unrelated file later asks the registry what it holds. The `dom` project this
 * file lands in keeps `isolate: true`.
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import {
  getCellRenderer,
  listCellRendererTypes,
  registerFieldRenderer,
  TextCellRenderer,
  type CellRendererProps,
} from '../index';

/** A spelling no product field type uses, so the control leg below is honest. */
const PROBE_TYPE = 'objectui-8734-probe-type';

const ProbeCellRenderer: React.FC<CellRendererProps> = () => <span>probe</span>;

describe('objectui#8734 — the registry reading the censuses reconcile against', () => {
  it('answers a non-empty, sorted, duplicate-free list', () => {
    const types = listCellRendererTypes();
    expect(types.length, 'an empty reading would make every census vacuously true').toBeGreaterThan(
      0,
    );
    expect(new Set(types).size, 'no type is listed twice').toBe(types.length);
    expect([...types], 'the order is stable for callers that diff it').toEqual([...types].sort());
  });

  it('lists the types that resolve to a renderer of their own, and not the fallback spellings', () => {
    const types = new Set(listCellRendererTypes());
    // Both dispatch sources getCellRenderer reads are represented: `select` is
    // registered into the runtime registry at module load, `json` exists only
    // in the standard table.
    expect(types.has('select'), 'a runtime-registered type is listed').toBe(true);
    expect(types.has('json'), 'a standard-table-only type is listed').toBe(true);

    // The total fallback is NOT a membership: an unlisted spelling still
    // resolves, to TextCellRenderer, which is precisely why it is not a type
    // "with a renderer of its own".
    const unlisted = 'objectui-8734-never-registered';
    expect(types.has(unlisted), 'an unregistered spelling is not listed').toBe(false);
    expect(getCellRenderer(unlisted), 'and it falls to the total fallback').toBe(TextCellRenderer);
  });

  it('⭐ GROWS when a renderer is registered after this module was evaluated', () => {
    // Control leg — attributes the growth below to the registration.
    const before = listCellRendererTypes();
    expect(before.includes(PROBE_TYPE), 'control: the probe type is absent to begin with').toBe(
      false,
    );

    registerFieldRenderer(PROBE_TYPE, ProbeCellRenderer);

    const after = listCellRendererTypes();
    expect(after.includes(PROBE_TYPE), 'the reading is taken now, not at import time').toBe(true);
    expect(after.length, 'and the population grew by exactly the one type').toBe(before.length + 1);
    expect(getCellRenderer(PROBE_TYPE), 'the new type resolves to its own renderer').toBe(
      ProbeCellRenderer,
    );
  });
});
