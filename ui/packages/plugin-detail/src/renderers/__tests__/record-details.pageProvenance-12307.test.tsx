/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The provenance footer is the record PAGE's, not each `record:details`
 * node's (objectui#12307).
 *
 * Every `DetailView` used to mount its own `<RecordMetaFooter>`, and a record
 * page renders one `DetailView` per `record:details` node. So a page with two
 * nodes printed the same "Created … Updated …" line twice, and a node whose
 * sections were all hidden drew a block holding that line and nothing else.
 * The page host now draws the line once (app-shell's `RecordDetailView`, pinned
 * beside it), and the `DetailView` a `record:details` mounts for the page's
 * record draws none.
 *
 * This file pins the renderer's half:
 *
 *  1. a `record:details` that reads the page's record (no `dataSource`
 *     binding) draws no footer of its own, however many sit on the page;
 *  2. a node whose sections are all hidden draws nothing at all;
 *  3. a standalone `DetailView` (no record page around it) keeps its footer;
 *  4. a BOUND `record:details` on a record page keeps its footer: it shows a
 *     record the page does not, so the page's footer is not its record's.
 *
 * Every absence below sits beside a control that proves the same render would
 * have drawn the thing it asserts is absent.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordContextProvider, SchemaRendererProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';
import { DetailView } from '../../DetailView';

/** `useRecordEditable`'s explain probe, answered with its fail-open 501 (the binding suites do the same). */
vi.stubGlobal('fetch', (async () => new Response(null, { status: 501 })) as unknown as typeof globalThis.fetch);

const PAGE_OBJECT = 'crm_account';
const BOUND_OBJECT = 'sys_environment';

const SCHEMAS: Record<string, unknown> = {
  [PAGE_OBJECT]: {
    name: PAGE_OBJECT,
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      region: { name: 'region', type: 'text', label: 'Region' },
      rank: { name: 'rank', type: 'text', label: 'Rank' },
      notes: { name: 'notes', type: 'text', label: 'Notes' },
      phase: { name: 'phase', type: 'text', label: 'Phase' },
    },
  },
  [BOUND_OBJECT]: {
    name: BOUND_OBJECT,
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      region: { name: 'region', type: 'text', label: 'Region' },
    },
  },
};

/**
 * Audit TIMESTAMPS only, no actor: the footer draws its "Created" / "Updated"
 * segments from the dates alone, so no user reference has to resolve and the
 * count below measures the footer, not a lookup cell. More than two seconds
 * apart, so the "Updated" segment is not folded into "Created".
 */
const PAGE_RECORD = {
  id: 'acc-1',
  name: 'Page account',
  region: 'Page region',
  rank: 'Gold',
  created_at: '2026-01-02T03:04:05.000Z',
  updated_at: '2026-02-03T04:05:06.000Z',
};
const BOUND_ROW = {
  id: 'env-1',
  name: 'Bound env',
  region: 'Bound region',
  created_at: '2025-05-06T07:08:09.000Z',
};

function makeAdapter() {
  return {
    find: vi.fn(async (object: string) => ({
      data: object === BOUND_OBJECT ? [{ ...BOUND_ROW }] : [],
      total: object === BOUND_OBJECT ? 1 : 0,
    })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => true),
    getObjectSchema: vi.fn(async (object: string) => SCHEMAS[object]),
  };
}

/** The record page's record context — what a record page host mounts once. */
function RecordPage({ children, adapter = makeAdapter() }: { children: React.ReactNode; adapter?: ReturnType<typeof makeAdapter> }) {
  return (
    <SchemaRendererProvider dataSource={adapter as any}>
      <RecordContextProvider
        objectName={PAGE_OBJECT}
        recordId={PAGE_RECORD.id}
        data={PAGE_RECORD}
        objectSchema={SCHEMAS[PAGE_OBJECT]}
        dataSource={adapter as any}
      >
        {children}
      </RecordContextProvider>
    </SchemaRendererProvider>
  );
}

const footersIn = (root: ParentNode) => root.querySelectorAll('[data-testid="record-meta-footer"]');

afterEach(() => cleanup());

describe('a record:details that reads the page record draws no footer of its own (objectui#12307)', () => {
  it('two nodes on one record page draw none — the page host draws the one', async () => {
    render(
      <RecordPage>
        <div data-testid="top-line">
          <RecordDetailsRenderer schema={{ fields: ['region'] } as any} />
        </div>
        <div data-testid="body">
          <RecordDetailsRenderer schema={{ fields: ['rank'] } as any} />
        </div>
      </RecordPage>,
    );
    // Control: both nodes rendered their record body, so the absence below is
    // not a render that drew nothing.
    expect(await within(screen.getByTestId('top-line')).findByText('Page region')).toBeInTheDocument();
    expect(await within(screen.getByTestId('body')).findByText('Gold')).toBeInTheDocument();

    expect(footersIn(document.body)).toHaveLength(0);
  });

  it('a node whose sections are all hidden draws nothing at all', async () => {
    render(
      <RecordPage>
        <div data-testid="shown">
          <RecordDetailsRenderer schema={{ sections: [{ label: 'Profile', fields: ['region'] }] } as any} />
        </div>
        <div data-testid="all-hidden">
          {/* Both fields are empty on the record, so the authored section
              hides by the renderer's default — the card's measured shape. */}
          <RecordDetailsRenderer schema={{ sections: [{ label: 'Extras', fields: ['notes', 'phase'] }] } as any} />
        </div>
      </RecordPage>,
    );
    // Control: the sibling node, same page, same record, draws its section.
    expect(await within(screen.getByTestId('shown')).findByText('Page region')).toBeInTheDocument();

    const hidden = screen.getByTestId('all-hidden');
    expect(hidden.textContent).toBe('');
    expect(within(hidden).queryByText('Extras')).not.toBeInTheDocument();
    expect(footersIn(hidden)).toHaveLength(0);
    // No frame either: nothing in the node carries a border, a shadow or a card.
    expect(hidden.querySelector('[class*="border"], [class*="shadow"], [data-slot="card"]')).toBeNull();
  });
});

describe('a DetailView no record page draws for keeps its footer (objectui#12307)', () => {
  it('a standalone DetailView draws its own footer', async () => {
    render(
      <DetailView
        schema={{
          type: 'detail-view',
          objectName: PAGE_OBJECT,
          data: PAGE_RECORD,
          fields: [{ name: 'region', label: 'Region' }],
          showHeader: false,
        } as any}
      />,
    );
    expect(await screen.findByText('Page region')).toBeInTheDocument();
    expect(footersIn(document.body)).toHaveLength(1);
  });

  it('a BOUND record:details on a record page keeps its own — it shows a record the page does not', async () => {
    render(
      <RecordPage>
        <div data-testid="page-details">
          <RecordDetailsRenderer schema={{ fields: ['region'] } as any} />
        </div>
        <div data-testid="bound-details">
          <RecordDetailsRenderer schema={{ fields: ['region'], dataSource: { object: BOUND_OBJECT, limit: 1 } } as any} />
        </div>
      </RecordPage>,
    );
    const page = screen.getByTestId('page-details');
    const bound = screen.getByTestId('bound-details');
    expect(await within(page).findByText('Page region')).toBeInTheDocument();
    expect(await within(bound).findByText('Bound region')).toBeInTheDocument();

    await waitFor(() => expect(footersIn(bound)).toHaveLength(1));
    expect(footersIn(page)).toHaveLength(0);
  });
});
