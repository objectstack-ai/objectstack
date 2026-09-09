// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Task Desk — a `kind:'react'` business scenario (ADR-0081) showing the
 * popup-edit patterns real apps need: a **slide-out drawer** to edit a row and a
 * **centered modal** to create — both rendered by the platform's own
 * `<ObjectForm formType="drawer"|"modal">` variant, NOT hand-rolled.
 *
 * Styling note (ADR-0065): page source is runtime metadata, so the console's
 * build-time Tailwind never scans it — arbitrary utility classes silently no-op.
 * So this page uses ZERO Tailwind: the overlay/backdrop/animation come from the
 * pre-styled ObjectForm drawer/modal, and the thin page chrome uses inline
 * `style={{}}` with `hsl(var(--token))` theme colors (real CSS, theme-aware).
 */
export const TaskDeskPage = definePage({
  name: 'showcase_task_desk',
  label: 'Task Desk (React)',
  type: 'home',
  kind: 'react',
  source: `
function Page() {
  const [editId, setEditId] = React.useState(null);     // drawer (edit existing)
  const [creating, setCreating] = React.useState(false); // modal (create new)
  const [reload, setReload] = React.useState(0);
  const afterWrite = () => { setEditId(null); setCreating(false); setReload((k) => k + 1); };

  return (
    <div style={{ maxWidth: 1024, margin: '0 auto', padding: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', color: 'hsl(var(--foreground))', margin: 0 }}>Task Desk</h1>
          <p style={{ marginTop: 4, fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
            Click a task to edit it in a <strong>drawer</strong>; create one in a <strong>modal</strong> — both render the platform's pre-styled <code>&lt;ObjectForm&gt;</code> overlay.
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          style={{ flexShrink: 0, borderRadius: 'var(--radius)', background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
          + New task
        </button>
      </header>

      <ListView key={reload} data={{ provider: 'object', object: 'showcase_task' }}
        fields={['title', 'assignee', 'status', 'priority']}
        navigation={{ mode: 'none' }} onRowClick={(r) => setEditId(r.id)} />

      {/* Drawer — edit an existing task. Backdrop, Esc, slide animation are the component's. */}
      {editId != null ? (
        <ObjectForm formType="drawer" drawerSide="right" objectName="showcase_task" mode="edit"
          recordId={editId} open title="Edit task"
          onOpenChange={(o) => { if (!o) setEditId(null); }}
          onSuccess={afterWrite} />
      ) : null}

      {/* Modal — create a new task. */}
      {creating ? (
        <ObjectForm formType="modal" objectName="showcase_task" mode="create"
          open title="New task"
          onOpenChange={(o) => { if (!o) setCreating(false); }}
          onSuccess={afterWrite} />
      ) : null}
    </div>
  );
}`,
});
