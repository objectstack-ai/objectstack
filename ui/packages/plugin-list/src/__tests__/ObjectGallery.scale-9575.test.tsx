/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9575 — a gallery card's number / percent field declaring `scale`
 * renders through the shared cell renderer exactly as Grid/Detail do.
 *
 * `buildEnrichedField` copied `precision` but never `scale`, while the shared
 * `NumberCellRenderer` / `PercentCellRenderer` pad decimals to `scale` only
 * (`precision` is the TOTAL digit count). So a `scale: 2` percent rendered
 * `25%` on a card and `25.00%` in the grid.
 *
 * Driven through the real `ObjectGallery` render, not the builder alone. The
 * one seam observed is `getCellRenderer`: it is wrapped to record the `field`
 * the gallery hands over, and still returns the real renderer, so every DOM
 * assertion below is the shared renderer's own output.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const handedFields: Array<Record<string, unknown>> = [];

vi.mock('@object-ui/fields', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/fields')>();
  return {
    ...actual,
    getCellRenderer: (type: string) => {
      const Real = actual.getCellRenderer(type);
      const Recording = (props: React.ComponentProps<typeof Real>) => {
        handedFields.push(props.field as unknown as Record<string, unknown>);
        return React.createElement(Real, props);
      };
      return Recording;
    },
  };
});

import { ObjectGallery } from '../ObjectGallery';
import { SchemaRendererProvider } from '@object-ui/react';

const objectSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    win_rate: { type: 'percent', label: 'Win rate', precision: 5, scale: 2 },
    headcount_ratio: { type: 'number', label: 'Ratio', precision: 10, scale: 3 },
    // Control: precision declared, scale absent.
    loose_rate: { type: 'percent', label: 'Loose rate', precision: 10 },
  },
};

const data = [
  { id: 'a1', name: 'Acme Corp', win_rate: 0.25, headcount_ratio: 3.14, loose_rate: 0.25 },
];

const renderGallery = (visibleFields: string[]) => {
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
          objectName: 'opportunity',
          gallery: { titleField: 'name', visibleFields },
        }}
      />
    </SchemaRendererProvider>,
  );
};

const lastFieldNamed = (name: string) =>
  [...handedFields].reverse().find((f) => f?.name === name);

describe('ObjectGallery — declared `scale` reaches the shared cell renderer (objectui#9575)', () => {
  beforeEach(() => {
    handedFields.length = 0;
  });

  it('pads a percent field to its declared scale', async () => {
    renderGallery(['win_rate']);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(await screen.findByText('25.00%')).toBeInTheDocument();
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
    expect(lastFieldNamed('win_rate')).toMatchObject({ type: 'percent', scale: 2, precision: 5 });
  });

  it('pads a number field to its declared scale', async () => {
    renderGallery(['headcount_ratio']);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(await screen.findByText('3.140')).toBeInTheDocument();
    expect(lastFieldNamed('headcount_ratio')).toMatchObject({ type: 'number', scale: 3, precision: 10 });
  });

  it('control: precision still flows, and a precision-only percent is not padded by it', async () => {
    renderGallery(['loose_rate']);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(await screen.findByText('25%')).toBeInTheDocument();
    const handed = lastFieldNamed('loose_rate');
    expect(handed).toMatchObject({ type: 'percent', precision: 10 });
    expect(handed).not.toHaveProperty('scale');
  });
});
