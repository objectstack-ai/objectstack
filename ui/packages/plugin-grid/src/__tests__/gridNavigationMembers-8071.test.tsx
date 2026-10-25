/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The MEMBERS of `object-grid.navigation`, pinned at what the RENDERER reads
 * (objectui#8071 slice 14).
 *
 * The registration declares an `object` arm and names ONE member in prose —
 * `{ mode: "page" | "drawer" | "modal" | "split" | "none", … }` — while the
 * spec's `NavigationConfigSchema` is `strict` over SIX: `mode`, `view`,
 * `preventNavigation`, `openNewTab`, `size`, `width`. All six are read, and the
 * five the description elides are the ones that decide what a row click does.
 *
 * PRIOR ART, stated rather than credited: `ObjectGrid.overlayShellModes-9299`
 * pins the four OVERLAY values of `mode` across the shell boundary, and
 * `useNavigationOverlay.modeDefault` pins the hook's own default. Neither names
 * another member, and neither is a claim about this BLOCK's key: what follows
 * is the members, through the real grid, with the precedence between them.
 *
 * ⛔ What a declaration can never publish:
 *
 *   - **`view` was not a route — it landed in the second ARGUMENT `onNavigate`
 *     receives**, which carries the navigation MODE token, and the literal
 *     `'view'` is what stands there. The two are one character apart in the
 *     source and mean entirely different things. ⭐ **objectui#9874 REVERSED
 *     the row that pinned this**: `@objectstack/spec` 17.5.0 retired
 *     `view.list.navigation.view` under ADR-0049 precisely because an authored
 *     name SUBSTITUTED for the mode and matched no branch, so the member no
 *     longer reaches `onNavigate` at all and every config dispatches `'view'`.
 *     The row below is kept, inverted, rather than deleted: the authored member
 *     is the input the two implementations disagree about, so it is the only
 *     input that can witness the change.
 *   - **`openNewTab` OUTRANKS `mode`.** An authored
 *     `{ mode: 'page', openNewTab: true }` dispatches `'new_window'`. Before
 *     objectui#9874 this row also read as "and DISCARDS `view` while doing it",
 *     because a sibling `view: 'summary'` was dropped here while riding through
 *     the `page` branch; now nothing rides through either branch and the
 *     precedence is the whole of what this row pins.
 *   - **`preventNavigation` OUTRANKS every mode, including the overlay ones.**
 *     `{ mode: 'drawer', preventNavigation: true }` draws no drawer and throws
 *     nothing — a grid that looks clickable and is not.
 *   - **`size` and `width` are ONE decision with a fixed winner.** `width` is
 *     deprecated and still wins; `size` maps through a bucket table; `'auto'`
 *     resolves to neither and lands on the block's own default width. Three
 *     outcomes from two members, none of them stated anywhere an author reads.
 *   - **A grid with NO `navigation` key still navigates.** The absent key is
 *     page navigation, not inert — so "does this key do anything" cannot be
 *     answered by deleting it.
 *
 * DIRECTION, predicted before running: every row is RED against the plausible
 * "improvement" of the read site it covers, and green as written. The ablation
 * is recorded in the PR body.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { RECORD_OVERLAY_DEFAULT_WIDTH } from '@object-ui/plugin-detail';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const ROWS = [{ id: '7', name: 'Row 7', status: 'open' }];

/**
 * Render the grid and click its one row, returning the `onNavigate` spy.
 *
 * `onNavigate` is the observable end of the non-overlay modes and is read off
 * the schema by deliberate exemption (`gridNonAuthorKeys` pins that exemption);
 * it is the channel, not the thing under test.
 */
async function clickRow(navigation: Record<string, unknown> | undefined, opts: {
  onNavigate?: boolean;
} = {}) {
  const onNavigate = vi.fn();
  const schema: any = {
    type: 'object-grid',
    objectName: 'task',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: ROWS },
    ...(navigation ? { navigation } : {}),
    ...(opts.onNavigate === false ? {} : { onNavigate }),
  };
  const view = render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>,
  );
  const cell = await screen.findByText('Row 7');
  fireEvent.click(cell);
  return { onNavigate, ...view };
}

/**
 * The resolved width of an open drawer, read off the DOM.
 *
 * The shared shell publishes the width it was handed as the `--ov-w` custom
 * property and caps the panel with `sm:max-w-[var(--ov-w,42rem)]`, so the custom
 * property IS the resolved value — `style.maxWidth` is empty in every world and
 * would pin nothing. A drag-resized width persisted in `localStorage` would
 * mask all of it, which is why the store is cleared before each case.
 */
function panelWidth(): string {
  const panel = document.querySelector('[role="dialog"]') as HTMLElement | null;
  expect(panel, 'overlay panel').not.toBeNull();
  return panel!.style.getPropertyValue('--ov-w').trim();
}

/** What the shell makes of an authored width: the authored value as a FLOOR. */
const withFloor = (css: string) => `max(${css}, min(60vw, 880px))`;

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* private mode */ }
  // The shared record payload asks `POST /api/v1/security/explain` whether the
  // record may be edited; with no host `apiFetch` that degrades to the global
  // `fetch`, which happy-dom serves over real TCP. Nothing here reads the
  // verdict — `useRecordEditable` fails open — but the request must not leave.
  installRecordSecurityExplainDouble(vi);
});

afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
});

describe('object-grid `navigation` members decide the row click (objectui#8071)', () => {
  it('LIT CONTROL: a row click reaches `onNavigate` with no `navigation` at all', async () => {
    // First, because every "nothing happened" below would be vacuous against a
    // grid whose rows are not clickable in this harness.
    const { onNavigate } = await clickRow(undefined);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    // The absent key is PAGE navigation carrying the fallback action.
    expect(onNavigate).toHaveBeenCalledWith('7', 'view');
  });

  it('`mode` defaults to `page`, and a RETIRED `view` member does not become the action (objectui#9874)', async () => {
    // No `mode` member at all — legal authored metadata, because the spec
    // defaults it. This row used to assert `('7', 'summary_view')` under the
    // comment "`view` rides through as the second argument"; it did, into the
    // slot that carries the navigation MODE token, where a host reading it
    // against `edit`/`view` matched no branch and the row click went quiet.
    // `@objectstack/spec` 17.5.0 retired the key for that (ADR-0049), so the
    // authored name is now inert here and the dispatched action is the literal.
    const { onNavigate } = await clickRow({ view: 'summary_view' });
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    expect(onNavigate).toHaveBeenCalledWith('7', 'view');
    expect(onNavigate).not.toHaveBeenCalledWith('7', 'summary_view');
  });

  it('an omitted `view` dispatches the literal `view`, not undefined', async () => {
    // The pair for the row above: same mode, member removed. Since objectui#9874
    // the two rows agree by construction — which is the POINT of the retirement
    // and not a reason to drop either. ⛔ Keeping both is what makes "the member
    // is inert" a measurement rather than an assertion about one input: a
    // renderer that resumed forwarding the member would turn the row above red
    // and leave this one green.
    const { onNavigate } = await clickRow({ mode: 'page' });
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    expect(onNavigate).toHaveBeenCalledWith('7', 'view');
  });

  it('`mode: "none"` dispatches nothing and opens nothing', async () => {
    const { onNavigate, container } = await clickRow({ mode: 'none', view: 'summary_view' });
    // Give the click every chance to have done something before asserting it
    // did not: the row above reaches the spy within one microtask.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(container.ownerDocument.querySelector('[role="dialog"]')).toBeNull();
  });

  it('`preventNavigation: true` OUTRANKS an overlay mode', async () => {
    // `drawer` with the flag set draws no drawer. Nothing is thrown, nothing is
    // logged; the grid simply stops being clickable.
    const { container } = await clickRow({ mode: 'drawer', preventNavigation: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.ownerDocument.querySelector('[role="dialog"]')).toBeNull();
  });

  it('…and the SAME config without the flag opens the drawer', async () => {
    // The control that keeps the absence above from reading as a dead harness.
    await clickRow({ mode: 'drawer' });
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  });

  it('`openNewTab` OUTRANKS `mode: "page"`, with a retired `view` still inert', async () => {
    // The window preference decides: the dispatched action is `new_window`, and
    // `summary_view` is nowhere in the call. Before objectui#9874 this row was
    // the ONLY place the authored member was dropped; it is now dropped on
    // every path, and the row survives as the precedence pin it also always was.
    const { onNavigate } = await clickRow({
      mode: 'page',
      view: 'summary_view',
      openNewTab: true,
    });
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    expect(onNavigate).toHaveBeenCalledWith('7', 'new_window');
  });

  it('`openNewTab` with no `onNavigate` host opens the record URL directly', async () => {
    // The other half of that member: it is not merely a flag handed to a host.
    // With nobody to delegate to, the grid opens the record page itself, built
    // from the block's own object name.
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await clickRow({ mode: 'page', openNewTab: true }, { onNavigate: false });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith('/task/record/7', '_blank');
  });

  it('`size` reaches the overlay through the bucket table', async () => {
    // `lg` is a NAME on the authoring side and a CSS length by the time it
    // reaches the shell, which then treats it as a floor.
    await clickRow({ mode: 'drawer', size: 'lg' });
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(panelWidth()).toBe(withFloor('min(92vw, 960px)'));
  });

  it('a deprecated `width` WINS over `size` authored beside it', async () => {
    // Both members present and disagreeing — the smallest bucket against an
    // explicit 720px. The deprecated spelling is the one that lands.
    await clickRow({ mode: 'drawer', size: 'sm', width: '720px' });
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(panelWidth()).toBe(withFloor('720px'));
  });

  it('`size: "auto"` resolves to NEITHER member and lands on the block default', async () => {
    // `auto` needs the object's field count, which this layer does not have, so
    // it resolves to nothing and the grid's own default width applies — the
    // same width an unauthored overlay gets, which is the point.
    await clickRow({ mode: 'drawer', size: 'auto' });
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(panelWidth()).toBe(withFloor(RECORD_OVERLAY_DEFAULT_WIDTH));

    cleanup();
    try { window.localStorage.clear(); } catch { /* private mode */ }
    await clickRow({ mode: 'drawer' });
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(panelWidth()).toBe(withFloor(RECORD_OVERLAY_DEFAULT_WIDTH));
  });
});
