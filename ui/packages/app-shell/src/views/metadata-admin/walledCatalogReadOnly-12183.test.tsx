// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12183 — under a wall the security catalog is the platform
 * operator's: a walled tenant's catalog pages are read-only and say why, the
 * operator keeps write, `single` is unchanged, and assigning stays writable.
 *
 * ## What the server refuses, and what it publishes
 *
 * objectstack ADR-0131 D3, stage W (objectstack#22895): under `isolated` /
 * `group`, every door that writes a `position`, `permission` or `capability`
 * item asks `walledCatalogWriteVerdict` (`@objectstack/metadata-core`), which
 * admits `isSystem` and the `PLATFORM_ADMIN` posture rung and refuses everyone
 * else, whatever they hold. That covers the `/meta` save, reset, publish and
 * rollback doors, the data door on the catalog objects, and the clone door;
 * the activation door already asked the same rung. Assignments
 * (`sys_user_position`, `sys_user_permission_set`) are never judged.
 *
 * The console reads the two inputs the server publishes: the posture
 * (`features.tenancyPosture`, `useTenancyPosture`) and the caller's rung
 * (`user.isPlatformAdmin` on the session, which objectstack's `customSession`
 * computes as `grants.posture === 'PLATFORM_ADMIN'` from the same resolution
 * the doors read). Both are doubled here; nothing else about the caller is.
 *
 * ## The pins, each against a control that discriminates it
 *
 *  - a walled tenant holding `manage_metadata` is read-only on each catalog
 *    type, on the list (no New, no switch) and in each editor (no Edit, no
 *    Save, no Clone, no rollback), and the page says why in the server rule's
 *    terms;
 *  - the operator (CONTROL) keeps every write, under the same wall;
 *  - `single` (CONTROL) and an unknown posture are unchanged;
 *  - a non-catalog type (CONTROL) stays writable under the wall;
 *  - assigning holders stays writable for the walled tenant, on both halves.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// The list's switch column waits on `audienceAnchorsOf`'s dynamic import of
// this exact specifier. Loaded here, its cost lands in the import phase rather
// than inside a `findBy` window (AGENTS.md, test discipline).
import '@objectstack/spec/identity';
import type { RichMetadataTypeEntry } from './useMetadata';

// ── The published inputs: posture, operator rung, capability ───────────────

let posture: string | undefined;
let operator: boolean | undefined;
let canAuthor: boolean;

vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => posture,
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => canAuthor,
}));
vi.mock('@object-ui/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/auth')>();
  return {
    ...mod,
    // The session payload as objectstack serves it; `undefined` is a session
    // that never published the flag.
    useAuth: () => ({
      ...mod.useAuth(),
      user: { id: 'u_caller', name: 'Caller', email: 'caller@example.com', isPlatformAdmin: operator },
    }),
  };
});

// ── The server's catalog, as `/meta/types` and the item reads serve it ─────

const SCHEMA = { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' } } };

const PERMISSION_ENTRY = { type: 'permission', label: 'Permission Set', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA };
const POSITION_ENTRY = { type: 'position', label: 'Position', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA };
/** The served `capability` entry: code-only, no runtime write channel for anyone. */
const CAPABILITY_ENTRY = { type: 'capability', label: 'Capability', allowEnvironmentOverlay: false, allowRuntimeCreate: false, schema: SCHEMA };
/** `capability` with the `OS_METADATA_WRITABLE` hatch open: only the wall can close it. */
const CAPABILITY_HATCH_ENTRY = { ...CAPABILITY_ENTRY, allowEnvironmentOverlay: true, overrideSource: 'env' };
/** CONTROL: a type outside the security catalog. */
const DASHBOARD_ENTRY = { type: 'dashboard', label: 'Dashboard', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA };

let entries: RichMetadataTypeEntry[] = [];

const ITEM = 'env_item';
const PERMISSION_SET = {
  name: ITEM,
  label: 'Environment Set',
  objects: { a_account: { allowRead: true, allowCreate: true } },
  fields: {},
};
const PACKAGE = 'com.example.showcase';
let itemPackaged = false;

/** The layered read: an environment-authored item the item tier would let anyone write. */
function layeredFor(type: string) {
  const body = type === 'permission' ? PERMISSION_SET : { name: ITEM, label: 'Environment Item' };
  if (itemPackaged) {
    return { code: { ...body, _packageId: PACKAGE }, overlay: null, overlayScope: null, effective: body, provenance: 'package', packageId: PACKAGE, lock: 'none', editable: true, deletable: true };
  }
  return { code: null, overlay: body, overlayScope: 'env', effective: body, provenance: 'org', lock: 'none', editable: true, deletable: true };
}

/** Stable singleton — the pages' load effects key on the client identity. */
const CLIENT = {
  list: vi.fn(async (type: string) => {
    if (type === 'package') return [{ manifest: { id: PACKAGE, scope: 'project', name: 'Showcase' } }];
    if (type === 'object') return [{ item: { name: 'a_account', label: 'Account' } }];
    return [{ name: ITEM, label: 'Environment Item', _packageId: PACKAGE, _provenance: 'package' }];
  }),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async (type: string) => (type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null)),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string) => layeredFor(type)),
  save: vi.fn(async (_t: string, _n: string, payload: Record<string, unknown>) => payload),
  /** One saved version, so the History sheet has a row to offer a rollback on. */
  history: vi.fn(async () => [{ seq: 3, version: 7, op: 'save', ts: '2026-10-01T00:00:00Z' }]),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries }),
}));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./i18n')>()),
  useMetadataLocale: () => 'en-US',
}));

// ── The assignment halves: real sections over a recording adapter ─────────

const adapter = {
  find: vi.fn(async () => ({ data: [] })),
  create: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
};
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/react')>()),
  useAdapter: () => adapter,
  useMetadata: () => ({ ensureType: async () => [] }),
}));
// The picker stands in as one button, rendered while it is open, that picks
// one user: the same `onSelectRecords` hand-off the real dialog makes.
vi.mock('@object-ui/fields', async (importOriginal) => {
  const { createElement } = await import('react');
  return {
    ...(await importOriginal<typeof import('@object-ui/fields')>()),
    RecordPickerDialog: (props: { open: boolean; onSelectRecords?: (records: unknown[]) => void }) =>
      props.open
        ? createElement('button', { type: 'button', onClick: () => props.onSelectRecords?.([{ id: 'u_member' }]) }, 'pick')
        : null,
  };
});

// Imported AFTER the mocks so the pages pick them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { MetadataResourceEditPage } from './ResourceEditPage';
import { PermissionMatrixEditPage } from './PermissionMatrixEditor';
import { registerMetadataPreview, type MetadataPreviewProps } from './preview-registry';
import { t, tFormat, translateMetadataType } from './i18n';
import { walledCatalogReadOnly } from './catalog-scope';

/** Draws the canvas's `editing` prop, which is what design mode is. */
function StubPreview({ editing }: MetadataPreviewProps) {
  return <div data-testid="stub-preview" data-editing={String(!!editing)} />;
}
registerMetadataPreview('view', StubPreview);

beforeEach(() => {
  posture = 'isolated';
  operator = false;
  canAuthor = true;
  itemPackaged = false;
  entries = [PERMISSION_ENTRY, POSITION_ENTRY, CAPABILITY_ENTRY, DASHBOARD_ENTRY] as RichMetadataTypeEntry[];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (String(url).startsWith('/api/v1/data/sys_metadata_activation')) {
        return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
      }
      return json(404, { success: false, error: { message: `unexpected ${url}` } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // objectui#12496 — the page now reopens the sheet a `?tab=` in the window
  // URL names, and opening one writes it there; reset it so a sheet one test
  // opened does not open in the next test's mount.
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

/** The server rule's sentence for one type, as the pages word it. */
const walledSentence = (type: string, label: string) =>
  tFormat('engine.catalog.readOnly.walled', 'en-US', { type: translateMetadataType(type, 'en-US', label) });

const createButton = () => screen.queryByRole('button', { name: new RegExp(t('engine.list.create', 'en-US')) });

// ── The one predicate ───────────────────────────────────────────────────────

describe('walledCatalogReadOnly: the posture, the type and the operator rung (objectui#12183)', () => {
  it('is true only for a non-operator, on a catalog type, under a wall', () => {
    for (const type of ['position', 'permission', 'capability']) {
      for (const wall of ['isolated', 'group'] as const) {
        expect(walledCatalogReadOnly({ type, posture: wall, isPlatformOperator: false })).toBe(true);
        expect(walledCatalogReadOnly({ type, posture: wall, isPlatformOperator: true })).toBe(false);
      }
      expect(walledCatalogReadOnly({ type, posture: 'single', isPlatformOperator: false })).toBe(false);
      expect(walledCatalogReadOnly({ type, posture: undefined, isPlatformOperator: false })).toBe(false);
    }
    expect(walledCatalogReadOnly({ type: 'dashboard', posture: 'isolated', isPlatformOperator: false })).toBe(false);
  });
});

// ── The Setup catalog list ──────────────────────────────────────────────────

function mountList(type: string, search = '?scope=environment') {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}${search}`]}>
      <MetadataResourceListPage type={type} />
    </MemoryRouter>,
  );
}

describe('the catalog list under a wall (objectui#12183)', () => {
  for (const wall of ['isolated', 'group'] as const) {
    for (const entry of [PERMISSION_ENTRY, POSITION_ENTRY]) {
      it(`${wall}: a tenant holding manage_metadata gets no New, no live switch, and the server rule on ${entry.type}`, async () => {
        posture = wall;
        mountList(entry.type);
        const reason = await screen.findByTestId('catalog-readonly-reason');
        expect(reason).toHaveTextContent(walledSentence(entry.type, entry.label));
        expect(createButton()).toBeNull();
        expect(await screen.findByTestId(`catalog-active-${ITEM}`)).toBeDisabled();
      });
    }
  }

  it('CONTROL: the operator under the same wall keeps New and the switch, with no reason', async () => {
    operator = true;
    mountList('permission');
    expect(await screen.findByTestId(`catalog-active-${ITEM}`)).not.toBeDisabled();
    expect(createButton()).not.toBeNull();
    expect(screen.queryByTestId('catalog-readonly-reason')).toBeNull();
  });

  for (const unwalled of ['single', undefined]) {
    it(`CONTROL: posture ${String(unwalled)} is unchanged for the same tenant`, async () => {
      posture = unwalled;
      mountList('position');
      expect(await screen.findByTestId(`catalog-active-${ITEM}`)).not.toBeDisabled();
      expect(createButton()).not.toBeNull();
      expect(screen.queryByTestId('catalog-readonly-reason')).toBeNull();
    });
  }

  it('a session that never published the operator flag reads as no operator standing', async () => {
    operator = undefined;
    mountList('permission');
    await screen.findByTestId('catalog-readonly-reason');
    expect(createButton()).toBeNull();
  });

  it('CONTROL: a type outside the catalog keeps New for the walled tenant', async () => {
    mountList('dashboard');
    await screen.findByRole('link', { name: ITEM });
    expect(createButton()).not.toBeNull();
    expect(screen.queryByTestId('catalog-readonly-reason')).toBeNull();
  });

  it('Studio (no scope) offers no New either: the server refuses the package door too', async () => {
    mountList('position', '');
    await screen.findByRole('link', { name: ITEM });
    expect(createButton()).toBeNull();
    expect(screen.getByTestId('catalog-readonly-reason')).toHaveTextContent(walledSentence('position', 'Position'));
  });
});

// ── The generic editor: position and capability ─────────────────────────────

async function mountEditor(type: string, search = '?scope=environment', createMode = false) {
  render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}/${createMode ? 'new' : ITEM}${search}`]}>
      <MetadataResourceEditPage type={type} name={createMode ? '' : ITEM} createMode={createMode} />
    </MemoryRouter>,
  );
  if (!createMode) await waitFor(() => expect(CLIENT.layered).toHaveBeenCalled());
  await screen.findByDisplayValue(createMode ? '' : 'Environment Item').catch(() => undefined);
}

/** A writable form-only editor draws Edit twice: in the header and in the read-only notice. */
const editButtons = () => screen.queryAllByRole('button', { name: /^Edit$/ });

describe('the position and capability editors under a wall (objectui#12183)', () => {
  it('a walled tenant gets no Edit and no Save on a position, and the server rule, not a missing permission', async () => {
    await mountEditor('position');
    expect(await screen.findByTestId('walled-catalog-readonly-banner')).toHaveTextContent(walledSentence('position', 'Position'));
    expect(editButtons()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(screen.queryByTestId('capability-readonly-banner')).toBeNull();
    expect(screen.queryByTestId('readonly-banner')).toBeNull();
  });

  it('a walled tenant WITHOUT manage_metadata is told the server rule too, since the capability would not admit it', async () => {
    canAuthor = false;
    await mountEditor('position');
    expect(await screen.findByTestId('walled-catalog-readonly-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('capability-readonly-banner')).toBeNull();
  });

  it('the create page offers no Save to a walled tenant and says why', async () => {
    await mountEditor('position', '?scope=environment', true);
    expect(await screen.findByTestId('walled-catalog-readonly-banner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
  });

  it('a hatch-elevated capability is read-only for the walled tenant by the wall; CONTROL: the operator may edit it', async () => {
    entries = [CAPABILITY_HATCH_ENTRY] as RichMetadataTypeEntry[];
    await mountEditor('capability');
    expect(await screen.findByTestId('walled-catalog-readonly-banner')).toHaveTextContent(walledSentence('capability', 'Capability'));
    expect(editButtons()).toHaveLength(0);
    cleanup();

    operator = true;
    await mountEditor('capability');
    expect((await screen.findAllByRole('button', { name: /^Edit$/ })).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('walled-catalog-readonly-banner')).toBeNull();
  });

  it('CONTROL: a stock capability stays read-only by its type for everyone, and the type is the reason named', async () => {
    entries = [CAPABILITY_ENTRY] as RichMetadataTypeEntry[];
    await mountEditor('capability');
    expect(await screen.findByTestId('readonly-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('walled-catalog-readonly-banner')).toBeNull();
    expect(editButtons()).toHaveLength(0);
  });

  it('CONTROL: the operator under the same wall may edit a position', async () => {
    operator = true;
    await mountEditor('position');
    expect((await screen.findAllByRole('button', { name: /^Edit$/ })).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('walled-catalog-readonly-banner')).toBeNull();
  });

  it('CONTROL: under `single` the same tenant may edit a position', async () => {
    posture = 'single';
    await mountEditor('position');
    expect((await screen.findAllByRole('button', { name: /^Edit$/ })).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('walled-catalog-readonly-banner')).toBeNull();
  });

  it("the History sheet offers the walled tenant no rollback (the rollback door refuses it); CONTROL: the operator's does", async () => {
    const rollback = () => screen.queryByTitle(t('engine.edit.rollback', 'en-US'));
    await mountEditor('position');
    fireEvent.click(screen.getByTitle(t('engine.edit.history', 'en-US')));
    await screen.findByText('v7');
    expect(rollback()).toBeNull();
    cleanup();

    operator = true;
    await mountEditor('position');
    fireEvent.click(screen.getByTitle(t('engine.edit.history', 'en-US')));
    await screen.findByText('v7');
    expect(rollback()).not.toBeNull();
  });

  it("assigning stays writable: the walled tenant adds a position's holder, by name", async () => {
    await mountEditor('position');
    const add = await screen.findByRole('button', { name: /Add holder/ });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    fireEvent.click(await screen.findByRole('button', { name: 'pick' }));
    await waitFor(() => expect(adapter.create).toHaveBeenCalledWith('sys_user_position', { user_id: 'u_member', position: ITEM }));
  });
});

// ── The permission-set editor ───────────────────────────────────────────────

async function mountMatrix(search = '?scope=environment', packageId?: string) {
  render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/permission/${ITEM}${search}`]}>
      <PermissionMatrixEditPage type="permission" name={ITEM} packageId={packageId} />
    </MemoryRouter>,
  );
  await screen.findByText('Account');
}

const saveButton = () => screen.queryByRole('button', { name: /^Save$/ });
const cloneButtons = () => screen.queryAllByRole('button', { name: new RegExp(t('perm.clone.action', 'en-US')) });

describe('the permission-set editor under a wall (objectui#12183)', () => {
  it('a walled tenant gets no Save, every grant locked, and the server rule', async () => {
    await mountMatrix();
    expect(saveButton()).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByTestId('perm-walled-readonly')).toHaveTextContent(walledSentence('permission', 'Permission Set'));
    expect(screen.getByText(t('perm.readOnly.walled', 'en-US'))).toBeInTheDocument();
    expect(screen.queryByTestId('perm-capability-readonly')).toBeNull();
  });

  it('a walled tenant is offered no Clone of a packaged set (the clone door refuses tenants); CONTROL: the operator is', async () => {
    itemPackaged = true;
    await mountMatrix();
    expect(cloneButtons()).toHaveLength(0);
    cleanup();

    operator = true;
    await mountMatrix();
    expect(cloneButtons().length).toBeGreaterThan(0);
  });

  it("Studio's package door is refused the same way: the grants are locked", async () => {
    await mountMatrix('', PACKAGE);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  });

  it('CONTROL: the operator under the same wall gets Save and live grants', async () => {
    operator = true;
    await mountMatrix();
    expect(saveButton()).toBeEnabled();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(screen.queryByTestId('perm-walled-readonly')).toBeNull();
  });

  it('CONTROL: under `single` the same tenant gets Save and live grants', async () => {
    posture = 'single';
    await mountMatrix();
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByTestId('perm-walled-readonly')).toBeNull();
  });

  it("assigning stays writable: the walled tenant grants the set to a member, by name", async () => {
    await mountMatrix();
    const add = await screen.findByRole('button', { name: /Add user/ });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    fireEvent.click(await screen.findByRole('button', { name: 'pick' }));
    await waitFor(() =>
      expect(adapter.create).toHaveBeenCalledWith('sys_user_permission_set', expect.objectContaining({ user_id: 'u_member', permission_set: ITEM })),
    );
  });
});

// ── Rider: the designer auto-on effect reads the whole write gate ───────────

describe('the designer opens in design mode only for a caller who can save (objectui#7611 pointer)', () => {
  const VIEW_ENTRY = { type: 'view', label: 'View', allowEnvironmentOverlay: true, allowRuntimeCreate: true, schema: SCHEMA };

  async function mountDesigner() {
    entries = [VIEW_ENTRY] as RichMetadataTypeEntry[];
    render(
      <MemoryRouter initialEntries={[`/metadata/view/${ITEM}`]}>
        <MetadataResourceEditPage type="view" name={ITEM} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(CLIENT.layered).toHaveBeenCalled());
    await screen.findByTestId('stub-preview');
    // Let the auto-on effect settle before reading `editing`.
    await new Promise((r) => setTimeout(r, 30));
    return screen.getByTestId('stub-preview').getAttribute('data-editing');
  }

  it('a caller without manage_metadata lands in preview, not in design mode with no Save', async () => {
    posture = 'single';
    canAuthor = false;
    expect(await mountDesigner()).toBe('false');
  });

  it('CONTROL: a holder lands in design mode', async () => {
    posture = 'single';
    expect(await mountDesigner()).toBe('true');
  });
});
