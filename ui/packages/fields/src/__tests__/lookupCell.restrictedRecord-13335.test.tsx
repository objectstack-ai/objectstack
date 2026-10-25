/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13335 — a lookup whose referenced record the viewer may not read
 * printed the raw id beside a question mark ("CTPnPnOW17jcvcy-"). The record
 * GET answers 404 for that viewer, which the ObjectStack adapter turns into
 * `findOne` → `null`, the `DataSource` contract's "not found".
 *
 * That ONE settled answer now draws "Restricted record": no id, no link, and
 * no second read. Everything else keeps today's face, and the controls below
 * say so: a readable record (named, linked), the first paint while the read
 * is in flight, a read that threw, the array entries never asked, and an empty
 * value. The module-level lookup cache is keyed by object and id, so every
 * case uses its own id.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { SchemaRendererProvider, RelatedRecordActionsProvider } from '@object-ui/react';
import { getCellRenderer } from '../index';

afterEach(() => cleanup());

const OBJECT = 'kb_case_13335';
const READABLE = { id: 'CASE-READABLE-01', name: 'Printer jam' };

/** `findOne` answers like the adapter: the readable record, or `null` (a 404) for anything else. */
function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    findOne: vi.fn(async (_object: string, id: string) => (id === READABLE.id ? READABLE : null)),
    find: vi.fn(),
    ...overrides,
  } as any;
}

const hostLinks = {
  resolve: () => ({}),
  recordHref: (objectName: string, recordId: string | number) => `/o/${objectName}/r/${recordId}`,
  openRecord: vi.fn(),
} as any;

function renderLookup(value: unknown, ds: any, opts: { language?: string } = {}) {
  const Renderer = getCellRenderer('lookup');
  const cell = (
    <SchemaRendererProvider dataSource={ds}>
      <RelatedRecordActionsProvider value={hostLinks}>
        <Renderer value={value as any} field={{ type: 'lookup', name: 'source_case', reference: OBJECT } as any} />
      </RelatedRecordActionsProvider>
    </SchemaRendererProvider>
  );
  return render(
    opts.language === undefined ? (
      cell
    ) : (
      <I18nProvider config={{ defaultLanguage: opts.language, detectBrowserLanguage: false }}>{cell}</I18nProvider>
    ),
  );
}

const restricted = (root: HTMLElement) => root.querySelectorAll('[data-slot="restricted-reference"]');
const unresolved = (root: HTMLElement) => root.querySelectorAll('[data-slot="unresolved-reference"]');

describe('objectui#13335 — a lookup the reader\'s read answers "not found" for', () => {
  it('shows "Restricted record", with no id and no link, and reads the record once', async () => {
    const id = 'CTPnPnOW17jcvcy-';
    const ds = makeDataSource();
    const { container } = renderLookup(id, ds);

    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(container.textContent).toBe('Restricted record');
    expect(container.innerHTML, 'the id is gone from text and from every attribute').not.toContain(id);
    expect(container.querySelector('a'), 'no link to a page that answers 404').toBeNull();
    expect(unresolved(container), 'not the unresolved face as well').toHaveLength(0);
    // ⛔ No title fetch around the reader's authority: the one read is the reader's own.
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(ds.findOne).toHaveBeenCalledWith(OBJECT, id);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('the label is the `en` pack value when no provider is mounted', async () => {
    const { container } = renderLookup('CASE-RESTRICTED-EN', makeDataSource());
    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(container.textContent).toBe((en as any).detail.restrictedLookupReference);
  });

  it('the label is translated', async () => {
    const { container } = renderLookup('CASE-RESTRICTED-ZH', makeDataSource(), { language: 'zh' });
    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(container.textContent).toBe((zh as any).detail.restrictedLookupReference);
    expect(container.textContent).not.toBe((en as any).detail.restrictedLookupReference);
  });

  it('a data source without `findOne` that finds no row gets the same face', async () => {
    const id = 'CASE-RESTRICTED-FIND';
    const ds = { find: vi.fn(async () => ({ data: [] })) } as any;
    const { container } = renderLookup(id, ds);
    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(container.innerHTML).not.toContain(id);
  });

  it('in a multi-value cell, only the entry that was read and not found is restricted', async () => {
    const first = 'CASE-RESTRICTED-ARR-1';
    const second = 'CASE-NEVER-ASKED-ARR-2';
    const { container } = renderLookup([first, second], makeDataSource());

    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(container.innerHTML).not.toContain(first);
    // Entries after the first are never read, so nothing is known about them.
    expect(unresolved(container)).toHaveLength(1);
    expect(unresolved(container)[0]!.textContent).toBe(second);
    expect(restricted(container)[0]!.closest('a'), 'the restricted chip is not a link').toBeNull();
  });
});

describe('objectui#13335 — CONTROLS: every other state renders as before', () => {
  it('a readable lookup renders its name, linked, unmarked', async () => {
    const { container } = renderLookup(READABLE.id, makeDataSource());
    await waitFor(() => expect(screen.getByText('Printer jam')).toBeInTheDocument());
    expect(restricted(container)).toHaveLength(0);
    expect(unresolved(container)).toHaveLength(0);
    expect(container.querySelector('a')).toHaveAttribute('href', `/o/${OBJECT}/r/${READABLE.id}`);
  });

  it('while the read is in flight, the cell keeps the unresolved face, not the restricted one', async () => {
    const id = 'CASE-IN-FLIGHT';
    let answer!: (v: null) => void;
    const ds = makeDataSource({
      findOne: vi.fn(() => new Promise<null>((resolve) => { answer = resolve; })),
    });
    const { container } = renderLookup(id, ds);

    expect(unresolved(container)).toHaveLength(1);
    expect(restricted(container)).toHaveLength(0);
    // The control: the same cell turns restricted once that read settles empty.
    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    answer(null);
    await waitFor(() => expect(restricted(container)).toHaveLength(1));
  });

  it('a read that THREW keeps the unresolved face and its id — a failure is not a "not found"', async () => {
    const id = 'CASE-READ-THREW';
    const ds = makeDataSource({ findOne: vi.fn(async () => { throw new Error('500'); }) });
    const { container } = renderLookup(id, ds);
    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(restricted(container)).toHaveLength(0);
    expect(unresolved(container)).toHaveLength(1);
    expect(container.textContent).toBe(id);
  });

  it('an empty value keeps `EmptyValue` and reads nothing', () => {
    const ds = makeDataSource();
    const { container } = renderLookup(null, ds);
    expect(container.querySelector('[data-slot="empty-value"]')).not.toBeNull();
    expect(restricted(container)).toHaveLength(0);
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});
