/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29462 — a `lookup` / `user` field declaring
 * `referenceNameVisible: true` (director ruling 6574398310, letter B).
 *
 * For a target the reader is refused, the server's `$expand` answers
 * `{ id, name, readRefused: true }`, once per element on `multiple: true`
 * (objectql `engine-reference-name-visible.ts`). The cell draws that name as
 * plain text: no link, no hover card, and no read of the target object (the
 * recording data source below answers every call, and is asked nothing). The
 * floor name `Record #<id>` a field-level rule on the name column serves is
 * drawn as served.
 *
 * CONTROLS: an expanded record WITHOUT the marker stays a link, and a bare id
 * whose read answers "not found" keeps the objectui#13335 restricted-record
 * placeholder (`lookupCell.restrictedRecord-13335.test.tsx` pins that face in
 * full and is unchanged).
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider, RelatedRecordActionsProvider } from '@object-ui/react';
import { getCellRenderer } from '../index';

afterEach(() => cleanup());

const TARGET = 'hr_payroll_29462';

/** Records every call a renderer makes; every method answers, so a read would happen. */
function recordingDataSource() {
  const calls: Array<{ method: string; object?: unknown }> = [];
  const record = (method: string, answer: unknown) =>
    vi.fn(async (object?: unknown) => {
      calls.push({ method, object });
      return answer;
    });
  const ds = {
    findOne: record('findOne', null),
    find: record('find', { data: [] }),
    getObjectSchema: record('getObjectSchema', { name: TARGET, nameField: 'title', fields: { title: { type: 'text' } } }),
  } as any;
  return { ds, calls };
}

const hostLinks = {
  resolve: () => ({}),
  recordHref: (objectName: string, recordId: string | number) => `/o/${objectName}/r/${recordId}`,
  openRecord: vi.fn(),
} as any;

function renderCell(type: 'lookup' | 'user', value: unknown, field: Record<string, unknown> = {}) {
  const { ds, calls } = recordingDataSource();
  const Renderer = getCellRenderer(type);
  const utils = render(
    <SchemaRendererProvider dataSource={ds}>
      <RelatedRecordActionsProvider value={hostLinks}>
        <Renderer
          value={value as any}
          field={{ type, name: 'payroll', reference: type === 'user' ? 'sys_user' : TARGET, referenceNameVisible: true, ...field } as any}
        />
      </RelatedRecordActionsProvider>
    </SchemaRendererProvider>,
  );
  return { ...utils, ds, calls };
}

const nameOnly = (root: HTMLElement) => root.querySelectorAll('[data-slot="reference-name-only"]');
const restricted = (root: HTMLElement) => root.querySelectorAll('[data-slot="restricted-reference"]');

/** Lets every effect and microtask a read would start settle, then reports the calls. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('#29462 — a lookup the reader is refused, served by name', () => {
  it('draws the served name as plain text: no link, and no read of the target', async () => {
    const { container, calls } = renderCell('lookup', { id: 'pay-1', name: 'Payroll Q3', readRefused: true });

    expect(nameOnly(container)).toHaveLength(1);
    expect(container.textContent).toBe('Payroll Q3');
    expect(container.querySelector('a'), 'no link to a record the reader is refused').toBeNull();
    expect(restricted(container), 'not the restricted placeholder').toHaveLength(0);

    // Hovering and focusing the name opens no card: nothing reads the target.
    fireEvent.mouseEnter(nameOnly(container)[0]!);
    fireEvent.pointerEnter(nameOnly(container)[0]!);
    fireEvent.focus(nameOnly(container)[0]!);
    await settle();
    expect(calls, 'the recording data source is asked nothing').toEqual([]);
  });

  it('draws the floor name `Record #<id>` exactly as served', async () => {
    const { container, calls } = renderCell('lookup', { id: 'l1', name: 'Record #l1', readRefused: true });
    expect(container.textContent).toBe('Record #l1');
    expect(nameOnly(container)[0]).toHaveAttribute('title', 'Record #l1');
    expect(container.querySelector('a')).toBeNull();
    await settle();
    expect(calls).toEqual([]);
  });

  it('the field\'s own displayField does not re-name the served value', () => {
    const { container } = renderCell(
      'lookup',
      { id: 'pay-2', name: 'Payroll Q4', readRefused: true },
      { displayField: 'secret_code' },
    );
    expect(container.textContent).toBe('Payroll Q4');
    expect(container.querySelector('a')).toBeNull();
  });

  it('multiple: true draws one text chip per element, none of them a link', async () => {
    const { container, calls } = renderCell(
      'lookup',
      [
        { id: 'pay-3', name: 'Payroll Q1', readRefused: true },
        { id: 'pay-4', name: 'Record #pay-4', readRefused: true },
      ],
      { multiple: true },
    );
    const chips = nameOnly(container);
    expect(chips).toHaveLength(2);
    expect([...chips].map((c) => c.textContent)).toEqual(['Payroll Q1', 'Record #pay-4']);
    expect(container.querySelector('a')).toBeNull();
    await settle();
    expect(calls).toEqual([]);
  });

  it('multiple: true keeps each other element as it was: a readable record stays a link', () => {
    const { container } = renderCell(
      'lookup',
      [
        { id: 'pay-5', name: 'Payroll Open' },
        { id: 'pay-6', name: 'Payroll Closed', readRefused: true },
      ],
      { multiple: true },
    );
    const anchors = container.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toHaveAttribute('href', `/o/${TARGET}/r/pay-5`);
    expect(anchors[0]).toHaveTextContent('Payroll Open');
    expect(nameOnly(container)).toHaveLength(1);
    expect(nameOnly(container)[0]!.textContent).toBe('Payroll Closed');
    expect(nameOnly(container)[0]!.closest('a')).toBeNull();
  });
});

describe('#29462 — a user the reader is refused, served by name', () => {
  it('draws the served name as plain text, with no avatar and no read', async () => {
    const { container, calls } = renderCell('user', { id: 'u-9', name: 'Grace Hopper', readRefused: true });
    expect(nameOnly(container)).toHaveLength(1);
    expect(container.textContent).toBe('Grace Hopper');
    expect(container.querySelector('a')).toBeNull();
    // An avatar would add its initials (`GH`) and its round frame.
    expect(container.querySelector('.rounded-full'), 'no avatar for a person the reader is refused').toBeNull();
    await settle();
    expect(calls).toEqual([]);
  });

  it('multiple: true draws one text chip per element', () => {
    const { container } = renderCell(
      'user',
      [
        { id: 'u-1', name: 'Ada Lovelace', readRefused: true },
        { id: 'u-2', name: 'Record #u-2', readRefused: true },
      ],
      { multiple: true },
    );
    expect([...nameOnly(container)].map((c) => c.textContent)).toEqual(['Ada Lovelace', 'Record #u-2']);
  });
});

describe('#29462 — CONTROLS: no marker, no change', () => {
  it('an expanded record without `readRefused` is still a link', () => {
    const { container } = renderCell('lookup', { id: 'pay-7', name: 'Payroll Readable' });
    expect(nameOnly(container)).toHaveLength(0);
    expect(container.querySelector('a')).toHaveAttribute('href', `/o/${TARGET}/r/pay-7`);
  });

  it('`readRefused` other than `true` is not the served form', () => {
    const { container } = renderCell('lookup', { id: 'pay-8', name: 'Payroll Eight', readRefused: 'yes' });
    expect(nameOnly(container)).toHaveLength(0);
    expect(container.querySelector('a')).toHaveAttribute('href', `/o/${TARGET}/r/pay-8`);
  });

  it('a field without the key whose bare id reads "not found" keeps the restricted placeholder', async () => {
    const { container } = renderCell('lookup', 'pay-hidden-29462', { referenceNameVisible: undefined });
    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(nameOnly(container)).toHaveLength(0);
    expect(container.querySelector('a')).toBeNull();
  });

  it('an expanded user without `readRefused` still draws its avatar', () => {
    const { container } = renderCell('user', { id: 'u-3', name: 'Alan Turing' });
    expect(nameOnly(container)).toHaveLength(0);
    expect(container.querySelector('.rounded-full')).not.toBeNull();
    expect(container.textContent).toBe('ATAlan Turing');
  });
});
