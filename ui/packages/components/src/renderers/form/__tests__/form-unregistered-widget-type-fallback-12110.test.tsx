/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An unregistered `widget` degrades to the `type` renderer (objectui#12110
 * item 2, finding A-03 of the HotCRM browser pass).
 *
 * `@objectstack/spec`'s `FieldSchema.widget` promises it in its own
 * description: "names a registered field component (resolved as
 * `field:<widget>`) … Degrades to the `type` renderer when unregistered." The
 * form renderer resolved `widget || type` and stopped there, so a `rating`
 * field declaring `widget: 'star_rating'` — a name nothing registers — fell
 * past the registered `field:rating` widget to the default text input.
 *
 * Probes stand in for the field widgets (the fields package owns the real ones;
 * components tests never load it), registered under the keys the renderer
 * resolves.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import '../../../renderers';

function RatingProbe(props: any) {
  return <div data-testid="rating-probe">{String(props.value ?? '')}</div>;
}
function StarsProbe() {
  return <div data-testid="stars-probe" />;
}

beforeAll(() => {
  ComponentRegistry.register('field:rating', RatingProbe, { namespace: 'test' });
  ComponentRegistry.register('field:registered_stars', StarsProbe, { namespace: 'test' });
});

function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />,
  );
}

describe('form renderer — an unregistered widget degrades to the type renderer (objectui#12110 item 2)', () => {
  it('THE DEFECT — `widget: star_rating` on a rating field renders the rating widget, not a text box', () => {
    const { container } = renderForm([
      { name: 'score', label: 'Score', type: 'field:rating', widget: 'star_rating' },
    ]);
    expect(screen.getByTestId('rating-probe')).toBeTruthy();
    expect(container.querySelector('input[name="score"]')).toBeNull();
  });

  it('the same degrade when the hint rides on the field metadata, not the form config', () => {
    const { container } = renderForm([
      { name: 'score', label: 'Score', type: 'field:rating', field: { type: 'rating', widget: 'star_rating' } },
    ]);
    expect(screen.getByTestId('rating-probe')).toBeTruthy();
    expect(container.querySelector('input[name="score"]')).toBeNull();
  });

  it('CONTROL: a REGISTERED widget still wins over the type', () => {
    renderForm([
      { name: 'score', label: 'Score', type: 'field:rating', widget: 'registered_stars' },
    ]);
    expect(screen.getByTestId('stars-probe')).toBeTruthy();
    expect(screen.queryByTestId('rating-probe')).toBeNull();
  });

  it('CONTROL: a built-in control name is a renderable widget and still wins', () => {
    const { container } = renderForm([
      { name: 'score', label: 'Score', type: 'field:rating', widget: 'textarea' },
    ]);
    expect(container.querySelector('textarea[name="score"]')).not.toBeNull();
    expect(screen.queryByTestId('rating-probe')).toBeNull();
  });
});
