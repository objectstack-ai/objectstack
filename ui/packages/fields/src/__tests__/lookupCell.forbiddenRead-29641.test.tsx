/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29641 — a lookup to a record whose OBJECT the reader may not
 * read drew the raw id beside a question mark, inside a link to a record page
 * that refuses them, instead of objectui#13335's "Restricted record".
 *
 * The object read gate answers the record GET with `403 PERMISSION_DENIED`,
 * not with the 404 a row hidden by sharing gets, and the ObjectStack adapter's
 * `findOne` turns only a 404 into `null`: the 403 is thrown. Measured live on
 * `pnpm dev:crm` (a member refused the target object), the thrown value is a
 * plain `Error` whose own members are `httpStatus: 403`, `code:
 * 'PERMISSION_DENIED'` and `details: { error, code, object }` — the shape
 * `MEASURED_REFUSAL` below copies. A missing id under that object answers the
 * same 403, so this face discloses nothing a not-found would not.
 *
 * A refusal of the reader's own read now draws the restricted face, as the
 * not-found does. It is read through `@object-ui/react`'s `classifyLoadError`
 * (`forbidden`: status 403 on any of the three status members, or the code),
 * so each spelling below gets the face. CONTROLS: a `null` answer (the 404)
 * is unchanged, and a 5xx, a network failure and a 401 keep the unresolved
 * face with their id — a failure that may pass is not a refusal.
 *
 * Every case uses its own id: the lookup cache is module-level.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider, RelatedRecordActionsProvider } from '@object-ui/react';
import { getCellRenderer } from '../index';

afterEach(() => cleanup());

const OBJECT = 'hr_payroll_29641';

/** The adapter's thrown value for an object-gate refusal, as measured live. */
function measuredRefusal(): Error {
  const message =
    'You do not have permission to perform this action. Contact your administrator if you need access.';
  return Object.assign(new Error(message), {
    code: 'PERMISSION_DENIED',
    httpStatus: 403,
    details: { error: message, code: 'PERMISSION_DENIED', object: OBJECT },
  });
}

/** A recording data source whose `findOne` throws `error` for every id. */
function throwingDataSource(error: () => unknown) {
  return {
    findOne: vi.fn(async () => {
      throw error();
    }),
    find: vi.fn(async () => ({ data: [] })),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, nameField: 'title', fields: { title: { type: 'text' } } })),
  } as any;
}

const hostLinks = {
  resolve: () => ({}),
  recordHref: (objectName: string, recordId: string | number) => `/o/${objectName}/r/${recordId}`,
  openRecord: vi.fn(),
} as any;

function renderLookup(value: unknown, ds: any) {
  const Renderer = getCellRenderer('lookup');
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <RelatedRecordActionsProvider value={hostLinks}>
        <Renderer value={value as any} field={{ type: 'lookup', name: 'payroll', reference: OBJECT } as any} />
      </RelatedRecordActionsProvider>
    </SchemaRendererProvider>,
  );
}

const restricted = (root: HTMLElement) => root.querySelectorAll('[data-slot="restricted-reference"]');
const unresolved = (root: HTMLElement) => root.querySelectorAll('[data-slot="unresolved-reference"]');

/** Lets the read and the render it causes settle. */
async function settle(ds: any) {
  await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
}

describe('objectstack#29641 — the reader\'s read of the referenced record is REFUSED', () => {
  it('the measured 403 PERMISSION_DENIED draws "Restricted record", with no id, no link and one read', async () => {
    const id = 'PAY-REFUSED-MEASURED';
    const ds = throwingDataSource(measuredRefusal);
    const { container } = renderLookup(id, ds);

    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(container.textContent).toBe('Restricted record');
    expect(container.innerHTML, 'the id is gone from text and from every attribute').not.toContain(id);
    expect(container.querySelector('a'), 'no link to a page that refuses the reader').toBeNull();
    expect(unresolved(container), 'not the unresolved face as well').toHaveLength(0);
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(ds.findOne).toHaveBeenCalledWith(OBJECT, id);
    // ⛔ No second read around the refusal: not the object definition, not a find.
    expect(ds.getObjectSchema).not.toHaveBeenCalled();
    expect(ds.find).not.toHaveBeenCalled();
  });

  it.each([
    ['httpStatus 403 alone', () => Object.assign(new Error('Forbidden'), { httpStatus: 403 })],
    ['status 403 alone', () => Object.assign(new Error('Forbidden'), { status: 403 })],
    ['statusCode 403 alone', () => Object.assign(new Error('Forbidden'), { statusCode: 403 })],
    ['code PERMISSION_DENIED alone', () => Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' })],
  ])('%s is read as the same refusal', async (label, error) => {
    const id = `PAY-REFUSED-${label.replace(/\W+/g, '-')}`;
    const { container } = renderLookup(id, throwingDataSource(error));
    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(container.innerHTML).not.toContain(id);
    expect(container.querySelector('a')).toBeNull();
  });

  it('the refusal is cached like a not-found, and a failure on ANOTHER id stays a failure', async () => {
    const refusedId = 'PAY-REFUSED-CACHED';
    const failedId = 'PAY-FAILED-AFTER-REFUSAL';
    let next: () => unknown = measuredRefusal;
    const ds = throwingDataSource(() => next());

    const first = renderLookup(refusedId, ds);
    await waitFor(() => expect(restricted(first.container)).toHaveLength(1));
    first.unmount();

    // A second cell for the same id draws restricted at once, without a read.
    const again = renderLookup(refusedId, ds);
    expect(restricted(again.container)).toHaveLength(1);
    expect(again.container.innerHTML).not.toContain(refusedId);
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    again.unmount();

    // A transient failure on another id after it keeps its own, unresolved answer.
    next = () => Object.assign(new Error('Bad Gateway'), { httpStatus: 502 });
    const other = renderLookup(failedId, ds);
    await waitFor(() => expect(ds.findOne).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(restricted(other.container)).toHaveLength(0);
    expect(unresolved(other.container)).toHaveLength(1);
    expect(other.container.textContent).toBe(failedId);
  });

  it('in a multi-value cell, only the first entry (the one read) is restricted', async () => {
    const first = 'PAY-REFUSED-ARR-1';
    const second = 'PAY-NEVER-ASKED-ARR-2';
    const { container } = renderLookup([first, second], throwingDataSource(measuredRefusal));

    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(container.innerHTML).not.toContain(first);
    expect(restricted(container)[0]!.closest('a'), 'the restricted chip is not a link').toBeNull();
    // Entries after the first are never read, so nothing is known about them.
    expect(unresolved(container)).toHaveLength(1);
    expect(unresolved(container)[0]!.textContent).toBe(second);
  });
});

describe('objectstack#29641 — CONTROLS: every other answer keeps its face', () => {
  it('a `null` answer (the adapter\'s 404) is still the restricted face, unchanged', async () => {
    const id = 'PAY-NOT-FOUND';
    const ds = { findOne: vi.fn(async () => null), find: vi.fn() } as any;
    const { container } = renderLookup(id, ds);
    await waitFor(() => expect(restricted(container)).toHaveLength(1));
    expect(container.innerHTML).not.toContain(id);
    expect(container.querySelector('a')).toBeNull();
  });

  it.each([
    ['a 500 with a server code', () => Object.assign(new Error('Internal error'), { httpStatus: 500, code: 'INTERNAL_ERROR' })],
    ['a 503', () => Object.assign(new Error('Service Unavailable'), { status: 503 })],
    ['a network failure (no HTTP answer)', () => new TypeError('Failed to fetch')],
    ['a 401 (the session, not the record)', () => Object.assign(new Error('Unauthorized'), { httpStatus: 401, code: 'UNAUTHORIZED' })],
  ])('%s keeps the unresolved face and its id', async (label, error) => {
    const id = `PAY-FAILED-${label.replace(/\W+/g, '-')}`;
    const ds = throwingDataSource(error);
    const { container } = renderLookup(id, ds);
    await settle(ds);
    expect(restricted(container)).toHaveLength(0);
    expect(unresolved(container)).toHaveLength(1);
    expect(container.textContent).toBe(id);
  });
});
