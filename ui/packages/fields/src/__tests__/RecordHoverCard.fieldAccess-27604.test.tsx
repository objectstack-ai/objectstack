/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27604 — the hover card asks the viewer's field policy the record
 * page asks: a declared highlight the viewer may not read is not drawn, does
 * not take one of the six slots, and is not named in the read's `$expand`.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  const policy = {
    isLoaded: true,
    checkField: (objectName: string, field: string) => !(objectName === 'contact' && field === 'account'),
  };
  return { ...actual, usePermissions: () => policy };
});

import { LookupCellRenderer } from '../index';
import { RelatedRecordActionsProvider, SchemaRendererProvider } from '@object-ui/react';

const CONTACT = {
  name: 'contact',
  label: 'Contact',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    title: { type: 'text', label: 'Title' },
    account: { type: 'lookup', label: 'Account', reference: 'account' },
  },
  highlightFields: ['account', 'title'],
};

describe('RecordHoverCard and the viewer\'s field policy (objectstack#27604)', () => {
  it('leaves a field the viewer may not read out of the card and out of $expand', async () => {
    const source = {
      find: vi.fn(),
      findOne: vi.fn(async (_o: string, id: string) => ({ id, name: 'Grace Hopper', title: 'Admiral', account: 'acc-1' })),
      getObjectSchema: vi.fn(async () => CONTACT),
    };
    const host = {
      resolve: () => ({}),
      recordHref: (o: string, id: string | number) => `/r/${o}/${id}`,
      openRecord: vi.fn(),
    } as any;
    render(
      <SchemaRendererProvider dataSource={source as any}>
        <RelatedRecordActionsProvider value={host}>
          <LookupCellRenderer value={{ id: 'contact-x', name: 'Grace Hopper' }} field={{ type: 'lookup', reference: 'contact' } as any} />
        </RelatedRecordActionsProvider>
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(source.getObjectSchema).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerOver(document.querySelector('a')!, { pointerType: 'mouse' });
    await waitFor(() => expect(document.querySelector('[data-record-hover-card-field="title"]')).not.toBeNull(), { timeout: 2000 });

    expect(document.querySelector('[data-record-hover-card-field="account"]')).toBeNull();
    expect(source.findOne).toHaveBeenCalledWith('contact', 'contact-x');
  });
});
