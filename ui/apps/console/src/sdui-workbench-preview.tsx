/* Verifies the kind:'react' tier composing the REAL data components
 * (<ListView> + <ObjectForm>) with React state — a master/detail workbench,
 * the exact pattern of examples/app-showcase crm-workbench.page.ts. Rendered
 * through the real PageRenderer; a tiny in-memory adapter stands in for the
 * backend so the real plugins mount and the interaction is genuinely exercised.
 *
 * ADR-0080 EXCEPTION — Tailwind in page source
 * The page source below authors Tailwind classNames. The rule forbids that in
 * real page metadata: `source` is RUNTIME metadata, the console's Tailwind is
 * compiled at BUILD time by scanning the console's own `src` (`@source
 * '../src/**'` in index.css) with no safelist, so a utility class authored in a
 * real page produces no CSS and no error anywhere. `os validate` reports it as
 * `page-source-className-tailwind` (ADR-0065; ADR-0080's 2026-06-30 amendment;
 * `content/docs/guide/react-pages.md` §Styling).
 *
 * It renders fully styled HERE only because this harness file is itself inside
 * the scanned `src` — precisely the "works only by coincidence" failure mode
 * ADR-0065 names. This file is a renderer-PLUMBING preview (do the real
 * <ListView>/<ObjectForm> blocks mount and interact inside an executed react
 * page), not an authoring example: DO NOT copy its source string into a page.
 * The authoring example is `sdui-tiers-preview.tsx`, whose sources carry no
 * className at all and style with each tier's real primitive.
 *
 * `__tests__/sdui-preview-page-source-styling.test.ts` pins this exception:
 * the note cannot be dropped while the classNames stand, and a NEW harness
 * cannot inherit the exception unnoticed. */
import './index.css';
import '@object-ui/components';
import '@object-ui/plugin-grid';
import '@object-ui/plugin-view';
import '@object-ui/plugin-list';
import '@object-ui/plugin-form';
import '@object-ui/plugin-detail';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SchemaRenderer, SchemaRendererProvider, AdapterCtx } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// NOTE: we do NOT call enableCapability here — `react-pages` is ON by default.
// `?disable=1` simulates a server that set OS_PAGE_REACT=off (the runtime would
// inject this global); the page then renders the "disabled" notice.
if (new URLSearchParams(location.search).has('disable')) {
  (window as unknown as { __OBJECTUI_CAPABILITIES_DISABLED__?: string[] }).__OBJECTUI_CAPABILITIES_DISABLED__ = ['react-pages'];
}

// ---- in-memory adapter (just enough for ListView + ObjectForm) ----
const store: any[] = [
  { id: '1', name: 'Apollo Migration', status: 'active', health: 'green', budget: 120000, owner: 'Dana Lee' },
  { id: '2', name: 'Billing Revamp', status: 'planned', health: 'yellow', budget: 80000, owner: 'Sam Ortiz' },
  { id: '3', name: 'Mobile App v2', status: 'active', health: 'red', budget: 210000, owner: 'Priya N.' },
  { id: '4', name: 'Data Warehouse', status: 'on_hold', health: 'yellow', budget: 64000, owner: 'Chen Wu' },
];
let nextId = 5;
const projectSchema = {
  name: 'showcase_project',
  label: 'Project',
  fields: {
    name: { type: 'text', label: 'Project Name', required: true },
    status: { type: 'select', label: 'Status', options: [
      { label: 'Planned', value: 'planned' }, { label: 'Active', value: 'active' },
      { label: 'On Hold', value: 'on_hold' }, { label: 'Completed', value: 'completed' } ] },
    health: { type: 'select', label: 'Health', options: [
      { label: 'Green', value: 'green' }, { label: 'Yellow', value: 'yellow' }, { label: 'Red', value: 'red' } ] },
    budget: { type: 'currency', label: 'Budget' },
    owner: { type: 'text', label: 'Owner' },
  },
};
const adapter: any = {
  find: async () => store.slice(),
  findOne: async (_o: string, id: any) => store.find((r) => String(r.id) === String(id)) || null,
  create: async (_o: string, data: any) => { const rec = { id: String(nextId++), ...data }; store.push(rec); return rec; },
  update: async (_o: string, id: any, data: any) => {
    const i = store.findIndex((r) => String(r.id) === String(id)); if (i >= 0) store[i] = { ...store[i], ...data }; return store[i];
  },
  getObjectSchema: async () => projectSchema,
};

const source = `
function Page() {
  const adapter = useAdapter();
  const [selected, setSelected] = React.useState(null);
  const [mode, setMode] = React.useState('edit');
  const [reloadKey, setReloadKey] = React.useState(0);
  const [stats, setStats] = React.useState({ total: 0, active: 0 });
  const refreshStats = React.useCallback(async () => {
    if (!adapter) return;
    const all = await adapter.find('showcase_project', { $top: 200 });
    const rows = Array.isArray(all) ? all : (all && all.data) || [];
    setStats({ total: rows.length, active: rows.filter((r) => r.status === 'active').length });
  }, [adapter]);
  React.useEffect(() => { refreshStats(); }, [refreshStats, reloadKey]);
  const openNew = () => { setSelected(null); setMode('create'); };
  const onRowClick = (rec) => { setSelected(rec); setMode('edit'); };
  const afterSave = () => { setSelected(null); setMode('edit'); setReloadKey((k) => k + 1); };
  const editing = mode === 'create' || selected;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">CRM Workbench</h1>
          <p className="mt-1 text-sm text-slate-500">Real &lt;ListView&gt; + &lt;ObjectForm&gt; wired with React state.</p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">+ New project</button>
      </header>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Total projects</div><div className="mt-1 text-3xl font-bold text-slate-900">{stats.total}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Active</div><div className="mt-1 text-3xl font-bold text-emerald-600">{stats.active}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Editing</div><div className="mt-1 truncate text-lg font-semibold text-slate-700">{mode === 'create' ? 'New project' : selected ? (selected.name || selected.id) : '—'}</div></div>
      </div>
      <div className="grid grid-cols-5 gap-6">
        <section className="col-span-3 rounded-xl border border-slate-200 bg-white p-2">
          <ListView key={reloadKey} data={{ provider: 'object', object: 'showcase_project' }} fields={['name','status','health','budget','owner']} navigation={{ mode: 'none' }} onRowClick={onRowClick} />
        </section>
        <section className="col-span-2 rounded-xl border border-slate-200 bg-white p-5">
          {editing ? (
            <ObjectForm key={(mode === 'create' ? 'new' : selected && selected.id) + ':' + reloadKey} objectName="showcase_project" mode={mode} recordId={mode === 'edit' && selected ? selected.id : undefined} onSuccess={afterSave} onCancel={() => { setSelected(null); }} />
          ) : (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center text-slate-400"><div className="text-4xl">\u{1F5C2}\u{FE0F}</div><p className="mt-2 text-sm">Select a project to edit, or create a new one.</p></div>
          )}
        </section>
      </div>
    </div>
  );
}`;

const page = { type: 'home', kind: 'react', name: 'crm_workbench', label: 'CRM Workbench', source };

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <AdapterCtx.Provider value={adapter}>
        <SchemaRendererProvider dataSource={adapter}>
          <div className="bg-slate-50"><SchemaRenderer schema={page as any} /></div>
        </SchemaRendererProvider>
      </AdapterCtx.Provider>
    </I18nProvider>
  </React.StrictMode>,
);
