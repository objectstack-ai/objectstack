// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

/**
 * ADR-0047 follow-up — page inspector section visibility for `list` pages.
 *
 * Framework PR #1817 marks the page form's "Data Context" (object/variables)
 * and "Layout" (regions) sections with `visibleOn: "data.type != 'list'"` (now
 * `visibleWhen`, see the note below),
 * and the "Interface (list pages)" section with `data.type == 'list'`. For a
 * `type: 'list'` page the data-view sections must hide and the Interface
 * section must show.
 *
 * This test pins the renderer side of that contract: given the PR-#1817 form
 * shape and a draft carrying `type: 'list'`, `SectionedSchemaForm` evaluates
 * each predicate against `value` and renders the right sections. (The bug
 * report's "still shows Data Context + Layout" symptom turned out to be a
 * stale backend serving the pre-#1817 form.)
 *
 * NOTE (objectstack#6331, objectui#12696): PR #1817 spelled these predicates
 * `visibleOn`, the ADR-0089 alias that `@objectstack/spec` 18 retires and that
 * `SchemaForm` no longer reads. The fixtures below spell the canonical
 * `visibleWhen`, the shape a current backend serves. The bundled `pageForm`
 * itself is pinned in `SchemaForm.visibleWhen.test.tsx`.
 */

// Minimal JSONSchema mirroring the page item fields the form references.
const pageSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    type: { type: 'string', title: 'Type' },
    object: { type: 'string', title: 'Object' },
    variables: { type: 'array', title: 'Variables', items: { type: 'object' } },
    regions: { type: 'array', title: 'Regions', items: { type: 'object' } },
    interfaceConfig: { type: 'object', title: 'Interface Config' },
  },
};

// FormView mirroring framework PR #1817 (packages/spec/src/ui/page.form.ts).
const pageForm = {
  type: 'simple' as const,
  sections: [
    { label: 'Basics', fields: [{ field: 'name' }, { field: 'type' }] },
    {
      label: 'Data Context',
      visibleWhen: "data.type != 'list'",
      fields: [{ field: 'object' }, { field: 'variables' }],
    },
    {
      label: 'Layout',
      visibleWhen: "data.type != 'list'",
      fields: [{ field: 'regions' }],
    },
    {
      label: 'Interface (list pages)',
      // Mirror the framework's collapsed-by-default + CEL dialect shape so we
      // exercise the same predicate path the backend serves.
      collapsible: true,
      collapsed: false,
      visibleWhen: { dialect: 'cel', source: "data.type == 'list'" },
      fields: [{ field: 'interfaceConfig' }],
    },
  ],
};

describe('SchemaForm — page inspector section visibility (ADR-0047 / #1817)', () => {
  it('a list page hides Data Context + Layout and shows the Interface section', () => {
    render(
      <SchemaForm
        schema={pageSchema}
        form={pageForm}
        value={{ name: 'showcase_task_workbench', type: 'list' }}
        onChange={() => {}}
      />,
    );
    // Always-visible identity section.
    expect(screen.getByText('Basics')).toBeInTheDocument();
    // `data.type != 'list'` → false for a list page → hidden.
    expect(screen.queryByText('Data Context')).not.toBeInTheDocument();
    expect(screen.queryByText('Layout')).not.toBeInTheDocument();
    // `data.type == 'list'` → true → shown.
    expect(screen.getByText('Interface (list pages)')).toBeInTheDocument();
  });

  it('a non-list (record) page shows Data Context + Layout and hides the Interface section', () => {
    render(
      <SchemaForm
        schema={pageSchema}
        form={pageForm}
        value={{ name: 'some_record_page', type: 'record' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Data Context')).toBeInTheDocument();
    expect(screen.getByText('Layout')).toBeInTheDocument();
    expect(screen.queryByText('Interface (list pages)')).not.toBeInTheDocument();
  });
});
