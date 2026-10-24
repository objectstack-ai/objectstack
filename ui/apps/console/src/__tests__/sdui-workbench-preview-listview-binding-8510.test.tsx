/**
 * objectui#8510 — the workbench preview's react-tier `<ListView>` is written in
 * the contract's only spelling, and it still binds `showcase_project`.
 *
 * `REACT_BLOCKS` in `@objectstack/spec/ui` retired the ListView block's
 * `objectName` / `viewType` overlay props with no deprecation window
 * (objectstack#14791, ruling B); `@objectstack/lint` refuses a leftover alias on
 * a `kind:'react'` page as `react-prop-retired`. The spellings that remain are
 * ListViewSchema's own `data={{ provider: 'object', object: '…' }}` and `type`.
 * `sdui-workbench-preview.tsx` was the one in-repo react page still writing
 * `objectName="showcase_project"`, so it was rewritten to the `data` binding.
 *
 * Two facts are pinned, each by the real instrument rather than a copy of it:
 *
 *   1. RENDER — the rewritten binding still reaches the data layer. The page
 *      source is extracted from the harness (the same extractor the styling and
 *      query-params pins use, so it is the string the page really receives) and
 *      mounted through the real `kind:'react'` page tier and the real
 *      `list-view` registration. The object reaches `ListView` through
 *      `normalizeListViewSchema`'s `data.provider === 'object'` fold
 *      (objectui#7477) — nothing on the page writes `objectName` any more.
 *   2. CONTRACT — `validateReactPageProps` from `@objectstack/lint`, the same
 *      check `os validate` runs, reports no `react-prop-retired` on any preview
 *      page.
 *
 * NON-VACUITY IS PINNED, NOT ARGUED. The page itself calls
 * `adapter.find('showcase_project', { $top: 200 })` for its stats strip, so "a
 * find carried the object" would pass with the ListView binding removed. The
 * render case therefore reads what only `ListView` produces — the
 * `schema.objectName` its view is handed, the object-definition fetch
 * (`getObjectSchema`, which nothing else on the page calls while the form is
 * closed) and its own query, which selects the preview's columns — and a
 * control renders the SAME extracted source with the `data` binding stripped:
 * once the list block has answered (since objectui#11605 a list that names no
 * object draws the "no object named" hint in place of `ListView`), neither of
 * its data calls may have happened and the stats query must be the only one. The contract case carries a control too: the same source
 * with the retired spelling put back must go red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider, AdapterCtx } from '@object-ui/react';
// The page renderers (`type:'home'`), which dispatch `kind:'react'` to the
// react page tier.
import '@object-ui/components';
// The REAL `list-view`, which the react page's `<ListView>` resolves to.
import '@object-ui/plugin-list';
import { validateReactPageProps, REACT_PROP_RETIRED } from '@objectstack/lint';
import { pagesOf, previewHarnessFiles, readHarness } from './helpers/preview-page-sources';

const HARNESS = 'sdui-workbench-preview.tsx';
const OBJECT = 'showcase_project';

/** The binding the harness writes today, exactly as the page receives it. */
const DATA_BINDING = `data={{ provider: 'object', object: '${OBJECT}' }}`;
/** The retired spelling the contract refuses. */
const RETIRED_BINDING = `objectName="${OBJECT}"`;
/** The columns the harness's ListView asks for — its query selects them. */
const COLUMNS = ['name', 'status', 'health', 'budget', 'owner'];
/** The page's OWN query (its stats strip), which is not the ListView's. */
const STATS_QUERY = { $top: 200 };

const [workbench] = pagesOf(readHarness(HARNESS), HARNESS);

/** Every page in every preview harness, for the contract sweep. */
const allPages = previewHarnessFiles.flatMap((file) =>
  pagesOf(readHarness(file), file).map((page) => ({ file, ...page })),
);

const rows = [
  { id: '1', name: 'Apollo Migration', status: 'active' },
  { id: '2', name: 'Billing Revamp', status: 'planned' },
];

const objectDef = {
  name: OBJECT,
  label: 'Project',
  fields: {
    name: { name: 'name', type: 'text', label: 'Project Name' },
    status: { name: 'status', type: 'text', label: 'Status' },
  },
};

/** The part of a view's props this file reads: the schema ListView hands down. */
interface ViewSpyProps {
  schema?: { objectName?: unknown };
}

/** Props the view spy received, in order. */
let gridProps: ViewSpyProps[] = [];

// The default kind is `grid` (the page authors no `type`), so the view ListView
// hands its binding to is `object-grid`. A spy stands in for the real grid: the
// question here is what ListView resolved, not how a grid draws.
ComponentRegistry.register(
  'object-grid',
  (props: ViewSpyProps) => {
    gridProps.push(props);
    return <div data-testid="grid-spy" />;
  },
  { namespace: 'test', label: 'Grid spy', category: 'view' },
);

const makeDataSource = () => ({
  find: vi.fn<(object: string, params?: unknown) => Promise<typeof rows>>(async () => rows),
  findOne: vi.fn(async () => null),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(async () => rows.length),
  getObjectSchema: vi.fn<(object: string) => Promise<typeof objectDef>>(async () => objectDef),
  getObjects: vi.fn(async () => []),
  onMutation: () => () => {},
});

/** Mount a page source through the real `kind:'react'` tier, as the harness does. */
function renderWorkbench(source: string) {
  const dataSource = makeDataSource();
  const { container } = render(
    <AdapterCtx.Provider value={dataSource as never}>
      <SchemaRendererProvider dataSource={dataSource as never}>
        <SchemaRenderer schema={{ type: 'home', kind: 'react', name: workbench.name, source } as never} />
      </SchemaRendererProvider>
    </AdapterCtx.Provider>,
  );
  return { dataSource, container };
}

/** True for the page's own stats query — the one find call that is not ListView's. */
function isStatsQuery(params: unknown): boolean {
  return JSON.stringify(params) === JSON.stringify(STATS_QUERY);
}

beforeEach(() => {
  gridProps = [];
});

describe('sdui-workbench-preview — the react-tier ListView binding (objectui#8510)', () => {
  it('the extracted page is the workbench, and it binds ListView with the data source only', () => {
    expect(`${workbench.name}:${workbench.kind}`).toBe('crm_workbench:react');
    // The binding the render case relies on is really in the source …
    expect(workbench.source).toContain(`<ListView key={reloadKey} ${DATA_BINDING} `);
    // … and the retired spelling is not, anywhere on the page's ListView.
    expect(workbench.source).not.toMatch(/<ListView\b[^>]*\b(objectName|viewType)=/);
  });

  it('renders the ListView bound to showcase_project through the data-source fold', async () => {
    const { dataSource } = renderWorkbench(workbench.source);

    await waitFor(() => expect(gridProps.length).toBeGreaterThan(0));
    // The object the view was handed came from `data={{ provider: 'object' }}`.
    expect(gridProps[gridProps.length - 1]?.schema?.objectName).toBe(OBJECT);
    // And it is live: ListView fetched that object's definition — a call no
    // other code on the page makes while the form is closed …
    expect(dataSource.getObjectSchema).toHaveBeenCalledWith(OBJECT);
    // … and queried the object for its columns, which the stats strip's own
    // `{ $top: 200 }` query does not.
    expect(dataSource.find).toHaveBeenCalledWith(
      OBJECT,
      expect.objectContaining({ $select: expect.arrayContaining(COLUMNS) }),
    );
  });

  it('control — the same source with the data binding stripped binds ListView to nothing', async () => {
    const stripped = workbench.source.replace(`${DATA_BINDING} `, '');
    expect(stripped).not.toBe(workbench.source);

    const { dataSource, container } = renderWorkbench(stripped);

    // With no object named, the list block draws the "no object named" hint
    // instead of mounting `ListView` (objectui#11605), so the hint is what
    // says the block has answered.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="list-view-no-object"]')).not.toBeNull(),
    );
    expect(dataSource.getObjectSchema).not.toHaveBeenCalled();
    expect(dataSource.find.mock.calls.filter(([, params]) => !isStatsQuery(params))).toEqual([]);
    expect(gridProps.filter((p) => p.schema?.objectName)).toEqual([]);
  });

  it('no preview page writes a retired react-tier prop (react-prop-retired)', () => {
    expect(allPages.map((p) => `${p.file}:${p.name}`)).toContain(`${HARNESS}:${workbench.name}`);
    const retired = validateReactPageProps({ pages: allPages as unknown as Record<string, unknown>[] })
      .filter((f) => f.rule === REACT_PROP_RETIRED);
    expect(retired.map((f) => `${f.where}: ${f.message}`)).toEqual([]);
  });

  it('control — putting the retired spelling back turns that check red', () => {
    const regressed = workbench.source.replace(DATA_BINDING, RETIRED_BINDING);
    expect(regressed).not.toBe(workbench.source);

    const findings = validateReactPageProps({
      pages: [{ type: 'home', kind: 'react', name: workbench.name, source: regressed }],
    });
    expect(findings.map((f) => f.rule)).toEqual([REACT_PROP_RETIRED]);
  });
});
