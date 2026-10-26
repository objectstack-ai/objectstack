/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * element:text_input — the free-text data-entry element. Proves it:
 *   1. is registered in the ComponentRegistry;
 *   2. writes the typed value into the page variable bound by `source`;
 *   3. honors `inputType` (and coerces a number input to a numeric value);
 *   4. seeds `defaultValue` into an empty bound variable on mount;
 *   5. is safe to drop outside a Page (uncontrolled, never throws).
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, PageVariablesProvider, usePageVariables } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

// Reads a page variable back out so a test can assert what the input wrote.
function VarProbe({ name }: { name: string }) {
  const { variables } = usePageVariables();
  return <output data-testid={`var-${name}`}>{JSON.stringify(variables[name])}</output>;
}

describe('element:text_input', () => {
  it('is registered', () => {
    expect(ComponentRegistry.get('element:text_input')).toBeTruthy();
  });

  it('renders a labeled input and writes typed text into the bound page variable', () => {
    const { container, getByText, getByTestId } = render(
      <PageVariablesProvider definitions={[{ name: 'workspace', type: 'string', source: 'ws_input' }]}>
        <SchemaRenderer
          schema={{
            type: 'element:text_input',
            id: 'ws_input',
            properties: { label: 'Workspace', placeholder: 'acme' },
          }}
        />
        <VarProbe name="workspace" />
      </PageVariablesProvider>,
    );

    expect(getByText('Workspace')).toBeTruthy();
    const input = container.querySelector('input')!;
    expect(input).toBeTruthy();
    expect(input.getAttribute('placeholder')).toBe('acme');

    fireEvent.change(input, { target: { value: 'Acme Inc' } });
    expect(getByTestId('var-workspace').textContent).toBe(JSON.stringify('Acme Inc'));
  });

  it('applies inputType to the native input element', () => {
    const { container } = render(
      <PageVariablesProvider definitions={[{ name: 'email', type: 'string', source: 'e' }]}>
        <SchemaRenderer
          schema={{ type: 'element:text_input', id: 'e', properties: { inputType: 'email' } }}
        />
      </PageVariablesProvider>,
    );
    expect(container.querySelector('input')!.getAttribute('type')).toBe('email');
  });

  it('coerces a number input to a numeric page-variable value', () => {
    const { container, getByTestId } = render(
      <PageVariablesProvider definitions={[{ name: 'seats', type: 'number', source: 's' }]}>
        <SchemaRenderer
          schema={{ type: 'element:text_input', id: 's', properties: { inputType: 'number' } }}
        />
        <VarProbe name="seats" />
      </PageVariablesProvider>,
    );
    fireEvent.change(container.querySelector('input')!, { target: { value: '42' } });
    // JSON.stringify(42) === '42' (a number); a string would be '"42"'.
    expect(getByTestId('var-seats').textContent).toBe('42');
  });

  it('seeds defaultValue into an empty bound variable on mount', () => {
    const { getByTestId } = render(
      <PageVariablesProvider definitions={[{ name: 'sub', type: 'string', source: 'sd' }]}>
        <SchemaRenderer
          schema={{ type: 'element:text_input', id: 'sd', properties: { defaultValue: 'acme' } }}
        />
        <VarProbe name="sub" />
      </PageVariablesProvider>,
    );
    expect(getByTestId('var-sub').textContent).toBe(JSON.stringify('acme'));
  });

  it('renders without a binding (safe to drop outside a Page)', () => {
    const { getByTestId } = render(
      <SchemaRenderer
        schema={{ type: 'element:text_input', id: 'x', properties: { label: 'Name' } }}
      />,
    );
    expect(getByTestId('text-input')).toBeTruthy();
  });
});
