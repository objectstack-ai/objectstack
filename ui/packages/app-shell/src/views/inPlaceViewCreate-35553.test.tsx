// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35553 — the view dropdown's body and its in-place create card.
 *
 * What is pinned:
 *   - the dropdown groups the reader's own views and the shared ones, leads
 *     every row with its type's icon, keeps the whole name (a `title` and a
 *     wrapping label, never a cut), keeps the search, and offers 「Add view」
 *     and Manage views at the bottom;
 *   - 「Add view」 turns the dropdown into the card: name, type, the one pick
 *     the type needs, 「include the current filters and sort」 only while
 *     the list holds some (on by default), and the personal / shared switch
 *     only for a reader who may create both. The default is one of the
 *     reader's own views, and no machine name is asked for: one is generated;
 *   - a create closes the dropdown; a refused one keeps the card and its input;
 *   - the generated key, the body built from the open view, and the host
 *     hook that saves a personal view and opens it or hands a shared one to
 *     the add-view door (its draft rules unchanged).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within, act, renderHook } from '@testing-library/react';
import { ListViewSchema } from '@objectstack/spec/ui';
import { MetadataClient } from '@object-ui/data-objectstack';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** No dataset is served: the chart's catalog answers empty, without a network. */
let client: MetadataClient;
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { toast } from 'sonner';
import { CreateViewCard, uniqueViewKey, type InPlaceViewRequest } from './CreateViewDialog';
import { buildInPlaceViewConfig } from './personalViews';
import { useCreateViewInPlace } from './objectViewViewCrud';
import { ObjectViewSwitcherMenu } from './objectViewSwitcherMenu';
import type { TitleSwitcherView } from './objectViewTitleSwitcher';

const DEAL = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }] },
    priority: { type: 'select', label: 'Priority', options: [{ value: 'high', label: 'High' }] },
    close_date: { type: 'date', label: 'Close date' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));

beforeEach(() => {
  client = new MetadataClient({
    baseUrl: 'http://localhost',
    fetch: (async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch,
  });
  vi.mocked(toast.error).mockClear();
});
afterEach(cleanup);

// ---------------------------------------------------------------------------
// The generated key
// ---------------------------------------------------------------------------

describe('uniqueViewKey: no machine name is asked for', () => {
  it('is the name as a key, and a taken one (bare or object-qualified) gets the next free suffix', () => {
    expect(uniqueViewKey('Open deals', [])).toBe('open_deals');
    expect(uniqueViewKey('Open deals', ['open_deals'])).toBe('open_deals_2');
    expect(uniqueViewKey('Open deals', ['crm_deal.open_deals', 'open_deals_2'])).toBe('open_deals_3');
  });

  it('a name with nothing to spell a key from is `view`, made unique the same way', () => {
    expect(uniqueViewKey('!!!', [])).toBe('view');
    expect(uniqueViewKey('  ', ['view'])).toBe('view_2');
  });

  it('any name gives a key the spec accepts', () => {
    for (const label of ['我的商机', '2024 pipeline', 'Ünïcode — deals', 'a'.repeat(200)]) {
      expect(uniqueViewKey(label, [])).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });
});

// ---------------------------------------------------------------------------
// The body built from the open view
// ---------------------------------------------------------------------------

describe('buildInPlaceViewConfig', () => {
  const VIEW = {
    id: 'crm_deal.all',
    name: 'all',
    label: 'All deals',
    type: 'grid',
    columns: ['name', 'stage', 'amount'],
    filter: [{ field: 'stage', operator: 'equals', value: 'open' }],
    sort: [{ field: 'name', order: 'asc' }],
  };

  it('retypes the open view, adds the type\'s picks, and is a spec ListView bound to the object', () => {
    const built = buildInPlaceViewConfig('crm_deal', VIEW, { type: 'kanban', block: { groupByField: 'priority' } }, { url: {} });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(ListViewSchema.safeParse(built.config).success).toBe(true);
    // The spec requires a kanban's card fields: the body's columns, as the add-view door mirrors them.
    expect(built.config).toMatchObject({
      type: 'kanban',
      kanban: { groupByField: 'priority', columns: ['name', 'stage', 'amount'] },
      columns: ['name', 'stage', 'amount'],
    });
    for (const key of ['id', 'name', 'label']) expect(built.config).not.toHaveProperty(key);
  });

  it('a gallery gets the columns as its card fields; a block that lists its own keeps them', () => {
    const gallery = buildInPlaceViewConfig('crm_deal', VIEW, { type: 'gallery' }, { url: {} });
    expect(gallery.ok && gallery.config.gallery).toEqual({ visibleFields: ['name', 'stage', 'amount'] });
    const board = { ...VIEW, type: 'kanban', kanban: { groupByField: 'stage', columns: ['name'] } };
    const kept = buildInPlaceViewConfig('crm_deal', board, { type: 'kanban', block: { groupByField: 'priority' } }, { url: {} });
    expect(kept.ok && kept.config.kanban).toEqual({ groupByField: 'priority', columns: ['name'] });
    const grid = buildInPlaceViewConfig('crm_deal', board, { type: 'grid' }, { url: {} });
    expect(grid.ok && ListViewSchema.safeParse(grid.config).success).toBe(true);
  });

  it('with the list\'s conditions it carries them; without, the view\'s own', () => {
    const url = { sort: [{ field: 'amount', order: 'desc' as const }] };
    const withCurrent = buildInPlaceViewConfig('crm_deal', VIEW, { type: 'grid' }, { url });
    const without = buildInPlaceViewConfig('crm_deal', VIEW, { type: 'grid' }, { preference: undefined });
    expect(withCurrent.ok && withCurrent.config.sort).toEqual([{ field: 'amount', order: 'desc' }]);
    expect(without.ok && without.config.sort).toEqual(VIEW.sort);
    expect(without.ok && without.config.filter).toEqual(VIEW.filter);
  });
});

// ---------------------------------------------------------------------------
// The host hook
// ---------------------------------------------------------------------------

describe('useCreateViewInPlace', () => {
  const ACTIVE = { id: 'crm_deal.all', name: 'all', label: 'All deals', type: 'grid', columns: ['name', 'stage'] };
  const t = ((key: string) => key) as never;

  function setup(over: Partial<Parameters<typeof useCreateViewInPlace>[0]> = {}) {
    const savePersonal = vi.fn(async () => 'pv_9');
    const openPersonal = vi.fn();
    const createShared = vi.fn(async () => true);
    const readListState = vi.fn(() => ({ url: { sort: [{ field: 'stage', order: 'asc' as const }] } }));
    const { result } = renderHook(() => useCreateViewInPlace({
      objectName: 'crm_deal', activeView: ACTIVE, readListState, savePersonal, openPersonal, createShared, t, ...over,
    }));
    return { create: result.current, savePersonal, openPersonal, createShared };
  }

  const request = (scope: 'personal' | 'shared', includeCurrent = true): InPlaceViewRequest => ({
    config: { type: 'kanban', label: 'By priority', name: 'by_priority', kanban: { groupByField: 'priority' } },
    scope,
    includeCurrent,
  });

  it('personal: saves one of the reader\'s own views under the name given, and opens it', async () => {
    const { create, savePersonal, openPersonal, createShared } = setup();
    await expect(create(request('personal'))).resolves.toBe(true);
    expect(savePersonal).toHaveBeenCalledTimes(1);
    const [label, config] = savePersonal.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(label).toBe('By priority');
    expect(config).toMatchObject({ type: 'kanban', kanban: { groupByField: 'priority' }, sort: [{ field: 'stage', order: 'asc' }] });
    expect(ListViewSchema.safeParse(config).success).toBe(true);
    expect(openPersonal).toHaveBeenCalledWith('pv_9');
    expect(createShared).not.toHaveBeenCalled();
  });

  it('without the current conditions the list\'s sort stays out', async () => {
    const { create, savePersonal } = setup();
    await create(request('personal', false));
    const config = (savePersonal.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(config).not.toHaveProperty('sort');
  });

  it('shared: hands the add-view door the body under the generated key and the name, never the open view\'s id', async () => {
    const { create, savePersonal, createShared } = setup();
    await expect(create(request('shared'))).resolves.toBe(true);
    const body = (createShared.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(body).toMatchObject({ type: 'kanban', label: 'By priority', name: 'by_priority', kanban: { groupByField: 'priority' } });
    expect(body).not.toHaveProperty('id');
    expect(savePersonal).not.toHaveBeenCalled();
  });

  it('a refused save says why and resolves false, and opens nothing', async () => {
    const { create, openPersonal } = setup({ savePersonal: vi.fn(async () => { throw new Error('denied'); }) });
    await expect(create(request('personal'))).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(openPersonal).not.toHaveBeenCalled();
  });

  it('a list it cannot fold is refused before anything is written', async () => {
    const nested = { logic: 'and', conditions: [{ logic: 'or', conditions: [{ field: 'stage', operator: 'equals', value: 'open' }] }] };
    const savePersonal = vi.fn(async () => 'x');
    const { create } = setup({ savePersonal, readListState: () => ({ url: { filters: nested as never } }) });
    await expect(create(request('personal'))).resolves.toBe(false);
    expect(savePersonal).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function mountCard(props: Partial<React.ComponentProps<typeof CreateViewCard>> = {}) {
  const onCreate = vi.fn(async (_request: InPlaceViewRequest) => true);
  const onBack = vi.fn();
  render(
    <CreateViewCard
      objectDef={DEAL}
      existingLabels={['All deals']}
      existingKeys={['crm_deal.all']}
      availableTypes={['grid', 'kanban', 'calendar', 'gallery']}
      canCreatePersonal
      canCreateShared={false}
      hasUnsavedConditions={false}
      onCreate={onCreate}
      onBack={onBack}
      {...props}
    />,
  );
  return { onCreate, onBack };
}

async function chooseType(type: string) {
  fireEvent.keyDown(screen.getByTestId('create-view-card-type'), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByTestId(`create-view-card-type-${type}`));
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  await settle();
}

const name = () => screen.getByTestId('create-view-card-name') as HTMLInputElement;
const submit = () => screen.getByTestId('create-view-card-submit') as HTMLButtonElement;

describe('the in-place create card', () => {
  it('opens with a free name and a grid, asks no machine name, and creates one of the reader\'s own views', async () => {
    const { onCreate } = mountCard();
    await settle();
    expect(name().value).not.toBe('');
    expect(name().value).not.toBe('All deals');
    // Name, type, Create: no key field, no include box, no scope switch for this reader.
    expect(screen.getByTestId('create-view-card').querySelectorAll('input').length).toBe(1);
    expect(screen.queryByTestId('create-view-card-include-current')).toBeNull();
    expect(screen.queryByTestId('create-view-card-scope')).toBeNull();

    fireEvent.change(name(), { target: { value: 'Pipeline' } });
    fireEvent.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toEqual({
      config: { type: 'grid', label: 'Pipeline', name: 'pipeline' },
      scope: 'personal',
      includeCurrent: false,
    });
  });

  it('lists every offered type with its icon', async () => {
    mountCard();
    fireEvent.keyDown(screen.getByTestId('create-view-card-type'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    for (const type of ['grid', 'kanban', 'calendar', 'gallery']) {
      expect(within(listbox).getByTestId(`create-view-card-type-${type}`).querySelector('svg')).not.toBeNull();
    }
    fireEvent.keyDown(listbox, { key: 'Escape' });
  });

  it('kanban asks for its group field, and the pick lands in the request', async () => {
    const { onCreate } = mountCard();
    await chooseType('kanban');
    const pick = screen.getByTestId('create-view-card-pick-groupByField');
    fireEvent.keyDown(pick, { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: 'Priority' }));
    await settle();
    fireEvent.change(name(), { target: { value: 'By priority' } });
    fireEvent.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].config).toEqual({
      type: 'kanban', label: 'By priority', name: 'by_priority', kanban: { groupByField: 'priority' },
    });
  });

  it('kanban defaults its group field to a status-like field the list shows, before one it hides', async () => {
    const withApproval = {
      ...DEAL,
      fields: { approval_status: { type: 'select', label: 'Approval status', options: [{ value: 'ok', label: 'OK' }] }, ...DEAL.fields },
    };
    const { onCreate } = mountCard({ objectDef: withApproval, shownFields: ['name', 'stage', 'amount'] });
    await chooseType('kanban');
    expect(screen.getByTestId('create-view-card-pick-groupByField')).toHaveTextContent('Stage');
    fireEvent.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].config.kanban).toEqual({ groupByField: 'stage' });
  });

  it('CONTROL: without the shown fields it is the first status-like field of the object', async () => {
    const withApproval = {
      ...DEAL,
      fields: { approval_status: { type: 'select', label: 'Approval status', options: [{ value: 'ok', label: 'OK' }] }, ...DEAL.fields },
    };
    mountCard({ objectDef: withApproval });
    await chooseType('kanban');
    expect(screen.getByTestId('create-view-card-pick-groupByField')).toHaveTextContent('Approval status');
  });

  it('calendar asks for its date field alone; a type that needs none shows no pick', async () => {
    mountCard();
    await chooseType('calendar');
    expect(screen.getByTestId('create-view-card-pick-startDateField')).toBeInTheDocument();
    expect(screen.getByTestId('create-view-card').querySelectorAll('[data-testid^="create-view-card-pick-"]').length).toBe(1);
    await chooseType('grid');
    expect(screen.queryAllByTestId(/^create-view-card-pick-/)).toHaveLength(0);
  });

  it('with unsaved filters or sort, offers to include them, on by default', async () => {
    const { onCreate } = mountCard({ hasUnsavedConditions: true });
    const box = screen.getByTestId('create-view-card-include-current') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].includeCurrent).toBe(true);
  });

  it('…and unticked, the request leaves them out', async () => {
    const { onCreate } = mountCard({ hasUnsavedConditions: true });
    fireEvent.click(screen.getByTestId('create-view-card-include-current'));
    fireEvent.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].includeCurrent).toBe(false);
  });

  it('a reader who may create shared views gets the switch, on personal by default', async () => {
    const { onCreate } = mountCard({ canCreateShared: true });
    const personal = screen.getByTestId('create-view-card-scope-personal');
    expect(personal).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('create-view-card-shared-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('create-view-card-scope-shared'));
    expect(screen.getByTestId('create-view-card-shared-hint')).toBeInTheDocument();
    fireEvent.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].scope).toBe('shared');
  });

  it('a taken name is refused in place; Enter creates', async () => {
    const { onCreate } = mountCard();
    fireEvent.change(name(), { target: { value: 'All deals' } });
    expect(screen.getByTestId('create-view-card-duplicate')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.change(name(), { target: { value: 'All deals, mine' } });
    fireEvent.keyDown(name(), { key: 'Enter' });
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  });

  it('back returns to the list', () => {
    const { onBack } = mountCard();
    fireEvent.click(screen.getByTestId('create-view-card-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The dropdown body
// ---------------------------------------------------------------------------

const VIEWS: TitleSwitcherView[] = [
  { id: 'crm_deal.all', label: 'All deals', type: 'grid', authored: true },
  { id: 'crm_deal.board', label: 'Pipeline board', type: 'kanban', authored: true },
  {
    id: 'pv_1',
    label: 'Deals closing this quarter in the northern region, owned by my team',
    type: 'calendar',
    authored: false,
    personal: true,
  },
];

function mountMenu(props: Partial<React.ComponentProps<typeof ObjectViewSwitcherMenu>> = {}) {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const onManageViews = vi.fn();
  const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;
  render(
    <ObjectViewSwitcherMenu
      views={VIEWS}
      activeViewId="crm_deal.all"
      onChoose={onChoose}
      onClose={onClose}
      favorites={null}
      onManageViews={onManageViews}
      t={t}
      {...props}
    />,
  );
  return { onChoose, onClose, onManageViews };
}

describe('the view dropdown body', () => {
  it('groups My views and the shared views, each row led by its type icon', () => {
    mountMenu();
    const mine = screen.getByTestId('list-view-switcher-mine');
    const shared = screen.getByTestId('list-view-switcher-all');
    expect(within(mine).getByText('My views')).toBeInTheDocument();
    expect(within(shared).getByText('Shared views')).toBeInTheDocument();
    const rows = (group: HTMLElement) => Array.from(group.querySelectorAll<HTMLElement>('[data-section]')).map((r) => r.dataset.testid);
    expect(rows(mine)).toEqual(['view-switcher-row-pv_1']);
    expect(rows(shared)).toEqual(['view-switcher-row-crm_deal.all', 'view-switcher-row-crm_deal.board']);
    for (const icon of screen.getAllByTestId('view-switcher-type-icon')) expect(icon.querySelector('svg')).not.toBeNull();
  });

  it('a long name is kept whole: it wraps, and the row names it in full', () => {
    mountMenu();
    const row = screen.getByTestId('view-switcher-row-pv_1');
    const label = within(row).getByTestId('view-switcher-name');
    expect(label).toHaveTextContent(VIEWS[2].label);
    expect(label.className).not.toMatch(/\btruncate\b/);
    expect(label.className).toMatch(/break-words/);
    expect(within(row).getByRole('button', { name: VIEWS[2].label })).toHaveAttribute('title', VIEWS[2].label);
  });

  it('search narrows the rows; choosing one hands its id to the host', () => {
    const { onChoose } = mountMenu();
    fireEvent.change(screen.getByTestId('list-view-switcher-search'), { target: { value: 'board' } });
    expect(screen.queryByTestId('view-switcher-row-crm_deal.all')).toBeNull();
    fireEvent.click(within(screen.getByTestId('view-switcher-row-crm_deal.board')).getAllByRole('button')[0]);
    expect(onChoose).toHaveBeenCalledWith('crm_deal.board');
  });

  it('Manage views stays; with no create door there is no Add view', () => {
    const { onManageViews, onClose } = mountMenu();
    expect(screen.queryByTestId('list-view-switcher-new')).toBeNull();
    fireEvent.click(screen.getByTestId('list-view-switcher-manage'));
    expect(onClose).toHaveBeenCalled();
    expect(onManageViews).toHaveBeenCalled();
  });

  it('Add view turns the dropdown into the card; a create closes it, a refusal keeps the card', async () => {
    let answer = false;
    const onCreate = vi.fn(async () => answer);
    const { onClose } = mountMenu({
      create: { objectDef: DEAL, canCreatePersonal: true, canCreateShared: false, hasUnsavedConditions: false, onCreate },
    });
    fireEvent.click(screen.getByTestId('list-view-switcher-new'));
    await screen.findByTestId('create-view-card');
    fireEvent.change(screen.getByTestId('create-view-card-name'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByTestId('create-view-card-submit'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-view-card-name')).toHaveValue('Mine');

    answer = true;
    fireEvent.click(screen.getByTestId('create-view-card-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('the card\'s generated key avoids every view\'s id, bare or object-qualified', async () => {
    const onCreate = vi.fn(async () => true);
    mountMenu({
      views: [...VIEWS, { id: 'crm_deal.mine', label: 'Other', type: 'grid', authored: false }],
      create: { objectDef: DEAL, canCreatePersonal: true, canCreateShared: false, hasUnsavedConditions: false, onCreate },
    });
    fireEvent.click(screen.getByTestId('list-view-switcher-new'));
    await screen.findByTestId('create-view-card');
    fireEvent.change(screen.getByTestId('create-view-card-name'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByTestId('create-view-card-submit'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect((onCreate.mock.calls[0] as unknown as [InPlaceViewRequest])[0].config.name).toBe('mine_2');
  });

  it('back from the card returns to the list', async () => {
    mountMenu({
      create: { objectDef: DEAL, canCreatePersonal: true, canCreateShared: false, hasUnsavedConditions: false, onCreate: vi.fn() },
    });
    fireEvent.click(screen.getByTestId('list-view-switcher-new'));
    fireEvent.click(await screen.findByTestId('create-view-card-back'));
    expect(screen.getByTestId('list-view-switcher-body')).toBeInTheDocument();
  });
});
