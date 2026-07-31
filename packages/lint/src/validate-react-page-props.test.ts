// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import {
  validateReactPageProps,
  REACT_CHART_FIELD_UNKNOWN,
  REACT_CHART_AGGREGATE_INVALID,
  REACT_CHART_AXIS_UNKNOWN,
  type ReactPropFinding as PropFinding,
} from './validate-react-page-props.js';
import { SEARCHABLE_FIELD_UNKNOWN } from './validate-searchable-fields.js';
import { PAGE_FIELD_UNKNOWN } from './validate-page-field-bindings.js';

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
    expect(f.some((x) => x.rule === REACT_CHART_AGGREGATE_INVALID && /median/.test(x.message))).toBe(true);
  });

  it('flags a non-count function with nothing to aggregate', () => {
    const f = validateReactPageProps(
      chartPage(chart(`objectName="invoice" aggregate={{ function: 'sum', groupBy: 'status' }}`)),
    );
    expect(f.some((x) => x.rule === REACT_CHART_AGGREGATE_INVALID && /no "field"/.test(x.message))).toBe(true);
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
      listPage(list(`objectName="crm_account" searchableFields={['name', 'created_at', 'owner_id']}`)),
    );
    expect(f).toEqual([]);
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

describe('validateReactPageProps — record:* blocks share the metadata table (#4340)', () => {
  it('flags <RecordHighlights fields> against its object', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(jsx('RecordHighlights', `objectName="crm_account" recordId={1} fields={['name', 'nope']}`)),
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe('pages[0].source › fields[1]');
  });

  it('flags <RecordDetails fields/hideFields> and its authored sections', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(
          jsx('RecordDetails', `objectName="crm_account" fields={['nope']} hideFields={['gone']}`),
        ),
      ),
    );
    expect(f.map((x) => x.path)).toEqual([
      'pages[0].source › fields[0]',
      'pages[0].source › hideFields[0]',
    ]);
  });

  it('leaves <RecordDetails sections> alone when it is the declared string[] of section IDs', () => {
    const f = validateReactPageProps(
      propsPage(jsx('RecordDetails', `objectName="crm_account" layout="custom" sections={['overview', 'billing']}`)),
    );
    expect(f).toEqual([]);
  });

  it('flags <RecordPath statusField>', () => {
    const f = unknownFields(
      validateReactPageProps(propsPage(jsx('RecordPath', `objectName="crm_account" statusField="nope"`))),
    );
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe('pages[0].source › statusField');
  });
});

describe('validateReactPageProps — <RecordRelatedList> binds the CHILD object (#4340)', () => {
  const related = (attrs: string) => jsx('RecordRelatedList', attrs);

  it('resolves columns/sort/relationshipField against the RELATED object', () => {
    const f = validateReactPageProps(
      propsPage(
        related(
          `objectName="crm_invoice" recordId={1} relationshipField="account_id" columns={['name', 'total']}`,
        ),
      ),
    );
    expect(f).toEqual([]);
  });

  it('flags the parent-object mix-up the old contract gloss invited', () => {
    // The exact shape #4340 found live: the author passed the PARENT object and
    // named the child's columns + the child's own FK. Neither `total` nor
    // `account_id` is on the account, so both positions report.
    const f = unknownFields(
      validateReactPageProps(
        propsPage(
          related(`objectName="crm_account" recordId={1} relationshipField="account_id" columns={['name', 'total']}`),
        ),
      ),
    );
    expect(f.map((x) => x.path)).toEqual([
      'pages[0].source › columns[1]',
      'pages[0].source › relationshipField',
    ]);
    expect(f[0].message).toContain('"total"');
    expect(f[0].message).toContain('crm_account');
  });

  it('says nothing about relationshipValueField — the parent object is unbound here', () => {
    const f = validateReactPageProps(
      propsPage(
        related(`objectName="crm_invoice" recordId={1} relationshipField="account_id" relationshipValueField="nope"`),
      ),
    );
    expect(f).toEqual([]);
  });

  it('resolves the Add picker against its OWN object', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(
          related(
            `objectName="crm_invoice" recordId={1} relationshipField="account_id" ` +
              `add={{ picker: { object: 'crm_account', labelField: 'nope' }, linkField: 'total' }}`,
          ),
        ),
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe('pages[0].source › add.picker.labelField');
  });
});

describe('validateReactPageProps — <Block> escape hatch (#4340)', () => {
  it('checks the props bag by the registered type the author names', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(jsx('Block', `type="record:highlights" objectName="crm_account" fields={['nope']}`)),
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].where).toBe('page "p" › <Block>');
    expect(f[0].path).toBe('pages[0].source › fields[0]');
  });

  it('reaches the related-list branch through <Block> too', () => {
    const f = unknownFields(
      validateReactPageProps(
        propsPage(jsx('Block', `type="record:related_list" objectName="crm_account" columns={['total']}`)),
      ),
    );
    expect(f).toHaveLength(1);
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
