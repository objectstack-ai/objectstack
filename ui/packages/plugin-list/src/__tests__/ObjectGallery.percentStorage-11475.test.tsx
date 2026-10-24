/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#11475 — a gallery card's percent field reaches the shared cell with
 * its declared `max`, the storage statement the percent cell now reads through
 * the spec's `percentScaleOf` (a fraction unless `max` is above 1).
 *
 * `buildEnrichedField` copied `scale` and `useGrouping` but not `max`. Once the
 * cell stopped guessing the storage from the value, a whole-stored field
 * (`max: 100`, as every shipped percent field declares) would have read a
 * stored `50` as `5000%` on a card beside `50%` in the grid.
 *
 * Driven through the real `ObjectGallery` render, the seam observed the way
 * `ObjectGallery.scale-9575.test.tsx` observes it: `getCellRenderer` is wrapped
 * to record the `field` the gallery hands over and still returns the real
 * renderer, so every DOM assertion is the shared renderer's own output.
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
    // Whole-stored, as CRM `probability` declares it.
    probability: { type: 'percent', label: 'Probability', min: 0, max: 100 },
    // Fraction-stored: no `max`.
    won_share: { type: 'percent', label: 'Won share' },
  },
};

const data = [{ id: 'a1', name: 'Acme Corp', probability: 50, won_share: 1 }];

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

describe('ObjectGallery — a percent field\'s declared `max` reaches the shared cell (objectui#11475)', () => {
  beforeEach(() => {
    handedFields.length = 0;
  });

  it('a whole-stored 50 (`max: 100`) reads 50%, not 5000%', async () => {
    renderGallery(['probability']);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.queryByText('5000%')).not.toBeInTheDocument();
    expect(lastFieldNamed('probability')).toMatchObject({ type: 'percent', max: 100 });
  });

  it('control: a fraction-stored 1 (no `max`) reads 100%, and no `max` is invented', async () => {
    renderGallery(['won_share']);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(lastFieldNamed('won_share')).not.toHaveProperty('max');
  });
});
