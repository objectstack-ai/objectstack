// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that the Permission preview no longer renders the retired lifecycle
 * bits `allowRestore` / `allowPurge`, nor lints over them (objectui#6595).
 *
 * The preview is the reviewer's read of a permission set, so it carried two
 * columns and one sanity check ("Purge (hard delete) granted without Delete")
 * for keys whose `restore` / `purge` ObjectQL operations have never existed —
 * a dispatched restore/purge is denied unconditionally by the evaluator's
 * fail-closed destructive-operation backstop. `@objectstack/spec` retired both
 * as `retiredKey()` tombstones (objectstack#12497; maintainer ruling
 * 2026-08-26 accepting objectstack#1883 recommendation B, ADR-0049
 * enforce-or-remove); they return with the M2 lifecycle initiative, whose
 * restart is recorded on objectstack#1883.
 *
 * The lint is the half worth stating: a warning over a key that can no longer
 * be granted cannot fire for a real reason, but it CAN fire for a stored
 * legacy value — telling a reviewer to go fix a grant the authoring surface no
 * longer offers, with no control to fix it with.
 *
 * Every assertion here carries its falsification in the same render: the
 * capability set is pinned whole (so a live column cannot go missing behind a
 * green "no Restore column"), and the retired lint's removal is measured on a
 * draft that still trips the lints that stayed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PermissionPreview } from './PermissionPreview';

afterEach(cleanup);

/** Capability columns, in matrix order — the whole set, not a sample. */
const LIVE_CAPS = ['C', 'R', 'U', 'D', 'E', 'T', 'V*', 'M*'];

function renderPreview(objects: Record<string, unknown>) {
  return render(
    <PermissionPreview
      type="permission"
      name="sales_rep"
      locale="en-US"
      draft={{ name: 'sales_rep', label: 'Sales Rep', objects }}
    />,
  );
}

describe('PermissionPreview · retired lifecycle keys (objectui#6595)', () => {
  it('renders exactly the live capability columns — Restore and Purge are gone', () => {
    renderPreview({ opportunity: { allowRead: true } });

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim() ?? '');
    // Object + capabilities + Scope.
    expect(headers.slice(1, -1)).toEqual(LIVE_CAPS);
    expect(screen.queryByTitle('Restore')).toBeNull();
    expect(screen.queryByTitle('Purge')).toBeNull();
    // Falsification: the neighbours of the two removed rows must survive —
    // `allowTransfer` is enforced upstream and explicitly stays, and
    // `allowExport` sits directly beside it (objectstack#4115 added it).
    expect(screen.getByTitle('Transfer')).toBeTruthy();
    expect(screen.getByTitle('Export')).toBeTruthy();
  });

  it('drops the "Purge without Delete" lint while the surviving lints still fire', () => {
    // A stored legacy grant, exactly the shape that used to trip the lint:
    // purge granted, delete not. Typed loosely because the key is retired —
    // once the spec bump lands, `ObjectPermission` will not name it.
    renderPreview({
      opportunity: { allowRead: true, allowEdit: true, allowPurge: true, modifyAllRecords: true },
    });

    expect(screen.queryByText(/Purge \(hard delete\) granted without Delete/)).toBeNull();

    // Falsification in the same render: the lints that stayed still fire, so
    // the assertion above cannot pass merely because the banner is missing.
    expect(screen.getByText(/Modify All without View All/)).toBeTruthy();
  });

  it('renders a stored legacy value as no column at all, not as a granted chip', () => {
    renderPreview({ opportunity: { allowRead: true, allowRestore: true, allowPurge: true } });

    const row = screen.getByText('opportunity').closest('tr')!;
    // Object + 8 capabilities + Scope. A stale key adds no cell: it is not a
    // capability this surface knows, so it renders nowhere rather than as an
    // unlabelled grant.
    expect(row.querySelectorAll('td')).toHaveLength(LIVE_CAPS.length + 2);
  });
});
