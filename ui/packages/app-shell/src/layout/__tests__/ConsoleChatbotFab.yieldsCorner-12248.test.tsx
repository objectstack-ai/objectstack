// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12248 — the assistant FAB yields its corner to the controls that
 * live there.
 *
 * Measured on a hosted console (HotCRM 4.0.1, 1440×900 and 1440×1400) and
 * re-measured on this tree with Playwright: `elementFromPoint` at the centre
 * of the inline-edit bar's Save and of the last attachment row's Delete (at
 * full scroll, the panel being the page's last content) answered the FAB, and
 * a click there opened the assistant. One tester lost an inline save that way.
 *
 * ## What is real here, and what is not
 *
 * The FAB, `InlineEditSaveBar` inside a real `InlineEditProvider`, and
 * `RecordAttachmentsPanel` are all real renders. Layout is NOT: happy-dom
 * computes no boxes, so `getBoundingClientRect` is answered by a stub holding
 * the geometry the Playwright probe measured (the PR body carries that run).
 * The stub recognises elements by what a user sees — the bar's `region` role,
 * a button's accessible label — never by the `data-fab-yield` marker, so
 * deleting the marker from either occupant turns its pin red here.
 *
 * Each yield pin has a CONTROL on the same mount: the FAB is shown before the
 * occupant arrives and again after it leaves, so "invisible" cannot pass by
 * the FAB simply never rendering.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { InlineEditSaveBar } from '@object-ui/plugin-detail';
import { ConsoleChatbotFab } from '../ConsoleChatbotFab';
import { RecordAttachmentsPanel } from '../../views/RecordAttachmentsPanel';

type Box = { x: number; y: number; width: number; height: number };
const ZERO: Box = { x: 0, y: 0, width: 0, height: 0 };
const toRect = (b: Box) =>
  ({ ...b, left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height, toJSON: () => b }) as DOMRect;

/**
 * Install a geometry: `place(el)` answers the box for an element, or `null`
 * for "no box" (a zero rect). Returns a counter of how often each named
 * occupant was measured, so a "the FAB stays" pin can prove the FAB looked.
 */
function installGeometry(place: (el: Element) => { name: string; box: Box } | null) {
  const measured: Record<string, number> = {};
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const hit = place(this);
    if (!hit) return toRect(ZERO);
    measured[hit.name] = (measured[hit.name] ?? 0) + 1;
    return toRect(hit.box);
  });
  return measured;
}

const isFab = (el: Element) => el.getAttribute('data-testid') === 'console-chatbot-fab';
const isSaveBar = (el: Element) => el.getAttribute('role') === 'region';

/** Measured at 1440×900 (the FAB is `bottom-6 right-6`, 56px). */
const DESKTOP = {
  fab: { x: 1360, y: 820, width: 56, height: 56 },
  saveBar: { x: 280, y: 823, width: 1136, height: 53 },
};
/** Measured at 390×844: under `sm` the FAB sits at `bottom-20`, above the bar. */
const PHONE = {
  fab: { x: 310, y: 708, width: 56, height: 56 },
  saveBar: { x: 12, y: 779, width: 366, height: 53 },
};

function fab(): HTMLElement {
  return screen.getByTestId('console-chatbot-fab');
}

/** Opens and closes the shared inline-edit session the bar renders for. */
function EditTrigger() {
  const inline = useInlineEdit()!;
  return <button onClick={() => inline.enter('name')}>edit-enter</button>;
}

function mountRecordWithFab() {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <InlineEditProvider canEdit>
        <EditTrigger />
        <InlineEditSaveBar onFieldSave={vi.fn()} />
      </InlineEditProvider>
      <ConsoleChatbotFab appLabel="HotCRM" onOpenDock={() => {}} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the assistant FAB yields its corner (objectui#12248)', () => {
  it('THE DEFECT — while the inline-edit bar sits under it, the FAB is invisible; it returns when the bar leaves', async () => {
    const measured = installGeometry((el) =>
      isFab(el) ? { name: 'fab', box: DESKTOP.fab } : isSaveBar(el) ? { name: 'saveBar', box: DESKTOP.saveBar } : null,
    );
    mountRecordWithFab();

    // CONTROL: no session, no bar — the FAB is the launcher as before.
    await waitFor(() => expect(measured.fab ?? 0).toBeGreaterThan(0));
    expect(fab()).not.toHaveClass('invisible');

    fireEvent.click(screen.getByText('edit-enter'));
    await waitFor(() => expect(fab()).toHaveClass('invisible'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

    // CONTROL: the session ends, the bar unmounts, the corner is free again.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    await waitFor(() => expect(fab()).not.toHaveClass('invisible'));
  });

  it('positional, not presence — a bar on screen but clear of the FAB (the phone geometry) leaves it shown', async () => {
    const measured = installGeometry((el) =>
      isFab(el) ? { name: 'fab', box: PHONE.fab } : isSaveBar(el) ? { name: 'saveBar', box: PHONE.saveBar } : null,
    );
    mountRecordWithFab();
    fireEvent.click(screen.getByText('edit-enter'));

    // The FAB measured the bar (so "shown" is a verdict, not a missed check)…
    await waitFor(() => expect(measured.saveBar ?? 0).toBeGreaterThan(0));
    // …and found it clear of its box.
    expect(fab()).not.toHaveClass('invisible');
  });

  it("a row action scrolled into the corner (the attachments panel's last row at full scroll) hides the FAB; scrolling it out brings the FAB back", async () => {
    let atFullScroll = true;
    installGeometry((el) => {
      if (isFab(el)) return { name: 'fab', box: DESKTOP.fab };
      const label = el.getAttribute('aria-label');
      if (label !== 'Delete attachment' && label !== 'Download') return null;
      const lastRow = (el.closest('li')?.textContent ?? '').includes('invoice.pdf');
      // Measured at 1440×900, full scroll: the last row's Delete at x 1367,
      // y 831 (32px); its Download at x 1323, clear of the FAB's x 1360.
      const x = label === 'Delete attachment' ? 1367 : 1323;
      const y = lastRow ? (atFullScroll ? 831 : 500) : atFullScroll ? 774 : 443;
      return { name: label, box: { x, y, width: 32, height: 32 } };
    });
    const dataSource = {
      find: vi.fn(async () => [
        { id: 'a1', file_id: 'f1', file_name: 'contract.pdf' },
        { id: 'a2', file_id: 'f2', file_name: 'invoice.pdf' },
      ]),
      create: vi.fn(),
      delete: vi.fn(),
    };
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <div data-testid="record-scroller">
          <RecordAttachmentsPanel objectName="crm_case" recordId="c1" dataSource={dataSource} />
        </div>
        <ConsoleChatbotFab appLabel="HotCRM" onOpenDock={() => {}} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText('invoice.pdf')).toBeInTheDocument());
    await waitFor(() => expect(fab()).toHaveClass('invisible'));

    // The record page scrolls its own container, not the window; the FAB hears it.
    atFullScroll = false;
    fireEvent.scroll(screen.getByTestId('record-scroller'));
    await waitFor(() => expect(fab()).not.toHaveClass('invisible'));
  });
});
