/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `LookupCellRenderer`'s fetch-on-demand resolver reads a `find()` answer with
 * the ONE rows member `QueryResult` DECLARES first — `data` (objectui#6917
 * arm A, following objectui#6726 / #6840 / #6839).
 *
 * Before this pin, `useLookupName` spelled its unwrap
 *
 *     Array.isArray(result) ? result : (result?.value || result?.data || [])
 *
 * — `value` AHEAD of `data`. `QueryResult` (`@object-ui/types`) declares
 * exactly one rows member and it is `data`; `value` is the OData spelling.
 * That is a PRECEDENCE INVERSION, not merely a dead arm: a producer emitting
 * both members was resolved to the undeclared one, and the declared one was
 * ignored. It is the same inversion objectui#5945 named and objectui#6726
 * repaired for `records`, standing on the key those cards did not measure.
 *
 * ── Why the arm is KEPT and only the ORDER changed ────────────────────────
 * MEASURED on this tree for objectui#6917, per seam rather than carried over
 * from objectui#6840's zero (that zero is seam-local and says nothing here):
 *
 *   CELL      every `find()` producer body in the repo, bracket-scanned
 *             through chained calls .......................  592 producers
 *   CONTROL   `data`  emitted as an envelope member .......  312 producers
 *   CONTROL   `total` emitted as an envelope member .......  150 producers
 *   SUBJECT   `value` emitted as an envelope member .......    8 producers
 *             (3 plugin-kanban, 3 plugin-calendar, 2 plugin-grid)
 *   SUBJECT   `value` AND `data` both, as envelope members     0 producers
 *
 * The controls sit on the JOIN — same cell, same pass, same extraction — so
 * these are readings, not unmeasured cells.
 *
 * `value` is therefore LIVE at this seam and the arm STAYS: deleting it would
 * break the eight producers above, which is the plausible wrong fix this file
 * exists to refuse. What was wrong was only its RANK. Because 0 producers emit
 * both members today, the inversion was a "potentially answers wrong" rather
 * than an "answers wrong" — which is why objectui#6917 was graded p2, not p1.
 *
 * The unwrap now delegates to `@object-ui/core`'s `extractRecords`, whose
 * accepted set (bare array, `data`, `value`) is identical and whose order is
 * the contract's. One measured implementation instead of a fourth hand-rolled
 * ladder.
 *
 * ⛔ The fix is the ordering, NOT widening `QueryResult` to bless `value` —
 * that is a published-type change and the maintainer's call, the floor
 * objectui#6726, #6840 and #6839 all held.
 *
 * ── What separates the two orders ─────────────────────────────────────────
 * ONLY a result carrying BOTH members with DIFFERENT contents. A fixture
 * carrying just `data` passes on the correct order AND on the inverted one, so
 * it cannot see precedence at all. The live arms are pinned beside it, because
 * live-versus-dead is the whole distinction.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { LookupCellRenderer } from '../index';
import { SchemaRendererProvider } from '@object-ui/react';

/**
 * A data source WITHOUT `findOne` — that is what routes the resolver down the
 * `find()` branch this file measures. With `findOne` present the envelope is
 * never consulted at all, and every case below would pass vacuously.
 */
function dsWithoutFindOne(objectName: string, answer: unknown) {
  return {
    find: vi.fn(async () => answer),
    getObjectSchema: vi.fn(async (object: string) =>
      object === objectName ? { nameField: 'name' } : null,
    ),
  } as any;
}

/** Distinct object name + id per case: the module-level name cache is keyed
 *  `${referenceTo}:${id}:${displayField}` and outlives a single test. */
async function renderChip(objectName: string, id: string, answer: unknown) {
  const ds = dsWithoutFindOne(objectName, answer);
  render(
    <SchemaRendererProvider dataSource={ds}>
      <LookupCellRenderer
        value={id}
        field={{ type: 'lookup', reference: objectName } as any}
      />
    </SchemaRendererProvider>,
  );
  return ds;
}

describe('LookupCellRenderer find() envelope — objectui#6917 arm A', () => {
  it('does NOT let `value` OUTRANK `data` — the precedence inversion itself', async () => {
    // The sharp end, and the ONLY input that separates the two orders: both
    // members present and DISAGREEING. `data` is the contract's, so
    // "From data" is the only correct answer; the pre-fix order answered
    // "From value".
    await renderChip('env_both_6917', 'id_both', {
      value: [{ id: 'id_both', name: 'From value' }],
      data: [{ id: 'id_both', name: 'From data' }],
    });
    await waitFor(() => {
      expect(screen.getByText('From data')).toBeInTheDocument();
    });
    expect(screen.queryByText('From value')).not.toBeInTheDocument();
  });

  it("still reads the contract's `data` member on its own", async () => {
    await renderChip('env_data_6917', 'id_data', {
      data: [{ id: 'id_data', name: 'Only data' }],
    });
    await waitFor(() => {
      expect(screen.getByText('Only data')).toBeInTheDocument();
    });
  });

  it('still reads `value` on its own — the arm is LIVE at this seam, 8 producers', async () => {
    // The non-regression axis. The plausible WRONG fix deletes this arm
    // outright; three plugin-kanban, three plugin-calendar and two plugin-grid
    // `find()` doubles emit `{ value: [...] }` today, so a result carrying only
    // `value` must still resolve.
    await renderChip('env_value_6917', 'id_value', {
      value: [{ id: 'id_value', name: 'Only value' }],
    });
    await waitFor(() => {
      expect(screen.getByText('Only value')).toBeInTheDocument();
    });
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    await renderChip('env_bare_6917', 'id_bare', [{ id: 'id_bare', name: 'Bare array' }]);
    await waitFor(() => {
      expect(screen.getByText('Bare array')).toBeInTheDocument();
    });
  });

  it('does NOT read `records` — folded into `data` below the adapter', async () => {
    // `records` is the below-the-adapter spelling; both adapters'
    // `normalizeQueryResult` return `data` before an answer reaches here. The
    // chip falls back to the raw id rather than legitimising a second
    // de-facto contract. This is also the caricature guard: an extractor that
    // returned a constant, or always returned the first row of whatever it was
    // handed, would answer "Should not resolve" here.
    await renderChip('env_records_6917', 'id_records', {
      records: [{ id: 'id_records', name: 'Should not resolve' }],
    });
    await waitFor(() => {
      expect(screen.getByText('id_records')).toBeInTheDocument();
    });
    expect(screen.queryByText('Should not resolve')).not.toBeInTheDocument();
  });
});
