/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A related list whose read FAILS says so (objectstack#26415).
 *
 * Both fetch paths used to log the failure and fall through to the ordinary
 * empty state, so a reader was told "No related records found" about a record
 * whose related rows the console simply could not read — and, once the stack
 * fold landed (#25895), that list also answered "empty" to its stack and was
 * folded into the stack's empty-lists line, out of sight.
 *
 * Pinned here: on the adapter path and on the legacy raw-URL path a failed
 * read draws one load-failed line on the list's card (the server's sentence
 * when it answered with one; the console's shared no-access wording for a
 * refused read, never the server's text), a Retry clears the failure and reads
 * again, and a failed list never answers "empty", so the fold leaves it in its
 * own row.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  RecordContextProvider,
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { RelatedList } from '../RelatedList';
// Registers `record:related_list`, the block the fold case mounts.
import '../index';

const EMPTY_TEXT = 'No related records found';
const FAILED_TITLE = 'Couldn’t load records';
const FORBIDDEN_TITLE = 'You don’t have access';
const FORBIDDEN_MESSAGE =
  'You don’t have permission to view these records. Contact your administrator if you think you should have access.';
const GENERIC_MESSAGE = 'Something went wrong while loading this data. Check your connection and try again.';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
  cleanup();
});

/** An error shaped the way `@objectstack/client` throws a server answer. */
const serverError = (httpStatus: number, message: string, code?: string) =>
  Object.assign(new Error(message), { httpStatus, code });

const failedLine = () => screen.queryByTestId('related-list-load-failed');

function renderAdapterList(find: ReturnType<typeof vi.fn>, onEmptyChange = vi.fn()) {
  render(
    <RelatedList
      title="Contacts"
      type="table"
      api="contact"
      objectName="contact"
      referenceField="account"
      parentId="ACC-1"
      columns={[{ accessorKey: 'name', header: 'Name' }]}
      dataSource={{ find } as any}
      onEmptyChange={onEmptyChange}
    />,
  );
  return { onEmptyChange };
}

describe('RelatedList — a failed read on the adapter path draws the load-failed state (objectstack#26415)', () => {
  it('a 5xx shows the load-failed line with the server sentence, not "no related records"', async () => {
    const find = vi.fn(async () => {
      throw serverError(500, 'The database did not answer in time.');
    });
    const { onEmptyChange } = renderAdapterList(find);

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toHaveAttribute('role', 'alert');
    expect(line).toHaveTextContent(FAILED_TITLE);
    expect(line).toHaveTextContent('The database did not answer in time.');
    expect(within(line).getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();

    // Never "empty" to the stack: the last answer is `false`, and `true` never went out.
    await waitFor(() => expect(onEmptyChange).toHaveBeenLastCalledWith(false));
    expect(onEmptyChange).not.toHaveBeenCalledWith(true);
  });

  it('a refused read (403) uses the shared no-access wording and never shows the server text', async () => {
    const find = vi.fn(async () => {
      throw serverError(403, '[Security] Access denied on contact.account', 'PERMISSION_DENIED');
    });
    renderAdapterList(find);

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toHaveAttribute('data-error-kind', 'forbidden');
    expect(line).toHaveTextContent(FORBIDDEN_TITLE);
    expect(line).toHaveTextContent(FORBIDDEN_MESSAGE);
    expect(line).not.toHaveTextContent('Access denied on contact.account');
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
  });

  it('a failure the server did not answer (no status) falls back to the generic sentence', async () => {
    const find = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderAdapterList(find);

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toHaveTextContent(FAILED_TITLE);
    expect(line).toHaveTextContent(GENERIC_MESSAGE);
    expect(line).not.toHaveTextContent('Failed to fetch');
  });

  it('Retry clears the failure and reads again', async () => {
    const find = vi
      .fn()
      .mockRejectedValueOnce(serverError(503, 'Service unavailable.'))
      .mockResolvedValue({ data: [{ id: 'c1', name: 'Ada' }] });
    const { onEmptyChange } = renderAdapterList(find);

    const line = await screen.findByTestId('related-list-load-failed');
    fireEvent.click(within(line).getByRole('button', { name: /Retry/ }));

    await screen.findByText('Ada');
    expect(failedLine()).toBeNull();
    expect(find).toHaveBeenCalledTimes(2);
    expect(onEmptyChange).toHaveBeenLastCalledWith(false);
  });

  it('CONTROL: a read that answers no rows still draws the empty state', async () => {
    const find = vi.fn(async () => ({ data: [] }));
    const { onEmptyChange } = renderAdapterList(find);

    await screen.findByText(EMPTY_TEXT);
    expect(failedLine()).toBeNull();
    await waitFor(() => expect(onEmptyChange).toHaveBeenLastCalledWith(true));
  });
});

describe('RelatedList — a failed read on the legacy raw-URL path draws the load-failed state (objectstack#26415)', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** No `dataSource`: the raw-URL `fetch` is the only channel. */
  const renderLegacyList = (onEmptyChange = vi.fn()) => {
    render(
      <RelatedList
        title="Contacts"
        type="table"
        api="/api/contact"
        referenceField="account"
        parentId="ACC-1"
        columns={[{ accessorKey: 'name', header: 'Name' }]}
        onEmptyChange={onEmptyChange}
      />,
    );
    return { onEmptyChange };
  };

  const answer = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it('a non-2xx answer shows the load-failed line with the server sentence, not "no related records"', async () => {
    fetchMock.mockResolvedValue(answer(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'The read timed out.' } }));
    const { onEmptyChange } = renderLegacyList();

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toHaveTextContent(FAILED_TITLE);
    expect(line).toHaveTextContent('The read timed out.');
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
    await waitFor(() => expect(onEmptyChange).toHaveBeenLastCalledWith(false));
    expect(onEmptyChange).not.toHaveBeenCalledWith(true);
  });

  it('a refused read (403) uses the shared no-access wording', async () => {
    fetchMock.mockResolvedValue(answer(403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'Denied on contact' } }));
    renderLegacyList();

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toHaveAttribute('data-error-kind', 'forbidden');
    expect(line).toHaveTextContent(FORBIDDEN_MESSAGE);
    expect(line).not.toHaveTextContent('Denied on contact');
  });

  it('a network failure shows the load-failed line with the generic sentence', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderLegacyList();

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toHaveTextContent(GENERIC_MESSAGE);
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
  });

  it('Retry clears the failure and reads again', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(503, { error: 'Try again shortly.' }))
      .mockResolvedValue(answer(200, [{ id: 'c1', name: 'Ada' }]));
    renderLegacyList();

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toHaveTextContent('Try again shortly.');
    fireEvent.click(within(line).getByRole('button', { name: /Retry/ }));

    await screen.findByText('Ada');
    expect(failedLine()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('record:related_list — a failed list keeps its own row in the stack fold (objectstack#26415, #25895)', () => {
  const PARENT = 'crm_account';
  const list = (objectName: string, title: string) => ({
    type: 'record:related_list',
    properties: { objectName, title, relationshipField: 'account_id', columns: ['name'] },
  });

  it('the failed list is not folded; the genuinely empty one still is', async () => {
    const rows: Record<string, Array<Record<string, unknown>>> = {
      crm_contact: [{ id: 'c1', name: 'Ada', account_id: 'a1' }],
    };
    const ds = {
      find: vi.fn(async (object: string) => {
        if (object === 'crm_quote') throw serverError(500, 'Quotes are unavailable right now.');
        const data = rows[object] ?? [];
        return { data, total: data.length };
      }),
      getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
      onMutation: () => () => {},
    };
    const host: RelatedRecordActionsValue = { resolve: () => ({ onCreate: () => {} }) };
    render(
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <RecordContextProvider objectName={PARENT} recordId="a1" dataSource={ds as never}>
          <RelatedRecordActionsProvider value={host}>
            <div data-testid="stack">
              {[list('crm_contact', 'Contacts'), list('crm_quote', 'Quotes'), list('crm_lead', 'Leads')].map((node, idx) => (
                <SchemaRenderer key={idx} schema={node as never} />
              ))}
            </div>
          </RelatedRecordActionsProvider>
        </RecordContextProvider>
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(3));
    await screen.findByText('Ada');
    const fold = await screen.findByTestId('record-related-list-empty-fold');
    const named = within(fold).getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(named).toEqual(['Leads']);

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toBeVisible();
    expect(line).toHaveTextContent('Quotes are unavailable right now.');
    const quotesTitle = screen.getAllByText('Quotes').find((el) => !fold.contains(el));
    expect(quotesTitle).toBeVisible();
  });
});

/*
 * A refused read is not a failure of anything the reader did. The line for a
 * 403 is neutral (`role="status"`, no destructive styling), offers no Retry (a
 * grant only an administrator can give does not change on a retry), and says
 * the list's no-access sentence even when the producer marked the generic
 * action refusal as the `userMessage`. The 5xx case above is the control for
 * the destructive styling and the Retry.
 */
describe('RelatedList — a refused read is a neutral no-access line, not a failure', () => {
  /** The 403 the server answers a refused read: the generic action refusal marked for the reader. */
  const ACTION_REFUSAL =
    'You do not have permission to perform this action. Contact your administrator if you need access.';
  const refused = () =>
    Object.assign(serverError(403, '[Security] Access denied on invoice_line.invoice', 'PERMISSION_DENIED'), {
      userMessage: ACTION_REFUSAL,
    });

  it('draws a neutral status line with the no-access sentence and no Retry', async () => {
    const find = vi.fn(async () => {
      throw refused();
    });
    renderAdapterList(find);

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toHaveAttribute('data-error-kind', 'forbidden');
    expect(line).toHaveAttribute('role', 'status');
    expect(line.className).not.toMatch(/destructive/);
    expect(line.querySelector('svg')!.getAttribute('class')).not.toMatch(/destructive/);
    expect(line).toHaveTextContent(FORBIDDEN_TITLE);
    expect(line).toHaveTextContent(FORBIDDEN_MESSAGE);
    expect(line).not.toHaveTextContent('perform this action');
    expect(within(line).queryByRole('button', { name: /Retry/ })).toBeNull();
  });

  it('CONTROL: a 5xx keeps the alert styling and the Retry', async () => {
    const find = vi.fn(async () => {
      throw serverError(500, 'The database did not answer in time.');
    });
    renderAdapterList(find);

    const line = await screen.findByTestId('related-list-load-failed');
    expect(line).toHaveAttribute('role', 'alert');
    expect(line.className).toMatch(/destructive/);
    expect(within(line).getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('CONTROL: a readable related list draws its rows', async () => {
    const find = vi.fn(async () => ({ data: [{ id: 'l1', name: 'Consulting hours' }] }));
    renderAdapterList(find);

    await screen.findByText('Consulting hours');
    expect(failedLine()).toBeNull();
  });
});
