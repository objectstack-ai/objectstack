// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PermissionPreview ↔ spec `ObjectPermission` (objectstack#4115).
 *
 * The preview used to declare its own 9-key `ObjectPermission` interface, a
 * hand copy of the spec's 12-key one. The three it omitted were not cosmetic:
 * `allowExport` and the ADR-0057 access-depth axis (`readScope`/`writeScope`).
 * A permission set granting export, or writing wider than it reads, rendered
 * identically to one that did neither — the reviewer had no way to see it.
 *
 * These tests pin the three formerly-invisible fields. The typing is what
 * keeps them honest going forward: `CAPS` is keyed by
 * `keyof ObjectPermission`, so a capability the spec renames breaks the build
 * rather than silently vanishing from the matrix.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { PermissionPreview } from './PermissionPreview';

afterEach(cleanup);

const baseProps = { type: 'permission', name: 'sales_rep', locale: 'en-US' as const };

function renderPreview(objects: Record<string, unknown>) {
  return render(
    <PermissionPreview
      {...baseProps}
      draft={{ name: 'sales_rep', label: 'Sales Rep', objects }}
    />,
  );
}

describe('PermissionPreview surfaces the spec fields the hand copy omitted', () => {
  it('renders an Export column — allowExport used to be undeclared entirely', () => {
    renderPreview({ opportunity: { allowRead: true, allowExport: true } });
    const header = screen.getByTitle('Export');
    expect(header).toBeTruthy();
    expect(header.textContent).toBe('E');
  });

  it('shows the read/write access depth instead of dropping it', () => {
    renderPreview({ opportunity: { allowRead: true, readScope: 'unit', writeScope: 'own' } });
    const row = screen.getByText('opportunity').closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    const scopeCell = cells[cells.length - 1];
    expect(scopeCell.textContent).toContain('unit');
    expect(scopeCell.textContent).toContain('own');
  });

  it('marks an object with no scopes set as using the default', () => {
    renderPreview({ opportunity: { allowRead: true } });
    const row = screen.getByText('opportunity').closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[cells.length - 1].textContent).toBe('default');
  });
});

describe('scope warnings (same class as Modify-All without View-All)', () => {
  it('warns when the write scope is wider than the read scope', () => {
    // Editable-but-invisible records: the reviewer needs this called out, and
    // before the spec fields were declared the preview could not even see it.
    renderPreview({ opportunity: { allowRead: true, allowEdit: true, readScope: 'own', writeScope: 'unit' } });
    expect(screen.getByText(/Write scope \(unit\) is wider than read scope \(own\)/)).toBeTruthy();
  });

  it('stays quiet when write is no wider than read', () => {
    renderPreview({ opportunity: { allowRead: true, allowEdit: true, readScope: 'org', writeScope: 'own' } });
    expect(screen.queryByText(/wider than read scope/)).toBeNull();
  });

  it('stays quiet when neither scope is set', () => {
    renderPreview({ opportunity: { allowRead: true, allowEdit: true } });
    expect(screen.queryByText(/wider than read scope/)).toBeNull();
  });

  it('still reports the pre-existing capability warnings', () => {
    renderPreview({ opportunity: { allowEdit: true, modifyAllRecords: true } });
    expect(screen.getByText(/Edit granted without Read/)).toBeTruthy();
    expect(screen.getByText(/Modify All without View All/)).toBeTruthy();
  });
});
