/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details` folds a declared pointer pair's type half into its id
 * half's card (objectui#13102).
 *
 * The id half (`record_id`) names its sibling with `referenceVia`
 * (`object_name`); `DetailSection` draws the id half as the record card, which
 * names the target object by its label. The type half used to draw again as a
 * row of its own, the stored machine name beside that card. It now leaves the
 * body when its id half is drawn in the same body.
 *
 * Pinned both ways:
 * - an object that declares a pair: the card draws, the type half's row does
 *   not, and the card still resolves the pair from the row's type half;
 * - controls: an object with no pair draws every listed field as before, and a
 *   text field called `object_name` that no field names in `referenceVia`
 *   still draws. The fold reads the declared pair, never a field name.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { HighlightFieldsProvider, RecordContextProvider } from '@object-ui/react';
import {
  getCellRenderer,
  registerFieldRenderer,
  RECORD_POINTER_CARD_TYPE,
  type CellRendererProps,
} from '@object-ui/fields';
import { RecordDetailsRenderer } from '../record-details';

const SHARE = 'sys_record_share';

/** An object declaring one pointer pair, as objectstack's sharing objects do. */
const SHARE_DEF = {
  name: SHARE,
  label: 'Record Share',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    object_name: { type: 'text', label: 'Target Object Type' },
    record_id: { type: 'text', label: 'Shared Record', referenceVia: 'object_name' },
    access_level: { type: 'text', label: 'Access Level' },
  },
};

const SHARE_ROW = {
  id: 'shr_1',
  name: 'Share one',
  object_name: 'invoice',
  record_id: 'inv_1',
  access_level: 'access-value',
};

/**
 * The same field names, and no field declaring `referenceVia`. Both objects
 * declare a `nameField`, so the page-H1 dedupe takes `name` and no field this
 * file reads.
 */
const PLAIN_DEF = {
  name: 'plain_log',
  label: 'Plain Log',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    object_name: { type: 'text', label: 'Target Object Type' },
    record_id: { type: 'text', label: 'Shared Record' },
    access_level: { type: 'text', label: 'Access Level' },
  },
};

const ALL_FIELDS = ['object_name', 'record_id', 'access_level'];

function renderBody(objectSchema: Record<string, unknown>, data: Record<string, unknown>, details: Record<string, unknown>) {
  const dataSource = { getObjectSchema: async () => objectSchema };
  return render(
    <RecordContextProvider
      objectName={String(objectSchema.name)}
      recordId={String(data.id)}
      data={data}
      objectSchema={objectSchema}
      dataSource={dataSource as never}
    >
      <HighlightFieldsProvider>
        <div data-testid="body">
          <RecordDetailsRenderer schema={details as never} />
        </div>
      </HighlightFieldsProvider>
    </RecordContextProvider>,
  );
}

const body = () => within(screen.getByTestId('body'));

const DEFAULT_POINTER_FACE = getCellRenderer(RECORD_POINTER_CARD_TYPE);

/** A face that prints the pair it was handed, standing in for the host's record card. */
const ProbeFace: React.FC<CellRendererProps> = ({ value }) => (
  <span data-testid="pointer-probe">{JSON.stringify(value)}</span>
);

beforeAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }));

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain`; serve it from a
  // double so no real socket opens. Its answer is orthogonal to which rows draw.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
  registerFieldRenderer(RECORD_POINTER_CARD_TYPE, ProbeFace);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  registerFieldRenderer(RECORD_POINTER_CARD_TYPE, DEFAULT_POINTER_FACE);
});

describe('record:details folds a declared pointer pair type half into the card (objectui#13102)', () => {
  it('a pair: the Details body draws the card and no type-half row', async () => {
    renderBody(SHARE_DEF, SHARE_ROW, { sections: [{ label: 'Details', fields: ALL_FIELDS }] });

    const probes = await body().findAllByTestId('pointer-probe');
    expect(probes).toHaveLength(1);
    // The card still resolves the pair from the row's type half.
    expect(JSON.parse(probes[0].textContent ?? 'null')).toEqual({ objectName: 'invoice', recordId: 'inv_1' });

    expect(body().getByText('access-value')).toBeInTheDocument();
    expect(body().queryByText('Target Object Type')).not.toBeInTheDocument();
    expect(body().queryByText('invoice')).not.toBeInTheDocument();
  });

  it('a pair, listed as a direct fields body: the same fold', async () => {
    renderBody(SHARE_DEF, SHARE_ROW, { fields: ALL_FIELDS });

    expect(await body().findAllByTestId('pointer-probe')).toHaveLength(1);
    await waitFor(() => expect(body().getByText('access-value')).toBeInTheDocument());
    expect(body().queryByText('Target Object Type')).not.toBeInTheDocument();
    expect(body().queryByText('invoice')).not.toBeInTheDocument();
  });

  it('a pair whose id half this body does not draw: the type half keeps its row', async () => {
    renderBody(SHARE_DEF, SHARE_ROW, { fields: ['object_name', 'access_level'] });

    await waitFor(() => expect(body().getByText('access-value')).toBeInTheDocument());
    expect(body().queryAllByTestId('pointer-probe')).toHaveLength(0);
    expect(body().getByText('Target Object Type')).toBeInTheDocument();
    expect(body().getByText('invoice')).toBeInTheDocument();
  });

  it('control: an object without a pair draws every listed field, object_name included', async () => {
    renderBody(PLAIN_DEF, SHARE_ROW, { sections: [{ label: 'Details', fields: ALL_FIELDS }] });

    await waitFor(() => expect(body().getByText('access-value')).toBeInTheDocument());
    expect(body().queryAllByTestId('pointer-probe')).toHaveLength(0);
    expect(body().getByText('Target Object Type')).toBeInTheDocument();
    expect(body().getByText('invoice')).toBeInTheDocument();
    expect(body().getByText('inv_1')).toBeInTheDocument();
  });
});
