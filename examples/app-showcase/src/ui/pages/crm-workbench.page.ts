// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * CRM Workbench — a `kind:'react'` page (ADR-0081, the TRUSTED tier).
 *
 * Real React executed at render (hooks, handlers, arbitrary JS) composing the
 * platform's real data components — `<ListView>` + `<ObjectForm>` — into a
 * master/detail workbench with a live KPI strip.
 *
 * Styling (ADR-0065): page source is runtime metadata, so the console's
 * build-time Tailwind never scans it — utility classes silently no-op. So the
 * page uses ZERO Tailwind: layout/chrome is inline `style={{}}` with
 * `hsl(var(--token))` theme colors (real CSS, theme-aware), and the data
 * components bring their own compiled styling.
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
      // useAdapter() is the console's ObjectStackAdapter — its find() resolves to
      // a normalized QueryResult with a "data" array, NOT the REST envelope with
      // a "records" array. Reading .records here always missed, so the KPI cards
      // silently stuck at 0 even though the ListView beside them showed the same
      // rows. Read .data first, with .records/array fallbacks for robustness.
      //
      // The cap is $top, not 'limit': QueryParams declares only $-prefixed keys
      // and the adapter copies only those, so a bare 'limit' is dropped without
      // an error and the read runs unbounded. And once a cap IS applied, the
      // headline count has to come from the envelope's 'total' (the server's
      // real count over the same filter) — rows.length would report 200 for
      // every workspace with more than 200 projects, and look right doing it.
      // "Active" stays a per-row verdict over the 200 rows actually fetched;
      // an exact one would need its own filtered count query.
      const all = await adapter.find('showcase_project', { $top: 200 });
      const rows = Array.isArray(all) ? all : (all && (all.data || all.records)) || [];
      const total = typeof (all && all.total) === 'number' ? all.total : rows.length;
      setStats({ total, active: rows.filter((r) => r.status === 'active').length });
    } catch (e) { console.warn('[CRM Workbench] failed to refresh stats', e); }
  }, [adapter]);
  React.useEffect(() => { refreshStats(); }, [refreshStats, reloadKey]);

  const openNew = () => { setSelected(null); setMode('create'); };
  const onRowClick = (rec) => { setSelected(rec); setMode('edit'); };
  const afterSave = () => { setSelected(null); setMode('edit'); setReloadKey((k) => k + 1); };
  const editing = mode === 'create' || selected;

  const card = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', padding: 16 };
  const eyebrow = { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'hsl(var(--muted-foreground))' };
  const big = { marginTop: 4, fontSize: 30, fontWeight: 700, color: 'hsl(var(--foreground))' };

  return (
    <div style={{ maxWidth: 1152, margin: '0 auto', padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', color: 'hsl(var(--foreground))' }}>CRM Workbench</h1>
          <p style={{ marginTop: 4, fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>Master/detail over <code>showcase_project</code> — real <code>&lt;ListView&gt;</code> + <code>&lt;ObjectForm&gt;</code> wired with React state.</p>
        </div>
        <button onClick={openNew} style={{ flexShrink: 0, borderRadius: 'var(--radius)', background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>+ New project</button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <div style={card}><div style={eyebrow}>Total projects</div><div style={big}>{stats.total}</div></div>
        <div style={card}><div style={eyebrow}>Active</div><div style={{ ...big, color: 'hsl(142 70% 45%)' }}>{stats.active}</div></div>
        <div style={card}><div style={eyebrow}>Editing</div><div style={{ marginTop: 4, fontSize: 18, fontWeight: 600, color: 'hsl(var(--foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mode === 'create' ? 'New project' : selected ? (selected.name || selected.id) : '—'}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, alignItems: 'start' }}>
        <section style={{ ...card, padding: 8 }}>
          <ListView key={reloadKey} objectName="showcase_project"
            fields={['name', 'status', 'health', 'budget', 'owner']}
            navigation={{ mode: 'none' }} onRowClick={onRowClick} />
        </section>
        <section style={{ ...card, padding: 20 }}>
          {editing ? (
            <ObjectForm
              key={(mode === 'create' ? 'new' : selected && selected.id) + ':' + reloadKey}
              objectName="showcase_project" mode={mode}
              recordId={mode === 'edit' && selected ? selected.id : undefined}
              onSuccess={afterSave} onCancel={() => { setSelected(null); }} />
          ) : (
            <div style={{ display: 'flex', minHeight: 240, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>
              <div style={{ fontSize: 32 }}>🗂️</div>
              <p style={{ marginTop: 8, fontSize: 14 }}>Select a project to edit, or create a new one.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}`,
});
