/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12673 — in a console list, a name that points at ANOTHER object's
 * record opens that record, the way the record page's names do.
 *
 * The list host (`listRecordActionsValue`) used to answer `recordHref` for the
 * listed object only, so a lookup cell (an opportunity's account) and a
 * record-pointer cell (`referenceVia`: an approval request's record) drew a
 * name that could not be opened. It now answers any routable object through
 * the record page's builder (`appRecordPath` over `routableObjectNames`).
 *
 * Each case mounts what the list page mounts around its grid: the real
 * `listRecordActionsValue` (fed by the router's own `navigate` and
 * `useHref('/')`, as `ObjectView` feeds it) under a router mounted at
 * `/_console`, over the real `ObjectGrid` and the real cell renderers. The
 * oracle for every href is react-router's own `Link` for the same route, so
 * the pin does not restate how a basename is joined.
 *
 * The click areas (the card's second measurement): a link in a cell owns its
 * text only; a click anywhere else on the row still opens the row's own record.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useHref, useLocation, useNavigate } from 'react-router-dom';
import '@testing-library/jest-dom';
import { ActionProvider, RelatedRecordActionsProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '@object-ui/plugin-grid';

import { listRecordActionsValue } from '../ObjectView';

registerAllFields();

afterEach(() => {
  cleanup();
});

const APP = 'hotcrm';
const BASENAME = '/_console';

const OPPORTUNITY_DEF = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  icon: 'briefcase',
  nameField: 'name',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name' },
    stage: { name: 'stage', type: 'text', label: 'Stage' },
    account: { name: 'account', type: 'lookup', label: 'Account', reference: 'crm_account' },
    ledger: { name: 'ledger', type: 'lookup', label: 'Ledger', reference: 'legacy_ledger' },
  },
};

const REQUEST_DEF = {
  name: 'sys_approval_request',
  label: 'Approval Request',
  fields: {
    process_name: { name: 'process_name', type: 'text', label: 'Source' },
    object_name: { name: 'object_name', type: 'text', label: 'Object' },
    record_id: { name: 'record_id', type: 'text', label: 'Record ID', referenceVia: 'object_name' },
  },
};

const ACCOUNT_DEF = { name: 'crm_account', label: 'Account', nameField: 'name', fields: { name: { name: 'name', type: 'text' } } };

/**
 * The console's object definitions: the routable set. `legacy_ledger` is
 * deliberately absent, so the console cannot route to it.
 */
const CONSOLE_OBJECTS = [OPPORTUNITY_DEF, REQUEST_DEF, ACCOUNT_DEF];

const OPPORTUNITIES = [
  { id: 'opp-1', name: 'Globex Manufacturing Suite' },
  { id: 'opp-2', name: 'Acme renewal' },
];

function makeDataSource() {
  const find = vi.fn(async (objectName: string, params?: any) => {
    if (objectName !== 'crm_opportunity') return { data: [] };
    const wanted: string[] = params?.$filter?.id?.$in ?? [];
    return { data: OPPORTUNITIES.filter((r) => wanted.includes(r.id)) };
  });
  const getObjectSchema = vi.fn(async (objectName: string) => {
    const def = CONSOLE_OBJECTS.find((o) => o.name === objectName);
    if (!def) throw new Error('unknown object');
    return def;
  });
  return { find, getObjectSchema, findOne: vi.fn(async () => null) } as any;
}

/** The router's own location, basename stripped: where a click took us. */
function RouterLocation() {
  const location = useLocation();
  return <output data-testid="router-location">{location.pathname}</output>;
}

/** What `ObjectView` mounts around its grid, fed the way `ObjectView` feeds it. */
function ListHost({
  listedObject,
  openRecordPage,
  children,
}: {
  listedObject: string;
  openRecordPage: (recordId: string | number) => void;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const routerRootHref = useHref('/');
  const value = listRecordActionsValue(
    listedObject,
    openRecordPage,
    () => `${BASENAME}/apps/${APP}/${listedObject}`,
    { appName: APP, objects: CONSOLE_OBJECTS, navigate, routerRootHref },
  );
  return <RelatedRecordActionsProvider value={value}>{children}</RelatedRecordActionsProvider>;
}

function mountGrid(opts: {
  objectName: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  onRowClick?: (record: any) => void;
  openRecordPage?: (recordId: string | number) => void;
}) {
  const schema: any = {
    type: 'object-grid' as const,
    objectName: opts.objectName,
    columns: opts.columns,
    data: { provider: 'value', items: opts.rows },
  };
  return render(
    <MemoryRouter basename={BASENAME} initialEntries={[`${BASENAME}/apps/${APP}/${opts.objectName}`]}>
      <ActionProvider>
        <ListHost listedObject={opts.objectName} openRecordPage={opts.openRecordPage ?? vi.fn()}>
          <ObjectGrid schema={schema} dataSource={makeDataSource()} onRowClick={opts.onRowClick} />
        </ListHost>
      </ActionProvider>
      <Link to={`/apps/${APP}/crm_account/record/acc-1`} data-testid="oracle-account">oracle</Link>
      <Link to={`/apps/${APP}/crm_opportunity/record/opp-1`} data-testid="oracle-opportunity">oracle</Link>
      <RouterLocation />
    </MemoryRouter>,
  );
}

const OPPORTUNITY_ROWS = [
  {
    id: 'opp-1',
    name: 'Globex Manufacturing Suite',
    stage: 'Proposal',
    account: { id: 'acc-1', name: 'Acme Corp' },
    ledger: { id: 'led-1', name: 'Ledger 2026' },
  },
];

const REQUEST_ROWS = [
  { id: 'req-1', process_name: 'flow:opportunity_approval', object_name: 'crm_opportunity', record_id: 'opp-1' },
  { id: 'req-2', process_name: 'flow:opportunity_approval', object_name: 'crm_opportunity', record_id: 'opp-gone' },
];

describe('a console list links names that point at another object (objectui#12673)', () => {
  it('a lookup cell pointing at another object links to that record: href and left click', async () => {
    const onRowClick = vi.fn();
    mountGrid({ objectName: 'crm_opportunity', columns: ['name', 'stage', 'account'], rows: OPPORTUNITY_ROWS, onRowClick });

    const link = (await screen.findByText('Acme Corp')).closest('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', `${BASENAME}/apps/${APP}/crm_account/record/acc-1`);
    // The href is the one react-router renders for the same route.
    expect(link!.getAttribute('href')).toBe(screen.getByTestId('oracle-account').getAttribute('href'));
    // A list page has no parent record, so no `?from=` trail entry is added.
    expect(link!.getAttribute('href')).not.toContain('?');

    fireEvent.click(link!, { button: 0 });
    expect(screen.getByTestId('router-location').textContent).toBe(`/apps/${APP}/crm_account/record/acc-1`);
    // Following the reference does not also open the row's own record.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('a modifier click on the lookup link is left to the browser (new tab), not routed in-app', async () => {
    mountGrid({ objectName: 'crm_opportunity', columns: ['name', 'account'], rows: OPPORTUNITY_ROWS });
    const link = (await screen.findByText('Acme Corp')).closest('a')!;
    const notPrevented = fireEvent.click(link, { button: 0, metaKey: true });
    expect(notPrevented).toBe(true);
    expect(screen.getByTestId('router-location').textContent).toBe(`/apps/${APP}/crm_opportunity`);
  });

  it('a referenceVia cell pointing at another object links to that record', async () => {
    mountGrid({ objectName: 'sys_approval_request', columns: ['process_name', 'record_id'], rows: REQUEST_ROWS });

    const link = await screen.findByRole('link', { name: 'Globex Manufacturing Suite' });
    expect(link).toHaveAttribute('href', `${BASENAME}/apps/${APP}/crm_opportunity/record/opp-1`);
    expect(link.getAttribute('href')).toBe(screen.getByTestId('oracle-opportunity').getAttribute('href'));

    fireEvent.click(link, { button: 0 });
    expect(screen.getByTestId('router-location').textContent).toBe(`/apps/${APP}/crm_opportunity/record/opp-1`);
  });

  it('an unreadable or missing referenceVia target keeps its unavailable face and draws no anchor', async () => {
    mountGrid({ objectName: 'sys_approval_request', columns: ['process_name', 'record_id'], rows: REQUEST_ROWS });

    const unavailable = await screen.findByText('Opportunity · record unavailable');
    const cell = unavailable.closest('[data-record-pointer="unreadable"]') as HTMLElement;
    expect(cell).not.toBeNull();
    expect(cell.querySelector('a')).toBeNull();
    expect(cell.closest('a')).toBeNull();
    // The id is not printed as cell text, and no href names the missing record.
    expect(screen.queryByText('opp-gone')).toBeNull();
    expect(document.querySelector('a[href*="opp-gone"]')).toBeNull();
  });

  it('a lookup whose target the viewer cannot read (no value served) draws no anchor', async () => {
    mountGrid({
      objectName: 'crm_opportunity',
      columns: ['name', 'account'],
      rows: [{ id: 'opp-9', name: 'Hidden account deal', account: null }],
    });
    await screen.findByText('Hidden account deal');
    expect(document.querySelector('a[href*="crm_account"]:not([data-testid^="oracle"])')).toBeNull();
  });

  it('a lookup pointing at an object the console cannot route to draws no anchor', async () => {
    mountGrid({ objectName: 'crm_opportunity', columns: ['name', 'ledger'], rows: OPPORTUNITY_ROWS });

    const name = await screen.findByText('Ledger 2026');
    expect(name.closest('a')).toBeNull();
    expect(document.querySelector('a[href*="legacy_ledger"]')).toBeNull();
  });

  it('a row click outside the link still opens the row’s own record', async () => {
    const onRowClick = vi.fn();
    mountGrid({ objectName: 'crm_opportunity', columns: ['name', 'stage', 'account'], rows: OPPORTUNITY_ROWS, onRowClick });

    await screen.findByText('Acme Corp');
    // The stage cell holds no link: its click belongs to the row.
    const stage = screen.getByText('Proposal');
    expect(stage.closest('a')).toBeNull();
    fireEvent.click(stage);
    await waitFor(() => expect(onRowClick).toHaveBeenCalledTimes(1));
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'opp-1' });
    // The click went to the row, not to the referenced record.
    expect(screen.getByTestId('router-location').textContent).toBe(`/apps/${APP}/crm_opportunity`);
  });

  it('the in-cell link owns its text only: the cell around it is not an anchor', async () => {
    mountGrid({ objectName: 'crm_opportunity', columns: ['name', 'stage', 'account'], rows: OPPORTUNITY_ROWS });
    const link = (await screen.findByText('Acme Corp')).closest('a')!;
    const cell = link.closest('td');
    expect(cell).not.toBeNull();
    expect(cell!.querySelectorAll('a')).toHaveLength(1);
    expect(cell!.closest('a')).toBeNull();
    // objectui#11817: no anchor anywhere inside an anchor.
    expect(document.querySelectorAll('a a')).toHaveLength(0);
  });
});
