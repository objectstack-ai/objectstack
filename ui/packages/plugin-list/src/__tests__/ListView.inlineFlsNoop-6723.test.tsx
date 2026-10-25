/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6723, PIN 4 — the grid's new inline-data FLS gate is a NO-OP through
 * `ListView`, and that is measured here rather than assumed.
 *
 * ## Why this pin exists at all
 *
 * `ListView` filters its own `effectiveFields` through `checkField` before
 * forwarding, so the grid-side gate #6723 adds is redundant on this path. The
 * ruling keeps both ("redundancy is depth"), which makes "redundant" a claim
 * about behaviour that has to hold: adding a second gate must not change one
 * pixel of what this host renders.
 *
 * ## Why it cannot fire here — the mechanism, pinned by the assertions
 *
 * `ListView` reaches the grid two ways, and neither one arrives at the
 * inline-data branch carrying a declared-but-denied key:
 *
 *   - AUTHORED columns: it forwards `columns: effectiveFields` (already
 *     FLS-filtered) alongside the rows, and `generateColumns()` returns from
 *     the `normalizeColumns(schemaColumns)` branch before the inline-data
 *     branch is reached. Pinned below by exact header equality with the
 *     filtered projection.
 *   - UNAUTHORED: it forwards `fields: undefined, columns: undefined`
 *     (objectui#6598), so `rowKeysWouldOutrankSchemaPolicy` is true once the
 *     schema has loaded and the grid falls through to the OBJECT-SCHEMA path —
 *     the one that has always re-applied FLS. Pinned below by the absence of
 *     `Id`: `id` is `hidden: true`, which the object-schema policy drops and
 *     the inline-data path (row keys) would keep. That absence is what makes
 *     this case a mechanism assertion and not just a header count.
 *
 * ## Reading this file under ablation
 *
 * Every case here is green with the #6723 guard present AND with it removed —
 * that identity IS pin 4. The CONTROL case is what keeps the two denials above
 * from being vacuous: with no permission policy mounted, `Amount` renders in
 * both shapes, so the assertions measure the field gate rather than a render
 * that never produced the column.
 *
 * The grid here is the REAL `@object-ui/plugin-grid` renderer, not a stub: this
 * file is listed in `heavyDomTests` (vitest.config.mts), whose setup imports
 * plugin-grid for its side-effect registration — the same route
 * `ListView.crossPageSelectAll.test.tsx` and the two #6598 files take. A stub
 * grid cannot observe a no-op inside the grid.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { I18nProvider, SchemaRendererProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import { ListView } from '../ListView';
import type { ListViewSchema, ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';

const OBJECT = 'opportunity';

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

/**
 * `id` is `hidden: true` on purpose: the object-schema default-columns policy
 * drops it and the inline-data row-key derivation keeps it, so its presence or
 * absence tells the two grid paths apart from the outside.
 */
const OPPORTUNITY_FIELDS = {
  id: { type: 'text', label: 'Id', hidden: true },
  name: { type: 'text', label: 'Opportunity Name' },
  amount: { type: 'currency', label: 'Amount' },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({
      data: [{ id: 'o-1', name: 'Acme expansion', amount: 1000 }],
      total: 1,
      hasMore: false,
    })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({ name, label: 'Opportunity', fields: OPPORTUNITY_FIELDS }),
  } as any;
}

const listSchema = (over: Record<string, unknown> = {}): ListViewSchema =>
  ({ type: 'list-view', objectName: OBJECT, ...over }) as unknown as ListViewSchema;

/** Denies `amount` — a field the object DECLARES — to the current principal. */
const ROLES: RoleDefinition[] = [{ name: 'restricted', label: 'Restricted' }];
const DENY_AMOUNT: ObjectPermissionConfig[] = [
  {
    object: OBJECT,
    roles: {
      restricted: {
        actions: ['read'],
        fieldPermissions: [{ field: 'amount', read: false, write: false }],
      },
    },
  },
];

function renderList(schema: ListViewSchema, permissions?: ObjectPermissionConfig[]) {
  const ds = makeDataSource();
  const inner = (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </I18nProvider>
  );
  const utils = render(
    permissions
      ? (
        <PermissionProvider roles={ROLES} permissions={permissions} userRoles={['restricted']}>
          {inner}
        </PermissionProvider>
      )
      : inner,
  );
  return { ...utils, ds };
}

/** Data column headers in render order — furniture and the `#` index dropped. */
function dataHeaders(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('thead th'))
    .map((th) => (th.textContent ?? '').trim())
    .filter((text) => text.length > 0 && text !== '#');
}

describe('ListView-hosted grid — the #6723 inline-data FLS gate is a no-op here', () => {
  it('AUTHORED columns: the host pre-filtered, and the grid renders exactly what it was handed', async () => {
    const { container } = renderList(listSchema({ columns: ['name', 'amount'] }), DENY_AMOUNT);

    await waitFor(() => expect(screen.getByText('Acme expansion')).toBeInTheDocument());
    // `effectiveFields` already dropped `amount`, so the grid never sees it.
    await waitFor(() => expect(dataHeaders(container)).toEqual(['Opportunity Name']));
    expect(screen.queryByText('1,000.00')).toBeNull();
  });

  it('UNAUTHORED: the grid takes the OBJECT-SCHEMA path, whose own FLS gate is the one that answers', async () => {
    const { container } = renderList(listSchema(), DENY_AMOUNT);

    await waitFor(() => expect(screen.getByText('Acme expansion')).toBeInTheDocument());
    const headers = await waitFor(() => {
      const h = dataHeaders(container);
      expect(h.length).toBeGreaterThan(0);
      return h;
    });

    expect(headers).toContain('Opportunity Name');
    // The pre-existing object-schema gate dropped it.
    expect(headers).not.toContain('Amount');
    // MECHANISM: `id` is `hidden`, so the object-schema policy excludes it while
    // the inline-data row-key derivation would include it. Its absence is what
    // shows the inline branch (the one #6723 touches) did not run here.
    expect(headers).not.toContain('Id');
  });

  it('CONTROL: with no permission policy mounted, `Amount` renders in both shapes', async () => {
    // Without this the two denials above would also pass on a grid that failed
    // to render the column for some unrelated reason.
    const authored = renderList(listSchema({ columns: ['name', 'amount'] }));
    await waitFor(() => expect(dataHeaders(authored.container)).toEqual(['Opportunity Name', 'Amount']));
    cleanup();

    const unauthored = renderList(listSchema());
    await waitFor(() => expect(dataHeaders(unauthored.container)).toContain('Amount'));
    expect(dataHeaders(unauthored.container)).toContain('Opportunity Name');
  });
});
