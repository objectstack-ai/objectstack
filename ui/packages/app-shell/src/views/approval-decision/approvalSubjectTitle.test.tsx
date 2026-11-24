/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35415 — the approval request page's title: the record the
 * request is about, linked to it only where the page read it.
 *
 * Direction, written before the run: with the read gate removed (the link
 * drawn whatever `isReadable` says), the "not read" case REDs; with the click
 * handed to the anchor, the plain-click case REDs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { RelatedRecordActionsProvider, type RelatedRecordActionsValue } from '@object-ui/react';
import { approvalSubjectTitle } from './approvalSubjectTitle.js';

const ROW = { id: 'req_1', process_label: 'Invoice Sign-off', object_name: 'invoice', record_id: 'inv_1', record_title: 'INV-1010' };

function host() {
  const openRecord = vi.fn<(objectName: string, recordId: string | number) => void>();
  const value: RelatedRecordActionsValue = {
    resolve: () => ({}),
    recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${recordId}`,
    openRecord,
  };
  return Object.assign(value, { openRecord });
}

function drawn(readable: boolean, value: RelatedRecordActionsValue | null = host()) {
  const title = approvalSubjectTitle(ROW, () => readable);
  const node = value ? <RelatedRecordActionsProvider value={value}>{title?.node}</RelatedRecordActionsProvider> : title?.node;
  const { container } = render(<h1>{node}</h1>);
  return { title, h1: container.querySelector('h1') as HTMLElement };
}

afterEach(() => cleanup());

describe('approvalSubjectTitle (objectstack#35415)', () => {
  it('read by the page: the record title, as a link to the record through the host route', () => {
    const { title, h1 } = drawn(true);
    expect(title?.text).toBe('INV-1010');
    expect(h1.textContent).toBe('INV-1010');
    expect(h1.querySelector('a')?.getAttribute('href')).toBe('/apps/demo/invoice/record/inv_1');
  });

  it('not read by the page (refused, unresolvable, deleted, or not yet): the record title as plain text', () => {
    const { title, h1 } = drawn(false);
    expect(title?.text).toBe('INV-1010');
    expect(h1.textContent).toBe('INV-1010');
    expect(h1.querySelector('a')).toBeNull();
  });

  it('a host that routes to no record: plain text', () => {
    const { h1 } = drawn(true, { resolve: () => ({}), recordHref: () => null });
    expect(h1.textContent).toBe('INV-1010');
    expect(h1.querySelector('a')).toBeNull();
  });

  it('a plain left click is the host\'s openRecord; a modifier click is the browser\'s', () => {
    const value = host();
    const { h1 } = drawn(true, value);
    const link = h1.querySelector('a') as HTMLAnchorElement;
    expect(fireEvent.click(link, { button: 0 })).toBe(false);
    expect(value.openRecord).toHaveBeenCalledWith('invoice', 'inv_1');
    value.openRecord.mockClear();
    expect(fireEvent.click(link, { button: 0, metaKey: true })).toBe(true);
    expect(value.openRecord).not.toHaveBeenCalled();
  });

  it('no record title, or one that is the bare record id: undefined, so the page keeps its own title', () => {
    const { record_title: _t, ...untitled } = ROW;
    expect(approvalSubjectTitle(untitled, () => true)).toBeUndefined();
    expect(approvalSubjectTitle({ ...ROW, record_title: 'inv_1' }, () => true)).toBeUndefined();
    expect(approvalSubjectTitle({ ...ROW, object_name: '' }, () => true)).toBeUndefined();
    expect(approvalSubjectTitle(null, () => true)).toBeUndefined();
  });
});
