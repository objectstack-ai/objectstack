/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12242 — an object field's visibility is `visibleWhen`, the spelling
 * `@objectstack/spec`'s `FieldSchema` declares, and only that spelling.
 *
 * `ObjectForm`'s object-field builder carried the snake_case `visible_on` onto
 * the runtime field as a view-level gate, beside the `visibleWhen` it carries
 * as the field-level rule. The spec refuses `visible_on` by name ("did you mean
 * `visible_on` → `visibleWhen`?") and `BaseFieldMetadata` types it `never`, so
 * the read retired with no alias: the same predicate under `visible_on` now
 * gates nothing.
 *
 * Every row mounts the real `ObjectForm` (the default arm, no sections) over a
 * data source that serves the object, with the real field registry.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { FieldSchema } from '@objectstack/spec/data';

import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();
afterEach(cleanup);

const PREDICATE = "record.customer == 'show'";

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    spec_gated: { type: 'text', label: 'Spec gated', visibleWhen: PREDICATE },
    snake_gated: { type: 'text', label: 'Snake gated', visible_on: PREDICATE },
  },
};

const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'r1', ...d })),
  update: vi.fn(),
  findOne: vi.fn(),
});

const inputOf = (c: HTMLElement, name: string) => c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;

describe('ObjectForm reads `visibleWhen` and not `visible_on` (objectui#12242)', () => {
  it('CONTROL — the spec accepts `visibleWhen` on the field and refuses `visible_on` by name', () => {
    expect(FieldSchema.safeParse({ name: 'spec_gated', ...OBJECT_SCHEMA.fields.spec_gated }).success).toBe(true);
    const snake = FieldSchema.safeParse({ name: 'snake_gated', ...OBJECT_SCHEMA.fields.snake_gated });
    expect(snake.success).toBe(false);
    expect(
      !snake.success
        && snake.error.issues.some(
          (i) => i.code === 'unrecognized_keys' && ((i as { keys?: string[] }).keys ?? []).includes('visible_on'),
        ),
    ).toBe(true);
  });

  it('`visibleWhen` gates the field until the record satisfies it; the same predicate under `visible_on` gates nothing', async () => {
    const { container } = render(
      <ObjectForm schema={{ type: 'object-form', objectName: 'invoice', mode: 'create' } as any} dataSource={makeDS() as any} />,
    );
    await waitFor(() => expect(inputOf(container, 'customer')).not.toBeNull());

    // The predicate is false for the empty create record.
    expect(inputOf(container, 'spec_gated'), 'visibleWhen hides the field while the predicate is false').toBeNull();
    expect(inputOf(container, 'snake_gated'), 'visible_on is no gate: the field is drawn').not.toBeNull();

    // The live control: the predicate turns true and the spec-gated field
    // appears, so its absence above is a gate that evaluates, not a field
    // that was never drawn.
    fireEvent.change(inputOf(container, 'customer') as HTMLInputElement, { target: { value: 'show' } });
    await waitFor(() => expect(inputOf(container, 'spec_gated')).not.toBeNull());
    expect(inputOf(container, 'snake_gated')).not.toBeNull();
  });
});
