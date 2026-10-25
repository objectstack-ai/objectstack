/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11815 — the gallery card and the compact list judge a declared
 * deadline against the row they draw: an open row's past deadline reads
 * "Overdue Nd" in red, a done row's reads neutral (ruling D).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectGallery } from '../ObjectGallery';
import { ListViewCompactRows } from '../ListViewCompact';

afterEach(cleanup);

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const objectSchema = {
  name: 'task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: { type: 'text', label: 'Status' },
    deliver_by: { type: 'date', label: 'Deliver by', dueLike: true, settledWhen: "record.status == 'done'" },
  },
};

const rows = [
  { id: 't-open', title: 'Open task', status: 'open', deliver_by: daysAgo(5) },
  { id: 't-done', title: 'Done task', status: 'done', deliver_by: daysAgo(5) },
];

const isRed = (text: string) => screen.getByText(text).closest('span.tabular-nums')?.className.includes('text-red-600');

describe('objectui#11815 — gallery card', () => {
  it("an open card's declared deadline reads overdue, a done card's reads neutral", async () => {
    const ds = {
      find: vi.fn().mockResolvedValue(rows),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    };
    render(
      <SchemaRendererProvider dataSource={ds as any}>
        <ObjectGallery
          schema={{ type: 'object-gallery', objectName: 'task', gallery: { titleField: 'title', visibleFields: ['deliver_by'] } } as any}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(screen.getByText('Overdue 5d')).toBeInTheDocument());
    expect(isRed('Overdue 5d')).toBe(true);
    expect(screen.getAllByText('5 days ago')).toHaveLength(1);
    expect(isRed('5 days ago')).toBe(false);
  });
});

describe('objectui#11815 — compact list', () => {
  it("an open row's declared deadline reads overdue, a done row's reads neutral", () => {
    render(<ListViewCompactRows rows={rows} fields={['title', 'deliver_by']} objectName="task" objectDef={objectSchema as any} />);
    expect(screen.getByText('Overdue 5d')).toBeInTheDocument();
    expect(isRed('Overdue 5d')).toBe(true);
    expect(screen.getAllByText('5 days ago')).toHaveLength(1);
    expect(isRed('5 days ago')).toBe(false);
  });
});
