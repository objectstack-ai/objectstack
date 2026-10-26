// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26187 — the permission matrix authors and shows the record scope
 * (`readScope` / `writeScope`, ADR-0057 D1) that ADR-0084 declares for it.
 *
 * What is pinned, in both renderers (Setup's `PermissionTable` and Studio
 * Access's `StudioObjectRow`):
 *
 *   - every object row carries a Read scope and a Write scope picker, listing
 *     "Not set" and the five `ObjectAccessScopeSchema` values in the spec's
 *     order, and showing what the stored row holds;
 *   - the three hierarchy values carry the "requires enterprise; otherwise
 *     owner-only" hint and stay selectable; `own` and `org` carry none;
 *   - the #16870 pairs the BASE schema refuses grey the pickers: View All
 *     disables the read picker, Modify All disables both;
 *   - ticking View All drops `readScope` and ticking Modify All drops both, so
 *     the per-checkbox cascade never saves a refused pair — read through the
 *     spec's real `ObjectPermissionSchema`, not a restatement of its rule;
 *   - a picked value saves and reloads unchanged at the environment door AND at
 *     the package door (`mergePermissionSlice`), and "Not set" deletes the key.
 *
 * The bulk "All" arm's half of the clearing rule is pinned beside the other
 * bulk arms, in `PermissionMatrixEditor.bulkMergeKeys.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ObjectAccessScopeSchema, ObjectPermissionSchema } from '@objectstack/spec/security';
import * as slice from './permission-slice';

interface FakeServer {
  set: Record<string, any>;
  objectNames: string[];
  saved: Record<string, any> | null;
  savedOpts: Record<string, any> | undefined;
}

function makeClient(server: FakeServer) {
  return {
    layered: async () => ({ effective: server.set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? server.objectNames.map((name) => ({ item: { name } })) : [],
    get: async (type: string) => (type === 'object' ? { fields: [] } : null),
    save: async (_t: string, _n: string, payload: Record<string, any>, opts?: Record<string, any>) => {
      server.saved = payload;
      server.savedOpts = opts;
      server.set = payload; // the reopen reads what was saved
      return payload;
    },
  } as any;
}

let clientImpl: any;

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

type Site = 'page' | 'studio';

function newServer(objects: Record<string, unknown>, objectNames?: string[]): FakeServer {
  return {
    set: { name: 'sales_perms', label: 'Sales', objects, fields: {} },
    objectNames: objectNames ?? Object.keys(objects),
    saved: null,
    savedOpts: undefined,
  };
}

async function mount(server: FakeServer, site: Site, packageId?: string) {
  clientImpl = makeClient(server);
  const utils = render(
    <MemoryRouter>
      {site === 'studio' ? (
        <PermissionMatrixEditPage
          type="permission"
          name="sales_perms"
          packageId={packageId}
          embedded
          studio={{ tab: 'objects', onTabChange: () => {} }}
        />
      ) : (
        <PermissionMatrixEditPage type="permission" name="sales_perms" packageId={packageId} />
      )}
    </MemoryRouter>,
  );
  await screen.findByText(server.objectNames[0]);
  return utils;
}

const readPicker = (object: string) => screen.getByTestId(`perm-scope-read-${object}`);
const writePicker = (object: string) => screen.getByTestId(`perm-scope-write-${object}`);

const HINT = 'requires enterprise; otherwise owner-only';
/** The picker's options as listed, in order, each read as `label` (hint stripped) and whether it carries the hint. */
async function openPicker(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(trigger: HTMLElement, label: string) {
  const options = await openPicker(trigger);
  const option = options.find((o) => (o.textContent ?? '').startsWith(label));
  if (!option) throw new Error(`no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

/** The checkbox for one matrix column inside one object's row (`aria-label` is `<object> <tip>`). */
function columnBox(object: string, tip: RegExp) {
  return screen
    .getAllByRole('checkbox')
    .find((el) => el.getAttribute('aria-label')?.startsWith(`${object} `) && tip.test(el.getAttribute('aria-label') ?? ''))!;
}

async function saveEnv(server: FakeServer) {
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  await waitFor(() => expect(server.saved).not.toBeNull());
  return server.saved!;
}

async function autosaved(server: FakeServer) {
  await waitFor(() => expect(server.saved).not.toBeNull(), { timeout: 4000 });
  return server.saved!;
}

/** The spec's own verdict on a saved row — the server-side #16870 refusal, not a restatement of it. */
function baseSchemaAccepts(row: unknown) {
  const r = ObjectPermissionSchema.safeParse(row);
  return r.success ? 'accepted' : r.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`).join('; ');
}

describe('the scope vocabulary is the spec’s (objectstack#26187)', () => {
  it('OBJECT_ACCESS_SCOPES lists ObjectAccessScopeSchema’s values in the spec’s order', () => {
    expect((slice as Record<string, unknown>).OBJECT_ACCESS_SCOPES).toEqual(ObjectAccessScopeSchema.options);
  });

  it('the hierarchy subset is exactly the three values that need the enterprise resolver', () => {
    expect([...((slice as Record<string, unknown>).HIERARCHY_SCOPES as string[])].sort()).toEqual(
      ['own_and_reports', 'unit', 'unit_and_below'],
    );
  });
});

describe.each<Site>(['page', 'studio'])('record scope pickers (%s renderer)', (site) => {
  it('every object row has a Read scope and a Write scope picker showing the stored row', async () => {
    await mount(newServer({ a_account: { allowRead: true, readScope: 'unit', writeScope: 'own' }, a_contact: { allowRead: true } }), site);

    expect(readPicker('a_account').textContent).toBe('My unit');
    expect(writePicker('a_account').textContent).toBe('Own');
    expect(readPicker('a_contact').textContent).toBe('Not set');
    expect(writePicker('a_contact').textContent).toBe('Not set');
  });

  it('lists "Not set" and the five spec values in order; only the three hierarchy values carry the hint', async () => {
    await mount(newServer({ a_account: { allowRead: true } }), site);

    const options = await openPicker(readPicker('a_account'));
    const listed = options.map((o) => ({ text: o.textContent ?? '', hint: (o.textContent ?? '').includes(HINT) }));
    expect(listed.map((o) => o.text.replace(HINT, '').replace(/[\s·]+$/, ''))).toEqual([
      'Not set',
      'Own',
      'Own and reports',
      'My unit',
      'My unit and below',
      'Whole org',
    ]);
    expect(listed.map((o) => o.hint)).toEqual([false, false, true, true, true, false]);
    // Selectable: none of them is disabled, licensed or not.
    for (const o of options) expect(o).not.toHaveAttribute('data-disabled');
  });

  it('View All greys the read picker only; Modify All greys both — with the reason as a title', async () => {
    await mount(
      newServer({
        a_account: { allowRead: true, viewAllRecords: true, writeScope: 'own' },
        a_contact: { allowRead: true, allowEdit: true, modifyAllRecords: true },
        a_lead: { allowRead: true },
      }),
      site,
    );

    expect(readPicker('a_account')).toBeDisabled();
    expect(readPicker('a_account').getAttribute('title')).toMatch(/View All/);
    expect(writePicker('a_account')).toBeEnabled();
    expect(readPicker('a_contact')).toBeDisabled();
    expect(writePicker('a_contact')).toBeDisabled();
    expect(writePicker('a_contact').getAttribute('title')).toMatch(/Modify All/);
    // Control: a row with neither bit leaves both pickers open.
    expect(readPicker('a_lead')).toBeEnabled();
    expect(writePicker('a_lead')).toBeEnabled();
  });

  it('a hierarchy value is selectable and saves (package door), the other package’s row untouched', async () => {
    const server = newServer(
      { a_account: { allowRead: true }, b_order: { allowRead: true, readScope: 'unit' } },
      ['a_account'],
    );
    await mount(server, site, 'app.a');

    await pick(readPicker('a_account'), 'Own and reports');
    const payload = await autosaved(server);
    expect(payload.objects.a_account).toEqual({ allowRead: true, readScope: 'own_and_reports' });
    expect(payload.objects.b_order).toEqual({ allowRead: true, readScope: 'unit' });
    expect(server.savedOpts).toMatchObject({ mode: 'draft', packageId: 'app.a' });
  });
});

describe('the clearing rule on the per-checkbox cascade (#16870 pairs)', () => {
  it('ticking View All drops readScope and keeps writeScope; the saved row is one the BASE schema accepts', async () => {
    const server = newServer({ a_account: { allowRead: true, readScope: 'unit', writeScope: 'own' } });
    await mount(server, 'page');

    fireEvent.click(columnBox('a_account', /View All/));
    const row = (await saveEnv(server)).objects.a_account;
    expect(row).toEqual({ allowRead: true, viewAllRecords: true, writeScope: 'own' });
    expect(baseSchemaAccepts(row)).toBe('accepted');
  });

  it('ticking Modify All drops both scopes; the saved row is one the BASE schema accepts', async () => {
    const server = newServer({ a_account: { allowRead: true, readScope: 'unit', writeScope: 'own' } });
    await mount(server, 'page');

    fireEvent.click(columnBox('a_account', /Modify All/));
    const row = (await saveEnv(server)).objects.a_account;
    expect(row).toEqual({ allowRead: true, allowEdit: true, modifyAllRecords: true });
    expect(baseSchemaAccepts(row)).toBe('accepted');
  });

  it('control: the same row with its scopes kept beside Modify All is what the BASE schema refuses', () => {
    expect(
      baseSchemaAccepts({ allowRead: true, allowEdit: true, modifyAllRecords: true, readScope: 'unit', writeScope: 'own' }),
    ).not.toBe('accepted');
  });

  it('a tick on any other column leaves both scopes alone', async () => {
    const server = newServer({ a_account: { allowRead: true, readScope: 'unit', writeScope: 'own' } });
    await mount(server, 'page');

    fireEvent.click(columnBox('a_account', /Create/));
    const row = (await saveEnv(server)).objects.a_account;
    expect(row).toEqual({ allowRead: true, allowCreate: true, readScope: 'unit', writeScope: 'own' });
  });
});

describe('save round-trip', () => {
  it('environment door: picked values save, and a reopen shows them unchanged', async () => {
    const server = newServer({ a_account: { allowRead: true, allowEdit: true, allowExport: true } });
    const { unmount } = await mount(server, 'page');

    await pick(readPicker('a_account'), 'My unit and below');
    await pick(writePicker('a_account'), 'Own');
    const row = (await saveEnv(server)).objects.a_account;
    expect(row).toEqual({ allowRead: true, allowEdit: true, allowExport: true, readScope: 'unit_and_below', writeScope: 'own' });
    expect(server.savedOpts?.mode).not.toBe('draft');

    unmount();
    server.saved = null;
    await mount(server, 'page');
    expect(readPicker('a_account').textContent).toBe('My unit and below');
    expect(writePicker('a_account').textContent).toBe('Own');
  });

  it('environment door: "Not set" deletes the key rather than saving a blank', async () => {
    const server = newServer({ a_account: { allowRead: true, readScope: 'org', writeScope: 'own' } });
    await mount(server, 'page');

    await pick(readPicker('a_account'), 'Not set');
    const row = (await saveEnv(server)).objects.a_account;
    expect(row).toEqual({ allowRead: true, writeScope: 'own' });
    expect('readScope' in row).toBe(false);
  });

  it('package door: a picked value survives mergePermissionSlice and reloads unchanged', async () => {
    const server = newServer(
      {
        a_account: { allowRead: true, allowEdit: true },
        b_order: { allowRead: true, viewAllRecords: true, writeScope: 'unit' },
      },
      ['a_account'],
    );
    const { unmount } = await mount(server, 'page', 'app.a');

    await pick(writePicker('a_account'), 'Whole org');
    const payload = await autosaved(server);
    expect(payload.objects.a_account).toEqual({ allowRead: true, allowEdit: true, writeScope: 'org' });
    expect(payload.objects.b_order).toEqual({ allowRead: true, viewAllRecords: true, writeScope: 'unit' });

    unmount();
    server.saved = null;
    await mount(server, 'page', 'app.a');
    expect(writePicker('a_account').textContent).toBe('Whole org');
    expect(readPicker('a_account').textContent).toBe('Not set');
  });
});
