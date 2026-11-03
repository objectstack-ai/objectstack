/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28909 — the meta line asks the strip the page DREW, not the
 * strip the object declares, whether the owner is already shown.
 *
 * - `drawnHighlightFields` handed over without `owner_id` (a phone header cut
 *   short) keeps the owner on the meta line, though the declaration lists it.
 * - `drawnHighlightFields` carrying `owner_id` leaves it out, whatever the
 *   declaration says.
 * - Omitted, the declared strip decides, as before (the
 *   `RecordMetaFooter.ownerOnce-28868` pins).
 *
 * The page-level pins (a real `RecordDetailView` at 390 px and 1440 px) are
 * in app-shell's `RecordDetailView.phoneOwnerLine-28909.test.tsx`.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RecordMetaFooter } from '../RecordMetaFooter';
import { DefaultRecordPageContext } from '../defaultRecordPage';

afterEach(cleanup);

const onDefaultPage = (node: React.ReactNode) => (
  <DefaultRecordPageContext.Provider value>{node}</DefaultRecordPageContext.Provider>
);

const data = { id: 'C-1', created_at: '2026-10-16T00:00:00Z', owner_id: 'Ada Admin' };

const contact = (highlightFields: string[]) => ({
  name: 'contact',
  highlightFields,
  fields: {
    name: { type: 'text', label: 'Name' },
    email: { type: 'email', label: 'Email' },
    phone: { type: 'phone', label: 'Phone' },
    owner_id: { type: 'lookup', label: 'Owner' },
  },
});

const ownerEntry = (container: HTMLElement) => container.querySelector('[data-record-meta-owner]');

describe('the meta line reads the drawn strip (objectstack#28909)', () => {
  it('the declaration lists owner_id but the drawn strip does not: the meta line names the owner', () => {
    const { container } = render(onDefaultPage(
      <RecordMetaFooter
        data={data}
        objectSchema={contact(['email', 'phone', 'owner_id'])}
        drawnHighlightFields={['email', 'phone']}
      />,
    ));
    expect(ownerEntry(container)).toBeTruthy();
    expect(ownerEntry(container)!.textContent).toContain('Ada Admin');
  });

  it('the drawn strip carries owner_id: the meta line leaves it out', () => {
    const { container } = render(onDefaultPage(
      <RecordMetaFooter
        data={data}
        objectSchema={contact(['email'])}
        drawnHighlightFields={['email', 'owner_id']}
      />,
    ));
    expect(ownerEntry(container)).toBeNull();
    expect(container.querySelector('[data-record-meta-id]')!.textContent).toBe('C-1');
  });

  it('an empty drawn strip (nothing drawn) keeps the owner', () => {
    const { container } = render(onDefaultPage(
      <RecordMetaFooter data={data} objectSchema={contact(['owner_id'])} drawnHighlightFields={[]} />,
    ));
    expect(ownerEntry(container)).toBeTruthy();
  });

  it('control: omitted, the declared strip decides', () => {
    const { container } = render(onDefaultPage(
      <RecordMetaFooter data={data} objectSchema={contact(['email', 'owner_id'])} />,
    ));
    expect(ownerEntry(container)).toBeNull();
  });
});
