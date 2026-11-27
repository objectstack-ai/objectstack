// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34908 (ruling 7103739693, letter B) — 「Who sees this view」.
 *
 * What is pinned:
 *   - the catalog: the capabilities offered are the ones the registry declares
 *     and every name a permission set grants (a closed list), each with the
 *     sets granting it; a position holds what the sets it grants IN FORCE
 *     grant, as `?include=grants` serves them (never its raw `permissionSets`);
 *     an undecorated or failed position read leaves the positions unknown;
 *   - the preview: a position is listed when its sets grant EVERY picked
 *     capability (the gate is all-of); nothing picked is no gate;
 *   - the create card's shared scope: the corrected hint, the picker offered
 *     only for a shared view and only from the catalog, its position preview,
 *     the open view's gate as the starting pick, and the pick on the request;
 *     a failed catalog read adds nothing (no free text); a picked gate says it
 *     applies to the creator too;
 *   - the host: the picked gate replaces the one the open view would hand on,
 *     an empty pick writes no key, and no picker leaves the body as before;
 *   - the Studio form widget `ref-multi:capability`: the closed list (no
 *     typed-name box on any arm), each option with its granting sets, and the
 *     same preview under it; it reads the catalog through the host's loader
 *     once it is on screen, so a closed section sends no request.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
// The source under test reaches these through dynamic imports (the capability
// lint, the CEL authoring helpers); pay their first load during collection, not
// inside a case's clocked window.
import '@objectstack/lint';
import '@objectstack/formula';
import { render, cleanup, fireEvent, waitFor, screen, within, act, renderHook } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// One client for every render: a fresh object per call would re-run every
// effect keyed on the client (the card's dataset binding), render after render.
const client = { list: async () => [] };
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import {
  buildCapabilityAudience,
  loadCapabilityAudience,
  positionsReached,
  type CapabilityAudience,
} from './capabilityAudience';
import { CreateViewCard, type InPlaceViewRequest } from './CreateViewDialog';
import { useCreateViewInPlace } from './objectViewViewCrud';
import { SchemaForm } from './metadata-admin/SchemaForm';
import { formDeclaresWidget } from './metadata-admin/widgets';
import { getViewForm } from './metadata-admin/view-schema';

afterEach(cleanup);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));

const CAPABILITIES = [{ name: 'view_deal_sales', label: '客户视图·业务员' }, { item: { name: 'view_deal_finance' } }];
const PERMISSION_SETS = [
  { name: 'sales_rep_set', systemPermissions: ['view_deal_sales', 'export_reports'] },
  { name: 'sales_lead_set', systemPermissions: ['view_deal_sales', 'view_deal_finance'] },
  { name: 'finance_set', systemPermissions: ['view_deal_finance'] },
];
// As `GET /meta/position?include=grants` serves them: `_grantedPermissionSets`
// is the server's answer (the sets in force); the raw `permissionSets` a
// position names is NOT what the preview reads — `paused_lead` names a set
// but grants none (switched off), and `accountant` names one that is not served.
const grants = (...sets: string[]) => sets.map((name) => ({ name, via: 'definition' }));
const POSITIONS = [
  { name: 'sales_rep', label: '业务员', permissionSets: ['sales_rep_set'], _grantedPermissionSets: grants('sales_rep_set') },
  { name: 'sales_lead', label: '销售主管', permissionSets: ['sales_lead_set'], _grantedPermissionSets: grants('sales_lead_set') },
  { name: 'accountant', permissionSets: ['finance_set', 'missing_set'], _grantedPermissionSets: grants('finance_set') },
  { name: 'paused_lead', permissionSets: ['sales_lead_set'], _grantedPermissionSets: [] },
];

const AUDIENCE = buildCapabilityAudience(CAPABILITIES, PERMISSION_SETS, POSITIONS);

describe('the audience catalog', () => {
  it('offers the declared capabilities and every one a permission set grants, each with the sets granting it', () => {
    expect(AUDIENCE.capabilities).toEqual([
      { name: 'export_reports', grantedBy: ['sales_rep_set'] },
      { name: 'view_deal_finance', grantedBy: ['finance_set', 'sales_lead_set'] },
      { name: 'view_deal_sales', label: '客户视图·业务员', grantedBy: ['sales_lead_set', 'sales_rep_set'] },
    ]);
  });

  it('a position holds what the sets it grants IN FORCE (as served) grant, never what its raw definition names', () => {
    expect(AUDIENCE.positions).toEqual([
      { name: 'accountant', capabilities: ['view_deal_finance'] },
      { name: 'paused_lead', capabilities: [] },
      { name: 'sales_lead', label: '销售主管', capabilities: ['view_deal_finance', 'view_deal_sales'] },
      { name: 'sales_rep', label: '业务员', capabilities: ['export_reports', 'view_deal_sales'] },
    ]);
  });

  it('a position list served without its grants leaves the positions unknown, never joined in the browser', () => {
    const undecorated = POSITIONS.map(({ _grantedPermissionSets: _served, ...raw }) => raw);
    expect(buildCapabilityAudience(CAPABILITIES, PERMISSION_SETS, undecorated).positions).toBeNull();
  });

  it('the preview lists a position only when its sets grant EVERY picked capability; nothing picked is no gate', () => {
    const positions = AUDIENCE.positions!;
    expect(positionsReached([], positions)).toBeNull();
    expect(positionsReached(['view_deal_sales'], positions)!.map((p) => p.name)).toEqual(['sales_lead', 'sales_rep']);
    expect(positionsReached(['view_deal_sales', 'view_deal_finance'], positions)!.map((p) => p.name)).toEqual(['sales_lead']);
    expect(positionsReached(['nobody_has_this'], positions)).toEqual([]);
  });

  it('reads the positions with their served grants', async () => {
    const list = vi.fn(async (type: string, _options?: { include?: 'grants' }) =>
      (type === 'capability' ? CAPABILITIES : type === 'permission' ? PERMISSION_SETS : POSITIONS) as unknown[]);
    const audience = await loadCapabilityAudience({ list });
    expect(list).toHaveBeenCalledWith('position', { include: 'grants' });
    expect(positionsReached(['view_deal_sales'], audience.positions!)!.map((p) => p.name)).toEqual(['sales_lead', 'sales_rep']);
  });

  it('a failed position read keeps the catalog and leaves the positions unknown; a failed capability read fails the load', async () => {
    const fine = await loadCapabilityAudience({
      list: async (type) => {
        if (type === 'position') throw new Error('403');
        return type === 'capability' ? CAPABILITIES : PERMISSION_SETS;
      },
    });
    expect(fine.capabilities.map((c) => c.name)).toContain('view_deal_sales');
    expect(fine.positions).toBeNull();
    await expect(loadCapabilityAudience({
      list: async (type) => {
        if (type === 'capability') throw new Error('boom');
        return [];
      },
    })).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// The create card's shared scope
// ---------------------------------------------------------------------------

function mountCard(props: Partial<React.ComponentProps<typeof CreateViewCard>> = {}) {
  const onCreate = vi.fn(async (_request: InPlaceViewRequest) => true);
  render(
    <CreateViewCard
      objectDef={{ name: 'crm_deal', label: 'Deal', fields: { name: { type: 'text', label: 'Name' } } }}
      existingLabels={['All deals']}
      existingKeys={['crm_deal.all']}
      availableTypes={['grid']}
      canCreatePersonal
      canCreateShared
      hasUnsavedConditions={false}
      onCreate={onCreate}
      onBack={() => {}}
      {...props}
    />,
  );
  return { onCreate };
}

const submit = () => screen.getByTestId('create-view-card-submit');
const toShared = () => fireEvent.click(screen.getByTestId('create-view-card-scope-shared'));

async function addCapability(name: string) {
  fireEvent.keyDown(screen.getByTestId('view-audience-add'), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByTestId(`view-audience-option-${name}`));
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

describe('the create card: who sees a shared view', () => {
  it('the shared hint no longer claims everyone sees every shared view', () => {
    mountCard();
    toShared();
    expect(screen.getByTestId('create-view-card-shared-hint').textContent).toMatch(/unless the view is limited to the holders of a capability/);
  });

  it('the picker is offered for a shared view only, and the catalog is read only then', async () => {
    const loadAudience = vi.fn(async () => AUDIENCE);
    mountCard({ loadAudience });
    await settle();
    expect(screen.queryByTestId('view-audience-picker')).toBeNull();
    expect(loadAudience).not.toHaveBeenCalled();
    toShared();
    expect(screen.getByTestId('view-audience-picker')).toBeInTheDocument();
    await waitFor(() => expect(loadAudience).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('view-audience-preview').textContent).toBe('Everyone who can see this list');
  });

  it('offers only the known capabilities, with their sets, and previews the positions that will see the view', async () => {
    const { onCreate } = mountCard({ loadAudience: async () => AUDIENCE });
    toShared();
    await settle();
    fireEvent.keyDown(screen.getByTestId('view-audience-add'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((o) => o.getAttribute('data-testid'))).toEqual([
      'view-audience-option-export_reports',
      'view-audience-option-view_deal_finance',
      'view-audience-option-view_deal_sales',
    ]);
    expect(within(listbox).getByTestId('view-audience-option-view_deal_sales').textContent).toContain('Granted by sales_lead_set, sales_rep_set');
    fireEvent.click(within(listbox).getByTestId('view-audience-option-view_deal_sales'));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByTestId('view-audience-preview').textContent).toBe('销售主管, 业务员 will see this view');
    await addCapability('view_deal_finance');
    expect(screen.getByTestId('view-audience-preview').textContent).toBe('销售主管 will see this view');
    fireEvent.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({ scope: 'shared', requiredPermissions: ['view_deal_sales', 'view_deal_finance'] });
  });

  it('a pick no position holds says who is left', async () => {
    mountCard({ loadAudience: async () => AUDIENCE, initialRequiredPermissions: ['export_reports', 'view_deal_finance'] });
    toShared();
    await settle();
    expect(screen.getByTestId('view-audience-preview').textContent).toBe(
      'No position holds every picked capability: only people granted them directly will see this view',
    );
  });

  it('while a gate is picked, it says the gate applies to the creator too; with none picked it says nothing of the kind', async () => {
    mountCard({ loadAudience: async () => AUDIENCE });
    toShared();
    await settle();
    expect(screen.queryByTestId('view-audience-self')).toBeNull();
    await addCapability('view_deal_sales');
    expect(screen.getByTestId('view-audience-self').textContent).toMatch(/^This applies to you too/);
  });

  it('starts from the open view\'s gate, which can be removed: the request then carries an empty gate', async () => {
    const { onCreate } = mountCard({ loadAudience: async () => AUDIENCE, initialRequiredPermissions: ['view_deal_sales'] });
    toShared();
    await settle();
    expect(screen.getByTestId('view-audience-picked-view_deal_sales')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('view-audience-picked-view_deal_sales')).getByRole('button'));
    fireEvent.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].requiredPermissions).toEqual([]);
  });

  it('a failed catalog read says so and offers nothing to type or pick', async () => {
    mountCard({ loadAudience: async () => { throw new Error('denied'); } });
    toShared();
    await settle();
    expect(screen.getByTestId('view-audience-load-failed').textContent).toContain('denied');
    expect(screen.queryByTestId('view-audience-add')).toBeNull();
    expect(within(screen.getByTestId('view-audience-picker')).queryByRole('textbox')).toBeNull();
  });

  it('CONTROL: a personal view, or a host with no catalog, sends no gate', async () => {
    const first = mountCard({ loadAudience: async () => AUDIENCE });
    fireEvent.click(submit());
    await waitFor(() => expect(first.onCreate).toHaveBeenCalledTimes(1));
    expect(first.onCreate.mock.calls[0][0]).not.toHaveProperty('requiredPermissions');
    cleanup();
    const second = mountCard();
    toShared();
    expect(screen.queryByTestId('view-audience-picker')).toBeNull();
    fireEvent.click(submit());
    await waitFor(() => expect(second.onCreate).toHaveBeenCalledTimes(1));
    expect(second.onCreate.mock.calls[0][0]).not.toHaveProperty('requiredPermissions');
  });
});

// ---------------------------------------------------------------------------
// The host: the picked gate decides the new shared view's body
// ---------------------------------------------------------------------------

describe('useCreateViewInPlace: the picked gate', () => {
  const GATED = { id: 'crm_deal.mine', name: 'mine', label: 'Mine', type: 'grid', columns: ['name'], requiredPermissions: ['view_deal_finance'] };
  const t = ((key: string) => key) as never;

  function setup() {
    const createShared = vi.fn(async (_body: Record<string, unknown>) => true);
    const { result } = renderHook(() => useCreateViewInPlace({
      objectName: 'crm_deal',
      activeView: GATED,
      readListState: () => ({ url: {} }),
      savePersonal: vi.fn(async () => 'pv'),
      openPersonal: vi.fn(),
      createShared,
      t,
    }));
    return { create: result.current, createShared };
  }
  const request = (requiredPermissions?: string[]): InPlaceViewRequest => ({
    config: { type: 'grid', label: 'Sales', name: 'sales' },
    scope: 'shared',
    includeCurrent: false,
    ...(requiredPermissions ? { requiredPermissions } : {}),
  });

  it('a pick replaces the gate the open view would hand on', async () => {
    const { create, createShared } = setup();
    await create(request(['view_deal_sales']));
    expect(createShared.mock.calls[0][0].requiredPermissions).toEqual(['view_deal_sales']);
  });

  it('an empty pick writes no gate at all', async () => {
    const { create, createShared } = setup();
    await create(request([]));
    expect(createShared.mock.calls[0][0]).not.toHaveProperty('requiredPermissions');
  });

  it('CONTROL: with no picker the body is built as before, the open view\'s gate included', async () => {
    const { create, createShared } = setup();
    await create(request());
    expect(createShared.mock.calls[0][0].requiredPermissions).toEqual(['view_deal_finance']);
  });
});

// ---------------------------------------------------------------------------
// The Studio form widget
// ---------------------------------------------------------------------------

describe('the view form\'s audience row in Studio', () => {
  it('the view form declares the capability picker', () => {
    expect(formDeclaresWidget(getViewForm('en'), 'ref-multi:capability')).toBe(true);
  });

  function mountRow(audience: CapabilityAudience | null, value: string[]) {
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { requiredPermissions: { type: 'array', title: 'Required permissions', items: { type: 'string' } } } } as never}
        form={{ type: 'simple', sections: [{ label: 'S', fields: [{ field: 'requiredPermissions', widget: 'ref-multi:capability' }] }] } as never}
        value={{ requiredPermissions: value }}
        onChange={() => {}}
        widgetContext={{
          conditionScope: 'none',
          ...(audience ? { capabilityAudience: { status: 'loaded', data: audience } } : {}),
        }}
      />,
    );
  }

  it('lists the picked names and previews the positions that will see the view', () => {
    mountRow(AUDIENCE, ['view_deal_sales']);
    expect(screen.getByTestId('ref-multi-capability')).toHaveTextContent('view_deal_sales');
    expect(screen.getByTestId('ref-multi-capability-audience').textContent).toContain('销售主管, 业务员');
  });

  it('a stored name the catalog does not know is flagged, not dropped', () => {
    mountRow(AUDIENCE, ['view_deal_sale']);
    expect(screen.getByTestId('ref-multi-capability').querySelector('[data-not-found]')).not.toBeNull();
  });

  it('nothing picked: everyone who can see the list sees it', () => {
    mountRow(AUDIENCE, []);
    expect(screen.getByTestId('ref-multi-capability-audience').textContent).toMatch(/everyone who can see the list/i);
  });

  it('offers each capability with the permission sets granting it', async () => {
    mountRow(AUDIENCE, []);
    fireEvent.keyDown(screen.getByTestId('ref-multi-capability-add'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByTestId('ref-multi-capability-detail').map((d) => d.textContent)).toEqual([
      'Granted by sales_rep_set',
      'Granted by finance_set, sales_lead_set',
      'Granted by sales_lead_set, sales_rep_set',
    ]);
  });

  it('is a closed list: no catalog fed, an empty one, or a failed read offers no box to type a name in', () => {
    mountRow(null, ['view_deal_sales']);
    expect(screen.queryByTestId('ref-multi-capability-audience')).toBeNull();
    expect(screen.queryByTestId('ref-multi-capability-freeform')).toBeNull();
    expect(screen.getByTestId('ref-multi-capability-closed').textContent).toBe('The capability list is not available here, so none can be added.');
    cleanup();
    mountRow({ capabilities: [], positions: [] }, []);
    expect(screen.queryByTestId('ref-multi-capability-freeform')).toBeNull();
    expect(screen.getByTestId('ref-multi-capability-closed').textContent).toMatch(/^No capability is defined yet/);
    cleanup();
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { requiredPermissions: { type: 'array', title: 'Required permissions', items: { type: 'string' } } } } as never}
        form={{ type: 'simple', sections: [{ label: 'S', fields: [{ field: 'requiredPermissions', widget: 'ref-multi:capability' }] }] } as never}
        value={{ requiredPermissions: ['view_deal_sales'] }}
        onChange={() => {}}
        widgetContext={{ conditionScope: 'none', capabilityAudience: { status: 'error', message: 'denied' } }}
      />,
    );
    expect(screen.getByTestId('ref-multi-capability-load-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('ref-multi-capability-freeform')).toBeNull();
    expect(screen.getByTestId('ref-multi-capability')).toHaveTextContent('view_deal_sales');
  });

  it('reads the catalog through the host\'s loader only once the row is on screen', async () => {
    const load = vi.fn(async () => AUDIENCE);
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { requiredPermissions: { type: 'array', title: 'Required permissions', items: { type: 'string' } } } } as never}
        form={{ type: 'simple', sections: [{ label: 'Access', collapsible: true, collapsed: true, fields: [{ field: 'requiredPermissions', widget: 'ref-multi:capability' }] }] } as never}
        value={{ requiredPermissions: ['view_deal_sales'] }}
        onChange={() => {}}
        widgetContext={{ conditionScope: 'none', loadCapabilityAudience: load }}
      />,
    );
    await settle();
    // The section is closed: no request.
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ref-multi-capability')).toBeNull();
    fireEvent.click(screen.getByText('Access'));
    await waitFor(() =>
      expect(screen.getByTestId('ref-multi-capability-audience').textContent).toContain('销售主管, 业务员'),
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('control: a catalog the host already holds is used as given, and the loader is not called', async () => {
    const load = vi.fn(async () => AUDIENCE);
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { requiredPermissions: { type: 'array', title: 'Required permissions', items: { type: 'string' } } } } as never}
        form={{ type: 'simple', sections: [{ label: 'S', fields: [{ field: 'requiredPermissions', widget: 'ref-multi:capability' }] }] } as never}
        value={{ requiredPermissions: ['view_deal_sales'] }}
        onChange={() => {}}
        widgetContext={{ conditionScope: 'none', capabilityAudience: { status: 'loaded', data: AUDIENCE }, loadCapabilityAudience: load }}
      />,
    );
    await settle();
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByTestId('ref-multi-capability-audience').textContent).toContain('销售主管, 业务员');
  });

  it('nothing reachable: the preview no longer promises the object\'s editors', () => {
    mountRow(AUDIENCE, ['export_reports', 'view_deal_finance']);
    expect(screen.getByTestId('ref-multi-capability-audience').textContent).toBe(
      'No position holds every picked capability: only people granted them directly will see it.',
    );
  });
});
