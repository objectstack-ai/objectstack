/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12613 — the console's faces for `@object-ui/fields`' widget-hinted
 * reference keys name what the stored value references.
 *
 * Every case carries its control:
 *   - nothing is read per cell — each case counts the calls;
 *   - a record recipient is read by its EXACT id, so one past the picker's
 *     500-row candidate page is still named, with the fields the viewer may
 *     not read left out of its label;
 *   - a value nothing could name draws muted, never blank, and a face that
 *     could not ask (no row, no data source) draws the text it drew before;
 *   - the registration case goes through the REAL key a declared widget
 *     resolves to, so a face that is registered under the wrong key, or not at
 *     all, fails here rather than in a browser.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetadataCtx, SchemaRendererProvider, type MetadataContextValue } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig } from '@object-ui/types';
import { getCellRenderer, resolveCellRendererType, type CellRendererProps } from '@object-ui/fields';
// The faces are what the registration loads lazily; imported at module scope
// so the lazy factory below resolves at once (AGENTS.md, flaky-test rule).
import { ObjectRefCellFace, RecipientCellFace } from '../WidgetRefCellFaces';
import { ObjectRefCell, RecipientCell } from '../widget-ref-cell-renderers';

afterEach(() => cleanup());

const POSITIONS = [
  { name: 'sales_manager', label: 'Sales Manager' },
  { name: 'eu_sales_lead', label: 'EU Sales Lead' },
];

/** The registered objects, as the metadata store lists them: full definitions. */
const OBJECTS = [
  { name: 'crm_account', label: 'Account', icon: 'building' },
  { name: 'crm_contact', label: 'Contact' },
];

/** A metadata store answering `ensureType(type)` from `byType`. */
function metadataStore(
  byType: Record<string, unknown[]> = { position: POSITIONS, object: OBJECTS },
): MetadataContextValue & { ensureType: ReturnType<typeof vi.fn> } {
  return {
    apps: [], objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: vi.fn(async (type: string) => byType[type] ?? []),
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
}

/**
 * Six hundred users, and a `find` that answers the way the server does: an
 * `$in` over ids returns exactly those rows, and the picker's candidate query
 * (`$top: 500`, by name) returns only the first 500 — which `usr_550` is not in.
 */
const USERS = Array.from({ length: 600 }, (_, i) => ({
  id: `usr_${i}`,
  name: `User ${String(i).padStart(3, '0')}`,
  email: `user${i}@example.com`,
}));
function directorySource() {
  return {
    find: vi.fn(async (object: string, params: any) => {
      const rows = object === 'sys_user' ? USERS : object === 'sys_team' ? [{ id: 'team_eu', name: 'EU Sales' }] : [];
      const ids: string[] | undefined = params?.$filter?.id?.$in;
      return { data: ids ? rows.filter((r) => ids.includes(r.id)) : rows.slice(0, params?.$top ?? rows.length) };
    }),
  };
}

interface CellCase {
  value: unknown;
  dependentValues?: Record<string, unknown>;
}

function renderFaces(
  Face: React.FC<CellRendererProps>,
  cells: CellCase[],
  { dataSource, store }: { dataSource?: any; store?: MetadataContextValue | null } = {},
) {
  const body = (
    <SchemaRendererProvider dataSource={dataSource ?? null}>
      {cells.map((c, i) => (
        <div key={i} data-testid={`cell-${i}`}>
          <Face value={c.value} field={{ name: 'f', type: 'text' } as any} dependentValues={c.dependentValues} />
        </div>
      ))}
    </SchemaRendererProvider>
  );
  return render(store ? <MetadataCtx.Provider value={store}>{body}</MetadataCtx.Provider> : body);
}

const cell = (i: number) => screen.getByTestId(`cell-${i}`);
const unresolvedMark = (i: number) => cell(i).querySelector('[data-slot="unresolved-reference"]');

describe('objectui#12613 — the registered faces, through the key a declared widget resolves to', () => {
  it('registers both faces under the widget keys', () => {
    expect(getCellRenderer(resolveCellRendererType({ type: 'text', widget: 'object-ref' }))).toBe(ObjectRefCell);
    expect(getCellRenderer(resolveCellRendererType({ type: 'text', widget: 'recipient-picker' }))).toBe(RecipientCell);
  });

  it('a rule with recipient `sales_manager` renders "Sales Manager", and its object renders "Account"', async () => {
    const store = metadataStore();
    const ds = { find: vi.fn() };
    const ObjectCell = getCellRenderer(resolveCellRendererType({ type: 'text', widget: 'object-ref' }));
    const Recipient = getCellRenderer(resolveCellRendererType({ type: 'text', widget: 'recipient-picker' }));
    const row = { object_name: 'crm_account', recipient_type: 'position', recipient_id: 'sales_manager' };
    render(
      <MetadataCtx.Provider value={store}>
        <SchemaRendererProvider dataSource={ds as any}>
          <div data-testid="object">
            <ObjectCell value={row.object_name} field={{ name: 'object_name', type: 'object-ref' } as any} dependentValues={row} />
          </div>
          <div data-testid="recipient">
            <Recipient value={row.recipient_id} field={{ name: 'recipient_id', type: 'recipient-picker' } as any} dependentValues={row} />
          </div>
        </SchemaRendererProvider>
      </MetadataCtx.Provider>,
    );

    await waitFor(() => expect(screen.getByTestId('recipient')).toHaveTextContent('Sales Manager'));
    await waitFor(() => expect(screen.getByTestId('object')).toHaveTextContent('Account'));
    expect(screen.getByTestId('object').querySelector('[title]')?.getAttribute('title')).toBe('Account (crm_account)');
  });
});

describe('objectui#12613 — the `object-ref` face', () => {
  it("draws the object's icon and label, with the api name in the tooltip, from ONE store read", async () => {
    const store = metadataStore();
    renderFaces(ObjectRefCellFace, [{ value: 'crm_account' }, { value: 'crm_contact' }, { value: 'crm_account' }], {
      dataSource: { find: vi.fn() },
      store,
    });

    await waitFor(() => expect(cell(0)).toHaveTextContent('Account'));
    expect(cell(0)).not.toHaveTextContent('crm_account');
    expect(cell(0).querySelector('[title]')?.getAttribute('title')).toBe('Account (crm_account)');
    expect(cell(1)).toHaveTextContent('Contact');
    expect(cell(2)).toHaveTextContent('Account');
    // The icon the object declares, and the database glyph for one that names
    // none — the console's navigation draws an object the same way.
    await waitFor(() => expect(cell(0).querySelector('svg.lucide-building')).not.toBeNull());
    await waitFor(() => expect(cell(1).querySelector('svg.lucide-database')).not.toBeNull());
    expect(cell(1).querySelector('svg.lucide-building'), 'the icon is the object\'s own').toBeNull();
    expect(store.ensureType, 'one object-list read for every row, not one per cell').toHaveBeenCalledTimes(1);
    expect(store.ensureType).toHaveBeenCalledWith('object');
  });

  it('draws a name the store does not list as the raw value, muted — never blank', async () => {
    renderFaces(ObjectRefCellFace, [{ value: 'crm_account' }, { value: 'crm_retired' }], {
      dataSource: { find: vi.fn() },
      store: metadataStore(),
    });

    await waitFor(() => expect(cell(0)).toHaveTextContent('Account'));
    await waitFor(() => expect(unresolvedMark(1), 'the unknown name wears the unresolved mark').not.toBeNull());
    expect(cell(1)).toHaveTextContent('crm_retired');
    expect(unresolvedMark(0), 'the resolved one does not').toBeNull();
  });

  it('draws the stored text exactly as before outside a metadata store', () => {
    renderFaces(ObjectRefCellFace, [{ value: 'crm_account' }], { dataSource: { find: vi.fn() } });
    expect(cell(0)).toHaveTextContent('crm_account');
    expect(unresolvedMark(0)).toBeNull();
  });
});

describe('objectui#12613 — the `recipient-picker` face', () => {
  it('names position recipients through the registry, with one store read', async () => {
    const store = metadataStore();
    renderFaces(
      RecipientCellFace,
      [
        { value: 'sales_manager', dependentValues: { recipient_type: 'position' } },
        { value: 'eu_sales_lead', dependentValues: { recipient_type: 'position' } },
      ],
      { dataSource: { find: vi.fn() }, store },
    );

    await waitFor(() => expect(cell(0)).toHaveTextContent('Sales Manager'));
    expect(cell(0)).not.toHaveTextContent('sales_manager');
    expect(cell(1)).toHaveTextContent('EU Sales Lead');
    expect(store.ensureType).toHaveBeenCalledTimes(1);
    expect(store.ensureType).toHaveBeenCalledWith('position');
  });

  it('names record recipients by EXACT id — one past the first 500 candidates too — with one `$in` query per kind', async () => {
    const ds = directorySource();
    renderFaces(
      RecipientCellFace,
      [
        // Not in the picker's first page of 500 candidates by name.
        { value: 'usr_550', dependentValues: { recipient_type: 'user' } },
        { value: 'usr_7', dependentValues: { recipient_type: 'user' } },
        { value: 'team_eu', dependentValues: { recipient_type: 'team' } },
        { value: 'usr_gone', dependentValues: { recipient_type: 'user' } },
      ],
      { dataSource: ds },
    );

    await waitFor(() => expect(cell(0)).toHaveTextContent('User 550'));
    expect(cell(1)).toHaveTextContent('User 007');
    await waitFor(() => expect(cell(2)).toHaveTextContent('EU Sales'));
    await waitFor(() => expect(unresolvedMark(3)).not.toBeNull());
    expect(cell(3)).toHaveTextContent('usr_gone');

    // One query per kind for the whole page, each an exact-id read — never the
    // picker's `$top: 500` candidate query.
    expect(ds.find).toHaveBeenCalledTimes(2);
    const byObject = Object.fromEntries(ds.find.mock.calls.map(([object, params]: [string, any]) => [object, params]));
    expect([...byObject.sys_user.$filter.id.$in].sort()).toEqual(['usr_550', 'usr_7', 'usr_gone']);
    expect(byObject.sys_user.$top).toBe(3);
    expect(byObject.sys_team.$filter.id.$in).toEqual(['team_eu']);
  });

  it('leaves the fields the viewer may not read out of a record label, as the lookup picker does', async () => {
    const denyName: ObjectPermissionConfig[] = [
      {
        object: 'sys_user',
        roles: { viewer: { actions: ['read'], fieldPermissions: [{ field: 'name', read: false }] } },
      } as ObjectPermissionConfig,
    ];
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={denyName}>
        <SchemaRendererProvider dataSource={directorySource() as any}>
          <div data-testid="cell-0">
            <RecipientCellFace value="usr_550" field={{ name: 'f', type: 'text' } as any} dependentValues={{ recipient_type: 'user' }} />
          </div>
        </SchemaRendererProvider>
      </PermissionProvider>,
    );

    // `name` is denied, so the label falls through to the kind's next field.
    await waitFor(() => expect(cell(0)).toHaveTextContent('user550@example.com'));
    expect(cell(0)).not.toHaveTextContent('User 550');
  });

  it("names a `field` recipient by the shared object's user column label", async () => {
    const getObjectSchema = vi.fn(async () => ({
      name: 'crm_case',
      fields: {
        escalated_from: { type: 'user', label: 'Escalated from' },
        subject: { type: 'text', label: 'Subject' },
      },
    }));
    renderFaces(
      RecipientCellFace,
      [
        { value: 'escalated_from', dependentValues: { recipient_type: 'field', object_name: 'crm_case' } },
        // Not a user column: the evaluator grants nobody for it, so it is not
        // named as one.
        { value: 'subject', dependentValues: { recipient_type: 'field', object_name: 'crm_case' } },
      ],
      { dataSource: { find: vi.fn(), getObjectSchema } },
    );

    await waitFor(() => expect(cell(0)).toHaveTextContent('Escalated from'));
    await waitFor(() => expect(unresolvedMark(1)).not.toBeNull());
    expect(cell(1)).toHaveTextContent('subject');
    expect(getObjectSchema).toHaveBeenCalledTimes(1);
    expect(getObjectSchema).toHaveBeenCalledWith('crm_case');
  });

  it('draws a read the viewer is refused as the raw value, muted', async () => {
    const find = vi.fn(async () => {
      throw new Error('OBJECT_API_DISABLED');
    });
    renderFaces(RecipientCellFace, [{ value: 'usr_1', dependentValues: { recipient_type: 'user' } }], {
      dataSource: { find },
    });

    await waitFor(() => expect(unresolvedMark(0)).not.toBeNull());
    expect(cell(0)).toHaveTextContent('usr_1');
  });

  it('draws the stored text exactly as before when the call site passes no row', () => {
    const find = vi.fn();
    renderFaces(RecipientCellFace, [{ value: 'sales_manager' }], { dataSource: { find } });
    expect(cell(0)).toHaveTextContent('sales_manager');
    expect(unresolvedMark(0)).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });
});
