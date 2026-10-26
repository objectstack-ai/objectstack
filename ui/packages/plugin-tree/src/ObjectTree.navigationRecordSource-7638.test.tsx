/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7638 — `ObjectTree`'s record-page URL follows the RECORD SOURCE.
 *
 * ## The divergence this closes
 *
 * `useNavigationOverlay` builds `/{objectName}/record/{id}` out of whatever it
 * is handed. This component used to hand it the bare top-level
 * `schema.objectName` while resolving its own rows — and its column labels
 * (`headerObjectName`) — through the objectui#6939 record-source ladder
 * (`data`, then `staticData`, then `objectName`). objectui#6939 published
 * `objectName` as that ladder's THIRD RUNG and not as a parallel "page object"
 * concept, so a block has exactly ONE record source: a row fetched through
 * `data.object` whose click built `/{schema.objectName}/record/{id}` named a
 * record that the URL's own object does not contain.
 *
 * ## Why these assertions and not a spy on the resolver
 *
 * The observable under test is the URL a user's click actually navigates to, so
 * every case here drives a real click through the real `new_window` branch and
 * reads `window.open`'s first argument. Asserting that
 * `resolveRecordSourceObjectName` was CALLED would pass just as well with its
 * result thrown away.
 *
 * `new_window` is the mode chosen because it is the branch that builds the URL
 * in-process; the `page` branch delegates to an `onNavigate` this component
 * never passes, and the overlay modes never build a URL at all.
 *
 * ## The lit control
 *
 * The first case carries NO `data` block, so rung three is the record source
 * and `/business_unit/record/1` is both the old and the new answer. It is here
 * as the instrument check: it is the case that must read NON-ZERO — a
 * `window.open` that is never called at all would make every "did not navigate
 * to the decoy" assertion below vacuously true. If that case ever goes silent,
 * the rest of this file is a dark instrument and its greens mean nothing.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ObjectTree } from './ObjectTree';

/**
 * Rows reach the component through the `data` PROP, so no `dataSource` is
 * needed and the fetch effect falls through to them for every schema shape
 * below. That keeps the only variable across these cases the thing under test:
 * which object the schema NAMES.
 */
const ROWS = [
  { id: '1', name: 'Acme', parent_id: null },
  { id: '2', name: 'Engineering', parent_id: '1' },
];

/** The object the rows really came from — what the URL must name. */
const RECORD_SOURCE = 'org_chart_node';
/** The top-level key, rung three — the decoy the URL must stop naming. */
const DECOY = 'business_unit';

function renderTree(schema: Record<string, unknown>) {
  return render(
    <ObjectTree
      schema={
        {
          type: 'object-tree',
          parentField: 'parent_id',
          labelField: 'name',
          fields: ['name'],
          navigation: { mode: 'new_window' },
          ...schema,
        } as never
      }
      data={ROWS}
    />,
  );
}

/** Click the first row and hand back the URL `window.open` was given. */
async function clickRowAndReadUrl(open: ReturnType<typeof vi.spyOn>): Promise<string | undefined> {
  const cell = await screen.findByText('Acme');
  fireEvent.click(cell);
  await waitFor(() => expect(open).toHaveBeenCalled());
  return open.mock.calls[0]?.[0] as string | undefined;
}

let open: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  open = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectTree navigation URL follows the record source (objectui#7638)', () => {
  it('LIT CONTROL: with no `data` block, rung three IS the record source and still builds the URL', async () => {
    renderTree({ objectName: DECOY });

    // Reads non-zero, or every assertion below is vacuous.
    expect(await clickRowAndReadUrl(open)).toBe(`/${DECOY}/record/1`);
    expect(open).toHaveBeenCalledWith(`/${DECOY}/record/1`, '_blank');
  });

  it('navigates to the object the ROWS came from, not the top-level key', async () => {
    renderTree({
      objectName: DECOY,
      data: { provider: 'object', object: RECORD_SOURCE },
    });

    const url = await clickRowAndReadUrl(open);
    expect(url).toBe(`/${RECORD_SOURCE}/record/1`);
    // The whole finding in one line: before objectui#7638 this was the answer.
    expect(url).not.toBe(`/${DECOY}/record/1`);
  });

  it('builds a routed URL for a data-only block, which previously had no name to use', async () => {
    // No top-level `objectName` at all. `schema.objectName` was `undefined`
    // here, so the hook took its `: `/${encodedId}`` leg and produced `/1` — an
    // unrouted path that paints a blank page.
    renderTree({ data: { provider: 'object', object: RECORD_SOURCE } });

    const url = await clickRowAndReadUrl(open);
    expect(url).toBe(`/${RECORD_SOURCE}/record/1`);
    expect(url).not.toBe('/1');
  });

  it('keeps the `?? schema.objectName` tail for the OFF-CONTRACT `{ provider: "object" }`', async () => {
    // `ViewDataSchema` declares `object` REQUIRED on the `object` provider, so
    // this shape is off-contract and the shared reader deliberately returns
    // `undefined` for it rather than coercing. This site keeps its own tail —
    // exactly as `headerObjectName` above it does — so the conversion changes
    // nothing this component resolves today except the divergence it closes.
    renderTree({ objectName: DECOY, data: { provider: 'object' } });

    expect(await clickRowAndReadUrl(open)).toBe(`/${DECOY}/record/1`);
  });

  it('falls back to rung three for a `value`-provider block, which names no object', async () => {
    renderTree({ objectName: DECOY, data: { provider: 'value', items: ROWS } });

    expect(await clickRowAndReadUrl(open)).toBe(`/${DECOY}/record/1`);
  });
});
