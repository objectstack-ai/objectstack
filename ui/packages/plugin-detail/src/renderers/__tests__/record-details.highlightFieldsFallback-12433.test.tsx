/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details` with neither `sections` nor `fields` draws the object's
 * `highlightFields` (objectui#12433).
 *
 * The declaration is `@objectstack/spec`'s, on the retired `layout` entry of
 * `RecordDetailsProps`: "`sections` renders the explicit groups (the old
 * `custom`), and omitting it falls back to the object's `highlightFields` (the
 * old `auto`)". Its `fields` describe says the same from the other side
 * ("overrides highlightFields"), and this package's own registry `inputs`
 * publish both sentences. The renderer honoured neither: with no `sections`
 * and no `fields` it handed `DetailView` an empty body, so a bare node drew
 * nothing. objectstack's served `sys_approval_request_detail` page is such a
 * node, so every approver saw an empty Details tab.
 *
 * What the fallback is, and what it is not:
 *
 * - It is the object's `highlightFields`, as declared and in declared order,
 *   and nothing else. An object that declares none draws what it drew before:
 *   an empty body. The spec names no further fallback, so none is invented.
 * - It runs only when the author wrote neither key. An authored `sections` or
 *   `fields` (even an empty one) is the body, as before.
 * - The list takes the path an authored `fields` list takes: the
 *   field-security fold (`enforceFieldSecurity` / `redactFields`), the label
 *   ladder, and the dedupe against the mounted `record:highlights` strip and
 *   the page H1. A list the fold empties stays empty; it is never re-derived.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { HighlightFieldsProvider, RecordContextProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import {
  getCellRenderer,
  registerFieldRenderer,
  RECORD_POINTER_CARD_TYPE,
  type CellRendererProps,
} from '@object-ui/fields';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { RecordDetailsRenderer } from '../record-details';
import { RecordHighlightsRenderer } from '../record-highlights';

const OBJECT = 'crm_account';

const ACCOUNT = {
  name: OBJECT,
  label: 'Account',
  nameField: 'name',
  highlightFields: ['name', 'industry', 'region', 'tier'],
  fields: {
    name: { type: 'text', label: 'Name' },
    industry: { type: 'text', label: 'Industry' },
    region: { type: 'text', label: 'Region' },
    tier: { type: 'text', label: 'Tier' },
    notes: { type: 'text', label: 'Notes' },
    website: { type: 'text', label: 'Website' },
  },
};

/** Distinct values, so a row is read off the screen by what it paints. */
const RECORD = {
  id: 'A1',
  name: 'Acme',
  industry: 'industry-value',
  region: 'region-value',
  tier: 'tier-value',
  notes: 'notes-value',
  website: 'website-value',
};

const HIGHLIGHT_VALUES = ['industry-value', 'region-value', 'tier-value'];
const OTHER_VALUES = ['notes-value', 'website-value'];

const roles: RoleDefinition[] = [{ name: 'restricted', label: 'Restricted' }];

/** `read` on the object, and `read` on every field EXCEPT the ones named. */
function permsDenying(object: string, ...deniedFields: string[]): ObjectPermissionConfig[] {
  return [
    {
      object,
      roles: {
        restricted: {
          actions: ['read'],
          fieldPermissions: deniedFields.map((field) => ({ field, read: false })),
        },
      },
    },
  ];
}

interface PageOptions {
  objectName?: string;
  objectSchema?: Record<string, unknown>;
  data?: Record<string, unknown>;
  details?: Record<string, unknown>;
  /** A `record:highlights` node mounted beside the body, as a record page mounts one. */
  strip?: Record<string, unknown>;
  wrap?: (node: React.ReactNode) => React.ReactElement;
}

/**
 * The record page as far as these two blocks read it: one record context, the
 * page's highlight registry, the strip (when given) and the body, each in its
 * own region so a value is attributed to the block that painted it.
 */
function renderPage({
  objectName = OBJECT,
  objectSchema = ACCOUNT,
  data = RECORD,
  details = {},
  strip,
  wrap,
}: PageOptions = {}) {
  // The page's adapter, as far as `DetailView` reads it: the object
  // definition it resolves field types from (a `referenceVia` pointer among
  // them). The record itself is the context's, so no record read is served.
  const dataSource = { getObjectSchema: async () => objectSchema };
  const node = (
    <RecordContextProvider
      objectName={objectName}
      recordId={String(data.id)}
      data={data}
      objectSchema={objectSchema}
      dataSource={dataSource as never}
    >
      <HighlightFieldsProvider>
        {strip && (
          <div data-testid="strip">
            <RecordHighlightsRenderer schema={strip as never} />
          </div>
        )}
        <div data-testid="body">
          <RecordDetailsRenderer schema={details as never} />
        </div>
      </HighlightFieldsProvider>
    </RecordContextProvider>
  );
  return render(wrap ? wrap(node) : node);
}

const body = () => within(screen.getByTestId('body'));
const bodyText = () => screen.getByTestId('body').textContent ?? '';

beforeAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }));

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain`; serve it from a
  // double so no real socket opens. Its answer is orthogonal to which fields
  // the body draws.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('record:details with no sections and no fields draws the object highlightFields (objectui#12433)', () => {
  it('a bare node draws the highlightFields, in declared order, with their declared labels', () => {
    renderPage();

    for (const value of HIGHLIGHT_VALUES) expect(body().getByText(value)).toBeInTheDocument();
    // Only the declared list: fields outside it are not drawn.
    for (const value of OTHER_VALUES) expect(body().queryByText(value)).not.toBeInTheDocument();
    // Rung 2 of the label ladder reaches the fallback list as it reaches an
    // authored one: the object's declared label, not the machine name.
    expect(body().getByText('Industry')).toBeInTheDocument();

    const [industry, region, tier] = HIGHLIGHT_VALUES.map((value) => body().getByText(value));
    expect(industry.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(tier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the page H1 dedupe applies to the fallback list: the declared name field is not repeated', () => {
    renderPage();
    expect(body().getByText('industry-value')).toBeInTheDocument(); // LIVE CONTROL
    expect(body().queryByText('Acme')).not.toBeInTheDocument();
  });

  it('with a record:highlights strip mounted, the fields it shows are not repeated in the body', async () => {
    renderPage({ strip: { fields: ['industry', 'region'] } });

    const strip = within(screen.getByTestId('strip'));
    expect(strip.getByText('industry-value')).toBeInTheDocument();
    expect(strip.getByText('region-value')).toBeInTheDocument();

    await waitFor(() => expect(body().queryByText('industry-value')).not.toBeInTheDocument());
    expect(body().queryByText('region-value')).not.toBeInTheDocument();
    expect(body().getByText('tier-value')).toBeInTheDocument(); // what the strip does not show
  });
});

describe('CONTROL: an authored body is the body, and the fallback does not run (objectui#12433)', () => {
  it('authored sections render exactly their fields, and no highlight field joins them', () => {
    renderPage({ details: { sections: [{ label: 'Main', fields: ['notes', 'website'] }] } });

    expect(body().getByText('Main')).toBeInTheDocument();
    for (const value of OTHER_VALUES) expect(body().getByText(value)).toBeInTheDocument();
    for (const value of HIGHLIGHT_VALUES) expect(body().queryByText(value)).not.toBeInTheDocument();
  });

  it('an authored fields list overrides highlightFields', () => {
    renderPage({ details: { fields: ['website'] } });

    expect(body().getByText('website-value')).toBeInTheDocument();
    for (const value of [...HIGHLIGHT_VALUES, 'notes-value']) {
      expect(body().queryByText(value)).not.toBeInTheDocument();
    }
  });

  it('an authored EMPTY list is authored: it is not read as omission', () => {
    renderPage({ details: { fields: [] } });
    expect(bodyText()).toBe('');
    cleanup();
    renderPage({ details: { sections: [] } });
    expect(bodyText()).toBe('');
  });
});

describe('the fallback list goes through the field-security fold (objectui#12433)', () => {
  // Two layers drop this row: the block's own fold and `DetailView`'s
  // field-read gate, which runs whenever a permission provider is loaded. So
  // this case holds the outcome, and the redact case below is the one that
  // fails if the fallback list skips the block's fold.
  it('a highlight field the caller may not read is not drawn (enforceFieldSecurity)', () => {
    renderPage({
      details: { enforceFieldSecurity: true },
      wrap: (node) => (
        <PermissionProvider roles={roles} permissions={permsDenying(OBJECT, 'region')} userRoles={['restricted']}>
          {node}
        </PermissionProvider>
      ),
    });

    expect(body().getByText('industry-value')).toBeInTheDocument(); // LIVE CONTROL
    expect(body().getByText('tier-value')).toBeInTheDocument();
    expect(body().queryByText('region-value')).not.toBeInTheDocument();
  });

  it('a redacted highlight field is not drawn (redactFields)', () => {
    renderPage({ details: { redactFields: ['tier'] } });

    expect(body().getByText('industry-value')).toBeInTheDocument(); // LIVE CONTROL
    expect(body().queryByText('tier-value')).not.toBeInTheDocument();
  });

  it('a list the fold empties stays empty: nothing is derived in its place', () => {
    renderPage({ details: { redactFields: ['name', 'industry', 'region', 'tier'] } });

    expect(bodyText()).toBe('');
    for (const value of OTHER_VALUES) expect(body().queryByText(value)).not.toBeInTheDocument();
  });
});

describe('an object that declares no highlightFields keeps the output it had (objectui#12433)', () => {
  it('the body stays empty: the spec names no further fallback, so none is invented', () => {
    const { highlightFields: _omitted, ...withoutHighlights } = ACCOUNT;
    renderPage({ objectSchema: withoutHighlights });

    expect(bodyText()).toBe('');
  });

  it('LIT CONTROL: the same object with highlightFields paints a body in the same harness', () => {
    renderPage();
    expect(bodyText()).not.toBe('');
  });
});

/**
 * objectstack's served `sys_approval_request_detail`, the slots that draw
 * fields: the strip (the object's `highlightFields` without `record_id`) and
 * the Details tab's bare `record:details`. The object is the served
 * `sys_approval_request`'s field list, abridged to the fields this shape reads
 * plus the two raw JSON columns the card warns must not reach an approver.
 */
const APPROVAL_REQUEST = 'sys_approval_request';
const REQUEST_DEF = {
  name: APPROVAL_REQUEST,
  label: 'Approval Request',
  nameField: 'display_title',
  titleFormat: '{process_name} · {record_id}',
  highlightFields: ['process_name', 'object_name', 'record_id', 'status', 'current_step', 'submitter_id', 'updated_at'],
  fields: {
    id: { label: 'Request ID', type: 'text', readonly: true, group: 'System' },
    display_title: { label: 'Title', type: 'formula', returnType: 'text', group: 'Target' },
    process_name: { label: 'Source', type: 'text', group: 'Target' },
    object_name: { label: 'Object', type: 'text', group: 'Target' },
    record_id: { label: 'Record ID', type: 'text', referenceVia: 'object_name', group: 'Target' },
    submitter_id: { label: 'Submitter', type: 'text', group: 'Target' },
    submitter_comment: { label: 'Submitter Comment', type: 'textarea', group: 'Target' },
    status: { label: 'Status', type: 'text', group: 'State' },
    current_step: { label: 'Current Step', type: 'text', group: 'State' },
    payload_json: { label: 'Payload', type: 'textarea', group: 'State' },
    node_config_json: { label: 'Node Config', type: 'textarea', group: 'State' },
    updated_at: { label: 'Updated At', type: 'text', group: 'System' },
  },
};
const REQUEST_ROW = {
  id: 'req_12433',
  display_title: 'invoice_approval · inv_1',
  process_name: 'invoice_approval',
  object_name: 'invoice',
  record_id: 'inv_1',
  submitter_id: 'submitter-value',
  submitter_comment: 'comment-value',
  status: 'pending',
  current_step: 'manager_review',
  payload_json: '{"amount":4200}',
  node_config_json: '{"approvers":["u3"]}',
  updated_at: 'updated-value',
};
/** The served page's strip, verbatim. */
const SERVED_STRIP = { fields: ['process_name', 'object_name', 'status', 'current_step', 'submitter_id', 'updated_at'] };

const DEFAULT_POINTER_FACE = getCellRenderer(RECORD_POINTER_CARD_TYPE);

/** A face that prints the pair it was handed, standing in for the host's record card. */
const ProbeFace: React.FC<CellRendererProps> = ({ value }) => (
  <span data-testid="pointer-probe">{JSON.stringify(value)}</span>
);

describe("the served sys_approval_request_detail Details tab (objectui#12433)", () => {
  afterEach(() => registerFieldRenderer(RECORD_POINTER_CARD_TYPE, DEFAULT_POINTER_FACE));

  it('draws exactly the record_id pointer the strip leaves to it, as the target-record pair', async () => {
    registerFieldRenderer(RECORD_POINTER_CARD_TYPE, ProbeFace);
    renderPage({
      objectName: APPROVAL_REQUEST,
      objectSchema: REQUEST_DEF,
      data: REQUEST_ROW,
      strip: SERVED_STRIP,
    });

    const probes = await body().findAllByTestId('pointer-probe');
    expect(probes).toHaveLength(1);
    expect(JSON.parse(probes[0].textContent ?? 'null')).toEqual({ objectName: 'invoice', recordId: 'inv_1' });

    // The strip's six fields are drawn by the strip and not again by the body.
    await waitFor(() => expect(body().queryByText('submitter-value')).not.toBeInTheDocument());
    for (const value of ['invoice_approval', 'pending', 'manager_review', 'updated-value']) {
      expect(body().queryByText(value)).not.toBeInTheDocument();
    }
    expect(within(screen.getByTestId('strip')).getByText('manager_review')).toBeInTheDocument();
  });

  it('draws no request field outside the highlightFields: the raw JSON columns never reach the approver', async () => {
    renderPage({
      objectName: APPROVAL_REQUEST,
      objectSchema: REQUEST_DEF,
      data: REQUEST_ROW,
      strip: SERVED_STRIP,
    });

    // Settled: the strip has registered its fields, and the body is live.
    // Without a host face the pointer draws the record id as text.
    await waitFor(() => expect(body().queryByText('submitter-value')).not.toBeInTheDocument());
    await waitFor(() => expect(bodyText()).toContain('inv_1'));
    for (const value of ['{"amount":4200}', '{"approvers":["u3"]}', 'comment-value', 'invoice_approval · inv_1']) {
      expect(body().queryByText(value)).not.toBeInTheDocument();
    }
    expect(bodyText()).not.toContain('amount');
    expect(bodyText()).not.toContain('approvers');
  });
});
