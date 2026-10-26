// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's Data pillar keeps the columns the platform injects AND hides out of
 * the author's views — objectui#11780.
 *
 * The defect: the records grid, the Form preview and the form designer dropped
 * framework fields by one fixed name list (`STUDIO_SYSTEM_FIELD_NAMES`). The
 * platform's search companion `__search` and `owning_business_unit_id` are not
 * on it, so every author saw "Search Index" and "Owning Business Unit" in all
 * three, while the runtime list hides both. The platform marks both
 * `system: true` + `hidden: true` on the served definition; that pair is the
 * test now (`isStudioHiddenSystemField`).
 *
 * The fixture's injected definitions copy the platform's own literals, not a
 * paraphrase: `provisionSearchCompanion` (objectstack objectql's
 * search-companion) for `__search`, `OWNING_BUSINESS_UNIT_FIELD_DEF` and
 * `TENANT_SCOPE_FIELD_DEF` (objectstack spec's injected-column provenance), and
 * the `created_at` row of `AUDIT_FIELD_DEFS`. `fields` is the record shape the
 * `/meta` read serves.
 *
 * Three controls ride every case, because each one is a way to get the
 * predicate wrong while the headline assertion stays green:
 *
 * - `internal_note` — an AUTHOR field with `hidden: true` and no `system`. It
 *   stays: its grid column and designer card are how the author reaches the
 *   inspector to un-hide it. A `hidden`-only filter would strand it.
 * - `owner_id` — `system: true` without `hidden` (reassignable ownership). It
 *   stays. A `system`-only filter would take a field authors design around.
 * - `created_at` — an audit column, `system` without `hidden`. It stays OUT, as
 *   it was, by the name list the marks do not replace.
 *
 * Every case runs twice: once on an object with no pending draft (the pillar
 * edits `layered().effective`) and once on one with a served draft (the pillar
 * edits the draft body as served, objectui#10765).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/** `provisionSearchCompanion`'s literal (description shortened; not read). */
const SEARCH_COMPANION_DEF = {
  type: 'text',
  label: 'Search Index',
  required: false,
  hidden: true,
  readonly: true,
  system: true,
  searchable: false,
  description: 'Search-normalized forms of the display/name field.',
};

/** `OWNING_BUSINESS_UNIT_FIELD_DEF`. */
const OWNING_BUSINESS_UNIT_DEF = {
  type: 'lookup',
  reference: 'sys_business_unit',
  label: 'Owning Business Unit',
  required: false,
  hidden: true,
  readonly: true,
  system: true,
  description: 'Record-level business-unit ownership (ADR-0117 D1).',
};

/** `TENANT_SCOPE_FIELD_DEF`. */
const TENANT_SCOPE_DEF = {
  type: 'lookup',
  reference: 'sys_organization',
  label: 'Organization',
  required: false,
  hidden: true,
  readonly: true,
  system: true,
  description: 'Tenant scope.',
};

const HIDDEN_SYSTEM = ['__search', 'owning_business_unit_id', 'organization_id'] as const;
const HIDDEN_SYSTEM_LABELS = ['Search Index', 'Owning Business Unit', 'Organization'] as const;
const HIDDEN_SYSTEM_DEFS: Record<(typeof HIDDEN_SYSTEM)[number], Record<string, unknown>> = {
  __search: SEARCH_COMPANION_DEF,
  owning_business_unit_id: OWNING_BUSINESS_UNIT_DEF,
  organization_id: TENANT_SCOPE_DEF,
};

const servedObject = {
  name: 'showcase_account',
  label: 'Account',
  fields: {
    name: { type: 'text', label: 'Account Name' },
    industry: { type: 'text', label: 'Industry' },
    // Control: author-hidden, not system — stays visible to the author.
    internal_note: { type: 'text', label: 'Internal Note', hidden: true },
    // Control: system, not hidden — stays visible to the author.
    owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner', required: false, readonly: false, system: true },
    // Control: audit — stays out by the name list, as before.
    created_at: { type: 'datetime', label: 'Created At', required: false, readonly: true, system: true },
    organization_id: TENANT_SCOPE_DEF,
    owning_business_unit_id: OWNING_BUSINESS_UNIT_DEF,
    __search: SEARCH_COMPANION_DEF,
  },
};

const AUTHOR_VISIBLE = ['name', 'industry', 'internal_note', 'owner_id'] as const;
const AUTHOR_VISIBLE_LABELS = ['Account Name', 'Industry', 'Internal Note', 'Owner'] as const;

/** `null` = no pending draft; otherwise the `getDraft` envelope. */
let servedDraft: unknown = null;

const mockClient = {
  list: vi.fn(async () => [{ name: 'showcase_account', label: 'Account' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: servedObject, code: servedObject })),
  getDraft: vi.fn(async () => servedDraft),
  save: vi.fn<(type: string, name: string, body: Record<string, unknown>, opts?: unknown) => Promise<unknown>>(
    async () => ({ ok: true }),
  ),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

/** Every columns array the pillar hands the records grid, in render order. */
const seenColumns: string[][] = [];
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    ObjectView: ({ schema }: { schema?: { table?: { fields?: string[] } } }) => {
      const cols = schema?.table?.fields ?? [];
      seenColumns.push(cols);
      return <div data-testid="grid-columns">{cols.join(',')}</div>;
    },
  };
});

/** Every `fields` array the pillar hands the Form preview, in render order. */
const seenFormFields: string[][] = [];
vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/plugin-form')>();
  return {
    ...actual,
    ObjectForm: ({ schema }: { schema?: { fields?: string[] } }) => {
      const fields = schema?.fields ?? [];
      seenFormFields.push(fields);
      return <div data-testid="form-fields">{fields.join(',')}</div>;
    },
  };
});

/** An unrelated draft edit: the object's label, through the real `onPatch`. */
vi.mock('./ObjectSettingsPanel', () => ({
  ObjectSettingsPanel: ({ onPatch }: { onPatch: (patch: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onPatch({ label: 'Account (renamed)' })}>
      rename-object
    </button>
  ),
}));

/**
 * The designer's drag-end handler. The REAL `DndContext` still renders; this
 * only records the handler so a drop can be driven without pointer geometry
 * (the `UnifiedSidebar.groupedNavOrder-11626` instrument).
 */
type DragEnd = (event: { active: { id: string }; over: { id: string } | null }) => void;
const dnd: { onDragEnd: DragEnd | null } = { onDragEnd: null };
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  const ReactMod = await import('react');
  const CapturingDndContext = (props: Record<string, unknown>) => {
    dnd.onDragEnd = props.onDragEnd as DragEnd;
    return ReactMod.createElement(actual.DndContext, props as never);
  };
  return { ...actual, DndContext: CapturingDndContext };
});

import { DataPillar } from './StudioDesignSurface';
import { SurfaceDeepLinkProvider } from './surfaceDeepLinkChannel';
import { isStudioHiddenSystemField } from './studioHiddenSystemField';

beforeEach(() => {
  seenColumns.length = 0;
  seenFormFields.length = 0;
  dnd.onDragEnd = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  servedDraft = null;
});

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <SurfaceDeepLinkProvider>
        <DataPillar packageId="com.example.showcase" />
      </SurfaceDeepLinkProvider>
    </MemoryRouter>,
  );
}

const listed = (testId: string) => (screen.getByTestId(testId).textContent ?? '').split(',');

const CASES = [
  { title: 'no pending draft (edits the served object)', draft: null },
  {
    title: 'a served draft (edits the draft body as served)',
    draft: {
      type: 'object',
      name: 'showcase_account',
      item: { ...servedObject, description: 'pending draft' },
    },
  },
] as const;

describe.each(CASES)('Data pillar on an object with $title (objectui#11780)', ({ draft }) => {
  beforeEach(() => {
    servedDraft = draft;
  });

  it('records grid: the injected-and-hidden columns are not columns; the author fields are', async () => {
    renderPillar();
    await waitFor(() => expect(listed('grid-columns')).toContain('name'), { timeout: 4000 });

    const cols = listed('grid-columns');
    for (const name of HIDDEN_SYSTEM) expect(cols).not.toContain(name);
    for (const name of AUTHOR_VISIBLE) expect(cols).toContain(name);
    expect(cols).not.toContain('created_at');
    // Not through any render along the way either.
    expect(seenColumns.some((c) => c.some((n) => (HIDDEN_SYSTEM as readonly string[]).includes(n)))).toBe(false);
  });

  it('Form preview: the injected-and-hidden fields are not form fields; the author fields are', async () => {
    renderPillar();
    await waitFor(() => expect(screen.getByTestId('grid-columns')).toBeInTheDocument(), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByTestId('form-fields')).toBeInTheDocument(), { timeout: 4000 });

    const fields = listed('form-fields');
    for (const name of HIDDEN_SYSTEM) expect(fields).not.toContain(name);
    for (const name of AUTHOR_VISIBLE) expect(fields).toContain(name);
    expect(fields).not.toContain('created_at');
  });

  it('form designer: no card for the injected-and-hidden fields; the author fields have one', async () => {
    renderPillar();
    await waitFor(() => expect(screen.getByTestId('grid-columns')).toBeInTheDocument(), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    await waitFor(() => expect(screen.getByText('Account Name')).toBeInTheDocument(), { timeout: 4000 });

    for (const label of AUTHOR_VISIBLE_LABELS) expect(screen.getByText(label)).toBeInTheDocument();
    for (const label of HIDDEN_SYSTEM_LABELS) expect(screen.queryByText(label)).not.toBeInTheDocument();
    expect(screen.queryByText('Created At')).not.toBeInTheDocument();
  });

  it('write-back: a designer drop saves `fields` that still carry every hidden system field, definition unchanged', async () => {
    renderPillar();
    await waitFor(() => expect(screen.getByTestId('grid-columns')).toBeInTheDocument(), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    await waitFor(() => expect(screen.getByText('Account Name')).toBeInTheDocument(), { timeout: 4000 });
    expect(dnd.onDragEnd).not.toBeNull();

    // Drop `industry` onto `name`: a reorder inside the ungrouped section.
    act(() => dnd.onDragEnd!({ active: { id: 'f:industry' }, over: { id: 'f:name' } }));

    // The auto-save sends the draft the designer committed.
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 5000 });
    const body = mockClient.save.mock.calls.at(-1)![2] as { fields: Record<string, Record<string, unknown>> };

    // The edit really committed — `industry` now leads `name` …
    const order = Object.keys(body.fields).filter((k) => k === 'name' || k === 'industry');
    expect(order).toEqual(['industry', 'name']);
    // … and nothing the canvas hid was dropped or rewritten.
    for (const name of HIDDEN_SYSTEM) expect(body.fields[name]).toEqual(HIDDEN_SYSTEM_DEFS[name]);
    expect(body.fields.created_at).toEqual(servedObject.fields.created_at);
    expect(Object.keys(body.fields).sort()).toEqual(Object.keys(servedObject.fields).sort());
  });

  it('identity: an unrelated draft edit (the object label) leaves the grid columns array at the SAME identity', async () => {
    renderPillar();
    await waitFor(() => expect(listed('grid-columns')).toContain('name'), { timeout: 4000 });
    const before = seenColumns[seenColumns.length - 1];

    await userEvent.click(await screen.findByTestId('data-tabs-advanced'));
    // A radio item since objectui#11794: the menu checks the open panel.
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'rename-object' }));
    fireEvent.click(screen.getByRole('button', { name: 'Records' }));
    await waitFor(() => expect(screen.getByTestId('grid-columns')).toBeInTheDocument(), { timeout: 4000 });

    expect(seenColumns[seenColumns.length - 1]).toBe(before);
    // The edit was real: the draft the pillar saves carries the new label.
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 5000 });
    expect(mockClient.save.mock.calls.at(-1)![2].label).toBe('Account (renamed)');
  });
});

describe('isStudioHiddenSystemField — both marks, as booleans (objectui#11780)', () => {
  it('is true only for `system: true` together with `hidden: true`', () => {
    expect(isStudioHiddenSystemField(SEARCH_COMPANION_DEF)).toBe(true);
    expect(isStudioHiddenSystemField(OWNING_BUSINESS_UNIT_DEF)).toBe(true);
    expect(isStudioHiddenSystemField({ system: true })).toBe(false);
    expect(isStudioHiddenSystemField({ hidden: true })).toBe(false);
    expect(isStudioHiddenSystemField({ system: true, hidden: false })).toBe(false);
    expect(isStudioHiddenSystemField({ system: 'true', hidden: true })).toBe(false);
    expect(isStudioHiddenSystemField(undefined)).toBe(false);
  });
});
