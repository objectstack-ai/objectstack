// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * CRM Workbench — a `kind:'react'` page (ADR-0081, the TRUSTED tier).
 *
 * The whole page is REAL React executed at render by `@object-ui/react-runtime`
 * (hooks, event handlers, arbitrary JS) — NOT the constrained parse-never-execute
 * `kind:'html'` tier. It demonstrates exactly what a real customer business UI
 * needs: a master/detail workbench that COMPOSES the platform's real data
 * components — `<ListView>` (the object table) and `<ObjectForm>` — with React
 * state to wire complex interaction the fixed page schema cannot express:
 *
 *   - click a project row  → load that record into the editor (controlled `recordId`)
 *   - save the form        → refresh the list (`onSuccess` bumps a remount key)
 *   - "New project"        → the same editor in create mode
 *   - a live KPI strip     → `useAdapter()` queries the object directly
 *
 * The injected scope exposes `React`, `useAdapter`, and the curated public data
 * blocks as PascalCase components (`ListView`, `ObjectForm`, `ObjectMetric`, …),
 * each a real registered renderer. Layout is plain HTML + Tailwind.
 *
 * NOTE: `kind:'react'` executes author code, so it is gated by the host
 * capability `CAP_REACT_PAGES`, which defaults ON (the platform trusts its
 * reviewed, draft-gated authors). A deployment that does not trust its authors
 * turns it off server-side with `OS_PAGE_REACT=off`, in which case
 * this page renders a "disabled on this deployment" notice instead of executing.
 */
export const CrmWorkbenchPage = definePage({
  name: 'showcase_crm_workbench',
  label: 'CRM Workbench (React)',
  type: 'home',
  kind: 'react',
  source: `
function Page() {
  const adapter = useAdapter();
  const [selected, setSelected] = React.useState(null);
  const [mode, setMode] = React.useState('edit');
  const [reloadKey, setReloadKey] = React.useState(0);
  const [stats, setStats] = React.useState({ total: 0, active: 0 });

  const refreshStats = React.useCallback(async () => {
    if (!adapter) return;
    try {
      const all = await adapter.find('showcase_project', { top: 200 });
      const rows = Array.isArray(all) ? all : (all && all.records) || [];
      setStats({ total: rows.length, active: rows.filter((r) => r.status === 'active').length });
    } catch (e) { /* ignore in demo */ }
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
          <p className="mt-1 text-sm text-slate-500">Master/detail over <code>showcase_project</code> — real <code>&lt;ListView&gt;</code> + <code>&lt;ObjectForm&gt;</code> wired with React state.</p>
        </div>
        <button onClick={openNew} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">+ New project</button>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Total projects</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Active</div>
          <div className="mt-1 text-3xl font-bold text-emerald-600">{stats.active}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Editing</div>
          <div className="mt-1 truncate text-lg font-semibold text-slate-700">{mode === 'create' ? 'New project' : selected ? (selected.name || selected.id) : '—'}</div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-6">
        <section className="col-span-3 rounded-xl border border-slate-200 bg-white p-2">
          <ListView
            key={reloadKey}
            objectName="showcase_project"
            fields={['name', 'status', 'health', 'budget', 'owner']}
            navigation={{ mode: 'none' }}
            onRowClick={onRowClick}
          />
        </section>
        <section className="col-span-2 rounded-xl border border-slate-200 bg-white p-5">
          {editing ? (
            <ObjectForm
              key={(mode === 'create' ? 'new' : selected && selected.id) + ':' + reloadKey}
              objectName="showcase_project"
              mode={mode}
              recordId={mode === 'edit' && selected ? selected.id : undefined}
              onSuccess={afterSave}
              onCancel={() => { setSelected(null); }}
            />
          ) : (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center text-slate-400">
              <div className="text-4xl">🗂️</div>
              <p className="mt-2 text-sm">Select a project to edit, or create a new one.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}`,
});
