// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26597 — the preview's field-level section lists EVERY entry the
 * set declares, by what it declares: hidden, read-only or editable. A
 * read-only entry is a rule the write gate enforces, so it is never hidden as
 * a "default"; a field the set has no entry for follows the object grant and
 * is not listed.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PermissionPreview } from './PermissionPreview';

afterEach(cleanup);

function renderPreview(fields: Record<string, unknown>) {
  return render(
    <PermissionPreview
      type="permission"
      name="project_editor"
      locale="en-US"
      draft={{
        name: 'project_editor',
        objects: { project: { allowRead: true, allowCreate: true, allowEdit: true } },
        fields,
      }}
    />,
  );
}

const chip = (field: string) => screen.getByText(field).closest('li');

describe('PermissionPreview lists every declared field entry (objectstack#26597)', () => {
  it('tags each entry by what it declares', () => {
    renderPreview({
      'project.budget': { readable: false, editable: false },
      'project.notes': { readable: true, editable: false },
      'project.name': { readable: true, editable: true },
    });
    expect(chip('budget')).toHaveTextContent(/hidden/);
    expect(chip('notes')).toHaveTextContent(/read-only/);
    expect(chip('name')).toHaveTextContent(/editable/);
    expect(chip('name')).not.toHaveTextContent(/read-only/);
  });

  it('a row-conditioned entry names its condition', () => {
    renderPreview({ 'project.notes': { readable: true, editable: false, when: "status == 'approved'" } });
    expect(chip('notes')).toHaveAttribute('title', "readable=true, editable=false, when=status == 'approved'");
  });

  it('a set with no field entries draws no field section', () => {
    renderPreview({});
    expect(screen.queryByText('Field-Level Overrides')).toBeNull();
    expect(screen.queryByText(/read-only/)).toBeNull();
  });
});
