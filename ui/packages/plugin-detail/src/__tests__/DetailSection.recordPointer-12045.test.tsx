/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The details grid draws a `referenceVia` pointer pair through the pointer
 * face (objectui#12045).
 *
 * The grid holds the row, so it is where the pair is resolved: it asks
 * `@object-ui/fields`' `resolveRecordPointer` and draws a pair with the
 * renderer registered under `RECORD_POINTER_CARD_TYPE`, the pair as its
 * `value`. Two pairs the spec declares on objectstack's system objects are
 * pinned: `sys_approval_request.record_id` (sibling `object_name`) and
 * `sys_activity.source_id` (sibling `source_object`).
 *
 * Without a host face the default draws the record id as text, the same text
 * the row drew before the pair was read. With a face registered (as
 * `@object-ui/app-shell` registers its record card), the face receives the
 * resolved pair. A face is registered through the published
 * `registerFieldRenderer`, which has no inverse; this file is a `.tsx` (the
 * `dom` project, `isolate: true`) and puts the default back after each case.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import {
  getCellRenderer,
  registerFieldRenderer,
  RECORD_POINTER_CARD_TYPE,
  type CellRendererProps,
} from '@object-ui/fields';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';

beforeAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }));

const DEFAULT_FACE = getCellRenderer(RECORD_POINTER_CARD_TYPE);

afterEach(() => {
  cleanup();
  registerFieldRenderer(RECORD_POINTER_CARD_TYPE, DEFAULT_FACE);
});

/** A face that prints the pair it was handed, so a pin reads it off the DOM. */
const ProbeFace: React.FC<CellRendererProps> = ({ value }) => (
  <span data-testid="pointer-probe">{JSON.stringify(value)}</span>
);

const APPROVAL_REQUEST = {
  fields: {
    object_name: { type: 'text', label: 'Object' },
    record_id: { type: 'text', label: 'Record', referenceVia: 'object_name' },
    process_name: { type: 'text', label: 'Process' },
  },
};

const ACTIVITY = {
  fields: {
    source_object: { type: 'text', label: 'Source Object' },
    source_id: { type: 'text', label: 'Source ID', referenceVia: 'source_object' },
    record_id: { type: 'text', label: 'Record ID', referenceVia: 'object_name' },
  },
};

function renderSection(objectSchema: Record<string, unknown>, fields: string[], data: Record<string, unknown>) {
  return render(
    <DetailSection
      section={{ title: 'Details', fields: fields.map((name) => ({ name, label: name })) } as DetailViewSection}
      data={data}
      objectSchema={objectSchema}
      objectName="probe_12045"
    />,
  );
}

describe('DetailSection draws a referenceVia pointer pair through the pointer face (objectui#12045)', () => {
  it('sys_approval_request.record_id: the face receives the pair read from the row', () => {
    registerFieldRenderer(RECORD_POINTER_CARD_TYPE, ProbeFace);
    const { getAllByTestId } = renderSection(APPROVAL_REQUEST, ['object_name', 'record_id', 'process_name'], {
      object_name: 'invoice',
      record_id: 'inv_1',
      process_name: 'invoice_approval',
    });
    const probes = getAllByTestId('pointer-probe');
    expect(probes, 'only the pointer field is drawn by the pointer face').toHaveLength(1);
    expect(JSON.parse(probes[0].textContent ?? 'null')).toEqual({ objectName: 'invoice', recordId: 'inv_1' });
  });

  it('a non-approval pair, sys_activity.source_id: the face reads the sibling the field names', () => {
    registerFieldRenderer(RECORD_POINTER_CARD_TYPE, ProbeFace);
    const { getAllByTestId } = renderSection(ACTIVITY, ['source_object', 'source_id'], {
      source_object: 'sys_email',
      source_id: 'em_7',
      object_name: 'contact',
    });
    const probes = getAllByTestId('pointer-probe');
    expect(probes).toHaveLength(1);
    expect(JSON.parse(probes[0].textContent ?? 'null')).toEqual({ objectName: 'sys_email', recordId: 'em_7' });
  });

  it('control: a half-addressed row is not a pair, and the field draws its stored text', () => {
    registerFieldRenderer(RECORD_POINTER_CARD_TYPE, ProbeFace);
    const { queryAllByTestId, container } = renderSection(ACTIVITY, ['source_id'], {
      source_id: 'em_7',
      source_object: '',
    });
    expect(queryAllByTestId('pointer-probe')).toHaveLength(0);
    expect(container.textContent).toContain('em_7');
  });

  it('without a host face, the default draws the record id as text', () => {
    const { container, queryAllByTestId } = renderSection(APPROVAL_REQUEST, ['record_id'], {
      object_name: 'invoice',
      record_id: 'inv_1',
    });
    expect(queryAllByTestId('pointer-probe')).toHaveLength(0);
    expect(container.textContent).toContain('inv_1');
    expect(container.textContent).not.toContain('[Object]');
  });
});
