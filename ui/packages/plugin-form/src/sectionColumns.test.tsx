/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: multi-column layout for *grouped* (sectioned) forms.
 *
 * Origin (#2128, "分组表单右侧永远空着"): the section variants wrapped the whole
 * inner <form> in a multi-column grid via `FormSection`. A grid with a single
 * child (the form) puts that form in the first cell and leaves every other
 * column permanently empty — the fields piled into the left column while the
 * right half of the group stayed blank.
 *
 * The fix moves the multi-column grid onto the FIELD container INSIDE the form
 * (columns + fieldContainerClass), mirroring the flat-fields path. These tests
 * pin BOTH the pure layout helper and the rendered DOM so the structural
 * contract — fields are the direct children of the multi-column grid, not a
 * lone <form> — can't silently regress.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';
import { TabbedForm } from './TabbedForm';
import { SplitForm } from './SplitForm';
import { sectionFormLayout } from './autoLayout';

registerAllFields();

describe('sectionFormLayout (pure)', () => {
  it('threads container-query grid onto the field container for a 2-column section', () => {
    const fields = [{ name: 'a' }, { name: 'b' }] as any;
    const out = sectionFormLayout(fields, 2);
    expect(out.columns).toBe(2);
    expect(out.fieldContainerClass).toContain('@md:grid-cols-2');
    // fields flow through (colSpan may be added for wide fields, count is stable)
    expect(out.fields).toHaveLength(2);
  });

  it('leaves a 1-column section on the default single-column stack (no grid class)', () => {
    const out = sectionFormLayout([{ name: 'a' }] as any, 1);
    expect(out.columns).toBe(1);
    expect(out.fieldContainerClass).toBeUndefined();
  });

  it('clamps oversized column counts to the 4-column ceiling', () => {
    const out = sectionFormLayout([{ name: 'a' }] as any, 9);
    expect(out.fieldContainerClass).toContain('@4xl:grid-cols-4');
  });
});

const makeDataSource = (): any => ({
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'lead',
    fields: {
      a: { type: 'text', label: 'Field A' },
      b: { type: 'text', label: 'Field B' },
      c: { type: 'text', label: 'Field C' },
      d: { type: 'text', label: 'Field D' },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: '1' }),
  findOne: vi.fn(),
});

afterEach(() => {
  cleanup();
});

/**
 * The form view's OWN `columns` is a spec key (view.zod FormView.columns), so a
 * sectioned host must honour it — and it OUTRANKS the per-section densities,
 * which describe how a section fills the grid rather than how wide the grid is.
 *
 * `ObjectForm` (simple path) and `ModalForm` already resolved it as
 * `explicit form columns ?? widest section ?? 1`. `TabbedForm` and `SplitForm`
 * read only the sections, so a view that declared `columns: 3` silently
 * rendered single-column in a tabbed or split form while the same metadata gave
 * 3 columns in a modal.
 */
describe('view-level `columns` outranks per-section columns', () => {
  const SECTIONS = [
    { name: 's1', label: 'One', fields: ['a', 'b'] },
    { name: 's2', label: 'Two', fields: ['c', 'd'] },
  ];

  it('TabbedForm honours the form view’s columns', async () => {
    render(
      <TabbedForm
        schema={{
          type: 'object-form',
          formType: 'tabbed',
          objectName: 'lead',
          mode: 'create',
          columns: 3,
          sections: SECTIONS,
        }}
        dataSource={makeDataSource()}
      />,
    );

    await waitFor(() => expect(document.body.querySelector('form')).toBeTruthy());
    expect(document.body.querySelector('[class*="@2xl:grid-cols-3"]')).not.toBeNull();
  });

  it('SplitForm honours the form view’s columns', async () => {
    render(
      <SplitForm
        schema={{
          type: 'object-form',
          formType: 'split',
          objectName: 'lead',
          mode: 'create',
          columns: 3,
          sections: SECTIONS,
        }}
        dataSource={makeDataSource()}
      />,
    );

    await waitFor(() => expect(document.body.querySelector('form')).toBeTruthy());
    expect(document.body.querySelector('[class*="@2xl:grid-cols-3"]')).not.toBeNull();
  });

  it('falls back to the widest section when the view declares no columns', async () => {
    render(
      <SplitForm
        schema={{
          type: 'object-form',
          formType: 'split',
          objectName: 'lead',
          mode: 'create',
          sections: [
            { name: 's1', label: 'One', columns: 2, fields: ['a', 'b'] },
            { name: 's2', label: 'Two', fields: ['c', 'd'] },
          ],
        }}
        dataSource={makeDataSource()}
      />,
    );

    await waitFor(() => expect(document.body.querySelector('form')).toBeTruthy());
    expect(document.body.querySelector('[class*="@md:grid-cols-2"]')).not.toBeNull();
    expect(document.body.querySelector('[class*="@2xl:grid-cols-3"]')).toBeNull();
  });
});

describe('ModalForm — grouped section multi-column layout (#2128)', () => {
  it('renders a 2-column section grid whose direct children are the fields, not a lone <form>', async () => {
    render(
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'lead',
          mode: 'create',
          title: 'New Lead',
          sections: [
            { name: 's1', label: '项目状态信息', columns: 2, fields: ['a', 'b', 'c', 'd'] },
          ],
        }}
        dataSource={makeDataSource()}
      />,
    );

    const root = document.body;
    await waitFor(() => {
      expect(root.textContent).toContain('项目状态信息');
    });

    // The multi-column grid must be the FIELD container inside the form.
    const grid = root.querySelector('[class*="@md:grid-cols-2"]');
    expect(grid).not.toBeNull();

    // Regression guard: the grid's direct children are the four fields — NOT a
    // single <form> element (the old bug, which left the right column empty).
    // The section's inline header row (a virtual `section-divider`, #2959) is
    // the grid's only other child, so count the field wrappers rather than all
    // children.
    expect(grid!.querySelectorAll(':scope > [data-field]').length).toBe(4);
    expect(grid!.querySelector(':scope > form')).toBeNull();

    // And no ancestor grid wraps the whole form in a multi-column grid anymore.
    const form = root.querySelector('form');
    expect(form).not.toBeNull();
    const wrapper = form!.parentElement;
    expect(wrapper?.className || '').not.toContain('@md:grid-cols-2');
  });
});
