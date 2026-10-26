/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A multi-value select shows its authored `placeholder` while nothing is
 * selected, and hides it once anything is (objectui#11140).
 *
 * `MultiSelectField` read no `placeholder` at all, so a `select` + `multiple`
 * field (and a `multiselect` one) dropped the key the single-value branch
 * honours. These cases drive the widget directly. The catalog example that
 * authors the key is pinned through the real form in
 * `examples/schema-catalog/test/fields-select-multi-placeholder-11140.test.tsx`.
 */
import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MultiSelectField } from './MultiSelectField';

const PLACEHOLDER = 'Select tags...';

function tagsField(extra: Record<string, unknown> = {}) {
  return {
    name: 'tags',
    type: 'select',
    multiple: true,
    options: [
      { label: 'Frontend', value: 'frontend' },
      { label: 'Backend', value: 'backend' },
    ],
    ...extra,
  } as any;
}

/** A controlled host, so a click really changes the value the widget reads. */
function Host({ field, initial = [] as string[] }: { field: any; initial?: string[] }) {
  const [value, setValue] = useState<string[]>(initial);
  return <MultiSelectField value={value} onChange={setValue} field={field} {...({ name: 'tags' } as any)} />;
}

describe('MultiSelectField renders an authored placeholder while empty (objectui#11140)', () => {
  it('shows the placeholder inside the widget while nothing is selected', () => {
    render(<Host field={tagsField({ placeholder: PLACEHOLDER })} />);
    const container = screen.getByTestId('multiselect-tags');
    expect(container).toHaveTextContent(PLACEHOLDER);
    // The chips are still all there: the placeholder is added, nothing is replaced.
    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(2);
  });

  it('treats a null value as empty too', () => {
    render(
      <MultiSelectField
        value={null as unknown as string[]}
        onChange={vi.fn()}
        field={tagsField({ placeholder: PLACEHOLDER })}
        {...({ name: 'tags' } as any)}
      />,
    );
    expect(screen.getByTestId('multiselect-tags')).toHaveTextContent(PLACEHOLDER);
  });

  it('hides the placeholder after a pick, and shows it again once the pick is undone', () => {
    render(<Host field={tagsField({ placeholder: PLACEHOLDER })} />);
    const container = screen.getByTestId('multiselect-tags');
    fireEvent.click(screen.getByTestId('multiselect-option-frontend'));
    expect(screen.getByTestId('multiselect-option-frontend')).toHaveAttribute('aria-pressed', 'true');
    expect(container).not.toHaveTextContent(PLACEHOLDER);
    fireEvent.click(screen.getByTestId('multiselect-option-frontend'));
    expect(container).toHaveTextContent(PLACEHOLDER);
  });

  it('renders no placeholder when a value arrives already selected', () => {
    render(<Host field={tagsField({ placeholder: PLACEHOLDER })} initial={['backend']} />);
    expect(screen.getByTestId('multiselect-tags')).not.toHaveTextContent(PLACEHOLDER);
  });

  it('control: a field with no placeholder renders the chips and nothing else', () => {
    render(<Host field={tagsField()} />);
    const container = screen.getByTestId('multiselect-tags');
    const children = Array.from(container.children);
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.tagName === 'BUTTON')).toBe(true);
  });

  it('an empty-string placeholder counts as none, the way the single-value branch reads it', () => {
    render(<Host field={tagsField({ placeholder: '' })} />);
    const children = Array.from(screen.getByTestId('multiselect-tags').children);
    expect(children.every((c) => c.tagName === 'BUTTON')).toBe(true);
  });

  it('keeps the group named by the host label, not by the placeholder', () => {
    render(
      <>
        <label id="tags-label">Tags</label>
        <MultiSelectField
          value={[]}
          onChange={vi.fn()}
          field={tagsField({ placeholder: PLACEHOLDER })}
          {...({ name: 'tags', 'aria-labelledby': 'tags-label' } as any)}
        />
      </>,
    );
    const group = screen.getByRole('group', { name: 'Tags' });
    expect(group).toHaveAttribute('aria-labelledby', 'tags-label');
    expect(group).toHaveTextContent(PLACEHOLDER);
    // The placeholder carries no naming attribute and no id to be referenced by.
    const hint = Array.from(group.children).find((c) => c.tagName !== 'BUTTON')!;
    expect(hint).toHaveTextContent(PLACEHOLDER);
    expect(hint.getAttributeNames().filter((n) => n.startsWith('aria-') || n === 'id' || n === 'role')).toEqual([]);
  });

  it('readonly and empty is a different state: it renders the empty-value mark, not the placeholder', () => {
    const { container } = render(
      <MultiSelectField
        value={[]}
        onChange={vi.fn()}
        readonly
        field={tagsField({ placeholder: PLACEHOLDER })}
        {...({ name: 'tags' } as any)}
      />,
    );
    expect(container).not.toHaveTextContent(PLACEHOLDER);
    expect(container.querySelector('[data-slot="empty-value"]')).not.toBeNull();
  });
});
