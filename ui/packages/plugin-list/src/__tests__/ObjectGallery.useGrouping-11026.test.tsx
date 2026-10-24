/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11026: a gallery card's number field carries its authored
 * `useGrouping` to the shared cell renderer, as Grid and Detail do.
 *
 * `buildEnrichedField` copies the field def key by key; the hint rides beside
 * `scale`, the key whose heuristic it overrides. Driven through the real
 * `ObjectGallery` render and asserted on the drawn text, with a same-shape
 * control field that carries no hint.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ObjectGallery } from '../ObjectGallery';
import { SchemaRendererProvider } from '@object-ui/react';

const objectSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    // The author's opt-out, on a scale the heuristic would group.
    code: { type: 'number', label: 'Plain Code', scale: 1, useGrouping: false },
    // The author's pin, on a scale the heuristic would leave ungrouped.
    headcount: { type: 'number', label: 'Headcount', scale: 0, useGrouping: true },
    // The control: no hint, so the heuristic's grouped answer is right.
    total: { type: 'number', label: 'Total', scale: 1 },
  },
};

const data = [{ id: 'a1', name: 'Acme Corp', code: 12345.5, headcount: 2026, total: 67890.5 }];

const renderGallery = () => {
  const dataSource = {
    find: vi.fn().mockResolvedValue(data),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  };
  return render(
    <SchemaRendererProvider
      dataSource={dataSource as unknown as React.ComponentProps<typeof SchemaRendererProvider>['dataSource']}
    >
      <ObjectGallery
        schema={{
          type: 'object-gallery',
          objectName: 'metric',
          gallery: { titleField: 'name', visibleFields: ['code', 'headcount', 'total'] },
        }}
      />
    </SchemaRendererProvider>,
  );
};

describe('ObjectGallery — the authored useGrouping reaches the card cell (objectui#11026)', () => {
  it('renders each number field as its author declared', async () => {
    const { container } = renderGallery();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    // CONTROL first, BY VALUE: the cards drew their number cells at all.
    expect(await screen.findByText('67,890.5')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text, 'useGrouping false renders ungrouped').toContain('12345.5');
    expect(text).not.toContain('12,345.5');
    expect(text, 'useGrouping true renders grouped at scale 0').toContain('2,026');
  });
});
