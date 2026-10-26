/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list.actions` — the authored action ids a related list
 * carries, READ and rendered (objectui#11163; the maintainer's ENFORCE ruling on
 * objectstack-ai/objectstack#20665).
 *
 * The contract declares `actions: z.array(z.string())`, "Action IDs available
 * for related records", and until objectui#11163 nothing read it: the list's
 * buttons came from the host bridge (`useRelatedRecordActions()`), keyed on the
 * CHILD object, so an authored `actions` changed nothing that rendered.
 *
 * ## The composition rule this file pins
 *
 *   - `actions` ABSENT → the host bridge's actions render exactly as before:
 *     the child object's `list_toolbar` actions as header buttons and its
 *     `list_item` actions in each row's menu, in registration order. No
 *     metadata lookup is made for the key at all.
 *   - `actions` AUTHORED → the authored list is what renders, IN AUTHORED
 *     ORDER. Each id resolves against the child object's registered `actions`
 *     — the same `useMetadataItem` + `resolveDeclaredActionIds` lookup
 *     `record:quick_actions.actionNames` resolves through — and is placed by
 *     its own `locations`, with the bridge's rule: `list_toolbar` → header
 *     button, `list_item` → row menu. Running it stays the host's (the
 *     bridge's `onToolbarAction` / `onRowAction`).
 *   - `actions: []` → the author's choice of NO actions. The built-in
 *     New / Edit / Delete / View affordances are not action ids (the runtime
 *     ships no built-in action names) and are untouched by this key.
 *   - An id the registry cannot resolve, or one whose action declares no
 *     location this list renders, is REFUSED where the lookup answers: an
 *     inline `role="status"` notice on the list names it and says why. Never a
 *     silently dropped button. No refusal is drawn while the lookup is still
 *     in flight.
 *
 * Every case mounts the node the way a page does — the `{ type, properties }`
 * document through the real `SchemaRenderer`, this package's registration, the
 * real `RelatedList` and the real data table — and reads the DOM.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  MetadataCtx,
  RecordContextProvider,
  RelatedRecordActionsProvider,
  SchemaRenderer,
  type MetadataContextValue,
  type RelatedRecordActionsValue,
  type RelatedRowActionDef,
} from '@object-ui/react';
// Registers `record:related_list`, the block under test.
import '../index';

/**
 * Desktop, pinned rather than inherited (objectui#8399): under the 768
 * breakpoint a `type="table"` related list renders a card gallery, and the row
 * menu read below is the data table's.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

/**
 * The child object's registry. Registration order is deliberately NOT the
 * order any authored case asks for, so an order assertion cannot pass by
 * echoing the registry.
 */
const CHILD_ACTIONS = [
  { name: 'send_welcome', label: 'Send Welcome', type: 'api', locations: ['list_item'] },
  { name: 'deactivate', label: 'Deactivate', type: 'api', locations: ['list_item'] },
  { name: 'invite', label: 'Invite', type: 'api', locations: ['list_toolbar'] },
  { name: 'export_csv', label: 'Export CSV', type: 'api', locations: ['list_toolbar'] },
  { name: 'header_only', label: 'Header Only', type: 'api', locations: ['record_header'] },
];
const CHILD = { name: 'contact', label: 'Contact', actions: CHILD_ACTIONS };

const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' && name === 'contact' ? CHILD : null,
);

/** Module-level on purpose — `getItem` is an effect dependency of `useMetadataItem`. */
const metadataWith = (lookup: MetadataContextValue['getItem']): MetadataContextValue => ({
  apps: [],
  objects: [CHILD],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: lookup,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
});
const METADATA = metadataWith(getItem as unknown as MetadataContextValue['getItem']);
/** A lookup that never answers — the first-paint frame, held open. */
const METADATA_IN_FLIGHT = metadataWith((() => new Promise(() => {})) as MetadataContextValue['getItem']);

/**
 * The host default, derived the way `RelatedRecordActionsBridge.deriveActions`
 * derives it: the child's actions filtered by list location, in registration
 * order. This is the channel an authored `actions` replaces.
 */
const derive = (location: string): RelatedRowActionDef[] =>
  CHILD_ACTIONS.filter((a) => a.locations.includes(location)) as RelatedRowActionDef[];

const onToolbarAction = vi.fn();
const onRowAction = vi.fn();
const onCreate = vi.fn();

/** Stable, like the bridge's memoised value — the renderer memoises on it. */
const HOST: RelatedRecordActionsValue = {
  resolve: ({ objectName }) =>
    objectName === 'contact'
      ? {
          onView: () => {},
          onCreate,
          rowActions: derive('list_item'),
          onRowAction,
          toolbarActions: derive('list_toolbar'),
          onToolbarAction,
        }
      : {},
};

const ROWS = [{ id: 'c1', name: 'Alice' }];

const makeDataSource = () => ({
  find: vi.fn(async () => ROWS),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
});

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (actions: unknown) => ({
  type: 'record:related_list',
  properties: {
    objectName: 'contact',
    relationshipField: 'account_id',
    columns: ['name'],
    ...(actions === undefined ? {} : { actions }),
  },
});

function mount(
  actions: unknown,
  { host = true, metadata = METADATA }: { host?: boolean; metadata?: MetadataContextValue } = {},
) {
  const node = <SchemaRenderer schema={doc(actions) as never} />;
  return render(
    <MetadataCtx.Provider value={metadata}>
      <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={makeDataSource() as never}>
        {host ? <RelatedRecordActionsProvider value={HOST}>{node}</RelatedRecordActionsProvider> : node}
      </RecordContextProvider>
    </MetadataCtx.Provider>,
  );
}

/** The header buttons, by action name, in DOM order. */
const toolbarNames = (): string[] =>
  screen
    .queryAllByTestId(/^related-toolbar-action-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('related-toolbar-action-', ''));

/** Every row overflow trigger currently in the document. */
const rowTriggers = () => screen.queryAllByLabelText('Row actions');

/** Open the first row's menu (Radix opens on `pointerdown`) and read its custom items in order. */
async function rowMenuNames(): Promise<string[]> {
  fireEvent.pointerDown(rowTriggers()[0], { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const menu = await screen.findByRole('menu');
  return within(menu)
    .queryAllByTestId(/^row-action-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('row-action-', ''));
}

/** The list has painted its row, so every toolbar/row decision below is taken on the settled DOM. */
const waitForRow = () => screen.findByText('Alice');

/** The block's refusal notice, if any. */
const refusal = () => screen.queryByTestId('record-related-list-actions-refused');

beforeEach(() => {
  getItem.mockClear();
  onToolbarAction.mockClear();
  onRowAction.mockClear();
  onCreate.mockClear();
});

afterEach(() => cleanup());

describe('record:related_list.actions — ABSENT: the host bridge is the default (objectui#11163)', () => {
  it('CONTROL: with no `actions` the bridge’s toolbar and row actions render, in registration order, and no lookup is made', async () => {
    mount(undefined);
    await waitForRow();
    await waitFor(() => expect(toolbarNames()).toEqual(['invite', 'export_csv']));
    expect(await rowMenuNames()).toEqual(['send_welcome', 'deactivate']);
    expect(refusal()).toBeNull();
    // The default path costs nothing new: the key is not there to resolve.
    expect(getItem).not.toHaveBeenCalledWith('object', 'contact');
  });
});

describe('record:related_list.actions — AUTHORED: the authored list is what renders (objectui#11163)', () => {
  it('header actions render in AUTHORED order, and only the authored ones', async () => {
    mount(['export_csv', 'invite']);
    await waitForRow();
    await waitFor(() => expect(toolbarNames()).toEqual(['export_csv', 'invite']));
    // No `list_item` action was authored, so no row menu is offered at all.
    expect(rowTriggers()).toHaveLength(0);
    expect(refusal()).toBeNull();
  });

  it('a subset replaces the default: the unnamed toolbar action is not drawn', async () => {
    mount(['invite']);
    await waitForRow();
    await waitFor(() => expect(toolbarNames()).toEqual(['invite']));
    expect(screen.queryByTestId('related-toolbar-action-export_csv')).toBeNull();
    expect(rowTriggers()).toHaveLength(0);
  });

  it('row actions render in each row’s menu in AUTHORED order, placed by their own `list_item` location', async () => {
    mount(['deactivate', 'send_welcome']);
    await waitForRow();
    await waitFor(() => expect(rowTriggers()).toHaveLength(ROWS.length));
    expect(await rowMenuNames()).toEqual(['deactivate', 'send_welcome']);
    expect(toolbarNames()).toEqual([]);
  });

  it('one authored list feeds both surfaces, each in authored order', async () => {
    mount(['deactivate', 'export_csv', 'send_welcome', 'invite']);
    await waitForRow();
    await waitFor(() => expect(toolbarNames()).toEqual(['export_csv', 'invite']));
    expect(await rowMenuNames()).toEqual(['deactivate', 'send_welcome']);
  });

  it('an authored action runs through the HOST: its resolved definition reaches the bridge’s executor', async () => {
    mount(['invite']);
    await waitForRow();
    const button = await screen.findByTestId('related-toolbar-action-invite');
    expect(button).toHaveTextContent('Invite');
    fireEvent.click(button);
    expect(onToolbarAction).toHaveBeenCalledTimes(1);
    expect(onToolbarAction.mock.calls[0][0]).toMatchObject({ name: 'invite', label: 'Invite', type: 'api' });
  });

  it('`actions: []` is the author’s choice of NO actions — while New stays, because it is not an action id', async () => {
    mount([]);
    await waitForRow();
    // Positive first, so the empty reads below are taken on a list that
    // really drew its header: the host's create affordance is still there.
    expect(await screen.findByTestId('related-list-new')).toBeInTheDocument();
    expect(toolbarNames()).toEqual([]);
    expect(rowTriggers()).toHaveLength(0);
    expect(refusal()).toBeNull();
  });
});

describe('record:related_list.actions — an id that cannot be placed is REFUSED where it resolves (objectui#11163)', () => {
  it('an id the registry cannot resolve is named in a `role="status"` notice; the resolvable ones still render', async () => {
    mount(['invite', 'no_such_action']);
    await waitForRow();
    await waitFor(() => expect(refusal()).not.toBeNull());
    const notice = refusal()!;
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent('no_such_action');
    expect(notice).toHaveTextContent(/not an action of .?contact/);
    expect(toolbarNames()).toEqual(['invite']);
  });

  it('an action that resolves but declares no location this list renders is refused, not dropped', async () => {
    mount(['header_only', 'invite']);
    await waitForRow();
    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(refusal()).toHaveTextContent('header_only');
    expect(refusal()).toHaveTextContent(/list_item/);
    expect(refusal()).toHaveTextContent(/list_toolbar/);
    expect(toolbarNames()).toEqual(['invite']);
    expect(screen.queryByText('Header Only')).toBeNull();
  });

  it('an array that is not all action ids is refused whole, and draws none of its entries', async () => {
    mount([{ name: 'invite', label: 'Invite', locations: ['list_toolbar'] }]);
    await waitForRow();
    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(refusal()).toHaveAttribute('role', 'status');
    expect(toolbarNames()).toEqual([]);
  });

  it('CONTROL: no refusal is drawn while the lookup is still in flight — and nothing authored is drawn either', async () => {
    mount(['invite', 'no_such_action'], { metadata: METADATA_IN_FLIGHT });
    await waitForRow();
    expect(refusal()).toBeNull();
    expect(toolbarNames()).toEqual([]);
  });

  it('CONTROL: with no host the list stays read-only, and a bad id is still refused — the refusal is the registry’s, not the host’s', async () => {
    mount(['invite', 'no_such_action'], { host: false });
    await waitForRow();
    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(refusal()).toHaveTextContent('no_such_action');
    expect(refusal()).not.toHaveTextContent('invite');
    // No host, no executor: nothing is offered that could not run.
    expect(toolbarNames()).toEqual([]);
    expect(screen.queryByTestId('related-list-new')).toBeNull();
  });
});
