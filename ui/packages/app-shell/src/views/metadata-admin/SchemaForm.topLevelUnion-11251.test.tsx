// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The generic metadata editor over a served schema whose TOP level is a union
 * (objectui#11251), and the scalar-row guard that fix makes load-bearing
 * (objectui#10239).
 *
 * ## The door
 *
 * Studio → object → Related → Views → a row opens `MetadataDetailDrawer`, which
 * mounts `MetadataResourceEditPage` embedded. With no canvas in the drawer, the
 * page renders the generic `SchemaForm` over the type's served schema. For
 * `view` the server serves its derivation of `ViewMetadataSchema` — an `anyOf`
 * over the stored shapes, with no top-level `properties` — and
 * `METADATA_FORM_REGISTRY.view`. `SchemaFormBody` read only top-level
 * `properties`, so every stored view opened an editor with zero controls.
 *
 * The served entry here is the spec's own conversion, `z.toJSONSchema(
 * ViewMetadataSchema, { unrepresentable: 'any' })`. The server then runs two
 * post-passes (an erased-arm annotation and `stripUnauthorableProperties`);
 * read at objectstack `0f6dcac5e9`, neither touches the top-level union, which
 * is the thing under test.
 *
 * ## What each group pins
 *
 * - **Served view schema, through the real drawer**: each stored shape renders
 *   controls, and the ones of ITS member — a ViewItem's form is not the list
 *   overlay's (resolving a ViewItem there would show its nested columns as
 *   empty, and its member strips those top-level keys on save).
 * - **Control**: a served schema with top-level `properties` renders as before.
 * - **Scalar rows (objectui#10239)**, through `SchemaForm` over `ListViewSchema`
 *   (a top-level-`properties` schema, so these rows do not depend on the union
 *   resolution): a string-array `columns` stays strings; object rows keep their
 *   declared fields; an empty value's first Add still gives an object row.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { ViewMetadataSchema, ListViewSchema } from '@objectstack/spec/ui';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';

let stored: Record<string, unknown> | null = null;
let servedSchema: Record<string, unknown> = {};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: stored, code: null, editable: true, deletable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
  references: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        {
          type: 'view',
          label: 'View',
          domain: 'ui',
          allowEnvironmentOverlay: true,
          allowRuntimeCreate: true,
          schema: servedSchema,
          form: METADATA_FORM_REGISTRY.view,
        },
      ],
    }),
  };
});

import { MetadataDetailDrawer } from './MetadataDetailDrawer';
import { SchemaForm } from './SchemaForm';
import { registerDefaultMetadataSchemas } from './default-schemas';

registerDefaultMetadataSchemas();

const VIEW_JSON = z.toJSONSchema(ViewMetadataSchema as unknown as z.ZodType, {
  unrepresentable: 'any',
}) as Record<string, unknown>;
const LIST_JSON = z.toJSONSchema(ListViewSchema as unknown as z.ZodType, {
  unrepresentable: 'any',
}) as Record<string, unknown>;
const VIEW_FORM = METADATA_FORM_REGISTRY.view as never;

const DATA = { provider: 'object', object: 'crm_lead' };

/** A standalone ViewItem record: the body nested under `config`. */
const VIEW_ITEM = {
  name: 'crm_lead.full',
  object: 'crm_lead',
  viewKind: 'list',
  label: 'Full',
  config: { type: 'grid', data: DATA, columns: ['name', 'status'] },
};
/** The flattened list overlay: the body inline, bound by `object` + `viewKind`. */
const LIST_OVERLAY = {
  name: 'crm_lead.compact',
  object: 'crm_lead',
  viewKind: 'list',
  label: 'Compact',
  type: 'grid',
  data: DATA,
  columns: ['name', 'status'],
};
/** A `defineView` container: the body under a `list` slot. */
const CONTAINER = {
  name: 'crm_lead',
  object: 'crm_lead',
  label: 'Lead views',
  list: { type: 'grid', data: DATA, columns: ['name', 'status'] },
};

beforeEach(() => {
  stored = null;
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
});

const SCOPE = 'mdf-drawer-metadata.';
const byId = (id: string) => document.getElementById(id);

/** Every form control the drawer's form rendered, by its scoped host id. */
function drawerControls(): Element[] {
  return Array.from(document.querySelectorAll(`[id^="${SCOPE}"]`)).filter((el) =>
    ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(el.tagName),
  );
}

/** Open a stored view the way Studio's Related tab does, and click Edit. */
async function openInDrawer(body: Record<string, unknown>, schema: Record<string, unknown>) {
  stored = body;
  servedSchema = schema;
  render(
    <MemoryRouter>
      <MetadataDetailDrawer
        target={{ kind: 'metadata', type: 'view', name: String(body.name) }}
        onClose={() => {}}
      />
    </MemoryRouter>,
  );
  const edits = await screen.findAllByRole('button', { name: /^Edit$/ });
  fireEvent.click(edits[0]!);
  await waitFor(() => expect(byId(`${SCOPE}name`)).not.toBeNull());
}

const inputValue = (id: string) => (byId(id) as HTMLInputElement | null)?.value;

describe('the generic editor resolves a served top-level union against the stored view (objectui#11251)', () => {
  it('the three fixtures are stored `view` bodies the contract admits', () => {
    for (const body of [VIEW_ITEM, LIST_OVERLAY, CONTAINER]) {
      expect(ViewMetadataSchema.safeParse(body).success).toBe(true);
    }
    // The served schema is the union the card describes: no top-level properties.
    expect(VIEW_JSON.properties).toBeUndefined();
    expect(Array.isArray(VIEW_JSON.anyOf)).toBe(true);
  });

  it('a ViewItem renders the controls of the ViewItem member, not the list overlay\'s', async () => {
    await openInDrawer(VIEW_ITEM, VIEW_JSON);
    expect(drawerControls().length).toBeGreaterThan(0);
    expect(inputValue(`${SCOPE}name`)).toBe('crm_lead.full');
    expect(inputValue(`${SCOPE}label`)).toBe('Full');
    // `type`, `columns` and `searchableFields` live under this body's `config`;
    // the ViewItem member declares none of them at the top level.
    expect(byId(`${SCOPE}type`)).toBeNull();
    expect(byId(`${SCOPE}columns-label`)).toBeNull();
    expect(byId(`${SCOPE}searchableFields`)).toBeNull();
  });

  it('a flattened list overlay renders the list overlay\'s controls, not the form overlay\'s', async () => {
    await openInDrawer(LIST_OVERLAY, VIEW_JSON);
    expect(drawerControls().length).toBeGreaterThan(0);
    expect(inputValue(`${SCOPE}name`)).toBe('crm_lead.compact');
    expect(inputValue(`${SCOPE}label`)).toBe('Compact');
    // Declared by the list overlay and absent from the form overlay.
    expect(byId(`${SCOPE}searchableFields`)).not.toBeNull();
    expect(byId(`${SCOPE}type`)).not.toBeNull();
    expect(
      document.querySelector(`[role="group"][aria-labelledby="${SCOPE}columns-label"]`),
    ).not.toBeNull();
  });

  it('a defineView container renders controls, and not the list overlay\'s', async () => {
    await openInDrawer(CONTAINER, VIEW_JSON);
    expect(drawerControls().length).toBeGreaterThan(0);
    expect(inputValue(`${SCOPE}name`)).toBe('crm_lead');
    expect(inputValue(`${SCOPE}label`)).toBe('Lead views');
    // The container carries no `viewKind`, which the list overlay requires; the
    // list config it holds sits under its `list` slot, not at the top level.
    expect(byId(`${SCOPE}type`)).toBeNull();
    expect(byId(`${SCOPE}columns-label`)).toBeNull();
    expect(byId(`${SCOPE}searchableFields`)).toBeNull();
  });
});

describe('control: a served schema with top-level properties renders as before (objectui#11251)', () => {
  it('ListViewSchema served: the list form with two object column rows', async () => {
    await openInDrawer(
      {
        name: 'crm_lead.compact',
        label: 'Compact',
        type: 'grid',
        data: DATA,
        columns: [{ field: 'name' }, { field: 'status' }],
      },
      LIST_JSON,
    );
    expect(inputValue(`${SCOPE}name`)).toBe('crm_lead.compact');
    expect(inputValue(`${SCOPE}label`)).toBe('Compact');
    for (const field of ['type', 'filter', 'searchableFields']) {
      expect(byId(`${SCOPE}${field}`), field).not.toBeNull();
    }
    // `@objectstack/spec` 18.0.0 retired `filterableFields` (objectstack#24640)
    // and the served `viewForm` stopped offering it (objectui#13261).
    expect(byId(`${SCOPE}filterableFields`)).toBeNull();
    expect(screen.getByRole('button', { name: /^#1 — name$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^#2 — status$/ })).toBeInTheDocument();
  });
});

/** `SchemaForm` over `ListViewSchema` with the served `viewForm`, value tracked. */
function renderListForm(initial: Record<string, unknown>) {
  let latest = initial;
  function Harness() {
    const [value, setValue] = React.useState<Record<string, unknown>>(initial);
    return (
      <SchemaForm
        schema={LIST_JSON}
        form={VIEW_FORM}
        value={value}
        onChange={(next) => {
          latest = next;
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { latest: () => latest };
}

const columnsGroup = () =>
  document.querySelector('[role="group"][aria-labelledby="mdf-columns-label"]') as HTMLElement;

describe('a repeater whose items resolve to a scalar arm draws scalar rows (objectui#10239)', () => {
  it('a string-array `columns` stays strings the installed schema accepts', () => {
    const initial = { name: 'compact', label: 'Compact', type: 'grid', columns: ['name', 'status'] };
    expect(ListViewSchema.safeParse(initial).success).toBe(true);
    const { latest } = renderListForm(initial);

    const row0 = byId('mdf-columns.0') as HTMLInputElement | null;
    expect(row0?.tagName).toBe('INPUT');
    expect(row0!.value).toBe('name');
    // Named by the host label plus its own ordinal, both of which resolve.
    const refs = row0!.getAttribute('aria-labelledby')!.split(' ');
    expect(refs).toEqual(['mdf-columns-label', 'mdf-columns.0-ordinal']);
    for (const ref of refs) expect(byId(ref), ref).not.toBeNull();

    fireEvent.change(row0!, { target: { value: 'title' } });
    expect(latest().columns).toEqual(['title', 'status']);
    expect(ListViewSchema.safeParse(latest()).success).toBe(true);

    fireEvent.click(within(columnsGroup()).getByRole('button', { name: /add item/i }));
    expect(latest().columns).toEqual(['title', 'status', '']);

    // No row summary reads a String.prototype method off a scalar row.
    expect(document.body.textContent).not.toMatch(/native code/);
  });

  it('object rows keep their declared fields', () => {
    const initial = {
      name: 'compact',
      label: 'Compact',
      type: 'grid',
      columns: [{ field: 'name' }, { field: 'status', width: 120 }],
    };
    const { latest } = renderListForm(initial);

    expect(byId('mdf-columns.0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^#2 — status$/ }));
    expect(inputValue('mdf-columns.1.field')).toBe('status');
    expect(inputValue('mdf-columns.1.width')).toBe('120');
    const label = byId('mdf-columns.1.label') as HTMLInputElement;
    fireEvent.change(label, { target: { value: 'Status' } });

    expect(latest().columns).toEqual([
      { field: 'name' },
      { field: 'status', width: 120, label: 'Status' },
    ]);
    expect(ListViewSchema.safeParse(latest()).success).toBe(true);
  });

  it("the empty value's first Add gives an object row", () => {
    const { latest } = renderListForm({ name: 'compact', label: 'Compact', type: 'grid' });

    fireEvent.click(within(columnsGroup()).getByRole('button', { name: /add item/i }));
    const columns = latest().columns as unknown[];
    expect(columns).toHaveLength(1);
    expect(columns[0] !== null && typeof columns[0] === 'object' && !Array.isArray(columns[0])).toBe(true);
    // The added row opens on the object arm's declared sub-fields.
    expect(byId('mdf-columns.0.field')).not.toBeNull();
    expect(byId('mdf-columns.0')).toBeNull();
  });
});
