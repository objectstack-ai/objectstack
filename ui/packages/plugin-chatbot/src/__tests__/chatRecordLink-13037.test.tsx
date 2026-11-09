/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13037 — a record link in an assistant answer opens that record
 * inside the console, and nothing else about link safety moves.
 *
 * The one record-link form is `/record/OBJECT/ID` (`RECORD_LINK_PATTERN` in
 * `src/recordLink.ts`). A click on it hands `{ objectName, recordId }` to
 * the chat's `onOpenRecord` (the host's `open_record` opener) with no dialog
 * and no new tab. Every other link, and the record form when the host gives
 * no opener, keeps streamdown's link-safety dialog.
 *
 * The host half (the app segment and the `/_console/` base) is pinned against
 * the real console page in app-shell's
 * `AiChatPage.recordLink-13037.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import type { ChatbotEnhancedMessage } from '../ChatbotEnhanced';
import { LIST_LINK_PATH_PATTERN, parseListLink, parseRecordLink, RECORD_LINK_PATTERN } from '../recordLink';

const user = { id: 'u1', role: 'user', content: 'analyse my customers' } as ChatbotEnhancedMessage;
const answer = (content: string) =>
  ({ id: 'a1', role: 'assistant', content, streaming: false }) as ChatbotEnhancedMessage;

function renderAnswer(content: string, onOpenRecord?: (h: { objectName: string; recordId: string }) => void) {
  return render(
    <ChatbotEnhanced
      placeholder="Ask…"
      onSendMessage={vi.fn()}
      onOpenRecord={onOpenRecord}
      messages={[user, answer(content)]}
    />,
  );
}

/** streamdown renders every link as a button carrying the link text. */
async function clickLink(text: string) {
  const link = await screen.findByRole('button', { name: text });
  expect(link).toHaveAttribute('data-streamdown', 'link');
  await act(async () => {
    fireEvent.click(link);
  });
  // Let streamdown's async click handler run to its end.
  await act(async () => {});
}

const dialog = () => document.querySelector('[data-streamdown="link-safety-modal"]');

let windowOpen: ReturnType<typeof vi.fn>;
beforeEach(() => {
  windowOpen = vi.fn();
  vi.stubGlobal('open', windowOpen);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#13037 — the record-link form', () => {
  it('accepts exactly an object name and a record id', () => {
    expect(parseRecordLink('/record/account/acc_42')).toEqual({ objectName: 'account', recordId: 'acc_42' });
    expect(parseRecordLink('/record/crm_lead/3f2a-9B_c')).toEqual({ objectName: 'crm_lead', recordId: '3f2a-9B_c' });
    for (const href of [
      '/record/account/acc_42?tab=related',
      '/record/account/acc_42#notes',
      '/record/account/acc_42/edit',
      '/record/account/acc_42/',
      '/record/account',
      '/record/Account/acc_42',
      '/record/account/a%2Fb',
      '/record/account/acc.42',
      'record/account/acc_42',
      'https://example.com/record/account/acc_42',
      '/apps/crm/account/record/acc_42',
      `/record/account/${'x'.repeat(129)}`,
      undefined,
    ]) {
      expect(parseRecordLink(href), String(href)).toBeNull();
    }
    expect(RECORD_LINK_PATTERN.source).toBe('^\\/record\\/([a-z_][a-z0-9_]*)\\/([A-Za-z0-9_-]{1,128})$');
  });
});

describe('objectui#13037 — a record link in an answer', () => {
  it('(a) opens the record through the host opener, in the same tab, with no dialog', async () => {
    const onOpenRecord = vi.fn();
    renderAnswer('Top customer: [Wayne Enterprises](/record/account/acc_42).', onOpenRecord);
    await clickLink('Wayne Enterprises');
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(onOpenRecord).toHaveBeenCalledWith({ objectName: 'account', recordId: 'acc_42' });
    expect(dialog()).toBeNull();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('(a) a `./record/...` spelling reaches the click as the same form', async () => {
    const onOpenRecord = vi.fn();
    renderAnswer('[Acme](./record/account/acc_7)', onOpenRecord);
    await clickLink('Acme');
    expect(onOpenRecord).toHaveBeenCalledWith({ objectName: 'account', recordId: 'acc_7' });
    expect(dialog()).toBeNull();
  });

  it('(b) an external link and another same-origin path in the same answer still open the link-safety dialog', async () => {
    const onOpenRecord = vi.fn();
    renderAnswer(
      [
        '- [Wayne Enterprises](/record/account/acc_42)',
        '- [Docs](https://example.com/docs)',
        '- [Accounts](/apps/crm/account)',
      ].join('\n'),
      onOpenRecord,
    );
    for (const [text, url] of [
      ['Docs', 'https://example.com/docs'],
      ['Accounts', '/apps/crm/account'],
    ] as const) {
      await clickLink(text);
      expect(dialog(), text).not.toBeNull();
      expect(dialog()!.textContent).toContain(url);
      expect(windowOpen).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      expect(dialog()).toBeNull();
    }
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it('(c) a record form carrying a query string, a fragment or more path is not navigated', async () => {
    const onOpenRecord = vi.fn();
    renderAnswer(
      [
        '- [Q](/record/account/acc_42?tab=related)',
        '- [F](/record/account/acc_42#notes)',
        '- [P](/record/account/acc_42/edit)',
      ].join('\n'),
      onOpenRecord,
    );
    for (const text of ['Q', 'F', 'P']) {
      await clickLink(text);
      // The default safe link: the dialog, with nothing handed to the host.
      expect(dialog(), text).not.toBeNull();
      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
    }
    expect(onOpenRecord).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('(d) CONTROL: with no host opener the record form keeps the default dialog', async () => {
    renderAnswer('[Wayne Enterprises](/record/account/acc_42)');
    await clickLink('Wayne Enterprises');
    expect(dialog()).not.toBeNull();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('(d) CONTROL: a plain markdown answer renders as before', async () => {
    const onOpenRecord = vi.fn();
    const { container } = renderAnswer('## Customers\n\n- **Wayne Enterprises**: 3 open deals\n- Acme', onOpenRecord);
    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.getByText('Wayne Enterprises').tagName).toBe('SPAN');
    expect(container.querySelectorAll('[data-streamdown="link"]')).toHaveLength(0);
    expect(onOpenRecord).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#31869 — a list link (`/list/OBJECT`, optionally with `view` and
 * `uf__filter`) opens that list through the host's `onOpenList`, and is as
 * closed as the record form: any other key, a repeat, an empty value, a
 * fragment or a filter that is not the `{ logic, conditions }` envelope is not
 * the list form. The host half (the address it builds) is pinned in app-shell's
 * `AiChatPage.recordLink-13037.test.tsx`.
 */
const FILTER = { logic: 'and', conditions: [{ field: 'stage', operator: 'equals', value: 'open' }] };
const ENCODED = encodeURIComponent(JSON.stringify(FILTER));

function renderListAnswer(content: string, onOpenList?: (t: unknown) => void, onOpenRecord?: (h: unknown) => void) {
  return render(
    <ChatbotEnhanced
      placeholder="Ask…"
      onSendMessage={vi.fn()}
      onOpenList={onOpenList}
      onOpenRecord={onOpenRecord}
      messages={[user, answer(content)]}
    />,
  );
}

describe('objectstack#31869 — the list-link form', () => {
  it('accepts the object alone, a view, a filter, or both', () => {
    expect(parseListLink('/list/opportunity')).toEqual({ objectName: 'opportunity' });
    expect(parseListLink('/list/opportunity?view=open_deals')).toEqual({ objectName: 'opportunity', view: 'open_deals' });
    expect(parseListLink(`/list/opportunity?uf__filter=${ENCODED}`)).toEqual({ objectName: 'opportunity', filter: FILTER });
    expect(parseListLink(`/list/crm_deal?view=all&uf__filter=${ENCODED}`)).toEqual({
      objectName: 'crm_deal',
      view: 'all',
      filter: FILTER,
    });
    // The value is read decoded, so an unencoded JSON value is the same filter.
    expect(parseListLink(`/list/opportunity?uf__filter=${JSON.stringify(FILTER)}`)).toEqual({
      objectName: 'opportunity',
      filter: FILTER,
    });
    expect(LIST_LINK_PATH_PATTERN.source).toBe('^\\/list\\/([a-z_][a-z0-9_]*)$');
  });

  it('refuses everything else: never an open URL', () => {
    for (const href of [
      '/list/opportunity?',
      '/list/opportunity?foo=bar',
      '/list/opportunity?view=all&foo=bar',
      '/list/opportunity?view=a&view=b',
      `/list/opportunity?uf__filter=${ENCODED}&uf__filter=${ENCODED}`,
      '/list/opportunity?view=',
      '/list/opportunity?uf__filter=',
      '/list/opportunity?view=Open%20Deals',
      '/list/opportunity?filter[stage]=open',
      '/list/opportunity?uf__search=acme',
      '/list/opportunity?uf__filter={not json',
      `/list/opportunity?uf__filter=${encodeURIComponent('[]')}`,
      `/list/opportunity?uf__filter=${encodeURIComponent(JSON.stringify({ logic: 'xor', conditions: [] }))}`,
      `/list/opportunity?uf__filter=${encodeURIComponent(JSON.stringify({ logic: 'and', conditions: [] }))}`,
      `/list/opportunity?uf__filter=${encodeURIComponent(JSON.stringify({ logic: 'and' }))}`,
      '/list/opportunity#open',
      `/list/opportunity?uf__filter=${ENCODED}#x`,
      '/list/opportunity/',
      '/list/opportunity/all',
      '/list/Opportunity',
      '/list/a%2Fb',
      '/list/',
      'list/opportunity',
      'https://example.com/list/opportunity',
      '/apps/crm/opportunity',
      '/record/account/acc_42',
      undefined,
      null,
    ]) {
      expect(parseListLink(href as string | undefined), String(href)).toBeNull();
    }
  });
});

describe('objectstack#31869 — a list link in an answer', () => {
  it('opens the list through the host opener, in the same tab, with no dialog', async () => {
    const onOpenList = vi.fn();
    renderListAnswer(`There are [12 open opportunities](/list/opportunity?view=all&uf__filter=${ENCODED}).`, onOpenList);
    await clickLink('12 open opportunities');
    expect(onOpenList).toHaveBeenCalledTimes(1);
    expect(onOpenList).toHaveBeenCalledWith({ objectName: 'opportunity', view: 'all', filter: FILTER });
    expect(dialog()).toBeNull();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('a list link and a record link in one answer each reach their own opener', async () => {
    const onOpenList = vi.fn();
    const onOpenRecord = vi.fn();
    renderListAnswer(
      ['- [Open deals](/list/opportunity)', '- [Wayne Enterprises](/record/account/acc_42)'].join('\n'),
      onOpenList,
      onOpenRecord,
    );
    await clickLink('Open deals');
    await clickLink('Wayne Enterprises');
    expect(onOpenList).toHaveBeenCalledWith({ objectName: 'opportunity' });
    expect(onOpenRecord).toHaveBeenCalledWith({ objectName: 'account', recordId: 'acc_42' });
    expect(dialog()).toBeNull();
  });

  it('a list form with a key outside the grammar keeps the dialog, with nothing handed to the host', async () => {
    const onOpenList = vi.fn();
    renderListAnswer('[Open deals](/list/opportunity?view=all&next=https://example.com)', onOpenList);
    await clickLink('Open deals');
    expect(dialog()).not.toBeNull();
    expect(onOpenList).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('CONTROL: with no list opener the list form keeps the default dialog', async () => {
    const onOpenRecord = vi.fn();
    renderListAnswer('[Open deals](/list/opportunity)', undefined, onOpenRecord);
    await clickLink('Open deals');
    expect(dialog()).not.toBeNull();
    expect(onOpenRecord).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });
});
