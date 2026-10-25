/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Toaster position ↔ spec vocabulary parity + behavior (#2942).
 *
 * The `toaster` block used to mount `<SonnerToaster />` bare with
 * `inputs: []` — all six `NotificationPositionSchema` values (and `limit`)
 * validated and were discarded.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import '@testing-library/jest-dom';
import { NotificationPositionSchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import { renderComponent } from './test-utils';
import { TOASTER_POSITIONS } from '../renderers/feedback/toaster';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

// Sonner defers mounting its DOM container, so the behavior tests assert on
// the props our registration hands it rather than sonner internals.
vi.mock('../ui/sonner', () => ({
  Toaster: (props: { position?: string; visibleToasts?: number }) => (
    <div data-testid="sonner-mock" data-position={props.position} data-limit={props.visibleToasts} />
  ),
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warning: () => undefined,
  }),
}));

describe('toaster covers the spec notification-position vocabulary', () => {
  const specNames: string[] = enumOptions(NotificationPositionSchema);

  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read NotificationPositionSchema.options from the spec').not.toEqual([]);
  });

  it('maps every spec position onto a sonner position', () => {
    const unmapped = specNames.filter((name) => !(name in TOASTER_POSITIONS));
    expect(unmapped, 'these validate and then the toaster discards them').toEqual([]);
  });

  it('maps only spec positions and the ToasterSchema hyphen dialect', () => {
    const sonnerIds = new Set(Object.values(TOASTER_POSITIONS));
    const extra = Object.keys(TOASTER_POSITIONS).filter(
      (name) => !specNames.includes(name) && !sonnerIds.has(name as never),
    );
    expect(extra, 'unexpected renderer-local position dialect').toEqual([]);
  });
});

describe('toaster behavior', () => {
  it('a spec underscore position (and limit) reaches sonner translated', () => {
    const { getByTestId } = renderComponent({ type: 'toaster', position: 'top_center', limit: 3 } as any);
    const toaster = getByTestId('sonner-mock');
    expect(toaster).toHaveAttribute('data-position', 'top-center');
    expect(toaster).toHaveAttribute('data-limit', '3');
  });

  it('the hyphen dialect keeps working', () => {
    const { getByTestId } = renderComponent({ type: 'toaster', position: 'bottom-left' } as any);
    expect(getByTestId('sonner-mock')).toHaveAttribute('data-position', 'bottom-left');
  });
});
