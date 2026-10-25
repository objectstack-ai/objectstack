/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression (create modal ignored the object's form view): the "New <object>"
 * modal rendered every field from the raw object schema, in schema order,
 * ignoring the curated sections + field selection/order defined in the object's
 * default FORM VIEW.
 *
 * This pins the END-TO-END contract the fix relies on: resolve the form-view
 * layout from the object definition (exactly as `AppContent`'s global New/Edit
 * modal and `useActionModal` now do) and feed it to the real `<ModalForm>`. The
 * modal must then render ONLY the curated fields — proving the view drives the
 * create form, not the raw schema. The resolver's own branch coverage lives in
 * `utils/__tests__/recordFormNavigation.test.ts`; this test guards the wiring +
 * rendering so the two can't silently drift back to "show every field".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from '@object-ui/plugin-form';
import { resolveFormViewLayout } from '../../utils/recordFormNavigation';
import { mergeViewsIntoObjects } from '../../providers/MetadataProvider';

registerAllFields();

// An object whose RAW schema (what `getObjectSchema` returns) has three fields…
const makeDataSource = (): any => ({
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'project',
    fields: {
      title: { type: 'text', label: 'Title' },
      summary: { type: 'textarea', label: 'Summary' },
      // …plus a field the form view deliberately leaves OUT.
      secret_internal: { type: 'text', label: 'Secret Internal' },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: '1' }),
  findOne: vi.fn(),
});

// …but whose DEFAULT FORM VIEW curates only two of them, grouped under a section
// and re-ordered (summary before title) relative to the schema.
const objectDef = {
  name: 'project',
  form: {
    type: 'simple',
    sections: [
      { name: 'basics', label: 'Basics', fields: [{ field: 'summary' }, { field: 'title' }] },
    ],
  },
};

beforeEach(() => vi.clearAllMocks());

describe('create modal honors the object form view (sections + field selection)', () => {
  it('renders only the curated fields, not the whole object schema', async () => {
    // Exactly what AppContent / useActionModal now do: resolve the form-view
    // layout from the object definition and spread it into the modal schema.
    const layout = resolveFormViewLayout(objectDef as any);
    expect(layout.sections).toHaveLength(1);

    render(
      <ModalForm
        schema={{
          objectName: 'project',
          mode: 'create',
          title: 'New Project',
          open: true,
          onOpenChange: vi.fn(),
          ...layout,
        } as any}
        dataSource={makeDataSource()}
      />,
    );

    // The curated section header + both selected fields render…
    await waitFor(() => expect(screen.getByText('Basics')).toBeTruthy());
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Summary')).toBeTruthy();

    // …and the field the form view omitted is absent. Before the fix the modal
    // fell back to the raw object schema and rendered all three (incl. this one).
    expect(screen.queryByText('Secret Internal')).toBeNull();
  });

  it('falls back to the full schema when the object declares no form view', async () => {
    // No `form` / `formViews` → resolver returns {}, the modal keeps its prior
    // behavior (flat list from the raw schema). This is the un-curated baseline
    // the fix must NOT change.
    const layout = resolveFormViewLayout({ name: 'project' } as any);
    expect(layout).toEqual({});

    render(
      <ModalForm
        schema={{
          objectName: 'project',
          mode: 'create',
          title: 'New Project',
          open: true,
          onOpenChange: vi.fn(),
          ...layout,
        } as any}
        dataSource={makeDataSource()}
      />,
    );

    // Every schema field is present, including the one a form view would curate out.
    await waitFor(() => expect(screen.getByText('Title')).toBeTruthy());
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Secret Internal')).toBeTruthy();
  });

  it('takes that same path when the object serves only NAMED forms, never the first named one (objectui#11539)', async () => {
    // A container with no `form` serves its named forms with no `isDefault`
    // (the `showcase_inquiry` shape: one named, public contact-us form). The
    // merge leaves `.form` unset, so the create modal renders the object's own
    // fields, not the named form's curated section.
    const [merged] = mergeViewsIntoObjects([{ name: 'project', fields: {} }], [{
      name: 'project.contact',
      object: 'project',
      viewKind: 'form',
      config: {
        type: 'simple',
        sections: [{ name: 'contact_us', label: 'Contact us', fields: [{ field: 'title' }] }],
        sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/contact-us' },
      },
    }]);
    const layout = resolveFormViewLayout(merged);
    expect(layout).toEqual({});

    render(
      <ModalForm
        schema={{
          objectName: 'project',
          mode: 'create',
          title: 'New Project',
          open: true,
          onOpenChange: vi.fn(),
          ...layout,
        } as any}
        dataSource={makeDataSource()}
      />,
    );

    await waitFor(() => expect(screen.getByText('Title')).toBeTruthy());
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Secret Internal')).toBeTruthy();
    expect(screen.queryByText('Contact us')).toBeNull();
  });
});
