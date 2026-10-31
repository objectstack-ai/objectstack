/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28255: a gallery card's percent field carries its authored
 * `percentDisplay` to the shared cell renderer, as Grid and Detail do.
 *
 * `buildEnrichedField` copies the field def key by key; the key rides beside
 * `useGrouping`. Driven through the real `ObjectGallery` render and asserted
 * on what the card draws, with a same-shape control field that carries no key.
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
    // A probability, not progress: the author asks for the plain face.
    probability: { type: 'percent', label: 'Probability', percentDisplay: 'plain' },
    // The control: no key, so the bar stays.
    completion: { type: 'percent', label: 'Completion' },
  },
};

const data = [{ id: 'a1', name: 'Acme Corp', probability: 0.25, completion: 0.6 }];

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
          objectName: 'deal',
          gallery: { titleField: 'name', visibleFields: ['probability', 'completion'] },
        }}
      />
    </SchemaRendererProvider>,
  );
};

describe('ObjectGallery — the authored percentDisplay reaches the card cell (objectstack#28255)', () => {
  it('draws the plain probability with no bar, and the control with its bar', async () => {
    const { container } = renderGallery();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    // CONTROL first, BY VALUE: the card drew its percent cells at all.
    expect(await screen.findByText('60%')).toBeInTheDocument();
    expect(container.textContent).toContain('25%');
    const bars = Array.from(container.querySelectorAll('[role="progressbar"]'));
    expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['60']);
  });
});
