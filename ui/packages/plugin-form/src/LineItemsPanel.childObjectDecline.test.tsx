/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:line_items` must DECLINE TO TOUCH THE DATA LAYER AT ALL for a panel
 * whose child object it never resolved — not call `getObjectSchema(undefined)`
 * (objectui#6188), not `find(undefined, …)` (objectui#6194), and not write rows
 * into it either.
 *
 * The component read `schema.childObject` at TWO sites and objectui#6188 guarded
 * only the first; the row load was pinned here as a KNOWN HOLE until
 * objectui#6194 closed it. Both are guarded now, so the call list below is
 * empty — see the flipped expectation and the render tests at the foot of this
 * file, which pin the thing that made closing the second site safe.
 *
 * Same defect, same key name and same package as objectui#5940, which fixed the
 * sibling site in `MasterDetailForm`. `childObject` is typed `string` on
 * `LineItemsPanelSchema`, but the spec row and the registry entry for
 * `record:line_items` (`index.tsx`) both leave it optional, because the node's
 * `dataSource` binding can supply it (objectui#11569). So a node with neither
 * reaches this renderer with the key `undefined`, and the effect asked the data
 * layer for it anyway. That node is this file's answer: the page compile does
 * not refuse it, and the configuration hint pinned below is what tells its
 * author.
 *
 * ## Why the assertions read a CALL LIST
 *
 * The symptom here is quieter than #5940's: the effect's `.catch` turns
 * whatever a real backend returns for an object literally named `undefined`
 * into a NULL child schema, and a null child schema is exactly what the panel
 * holds before any fetch resolves. So "it did not crash" and "the schema is
 * null" were both TRUE while the defect was live — no assertion on resulting
 * state could have caught it. Only the calls themselves distinguish the two
 * worlds.
 *
 * ## Why the second test is not redundant
 *
 * A "fix" that declined to fetch EVERYTHING would also make the bad call
 * disappear and would pass an absence-only assertion. Both directions are
 * therefore pinned: the unresolved panel does NOT fetch its child schema, and a
 * well-formed one still DOES.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `record:line_items`.
import './index';

const COLUMNS = [{ name: 'qty', label: 'Qty', type: 'number' as const }];

/**
 * The recording data source, the same shape objectui#5940's test used: a Proxy,
 * so ANY method the block reaches for is recorded rather than crashing it.
 *
 * Each call is recorded as `method(firstArgument)` — the OBJECT NAME argument,
 * which is the whole subject here, and `undefined` is spelled out rather than
 * collapsing to an empty argument. Deliberately NOT the full argument list: the
 * child fetch also carries `$filter` / `$top`, and pinning those would make this
 * file fail for changes that have nothing to do with the object name.
 */
function recordingDataSource(calls: string[], writes: string[] = []) {
  const record =
    (key: string) =>
    (...args: unknown[]) => {
      calls.push(`${key}(${args.length === 0 ? '' : (JSON.stringify(args[0]) ?? 'undefined')})`);
      // The WRITE side, recorded separately and spelled by OBJECT NAME
      // (objectui#6194). It needs its own channel because the save arrives as
      // ONE `batchTransaction(ops)` call whose object names live inside the
      // array — and because `JSON.stringify` DROPS an undefined value, so the
      // op for an unresolvable panel would read as a create carrying no object
      // key at all rather than one naming `undefined`. `String(op.object)` says
      // it out loud.
      if (key === 'batchTransaction') {
        for (const op of ((args[0] as any[]) ?? [])) {
          writes.push(`${op?.action}(${String(op?.object)})`);
        }
      } else if (key === 'create' || key === 'update' || key === 'delete') {
        writes.push(`${key}(${String(args[0])})`);
      }
      return /^on[A-Z]/.test(key) || key === 'subscribe' ? () => {} : Promise.resolve({ data: [] });
    };
  const seeded: Record<string, unknown> = {};
  for (const m of [
    'find',
    'findOne',
    'create',
    'update',
    'delete',
    'aggregate',
    'getObjectSchema',
    'batchTransaction',
  ]) {
    seeded[m] = record(m);
  }
  return new Proxy(seeded, {
    get: (t, k: string) => (k in t ? (t as any)[k] : record(k)),
  }) as any;
}

function panelSchema(schemaExtra: Record<string, unknown>): any {
  return {
    type: 'record:line_items',
    relationshipField: 'invoice',
    // Authored directly, as `LineItemsPanel.elementDataSource.test.tsx` does:
    // this panel is bound to an EXISTING parent record, so a fixture without one
    // would settle the question for a panel no author ships.
    parentId: 'inv-1',
    columns: COLUMNS,
    ...schemaExtra,
  };
}

/**
 * Settle: both reads run in effects, and the row load runs a second pass once
 * the first response lands.
 */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
}

async function callsFor(schemaExtra: Record<string, unknown>): Promise<string[]> {
  const calls: string[] = [];
  const view = render(
    <SchemaRendererProvider dataSource={recordingDataSource(calls)}>
      <SchemaRenderer schema={panelSchema(schemaExtra)} />
    </SchemaRendererProvider>,
  );
  await settle();
  try {
    view.unmount();
  } catch {
    /* teardown is not the subject */
  }
  return calls;
}

describe('record:line_items — a panel with no childObject (objectui#6188)', () => {
  it('declines to fetch the child schema instead of calling getObjectSchema(undefined)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = await callsFor({});

    // The FULL LIST, not `.not.toContain(...)`: an absence-only assertion would
    // also pass for a panel that stopped fetching altogether, and the list is
    // what makes any remaining entry visible instead of implied.
    //
    // EMPTY as of objectui#6194, which closed the second site. This assertion
    // read `['find(undefined)']` while that hole was open — the row fetch
    // queried an object literally named `undefined` because `load()` guarded
    // `dataSource` and `parentId` but not `schema.childObject`. Keep it an
    // exact-list assertion: it is the only shape that catches a THIRD read of
    // this key being added unguarded, which is how the second one arrived.
    expect(calls).toEqual([]);

    // Stated separately so a failure names which half broke.
    expect(calls).not.toContain('getObjectSchema(undefined)');

    // Declining silently would leave an author with a grid that is quietly
    // unsanitized and no reason why; `RelatedList` warns for the same class of
    // missing key ("has no referenceField/parentId — refusing to fetch all
    // rows"), and the warning names the key and what to set it to rather than
    // reporting that something was undefined.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('childObject'));

    // BOTH declines say so, and each names what IT refused rather than leaving
    // the author to guess which read stopped (objectui#6194).
    const warned = warn.mock.calls.map((c) => String(c[0]));
    expect(warned.some((m) => m.includes('refusing to fetch its child schema'))).toBe(true);
    expect(warned.some((m) => m.includes('refusing to fetch its rows'))).toBe(true);
    warn.mockRestore();
  });

  it('still fetches the child schema of a panel that names its child object', async () => {
    // ⭐ The other direction. Without this, a panel that declined to fetch
    // EVERYTHING would pass the test above.
    const calls = await callsFor({ childObject: 'invoice_line' });

    expect(calls).toEqual(['getObjectSchema("invoice_line")', 'find("invoice_line")']);
    expect(calls).not.toContain('getObjectSchema(undefined)');
  });
});

/**
 * ⭐ WHY THIS SECOND SECTION EXISTS — the decline above is not safe on its own.
 *
 * `load` owns `loading`, and the panel used to branch
 * `loading ? "Loading…" : !parentId ? "Save the record first…" : <grid>`. So the
 * moment the row fetch declines, an unresolvable panel with a `parentId` bound
 * lands on the THIRD branch: an empty EDITABLE grid with an Add button, over an
 * object that does not exist. That is a worse outcome than the unguarded fetch
 * objectui#6194 removed, and it is reachable *because* of the fix — which is why
 * the card treated the render branch as its real question rather than a polish
 * item, and why it is pinned here next to the decline that creates it.
 *
 * It is also what makes the SAVE path unreachable. Measured on the component as
 * it stood before this fix, with the fixture below and `childObject` unset:
 *
 *   grid rendered        = true
 *   Add button           = true
 *   Save disabled at t0  = true
 *   after ONE keystroke in the always-present ghost row:
 *   Save disabled        = false
 *   reached the adapter  = batchTransaction([
 *                            { object: undefined, action: 'create',
 *                              data: { qty: 3, invoice: 'inv-1' } } ])
 *
 * So the write was reachable, in one keystroke, through the very affordance the
 * empty grid advertises ("No items yet — click Add to begin"). Removing the grid
 * removes the only producer of `dirty`, which is the only thing that enables
 * Save. The guard in `save` itself covers the case this render branch cannot —
 * a schema edited to drop `childObject` while rows are already dirty — and the
 * last test here is the only thing that exercises it.
 */
describe('record:line_items — an unresolvable panel offers no editable grid (objectui#6194)', () => {
  function saveButton(container: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find((b) =>
      /^Sav(e|ing)/.test((b.textContent || '').trim()),
    ) as HTMLButtonElement | undefined;
  }

  it('shows a config hint instead of an empty editable grid, and writes nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: string[] = [];
    const writes: string[] = [];
    const view = render(
      <SchemaRendererProvider dataSource={recordingDataSource(calls, writes)}>
        <SchemaRenderer schema={panelSchema({})} />
      </SchemaRendererProvider>,
    );
    await settle();

    // The hint, and it NAMES the key — an author who cannot see the console is
    // the one who has to act on this.
    const hint = view.container.querySelector('[data-testid="line-items-no-child-object"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('childObject');

    // ⭐ The half that matters: NOT the grid. Each of these is a separate
    // assertion so a failure names which affordance came back.
    expect(view.container.querySelector('[data-testid="line-items"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="line-items-add"]')).toBeNull();
    // No cell to type in — the ghost row is what made the save path reachable in
    // ONE keystroke, without the Add button being touched at all.
    expect(view.container.querySelector('input[aria-label="Qty"]')).toBeNull();

    // ⛔ And NOT a spinner that never ends: hiding a permanent authoring error
    // behind `loading` would satisfy every assertion above and is the one
    // alternative this card ruled out by name.
    expect(view.container.textContent).not.toContain('Loading…');

    // With no producer of `dirty`, Save cannot leave its disabled state.
    expect(saveButton(view.container)?.disabled).toBe(true);
    expect(writes).toEqual([]);
    warn.mockRestore();
  });

  it('still renders the editable grid for a panel that names its child object', async () => {
    // ⭐ The other direction, the same discipline as the schema tests above: a
    // "fix" that showed the config hint unconditionally would pass every
    // assertion in the test before this one.
    const calls: string[] = [];
    const view = render(
      <SchemaRendererProvider dataSource={recordingDataSource(calls)}>
        <SchemaRenderer schema={panelSchema({ childObject: 'invoice_line' })} />
      </SchemaRendererProvider>,
    );
    await settle();

    expect(view.container.querySelector('[data-testid="line-items-no-child-object"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="line-items"]')).not.toBeNull();
    expect(view.container.querySelector('input[aria-label="Qty"]')).not.toBeNull();
  });

  it('refuses to save when the child object is dropped from a panel with dirty rows', async () => {
    // The one route the render branch cannot close, and the reason `save` takes
    // the guard too: the grid was offered legitimately, the user dirtied it, and
    // only THEN did the schema lose `childObject` — a live edit in the designer.
    // `dirty` survives that re-render, so Save is enabled over a panel whose
    // object no longer resolves.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: string[] = [];
    const writes: string[] = [];
    const view = render(
      <SchemaRendererProvider dataSource={recordingDataSource(calls, writes)}>
        <SchemaRenderer schema={panelSchema({ childObject: 'invoice_line' })} />
      </SchemaRendererProvider>,
    );
    await settle();

    const cell = view.container.querySelector('input[aria-label="Qty"]') as HTMLInputElement;
    expect(cell).not.toBeNull();
    await act(async () => {
      fireEvent.change(cell, { target: { value: '3' } });
    });

    // Precondition, asserted rather than assumed: without it the test would pass
    // for a Save that was disabled the whole time and prove nothing.
    expect(saveButton(view.container)?.disabled).toBe(false);

    view.rerender(
      <SchemaRendererProvider dataSource={recordingDataSource(calls, writes)}>
        <SchemaRenderer schema={panelSchema({})} />
      </SchemaRendererProvider>,
    );
    await settle();

    const save = saveButton(view.container);
    expect(save?.disabled).toBe(false); // still dirty — the guard is what stops it
    await act(async () => {
      fireEvent.click(save as HTMLButtonElement);
    });
    await settle();

    // Nothing named `undefined` reached the adapter.
    expect(writes).toEqual([]);
    warn.mockRestore();
  });
});
