/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `plugin-calendar:object-calendar` / `view:calendar` — the shared renderer
 * forwards only what it consumes or declares (objectui#4492; the objectui#4425
 * phase-2 whitelist contract applied to this renderer, exactly as objectui#4453
 * applied it to the sibling `calendar-view` renderer next door).
 *
 * ONE implementation is registered under BOTH keys, so one fix closes both and
 * both are pinned here.
 *
 * The renderer used to end in `< ObjectCalendar schema={bound} … {...props} />`,
 * where `props` was everything `SchemaRenderer` hands a registered widget.
 * `ObjectCalendarComponentProps` declares eight callbacks and a `locale`, so an authored
 * value under any of those names landed on the declared prop — and an SDUI
 * author writing JSON can never produce a function. The card measured three
 * user-reachable failures, all pinned below:
 *
 *   - authored `onDateClick` string  → day-cell click throws UNCAUGHT
 *   - authored `onNavigate` string   → Next-period click throws UNCAUGHT
 *   - authored `locale: 'en_US'`     → RangeError out of RENDER, error boundary
 *
 * ## Why the handler cases are worse than an error boundary
 *
 * React does not route event-handler errors to `SchemaErrorBoundary`: a render
 * error becomes the boundary's tidy alert, but a handler error escapes to the
 * window as an UNCAUGHT error. So the calendar keeps looking fine while that
 * gesture is dead — nothing on screen says anything is wrong. The assertions
 * therefore capture the window `error` event, a synchronous throw out of
 * `fireEvent`, and `console.error` (see {@link clickErrors}), and assert on the
 * UNION, because which of the three carries the report is the DOM
 * implementation's business and not this contract's.
 *
 * ## The two authoring channels
 *
 * Both are pinned for every authored case, per objectui#4452's lesson: the
 * node's own key, and the `props: { … }` container whose contents
 * `SchemaRenderer` spreads separately. A fix that only handled one would leave
 * the other half live.
 *
 * ## What must NOT change
 *
 * A host-passed FUNCTION is the component's genuine escape hatch — the working
 * path the card forbids breaking, and not a hypothetical one: `ListView` builds
 * an `object-calendar` node carrying `onRowClick: navigation.handleClick`, a
 * real function on a real node key. It survives as a DECLARED, function-typed
 * hatch. The declared `data` / `loading` pre-fetch path (`ObjectView`) and a
 * well-formed `locale` survive the same way.
 *
 * ## The record-level explain probe (objectui#5438)
 *
 * The DEFAULT-navigation `onEventClick` case below opens `ObjectCalendar`'s
 * overlay drawer (`navIsOverlay` true for the default `drawer` mode), which
 * renders `@object-ui/plugin-detail`'s `RecordDetailDrawer` → `DetailView`.
 * `DetailView` gates its Edit/Delete CTAs on a per-record write verdict
 * (`useRecordEditable`, objectstack#3821): `POST /api/v1/security/explain`,
 * ridden on the host's `apiFetch` when one is injected and on the bare global
 * `fetch` otherwise (by design, for standalone embeds — see that hook's own
 * docstring). This file's `renderCalendar()` wraps every case in
 * `SchemaRendererProvider dataSource={null}` with no `apiFetch`, so that
 * fallback used to reach the real network: happy-dom's default document
 * origin is `http://localhost:3000/`, so the relative URL resolved and left
 * the process for real — `4× ECONNREFUSED 127.0.0.1:3000`, invisible to every
 * assertion here because the hook fails open on a failed request (the same
 * defect class as objectui#3339, closed by PR #4105 for `plugin-detail`'s own
 * suites, and objectui#5225 / #5280 for `plugin-report` / `plugin-dashboard`
 * — this file is a new CONSUMER of the same hook, not a new root cause).
 *
 * Fixed the same way #4105 settled: {@link installExplainDouble} answers the
 * probe from a recording double instead of the network. `visible: true`
 * reproduces the pre-fix observable behaviour exactly (the hook already
 * failed open), so no existing assertion changes meaning — the double is
 * pinned by its own dedicated test below the DEFAULT-navigation case, the
 * only path in this file that reaches it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { __clearRecordEditableCache } from '@object-ui/plugin-detail';
// Module scope: the registration side effect this file renders through
// (AGENTS.md 测试纪律 — never inside a hook).
import './index';

/**
 * A stand-in for the record-level explain probe (`useRecordEditable`,
 * `POST /api/v1/security/explain`) — see the file-header note above for why
 * this file needs one. Same shape as `plugin-detail`'s own
 * `DetailView.test.tsx` (PR #4105): a recording double, never a
 * swallow-everything stub, so an escape to some OTHER endpoint stays a
 * recorded call this file's counter-probe can fail on instead of vanishing
 * into the hook's fail-open `catch`.
 *
 * `visible: true` for every call — the pre-fix network failure also failed
 * open, so this keeps every existing assertion's meaning unchanged.
 */
function installExplainDouble(): { url: string; body: Record<string, unknown> | undefined }[] {
  const calls: { url: string; body: Record<string, unknown> | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return { ok: true, json: async () => ({ record: { visible: true } }) };
    }),
  );
  return calls;
}

/** The text `SchemaErrorBoundary` renders when a widget throws during RENDER. */
const ERROR_BOUNDARY_MARKER = 'failed to render';

/** The card's verbatim repro value, for both channels. */
const NOT_A_FUNCTION = 'NOT-A-FUNCTION';

/**
 * The card's verbatim repro locale: the underscore spelling a producer writes by
 * accident. `Intl` rejects it, so `toLocaleDateString` throws out of render.
 */
const BAD_LOCALE = 'en_US';

/**
 * The flat calendar config `ObjectView` / `ListView` emit, which is what makes
 * `getCalendarConfig` return non-null and the month grid render at all.
 */
const CALENDAR_FIELDS = { startDateField: 'start_at', titleField: 'name' };

/** Two records in the CURRENT month, so the default month view shows them. */
function currentMonthRecords() {
  const now = new Date();
  const day = (n: number) =>
    new Date(now.getFullYear(), now.getMonth(), n, 10, 0, 0, 0).toISOString();
  return [
    { id: 'r1', name: 'Computed Standup', start_at: day(10) },
    { id: 'r2', name: 'Computed Review', start_at: day(12) },
  ];
}

/**
 * A node for either registration. `data` is the declared pre-fetch array, which
 * makes the component skip its own fetch and render immediately.
 */
function calendarNode(type: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    id: 'n',
    objectName: 'accounts',
    ...CALENDAR_FIELDS,
    data: currentMonthRecords(),
    ...extra,
  } as never;
}

/**
 * Render a node through the real `SchemaRenderer`, inside the provider the
 * renderer's own `useSchemaContext()` call requires.
 *
 * `dataSource: null` is deliberate: every node here carries the declared `data`
 * array, so the component takes its pre-fetched path and never fetches. That
 * keeps each case about the props boundary and nothing else.
 *
 * `hostProps` are `SchemaRenderer`'s TRAILING props — the React-host channel,
 * spread onto the widget last, which is the path the host hatches must keep.
 */
function renderCalendar(schema: unknown, hostProps: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={null}>
      <SchemaRenderer schema={schema as never} {...hostProps} />
    </SchemaRendererProvider>,
  );
}

function calendarRegion(): Element | null {
  return document.body.querySelector('[role="region"][aria-label="Calendar"]');
}

/** The header's date label, which `CalendarView` mirrors into the popover trigger. */
function headerDateLabel(): string {
  const trigger = document.body.querySelector('[aria-label^="Current date:"]');
  return trigger?.getAttribute('aria-label') ?? '';
}

async function expectCalendarRendered() {
  await waitFor(() => expect(calendarRegion()).not.toBeNull());
  expect(document.body.textContent ?? '').not.toContain(ERROR_BOUNDARY_MARKER);
}

/**
 * Run `act` and return every error report it produced, from all three channels
 * an uncaught handler error can take.
 *
 * A handler error is NOT a render error, so `SchemaErrorBoundary` never sees it
 * and the DOM stays intact — the only evidence is the report. Which channel
 * carries it depends on the DOM implementation (a real browser and happy-dom
 * both "report the exception" per the DOM spec, but a synchronous rethrow out of
 * `dispatchEvent` is also a legal shape), so all three are collected and the
 * assertion is on the UNION. That way this pin cannot go quietly green because
 * an environment changed which channel it reports on.
 */
function clickErrors(act: () => void): string[] {
  const seen: string[] = [];
  const onWindowError = (event: Event) => {
    const e = event as ErrorEvent;
    seen.push(`window.error: ${e.message || String(e.error)}`);
  };
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
      // React logs plenty of its own noise here; only genuine TypeErrors of the
      // shape this card is about are evidence.
      if (text.includes('is not a function')) seen.push(`console.error: ${text}`);
    });
  window.addEventListener('error', onWindowError);
  try {
    act();
  } catch (err) {
    seen.push(`thrown: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    window.removeEventListener('error', onWindowError);
    consoleError.mockRestore();
  }
  return seen;
}

/** Any day cell: the month grid's cells carry `role="gridcell"`. */
function dayCells(): NodeListOf<Element> {
  return document.body.querySelectorAll('[role="gridcell"]');
}

describe('object-calendar: an authored handler key can no longer crash a gesture (objectui#4492)', () => {
  // objectui#5438 — installed for every case, not only the one that reaches
  // it: the record-level explain probe is DetailView's own wiring, invisible
  // from this file's schema authoring, so scoping the double to a single
  // `it` would silently stop covering it the moment a future case takes the
  // same drawer-opening path. `__clearRecordEditableCache` matters because the
  // hook memoises verdicts by `object:recordId:operation` in MODULE scope —
  // without clearing it, whichever case runs first primes the cache for
  // every case after it, and the double stops being asked at all.
  let explainCalls: ReturnType<typeof installExplainDouble>;
  beforeEach(() => {
    __clearRecordEditableCache();
    explainCalls = installExplainDouble();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops an authored `onDateClick` string written on the NODE — the day-cell click is a no-op', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // The card's repro, channel 1. `ObjectCalendar` tests `if (onDateClick)`
      // and a non-empty string is TRUTHY, so the guard used to hand the string
      // straight to a call.
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        onDateClick: NOT_A_FUNCTION,
      }));

      // The calendar renders normally before AND after the fix — that is the
      // hazard: nothing on screen distinguishes the two.
      await expectCalendarRendered();
      const cells = dayCells();
      expect(cells.length).toBeGreaterThan(0);

      // Before the fix: `window.error: onDateClick is not a function`.
      expect(clickErrors(() => fireEvent.click(cells[0]!))).toEqual([]);
      // Still a calendar afterwards, not a blank page.
      expect(calendarRegion()).not.toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('drops an authored `onDateClick` string written in the `props` CONTAINER', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Channel 2: `SchemaRenderer` spreads the container's contents as props
      // too, so a fix that only handled the node's own key would leave this
      // half live (objectui#4452's lesson).
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        props: { onDateClick: NOT_A_FUNCTION },
      }));

      await expectCalendarRendered();
      const cells = dayCells();
      expect(cells.length).toBeGreaterThan(0);

      expect(clickErrors(() => fireEvent.click(cells[0]!))).toEqual([]);
      expect(calendarRegion()).not.toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('drops an authored `onNavigate` string written on the NODE — the Next-period click is a no-op', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // The card's second repro. `onNavigate?.(date)` guards NULLISH, not
      // non-callable, so a string sails past the optional call.
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        onNavigate: NOT_A_FUNCTION,
      }));

      await expectCalendarRendered();
      const next = await screen.findByRole('button', { name: 'Next period' });

      // Before the fix: `window.error: onNavigate is not a function`.
      expect(clickErrors(() => fireEvent.click(next))).toEqual([]);
      expect(calendarRegion()).not.toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('drops an authored `onNavigate` string written in the `props` CONTAINER', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        props: { onNavigate: NOT_A_FUNCTION },
      }));

      await expectCalendarRendered();
      const next = await screen.findByRole('button', { name: 'Next period' });

      expect(clickErrors(() => fireEvent.click(next))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it('renders through an authored `locale` that `Intl` rejects, instead of throwing out of render', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // The card's third repro, and the only one that is fatal at RENDER time:
      // `toLocaleDateString('en_US')` throws `RangeError: Incorrect locale
      // information provided`, taking the whole calendar to the boundary.
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        locale: BAD_LOCALE,
      }));

      // Post-fix: the key is dropped, so the component's own default locale
      // applies and the header renders a real date label.
      await expectCalendarRendered();
      expect(headerDateLabel()).not.toBe('');
    } finally {
      errors.mockRestore();
    }
  });

  it('renders through a rejected `locale` written in the `props` CONTAINER', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        props: { locale: BAD_LOCALE },
      }));

      await expectCalendarRendered();
      expect(headerDateLabel()).not.toBe('');
    } finally {
      errors.mockRestore();
    }
  });

  /* ── `onEventClick`: the declared-hatch rule, with its provenance stated ─── */

  it('drops an authored `onEventClick` string under the DEFAULT navigation — pinned as a contract, not as a crash repro', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // PROVENANCE (objectui#4492, recorded honestly): the filing could NOT
      // reproduce a crash on this key. `ObjectCalendar` only calls the parent
      // handler when the local navigation is NOT an overlay (`if
      // (!navIsOverlay)`), and the default navigation config is a DRAWER — an
      // overlay — so the call is skipped and the authored string is never
      // reached. This case therefore asserts the CONTRACT (the key is dropped
      // and the click is clean) and deliberately claims no pre-fix crash: it is
      // green on both sides of the fix, by construction.
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        onEventClick: NOT_A_FUNCTION,
      }));

      await expectCalendarRendered();
      const event = await screen.findByRole('button', { name: 'Computed Standup' });

      expect(clickErrors(() => fireEvent.click(event))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  /**
   * objectui#5438 — opening the DEFAULT-navigation drawer is the one path in
   * this file that mounts `DetailView`'s record-level explain gate
   * (`useRecordEditable`, update + delete). Pinned as this file's
   * COUNTER-PROBE: it proves `installExplainDouble()` is actually reached
   * (not merely installed and never asked), and — because
   * `RecordDetailDrawer` hands `DetailView` `data: record` rather than a bare
   * `resourceId`, taking `DetailView`'s inline-data path — that the object
   * name it asks about is the one `ObjectCalendar` resolves from
   * `schema.objectName` ('accounts'), not from `dataConfig`'s 'object'
   * provider shape (this file's nodes carry a literal `data` array, so
   * `getDataConfig` never reaches that branch).
   *
   * objectui#13045 — `DetailView` asks a verdict only for a button its host
   * shows. The drawer's `RecordDetailPanel` passes `showDelete: !!onDelete`
   * (the calendar hands it an `onDelete`) and never sets `showEdit`, so the
   * drawer shows Delete and no Edit button: the `delete` verdict is asked and
   * the `update` verdict, which would gate nothing on screen, is not.
   */
  it('probes the record-level explain endpoint (delete only — the drawer shows no Edit button) when the DEFAULT-navigation drawer opens, from the double — not the network', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderCalendar(calendarNode('plugin-calendar:object-calendar'));

      await expectCalendarRendered();
      const event = await screen.findByRole('button', { name: 'Computed Standup' });
      fireEvent.click(event);

      await waitFor(() => expect(explainCalls).toHaveLength(1));
      // Let any further verdict effect run, so a second ask would be counted.
      await act(async () => {
        for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      });

      expect(explainCalls.map((c) => c.url)).toEqual(['/api/v1/security/explain']);
      expect(explainCalls.map((c) => c.body)).toEqual([
        { object: 'accounts', operation: 'delete', recordId: 'r1' },
      ]);
    } finally {
      errors.mockRestore();
    }
  });

  it('drops an authored `onEventClick` string when navigation is NOT an overlay — the reachability the filing left open', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // PROVENANCE, part 2 — this card's own new measurement, NOT the filing's.
      // The filing established the exposure in the code path but explicitly
      // could not establish its reachability, so it claimed no crash. This case
      // supplies the missing condition: `navigation: { mode: 'none' }` is the
      // smallest non-overlay configuration — `navIsOverlay` is false, and
      // `useNavigationOverlay`'s own `handleClick` returns early for `none`, so
      // no router is involved — which makes `onEventClick?.(event.data)` run.
      //
      // MEASURED on the pre-fix renderer, verbatim:
      //   window.error:  onEventClick is not a function
      //   console.error: onEventClick is not a function
      //
      // So the exposure is real and reachable, and the answer to the filing's
      // open question is: it depends on the navigation mode, exactly as the
      // filing suspected. The DEFAULT (drawer) config above stays a
      // contract-only pin, green on both sides.
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        navigation: { mode: 'none' },
        onEventClick: NOT_A_FUNCTION,
      }));

      await expectCalendarRendered();
      const event = await screen.findByRole('button', { name: 'Computed Standup' });

      expect(clickErrors(() => fireEvent.click(event))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  /* ── the SECOND registration: one implementation, one fix ─────────────── */

  it('`view:calendar` — the twin registration — drops the same authored `onDateClick` string', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // One implementation is registered under both keys, so this is the same
      // defect reached through the other door. Pinned so a future change that
      // fixes only one registration cannot pass.
      renderCalendar(calendarNode('view:calendar', {
        onDateClick: NOT_A_FUNCTION,
      }));

      await expectCalendarRendered();
      const cells = dayCells();
      expect(cells.length).toBeGreaterThan(0);

      expect(clickErrors(() => fireEvent.click(cells[0]!))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it('`view:calendar` renders through a `locale` that `Intl` rejects', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderCalendar(calendarNode('view:calendar', {
        locale: BAD_LOCALE,
      }));

      await expectCalendarRendered();
      expect(headerDateLabel()).not.toBe('');
    } finally {
      errors.mockRestore();
    }
  });

  /* ── must-not-change: the host escape hatches ─────────────────────────── */

  it('MUST-NOT-CHANGE: a host FUNCTION `onDateClick` through the trailing props still fires', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onDateClick = vi.fn();
    try {
      // The host path the card forbids breaking: `SchemaRenderer` spreads its
      // own extra props onto the component last.
      renderCalendar(calendarNode('plugin-calendar:object-calendar'), { onDateClick });

      await expectCalendarRendered();
      fireEvent.click(dayCells()[0]!);

      expect(onDateClick).toHaveBeenCalledTimes(1);
      expect(onDateClick.mock.calls[0]![0]).toBeInstanceOf(Date);
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a FUNCTION `onDateClick` authored on the node (a programmatic host) still fires', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onDateClick = vi.fn();
    try {
      // Not JSON-authorable, but reachable from a host that builds the node in
      // TS. The hatch discriminates on the VALUE's type, not on which channel
      // it arrived through, so this keeps working.
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        onDateClick,
      }));

      await expectCalendarRendered();
      fireEvent.click(dayCells()[0]!);

      expect(onDateClick).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a host FUNCTION `onNavigate` still fires on Next period', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onNavigate = vi.fn();
    try {
      renderCalendar(calendarNode('plugin-calendar:object-calendar'), { onNavigate });

      await expectCalendarRendered();
      fireEvent.click(await screen.findByRole('button', { name: 'Next period' }));

      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate.mock.calls[0]![0]).toBeInstanceOf(Date);
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: `ListView`s `onRowClick` FUNCTION on the node still reaches the component', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onRowClick = vi.fn();
    try {
      // The real host path measured in `packages/plugin-list/src/ListView.tsx`:
      // its `baseProps` puts `onRowClick: navigation.handleClick` on the
      // `object-calendar` node it builds. Observable only when navigation is
      // not an overlay, which is the same condition the component applies to
      // the inherited handler.
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        navigation: { mode: 'none' },
        onRowClick,
      }));

      await expectCalendarRendered();
      fireEvent.click(await screen.findByRole('button', { name: 'Computed Standup' }));

      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ id: 'r1', name: 'Computed Standup' }),
      );
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a host FUNCTION `onEventClick` still fires when navigation is not an overlay', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onEventClick = vi.fn();
    try {
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        navigation: { mode: 'none' },
        onEventClick,
      }));

      await expectCalendarRendered();
      fireEvent.click(await screen.findByRole('button', { name: 'Computed Standup' }));

      expect(onEventClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', name: 'Computed Standup' }),
      );
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a well-formed `locale` still reaches the component', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        locale: 'de-DE',
      }));

      await expectCalendarRendered();
      // German month names in the header prove the tag was forwarded, not
      // dropped along with the rejected ones.
      const label = headerDateLabel();
      expect(label).not.toBe('');
      expect(
        /Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember/.test(
          label,
        ),
      ).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: both registrations still render a normal calendar with no authored extras', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = renderCalendar(calendarNode('plugin-calendar:object-calendar'));
      await expectCalendarRendered();
      expect(await screen.findByRole('button', { name: 'Computed Standup' })).toBeTruthy();
      unmount();

      renderCalendar(calendarNode('view:calendar'));
      await expectCalendarRendered();
      expect(await screen.findByRole('button', { name: 'Computed Standup' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: the declared `data` / `loading` pre-fetch path still reaches the component', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // `ObjectView` pre-fetches and hands the rows down; the component gates
      // that path on `Array.isArray(data)` and skips its own fetch. Every case
      // in this file depends on it, and `registration.test.tsx` pins the
      // renderer-level passthrough — this pins the rendered consequence.
      renderCalendar(calendarNode('plugin-calendar:object-calendar'), { loading: false });

      await expectCalendarRendered();
      expect(await screen.findByRole('button', { name: 'Computed Review' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: the node className still lands on the calendar container', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderCalendar(calendarNode('plugin-calendar:object-calendar', {
        className: 'os-calendar-probe',
      }));

      await expectCalendarRendered();
      expect(document.body.querySelector('.os-calendar-probe')).not.toBeNull();
    } finally {
      errors.mockRestore();
    }
  });
});
