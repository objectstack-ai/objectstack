// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36169 — Studio's view and page-block filter editor
 * (`FilterBuilderField`, the `filter-builder` widget) hands the shared
 * `FilterBuilder` each column's declared `multiple`, so a `select` / `lookup` /
 * `user` declared `multiple: true` is offered what the data door answers on a
 * list: `jsonColumnFilterOperators`' set (Contains, Does not contain, Is empty,
 * Is not empty), read here from `operatorsForField`, never restated. Equality
 * and `in` on a list are refused by the data door with 400 `INVALID_FILTER`.
 *
 * Pinned:
 *  - the widget: a `multiple: true` user / lookup / select column's REAL
 *    operator dropdown lists exactly the shared builder's answer; CONTROLS, the
 *    single-value user / select columns keep `Equals`;
 *  - read-back: a stored `equals` rule on such a column opens as its row and
 *    writes nothing (this editor has no Source fallback; the builder mounts the
 *    row's own operator beside the offered set so the author can change it);
 *  - every host that builds the widget's field list carries `multiple`: the
 *    generic editor's object catalog (`objectCatalogOf`), the runtime view
 *    panel's catalog (`mapObjectFields`), the view-variant inspector, and the
 *    page block's related-list filter.
 *
 * Direction: without `multiple` reaching the builder the multi-value columns
 * keep their type's bucket (`Equals`, `Is any of`, …) and those cases are red;
 * the single-value controls are green either way.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonColumnFilterOperators, operatorsForField } from '@object-ui/components';

// The builder lives inside a Radix popover, which does not open in jsdom; the
// popover parts render inline (this directory's existing way of reaching it).
vi.mock('@object-ui/components', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/components');
  const Pass = ({ children }: { children?: unknown }) => children as never;
  return { ...actual, Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});

/** The served `deal` object: three list-valued columns and three single-value controls. */
const DEAL_FIELDS = {
  name: { name: 'name', label: 'Name', type: 'text' },
  owners: { name: 'owners', label: 'Owners', type: 'user', multiple: true },
  accounts: { name: 'accounts', label: 'Accounts', type: 'lookup', reference: 'account', multiple: true },
  regions: {
    name: 'regions', label: 'Regions', type: 'select', multiple: true,
    options: [{ value: 'emea', label: 'EMEA' }, { value: 'apac', label: 'APAC' }],
  },
  owner: { name: 'owner', label: 'Owner', type: 'user' },
  region: {
    name: 'region', label: 'Region', type: 'select',
    options: [{ value: 'emea', label: 'EMEA' }, { value: 'apac', label: 'APAC' }],
  },
} as const;
const DEAL = { name: 'deal', label: 'Deal', fields: DEAL_FIELDS };

const clients = vi.hoisted(() => {
  const fake = {
    get: async (type: string, name: string) => (type === 'object' && name === 'deal' ? DEAL_DOC() : undefined),
    list: async () => [] as unknown[],
    withPreviewDrafts() {
      return this;
    },
  };
  return { fake, current: fake as unknown };
});
// `vi.hoisted` runs before the module body, so the served document is read lazily.
function DEAL_DOC() {
  return DEAL;
}
vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return { ...mod, useMetadataClient: () => clients.current };
});

import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { WIDGETS } from './widgets';
import { loaded } from './loadState';
import { objectCatalogOf } from './ResourceEditPage';
import { mapObjectFields } from '../ViewConfigPanel';
import { ViewVariantInspector } from './inspectors/ViewVariantInspector';
import { PageBlockInspector } from './inspectors/PageBlockInspector';
import { ObjectListViewInspector, useObjectListViewDraft } from '../studio-design/ObjectListViewInspector';
import type { Surface } from '../studio-design/navSurface';

afterEach(() => {
  cleanup();
  clients.current = clients.fake;
});

const MULTI = ['owners', 'accounts', 'regions'] as const;
const FOUR = ['Contains', 'Does not contain', 'Is empty', 'Is not empty'];

/** The operator labels the shared builder draws for these facts — its own answer. */
const labelsFor = (type: string, multiple: boolean) => operatorsForField({ type, multiple }).map((o) => o.label);

/** Open a REAL Radix dropdown by its trigger's index and read its option labels. */
async function optionsOf(scope: HTMLElement, index: number): Promise<string[]> {
  const triggers = within(scope).getAllByRole('combobox');
  fireEvent.keyDown(triggers[index], { key: 'ArrowDown' });
  const options = await waitFor(() => {
    const found = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(found.length).toBeGreaterThan(0);
    return found;
  });
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  return options;
}

async function pickFrom(scope: HTMLElement, index: number, label: string) {
  const triggers = within(scope).getAllByRole('combobox');
  fireEvent.keyDown(triggers[index], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" in the dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

/** Add a row in the builder inside `scope`, point it at `label`, and read its operator dropdown. */
async function offeredFor(scope: HTMLElement, label: string): Promise<string[]> {
  fireEvent.click(within(scope).getByRole('button', { name: 'Add filter' }));
  await pickFrom(scope, 0, label);
  return optionsOf(scope, 1);
}

type Rule = { field: string; operator: string; value?: unknown };

const FilterWidget = WIDGETS['filter-builder'];

function WidgetHost({ fields, initial, writes }: {
  fields: ReturnType<typeof objectCatalogOf>['fields'];
  initial?: Rule[];
  writes: Array<Rule[] | undefined>;
}) {
  const [value, setValue] = React.useState<Rule[] | undefined>(initial);
  return (
    <div data-testid="host">
      <FilterWidget
        schema={{}}
        value={value}
        context={{ conditionScope: 'none', objectFields: loaded(fields) }}
        onChange={(rules) => {
          writes.push(rules as Rule[] | undefined);
          setValue(rules as Rule[] | undefined);
        }}
      />
    </div>
  );
}

/** The catalog the generic editor builds from the served object document. */
const servedCatalog = () => objectCatalogOf(DEAL).fields;

describe('the filter-builder widget offers a multiple: true column membership only (objectstack#36169)', () => {
  it('the shared builder answers the JSON-column set for each list-valued column', () => {
    for (const name of MULTI) {
      const type = DEAL_FIELDS[name].type;
      expect(jsonColumnFilterOperators({ type, multiple: true })).toEqual(['contains', 'not_contains', 'is_empty', 'is_not_empty']);
      expect(labelsFor(type, true)).toEqual(FOUR);
    }
  });

  it.each([
    ['Owners', 'user'],
    ['Accounts', 'lookup'],
    ['Regions', 'select'],
  ])('%s (%s, multiple) is offered exactly the shared builder’s set', async (label, type) => {
    render(<WidgetHost fields={servedCatalog()} writes={[]} />);
    expect(await offeredFor(screen.getByTestId('host'), label)).toEqual(labelsFor(type, true));
  });

  it.each([
    ['Owner', 'user'],
    ['Region', 'select'],
  ])('CONTROL: %s (%s, single value) keeps its equality operators', async (label, type) => {
    render(<WidgetHost fields={servedCatalog()} writes={[]} />);
    const offered = await offeredFor(screen.getByTestId('host'), label);
    expect(offered).toContain('Equals');
    // The type's own bucket (the dropdown leaves out the nullness pair where it
    // means what the empty checks mean), never the list set.
    expect(labelsFor(type, false)).toEqual(expect.arrayContaining(offered));
    expect(offered).not.toEqual(FOUR);
  });

  it('a stored `equals` rule on a list-valued column opens as its row, writes nothing, and can be changed to membership', async () => {
    const writes: Array<Rule[] | undefined> = [];
    render(<WidgetHost fields={servedCatalog()} initial={[{ field: 'owners', operator: 'equals', value: 'u1' }]} writes={writes} />);
    const host = screen.getByTestId('host');
    expect(within(host).getByTestId('filter-builder-trigger')).toHaveTextContent('Owners');
    // The row's own operator stays mounted beside the offered set.
    expect(await optionsOf(host, 1)).toEqual(['Equals', ...FOUR]);
    expect(writes).toEqual([]);
  });
});

describe('every host that builds the filter-builder field list carries `multiple` (objectstack#36169)', () => {
  it('the generic editor’s object catalog (`objectCatalogOf`) marks exactly the multiple: true columns, record or array form', () => {
    const marked = (fields: Array<{ name: string; multiple?: boolean }>) => fields.filter((f) => f.multiple === true).map((f) => f.name);
    expect(marked(objectCatalogOf(DEAL).fields)).toEqual([...MULTI]);
    expect(marked(objectCatalogOf({ fields: Object.values(DEAL_FIELDS) }).fields)).toEqual([...MULTI]);
    expect(objectCatalogOf(DEAL).fields.find((f) => f.name === 'owner')).toEqual({ name: 'owner', label: 'Owner', type: 'user' });
  });

  it('the runtime view panel’s catalog (`mapObjectFields`) marks exactly the multiple: true columns', () => {
    const fields = mapObjectFields(DEAL as never);
    expect(fields.filter((f) => f.multiple === true).map((f) => f.name)).toEqual([...MULTI]);
  });

  it('the view-variant inspector’s filter offers a multiple: true column membership only', async () => {
    function Harness() {
      const [draft, setDraft] = React.useState<Record<string, unknown>>({
        name: 'deals',
        object: 'deal',
        list: { type: 'grid', data: { provider: 'object', object: 'deal' }, columns: ['name'] },
      });
      return (
        <div data-testid="host">
          <ViewVariantInspector
            type="view"
            name="deals"
            draft={draft}
            onPatch={(patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch }))}
            onSelectionChange={() => {}}
            onClearSelection={() => {}}
            readOnly={false}
            locale={'en-US'}
            variantKey="list"
            familyKey="list"
            isHome={false}
            objectFieldsOverride={mapObjectFields(DEAL as never)}
          />
        </div>
      );
    }
    render(<Harness />);
    const trigger = await screen.findByTestId('filter-builder-trigger');
    const builder = trigger.parentElement as HTMLElement;
    expect(await offeredFor(builder, 'Owners')).toEqual(labelsFor('user', true));
  });

  it('the page block’s related-list filter offers a multiple: true column membership only', async () => {
    function Harness() {
      const [draft, setDraft] = React.useState<Record<string, unknown>>({
        name: 'account_page',
        type: 'record',
        object: 'account',
        kind: 'full',
        regions: [{ name: 'main', components: [{ id: 'deals', type: 'record:related_list', properties: { objectName: 'deal', relationshipField: 'account' } }] }],
      });
      return (
        <PageBlockInspector
          type="page"
          name="account_page"
          draft={draft}
          selection={{ kind: 'block', id: 'regions[0].components[0]' }}
          onPatch={(patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch }))}
          onClearSelection={() => {}}
          readOnly={false}
          locale={'en-US'}
        />
      );
    }
    render(<Harness />);
    const block = await screen.findByTestId('block-filter-rules');
    await waitFor(() => expect(within(block).getByRole('button', { name: 'Add filter' })).toBeInTheDocument());
    expect(await offeredFor(block, 'Regions')).toEqual(labelsFor('select', true));
  });
});

/* The Studio list-view inspector, over a REAL `MetadataClient` whose transport
 * serves the object and its default list view as the platform does
 * (`ObjectListViewInspector.hiddenSystemFields-13152.test.tsx`'s harness). */

const VIEW = 'deal.default';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const GRID_VIEW = {
  name: VIEW,
  object: 'deal',
  viewKind: 'list',
  isDefault: true,
  config: { type: 'grid', data: { provider: 'object', object: 'deal' }, columns: ['name'] },
};

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  const seg = meta[1].split('/').map(decodeURIComponent);
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (method === 'PUT') return json(200, { success: true, version: 'v2', state: 'draft' });
  if (seg[0] === 'object' && seg.length === 2) return json(200, { type: 'object', name: seg[1], item: DEAL });
  const isView = seg[0] === 'view' && seg[1] === VIEW;
  if (seg.length === 3 && seg[2] === 'layers') {
    return isView
      ? json(200, { code: null, overlay: GRID_VIEW, overlayScope: 'env', effective: GRID_VIEW })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  if (seg.length === 2 && url.searchParams.get('state') === 'draft') {
    return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
  }
  return isView ? json(200, { type: 'view', name: VIEW, item: GRID_VIEW }) : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [DEAL],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
};

describe('the Studio list-view inspector’s filter carries `multiple` (objectstack#36169)', () => {
  it('offers a multiple: true column membership only, and keeps Equals on a single-value control', async () => {
    const real = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });
    clients.current = real;
    const LEAF: Surface = { type: 'object', name: 'deal', label: 'Deals' };
    function Host() {
      const listView = useObjectListViewDraft({ client: real, packageId: 'com.acme.app', leaf: LEAF, publishNonce: 0 });
      return <ObjectListViewInspector listView={listView} readOnly={false} locale="en" />;
    }
    render(
      <MetadataCtx.Provider value={METADATA}>
        <Host />
      </MetadataCtx.Provider>,
    );
    const filter = await screen.findByTestId('list-view-filter', {}, { timeout: 5000 });
    await waitFor(() => expect(within(filter).getByRole('button', { name: 'Add filter' })).toBeInTheDocument());
    expect(await offeredFor(filter, 'Accounts')).toEqual(labelsFor('lookup', true));
    await pickFrom(filter, 0, 'Owner');
    expect(await optionsOf(filter, 1)).toContain('Equals');
  });
});
