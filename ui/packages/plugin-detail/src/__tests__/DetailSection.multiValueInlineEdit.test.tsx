/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Multi-value fields in inline edit (the pencil affordance on a detail page).
 *
 * Regression: `DetailSection`'s field enrichment copied a hand-written key
 * whitelist that never included `multiple`, so a lookup declared
 * `multiple: true` reached the picker as a SINGLE-select field — picking a
 * record replaced the value and closed the popover, making it impossible to
 * select more than one. The read cell showed one chip for the same reason.
 *
 * The enrichment now goes through the shared `enrichDetailField`, which carries
 * `multiple` (and the rest of the picker configuration) from the object schema.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

const tags = [
  { id: 't1', name: 'Urgent' },
  { id: 't2', name: 'Backlog' },
];

function makeDataSource() {
  const find = vi.fn(async () => ({ data: tags, total: tags.length }));
  return { find } as any;
}

const objectSchema = {
  fields: {
    tags: {
      type: 'lookup',
      reference: 'tags',
      // objectui#7155 — the spec spelling; `display_field` is no longer
      // enriched onto the inline-edit field meta.
      displayField: 'name',
      multiple: true,
    },
    priority: {
      type: 'select',
      multiple: true,
      options: [
        { label: 'High', value: 'high' },
        { label: 'Low', value: 'low' },
      ],
    },
  },
};

const section = {
  fields: [{ name: 'tags', label: 'Tags' }],
} as DetailViewSection;

/**
 * Stand-in for `DetailView`'s inline-edit state: it merges the draft back into
 * `data` on every change, exactly as `{ ...data, ...editedValues }` does, so a
 * second pick sees the first one.
 */
function EditingHost({
  onChange,
  initial,
  fields = section,
}: {
  onChange: (name: string, value: any) => void;
  initial: Record<string, any>;
  fields?: DetailViewSection;
}) {
  const [data, setData] = React.useState(initial);
  return (
    <DetailSection
      section={fields}
      data={data}
      objectSchema={objectSchema}
      dataSource={makeDataSource()}
      isEditing
      onFieldChange={(name, value) => {
        setData((prev) => ({ ...prev, [name]: value }));
        onChange(name, value);
      }}
    />
  );
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* happy-dom */
  }
});

describe('DetailSection inline edit — multi-value lookup', () => {
  it('accumulates picks instead of replacing the previous one', async () => {
    const onChange = vi.fn();
    render(<EditingHost onChange={onChange} initial={{ tags: [] }} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('lookup-trigger-tags'));
    });

    await waitFor(() => expect(screen.getByRole('option', { name: /Urgent/ })).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Urgent/ }));
    });
    expect(onChange).toHaveBeenLastCalledWith('tags', ['t1']);

    // The popover stays open in multi mode — the second pick must ADD to the
    // value, which is the exact step that was impossible before the fix.
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Backlog/ }));
    });
    expect(onChange).toHaveBeenLastCalledWith('tags', ['t1', 't2']);
  });

  it('renders every selected record as a chip, including `$expand`-ed values', async () => {
    render(
      <EditingHost
        onChange={vi.fn()}
        initial={{ tags: [{ id: 't1', name: 'Urgent' }, { id: 't2', name: 'Backlog' }] }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Urgent')).toBeInTheDocument();
      expect(screen.getByText('Backlog')).toBeInTheDocument();
    });
  });

  it('renders a multi-value picklist as the chip picker, not a stringified value', async () => {
    const onChange = vi.fn();
    render(
      <EditingHost
        onChange={onChange}
        initial={{ priority: ['high'] }}
        fields={{ fields: [{ name: 'priority', label: 'Priority' }] } as DetailViewSection}
      />,
    );

    // A single-select dropdown would have coerced the array through String();
    // the multi picker offers every option as a toggleable chip.
    const high = screen.getByTestId('multiselect-option-high');
    expect(high).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('multiselect-option-low')).toHaveAttribute('aria-pressed', 'false');

    await act(async () => {
      fireEvent.click(screen.getByTestId('multiselect-option-low'));
    });
    expect(onChange).toHaveBeenLastCalledWith('priority', ['high', 'low']);
  });
});
