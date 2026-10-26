/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The MEMBERS of `object-timeline.navigation`, pinned at what the TIMELINE
 * reads (objectui#8654).
 *
 * objectui#8654 declares `navigation` on this block — on the schema
 * `ObjectTimelineProps` reads and in the registration `inputs` of both tags
 * (`object-timeline` and `view:timeline`) — as the timeline arm of the
 * maintainer's objectui#8652 ruling 「B」, whose platform half is
 * `@objectstack/spec` 17.5.0 declaring the key on this element. An
 * `object`-armed input owes a member pin (objectui#8212), and this file is it:
 * every member is driven through a real entry click on the real
 * `ObjectTimeline`, with the real `useNavigationOverlay` and the real overlay
 * shell, and each row asserts what the click DID. Modelled on the board's
 * `kanbanNavigationMembers-8652`.
 *
 * The gate that reads this file is `registry-inputs-spec-parity.test.ts`: its
 * `MEMBER_PINS` line for `object-timeline.navigation` points here. It was added
 * by objectui#11168 slice 5, which loads the lazily registered block, because
 * the gate refuses a pin for a block it does not judge.
 *
 * What the rows establish:
 *
 *   - **`drawer`, `modal` and `popover` open the entry's record** in that
 *     overlay. `drawer` is the LIT CONTROL every "nothing happened" row below
 *     leans on.
 *   - **`none` and `preventNavigation` open nothing**, and the flag outranks an
 *     overlay mode.
 *   - **`new_window` and `openNewTab` open the record page in a new tab**,
 *     built from the block's own object name; `openNewTab` outranks `page`
 *     and every overlay mode, but not `none`, which opens nothing beside it.
 *   - **`size` and `width` are ONE decision**: `width` (deprecated) wins over a
 *     `size` beside it, a bucket name resolves through the size table, and
 *     `auto` lands where a drawer with no size does.
 *   - **A parent view's click handler outranks the whole key.**
 *
 * ⚠️ And the values the timeline does NOT honour on its own, pinned because
 * the registration's description states them and a description is a claim
 * about this renderer. Unlike the board and the calendar, this renderer
 * supplies no drawer default, so an ABSENT key opens nothing, with a host
 * record navigator mounted or not; and `split` opens nothing, because the
 * timeline hands the split shell no main panel. A timeline that learns any of
 * these reddens its row, and the fix is to rewrite that description with it,
 * ⛔ not to relax the row.
 *
 * And `page`, pinned both ways. Since objectui#11293 `useNavigationOverlay`
 * hands a `page` click it has no `onNavigate` for to the record navigator the
 * HOST publishes (`RelatedRecordActionsContext.openRecord`), which the console
 * mounts on its custom pages, record pages and list views. So under such a
 * host `page`, and a block written without `mode` (the spec's `page` default),
 * open the record page; with no host navigator there is no record page to
 * open, and the click opens nothing (objectui#11168 slice 3 round 4, the
 * board's `kanbanNavigationMembers-8652` host).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { RelatedRecordActionsProvider, type RelatedRecordActionsValue } from '@object-ui/react';

import { ObjectTimeline, type ObjectTimelineProps } from '../ObjectTimeline';

/** The block's own object name, which the new-tab URL is built from. */
const OBJECT = 'duly_event';

/**
 * One record. `owner` is drawn by no part of the rail (which shows the title
 * and the date), only by the overlay that lists the clicked record's fields —
 * so its text on screen means "the entry's record opened".
 */
const RECORDS = [{ id: '1', name: 'Kickoff', start_date: '2024-01-05', owner: 'Ada Lovelace' }];
const OPENED_RECORD_TEXT = 'Ada Lovelace';

type Navigation = ObjectTimelineProps['schema']['navigation'];

/**
 * Mount one timeline with an authored `navigation` (or none), click its one
 * entry, and hand back the `window.open` spy. The schema is typed at the
 * published props: `navigation` is a declared member now, so no cast is needed.
 */
async function clickEntry(
  navigation: Navigation,
  props: Pick<ObjectTimelineProps, 'onRowClick'> = {},
  host?: RelatedRecordActionsValue,
) {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  const schema = {
    type: 'timeline',
    objectName: OBJECT,
    timeline: { startDateField: 'start_date', titleField: 'name' },
    ...(navigation ? { navigation } : {}),
  } satisfies ObjectTimelineProps['schema'];
  // `data` is read off the PROPS (pre-fetched records), so the timeline issues
  // no query and the click is the only thing under test.
  const extra = { data: RECORDS } as Record<string, unknown>;
  const timeline = <ObjectTimeline schema={schema} {...extra} {...props} />;
  render(host ? <RelatedRecordActionsProvider value={host}>{timeline}</RelatedRecordActionsProvider> : timeline);
  fireEvent.click(await screen.findByText('Kickoff'));
  return { open };
}

/** Give a click every chance to have done something before asserting it did not. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const openedRecord = () => screen.queryByText(OPENED_RECORD_TEXT);

/** Nothing opened: no overlay, no record, no tab. */
async function expectNothingOpened(open: ReturnType<typeof vi.fn>, why: string) {
  await settle();
  expect(dialog(), `${why}: an overlay opened`).toBeNull();
  expect(openedRecord(), `${why}: the record was drawn`).toBeNull();
  expect(open, `${why}: a tab was opened`).not.toHaveBeenCalled();
}

/**
 * The resolved overlay width, read off the `--ov-w` custom property the shared
 * shell publishes (it caps the panel with `sm:max-w-[var(--ov-w,42rem)]`), so
 * the custom property IS the resolved value.
 */
function panelWidth(): string {
  const panel = dialog();
  expect(panel, 'overlay panel').not.toBeNull();
  return panel!.style.getPropertyValue('--ov-w').trim();
}

/** What the shell makes of an authored width: the authored value as a FLOOR. */
const withFloor = (css: string) => `max(${css}, min(60vw, 880px))`;

beforeEach(() => {
  // A drag-resized width persisted in localStorage would mask every width row.
  try { window.localStorage.clear(); } catch { /* private mode */ }
  installRecordSecurityExplainDouble(vi);
});

afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  // Unmount BEFORE restoring the real globals (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

describe('object-timeline `navigation` members decide the entry click (objectui#8654)', () => {
  it('LIT CONTROL: `mode: "drawer"` opens the entry\'s record in a drawer', async () => {
    // First, because every "nothing happened" row below would be vacuous
    // against a timeline whose entries are not clickable in this harness.
    const { open } = await clickEntry({ mode: 'drawer' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openedRecord()).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['modal', 'popover'] as const)('`mode: "%s"` opens the entry\'s record in that overlay', async (mode) => {
    const { open } = await clickEntry({ mode });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openedRecord()).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('`mode: "none"` opens nothing', async () => {
    const { open } = await clickEntry({ mode: 'none' });
    await expectNothingOpened(open, 'none');
  });

  it('`preventNavigation: true` OUTRANKS an overlay mode', async () => {
    // The same block without the flag is the LIT CONTROL above.
    const { open } = await clickEntry({ mode: 'drawer', preventNavigation: true });
    await expectNothingOpened(open, 'preventNavigation');
  });

  it('`mode: "new_window"` opens the record page in a new tab, and no overlay', async () => {
    const { open } = await clickEntry({ mode: 'new_window' });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith(`/${OBJECT}/record/1`, '_blank');
    expect(dialog()).toBeNull();
  });

  it('`openNewTab: true` OUTRANKS `mode: "page"`', async () => {
    const { open } = await clickEntry({ mode: 'page', openNewTab: true });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith(`/${OBJECT}/record/1`, '_blank');
  });

  it.each(['drawer', 'modal', 'split', 'popover'] as const)(
    '…and an overlay mode too: `openNewTab: true` beside `%s` opens a tab and no overlay',
    async (mode) => {
      const { open } = await clickEntry({ mode, openNewTab: true });
      await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
      expect(open).toHaveBeenCalledWith(`/${OBJECT}/record/1`, '_blank');
      expect(dialog()).toBeNull();
    },
  );

  it('…but NOT `mode: "none"`: `none` beside `openNewTab: true` opens nothing', async () => {
    // objectui#11168 slice 5: the description says `openNewTab` outranks every
    // mode except `none`, which is checked first, as `preventNavigation` is.
    // The overlay rows just above are this row's control.
    const { open } = await clickEntry({ mode: 'none', openNewTab: true });
    await expectNothingOpened(open, 'none + openNewTab');
  });

  it('`size` reaches the overlay through the bucket table', async () => {
    await clickEntry({ mode: 'drawer', size: 'lg' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).toBe(withFloor('min(92vw, 960px)'));
  });

  it('a deprecated `width` WINS over `size` authored beside it', async () => {
    await clickEntry({ mode: 'drawer', size: 'sm', width: '720px' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).toBe(withFloor('720px'));
  });

  it('`size: "auto"` resolves to NEITHER member and lands where a drawer with no size does', async () => {
    await clickEntry({ mode: 'drawer' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    const unsized = panelWidth();
    cleanup();
    await clickEntry({ mode: 'drawer', size: 'auto' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).toBe(unsized);
    // Non-vacuity: the unsized width is not the `lg` bucket's.
    expect(unsized).not.toBe(withFloor('min(92vw, 960px)'));
  });

  it('a parent view\'s click handler OUTRANKS the whole key, overlay mode included', async () => {
    // `ObjectTimeline` hands `onRowClick ?? onItemClick` to the hook, which
    // calls it and returns — the timeline's own overlay never opens.
    const onRowClick = vi.fn();
    const { open } = await clickEntry({ mode: 'drawer' }, { onRowClick });
    await waitFor(() => expect(onRowClick).toHaveBeenCalledTimes(1));
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: '1' });
    await expectNothingOpened(open, 'parent handler');
  });
});

describe('the registration description\'s warnings are TRUE (objectui#8654)', () => {
  it('with the key ABSENT a click opens nothing — this renderer supplies no drawer default', async () => {
    const { open } = await clickEntry(undefined);
    await expectNothingOpened(open, 'absent key — rewrite the `navigation` description');
  });

  it('with NO host navigator `mode: "page"` has no record page to open, and opens NOTHING', async () => {
    const { open } = await clickEntry({ mode: 'page' });
    await expectNothingOpened(open, 'page — rewrite the `navigation` description');
  });

  it('with NO host navigator a block WITHOUT `mode` resolves to `page` — so it opens nothing either', async () => {
    // `size` alone, written to widen an overlay, takes the spec's `page`
    // default rather than a drawer. Compare the LIT CONTROL.
    const { open } = await clickEntry({ size: 'lg' });
    await expectNothingOpened(open, 'mode-less block — rewrite the `navigation` description');
  });

  it('`mode: "split"` opens NOTHING — the timeline hands the split shell no main panel', async () => {
    const { open } = await clickEntry({ mode: 'split' });
    await expectNothingOpened(open, 'split — rewrite the `navigation` description');
  });
});

/**
 * A host that publishes its record navigator the way the console does
 * (`RelatedRecordActionsContext`): `openRecord` is the spy a `page` click must
 * reach. `resolve` returns no handlers, as the console's list surface does.
 */
function recordNavigatorHost() {
  const openRecord = vi.fn();
  const value: RelatedRecordActionsValue = {
    resolve: () => ({}),
    recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${recordId}`,
    openRecord,
  };
  return { value, openRecord };
}

describe('`page` opens the record page through the host\'s record navigator (objectui#11293)', () => {
  it('LIT CONTROL: under the same host, `mode: "drawer"` opens the drawer and does not navigate', async () => {
    // First, because the rows below would be vacuous against a timeline whose
    // entries are not clickable under this host.
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickEntry({ mode: 'drawer' }, {}, value);
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openRecord).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('`mode: "page"` opens the record page through the host, and no overlay', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickEntry({ mode: 'page' }, {}, value);
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord).toHaveBeenCalledWith(OBJECT, '1');
    expect(dialog()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('a block WITHOUT `mode` resolves to `page`, and navigates the same way', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickEntry({ size: 'lg' }, {}, value);
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord).toHaveBeenCalledWith(OBJECT, '1');
    expect(dialog()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('a parent view\'s `onRowClick` still outranks the host navigator on `page`', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const onRowClick = vi.fn();
    await clickEntry({ mode: 'page' }, { onRowClick }, value);
    await waitFor(() => expect(onRowClick).toHaveBeenCalledTimes(1));
    await settle();
    expect(openRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['the key ABSENT', undefined],
    ['`mode: "none"`', { mode: 'none' }],
    ['`mode: "split"`', { mode: 'split' }],
  ] as const)('%s still opens nothing under the host, and does not navigate', async (why, navigation) => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickEntry(navigation, {}, value);
    await expectNothingOpened(open, String(why));
    expect(openRecord).not.toHaveBeenCalled();
  });
});

/**
 * A timeline that names NO `objectName` (objectui#11168 slice 5 round 2).
 * Since slice 5 such a timeline is a validator-clean document — it draws from
 * `data`, `items` or a `bind` path — but the hook builds the record page from
 * the object name, so the description's `page` and new-tab clauses do not
 * reach it. Same records, same click; only the object name is gone.
 */
async function clickObjectlessEntry(
  navigation: Navigation,
  host?: RelatedRecordActionsValue,
  records: Array<Record<string, unknown>> = RECORDS,
) {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  const schema = {
    type: 'timeline',
    timeline: { startDateField: 'start_date', titleField: 'name' },
    ...(navigation ? { navigation } : {}),
  } satisfies ObjectTimelineProps['schema'];
  const extra = { data: records } as Record<string, unknown>;
  const timeline = <ObjectTimeline schema={schema} {...extra} />;
  render(host ? <RelatedRecordActionsProvider value={host}>{timeline}</RelatedRecordActionsProvider> : timeline);
  fireEvent.click(await screen.findByText('Kickoff'));
  return { open };
}

describe('on a timeline that names no `objectName` there is no record page to open (objectui#11168)', () => {
  it('LIT CONTROL: `mode: "drawer"` still opens the entry\'s record', async () => {
    const { open } = await clickObjectlessEntry({ mode: 'drawer' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openedRecord()).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['`mode: "page"`', { mode: 'page' }],
    ['a block without `mode`', { size: 'lg' }],
  ] as const)('%s opens nothing, even under a host that publishes its record navigator', async (why, navigation) => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickObjectlessEntry(navigation, value);
    await expectNothingOpened(open, String(why));
    expect(openRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['`mode: "new_window"`', { mode: 'new_window' }],
    ['`openNewTab: true` beside `drawer`', { mode: 'drawer', openNewTab: true }],
  ] as const)('%s opens a tab at the entry\'s id alone, not the record page', async (_why, navigation) => {
    const { open } = await clickObjectlessEntry(navigation);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith('/1', '_blank');
    expect(open).not.toHaveBeenCalledWith(`/${OBJECT}/record/1`, '_blank');
    expect(dialog()).toBeNull();
  });

  it('…the entry\'s `_id` when it has no `id`, and `/undefined` when it has neither', async () => {
    let { open } = await clickObjectlessEntry({ mode: 'new_window' }, undefined, [{ _id: 'x9', name: 'Kickoff', start_date: '2024-01-05' }]);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith('/x9', '_blank');
    cleanup();
    vi.unstubAllGlobals();
    ({ open } = await clickObjectlessEntry({ mode: 'new_window' }, undefined, [{ name: 'Kickoff', start_date: '2024-01-05' }]));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith('/undefined', '_blank');
  });
});
