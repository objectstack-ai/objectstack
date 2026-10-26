/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list.actions` — WHO sees the action-refusal notice
 * (objectui#11768).
 *
 * objectui#11163 made the list name an authored action id it cannot draw, in a
 * `role="status"` notice above the list, instead of dropping it silently. It
 * drew that notice for every viewer: a sales rep opening a lead read a
 * configuration error about action ids they can neither fix nor act on. The
 * fault is the author's, and `os validate` already refuses the id at build
 * time (objectstack-ai/objectstack#20936).
 *
 * ## What this file pins
 *
 *   - A viewer WITHOUT the metadata-edit capability (`manage_metadata`, the
 *     answer app-shell's `useCanAuthorMetadata` gives Studio's affordances)
 *     sees no notice — and still sees the actions that DID resolve.
 *   - A viewer WITH it sees the notice, naming the id and the related object.
 *   - A capability set the provider never REPORTED follows the reading
 *     `useCanAuthorMetadata` uses: fail OPEN (objectui#4656).
 *   - Dev mode (the build's `NODE_ENV` is not `production`) shows it to anyone.
 *   - The refused entry stays undrawn for every viewer; only the notice's
 *     audience moved.
 *
 * Every case runs the node the way a page does — the `{ type, properties }`
 * document through the real `SchemaRenderer`, this package's registration, the
 * real `RelatedList` — under the REAL stock `MePermissionsProvider` with a
 * `/me/permissions` payload, never a mocked `usePermissions` (a mock that
 * answers IS whichever reading it implements).
 *
 * ⚠️ `NODE_ENV` is `test` under vitest, which the dev-mode read counts as dev:
 * the cases that pin the production audience stub it to `production`, and the
 * dev-mode case stubs it to `development` so it does not pass on vitest's own
 * value by accident.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
// Registers `record:related_list`, the block under test.
import '../index';

/** Desktop, pinned (objectui#8399): under 768 a `type="table"` related list renders a card gallery. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const CHILD_ACTIONS = [
  { name: 'invite', label: 'Invite', type: 'api', locations: ['list_toolbar'] },
  { name: 'export_csv', label: 'Export CSV', type: 'api', locations: ['list_toolbar'] },
];
const CHILD = { name: 'contact', label: 'Contact', actions: CHILD_ACTIONS };

const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' && name === 'contact' ? CHILD : null,
);

const METADATA: MetadataContextValue = {
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
  getItem: getItem as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

const onToolbarAction = vi.fn();

/** Stable, like the bridge's memoised value — the renderer memoises on it. */
const HOST: RelatedRecordActionsValue = {
  resolve: ({ objectName }) =>
    objectName === 'contact'
      ? {
          onView: () => {},
          toolbarActions: CHILD_ACTIONS as RelatedRowActionDef[],
          onToolbarAction,
        }
      : {},
};

const ROWS = [{ id: 'c1', name: 'Alice' }];

const makeDataSource = () => ({
  find: vi.fn(async () => ROWS),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
});

/**
 * A `/me/permissions` payload. `systemPermissions` omitted entirely when
 * `undefined` — the unreported answer, which is not the same as `[]`.
 * The child object is readable, so the list's automatic read gate stays open
 * and every verdict below is the notice's own.
 */
function me(systemPermissions: string[] | undefined): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 't1',
    roles: [],
    permissionSets: [],
    ...(systemPermissions === undefined ? {} : { systemPermissions }),
    objects: {
      contact: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
    fields: {},
  } as MePermissionsResponse;
}

const doc = (actions: string[]) => ({
  type: 'record:related_list',
  properties: { objectName: 'contact', relationshipField: 'account_id', columns: ['name'], actions },
});

function mount(actions: string[], systemPermissions: string[] | undefined) {
  return render(
    <MePermissionsProvider initialPermissions={me(systemPermissions)}>
      <MetadataCtx.Provider value={METADATA}>
        <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={makeDataSource() as never}>
          <RelatedRecordActionsProvider value={HOST}>
            <SchemaRenderer schema={doc(actions) as never} />
          </RelatedRecordActionsProvider>
        </RecordContextProvider>
      </MetadataCtx.Provider>
    </MePermissionsProvider>,
  );
}

/** The header buttons, by action name, in DOM order. */
const toolbarNames = (): string[] =>
  screen
    .queryAllByTestId(/^related-toolbar-action-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('related-toolbar-action-', ''));

const refusal = () => screen.queryByTestId('record-related-list-actions-refused');

/**
 * The lookup has answered and the list has painted: the resolved toolbar
 * action is drawn ONLY once the related object's actions came back, so a
 * missing notice read after this is a verdict, not a first-paint frame.
 */
async function settled() {
  await screen.findByText('Alice');
  await waitFor(() => expect(toolbarNames()).toEqual(['invite']));
}

const AUTHORED = ['invite', 'no_such_action'];

beforeEach(() => {
  getItem.mockClear();
  onToolbarAction.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('record:related_list — the action-refusal notice is drawn for authors, not end users (objectui#11768)', () => {
  describe('in a production build', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
    });

    it('an end user (a reported capability set without `manage_metadata`) sees no notice, and the resolved actions still render', async () => {
      mount(AUTHORED, ['setup.access']);
      await settled();
      expect(refusal()).toBeNull();
      expect(screen.queryByText(/no_such_action/)).toBeNull();
      // Positive read on the same settled DOM: the lookup DID answer, so the
      // missing notice is the audience rule, not an unresolved lookup.
      expect(getItem).toHaveBeenCalledWith('object', 'contact');
    });

    it('a REPORTED empty capability set is an end user too: "holds nothing" gates strictly', async () => {
      mount(AUTHORED, []);
      await settled();
      expect(refusal()).toBeNull();
    });

    it('an editor (`manage_metadata` held) sees the notice, naming the refused id and the related object', async () => {
      mount(AUTHORED, ['setup.access', 'manage_metadata']);
      await settled();
      await waitFor(() => expect(refusal()).not.toBeNull());
      const notice = refusal()!;
      expect(notice).toHaveAttribute('role', 'status');
      expect(notice).toHaveTextContent('no_such_action');
      expect(notice).toHaveTextContent(/not an action of .?contact/);
      // The refused entry is not drawn for the editor either.
      expect(toolbarNames()).toEqual(['invite']);
    });

    it('a capability set the provider never REPORTED fails OPEN, as `useCanAuthorMetadata` reads it', async () => {
      mount(AUTHORED, undefined);
      await settled();
      await waitFor(() => expect(refusal()).not.toBeNull());
      expect(refusal()).toHaveTextContent('no_such_action');
    });

    it('CONTROL: an editor on a list whose ids all resolve sees no notice', async () => {
      mount(['invite'], ['manage_metadata']);
      await settled();
      expect(refusal()).toBeNull();
    });
  });

  describe('in dev mode', () => {
    it('the notice is drawn for a viewer without `manage_metadata`', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      mount(AUTHORED, ['setup.access']);
      await settled();
      await waitFor(() => expect(refusal()).not.toBeNull());
      expect(refusal()).toHaveTextContent('no_such_action');
      expect(refusal()).toHaveTextContent(/not an action of .?contact/);
      expect(toolbarNames()).toEqual(['invite']);
    });
  });
});
