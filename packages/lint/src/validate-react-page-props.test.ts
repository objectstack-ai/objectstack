// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import {
  validateReactPageProps,
  REACT_CHART_FIELD_UNKNOWN,
  REACT_CHART_FIELD_UNPROVISIONED,
  REACT_CHART_AGGREGATE_INVALID,
  REACT_CHART_AXIS_UNKNOWN,
  REACT_CHART_DRILLDOWN_INVALID,
  REACT_BLOCK_NEEDS_RECORD_CONTEXT,
  REACT_PAGE_SOURCE_UNPARSEABLE,
  type ReactPropFinding as PropFinding,
} from './validate-react-page-props.js';
// [#10653] The syntax gate whose cover the deleted `catch` comment credited,
// imported so the divergence between the two parsers is asserted, not described.
import { validateReactPages } from './validate-react-pages.js';
import {
  SEARCHABLE_FIELD_UNKNOWN,
  SEARCHABLE_FIELD_UNSEARCHABLE,
  SEARCHABLE_FIELD_UNPROVISIONED,
} from './validate-searchable-fields.js';
import { PAGE_FIELD_UNKNOWN, PAGE_FIELD_UNPROVISIONED } from './validate-page-field-bindings.js';
// The gate PARSES `ChartAggregateSchema` since #5020, so the function
// vocabulary lives in the schema and nowhere in the rule. Imported here to pin
// the test table against it — see the `aggregate` block near the bottom.
import { ChartAggregateFunctionSchema } from '@objectstack/spec/ui';

const page = (source: string) => ({ pages: [{ name: 'p', kind: 'react', source }] });

describe('validateReactPageProps (ADR-0081 Phase 2)', () => {
  it('passes a correct ObjectForm usage', () => {
    const f = validateReactPageProps(page('function Page(){ return <ObjectForm objectName="account" mode="edit" onSuccess={()=>{}} />; }'));
    expect(f).toEqual([]);
  });

  it('flags a missing required binding (objectName)', () => {
    const f = validateReactPageProps(page('function Page(){ return <ObjectForm mode="edit" />; }'));
    expect(f.some((x) => x.rule === 'react-prop-missing-required' && /objectName/.test(x.message))).toBe(true);
  });

  it('flags a typo of a contract prop (onSucces → onSuccess)', () => {
    const f = validateReactPageProps(page('function Page(){ return <ObjectForm objectName="a" onSucces={()=>{}} />; }'));
    expect(f.some((x) => x.rule === 'react-prop-typo' && /onSuccess/.test(x.message))).toBe(true);
  });

  it('flags ListView onRowClik typo', () => {
    const f = validateReactPageProps(page('function Page(){ return <ListView objectName="a" onRowClik={()=>{}} />; }'));
    expect(f.some((x) => x.rule === 'react-prop-typo' && /onRowClick/.test(x.message))).toBe(true);
  });

  it('does NOT flag a spread (props may come from it)', () => {
    const f = validateReactPageProps(page('function Page(){ const p={objectName:"a"}; return <ObjectForm {...p} />; }'));
    expect(f).toEqual([]);
  });

  it('ignores unknown components (author HTML / own components)', () => {
    const f = validateReactPageProps(page('function Page(){ return <div className="x"><MyThing foo="bar" /></div>; }'));
    expect(f).toEqual([]);
  });

  it('does NOT false-flag a valid non-contract prop (no near match)', () => {
    const f = validateReactPageProps(page('function Page(){ return <ListView objectName="a" striped={true} />; }'));
    expect(f).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// <ObjectChart> binding integrity (#3701)
// ─────────────────────────────────────────────────────────────────────────

const invoice = {
  name: 'invoice',
  fields: [{ name: 'total' }, { name: 'status' }, { name: 'closed_at' }],
};

const chartPage = (source: string, objects: unknown[] = [invoice]) => ({
  objects,
  pages: [{ name: 'p', kind: 'react', source }],
});

const chart = (attrs: string) => `function Page(){ return <ObjectChart ${attrs} />; }`;

describe('validateReactPageProps — <ObjectChart> bindings (#3701)', () => {
  it('passes an aggregate whose field and groupBy exist on the object', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }}`)),
    );
    expect(f).toEqual([]);
  });

  it('flags an aggregate.field the object does not declare', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'amount', function: 'sum', groupBy: 'status' }}`)),
    );
    expect(f.some((x) => x.rule === REACT_CHART_FIELD_UNKNOWN && /aggregate\.field "amount"/.test(x.message))).toBe(true);
  });

  it('flags an aggregate.groupBy the object does not declare', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'stage' }}`)),
    );
    expect(f.some((x) => x.rule === REACT_CHART_FIELD_UNKNOWN && /aggregate\.groupBy "stage"/.test(x.message))).toBe(true);
  });

  it('reads the field out of a structured, date-bucketed groupBy', () => {
    const ok = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: { field: 'closed_at', dateGranularity: 'quarter' } }}`)),
    );
    expect(ok).toEqual([]);
    const bad = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: { field: 'signed_at' } }}`)),
    );
    expect(bad.some((x) => x.rule === REACT_CHART_FIELD_UNKNOWN && /signed_at/.test(x.message))).toBe(true);
  });

  it('flags an aggregation function no chart renderer implements', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'median', groupBy: 'status' }}`)),
    );
    // Since #5020 the vocabulary in this message comes from the schema's enum
    // rather than a local copy, and the author's own value is echoed back from
    // the input — the one part of the hand-rolled message zod does not produce.
    expect(f.some((x) => x.rule === REACT_CHART_AGGREGATE_INVALID && /median/.test(x.message))).toBe(true);
  });

  it('flags a non-count function with nothing to aggregate', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ function: 'sum', groupBy: 'status' }}`)),
    );
    // The schema's OWN refinement message now reaches the author verbatim
    // (#5020) — this rule no longer keeps a second copy of the rule to phrase.
    expect(
      f.some((x) => x.rule === REACT_CHART_AGGREGATE_INVALID && /needs a "field" to aggregate/.test(x.message)),
    ).toBe(true);
  });

  it('accepts a fieldless count', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ function: 'count', groupBy: 'status' }} series={[{ dataKey: 'count' }]}`)),
    );
    expect(f).toEqual([]);
  });

  it('accepts axes bound to the aggregate result columns', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} xAxisKey="status" series={[{ dataKey: 'total' }]}`)),
    );
    expect(f).toEqual([]);
  });

  it('flags a series bound to the DATASET-style measure name', () => {
    // The exact bug #3684 catches on dataset charts, on the object-bound path:
    // an object aggregate keys its rows `total`, never `sum_total`.
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} series={[{ dataKey: 'sum_total' }]}`)),
    );
    expect(f.some((x) => x.rule === REACT_CHART_AXIS_UNKNOWN && /sum_total/.test(x.message))).toBe(true);
  });

  it('flags an xAxisKey that is neither result column', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} xAxisKey="closed_at"`)),
    );
    expect(f.some((x) => x.rule === REACT_CHART_AXIS_UNKNOWN && /closed_at/.test(x.message))).toBe(true);
  });

  it('flags an xAxisKey bound to the VALUE column (a real column, wrong axis)', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} xAxisKey="total"`)),
    );
    expect(f.some((x) => x.rule === REACT_CHART_AXIS_UNKNOWN && /VALUE column/.test(x.message))).toBe(true);
  });

  it('accepts the comparison-overlay column', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} series={[{ dataKey: 'total' }, { dataKey: 'total__comparison' }]}`)),
    );
    expect(f).toEqual([]);
  });

  // ── the spec ChartConfig shape is the contract again (#3729) ────────────

  it('accepts the spec axis shape', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" type="bar" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} xAxis={{ field: 'status' }} yAxis={[{ field: 'total' }]}`)),
    );
    expect(f).toEqual([]);
  });

  it('flags a spec yAxis[].field that is not a result column', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} yAxis={[{ field: 'sum_total' }]}`)),
    );
    expect(f.some((x) => x.rule === REACT_CHART_AXIS_UNKNOWN && /sum_total/.test(x.message))).toBe(true);
  });

  it('flags a spec series[].name that is not a result column', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} series={[{ name: 'sum_total' }]}`)),
    );
    const hit = f.find((x) => x.rule === REACT_CHART_AXIS_UNKNOWN);
    expect(hit?.hint).toMatch(/series\[\]\.name/);
  });

  it('flags a spec xAxis.field bound to the VALUE column', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} xAxis={{ field: 'total' }}`)),
    );
    expect(f.some((x) => x.rule === REACT_CHART_AXIS_UNKNOWN && /VALUE column/.test(x.message))).toBe(true);
  });

  it('still accepts the internal spelling — dashboards emit it', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} xAxisKey="status" series={[{ dataKey: 'total' }]}`)),
    );
    expect(f).toEqual([]);
  });

  // ── false-positive guards ───────────────────────────────────────────────

  it('skips an aggregate built from variables (not knowable at build time)', () => {
    const f = validateReactPageProps(
      chartPage('function Page(){ const agg = { field: f, function: "sum", groupBy: g }; return <ObjectChart objectName="invoice" aggregate={agg} />; }'),
    );
    expect(f).toEqual([]);
  });

  it('skips a shorthand property (its value is hidden)', () => {
    const f = validateReactPageProps(
      chartPage('function Page(){ const field = "nope"; return <ObjectChart objectName="invoice" aggregate={{ field, function: "sum", groupBy: "status" }} />; }'),
    );
    expect(f).toEqual([]);
  });

  it('skips an object declared in another package', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="sys_user" aggregate={{ field: 'nope', function: 'sum', groupBy: 'also_nope' }}`)),
    );
    expect(f.some((x) => x.rule === REACT_CHART_FIELD_UNKNOWN)).toBe(false);
  });

  it('does not flag system fields the registry injects', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ function: 'count', groupBy: 'owner_id' }}`)),
    );
    expect(f).toEqual([]);
  });

  it('skips the axis check when static `data` supplies the rows', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" data={[{ x: 1 }]} aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} xAxisKey="x"`)),
    );
    expect(f).toEqual([]);
  });

  it('skips everything behind a spread', () => {
    const f = validateReactPageProps(
      chartPage('function Page(){ const p = {}; return <ObjectChart {...p} aggregate={{ field: "nope", function: "sum", groupBy: "status" }} />; }'),
    );
    expect(f).toEqual([]);
  });

  it('leaves a chart with no aggregate alone (dataset-bound or data-bound)', () => {
    const f = validateReactPageProps(chartPage(chart(`objectName="invoice"`)));
    expect(f).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// <ListView> searchableFields (#4329) — the react-surface twin of the
// metadata rule `searchable-field-unknown` (#4328). Same core, so the same
// skips and the same dotted-path strictness; these tests pin the JSX-specific
// seams (static-value resolution, spread, where/path shape).
// ─────────────────────────────────────────────────────────────────────────

const account = {
  name: 'crm_account',
  fields: {
    name: { type: 'text' },
    billing_email: { type: 'email' },
    owner_id: { type: 'lookup', reference: 'sys_user' },
  },
};

const listPage = (source: string, objects: unknown[] = [account]) => ({
  objects,
  pages: [{ name: 'p', kind: 'react', source }],
});

const list = (attrs: string) => `function Page(){ return <ListView ${attrs} />; }`;

describe('validateReactPageProps — <ListView> searchableFields (#4329)', () => {
  it('passes a declaration whose every entry resolves', () => {
    const f = validateReactPageProps(
      listPage(list(`objectName="crm_account" searchableFields={['name', 'billing_email']}`)),
    );
    expect(f).toEqual([]);
  });

  it('flags a stale entry, gating, under the metadata rule id', () => {
    const f = validateReactPageProps(
      listPage(list(`objectName="crm_account" searchableFields={['name', 'email']}`)),
    );

    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe(SEARCHABLE_FIELD_UNKNOWN);
    // `error`, like the metadata surface: objectui echoes the prop verbatim as
    // the `$searchFields` override, so a stale entry is the same 400-in-waiting.
    expect(f[0].severity).toBe('error');
    expect(f[0].where).toBe('page "p" › <ListView>');
    // The entry index is part of the path so the author can go straight to it.
    expect(f[0].path).toBe('pages[0].source › searchableFields[1]');
    expect(f[0].message).toContain('"email"');
    expect(f[0].message).toContain('crm_account');
    expect(f[0].hint).toContain('400 INVALID_FIELD');
  });

  it('suggests the real field when the stale name is close to one', () => {
    const f = validateReactPageProps(
      listPage(list(`objectName="crm_account" searchableFields={['biling_email']}`)),
    );
    expect(f[0].message).toContain('Did you mean "billing_email"?');
  });

  it('accepts registry-injected system columns absent from authored fields', () => {
    const f = validateReactPageProps(
      listPage(list(`objectName="crm_account" searchableFields={['name', 'created_at']}`)),
    );
    expect(f).toEqual([]);
  });

  it('flags an authored lookup — the runtime refuses the echoed override (#4830)', () => {
    // <ListView searchableFields> is echoed verbatim as `$searchFields`, and
    // the #4254 ingress gate rejects a lookup with 400 INVALID_FIELD — the
    // whole toolbar search, for every role. Same judgment as the metadata
    // list-view surface, by the shared core.
    const f = validateReactPageProps(
      listPage(list(`objectName="crm_account" searchableFields={['name', 'owner_id']}`)),
    );
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(f[0].severity).toBe('error');
    expect(f[0].path).toBe('pages[0].source › searchableFields[1]');
    expect(f[0].message).toContain('400 INVALID_FIELD');
  });

  it('[#8404] warns on an unprovisioned anchor, and PINS that this surface threads the index', () => {
    // Load-bearing beyond the warning itself. `validateReactPageProps` builds
    // `unprovisionedAnchors` for its other field-prop checks, so if this
    // `checkSearchableFieldList` call ever stops passing it, the index stays
    // READ elsewhere in the same function — no TS6133, no type error, and the
    // metadata-surface tests in validate-searchable-fields.test.ts cannot see
    // this call site at all. Measured: with the argument dropped here, typecheck
    // and the whole 72-file lint suite stay green. This test is the only thing
    // that goes red, which is precisely why it exists.
    const external = {
      name: 'ext_account',
      external: { remoteName: 'accounts' },
      fields: { name: { type: 'text' } },
    };
    const f = validateReactPageProps(
      listPage(list(`objectName="ext_account" searchableFields={['name', 'owner_id']}`), [external]),
    );

    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe(SEARCHABLE_FIELD_UNPROVISIONED);
    expect(f[0].severity).toBe('warning');
    expect(f[0].path).toBe('pages[0].source › searchableFields[1]');
    expect(f[0].message).toContain('external object (ADR-0015)');
    expect(f[0].message).toContain('$searchFields');
  });

  it('flags a dotted path — search cannot resolve the traversal', () => {
    const f = validateReactPageProps(
      listPage(list(`objectName="crm_account" searchableFields={['owner_id.name']}`)),
    );
    expect(f).toHaveLength(1);
    expect(f[0].hint).toContain("scans this object's own columns");
  });

  it('skips an object this stack does not define', () => {
    const f = validateReactPageProps(
      listPage(list(`objectName="pkg_contract" searchableFields={['no_such_field']}`)),
    );
    expect(f).toEqual([]);
  });

  it('skips an object with no authored field map (external / introspected)', () => {
    const f = validateReactPageProps(
      listPage(list(`objectName="external_invoice" searchableFields={['doc_no']}`), [
        { name: 'external_invoice', external: { datasource: 'erp' } },
      ]),
    );
    expect(f).toEqual([]);
  });

  it('skips a value built from a variable (not knowable at build time)', () => {
    const f = validateReactPageProps(
      listPage(
        'function Page(){ const sf = ["nope"]; return <ListView objectName="crm_account" searchableFields={sf} />; }',
      ),
    );
    expect(f).toEqual([]);
  });

  it('skips everything behind a spread (props may come from it)', () => {
    const f = validateReactPageProps(
      listPage(
        'function Page(){ const p = {}; return <ListView objectName="crm_account" {...p} searchableFields={["nope"]} />; }',
      ),
    );
    expect(f).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Every OTHER field-bearing block prop (#4340) — the class #4329 opened one
// instance of. Resolved under the metadata rule's id (`page-field-unknown`),
// against the block's own bound object, at the metadata rule's severity —
// except a FILTER position, which reaches a query rather than a renderer.
// ─────────────────────────────────────────────────────────────────────────

const invoiceObj = {
  name: 'crm_invoice',
  fields: {
    name: { type: 'text' },
    status: { type: 'select' },
    total: { type: 'currency' },
    account_id: { type: 'lookup', reference: 'crm_account' },
  },
};

const propsPage = (source: string, objects: unknown[] = [account, invoiceObj]) => ({
  objects,
  pages: [{ name: 'p', kind: 'react', source }],
});
const jsx = (tag: string, attrs: string) => `function Page(){ return <${tag} ${attrs} />; }`;
const unknownFields = (f: PropFinding[]) => f.filter((x) => x.rule === PAGE_FIELD_UNKNOWN);

describe('validateReactPageProps — <ListView> field props (#4340)', () => {
  it('passes columns/fields/sort/grouping/userFilters that all resolve', () => {
    const f = validateReactPageProps(
      propsPage(
        jsx(
          'ListView',
          `objectName="crm_account" columns={['name']} fields={['billing_email']} ` +
            `sort={[{ field: 'name', order: 'asc' }]} grouping={{ fields: [{ field: 'name' }] }} ` +
            `userFilters={{ element: 'dropdown', fields: [{ field: 'billing_email' }] }}`,
        ),
      ),
    );
    expect(f).toEqual([]);
  });

  it('flags a stale `columns` entry, advisory, under the metadata rule id', () => {
    const f = unknownFields(
      validateReactPageProps(propsPage(jsx('ListView', `objectName="crm_account" columns={['name', 'revenue']}`))),
    );
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('warning');
    expect(f[0].where).toBe('page "p" › <ListView>');
    expect(f[0].path).toBe('pages[0].source › columns[1]');
    expect(f[0].message).toContain('"revenue"');
    expect(f[0].message).toContain('crm_account');
  });

  it('flags the React overlay `fields` prop too — either spelling names columns', () => {
    const f = unknownFields(
      validateReactPageProps(propsPage(jsx('ListView', `objectName="crm_account" fields={['nope']}`))),
    );
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe('pages[0].source › fields[0]');
  });

  it('reads a `{field}` column record, not just a bare name', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(jsx('ListView', `objectName="crm_account" columns={[{ field: 'nope', width: 120 }]}`)),
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('"nope"');
  });

  it('reads the LEGACY bare-string sort by its head, not the whole string', () => {
    const ok = unknownFields(
      validateReactPageProps(propsPage(jsx('ListView', `objectName="crm_account" sort="name desc"`))),
    );
    expect(ok).toEqual([]);
    const bad = unknownFields(
      validateReactPageProps(propsPage(jsx('ListView', `objectName="crm_account" sort="revenue desc"`))),
    );
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain('"revenue"');
    expect(bad[0].message).not.toContain('revenue desc');
  });

  it('flags a stale nested userFilters/grouping field', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(
          jsx(
            'ListView',
            `objectName="crm_account" userFilters={{ fields: [{ field: 'nope' }] }} grouping={{ fields: [{ field: 'also_nope' }] }}`,
          ),
        ),
      ),
    );
    expect(f.map((x) => x.path)).toEqual([
      'pages[0].source › userFilters.fields[0].field',
      'pages[0].source › grouping.fields[0].field',
    ]);
  });

  it('covers the legacy `filterableFields` shorthand', () => {
    const f = unknownFields(
      validateReactPageProps(propsPage(jsx('ListView', `objectName="crm_account" filterableFields={['nope']}`))),
    );
    expect(f).toHaveLength(1);
  });
});

describe('validateReactPageProps — filter POSITIONS gate (#4340)', () => {
  it('resolves the field position beside a NON-static value — the common react shape', () => {
    // `staticValue` bails on the whole array here; the filter reader keeps the
    // positions independent, so the knowable one is still checked.
    const f = unknownFields(
      validateReactPageProps(
        propsPage(
          'function Page(){ const stage = "x"; return <ListView objectName="crm_account" filters={["nope", "=", stage]} />; }',
        ),
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe('pages[0].source › filters[0]');
  });

  it('gates: a filter miss returns an empty list, not a skipped column', () => {
    const f = unknownFields(
      validateReactPageProps(propsPage(jsx('ListView', `objectName="crm_account" filters={['nope', '=', 'x']}`))),
    );
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('error');
    expect(f[0].message).toContain('QUERY');
  });

  it('passes a field position that resolves', () => {
    const f = validateReactPageProps(
      propsPage(jsx('ListView', `objectName="crm_account" filters={['billing_email', '=', 'a@b.c']}`)),
    );
    expect(f).toEqual([]);
  });

  it('descends compound and legacy-flat filter nodes', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(
          jsx('ListView', `objectName="crm_account" filters={['and', ['name', '=', 'x'], ['nope', '>', 1]]}`),
        ),
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe('pages[0].source › filters[2][0]');

    const flat = unknownFields(
      validateReactPageProps(
        propsPage(jsx('ListView', `objectName="crm_account" filters={[['nope', '=', 1]]}`)),
      ),
    );
    expect(flat).toHaveLength(1);
  });

  it('says nothing when the field POSITION itself is not static', () => {
    const f = validateReactPageProps(
      propsPage('function Page(){ const c = "x"; return <ListView objectName="crm_account" filters={[c, "=", 1]} />; }'),
    );
    expect(f).toEqual([]);
  });

  it('says nothing when position 1 is not a known operator (not a filter node)', () => {
    const f = validateReactPageProps(
      propsPage(jsx('ListView', `objectName="crm_account" filters={['nope', 'wat', 1]}`)),
    );
    expect(f).toEqual([]);
  });

  it('covers <ObjectChart filter> on the same terms', () => {
    const f = unknownFields(
      validateReactPageProps(propsPage(jsx('ObjectChart', `objectName="crm_invoice" filter={['nope', '=', 'x']}`))),
    );
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('error');
  });
});

describe('validateReactPageProps — <ObjectForm> field props (#4340)', () => {
  it('flags a stale `fields` entry and a stale `initialValues` KEY', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(
          jsx('ObjectForm', `objectName="crm_account" fields={['name', 'nope']} initialValues={{ name: 'x', bogus: 1 }}`),
        ),
      ),
    );
    expect(f.map((x) => x.path)).toEqual([
      'pages[0].source › fields[1]',
      'pages[0].source › initialValues.bogus',
    ]);
    expect(f.every((x) => x.severity === 'warning')).toBe(true);
  });

  it('walks sections[].fields[] (both the bare and the {name} entry shapes)', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(
          jsx('ObjectForm', `objectName="crm_account" sections={[{ label: 'Basics', fields: ['name', 'nope', { name: 'also_nope' }] }]}`),
        ),
      ),
    );
    expect(f.map((x) => x.path)).toEqual([
      'pages[0].source › sections[0].fields[1]',
      'pages[0].source › sections[0].fields[2].name',
    ]);
  });
});

/**
 * #4413. These blocks were published by the react contract with
 * `objectName`/`recordId` props, and no renderer read either: they take their
 * record from the context a RECORD page mounts, and a react page mounts none.
 * A page authored exactly to contract therefore rendered EMPTY, silently —
 * and this rule, which used to resolve those props' field names against the
 * object they named, was lint standing guard over a binding that never ran.
 *
 * The props are withdrawn; what is left to check is that the block is not here
 * at all, loudly, at publish time.
 */
describe('validateReactPageProps — record:* blocks need a context this surface lacks (#4413)', () => {
  const rejections = (f: PropFinding[]) =>
    f.filter((x) => x.rule === REACT_BLOCK_NEEDS_RECORD_CONTEXT);

  it('rejects each block the contract used to publish', () => {
    for (const tag of ['RecordDetails', 'RecordHighlights', 'RecordRelatedList', 'RecordPath']) {
      const f = validateReactPageProps(
        propsPage(jsx(tag, `objectName="crm_account" recordId={1}`)),
      );
      const rejected = rejections(f);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].severity).toBe('error');
      expect(rejected[0].where).toBe(`page "p" › <${tag}>`);
      expect(rejected[0].message).toContain('renders empty');
    }
  });

  it('rejects the record:* blocks that were never in the contract either', () => {
    // The injected scope is built from the whole public registry, so these are
    // just as reachable — and just as empty — as the four that were published.
    const f = rejections(validateReactPageProps(propsPage(jsx('RecordActivity', `objectName="crm_account"`))));
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('record:activity');
  });

  it('names a block that actually works in the hint', () => {
    const [related] = rejections(
      validateReactPageProps(propsPage(jsx('RecordRelatedList', `objectName="crm_invoice" recordId={1}`))),
    );
    expect(related.hint).toContain('<ListView');
    const [details] = rejections(
      validateReactPageProps(propsPage(jsx('RecordDetails', `objectName="crm_account"`))),
    );
    expect(details.hint).toContain('<ObjectForm');
  });

  it('says nothing else about a block it has already rejected', () => {
    // No point resolving `columns` against an object for a block that cannot
    // render here — one clear finding beats a pile of derived ones.
    const f = validateReactPageProps(
      propsPage(jsx('RecordRelatedList', `objectName="crm_account" columns={['nope']} statusField="gone"`)),
    );
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe(REACT_BLOCK_NEEDS_RECORD_CONTEXT);
  });

  it('rejects the same components reached through <Block type>', () => {
    const f = rejections(
      validateReactPageProps(
        propsPage(jsx('Block', `type="record:highlights" objectName="crm_account" fields={['name']}`)),
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].where).toBe('page "p" › <Block>');
    expect(f[0].message).toContain('record:highlights');
  });

  it('leaves an author-defined component of the same name alone', () => {
    // A local declaration shadows the injected scope, so this `<RecordPath>` is
    // the author's own component — flagging it would block a publish over a
    // name collision.
    const f = validateReactPageProps(
      propsPage(
        'function Page(){ const RecordPath = ({ v }) => <span>{v}</span>; return <RecordPath v="ok" />; }',
      ),
    );
    expect(f).toEqual([]);
  });

  it('says nothing on a metadata page — this is a react-surface rule', () => {
    const f = validateReactPageProps({
      objects: [account],
      pages: [
        {
          name: 'p',
          kind: 'default',
          regions: [{ components: [{ type: 'record:highlights', properties: { fields: ['name'] } }] }],
        },
      ],
    });
    expect(f).toEqual([]);
  });
});

describe('validateReactPageProps — <Block> escape hatch (#4340)', () => {
  it('checks the props bag by the registered type the author names', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(jsx('Block', `type="element:form" objectName="crm_account" fields={['nope']}`)),
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].where).toBe('page "p" › <Block>');
    expect(f[0].path).toBe('pages[0].source › fields[0]');
  });

  it('skips a type with no descriptor, and a non-static type', () => {
    const noSpec = validateReactPageProps(
      propsPage(jsx('Block', `type="object-kanban" objectName="crm_account" fields={['nope']}`)),
    );
    expect(noSpec).toEqual([]);
    const dynamic = validateReactPageProps(
      propsPage('function Page(){ const t = "record:highlights"; return <Block type={t} objectName="crm_account" fields={["nope"]} />; }'),
    );
    expect(dynamic).toEqual([]);
  });
});

describe('validateReactPageProps — field-prop false-positive guards (#4340)', () => {
  it('skips an object this stack does not define', () => {
    const f = validateReactPageProps(
      propsPage(jsx('ListView', `objectName="pkg_thing" columns={['nope']} filters={['nope', '=', 1]}`)),
    );
    expect(f).toEqual([]);
  });

  it('skips a block with no static objectName', () => {
    const f = validateReactPageProps(
      propsPage('function Page(){ const o = "crm_account"; return <ListView objectName={o} columns={["nope"]} />; }'),
    );
    expect(f).toEqual([]);
  });

  it('skips a non-static value', () => {
    const f = validateReactPageProps(
      propsPage('function Page(){ const c = ["nope"]; return <ListView objectName="crm_account" columns={c} />; }'),
    );
    expect(f).toEqual([]);
  });

  it('skips everything behind a spread', () => {
    const f = validateReactPageProps(
      propsPage(
        'function Page(){ const p = {}; return <ListView objectName="crm_account" {...p} columns={["nope"]} filters={["nope","=",1]} />; }',
      ),
    );
    expect(f).toEqual([]);
  });

  it('accepts registry-injected system columns and relationship paths', () => {
    const f = validateReactPageProps(
      propsPage(
        jsx('ListView', `objectName="crm_account" columns={['created_at', 'owner_id', 'owner_id.name']} filters={['created_at', '>', 1]}`),
      ),
    );
    expect(f).toEqual([]);
  });
});

describe('validateReactPageProps — <ObjectForm subforms> resolve per child object (#4340)', () => {
  it('checks each entry against its own childObject, and totalField against the form object', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(
          jsx(
            'ObjectForm',
            `objectName="crm_account" subforms={[{ childObject: 'crm_invoice', relationshipField: 'account_id', ` +
              `columns: ['total', 'nope'], amountField: 'total', totalField: 'not_on_account' }]}`,
          ),
        ),
      ),
    );
    expect(f.map((x) => x.path)).toEqual([
      'pages[0].source › subforms[0].columns[1]',
      'pages[0].source › subforms[0].totalField',
    ]);
    // The child-scoped miss names the CHILD object, not the form's.
    expect(f[0].message).toContain('crm_invoice');
    expect(f[1].message).toContain('crm_account');
  });

  it('skips an entry whose childObject is absent or from another package', () => {
    const f = validateReactPageProps(
      propsPage(
        jsx('ObjectForm', `objectName="crm_account" subforms={[{ columns: ['nope'] }, { childObject: 'pkg_line', columns: ['nope'] }]}`),
      ),
    );
    expect(f).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// <ObjectChart drillDown> — the declared shape, ENFORCED (#5022)
//
// This is the half that makes `ChartDrillDownSchema` more than a type. The
// schema is `.strict()`, but `.strict()` is a property of a PARSE — before
// this gate nothing on the react surface called one, which was exactly the
// `no gate` verdict the strictness ledger recorded for `aggregate` two props
// over until #5020 wired that parse too (its own block below), with the
// posture following at #5583 — so both props are now parsed AND closed, and the
// asymmetry this paragraph used to record is history. The rule parses instead of re-deriving, so the surface name, the
// near-key guidance and the `target` union all arrive without being restated
// here — which is why #5435's widening needed no edit to the rule itself.
// ─────────────────────────────────────────────────────────────────────────

describe('validateReactPageProps — <ObjectChart drillDown> (#5022)', () => {
  const drill = (cfg: string) =>
    chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} drillDown={${cfg}}`));

  it('passes a fully-declared drill config', () => {
    const f = validateReactPageProps(
      drill(`{ enabled: true, target: 'dialog', columns: ['status'], maxRows: 25, title: 'Deals' }`),
    );
    expect(f).toEqual([]);
  });

  it('passes the empty config — presence alone enables the drill', () => {
    expect(validateReactPageProps(drill('{}'))).toEqual([]);
  });

  it('passes a chart with no drillDown at all', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }}`)),
    );
    expect(f).toEqual([]);
  });

  it('rejects an undeclared key inside the block, carrying the schema’s own suggestion', () => {
    const f = validateReactPageProps(drill(`{ maxrows: 10 }`));
    const hit = f.find((x) => x.rule === REACT_CHART_DRILLDOWN_INVALID);
    expect(hit, 'the unknown key must be reported').toBeTruthy();
    expect(hit!.message).toContain('chart drill-down block');
    expect(hit!.message, 'the schema’s suggester reaches the author through the gate').toContain('`maxrows` → `maxRows`');
    expect(hit!.severity).toBe('error');
  });

  it("passes target: 'navigate' — the renderer delivers it since objectui#3382 (#5435)", () => {
    // This assertion was the exact inverse until #5435. #5022 excluded
    // `'navigate'` on a MEASUREMENT — ObjectChart's hand-rolled drawer only
    // branched on `'dialog'` and let `'navigate'` fall through to the Sheet —
    // and objectui#3382 changed that measurement by implementing the arm.
    // The gate parses `ChartDrillDownSchema`, so this case is what proves the
    // widened union actually reaches the author-facing publish gate rather
    // than only the type.
    const f = validateReactPageProps(drill(`{ target: 'navigate' }`));
    expect(f).toEqual([]);
  });

  it('still rejects a target outside the three declared arms — widening is not loosening', () => {
    // The companion to the case above: `'navigate'` became legal because a
    // renderer delivers it, NOT because `target` stopped being checked.
    const f = validateReactPageProps(drill(`{ target: 'sidebar' }`));
    const hit = f.find((x) => x.rule === REACT_CHART_DRILLDOWN_INVALID);
    expect(hit, 'an undeclared target must still be reported').toBeTruthy();
    expect(hit!.message).toContain('drillDown.target');
    expect(hit!.severity).toBe('error');
  });

  it('rejects a key that belongs to another widget, with the reason rather than a rename', () => {
    const f = validateReactPageProps(drill(`{ mode: 'record' }`));
    const hit = f.find((x) => x.rule === REACT_CHART_DRILLDOWN_INVALID);
    expect(hit!.message).toContain('TABLE / PIVOT / METRIC');
  });

  it('rejects the report near-key spelling and names the type difference', () => {
    const f = validateReactPageProps(drill(`{ drilldown: true }`));
    const hit = f.find((x) => x.rule === REACT_CHART_DRILLDOWN_INVALID);
    expect(hit!.message).toContain('ReportSchema.drilldown');
    expect(hit!.message).toContain('BOOLEAN');
  });

  it('rejects a non-object drillDown and shows the two shapes that work', () => {
    const f = validateReactPageProps(drill('true'));
    const hit = f.find((x) => x.rule === REACT_CHART_DRILLDOWN_INVALID);
    expect(hit!.message).toContain('configuration object');
    expect(hit!.hint).toContain('drillDown={{}}');
  });

  it('says nothing about a config it cannot resolve — unresolvable is not wrong (ADR-0072 D1)', () => {
    // A value assembled from React state. `staticValue` collapses the whole
    // object, so the gate must stay silent rather than guess at the keys.
    const f = validateReactPageProps(
      chartPage(
        `function Page(){ const cols=useCols(); return <ObjectChart objectName="invoice" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} drillDown={{ columns: cols, maxrows: 10 }} />; }`,
      ),
    );
    expect(f.filter((x) => x.rule === REACT_CHART_DRILLDOWN_INVALID)).toEqual([]);
  });

  it('checks the drill even on an inline-data chart, which skips every aggregate rule', () => {
    // The drill config is independent of how the chart is bound; the rule runs
    // before the `data` early return for exactly this case.
    const f = validateReactPageProps(
      chartPage(`function Page(){ return <ObjectChart objectName="invoice" data={[]} drillDown={{ maxrows: 10 }} />; }`),
    );
    expect(f.some((x) => x.rule === REACT_CHART_DRILLDOWN_INVALID)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// <ObjectChart aggregate> — the declared shape, PARSED (#5020)
//
// The other half of what #5022 did for `drillDown`. Until this issue the gate
// re-derived `ChartAggregateSchema`: a local `CHART_FUNCTIONS` copy of the
// function vocabulary and a hand-written twin of the count/field refinement,
// each free to drift from the schema, and — since unknown-key handling is a
// property of a PARSE — no unknown-key check at all.
//
// Read the three groups below as one statement, because any one alone would be
// misleading:
//
//   1. VOCABULARY, exhaustively green through the gate, with the enum pinned to
//      the schema's own so the table cannot silently under-cover it. This is
//      what replaces the deleted constant: the vocabulary is no longer restated
//      in the rule, so the test is where "all five functions are accepted" is
//      asserted.
//   2. SEVERITY GRADING (#5020 R2) — every violation the schema, the published
//      react-blocks type and objectui's renderer agree on gates at `error`;
//      an absent `groupBy` is a `warning`. #5583 ruled that the ungrouped
//      single-value chart is NOT a supported shape, so that warning is an
//      un-promoted gate rather than a blessed form; promoting it is its own
//      acceptance surface and its own step.
//   3. THE GAP #5020 PINNED OPEN, CLOSED AT #5583. Both schemas were
//      STRIP-posture, so wiring the parse did not close the unknown-key hole
//      `groupby` walked through. They are `strictObject` now and the two
//      tolerance pins INVERTED — including the harder half, where the
//      rejection reaches the author only because `describeIssue` unpacks the
//      collapsed `invalid_union` (#5014).
// ─────────────────────────────────────────────────────────────────────────

describe('validateReactPageProps — <ObjectChart aggregate> PARSED (#5020)', () => {
  const agg = (literal: string, objectName = 'invoice') =>
    chartPage(chart(`objectName="${objectName}" aggregate={${literal}}`));
  const aggFindings = (literal: string) =>
    validateReactPageProps(agg(literal)).filter((x) => x.rule === REACT_CHART_AGGREGATE_INVALID);

  // The vocabulary UNDER TEST. Restating it *here* is the point — the rule no
  // longer does, and the pin below fails the day the schema's enum and this
  // list disagree, so the table can never quietly cover less than the contract.
  const FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;
  const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;

  it('covers exactly the function vocabulary the schema declares', () => {
    expect([...ChartAggregateFunctionSchema.options]).toEqual([...FUNCTIONS]);
  });

  // Every function against every accepted `groupBy` form: the bare-field-name
  // arm, the structured arm, and the structured arm at each date granularity.
  // `count` is the one function that may omit `field`, so it is exercised both
  // ways; the rest carry one.
  const GREEN: Array<[string, string]> = [];
  for (const fn of FUNCTIONS) {
    const field = fn === 'count' ? '' : `field: 'total', `;
    GREEN.push([`${fn} / bare groupBy`, `{ ${field}function: '${fn}', groupBy: 'status' }`]);
    GREEN.push([`${fn} / structured groupBy`, `{ ${field}function: '${fn}', groupBy: { field: 'closed_at' } }`]);
    for (const g of GRANULARITIES) {
      GREEN.push([
        `${fn} / groupBy bucketed by ${g}`,
        `{ ${field}function: '${fn}', groupBy: { field: 'closed_at', dateGranularity: '${g}' } }`,
      ]);
    }
  }
  GREEN.push(['count WITH an explicit field', `{ field: 'total', function: 'count', groupBy: 'status' }`]);
  GREEN.push([
    'groupBy alias (the projected category column)',
    `{ function: 'count', groupBy: { field: 'closed_at', alias: 'closed_at', dateGranularity: 'month' } }`,
  ]);

  it.each(GREEN)('accepts %s', (_label, literal) => {
    expect(aggFindings(literal)).toEqual([]);
  });

  // ── R2: what gates at `error` ──────────────────────────────────────────

  it('gates a missing function — required in the schema, in the published type and in the renderer', () => {
    // Previously invisible: the hand-rolled check only ran `if (fn)`, so an
    // aggregate with no function at all passed the publish gate silently.
    const hit = aggFindings(`{ field: 'total', groupBy: 'status' }`);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0].severity).toBe('error');
    expect(hit[0].message).toContain('aggregate.function');
    expect(hit[0].message, 'the vocabulary comes from the enum, not from a local list').toContain('"count"');
    expect(hit[0].message, 'and absence is named as absence').toContain('nothing is set there');
  });

  it('gates a function outside the enum and echoes the value back', () => {
    const hit = aggFindings(`{ field: 'total', function: 'median', groupBy: 'status' }`);
    expect(hit[0].severity).toBe('error');
    expect(hit[0].message).toContain('received "median"');
  });

  it('gates a non-string field — a shape the old check silently ignored', () => {
    const hit = aggFindings(`{ field: 42, function: 'sum', groupBy: 'status' }`);
    expect(hit[0].severity).toBe('error');
    expect(hit[0].message).toContain('aggregate.field');
    expect(hit[0].message).toContain('expected string');
  });

  it("gates sum/avg/min/max with no field, in the SCHEMA's own words", () => {
    for (const fn of ['sum', 'avg', 'min', 'max']) {
      const hit = aggFindings(`{ function: '${fn}', groupBy: 'status' }`);
      expect(hit[0].severity).toBe('error');
      expect(hit[0].message).toContain(`aggregate.function "${fn}" needs a "field" to aggregate`);
    }
  });

  it('gates an aggregate that is not an object at all', () => {
    for (const literal of ['true', `'count'`, '[]']) {
      const hit = aggFindings(literal);
      expect(hit.length, `aggregate={${literal}} must be reported`).toBeGreaterThan(0);
      expect(hit[0].severity).toBe('error');
      expect(hit[0].message).toContain('configuration object');
    }
  });

  // ── R2: the one violation that only WARNS ──────────────────────────────

  it('WARNS on an absent groupBy and does not block — a tolerance, not a supported shape (#5583 ruled)', () => {
    // The severity is unchanged; what changed at #5583 is what it MEANS. The
    // ruling was that an ungrouped single-value chart is NOT a supported
    // `<ObjectChart>` shape (`groupBy` stays required; the single-value need is
    // served by the separate `object-metric` block), so this warning is an
    // un-promoted gate rather than a blessed authoring form. Promoting it is a
    // separate acceptance surface — every consumer's pages, not just the example
    // corpus, which carries zero instances — so it is deliberately still a
    // warning and the hint now says which way the question was decided.
    const hit = aggFindings(`{ function: 'count' }`);
    expect(hit.length).toBe(1);
    expect(hit[0].severity).toBe('warning');
    expect(hit[0].message).toContain('aggregate.groupBy is not set');
    expect(hit[0].hint).toContain('5583');
    expect(hit[0].hint, 'the hint must carry the RULING, not an open question').toContain('NOT a supported');
    expect(
      validateReactPageProps(agg(`{ function: 'count' }`)).filter((x) => x.severity === 'error'),
      'nothing about this aggregate may gate the build',
    ).toEqual([]);
  });

  it('still gates the REST of an aggregate whose groupBy is merely absent', () => {
    // The severity split is per issue, not per aggregate: a bad `function` next
    // to an absent `groupBy` gates, and both findings reach the author.
    const hit = aggFindings(`{ function: 'median' }`);
    expect(hit.filter((x) => x.severity === 'error').length, 'the function still gates').toBe(1);
    expect(hit.filter((x) => x.severity === 'warning').length, 'the absence still warns').toBe(1);
  });

  it('gates a groupBy that is PRESENT and wrong — absence is the only tolerance', () => {
    const hit = aggFindings(`{ function: 'count', groupBy: 42 }`);
    expect(hit[0].severity).toBe('error');
    expect(hit[0].message).toContain('aggregate.groupBy');
    expect(hit[0].message).toContain('received 42');
  });

  // ── The zod-4 union collapse, unpacked ─────────────────────────────────

  it("unpacks the union's arms so an author gets named messages, not just 'Invalid input'", () => {
    // `groupBy` is `ChartGroupBySchema`, a union — and zod 4 reports a failed
    // union as ONE `invalid_union` whose own message is the bare string
    // "Invalid input", with the arm messages reachable only through
    // `issue.errors`. Passing that through verbatim would say nothing an author
    // can act on, which is the class of diagnostic this gate exists to replace.
    const hit = aggFindings(`{ function: 'count', groupBy: { dateGranularity: 'day' } }`);
    expect(hit[0].severity).toBe('error');
    expect(hit[0].message).toContain('no accepted form matched');
    expect(hit[0].message, "the structured arm's own complaint").toContain('field');
    expect(hit[0].message, 'the bare-field-name arm reports too').toContain('expected string');
    expect(hit[0].message, 'the collapsed message must not be the whole report').not.toBe(
      'aggregate.groupBy: Invalid input',
    );
  });

  it('unpacks a nested enum rejection with its vocabulary intact', () => {
    const hit = aggFindings(`{ function: 'count', groupBy: { field: 'closed_at', dateGranularity: 'fortnight' } }`);
    expect(hit[0].severity).toBe('error');
    expect(hit[0].message).toContain('dateGranularity');
    expect(hit[0].message).toContain('"quarter"');
  });

  // ── The gap #5020 pinned OPEN, and #5583 closed ─────────────────────────
  //
  // ⚠️ These two are the same assertions #5020 wrote, INVERTED. They were
  // written as `.toEqual([])` / `.not.toContain('Unrecognized key')` so that a
  // gate wired over a STRIP-posture schema could not be mistaken for a closed
  // door (#4583); the spec-side tightening landed at #5583 and they now assert
  // the rejection instead. Kept as a pair rather than replaced, because the
  // before/after is what makes the deliberate two-step order legible.

  it('REJECTS an unknown key inside aggregate — the schema names it (#5583, was a silent strip)', () => {
    const hit = aggFindings(`{ function: 'count', groupBy: 'status', groupby: 'status' }`);
    expect(hit.length, 'the stripped key is now a finding').toBe(1);
    expect(hit[0].severity).toBe('error');
    // The three things the author gets, all of them from `packages/spec` — this
    // rule restates none of them.
    expect(hit[0].message).toContain('Unrecognized key');
    expect(hit[0].message, "the schema's own surface name").toContain('this chart aggregate');
    expect(hit[0].message, 'the rename').toContain('`groupby` → `groupBy`');

    // The parse still runs on everything else, and the two findings coexist —
    // the #5046 trap in reverse: a green "it rejects" proves nothing unless the
    // rule is still reading the rest of the aggregate in the same pass.
    const alsoBad = aggFindings(`{ function: 'kount', groupBy: 'status', groupby: 'status' }`);
    expect(alsoBad.length, 'both the unknown key and the bad function are reported').toBe(2);
    expect(
      alsoBad.some((f) => f.message.includes('aggregate.function') && f.message.includes('expected one of')),
      'the function rejection still comes from the schema',
    ).toBe(true);
    expect(alsoBad.some((f) => f.message.includes('Unrecognized key')), 'and the unknown key too').toBe(true);
  });

  it('REJECTS an unknown key inside a structured groupBy — through the UNION collapse (#5583)', () => {
    // The same hole one level deeper, and the harder half: `groupBy` is a
    // UNION, so the arm's `unrecognized_keys` never reaches `error.issues` —
    // zod 4 reports one `invalid_union` whose own message is the bare string
    // "Invalid input" (#5014). What carries the named rejection to the author is
    // `describeIssue`'s arm unpacking in `zod-issue-format.ts`. This assertion
    // is therefore an END-TO-END pin on that path, not a restatement of the
    // schema's: delete the unpacking and it goes red while the spec's own tests
    // stay green.
    const hit = aggFindings(`{ function: 'count', groupBy: { field: 'closed_at', dateGranularty: 'month' } }`);
    expect(hit.length).toBe(1);
    expect(hit[0].severity).toBe('error');
    expect(hit[0].message, 'the collapsed union was unpacked').toContain('no accepted form matched');
    expect(hit[0].message, "the strict arm's surface").toContain('this chart groupBy');
    expect(hit[0].message, 'and its rename').toContain('`dateGranularty` → `dateGranularity`');
    expect(hit[0].message, 'the bare collapsed message must not be the whole report').not.toBe(
      'aggregate.groupBy: Invalid input',
    );

    // Control in the same run: a structured groupBy with no unknown key still
    // parses clean, so this is a statement about the key and not about the arm.
    expect(
      aggFindings(`{ function: 'count', groupBy: { field: 'closed_at', dateGranularity: 'month' } }`),
    ).toEqual([]);
  });

  // ── Unresolvable is not wrong (ADR-0072 D1) ────────────────────────────

  it('says nothing about an aggregate assembled from variables', () => {
    const f = validateReactPageProps(
      chartPage(`function Page(){ const g = useG(); return <ObjectChart objectName="invoice" aggregate={{ function: 'count', groupBy: g }} />; }`),
    );
    expect(f.filter((x) => x.rule === REACT_CHART_AGGREGATE_INVALID)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unprovisioned injected anchors on the react surface (#8340)
// ─────────────────────────────────────────────────────────────────────────

describe('validateReactPageProps — unprovisioned injected anchors (#8340)', () => {
  /**
   * An ADR-0015 `external` object: the remote database owns the table, so the
   * platform's injected anchors (`owner_id`, the audit family, …) are
   * registered and never provisioned. `extra` breaks each half of the
   * derivation independently.
   */
  const extCustomer = (extra: Record<string, unknown> = {}) => ({
    name: 'ext_customer',
    external: { remoteName: 'customers' },
    fields: [{ name: 'email' }, { name: 'tier' }],
    ...extra,
  });
  const extPage = (source: string, objects: unknown[] = [extCustomer()]) => ({
    objects,
    pages: [{ name: 'p', kind: 'react', source }],
  });

  it('warns on an aggregate.groupBy over an anchor, and the existence rule stays silent', () => {
    const f = validateReactPageProps(
      extPage(chart(`objectName="ext_customer" aggregate={{ field: 'email', function: 'count', groupBy: 'owner_id' }}`)),
    );
    expect(f.filter((x) => x.rule === REACT_CHART_FIELD_UNKNOWN)).toHaveLength(0);
    const warned = f.filter((x) => x.rule === REACT_CHART_FIELD_UNPROVISIONED);
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].message).toContain('aggregate.groupBy "owner_id"');
    expect(warned[0].message).toContain('external object (ADR-0015)');
    expect(warned[0].message).toContain('one empty bucket');
    expect(warned[0].hint).toContain('columnMap');
  });

  it('is silent on the local twin — platform storage is real (mutation: drop `external`)', () => {
    const f = validateReactPageProps(
      extPage(
        chart(`objectName="ext_customer" aggregate={{ field: 'email', function: 'count', groupBy: 'owner_id' }}`),
        [extCustomer({ external: undefined })],
      ),
    );
    expect(f.filter((x) => x.rule === REACT_CHART_FIELD_UNPROVISIONED)).toHaveLength(0);
  });

  it('is silent when the author DECLARES the column (#7859)', () => {
    const f = validateReactPageProps(
      extPage(
        chart(`objectName="ext_customer" aggregate={{ field: 'email', function: 'count', groupBy: 'owner_id' }}`),
        [extCustomer({ fields: [{ name: 'email' }, { name: 'owner_id' }] })],
      ),
    );
    expect(f.filter((x) => x.rule === REACT_CHART_FIELD_UNPROVISIONED)).toHaveLength(0);
  });

  it('reaches the FILTER position through the shared core — the #8340 headline case', () => {
    // `<ListView filters>` is the react surface's filter position: the ref goes
    // to a QUERY, so the message names the silent-zero degradation.
    const f = validateReactPageProps(
      extPage(`function Page(){ return <ListView objectName="ext_customer" filters={['owner_id', '=', 'x']} />; }`),
    );
    expect(f.filter((x) => x.rule === PAGE_FIELD_UNKNOWN)).toHaveLength(0);
    const warned = f.filter((x) => x.rule === PAGE_FIELD_UNPROVISIONED);
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].message).toContain('constant-false');
    expect(warned[0].path).toBe('pages[0].source › filters[0]');
  });

  it('is silent on a declared field in the same filter position', () => {
    const f = validateReactPageProps(
      extPage(`function Page(){ return <ListView objectName="ext_customer" filters={['tier', '=', 'gold']} />; }`),
    );
    expect(f).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // [#8943] The four `checkBlockFieldProps` calls that were threaded by
  // CONVENTION ONLY.
  //
  // `checkFieldRefs` takes the anchor index as an OPTIONAL trailing
  // parameter, so a call site that stops passing it keeps compiling and
  // silently downgrades to the pre-#8340 behaviour: existence still
  // answered, provenance never asked. Nothing else can see that happen —
  // the parameter being optional means no type error, and the local
  // `unprovisionedAnchors` binding stays READ by the sibling calls in the
  // same function, so there is no TS6133 either. No CI gate reads call
  // sites at all (#8664).
  //
  // #8943 measured all six threading sites by dropping the argument at each
  // in turn. The two module seams were already pinned — `validatePageFieldBindings`
  // and the `queried` bucket, both covered by the FILTER-position test above.
  // The four below stayed GREEN across the whole packages/lint suite with the
  // index dropped. Each test here was then written ablation-first and observed
  // RED under its own site's ablation, which is precisely why it exists.
  //
  // The branches are disjoint by tag and prop, so each test names exactly one
  // site: `own` refs reach `<ListView columns>`; the subform pair needs
  // `<ObjectForm subforms>`; the COMPONENT_FIELD_SPECS table is reachable
  // only through `<Block type>`, since no react tag's own schemaType
  // (`list-view`, `object-form`, `object-chart`) is a key in it.
  // ───────────────────────────────────────────────────────────────────────

  /** A LOCAL object — platform storage is real, so it registers no unprovisioned anchor. */
  const localOrder = { name: 'crm_order', fields: [{ name: 'code' }] };

  it('[#8943] R1 — PINS the `own` display-ref call (the `skipped` bucket of REACT_FIELD_SPECS)', () => {
    // `<ListView columns>` is a DISPLAY binding, not a query: the consequence
    // clause is the blank-column one, not the constant-false one.
    const f = validateReactPageProps(
      extPage(`function Page(){ return <ListView objectName="ext_customer" columns={['owner_id']} />; }`),
    );
    expect(f.filter((x) => x.rule === PAGE_FIELD_UNKNOWN)).toHaveLength(0);
    const warned = f.filter((x) => x.rule === PAGE_FIELD_UNPROVISIONED);
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].path).toBe('pages[0].source › columns[0]');
    expect(warned[0].message).toContain('external object (ADR-0015)');
    expect(warned[0].message).toContain('blank, on every record');
  });

  it('[#8943] R3 — PINS the ObjectForm subform CHILD refs (resolved against `childObject`)', () => {
    // The child batch resolves against the subform's own object, so the
    // external one is the CHILD here and the form's object is local.
    const f = validateReactPageProps(
      extPage(
        `function Page(){ return <ObjectForm objectName="crm_order" subforms={[{ childObject: 'ext_customer', columns: ['owner_id'] }]} />; }`,
        [extCustomer(), localOrder],
      ),
    );
    expect(f.filter((x) => x.rule === PAGE_FIELD_UNKNOWN)).toHaveLength(0);
    const warned = f.filter((x) => x.rule === PAGE_FIELD_UNPROVISIONED);
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].path).toBe('pages[0].source › subforms[0].columns[0]');
    expect(warned[0].message).toContain('"ext_customer"');
    expect(warned[0].message).toContain('blank, on every record');
  });

  it('[#8943] R4 — PINS the subform `totalField` rollup (resolved against the FORM object)', () => {
    // The exception inside the exception: `totalField` names the PARENT
    // object's field the child sum rolls up into, so the external object is
    // the form's own and the child is local.
    const f = validateReactPageProps(
      extPage(
        `function Page(){ return <ObjectForm objectName="ext_customer" subforms={[{ childObject: 'crm_order', columns: ['code'], totalField: 'owner_id' }]} />; }`,
        [extCustomer(), localOrder],
      ),
    );
    expect(f.filter((x) => x.rule === PAGE_FIELD_UNKNOWN)).toHaveLength(0);
    const warned = f.filter((x) => x.rule === PAGE_FIELD_UNPROVISIONED);
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].path).toBe('pages[0].source › subforms[0].totalField');
    expect(warned[0].message).toContain('"ext_customer"');
  });

  it('[#8943] R5 — PINS the COMPONENT_FIELD_SPECS path reached by `<Block type>`', () => {
    // The shared table `validate-page-field-bindings` walks; on this surface
    // it is reachable only by the type the author spells out, which is what
    // makes the escape hatch checked rather than a hole.
    const f = validateReactPageProps(
      extPage(`function Page(){ return <Block type="element:form" objectName="ext_customer" fields={['owner_id']} />; }`),
    );
    expect(f.filter((x) => x.rule === PAGE_FIELD_UNKNOWN)).toHaveLength(0);
    const warned = f.filter((x) => x.rule === PAGE_FIELD_UNPROVISIONED);
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].where).toBe('page "p" › <Block>');
    expect(warned[0].path).toBe('pages[0].source › fields[0]');
    expect(warned[0].message).toContain('external object (ADR-0015)');
  });
});

// ── [#10653] The source that could not be READ ───────────────────────────────
//
// The parse here used to sit in `try { … } catch { continue; }`, commented "the
// syntax gate reports unparseable sources". Two separate things were wrong with
// that, and the first one hid the second:
//
//   1. `ts.createSourceFile` cannot throw, so the catch never ran. The live path
//      was the unread `parseDiagnostics` — error recovery hands back a partial
//      tree, this gate walks it, finds no `<ObjectForm>` in the part that was
//      lost, and returns clean.
//   2. The syntax gate parses with a DIFFERENT parser. `validate-jsx-pages.ts`
//      does not lint `kind:'react'` at all; the cover is `validate-react-
//      pages.ts`, which uses Sucrase. Measured on 2026-08-21, the two acceptance
//      sets differ in both directions (see `the syntax gate is a different
//      parser` below), so the syntax gate's silence was never evidence that THIS
//      gate could read the source.
describe('an unparseable react source is reported, not scored clean (#10653)', () => {
  // The defect (`<ObjectForm>` with no objectName) is real in both halves; the
  // only difference is the `/*` that swallows it.
  const wrecked = 'function Page(){\n  /* TODO\n  return <ObjectForm mode="edit" />;\n}\n';
  const repaired = 'function Page(){\n  return <ObjectForm mode="edit" />;\n}\n';

  it('POSITIVE CONTROL — the repaired source is flagged, so the wreck had something to lose', () => {
    const f = validateReactPageProps(page(repaired));
    expect(f.some((x) => x.rule === 'react-prop-missing-required')).toBe(true);
    expect(f.some((x) => x.rule === REACT_PAGE_SOURCE_UNPARSEABLE)).toBe(false);
  });

  it('the wrecked source loses that finding — the harm, reproduced', () => {
    // This is the measurement the card turns on: not "it throws and we skip",
    // but "it parses, the finding vanishes, and the verdict reads clean".
    const f = validateReactPageProps(page(wrecked));
    expect(f.some((x) => x.rule === 'react-prop-missing-required')).toBe(false);
  });

  it('…and says so instead of returning clean', () => {
    const f = validateReactPageProps(page(wrecked));
    const parseFindings = f.filter((x) => x.rule === REACT_PAGE_SOURCE_UNPARSEABLE);
    expect(parseFindings).toHaveLength(1);
    expect(parseFindings[0].severity).toBe('warning');
    expect(parseFindings[0].where).toBe('page "p"');
    expect(parseFindings[0].path).toBe('pages[0].source');
    expect(parseFindings[0].message).toContain('did not parse');
    expect(parseFindings[0].message).toMatch(/line \d+, column \d+/);
  });

  it('is ADDITIVE — a recovered tree keeps every finding it yields today', () => {
    // `0755` is a parse diagnostic whose recovery is local: the JSX below it
    // still reads. The parse finding is added; the prop finding is NOT traded
    // away for it. (A fix that skipped the walk on failure would silently drop
    // this one.)
    const f = validateReactPageProps(page('const n = 0755;\nfunction Page(){ return <ObjectForm mode="edit" />; }'));
    expect(f.some((x) => x.rule === REACT_PAGE_SOURCE_UNPARSEABLE)).toBe(true);
    expect(f.some((x) => x.rule === 'react-prop-missing-required')).toBe(true);
  });

  it('the syntax gate is a DIFFERENT parser — measured, not assumed', () => {
    // The card recorded this divergence as unmeasured. Measured here: Sucrase
    // accepts `0755`, TypeScript reports a parse diagnostic on it. So a react
    // page can pass the syntax gate and still be unreadable to this one — which
    // is the case where the silence this rule replaced was total.
    const octal = 'const n = 0755;\nfunction Page(){ return <ObjectForm objectName="a" />; }';
    expect(validateReactPages(page(octal)), 'sucrase accepts it').toEqual([]);
    expect(
      validateReactPageProps(page(octal)).some((x) => x.rule === REACT_PAGE_SOURCE_UNPARSEABLE),
      'typescript does not',
    ).toBe(true);
  });

  it('FALSE-POSITIVE CONTROL — sources that parse never gain the finding', () => {
    // Including the TS-only spellings a react page may legitimately carry: the
    // parse is ScriptKind.TSX, and a generic arrow or a type annotation must not
    // read as a wreck.
    const parseable = [
      'function Page(){ return <ObjectForm objectName="account" mode="edit" />; }',
      'const Page = (): JSX.Element => <ObjectForm objectName="a" />;\nexport default Page;',
      'const id = <T,>(x: T): T => x;\nfunction Page(){ return <ObjectForm objectName="a" />; }',
      'interface Props { a: number }\nexport default function Page(p: Props){ return <ObjectForm objectName="a" />; }',
      'function Page(){ return <><ObjectForm objectName="a" /><ListView objectName="a" /></>; }',
      'function Page(){ return <ObjectForm objectName="a" {...rest} />; }',
    ];
    for (const source of parseable) {
      const rules = validateReactPageProps(page(source)).map((x) => x.rule);
      expect(rules, `parseable source gained a parse finding:\n${source}`).not.toContain(
        REACT_PAGE_SOURCE_UNPARSEABLE,
      );
    }
  });

  it('an empty source is skipped without a parse claim', () => {
    expect(validateReactPageProps(page(''))).toEqual([]);
    expect(validateReactPageProps(page('   \n '))).toEqual([]);
  });
});
