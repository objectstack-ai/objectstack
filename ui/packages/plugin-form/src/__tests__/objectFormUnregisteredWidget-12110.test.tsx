/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The real door for objectui#12110 item 2 (finding A-03): an object field
 * `{ type: 'rating', widget: 'star_rating' }` rendered by `ObjectForm`.
 *
 * `star_rating` is a name nothing registers. The spec's `FieldSchema.widget`
 * says such a name "Degrades to the `type` renderer when unregistered", and
 * the `type` renderer of a `rating` is the star widget the fields package
 * registers as `field:rating`. The form drew a plain text box instead.
 *
 * Importing `ObjectForm` pulls `@object-ui/fields` in, whose module body
 * registers every `field:*` widget — the ordinary route.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

import { ObjectForm } from '../ObjectForm';

const makeDataSource = (objectSchema: unknown) => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'r1', ...d })),
  update: vi.fn(),
  findOne: vi.fn(),
});

function mount(objectSchema: unknown) {
  return render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'crm_survey', mode: 'create' } as any}
      dataSource={makeDataSource(objectSchema) as any}
    />,
  );
}

describe('ObjectForm — `widget: star_rating` degrades to the rating widget (objectui#12110 item 2)', () => {
  it('THE DEFECT — draws five stars, not a text box', async () => {
    const { container } = mount({
      name: 'crm_survey',
      fields: {
        title: { type: 'text', label: 'Title' },
        score: { type: 'rating', label: 'Score', max: 5, widget: 'star_rating' },
      },
    });
    await waitFor(() => {
      if (!container.querySelector('input[name="title"]')) throw new Error('form not ready');
    });
    await waitFor(() => expect(container.querySelectorAll('svg.lucide-star')).toHaveLength(5));
    expect(container.querySelector('input[name="score"]')).toBeNull();
  });

  it('CONTROL: the same field without a widget hint draws the same five stars', async () => {
    const { container } = mount({
      name: 'crm_survey',
      fields: {
        title: { type: 'text', label: 'Title' },
        score: { type: 'rating', label: 'Score', max: 5 },
      },
    });
    await waitFor(() => {
      if (!container.querySelector('input[name="title"]')) throw new Error('form not ready');
    });
    await waitFor(() => expect(container.querySelectorAll('svg.lucide-star')).toHaveLength(5));
  });
});
