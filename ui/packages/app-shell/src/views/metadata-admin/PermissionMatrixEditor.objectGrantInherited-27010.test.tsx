// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27010 — the permission matrix's object rows show exactly the
 * object entry the runtime applies, and every control writes only what the
 * admin sees change.
 *
 * The drawing itself is `objectRuleCell` (`permission-slice.ts`), pinned case by
 * case against the runtime's table in `permission-slice.objectGrant-27010.test.ts`;
 * this file pins that both renderings of the editor (the routed page, which is
 * also the Setup catalog's editor, and the Studio Access pillar's Objects tab)
 * draw it, and that their writes start from it. Every write assertion reads the
 * SAVED payload, the only thing either save door persists.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type Perm = Record<string, unknown>;
interface SavedSet {
  objects: Record<string, Perm>;
  fields?: Record<string, Perm>;
}
interface FakeServer {
  set: SavedSet & { name: string; [extra: string]: unknown };
  saved: SavedSet[];
  catalog: Array<{ item: Record<string, unknown> }>;
}

/** The catalog: two public objects and one private one (`access.default: 'private'`). */
const CATALOG = [
  { item: { name: 'a_project' } },
  { item: { name: 'a_task', access: { default: 'public' } } },
  { item: { name: 'a_secret', access: { default: 'private' } } },
];

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const SUPER = { ...CRUD, viewAllRecords: true, modifyAllRecords: true };

function makeClient(server: FakeServer) {
  return {
    layered: async () => ({ effective: server.set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? server.catalog : type === 'permission' ? [{ name: 'project_editor' }] : [],
    get: async (type: string) => (type === 'object' ? { fields: [{ name: 'notes' }] } : null),
    save: async (_t: string, _n: string, payload: SavedSet) => {
      server.saved.push(JSON.parse(JSON.stringify(payload)) as SavedSet);
      return payload;
    },
  } as never;
}

let clientImpl: unknown;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  CapabilityMultiSelectField: () => <div data-testid="cap-picker" />,
  parseCapabilityNames: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : []),
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

async function renderSet(
  objects: Record<string, Perm>,
  opts: {
    studio?: boolean;
    packageId?: string;
    tab?: 'objects' | 'admin';
    extra?: Record<string, unknown>;
    catalog?: FakeServer['catalog'];
  } = {},
): Promise<FakeServer> {
  const server: FakeServer = {
    set: { name: 'project_editor', objects, fields: {}, ...opts.extra },
    saved: [],
    catalog: opts.catalog ?? CATALOG,
  };
  clientImpl = makeClient(server);
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="project_editor"
        packageId={opts.packageId}
        studio={opts.studio ? { tab: opts.tab ?? 'objects', onTabChange: () => {} } : undefined}
      />
    </MemoryRouter>,
  );
  await screen.findAllByText(String(server.catalog[server.catalog.length - 1].item.name));
  return server;
}

const box = (objectName: string, tip: string) => screen.getByLabelText(`${objectName} ${tip}`);

/** The environment door's explicit Save; the payload the client was handed. */
async function save(server: FakeServer): Promise<SavedSet> {
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  await waitFor(() => expect(server.saved.length).toBe(1));
  return server.saved[0];
}

function rowOf(objectName: string): HTMLElement {
  const found = screen.getAllByRole('row').find((r) => within(r).queryByText(objectName) != null);
  expect(found, `row for ${objectName}`).toBeTruthy();
  return found!;
}

describe('an object row draws the entry the runtime applies (objectstack#27010)', () => {
  for (const studio of [false, true]) {
    const where = studio ? 'the Studio Objects tab' : 'the routed page';

    it(`${where}: a public object with no entry draws the set's '*' entry, marked inherited`, async () => {
      await renderSet({ '*': CRUD }, { studio });
      for (const tip of ['Create', 'Read', 'Edit', 'Delete']) {
        expect(box('a_project', tip)).toBeChecked();
        expect(box('a_project', tip)).toHaveAttribute('data-object-rule', 'wildcard');
      }
      expect(box('a_project', 'Transfer ownership')).not.toBeChecked();
      expect(box('a_project', 'Edit')).toHaveAttribute(
        'title',
        expect.stringContaining('No explicit grant on this object'),
      );
      expect(screen.getByTestId('perm-object-inherited-legend')).toBeInTheDocument();
    });

    it(`${where}: a private object is not covered by a plain '*' entry: drawn ungranted, not inherited`, async () => {
      await renderSet({ '*': CRUD }, { studio });
      for (const tip of ['Create', 'Read', 'Edit', 'Delete']) {
        expect(box('a_secret', tip)).not.toBeChecked();
        expect(box('a_secret', tip)).toHaveAttribute('data-object-rule', 'none');
      }
    });

    it(`${where}: a private object IS covered by a '*' entry carrying a super-user bit`, async () => {
      await renderSet({ '*': SUPER }, { studio });
      expect(box('a_secret', 'Edit')).toBeChecked();
      expect(box('a_secret', 'Modify All Records (bypass sharing)')).toBeChecked();
      expect(box('a_secret', 'Edit')).toHaveAttribute('data-object-rule', 'wildcard');
    });

    it(`${where}: an object's own entry is drawn as it is, and '*' does not add to it`, async () => {
      await renderSet({ '*': CRUD, a_project: { allowRead: true }, a_task: {} }, { studio });
      expect(box('a_project', 'Read')).toBeChecked();
      expect(box('a_project', 'Edit')).not.toBeChecked();
      expect(box('a_project', 'Edit')).toHaveAttribute('data-object-rule', 'entry');
      // An empty entry of its own is still the object's entry: nothing granted.
      expect(box('a_task', 'Read')).not.toBeChecked();
      expect(box('a_task', 'Read')).toHaveAttribute('data-object-rule', 'entry');
    });
  }

  it('a set without a `*` entry draws no inherited row and no legend', async () => {
    await renderSet({ a_project: { allowRead: true } });
    expect(box('a_task', 'Read')).toHaveAttribute('data-object-rule', 'none');
    expect(screen.queryByTestId('perm-object-inherited-legend')).toBeNull();
  });

  it("an inherited row's scope pickers draw the `*` entry's scopes, marked inherited", async () => {
    await renderSet({ '*': { ...CRUD, readScope: 'own' } });
    const picker = screen.getByTestId('perm-scope-read-a_project');
    expect(picker).toHaveTextContent(/^Own$/);
    expect(picker).toHaveAttribute('data-object-rule', 'inherited');
    expect(screen.getByTestId('perm-scope-read-a_secret')).not.toHaveAttribute('data-object-rule');
  });

  it("the field rows under an inherited object draw the `*` entry's Read and Edit", async () => {
    await renderSet({ '*': { allowRead: true } });
    fireEvent.click(screen.getByRole('button', { name: /a_project/ }));
    const notesRead = await screen.findByLabelText('a_project.notes readable');
    expect(notesRead).toBeChecked();
    expect(screen.getByLabelText('a_project.notes editable')).not.toBeChecked();
  });

  it('"Only granted" keeps a row the `*` entry grants and drops one it does not reach', async () => {
    await renderSet({ '*': CRUD });
    fireEvent.click(screen.getByLabelText('Only granted'));
    expect(screen.queryByText('a_project')).toBeInTheDocument();
    expect(screen.queryByText('a_task')).toBeInTheDocument();
    expect(screen.queryByText('a_secret')).toBeNull();
  });

  it('the granted-object count counts the objects the rows draw as granted, not the `*` key', async () => {
    await renderSet({ '*': CRUD }, { studio: true });
    // a_project and a_task inherit; a_secret is private and not reached.
    expect(screen.getByText(/2 objects granted/)).toBeInTheDocument();
  });
});

describe('the delegated-admin companion grants read the catalog posture the rows read (objectstack#27010)', () => {
  it("a companion object the plain `*` entry reaches is granted; a private one is not", async () => {
    await renderSet(
      { '*': { allowRead: true } },
      {
        studio: true,
        tab: 'admin',
        extra: { adminScope: { businessUnit: 'bu_ops', manageAssignments: true } },
        catalog: [
          { item: { name: 'sys_business_unit' } },
          { item: { name: 'sys_user', access: { default: 'private' } } },
        ],
      },
    );
    const companion = (id: string) => screen.getByTestId(`admin-companion-${id}`);
    expect(companion('sys_business_unit')).toHaveAttribute('data-granted', 'true');
    expect(companion('sys_user')).toHaveAttribute('data-granted', 'false');
  });
});

describe('every object-row control writes only what the admin sees change (objectstack#27010)', () => {
  it('a click on an inherited row writes the drawn entry with that one box changed', async () => {
    const server = await renderSet({ '*': { ...CRUD, allowExport: true, readScope: 'own' } });
    fireEvent.click(box('a_project', 'Delete'));
    expect(box('a_project', 'Delete')).not.toBeChecked();
    expect(box('a_project', 'Delete')).toHaveAttribute('data-object-rule', 'entry');
    expect(box('a_project', 'Edit')).toBeChecked();

    const payload = await save(server);
    expect(payload.objects.a_project).toEqual({ ...CRUD, allowExport: true, readScope: 'own', allowDelete: false });
    // The `*` entry and every row nobody touched are written as they were.
    expect(payload.objects['*']).toEqual({ ...CRUD, allowExport: true, readScope: 'own' });
    expect(Object.keys(payload.objects).sort()).toEqual(['*', 'a_project']);
  });

  it('a click on a private row the `*` entry does not reach writes only that box', async () => {
    const server = await renderSet({ '*': CRUD });
    fireEvent.click(box('a_secret', 'Read'));
    const payload = await save(server);
    expect(payload.objects.a_secret).toEqual({ allowRead: true });
  });

  it("a scope picked on an inherited row keeps the rest of the `*` entry", async () => {
    const server = await renderSet({ '*': CRUD });
    fireEvent.keyDown(screen.getByTestId('perm-scope-write-a_project'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    const own = within(listbox).getAllByRole('option').find((o) => o.textContent === 'Own');
    fireEvent.click(own!);
    const payload = await save(server);
    expect(payload.objects.a_project).toEqual({ ...CRUD, writeScope: 'own' });
  });

  it('the R shortcut on an inherited row merges from the `*` entry; None writes an empty entry of its own', async () => {
    const server = await renderSet({ '*': { ...CRUD, allowExport: true } });
    const projectRow = rowOf('a_project');
    fireEvent.click(within(projectRow).getByRole('button', { name: 'R' }));
    const taskRow = rowOf('a_task');
    fireEvent.click(within(taskRow).getByRole('button', { name: 'None' }));
    // On screen: a_task now draws its own empty entry, nothing checked.
    expect(box('a_task', 'Read')).not.toBeChecked();
    expect(box('a_task', 'Read')).toHaveAttribute('data-object-rule', 'entry');

    const payload = await save(server);
    // Export is the `*` entry's, kept as drawn (the shortcut never touches it).
    expect(payload.objects.a_project).toEqual({ allowExport: true, allowRead: true });
    expect(payload.objects.a_task).toEqual({});
  });

  it('a field click under an inherited object writes the field rule from the drawn object grant', async () => {
    const server = await renderSet({ '*': CRUD });
    fireEvent.click(screen.getByRole('button', { name: /a_project/ }));
    fireEvent.click(await screen.findByLabelText('a_project.notes editable'));
    const payload = await save(server);
    // Read stays as the inherited object grant drew it; only Edit changed.
    expect(payload.fields).toEqual({ 'a_project.notes': { readable: true, editable: false } });
    expect(payload.objects).toEqual({ '*': CRUD });
  });

  it("the package door draws the `*` entry too, and its save keeps the stored `*` entry", async () => {
    const server = await renderSet({ '*': CRUD, b_order: { allowRead: true } }, { packageId: 'app.a' });
    expect(box('a_project', 'Edit')).toBeChecked();
    expect(box('a_project', 'Edit')).toHaveAttribute('data-object-rule', 'wildcard');
    fireEvent.click(box('a_project', 'Edit'));
    // The package door autosaves 1.5s after the last edit (objectui#11787).
    await waitFor(() => expect(server.saved.length).toBe(1), { timeout: 4000 });
    const payload = server.saved[0];
    expect(payload.objects.a_project).toEqual({ ...CRUD, allowEdit: false });
    expect(payload.objects['*']).toEqual(CRUD);
    // Another package's row survives the slice merge.
    expect(payload.objects.b_order).toEqual({ allowRead: true });
  });
});
