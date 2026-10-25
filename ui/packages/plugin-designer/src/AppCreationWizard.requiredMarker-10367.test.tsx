/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10367 — the wizard's basic step keeps the required `*` out of the
 * App name / Title inputs' accessible names, and exposes the requirement as a
 * STATE.
 *
 * Both labels (`htmlFor` `app-name` / `app-title`) carried a bare `*` span, so
 * the inputs were named "App Name *" and "Title *", and neither input carried
 * `required` or `aria-required`. The objectui#10178 / objectui#3299 shape is
 * the fix: the marker is `aria-hidden`, and `aria-required` goes on the input.
 * Not native `required`: the wizard gates its own Next / Create, so each
 * required case asserts native `required` stays absent.
 *
 * Rendered without an I18nProvider, so the labels are the English defaults of
 * `useDesignerTranslation` ("App Name", "Title").
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppCreationWizard } from './AppCreationWizard';

afterEach(cleanup);

describe('objectui#10367 — AppCreationWizard keeps the required `*` out of the accessible name', () => {
  it('App name and Title are found by their bare labels and report required', () => {
    const { container } = render(<AppCreationWizard />);

    // The card's named probe: these lookups missed while the names ended in `*`.
    for (const name of ['App Name', 'Title']) {
      const input = screen.getByRole('textbox', { name });
      expect(input).toBeRequired();
      expect(input).toHaveAttribute('aria-required', 'true');
      expect(input).not.toHaveAttribute('required');
    }

    // Both markers are still drawn, and neither is announced.
    const markers = Array.from(container.querySelectorAll('[data-required-marker]'));
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker).toHaveTextContent('*');
      expect(marker).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('CONTROL — the optional Description field carries no aria-required', () => {
    render(<AppCreationWizard />);
    const description = screen.getByRole('textbox', { name: 'Description' });
    expect(description).not.toBeRequired();
    expect(description).not.toHaveAttribute('aria-required');
  });
});
