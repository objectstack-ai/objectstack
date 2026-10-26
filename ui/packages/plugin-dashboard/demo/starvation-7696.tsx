/**
 * objectui#7696 — a CONSTRUCTED BOOT for the five analytics starvation paths.
 *
 *   pnpm --dir packages/plugin-dashboard exec vite demo --port 5197 --strictPort
 *   open http://localhost:5197/starvation-7696.html?path=baseline
 *
 * `?path=` selects the starvation: `baseline` · `1` · `2` · `3a` · `3b` · `4` · `5`.
 *
 * ## What this adds over the jsdom pin
 *
 * `DatasetWidget.starvationFingerprints-7696.test.tsx` reads the categories the
 * widget hands the chart renderer, because jsdom lays out no SVG and paints no
 * legend — so the step from "these are the categories" to "this is what the
 * legend SAYS" is an argument there, not a reading. This boot closes exactly
 * that step: the real `@object-ui/plugin-charts` renderer is mounted in a real
 * browser, so the legend text below is painted by the chart library from the
 * same categories, and can be read off the DOM.
 *
 * Everything else is deliberately the SAME construction as the pin — same
 * fixture, same two channels, same four fingerprint axes — so the two readings
 * are comparable rather than merely consistent.
 *
 * ⛔ No production code is changed by this file. It mounts the shipped
 * components and starves their inputs.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import '@object-ui/components/style.css';
// Registers the REAL `chart` component — the renderer that paints the legend.
import '@object-ui/plugin-charts';
import { I18nProvider, useSafeFieldLabel } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import { SelectCellRenderer } from '@object-ui/fields';
import { DatasetWidget } from '../src/DatasetWidget';

/* ───────────────────────── the card's fixture, verbatim ──────────────────── */

const FORM_OPTIONS = [
  { value: 'one_off', label: 'One-off' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'standing', label: 'Standing' },
];

const DUTY = { name: 'duly_duty', fields: { form: { type: 'select', options: FORM_OPTIONS } } };
const DUTY_NO_OPTIONS = { name: 'duly_duty', fields: { form: { type: 'select' } } };

/** `duly.fields` is what makes the namespace DISCOVERABLE (`getAppNamespaces`). */
const ZH_BUNDLE = {
  zh: {
    duly: {
      fields: { duly_duty: { form: '形式' } },
      fieldOptions: {
        duly_duty: { form: { one_off: '一次性', recurring: '周期性', standing: '常设' } },
      },
    },
  },
};

/** The SAME translations, with the only discoverable key removed — path (4). */
const ZH_BUNDLE_UNDISCOVERABLE = {
  zh: {
    duly: {
      fieldOptions: {
        duly_duty: { form: { one_off: '一次性', recurring: '周期性', standing: '常设' } },
      },
    },
  },
};

const PIE_WIDGET = {
  type: 'pie',
  dataset: 'duly_duty_register',
  dimensions: ['form'],
  values: ['duty_count'],
  chartConfig: { showLegend: true },
};

/** `rows[].form` server-resolved to the authored ENGLISH label (ADR-0021). */
const datasetResult = (omitObject: boolean) => ({
  rows: [
    { form: 'One-off', duty_count: 5 },
    { form: 'Recurring', duty_count: 3 },
    { form: 'Standing', duty_count: 2 },
  ],
  fields: [
    { name: 'form', type: 'string', label: '形式' },
    { name: 'duty_count', type: 'number', label: '数量' },
  ],
  ...(omitObject ? {} : { object: 'duly_duty' }),
  dimensionFields: { form: 'form' },
  drillRawRows: [{ form: 'one_off' }, { form: 'recurring' }, { form: 'standing' }],
});

/* ─────────────────────────────── the paths ───────────────────────────────── */

interface PathSpec {
  label: string;
  /** The document the CHART's channel serves; `null` serves 401 — path (2). */
  chartDoc: unknown | null;
  /** The document the LIST's channel serves. */
  listDoc: unknown;
  /** Options declared on the list's COLUMN, which the grid prefers. */
  listColumnOptions?: typeof FORM_OPTIONS;
  omitObject: boolean;
  resources: Record<string, unknown>;
  provider: boolean;
}

const PATHS: Record<string, PathSpec> = {
  baseline: {
    label: 'BASELINE — healthy install',
    chartDoc: DUTY, listDoc: DUTY, omitObject: false, resources: ZH_BUNDLE, provider: true,
  },
  '1': {
    label: 'PATH (1) — the analytics response omits `object`',
    chartDoc: DUTY, listDoc: DUTY, omitObject: true, resources: ZH_BUNDLE, provider: true,
  },
  '2': {
    label: 'PATH (2) — the chart’s metadata read is unauthorized (401)',
    chartDoc: null, listDoc: DUTY, omitObject: false, resources: ZH_BUNDLE, provider: true,
  },
  '3a': {
    label: 'PATH (3a) — no inline options; the list reads the object document',
    chartDoc: DUTY_NO_OPTIONS, listDoc: DUTY_NO_OPTIONS, omitObject: false,
    resources: ZH_BUNDLE, provider: true,
  },
  '3b': {
    label: 'PATH (3b) — no inline options, but the list COLUMN declares its own',
    chartDoc: DUTY_NO_OPTIONS, listDoc: DUTY_NO_OPTIONS, listColumnOptions: FORM_OPTIONS,
    omitObject: false, resources: ZH_BUNDLE, provider: true,
  },
  '4': {
    label: 'CONTROL (4) — the app namespace is not discoverable',
    chartDoc: DUTY, listDoc: DUTY, omitObject: false,
    resources: ZH_BUNDLE_UNDISCOVERABLE, provider: true,
  },
  '5': {
    label: 'CONTROL (5) — no I18nProvider in scope',
    chartDoc: DUTY, listDoc: DUTY, omitObject: false, resources: ZH_BUNDLE, provider: false,
  },
};

const selected = new URLSearchParams(window.location.search).get('path') ?? 'baseline';
const spec = PATHS[selected] ?? PATHS.baseline;

/* ───────────────────────────── the two channels ──────────────────────────── */

/**
 * The CHART's channel: the global `fetch`, which is what the analytics net
 * falls back to when the host installed no `apiFetch` (objectui#4121). Patched
 * for `/api/v1/meta/object/*` only; everything else passes through to Vite.
 */
const metaReads: string[] = [];
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
  const m = /\/api\/v1\/meta\/object\/(.+)$/.exec(url);
  if (!m) return realFetch(input as RequestInfo, init);
  if (spec.chartDoc === null) {
    metaReads.push(`${decodeURIComponent(m[1])} -> 401`);
    return new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } });
  }
  metaReads.push(`${decodeURIComponent(m[1])} -> 200`);
  return new Response(JSON.stringify({ item: spec.chartDoc }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof window.fetch;

/** The LIST's channel: the DataSource's own authenticated metadata read. */
const dataSource = {
  queryDataset: async () => datasetResult(spec.omitObject),
  getObjectSchema: async () => spec.listDoc,
};

/* ──────────────────────────── the page under test ────────────────────────── */

const LIST_ROW_VALUE = 'recurring';

/** The neighbouring list view's cell: `translateOptions` then the cell renderer. */
function NeighbouringListCell() {
  const { translateOptions } = useSafeFieldLabel();
  const objectOptions = (spec.listDoc as any)?.fields?.form?.options;
  const rawOptions = spec.listColumnOptions || objectOptions;
  const options = Array.isArray(rawOptions) && rawOptions.length > 0
    ? translateOptions('duly_duty', 'form', rawOptions as any)
    : [];
  return (
    <div data-testid="list-cell">
      <SelectCellRenderer value={LIST_ROW_VALUE} field={{ type: 'select', options } as any} />
    </div>
  );
}

/** An app-bundle-scoped string — the channel the widget title resolves through. */
function BundleChromeProbe() {
  const { fieldLabel } = useSafeFieldLabel();
  return <span data-testid="bundle-chrome">{fieldLabel('duly_duty', 'form', 'Form')}</span>;
}

function MetaReadTrace() {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, []);
  return <span data-testid="meta-reads">{metaReads.length === 0 ? '(none)' : metaReads.join(', ')}</span>;
}

function Page() {
  const page = (
    // No `apiFetch` on the provider — the host of objectui#4121's report had
    // none either, which is why the net fell back to the global `fetch`.
    <SchemaRendererProvider dataSource={dataSource as any}>
      <div style={{ padding: 16, display: 'grid', gap: 16 }}>
        <h1 style={{ fontSize: 16, margin: 0 }} data-testid="path-label">{spec.label}</h1>
        <section style={{ height: 320, border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
            Dashboard chart — 职责登记 / duly_duty_register
          </div>
          <div style={{ height: 260 }} data-testid="chart-host">
            <DatasetWidget widget={PIE_WIDGET as any} dataSource={dataSource as any} />
          </div>
        </section>
        <section style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
            Neighbouring list view — the `form` cell of a `recurring` row
          </div>
          <NeighbouringListCell />
        </section>
        <section style={{ fontSize: 12, display: 'grid', gap: 4 }}>
          <div>app-bundle chrome: <BundleChromeProbe /></div>
          <div>chart metadata channel: <MetaReadTrace /></div>
        </section>
      </div>
    </SchemaRendererProvider>
  );
  return spec.provider ? (
    <I18nProvider
      config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: spec.resources as any }}
    >
      {page}
    </I18nProvider>
  ) : (
    page
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
