// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Clone to customize" — the locked permission matrix's primary action
 * (objectui#5987, the UI half of objectstack#11513), calling the server's
 * clone door (objectui#7611, PR-4).
 *
 * ## What is pinned
 *
 * The artifact tier (`isArtifactBackedLayer`, objectui#4518 / #4526) locks a set
 * a code package ships. The maintainer's ruling on objectstack#11513 — 「同意
 * 第一步(创业阶段,Salesforce 式)」: lock the base, clone to customize — makes
 * cloning the sanctioned edit path. The seat's ruling on objectui#7611
 * (6097763840, Q1 → A) puts the copy on the server: a door that copies the
 * whole definition under a new name, "objectui calling it with a name and a
 * label". This suite pins that the editor:
 *
 *   1. renders "Clone to customize" as the locked editor's PRIMARY action, in
 *      the slot Save would occupy, and names cloning FIRST in its guidance
 *      (en-US and zh-CN);
 *   2. asks for a new name and label, and POSTs exactly `{ name, label }` to
 *      `POST /api/v1/security/permission-sets/:name/clone` for THIS set — no
 *      record read, no record action, no facet sent;
 *   3. opens the returned copy, which loads with no code layer and is writable,
 *      in the same scope, with the server's notice shown as sent;
 *   4. shows a refusal's own message as sent (409 a taken name, 403 a caller
 *      without `manage_metadata`), and stays on the base;
 *   5. offers no clone to a caller without `manage_metadata`, nor on an
 *      org-owned set, a type-locked set or a host-locked package (the
 *      controls);
 *   6. surfaces the same guidance when a save that reached the server is
 *      refused `403 NOT_OVERRIDABLE`, keyed on the code.
 *
 * ## The door's answers are transcribed from the door
 *
 * The 200 body is `{ success: true, data: { permissionSet, notice } }`, the
 * notice being `PERMISSION_SET_CLONE_NOTICE` and the refusal texts the door's
 * own (`packages/runtime/src/domains/permission-set-clone.ts`, objectstack
 * #22881), each measured against a running showcase for this suite's PR.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';

const BASE_SET = 'showcase_contributor';
const CLONE_NAME = 'my_clone';
const CLONE_LABEL = 'My clone';
const DOOR = `/api/v1/security/permission-sets/${BASE_SET}/clone`;

/** `PERMISSION_SET_CLONE_NOTICE`, as the door sends it. */
const NOTICE =
  'The copy is a new permission set authored in this environment, with no link to the set it was copied '
  + 'from: changes to that set do not reach it. Not copied: delegated-admin scope (`adminScope`) and the '
  + 'everyone-baseline suggestion (`isDefault`) — grant either deliberately on the copy if it needs one. '
  + 'The copy is held by nobody yet: add it to a position, or assign it to users.';

/** The door's 409 for a taken name. */
const NAME_TAKEN =
  `Permission set '${CLONE_NAME}' already exists — a clone must take a NEW machine name. `
  + 'Permission sets are assigned by name, so a second definition under one name would change what every '
  + `holder of '${CLONE_NAME}' is granted (ADR-0126 §7.1). Retry with a name no permission set uses (for example '${CLONE_NAME}_copy').`;

/** The metadata door's capability refusal, which the clone door asks too. */
const NO_CAPABILITY = 'Saving a metadata item requires the `manage_metadata` capability.';

/* ── Fakes ───────────────────────────────────────────────────────────────── */

// Which sets a code package ships, by name: the layered envelope's `code` slot.
let codeLayerByName: Record<string, Record<string, unknown> | null> = {};
// What `client.save` does — the default resolves; item 6 makes it refuse.
let saveImpl: (type: string, name: string, payload: Record<string, unknown>) => Promise<unknown> =
  async (_t, _n, payload) => payload;

const SET_BODY = {
  label: 'Contributor',
  objects: { a_account: { allowRead: true, allowCreate: true } },
  fields: {},
} as Record<string, unknown>;

function makeClient() {
  return {
    layered: vi.fn(async (_type: string, name: string) => ({
      effective: { ...SET_BODY, name },
      code: codeLayerByName[name] ?? null,
      overlay: null,
      overlayScope: null,
    })),
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? [{ item: { name: 'a_account', label: 'Account' } }] : [],
    get: async (type: string) =>
      type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null,
    save: async (type: string, name: string, payload: Record<string, unknown>) => saveImpl(type, name, payload),
  } as any;
}

// The stock-boot `permission` shape (objectstack#6483) unless a case says otherwise.
let typeFlags: { allowEnvironmentOverlay?: boolean; allowRuntimeCreate?: boolean } = {
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
};
let clientImpl: any;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', ...typeFlags }],
  }),
}));

let localeFixture: 'en-US' | 'zh-CN' = 'en-US';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

let canAuthor = true;
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => canAuthor,
}));

// The holders section reads grants of its own; here it says which set it was
// handed, so the scope the copy opens in is visible, and reports each read the
// way the real one does (`onHoldersRead`, objectui#13272): once on mount with
// `holdersByName`'s count, and again after its "Add" (a grant, then a re-read).
let holdersByName: Record<string, number> = {};
vi.mock('./AssignedUsersSection', () => ({
  AssignedUsersSection: ({
    permissionSetName,
    onHoldersRead,
  }: {
    permissionSetName: string;
    onHoldersRead?: (count: number, setName: string) => void;
  }) => {
    React.useEffect(() => {
      onHoldersRead?.(holdersByName[permissionSetName] ?? 0, permissionSetName);
      // Once per set, as the real section's load is keyed on the set name.
    }, [permissionSetName]);
    return (
      <div>
        <div data-testid="assigned-users-stub">{permissionSetName}</div>
        <button
          type="button"
          onClick={() => {
            holdersByName[permissionSetName] = (holdersByName[permissionSetName] ?? 0) + 1;
            onHoldersRead?.(holdersByName[permissionSetName], permissionSetName);
          }}
        >
          Stub add holder
        </button>
      </div>
    );
  },
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

/* ── The door ────────────────────────────────────────────────────────────── */

interface Call {
  url: string;
  method: string;
  body: unknown;
}
let doorAnswer: { status: number; body: unknown } = { status: 200, body: null };
const calls: Call[] = [];

function okAnswer(name = CLONE_NAME) {
  return {
    status: 200,
    body: {
      success: true,
      data: { permissionSet: { ...SET_BODY, name, label: CLONE_LABEL }, notice: NOTICE },
    },
  };
}

function refusal(status: number, code: string, message?: string) {
  return {
    status,
    body: { success: false, error: { code, ...(message ? { message } : {}), httpStatus: status } },
  };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      return new Response(JSON.stringify(doorAnswer.body), {
        status: doorAnswer.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function RoutedEditor() {
  const { name = '' } = useParams<{ name?: string }>();
  const { search } = useLocation();
  return (
    <>
      <span data-testid="route-search">{search}</span>
      <PermissionMatrixEditPage type="permission" name={name} />
    </>
  );
}

/**
 * The routed metadata admin: `metadata/:type/:name`, the one surface where the
 * artifact tier engages (environment scope, no `packageId`).
 */
async function renderRouted(search = '') {
  clientImpl = makeClient();
  render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/permission/${BASE_SET}${search}`]}>
      <Routes>
        <Route path="/apps/:appName/metadata/:type/:name" element={<RoutedEditor />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText('Account');
}

async function renderPlain(props?: { packageId?: string; readOnly?: boolean; embedded?: boolean }) {
  clientImpl = makeClient();
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name={BASE_SET} {...props} />
    </MemoryRouter>,
  );
  await screen.findByText('Account');
}

const CLONE_EN = /^Clone to customize$/;
const CLONE_ZH = /^克隆后自定义$/;
const cloneButtons = () => screen.queryAllByRole('button', { name: CLONE_EN });
const saveButton = () => screen.queryByRole('button', { name: /^Save$/ });
const createCopy = () => screen.getByRole('button', { name: /^Create copy$/ });

/** Open the dialog from the first Clone button and fill both fields. */
async function fillDialog(name = CLONE_NAME, label = CLONE_LABEL) {
  fireEvent.click(cloneButtons()[0]);
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('New machine name'), { target: { value: name } });
  fireEvent.change(within(dialog).getByLabelText('New label'), { target: { value: label } });
  return dialog;
}

beforeEach(() => {
  codeLayerByName = { [BASE_SET]: { _packageId: 'com.example.showcase', name: BASE_SET } };
  saveImpl = async (_t, _n, payload) => payload;
  typeFlags = { allowEnvironmentOverlay: false, allowRuntimeCreate: true };
  localeFixture = 'en-US';
  canAuthor = true;
  doorAnswer = okAnswer();
  holdersByName = {};
  calls.length = 0;
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('PermissionMatrixEditPage — the locked editor offers Clone to customize (objectui#5987)', () => {
  it('renders "Clone to customize" as the primary action where Save would be, and no Save', async () => {
    await renderRouted();

    expect(saveButton()).toBeNull();
    const [clone] = cloneButtons();
    expect(clone).toBeInTheDocument();
    expect(clone).toBeEnabled();
    // The visible locked-state guidance names cloning.
    expect(screen.getByRole('note')).toHaveTextContent(/Clone to customize/);
  });

  it('the artifact badge hint names cloning FIRST; the former remedies follow as secondary routes', async () => {
    await renderRouted();

    const badge = screen.getByText(/provided by a code package/);
    const hint = badge.getAttribute('title') ?? '';
    const clone = hint.indexOf('Clone to customize');
    expect(clone).toBeGreaterThan(-1);
    for (const secondary of ['redeploy', 'new runtime set']) {
      const at = hint.indexOf(secondary);
      expect(at, `"${secondary}" must be in the hint`).toBeGreaterThan(-1);
      expect(clone, `cloning must come before "${secondary}"`).toBeLessThan(at);
    }
    // objectui#12141 — the env hatch is no longer a route: ADR-0131 D6 seals
    // what a package ships, so the hint names it only to say it does not open
    // this set, and never as something to ask an operator for.
    expect(hint).toContain('OS_METADATA_WRITABLE escape hatch does not open a set a package ships');
    expect(hint).not.toMatch(/ask an operator for the documented OS_METADATA_WRITABLE/);
    // The server's own reason and code are still stated (objectui#4518's pins
    // on this hint are unchanged).
    expect(hint).toContain('allowEnvironmentOverlay');
    expect(hint).toContain('not_overridable');
  });

  it('zh-CN: the same primary action and guidance', async () => {
    localeFixture = 'zh-CN';
    await renderRouted();

    expect(screen.getByRole('button', { name: CLONE_ZH })).toBeInTheDocument();
    expect(cloneButtons()).toHaveLength(0);
    expect(screen.getByRole('note')).toHaveTextContent(/克隆后自定义/);
    // Exact: the guidance note above also says 由代码包提供.
    const badge = screen.getByText('只读（该权限集由代码包提供）', { exact: true });
    const hint = badge.getAttribute('title') ?? '';
    expect(hint.indexOf('克隆后自定义')).toBeGreaterThan(-1);
    expect(hint.indexOf('克隆后自定义')).toBeLessThan(hint.indexOf('重新部署'));
  });
});

describe('PermissionMatrixEditPage — Clone to customize calls the clone door with a name and a label (objectui#7611)', () => {
  it('POSTs exactly { name, label } to the door for THIS set, and nothing else', async () => {
    await renderRouted();
    fireEvent.click(cloneButtons()[0]);
    const dialog = await screen.findByRole('dialog');
    // Nothing is sent until both are given.
    expect(createCopy()).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('New machine name'), { target: { value: CLONE_NAME } });
    expect(createCopy()).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('New label'), { target: { value: CLONE_LABEL } });
    fireEvent.click(createCopy());

    await waitFor(() => expect(calls).toHaveLength(1));
    // The one request this clone makes: no record read, no record action.
    expect(calls[0]).toEqual({ url: DOOR, method: 'POST', body: { name: CLONE_NAME, label: CLONE_LABEL } });
  });

  it('the copy opens writable, in the same scope, with the server\'s notice shown as sent', async () => {
    await renderRouted('?scope=environment');
    await fillDialog();
    fireEvent.click(createCopy());

    // The copy loads with no code layer (`codeLayerByName` names only the
    // base), so the artifact tier does not engage.
    const save = await screen.findByRole('button', { name: /^Save$/ });
    expect(save).toBeEnabled();
    expect(cloneButtons()).toHaveLength(0);
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(/provided by a code package/)).toBeNull();
    // The editor is on the copy, not the base: it read the copy's envelope…
    expect(clientImpl.layered.mock.calls.some((c: unknown[]) => c[1] === CLONE_NAME)).toBe(true);
    // …in the Setup catalog still, where the copy's holders are listed.
    expect(screen.getByTestId('route-search')).toHaveTextContent('?scope=environment');
    expect(screen.getByTestId('assigned-users-stub')).toHaveTextContent(CLONE_NAME);
    // What was not copied, in the server's words.
    expect(screen.getByTestId('perm-clone-notice')).toHaveTextContent(NOTICE);
  });

  it('an embedded host has no route: the copy is announced by name, with the server\'s notice', async () => {
    await renderPlain({ embedded: true });
    await fillDialog();
    fireEvent.click(createCopy());

    const notice = await screen.findByTestId('perm-clone-notice');
    expect(notice).toHaveTextContent(new RegExp(`Cloned as ${CLONE_NAME}`));
    expect(notice).toHaveTextContent(NOTICE);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a cancelled dialog sends nothing and shows no error', async () => {
    await renderRouted();
    await fillDialog();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
    // Still on the locked base.
    expect(cloneButtons()).toHaveLength(1);
  });

  it('an answer that names no copy is said so, never guessed', async () => {
    doorAnswer = { status: 200, body: { success: true, data: { notice: NOTICE } } };
    await renderRouted();
    await fillDialog();
    fireEvent.click(createCopy());

    await screen.findByText(/did not name it/);
    expect(clientImpl.layered.mock.calls.some((c: unknown[]) => c[1] === CLONE_NAME)).toBe(false);
  });
});

describe('PermissionMatrixEditPage — the door\'s refusals are shown as sent (objectui#7611)', () => {
  it('409, a taken name: the server\'s message in the dialog, which stays open on the base', async () => {
    doorAnswer = refusal(409, 'RESOURCE_CONFLICT', NAME_TAKEN);
    await renderRouted();
    const dialog = await fillDialog();
    fireEvent.click(createCopy());

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NAME_TAKEN);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Nothing opened: the editor is still on the base.
    expect(clientImpl.layered.mock.calls.every((c: unknown[]) => c[1] === BASE_SET)).toBe(true);
    // Editing the name clears the refusal, ready for a retry.
    fireEvent.change(within(dialog).getByLabelText('New machine name'), { target: { value: 'my_clone_2' } });
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('403, a caller the client could not tell apart (unknown fails open): the server\'s sentence', async () => {
    doorAnswer = refusal(403, 'PERMISSION_DENIED', NO_CAPABILITY);
    await renderRouted();
    const dialog = await fillDialog();
    fireEvent.click(createCopy());

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NO_CAPABILITY);
  });

  it('a refusal with no message names the HTTP status, and only then', async () => {
    doorAnswer = refusal(503, 'SERVICE_UNAVAILABLE');
    await renderRouted();
    const dialog = await fillDialog();
    fireEvent.click(createCopy());

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not clone this permission set (HTTP 503).',
    );
  });
});

describe('PermissionMatrixEditPage — no clone prompt where the artifact tier is not the gate (objectui#5987)', () => {
  it('a caller without manage_metadata is offered no clone: the door would refuse it (objectui#7611)', async () => {
    canAuthor = false;
    await renderRouted();

    expect(cloneButtons()).toHaveLength(0);
    expect(screen.getByTestId('perm-capability-readonly')).toHaveTextContent(/manage_metadata/);
  });

  it('an org-owned set (no code layer) is writable and shows no clone prompt', async () => {
    codeLayerByName = {};
    await renderRouted();

    expect(saveButton()).toBeInTheDocument();
    expect(cloneButtons()).toHaveLength(0);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('a published org set (the sys_metadata sentinel) is writable and shows no clone prompt', async () => {
    codeLayerByName = { [BASE_SET]: { _packageId: 'sys_metadata', name: BASE_SET } };
    await renderRouted();

    expect(saveButton()).toBeInTheDocument();
    expect(cloneButtons()).toHaveLength(0);
  });

  it('a type with no runtime write channel is locked by the TYPE tier: nothing to clone into', async () => {
    typeFlags = { allowEnvironmentOverlay: false, allowRuntimeCreate: false };
    await renderRouted();

    expect(screen.getByText(/no runtime write channel/)).toBeInTheDocument();
    expect(cloneButtons()).toHaveLength(0);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('a host-locked package (readOnly) shows the package lock, not a clone prompt', async () => {
    await renderPlain({ readOnly: true, packageId: 'com.example.showcase' });

    expect(screen.getByText('Read-only', { exact: true })).toBeInTheDocument();
    expect(cloneButtons()).toHaveLength(0);
  });
});

describe('PermissionMatrixEditPage — a save the server refuses as a packaged set shows the same guidance (objectui#5987 item 3)', () => {
  const SERVER_TEXT =
    "Metadata item 'permission/showcase_contributor' is provided by a code package and the type has not "
    + 'opted into per-org overlay writes (allowEnvironmentOverlay=false). Edit the source artifact and redeploy, '
    + 'or set OS_METADATA_WRITABLE to grant a runtime escape hatch.';

  it('403 NOT_OVERRIDABLE at the environment door: guidance names cloning, the primary action is offered, the server sentence is kept', async () => {
    // The client reads this set as writable (no code layer) — the server's
    // answer is the truth the editor must surface.
    codeLayerByName = {};
    saveImpl = async () => {
      throw Object.assign(new Error(SERVER_TEXT), { status: 403, code: 'NOT_OVERRIDABLE' });
    };
    await renderRouted();
    fireEvent.click(saveButton()!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Save refused \(403 not_overridable\)/);
    expect(alert).toHaveTextContent(/Clone to customize instead/);
    expect(within(alert).getByRole('button', { name: CLONE_EN })).toBeEnabled();
    // The server's own sentence is kept for diagnosis, not shown alone.
    expect(within(alert).getByText(SERVER_TEXT)).toBeInTheDocument();
    // …and it is not ALSO rendered as the generic red strip.
    expect(screen.getAllByText(SERVER_TEXT)).toHaveLength(1);

    // The offered action is the same dialog as the lock's, for THIS set.
    fireEvent.click(within(alert).getByRole('button', { name: CLONE_EN }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(BASE_SET);
    fireEvent.change(within(dialog).getByLabelText('New machine name'), { target: { value: CLONE_NAME } });
    fireEvent.change(within(dialog).getByLabelText('New label'), { target: { value: CLONE_LABEL } });
    fireEvent.click(createCopy());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe(DOOR);
  });

  it('the refusal is keyed on the CODE: the lowercase spelling an older server emits is the same refusal', async () => {
    codeLayerByName = {};
    saveImpl = async () => {
      throw Object.assign(new Error(SERVER_TEXT), { status: 403, code: 'not_overridable' });
    };
    await renderRouted();
    fireEvent.click(saveButton()!);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: CLONE_EN })).toBeInTheDocument();
  });

  it('control: any other refusal stays the generic strip, with no clone prompt', async () => {
    codeLayerByName = {};
    saveImpl = async () => {
      throw Object.assign(new Error('[Security] Access denied'), { status: 403, code: 'PERMISSION_DENIED' });
    };
    await renderRouted();
    fireEvent.click(saveButton()!);

    await screen.findByText('[Security] Access denied');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(cloneButtons()).toHaveLength(0);
  });

  it('control: under the package door the same code is not the artifact lock, so no clone prompt', async () => {
    codeLayerByName = {};
    saveImpl = async () => {
      throw Object.assign(new Error(SERVER_TEXT), { status: 403, code: 'NOT_OVERRIDABLE' });
    };
    await renderPlain({ packageId: 'com.example.showcase' });
    // objectui#11787 — the package door has no Save button: an edit autosaves
    // to the package draft after the shared autosave's pause.
    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    await screen.findByText(SERVER_TEXT, undefined, { timeout: 4000 });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(cloneButtons()).toHaveLength(0);
  });
});

describe('PermissionMatrixEditPage — the clone notice is point-in-time: a saved copy is past it (objectui#13272)', () => {
  it('control: right after the clone, with no save, the copy shows the server\'s notice verbatim', async () => {
    await renderRouted();
    await fillDialog();
    fireEvent.click(createCopy());

    await screen.findByRole('button', { name: /^Save$/ });
    const notice = screen.getByTestId('perm-clone-notice');
    // Verbatim: the whole server string, not a rewording or an excerpt.
    expect(notice.textContent).toBe(NOTICE);
  });

  it('clone, then Save the copy: the notice is gone', async () => {
    const saved: string[] = [];
    saveImpl = async (_t, name, payload) => {
      saved.push(name);
      return payload;
    };
    await renderRouted();
    await fillDialog();
    fireEvent.click(createCopy());

    const save = await screen.findByRole('button', { name: /^Save$/ });
    expect(screen.getByTestId('perm-clone-notice')).toHaveTextContent(NOTICE);
    fireEvent.click(save);

    await waitFor(() => expect(saved).toEqual([CLONE_NAME]));
    await waitFor(() => expect(screen.queryByTestId('perm-clone-notice')).toBeNull());
  });

  it('control: a refused save of the copy keeps the notice — the copy is not saved', async () => {
    await renderRouted();
    await fillDialog();
    fireEvent.click(createCopy());

    const save = await screen.findByRole('button', { name: /^Save$/ });
    saveImpl = async () => {
      throw Object.assign(new Error('[Security] Access denied'), { status: 403, code: 'PERMISSION_DENIED' });
    };
    fireEvent.click(save);

    await screen.findByText('[Security] Access denied');
    expect(screen.getByTestId('perm-clone-notice')).toHaveTextContent(NOTICE);
  });

  it('control: on an embedded host the notice sits on the base, and saving the BASE keeps it', async () => {
    // The base reads writable; its first save is refused as packaged, which
    // offers the clone (the only way onto the clone dialog from a writable set).
    codeLayerByName = {};
    const saved: string[] = [];
    saveImpl = async () => {
      throw Object.assign(new Error('packaged'), { status: 403, code: 'NOT_OVERRIDABLE' });
    };
    await renderPlain({ embedded: true });
    fireEvent.click(saveButton()!);
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: CLONE_EN }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('New machine name'), { target: { value: CLONE_NAME } });
    fireEvent.change(within(dialog).getByLabelText('New label'), { target: { value: CLONE_LABEL } });
    fireEvent.click(createCopy());
    const notice = await screen.findByTestId('perm-clone-notice');
    expect(notice).toHaveTextContent(new RegExp(`Cloned as ${CLONE_NAME}`));

    saveImpl = async (_t, name, payload) => {
      saved.push(name);
      return payload;
    };
    fireEvent.click(saveButton()!);

    await waitFor(() => expect(saved).toEqual([BASE_SET]));
    // The base's save says nothing about the copy, which is still unsaved and unheld.
    expect(screen.getByTestId('perm-clone-notice')).toHaveTextContent(NOTICE);
  });

  it('clone, then add a holder through the holders section: the notice is gone', async () => {
    // The Setup catalog's scope, where the holders section renders.
    await renderRouted('?scope=environment');
    await fillDialog();
    fireEvent.click(createCopy());

    await screen.findByRole('button', { name: /^Save$/ });
    expect(screen.getByTestId('perm-clone-notice')).toHaveTextContent(NOTICE);
    expect(screen.getByTestId('assigned-users-stub')).toHaveTextContent(CLONE_NAME);
    fireEvent.click(screen.getByRole('button', { name: 'Stub add holder' }));

    await waitFor(() => expect(screen.queryByTestId('perm-clone-notice')).toBeNull());
  });

  it('control: the copy\'s holders read reporting 0 keeps the notice', async () => {
    // The Setup catalog's scope, where the holders section renders.
    await renderRouted('?scope=environment');
    await fillDialog();
    fireEvent.click(createCopy());

    await screen.findByRole('button', { name: /^Save$/ });
    // The stub reported the copy's mount read (0 holders) before Save showed.
    expect(screen.getByTestId('assigned-users-stub')).toHaveTextContent(CLONE_NAME);
    expect(screen.getByTestId('perm-clone-notice')).toHaveTextContent(NOTICE);
  });

  it('control: the base\'s holders do not retire the copy\'s notice', async () => {
    holdersByName = { [BASE_SET]: 3 };
    // The Setup catalog's scope, where the holders section renders.
    await renderRouted('?scope=environment');
    await fillDialog();
    fireEvent.click(createCopy());

    await screen.findByRole('button', { name: /^Save$/ });
    expect(screen.getByTestId('assigned-users-stub')).toHaveTextContent(CLONE_NAME);
    expect(screen.getByTestId('perm-clone-notice')).toHaveTextContent(NOTICE);
  });
});
