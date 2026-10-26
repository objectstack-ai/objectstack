/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailView's param-collection dialog titles itself from `label` and
 * from nothing else (objectui#5610).
 *
 * This used to read `action?.label || action?.title`. `title` is declared on no
 * action surface in the ecosystem — it is absent from `@objectstack/spec`'s
 * `ActionSchema` (44 keys walked at spec 17.0.0), from `ActionDef` and its
 * pinned `ACTION_DEF_KEYS` / `SPEC_ACTION_KEYS` inventories, from
 * `@object-ui/types`' renderer view (`ui-action.ts`) and from its `crud.ts`
 * `ActionSchema` / `BaseSchema` — and none of the four action renderers
 * (`action:button`, `action:icon`, `action:group`, `action:menu`) forwards it.
 * So the right-hand side of that `||` was unreachable from authored metadata:
 * a fallback that cannot fire, which is precisely the "declared is not
 * enforced" shape objectstack#4075 exists to reduce.
 *
 * ## Why this file exists next to the hook's copy
 *
 * This is the SECOND copy of the limb. `useConsoleActionRuntime` carried the
 * first, removed by objectui#4282 and pinned by
 * `hooks/__tests__/useConsoleActionRuntime.paramDialogTitle.test.tsx`. This view
 * does not route through that hook — it builds its own runtime and its own
 * near-identical `paramCollectionHandler` — so the two have drifted as a pair
 * and the hook's pin cannot see this site at all. A pin per reader is the only
 * shape that covers both.
 *
 * ## Why this is a pin and not just a deletion
 *
 * Removing an alias is cheap; keeping it removed is the expensive half. The
 * handler's `action` parameter is `any`, so nothing in the compiler stops the
 * limb being helpfully reinstated by the next reader who sees an untitled
 * dialog and reaches for a second key. The second test below is red the moment
 * that happens, and names the rule in its failure.
 *
 * Deliberately NOT pinned here: that a host may not carry a `title` at all.
 * Objects reaching this handler are plain data (objectstack#3903 — stored
 * `sys_metadata` rows are rehydrated unparsed), so a stray key is not an error,
 * it is simply not read. The assertion is about the READER, which is the half
 * this file owns.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

/**
 * Capture the state the param dialog is handed — it IS the assertion subject.
 * The sibling dialogs are orthogonal chrome, stubbed like the other
 * RecordDetailView suites do.
 */
let paramDialogState: any = null;
vi.mock('./ActionParamDialog', () => ({
  ActionParamDialog: ({ state }: any) => {
    if (state?.open) paramDialogState = state;
    return null;
  },
}));
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

// Importing the client modal transport for real drags in <ModalForm> and the
// whole plugin-form graph — same posture as the modal-dispatch suite.
vi.mock('../hooks/useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));

vi.mock('../utils/consoleServerAction', () => ({
  createConsoleServerActionHandler: () => vi.fn(async () => ({ success: true })),
}));

/**
 * Capture every <ActionProvider>'s props while keeping the real provider. The
 * record page's own provider is the one whose CONTEXT carries this record, so
 * the selector below picks it even if a nested surface mounts one of its own.
 * `useObjectLabel` / `useObjectTranslation` are deliberately left REAL: with no
 * bundle loaded they return the metadata literal, which is exactly the
 * "authored value reaches the dialog" path under test.
 */
const captured: Array<{ onParamCollection: any; context: any }> = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: (props: any) => {
      captured.push({ onParamCollection: props.onParamCollection, context: props.context });
      return React.createElement(actual.ActionProvider as any, props);
    },
    SchemaRenderer: () => null,
  };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'crm_call';
const RECORD_ID = 'rec-call-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Call',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

const METADATA = {
  objects: OBJECTS,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as any;

const PARAMS = [{ name: 'comment', label: 'Comment', type: 'textarea' }] as any[];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Intro call' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** The record page's OWN `onParamCollection` — the provider given this record. */
function recordPageParamCollection() {
  return [...captured]
    .reverse()
    .find((c) => c.onParamCollection && c.context?.record?.id === RECORD_ID)?.onParamCollection;
}

/**
 * Mount the view, then drive its `onParamCollection` the way `DeclaredActionsBar`
 * does and read back the state the dialog received. The promise stays pending —
 * that is the real shape too: nothing is POSTed until the dialog's own Confirm.
 */
async function collectParams(dispatch: Record<string, unknown>, interpolate?: (text: string) => string) {
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={METADATA}>
        <RecordDetailView
          dataSource={makeDataSource()}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(recordPageParamCollection()).toBeTruthy());
  const collect = recordPageParamCollection()!;
  paramDialogState = null;
  await act(async () => {
    void collect(PARAMS, dispatch as any, interpolate);
    await Promise.resolve();
  });
}

beforeEach(() => {
  cleanup();
  captured.length = 0;
  paramDialogState = null;
  // Unrelated chrome on this view (approvals, favourites, …) reaches for the
  // platform API; in jsdom that is a real socket. Answer it locally so the only
  // asynchrony left is the record load the capture waits on.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RecordDetailView — the param dialog titles itself from `label` alone (objectui#5610)', () => {
  it('titles the dialog with the action label', async () => {
    await collectParams({
      name: 'approval_reject',
      label: 'Reject',
      objectName: 'sys_approval_request',
    });
    expect(paramDialogState).toBeTruthy();
    expect(paramDialogState.title).toBe('Reject');
  });

  it('does NOT fall back to a `title` key — no producer sets one, so nothing reads one', async () => {
    // The exact shape the removed limb served: an action with no `label` but
    // carrying `title`. Before objectui#5610 this dialog came up titled
    // "Should Not Win"; a key no schema declares and no renderer forwards must
    // not be the thing naming a dialog.
    await collectParams({
      name: 'approval_reject',
      title: 'Should Not Win',
      objectName: 'sys_approval_request',
    });
    expect(paramDialogState).toBeTruthy();
    expect(paramDialogState.title).toBeUndefined();
  });

  it('leaves `label` winning when both are present', async () => {
    // Green before AND after the removal (`||` short-circuits), so it pins no
    // change — it is here to keep the second test's failure legible: if this one
    // is green and that one is red, the limb is back.
    await collectParams({
      name: 'approval_reject',
      label: 'Reject',
      title: 'Should Not Win',
      objectName: 'sys_approval_request',
    });
    expect(paramDialogState.title).toBe('Reject');
  });

  it('titles from `label` independently of the description, which reads one key too', async () => {
    await collectParams({
      name: 'approval_reject',
      label: 'Reject',
      description: 'A rejection is final for every approver.',
      objectName: 'sys_approval_request',
    });
    expect(paramDialogState.title).toBe('Reject');
    expect(paramDialogState.description).toBe('A rejection is final for every approver.');
  });
});

describe('RecordDetailView — the param dialog fills the runner\'s template holes (objectui#12967)', () => {
  /** Stands in for the runner's evaluator over this dispatch's `record`. */
  const interpolate = (text: string) => text.replace(/\$\{record\.name\}/g, 'Intro call');

  it('fills a record hole in the description and hands `interpolate` to the dialog for `helpText`', async () => {
    await collectParams({ name: 'log_call', label: 'Log', description: 'Logging ${record.name}' }, interpolate);
    expect(paramDialogState.description).toBe('Logging Intro call');
    expect(paramDialogState.interpolate).toBe(interpolate);
  });

  it('CONTROL: a runner that supplies no `interpolate` leaves the description as authored', async () => {
    await collectParams({ name: 'log_call', label: 'Log', description: 'Logging ${record.name}' });
    expect(paramDialogState.description).toBe('Logging ${record.name}');
    expect(paramDialogState.interpolate).toBeUndefined();
  });
});
