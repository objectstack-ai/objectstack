/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `filter-builder` renderer calls `onChange` with the shape
 * `FilterBuilderSchema.onChange` declares: the `FilterGroup` itself (#26382).
 *
 * It used to call it with a form-style `{ target: { name, value } }` event
 * while the schema declared `(filter: FilterGroup) => void`, and an `any` on
 * the renderer's own `onChange` kept the compiler from seeing the gap. A
 * handler written from the declaration read `.logic` / `.conditions` off the
 * event and got `undefined`.
 *
 * The renderer is invoked DIRECTLY from the registry, as the sibling
 * `inline-locale-label-read-sites.test.tsx` does, so the assertion reads what
 * the renderer itself hands over and not what `SchemaRenderer` adds around it.
 */

import * as React from 'react';
import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
import type { FilterBuilderSchema, FilterGroup } from '@object-ui/types';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const FIELDS = [
  { value: 'name', label: 'Name', type: 'text' },
  { value: 'age', label: 'Age', type: 'number' },
];

const VALUE: FilterGroup = {
  id: 'root',
  logic: 'or',
  conditions: [{ id: 'c1', field: 'name', operator: 'equals', value: 'Ada' }],
};

function renderDirect(props: Record<string, unknown>) {
  const C = ComponentRegistry.get('filter-builder') as React.ComponentType<any>;
  return render(
    <I18nProvider persistLanguage={false}>
      <C {...props} />
    </I18nProvider>,
  );
}

describe('filter-builder renderer hands onChange the declared FilterGroup (#26382)', () => {
  it('calls onChange with the group, not with a { target } event', () => {
    const onChange = vi.fn<(filter: FilterGroup) => void>();
    renderDirect({
      schema: { type: 'filter-builder', name: 'filters', fields: FIELDS, value: VALUE },
      onChange,
    });

    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const [group] = onChange.mock.calls[0];
    expect(group).not.toHaveProperty('target');
    expect(group.logic).toBe('or');
    expect(group.conditions.map((c) => c.id)[0]).toBe('c1');
    expect(group.conditions).toHaveLength(2);
    expect(group.conditions[1]).toMatchObject({ field: 'name', operator: 'equals' });
  });

  it('calls a handler authored on the node itself the same way', () => {
    const onChange = vi.fn<(filter: FilterGroup) => void>();
    renderDirect({
      schema: { type: 'filter-builder', name: 'filters', fields: FIELDS, value: VALUE },
      // `SchemaRenderer` spreads the node's own keys as props, so a typed node
      // that authors `onChange` reaches the renderer through the same prop.
      ...({ onChange } satisfies Pick<FilterBuilderSchema, 'onChange'>),
    });

    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));

    expect(onChange.mock.calls[0][0].conditions).toHaveLength(2);
  });

  it('keeps a host-forwarded extraOperators out of the builder, so exists / notExists are never offered', async () => {
    // `extraOperators` is the builder's only operator-granting prop, and what it
    // grants is outside the FilterGroup that onChange declares. A host that
    // forwards it through the node must not widen the dropdown.
    renderDirect({
      schema: { type: 'filter-builder', name: 'filters', fields: FIELDS, value: VALUE },
      extraOperators: ['exists', 'notExists'],
      onChange: vi.fn<(filter: FilterGroup) => void>(),
    });

    // The row's controls are Radix comboboxes in field / operator / value
    // order, so index 1 is the operator.
    fireEvent.keyDown(screen.getAllByRole('combobox')[1], { key: 'ArrowDown' });
    const labels = await waitFor(() => {
      const options = screen.getAllByRole('option').map((o) => o.textContent);
      expect(options, 'the operator dropdown did not open').toContain('Is empty');
      return options;
    });
    expect(labels).not.toContain('Is set');
    expect(labels).not.toContain('Is not set');
  });

  it('skips the emit, and names the operator on the console, for a stored row the FilterGroup cannot carry', () => {
    const onChange = vi.fn<(filter: FilterGroup) => void>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Off contract on purpose: `exists` is the builder's opt-in operator, not
    // a protocol one, and the zod mirror refuses it in an authored `value`.
    // A stored value that skipped that validation is the one way in left.
    const offContract = {
      ...VALUE,
      conditions: [{ id: 'c1', field: 'name', operator: 'exists' }],
    };
    try {
      renderDirect({
        schema: { type: 'filter-builder', name: 'filters', fields: FIELDS, value: offContract },
        onChange,
      });

      fireEvent.click(screen.getByRole('button', { name: /add filter/i }));

      expect(onChange).not.toHaveBeenCalled();
      const messages = consoleError.mock.calls.map((args) => String(args[0]));
      expect(messages.filter((m) => m.startsWith('filter-builder: onChange not called'))).toHaveLength(1);
      expect(messages.join('\n')).toMatch(/operator "exists", which is outside the protocol/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('pins the declared signature at the type level', () => {
    expectTypeOf<NonNullable<FilterBuilderSchema['onChange']>>().parameter(0).toEqualTypeOf<FilterGroup>();

    // @ts-expect-error — the form-style event the renderer used to send is not the declared argument.
    const eventHandler: NonNullable<FilterBuilderSchema['onChange']> = (event: { target: { name?: string; value: unknown } }) => {
      void event.target.value;
    };
    expect(typeof eventHandler).toBe('function');
  });
});
