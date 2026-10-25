/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10031 — every user-visible string `ObjectCalendar` renders reaches a
 * locale pack.
 *
 * ## Why every assertion here is made under `zh`, and none under `en`
 *
 * This is the whole design of the file, and it is the reason it can fail. The
 * component is i18n-aware — both hooks are imported and called — and the
 * strings this card is about were hard-coded English sitting beside them. Under
 * an ENGLISH locale a hard-coded `Loading calendar…` and a pack value of
 * `Loading calendar…` render the same bytes, so an English assertion on the
 * English text is green before the repair and green after it: it asserts that
 * the sentence exists, never that anything routes it.
 *
 * A NON-English locale is the only reading that separates the two, because a
 * literal cannot move and a pack value must. Each case below therefore asserts
 * the ABSENCE of the English literal and the PRESENCE of the `zh` one, and each
 * of them fails on the pre-repair component.
 *
 * ## The sweep this file covers
 *
 * The card listed four literals and said so explicitly as a LOWER BOUND. The
 * re-sweep found more, and the cases below are grouped by the screen that
 * renders them rather than by the card's list:
 *
 *   - the loading screen              (`calendar.loading`)
 *   - the error screen                (`calendar.loadError`)
 *   - the refusal screen, both        (`calendar.configRequired`,
 *     paragraphs                       `calendar.configRequiredHint`)
 *   - the pull-to-refresh affordance  (`calendar.pullToRefresh`,
 *                                      `calendar.refreshing`)
 *   - the quick-create dialog: title, (`calendar.newEvent`, `calendar.onDate`,
 *     date line, field label,          `calendar.eventTitle`,
 *     placeholder, both buttons and    `calendar.eventTitlePlaceholder`,
 *     the empty-title validation       `common.cancel`, `common.create`,
 *                                      `calendar.creating`,
 *                                      `calendar.titleRequired`)
 *   - the record overlay's title      (`calendar.eventDetails`)
 *
 * ⛔ `CalendarView`'s own `aria-label`s ("Calendar", "Calendar grid", "Go to
 * today") are NOT in scope here: they live in a sibling file this card's fence
 * does not open, and they are reported separately rather than smuggled in.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { ObjectCalendar } from './ObjectCalendar';

beforeEach(() => {
  // The provider remembers the language across mounts (objectstack#5406), so a
  // stale value would otherwise leak between cases.
  try {
    window.localStorage.clear();
  } catch {
    /* private mode */
  }
  // The record overlay's shared payload asks `POST /api/v1/security/explain`;
  // under happy-dom a relative fetch is a REAL socket (objectui#6640), so it is
  // served from a double. Installed for every case rather than one, so no case
  // can ever run with the real `fetch` in place.
  installRecordSecurityExplainDouble(vi);
});

// ⚠️ ONE hook, in this order, on purpose (objectui#7439): vitest runs afterEach
// in REVERSE registration order, so a separate `afterEach(cleanup)` would run
// after the unstub and let a late read escape. Unmount first, restore last.
afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
});

const today = new Date();
const dayInThisMonth = (d: number) =>
  new Date(today.getFullYear(), today.getMonth(), Math.min(d, 28), 9, 0, 0, 0);

const ROWS = [{ id: 'r1', name: 'Ada out', start_date: dayInThisMonth(10).toISOString() }];

const objectDef = {
  name: 'crm_leave_request',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    start_date: { type: 'date' },
  },
};

const makeDataSource = (overrides: Record<string, unknown> = {}) =>
  ({
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    getObjectSchema: vi.fn().mockResolvedValue(objectDef),
    create: vi.fn().mockResolvedValue({ id: 'r2' }),
    ...overrides,
  }) as any;

/**
 * The zh pack is lazy (objectui#7479), so "the provider is mounted" and "the
 * Chinese catalogue has arrived" are two different moments. This probe reads a
 * key the packs already carried before this card, so it settles identically on
 * the pre- and post-repair trees: it reports the LOCALE being ready, never the
 * repair being present. Every case waits on it before it reads the calendar.
 */
const ZH_ALL_DAY = '全天';

function LocaleProbe() {
  const { t } = useObjectTranslation();
  return <span data-testid="locale-probe">{t('calendar.allDay')}</span>;
}

async function renderZh(ui: React.ReactElement) {
  const result = render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <LocaleProbe />
      {ui}
    </I18nProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('locale-probe').textContent).toBe(ZH_ALL_DAY),
  );
  return result;
}

const textOf = (container: HTMLElement) =>
  (container.textContent ?? '').replace(/\s+/g, ' ').trim();

const CONFIGURED = {
  type: 'object-calendar',
  objectName: 'crm_leave_request',
  calendar: { startDateField: 'start_date' },
} as any;

describe('objectui#10031 — ObjectCalendar renders no hard-coded English under zh', () => {
  it('the locale probe itself moves — the control for every zero below', async () => {
    // Without this, a provider that silently failed to load `zh` would make
    // every "the English literal is gone" assertion below unreachable rather
    // than green, and a broken harness would read as a broken component.
    const { container } = await renderZh(<span />);
    expect(textOf(container)).toContain(ZH_ALL_DAY);
    expect(textOf(container)).not.toContain('All Day');
  });

  it('the loading screen is localized', async () => {
    // A `find` that never settles holds the component on its loading branch.
    const dataSource = makeDataSource({ find: vi.fn().mockReturnValue(new Promise(() => {})) });
    const { container } = await renderZh(
      <ObjectCalendar schema={CONFIGURED} dataSource={dataSource} />,
    );
    await waitFor(() => expect(textOf(container)).toContain('加载日历中…'));
    expect(textOf(container)).not.toContain('Loading calendar');
  });

  it('the error screen is localized, and still carries the underlying message', async () => {
    const dataSource = makeDataSource({ find: vi.fn().mockRejectedValue(new Error('boom')) });
    const { container } = await renderZh(
      <ObjectCalendar schema={CONFIGURED} dataSource={dataSource} />,
    );
    await waitFor(() => expect(textOf(container)).toContain('boom'));
    // The prefix is copy and moves; the message is the server's / the caller's
    // own text and is passed through untranslated by design.
    expect(textOf(container)).toContain('错误');
    expect(textOf(container)).not.toContain('Error:');
  });

  it('both paragraphs of the refusal screen are localized', async () => {
    const { container } = await renderZh(
      <ObjectCalendar
        schema={{ type: 'object-calendar', objectName: 'crm_leave_request' } as any}
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(textOf(container)).toContain('日历配置'));
    const text = textOf(container);
    // Paragraph one.
    expect(text).not.toContain('Calendar configuration required');
    // Paragraph two.
    expect(text).not.toContain('It belongs on the view');
    // ⭐ The binding key names are IDENTIFIERS, not copy — an author types
    // them verbatim, so they stay in ASCII in every pack. Asserting they
    // survived is what stops a translation from "localizing" them.
    expect(text).toContain('startDateField');
    expect(text).toContain('titleField');
    expect(text).toContain('sourceView');
  });

  it('the pull-to-refresh affordance is localized', async () => {
    // PRE-FETCHED `data`: this case is about the LABEL, and on this path the
    // first render already mounts the host. It used to be the only path that
    // worked: `usePullToRefresh` bound its listeners once, while the
    // internal-fetch path was still showing the loading screen, so they were
    // never attached. objectui#10105 fixed that in the hook. Both paths are
    // pinned in `ObjectCalendar.pullToRefresh-10105.test.tsx`.
    const { container } = await renderZh(
      <ObjectCalendar schema={CONFIGURED} dataSource={makeDataSource()} data={ROWS as any} />,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    // `usePullToRefresh` attaches native listeners to the component's own
    // OUTER element (`pullRef`), which is two levels above `CalendarView`'s
    // region. ⛔ Not `container.firstElementChild` — that is the locale probe
    // this harness renders beside the calendar, and a touch there scrolls
    // nothing and asserts nothing.
    const host = screen.getByRole('region').parentElement!.parentElement as HTMLElement;
    // ⚠️ Two things this gesture has to get right, and both fail SILENTLY —
    // the label simply never appears and the case reads as an un-localized
    // component rather than as a gesture that never happened:
    //   1. happy-dom does not synthesise a `TouchList` from a plain object, so
    //      the events are built by hand and `touches` is attached directly;
    //   2. the hook keeps the start point in a ref and its move handler bails
    //      on a FALSY ref, so a gesture beginning at y=0 is discarded.
    const touchAt = (type: string, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      (event as unknown as { touches: Array<{ clientY: number }> }).touches = [{ clientY }];
      return event;
    };
    fireEvent(host, touchAt('touchstart', 10));
    fireEvent(host, touchAt('touchmove', 60));
    await waitFor(() => expect(textOf(container)).toContain('下拉刷新'));
    expect(textOf(container)).not.toContain('Pull to refresh');
  });

  it('the quick-create dialog is localized, label, placeholder and both buttons', async () => {
    const { container } = await renderZh(
      <ObjectCalendar schema={CONFIGURED} dataSource={makeDataSource()} />,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('gridcell')[8]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    const dialog = screen.getByRole('dialog') as HTMLElement;
    const text = textOf(dialog);

    expect(text).toContain('新建事件');
    expect(text).not.toContain('New event');
    expect(text).toContain('标题');
    expect(text).toContain('取消');
    expect(text).not.toContain('Cancel');
    expect(text).toContain('新建');
    expect(text).not.toContain('Create');

    const input = dialog.querySelector('#quick-create-title') as HTMLInputElement;
    expect(input.placeholder).not.toBe("What's this event about?");
    expect(input.placeholder).toBe('这个事件是关于什么的？');
  });

  it('the empty-title validation message is localized', async () => {
    const { container } = await renderZh(
      <ObjectCalendar schema={CONFIGURED} dataSource={makeDataSource()} />,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('gridcell')[8]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    const dialog = screen.getByRole('dialog') as HTMLElement;
    // The Create button is disabled on an empty title, so Enter in the field is
    // the reachable door to the validation branch.
    fireEvent.keyDown(dialog.querySelector('#quick-create-title') as HTMLInputElement, {
      key: 'Enter',
    });
    await waitFor(() => expect(textOf(dialog)).toContain('请填写标题'));
    expect(textOf(dialog)).not.toContain('Title is required');
  });

  it("the record overlay's fallback title is localized", async () => {
    // No `titleField` is declared, which is the branch that reaches the
    // fallback — both arms of the ternary spelled the same English literal.
    await renderZh(
      <ObjectCalendar
        schema={
          {
            ...CONFIGURED,
            data: { provider: 'object', object: 'crm_leave_request' },
            navigation: { mode: 'drawer' },
          } as any
        }
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    // The clickable element is the event chip, not the text node inside it.
    const chip = screen.getByText('Ada out').closest('[role="button"]') as HTMLElement;
    fireEvent.click(chip);
    // ⚠️ The overlay shell is a Radix portal, so it lands in `document.body`
    // and NOT in the render container — reading the container here would be a
    // zero that means "looked in the wrong place".
    await waitFor(() => expect(textOf(document.body)).toContain('事件详情'));
    expect(textOf(document.body)).not.toContain('Event Details');
  });
});
