/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details` no longer asks `objectSchema.primaryField` WHICH ROW to
 * hide (objectui#7586).
 *
 * ## The surface under test is the DEDUPE, not the title
 *
 * This renderer does not draw the H1. It draws the body grid, and drops from
 * it the one field whose value the page H1 is already showing — otherwise
 * every record page repeats itself ("客户名称: Acme Corporation" directly under
 * an H1 reading "Acme Corporation"). The ladder that picks that field was
 * topped by `objSchema?.primaryField`, so the question these cases answer is
 * **which row disappears**, never what the heading says. A title-only pin
 * passes while this ladder is still wrong, because the two are decided in
 * different packages: `@object-ui/components`' `PageHeaderRenderer` renders
 * the H1, this file renders the grid under it.
 *
 * ## Why the rung had to go
 *
 * `primaryField` is a `DetailViewSchema` key (`@object-ui/types` `views.ts`) —
 * a VIEW key, which `DetailView.resolveDisplayTitle` legitimately reads off
 * `schema`. Read off an OBJECT def it is undeclared: `@objectstack/spec`'s
 * object schema is a `strictObject` answering `unrecognized_keys:
 * ['primaryField']`, and `ObjectSchema.create()` throws. objectstack#6326
 * removed the identical read from two lint rules; objectui#7287 / PR #7585
 * removed it from `resolveTitleField`. Three of this repo's changelogs
 * already call the probe "not a spec property — always undefined" while the
 * code kept honouring it.
 *
 * ⚠️ Its removal is a real BEHAVIOUR change for a payload that carries the key
 * anyway — a different row survives the grid — which is why it is pinned here
 * rather than waved through as a dead-code deletion.
 *
 * ⚠️ The docstring this ladder carried ("the header chip resolves the title
 * from objectSchema.primaryField → …") went stale the moment PR #7585 landed;
 * it now describes the chip as it actually is.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';

/**
 * An object whose identity field is `ref_no`, spelled the ONE way no producer
 * can spell it. `name` is an ordinary field here, and the two carry different
 * values so "which row is hidden" is answerable from the DOM alone.
 */
const objectSchema = {
  name: 'contract',
  label: 'Contract',
  primaryField: 'ref_no',
  fields: {
    ref_no: { type: 'text', label: 'Ref No' },
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const FIELDS = ['ref_no', 'name', 'amount'];

function renderBody(record: any, schema: any = objectSchema) {
  return render(
    <RecordContextProvider
      objectName="contract"
      recordId={record.id}
      data={record}
      objectSchema={schema}
    >
      <RecordDetailsRenderer schema={{ fields: FIELDS } as never} />
    </RecordContextProvider>,
  );
}

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain` for the
  // ROW-level verdict; happy-dom resolves that relative URL to a REAL socket,
  // which the repo's network-escape guard fails the file for (objectui#6640).
  // Serve it from a double — its answer is orthogonal to which row is hidden.
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

describe('record:details dedupe — `primaryField` no longer picks the hidden row (#7586)', () => {
  it('hides the row the H1 actually shows, not the `primaryField` row', () => {
    renderBody({ id: 'C1', ref_no: 'HT-2026-001', name: 'Acme Corporation', amount: 42 });

    // `name` is what the header chip resolves to for this record, so `name` is
    // the row that goes. Before this fix `primaryField` took `ref_no` out
    // instead, leaving the grid repeating the H1 and hiding a field nothing
    // else showed.
    expect(screen.queryByText('Acme Corporation')).toBeNull();
    expect(screen.getByText('HT-2026-001')).toBeInTheDocument();

    // An ordinary row is untouched — the dedupe drops ONE field, it does not
    // filter the grid down.
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('hides nothing when `primaryField` names the only value on the record', () => {
    // Nothing in the literal display-name walk has a value here. Before the
    // fix `ref_no` was hidden and the body grid rendered a single `amount`
    // row; the H1 for this record is the `${objectLabel} ${id}` floor, which
    // no grid row duplicates, so nothing should be dropped.
    renderBody({ id: 'C2', ref_no: 'HT-2026-002', amount: 7 });

    expect(screen.getByText('HT-2026-002')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  /**
   * CONTROL — the dedupe still runs.
   *
   * Without this, deleting the whole dedupe block would pass both cases above:
   * "the `ref_no` row survives" is satisfied by a renderer that hides nothing
   * at all. This is the case that goes red for that, and it is the reason the
   * two cases above are readable as a measurement of the LADDER rather than of
   * its absence.
   */
  it('CONTROL: the H1 field is still dropped from the grid', () => {
    renderBody(
      { id: 'C3', ref_no: 'HT-2026-003', name: 'Acme Corporation', amount: 42 },
      { ...objectSchema, primaryField: undefined },
    );

    expect(screen.queryByText('Acme Corporation')).toBeNull();
    expect(screen.getByText('HT-2026-003')).toBeInTheDocument();
  });

  /**
   * CONTROL — `primaryField` on a VIEW schema is a different key and stays.
   *
   * `DetailViewSchema.primaryField` is declared (`packages/types/src/views.ts`)
   * and `DetailView.resolveDisplayTitle` reads it as rung 1. Nothing in this
   * card touches that; a change that deleted the key everywhere rather than
   * only where it sits on an OBJECT def turns this red.
   */
  it('CONTROL: the declared VIEW-level `primaryField` is untouched', async () => {
    const { DetailView } = await import('../../DetailView');

    render(
      <DetailView
        schema={
          {
            type: 'detail-view',
            objectName: 'contract',
            primaryField: 'ref_no',
            data: { id: 'C4', ref_no: 'HT-2026-004', name: 'Acme Corporation' },
            fields: ['name'],
            showHeader: true,
          } as never
        }
      />,
    );

    expect(screen.getByText('HT-2026-004')).toBeInTheDocument();
  });
});
