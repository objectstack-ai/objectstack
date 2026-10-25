/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13335 on the RECORD PAGE: a lookup whose record the viewer may not
 * read (its GET answers 404, so `findOne` answers `null`) printed the raw id
 * beside a question mark. Driven through the real `DetailSection`, so the pin
 * stays red if the record page stops reaching the shared lookup renderer.
 * The readable sibling in the same section is the control.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';

const RESTRICTED_ID = 'CTPnPnOW17jcvcy-detail';
const READABLE = { id: 'CASE-DETAIL-READABLE', name: 'Printer jam' };

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

describe('objectui#13335 — DetailSection: an unreadable lookup reads "Restricted record"', () => {
  it('the unreadable reference shows the label with no id; the readable one keeps its name', async () => {
    const ds = {
      findOne: vi.fn(async (_o: string, id: string) => (id === READABLE.id ? READABLE : null)),
      find: vi.fn(),
    } as any;
    const objectSchema = {
      fields: {
        source_case: { type: 'lookup', reference: 'case_13335_detail', label: 'Source Case' },
        related_case: { type: 'lookup', reference: 'case_13335_detail', label: 'Related Case' },
      },
    };
    const section = {
      fields: [
        { name: 'source_case', label: 'Source Case' },
        { name: 'related_case', label: 'Related Case' },
      ],
    } as DetailViewSection;

    const { container } = render(
      <SchemaRendererProvider dataSource={ds}>
        <DetailSection
          section={section}
          data={{ source_case: RESTRICTED_ID, related_case: READABLE.id }}
          objectSchema={objectSchema}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(screen.getByText('Restricted record')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Printer jam')).toBeInTheDocument());
    expect(container.innerHTML, 'the unreadable id appears nowhere on the page').not.toContain(RESTRICTED_ID);
    expect(container.querySelectorAll('[data-slot="restricted-reference"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="unresolved-reference"]')).toHaveLength(0);
  });
});
