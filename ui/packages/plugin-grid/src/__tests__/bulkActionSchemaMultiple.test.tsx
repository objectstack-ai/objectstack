/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Schema-aware multi-value semantics for bulk-edit params (#2204).
 *
 * The dialog used to be schema-blind: single/multi shape depended solely on
 * the hand-written `BulkActionParam.multiple` flag. A view author targeting a
 * multiselect field who forgot `multiple: true` got a single-select control
 * and a SCALAR patch — silently corrupting the column shape server-side
 * (until framework #2552 added a server-side wrap, the scalar was stored
 * verbatim). Now the target object's schema is the fallback: param.multiple
 * (explicit boolean) wins, otherwise `update` params derive multi-ness from
 * the field definition, and the executor shape-normalizes every patch.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { renderHook, act } from '@testing-library/react';

import { BulkActionDialog } from '../components/BulkActionDialog';
import { useBulkExecutor } from '../hooks/useBulkExecutor';
import { hasMultiValueShape, normalizeMultiValuePatch } from '../hooks/multiValueFields';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
});

function makeDataSource() {
  const update = vi.fn(async () => ({}));
  const del = vi.fn(async () => ({}));
  return { update, delete: del } as any;
}

describe('hasMultiValueShape', () => {
  it('recognizes inherently-multi types', () => {
    expect(hasMultiValueShape({ type: 'multiselect' })).toBe(true);
    expect(hasMultiValueShape({ type: 'checkboxes' })).toBe(true);
    expect(hasMultiValueShape({ type: 'tags' })).toBe(true);
  });

  it('recognizes multiple-flagged select/lookup/user/file/image', () => {
    for (const type of ['select', 'radio', 'lookup', 'user', 'file', 'image']) {
      expect(hasMultiValueShape({ type, multiple: true })).toBe(true);
      expect(hasMultiValueShape({ type })).toBe(false);
    }
  });

  it('is false for single-value and unknown shapes', () => {
    expect(hasMultiValueShape({ type: 'text' })).toBe(false);
    expect(hasMultiValueShape({ type: 'text', multiple: true })).toBe(false);
    expect(hasMultiValueShape(undefined)).toBe(false);
    expect(hasMultiValueShape({})).toBe(false);
  });
});

describe('normalizeMultiValuePatch', () => {
  const fields = {
    labels: { type: 'multiselect' },
    team_members: { type: 'user', multiple: true },
    status: { type: 'select' },
  };

  it('wraps scalars aimed at multi-value fields, leaves the rest alone', () => {
    const patch = { labels: 'frontend', team_members: 'u1', status: 'active', note: 'x' };
    expect(normalizeMultiValuePatch(patch, fields)).toEqual({
      labels: ['frontend'],
      team_members: ['u1'],
      status: 'active',
      note: 'x',
    });
    // Input is not mutated.
    expect(patch.labels).toBe('frontend');
  });

  it('passes arrays/null through and no-ops without a schema', () => {
    const patch = { labels: ['a', 'b'], team_members: null };
    expect(normalizeMultiValuePatch(patch, fields)).toBe(patch);
    expect(normalizeMultiValuePatch({ labels: 'x' }, undefined)).toEqual({ labels: 'x' });
  });
});

describe('BulkActionDialog — schema fallback when param.multiple is omitted (#2204)', () => {
  it('renders the multi-select control and patches an ARRAY for a multiselect field', async () => {
    const ds = makeDataSource();
    // NOTE: no `multiple` on the param — the pre-#2204 bug scenario.
    const def: any = {
      name: 'set_labels',
      label: 'Set labels',
      operation: 'update',
      params: [
        {
          name: 'labels',
          label: 'Labels',
          type: 'select',
          required: true,
          options: [
            { label: 'Frontend', value: 'frontend' },
            { label: 'Design', value: 'design' },
          ],
        },
      ],
    };
    render(
      <BulkActionDialog
        def={def}
        rows={[{ id: 'r1' }, { id: 'r2' }]}
        resource="showcase_project"
        dataSource={ds}
        open
        onClose={() => {}}
        objectFields={{ labels: { type: 'multiselect' } }}
      />,
    );

    // Schema says multi → the shared MultiSelectField (toggle chips) renders,
    // not a single-select trigger that collapses to one value.
    await screen.findByTestId('multiselect-labels');
    fireEvent.click(screen.getByTestId('multiselect-option-frontend'));
    fireEvent.click(screen.getByTestId('multiselect-option-design'));

    const next = screen.getByRole('button', { name: 'Next' });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    expect(ds.update).toHaveBeenCalledWith('showcase_project', 'r1', { labels: ['frontend', 'design'] });
  });

  it('keeps single-select when the target field is single-value (non-regression)', () => {
    const ds = makeDataSource();
    const def: any = {
      name: 'set_status',
      label: 'Set status',
      operation: 'update',
      params: [
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: [{ label: 'Active', value: 'active' }],
        },
      ],
    };
    render(
      <BulkActionDialog
        def={def}
        rows={[{ id: 'r1' }]}
        resource="showcase_project"
        dataSource={ds}
        open
        onClose={() => {}}
        objectFields={{ status: { type: 'select' } }}
      />,
    );
    // Single Select trigger renders (no multi Popover button with badges).
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Radix Select trigger exposes data-slot/select semantics distinct from
    // the multi control's outline Button; the reliable signal is that
    // clicking does NOT render the Command search input used by multi-select.
    fireEvent.click(trigger);
    expect(document.querySelector('[cmdk-input]')).not.toBeInTheDocument();
  });

  it('an explicit param.multiple=false wins over the schema, but the executor still ships an array', async () => {
    const ds = makeDataSource();
    const def: any = {
      name: 'set_primary_label',
      label: 'Set primary label',
      operation: 'update',
      params: [
        {
          name: 'labels',
          label: 'Label',
          type: 'select',
          multiple: false,
          options: [{ label: 'Frontend', value: 'frontend' }],
        },
      ],
    };
    render(
      <BulkActionDialog
        def={def}
        rows={[{ id: 'r1' }]}
        resource="showcase_project"
        dataSource={ds}
        open
        onClose={() => {}}
        objectFields={{ labels: { type: 'multiselect' } }}
      />,
    );

    // Author forced single-select UI…
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Frontend'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    // …but the patch is still shape-normalized to an array for the
    // multiselect column (mirrors the framework #2552 server behavior).
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('showcase_project', 'r1', { labels: ['frontend'] });
  });
});

describe('useBulkExecutor — patch shape normalization (#2204)', () => {
  it('wraps a scalar def.patch value aimed at a multi-value field', async () => {
    const update = vi.fn(async () => ({}));
    const ds = { update, delete: vi.fn() };
    const def: any = {
      name: 'tag_frontend',
      operation: 'update',
      patch: { labels: 'frontend' },
    };
    const { result } = renderHook(() =>
      useBulkExecutor({
        resource: 'showcase_project',
        dataSource: ds,
        objectFields: { labels: { type: 'multiselect' } },
      }),
    );

    await act(async () => {
      await result.current.run(def, [{ id: '1' }], {});
    });

    expect(update).toHaveBeenCalledWith('showcase_project', '1', { labels: ['frontend'] });
  });

  it('retry re-sends the normalized (array) patch', async () => {
    let fail = true;
    const update = vi.fn(async () => {
      if (fail) throw new Error('boom');
      return {};
    });
    const ds = { update, delete: vi.fn() };
    const def: any = { name: 'tag', operation: 'update', patch: {} };
    const { result } = renderHook(() =>
      useBulkExecutor({
        resource: 'showcase_project',
        dataSource: ds,
        objectFields: { team_members: { type: 'user', multiple: true } },
      }),
    );

    await act(async () => {
      await result.current.run(def, [{ id: '1' }], { team_members: 'u1' });
    });
    expect(result.current.result?.failed).toBe(1);

    fail = false;
    update.mockClear();
    await act(async () => {
      await result.current.retry('1');
    });
    expect(update).toHaveBeenCalledWith('showcase_project', '1', { team_members: ['u1'] });
  });
});
