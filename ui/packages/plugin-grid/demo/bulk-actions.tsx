/**
 * Manual-verification demo for object-declared bulk actions (objectui#3002).
 *
 *   pnpm --dir packages/plugin-grid exec vite demo --port 5198
 *   open http://localhost:5198/bulk-actions.html
 *
 * Everything below the mock boundary is the REAL stack — `ObjectGrid`,
 * `BulkActionBar`, `BulkActionDialog`, `useBulkExecutor`, `ActionRunner`. Only
 * two things are faked: the data source (an in-memory store, standing in for
 * `/api/v1/<object>`) and `window.fetch` (which logs each action request to the
 * on-page panel instead of hitting a server).
 *
 * What it exercises:
 *   1. `bulk_mark_done` and `bulk_recalc_estimate` are declared on the object
 *      and NAMED in the view's `bulkActions` — the only way to declare a bulk
 *      action (spec 17 retired `action.bulkEnabled` as a tombstone). Both
 *      names used to dispatch as `{ type: '<name>' }` and never run; the
 *      buttons also carried none of the def's label / icon / params.
 *   2. `legacy_only_handler` resolves to no declared action and stays a
 *      by-name dispatch — it must still render ALONGSIDE the two defs above.
 *   3. Record `t3` fails server-side (422), proving per-record attribution: the
 *      result panel reports 4/5 with an error row rather than a blanket success.
 *   4. Rich `bulkActionDefs` with picker params (#3064 / ADR-0059): `Set
 *      Manager` (lookup → sys_user, single) and `Assign Executors` (lookup →
 *      sys_user, multiple) must render the form's PeoplePicker; `Set Queue`
 *      (lookup → demo_queue) the searchable LookupField. Open with
 *      `?failUsers=1` to make the FIRST sys_user candidate fetch fail — the
 *      picker must show an error + Retry (never a permanent "Loading…"), and
 *      Retry / reopening must refetch.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import '@object-ui/components/style.css';
import { ActionProvider, I18nProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { en } from '@object-ui/i18n';
import { ObjectGrid } from '../src/ObjectGrid';

registerAllFields();

// The prebuilt components CSS ships its own :root theme and (being injected at
// runtime) wins over the html file — re-apply the console brand tokens last.
const themeStyle = document.createElement('style');
themeStyle.textContent = `:root {
  --primary: 243 75% 59%;
  --primary-foreground: 0 0% 100%;
  --ring: 243 75% 59%;
}`;
document.head.appendChild(themeStyle);

// ─────────────────────────── mock boundary ───────────────────────────

const ROWS = [
  { id: 't1', title: 'Ship the release notes', assignee: 'Ada', progress: 20, done: false },
  { id: 't2', title: 'Review the migration plan', assignee: 'Alan', progress: 40, done: false },
  { id: 't3', title: 'Rotate the staging keys', assignee: 'Grace', progress: 60, done: false },
  { id: 't4', title: 'Draft the incident postmortem', assignee: 'Ada', progress: 80, done: false },
  { id: 't5', title: 'Prune stale feature flags', assignee: 'Alan', progress: 10, done: false },
];

/**
 * Also carries `locations: ['list_item']`, so naming it in the view's
 * `bulkActions` makes the same action a row entry AND a bulk entry.
 */
const MARK_DONE = {
  name: 'bulk_mark_done',
  label: 'Mark Done',
  icon: 'check',
  type: 'api',
  target: '/api/demo/mark-done',
  recordIdParam: 'taskId',
  locations: ['list_item'],
};

/** Surfaces only on the record overflow menu — until the view names it. */
const RECALC = {
  name: 'bulk_recalc_estimate',
  label: 'Recalculate Estimate',
  icon: 'calculator',
  type: 'api',
  target: '/api/demo/recalc',
  recordIdParam: 'taskId',
  locations: ['record_more'],
  // Collected ONCE by the bulk dialog, then handed to every per-record dispatch.
  params: [
    {
      name: 'basis',
      label: 'Estimate basis',
      type: 'select',
      required: true,
      options: [
        { label: 'Story points', value: 'points' },
        { label: 'Hours', value: 'hours' },
      ],
      defaultValue: 'points',
    },
  ],
};

/**
 * Aggregate counterpart (#3139): the view opts in with `execution:
 * 'aggregate'` below, so the whole selection arrives in ONE dispatch carrying
 * `params._selectedIds` — the "zip of QR codes for N devices" shape.
 */
const EXPORT_ZIP = {
  name: 'bulk_export_zip',
  label: 'Export Zip',
  icon: 'archive',
  type: 'api',
  target: '/api/demo/export-zip',
};

/** Candidate directories for the picker-param defs (#3064). */
const USERS = [
  { id: 'u1', name: '现场工人-测试', email: 'worker@demo.dev' },
  { id: 'u2', name: '工厂长-测试', email: 'chief@demo.dev' },
  { id: 'u3', name: '质检员-测试', email: 'qa@demo.dev' },
  { id: 'u4', name: 'Dev Admin', email: 'admin@demo.dev' },
];
const QUEUES = [
  { id: 'q1', title: 'Frontline support' },
  { id: 'q2', title: 'Escalations' },
];

// `?failUsers=1` — the first sys_user candidate fetch rejects, later ones
// succeed: the manual repro for #3064 (error + Retry, no failure caching).
let failNextUserFetch = new URLSearchParams(location.search).has('failUsers');

function searchable(rows: Array<Record<string, any>>, params: any) {
  const q = typeof params?.$search === 'string' ? params.$search.trim().toLowerCase() : '';
  const data = q
    ? rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)))
    : rows;
  return { data: data.map(r => ({ ...r })), total: data.length, hasMore: false, pageSize: 50 };
}

const dataSource: any = {
  async find(resource: string, params: any) {
    if (resource === 'sys_user') {
      if (failNextUserFetch) {
        failNextUserFetch = false;
        throw new Error('sys_user directory unavailable (simulated)');
      }
      return searchable(USERS, params);
    }
    if (resource === 'demo_queue') return searchable(QUEUES, params);
    return { data: ROWS.map(r => ({ ...r })), total: ROWS.length, hasMore: false, pageSize: 50 };
  },
  async findOne(resource: string, id: string) {
    const pool = resource === 'sys_user' ? USERS : resource === 'demo_queue' ? QUEUES : ROWS;
    return pool.find(r => r.id === id) ?? null;
  },
  async update(resource: string, id: string, patch: Record<string, unknown>) {
    pushLog({ url: `(update ${resource})`, recordId: id, params: JSON.stringify(patch), status: 200 });
    return { id, ...patch };
  },
  async getObjectSchema(name: string) {
    if (name === 'sys_user') {
      return { name, label: 'User', fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, email: { type: 'email', label: 'Email' } } };
    }
    if (name === 'demo_queue') {
      return { name, label: 'Queue', fields: { id: { type: 'text' }, title: { type: 'text', label: 'Title' } } };
    }
    return {
      name,
      label: 'Task',
      fields: {
        id: { type: 'text' },
        title: { type: 'text', label: 'Title' },
        assignee: { type: 'text', label: 'Assignee' },
        progress: { type: 'percent', label: 'Progress' },
      },
      // The single source the grid folds into the selection bar.
      actions: [MARK_DONE, RECALC, EXPORT_ZIP],
    };
  },
};

/**
 * Request log, rendered on the page so each per-record dispatch is visible.
 * A tiny external store rather than a captured setState: the fetch stub lives
 * outside React, and assigning a module-level slot from render is exactly what
 * the compiler lint forbids.
 */
type LogEntry = { url: string; recordId: string; params: string; status: number };
const logEntries: LogEntry[] = [];
const logListeners = new Set<() => void>();
function pushLog(e: LogEntry) {
  logEntries.push(e);
  logListeners.forEach(notify => notify());
}
function useLog(): LogEntry[] {
  // Subscribe on the append COUNT — a stable scalar snapshot, so the store
  // contract holds while the array itself stays mutable.
  React.useSyncExternalStore(
    (onChange) => {
      logListeners.add(onChange);
      return () => logListeners.delete(onChange);
    },
    () => logEntries.length,
    () => 0,
  );
  return logEntries;
}

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: any, init: any) => {
  const url = String(input);
  if (!url.startsWith('/api/demo/')) return realFetch(input, init);
  const body = init?.body ? JSON.parse(init.body) : {};
  // An aggregate dispatch (#3139) carries the whole selection in one call.
  const recordId = Array.isArray(body._selectedIds)
    ? `[${body._selectedIds.join(',')}]`
    : body._rowRecord?.id ?? '(none)';
  // t3 fails — proves the result panel attributes failures per record instead
  // of reporting a blanket success.
  const status = recordId === 't3' ? 422 : 200;
  const { _rowRecord, _selectedIds, ...rest } = body;
  pushLog({ url, recordId, params: JSON.stringify(rest), status });
  return {
    ok: status === 200,
    status,
    statusText: status === 200 ? 'OK' : 'Unprocessable Entity',
    headers: { get: () => 'application/json' },
    json: async () => ({ success: status === 200 }),
  } as any;
}) as typeof window.fetch;

// ───────────────────────────── the demo ──────────────────────────────

const schema: any = {
  type: 'object-grid',
  objectName: 'demo_task',
  columns: [
    { field: 'title', label: 'Title' },
    { field: 'assignee', label: 'Assignee' },
    { field: 'progress', label: 'Progress' },
  ],
  pagination: { pageSize: 50 },
  // Bare names: two resolve to declared actions, one doesn't.
  bulkActions: ['bulk_mark_done', 'bulk_recalc_estimate', 'legacy_only_handler'],
  // Rich defs with picker params — the shared-field-widget surface (#3064).
  bulkActionDefs: [
    // Aggregate mode (#3139): names the declared action, ONE dispatch for the
    // whole selection with `params._selectedIds` — contrast with Mark Done's
    // one-line-per-record log output.
    { name: 'bulk_export_zip', operation: 'custom', execution: 'aggregate' },
    {
      name: 'set_manager',
      label: 'Set Manager',
      operation: 'update',
      params: [
        { name: 'manager', label: 'Manager', type: 'lookup', object: 'sys_user', required: true },
      ],
    },
    {
      name: 'assign_executors',
      label: 'Assign Executors',
      operation: 'update',
      params: [
        { name: 'executors', label: 'Executors', type: 'lookup', object: 'sys_user', multiple: true, required: true },
      ],
    },
    {
      name: 'set_queue',
      label: 'Set Queue',
      operation: 'update',
      params: [
        { name: 'queue', label: 'Queue', type: 'lookup', object: 'demo_queue', labelField: 'title', required: true },
      ],
    },
  ],
};

function Demo() {
  const log = useLog();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid hsl(var(--border))' }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          Object-declared bulk actions — objectui#3002
        </h1>
        <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', margin: '4px 0 0' }}>
          Select rows → the bar shows <b>Mark Done</b> and <b>Recalculate Estimate</b> (names
          from the view&apos;s <code>bulkActions</code>, promoted to their declared object
          actions), <b>Export Zip</b> (an <code>execution: &apos;aggregate&apos;</code> def —
          ONE dispatch carrying every selected id, #3139) and <b>Legacy Only
          Handler</b> (unresolvable, dispatched by name).
        </p>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <ObjectGrid schema={schema} dataSource={dataSource} />
      </div>

      <section
        style={{
          borderTop: '1px solid hsl(var(--border))',
          padding: '8px 16px',
          maxHeight: 200,
          overflow: 'auto',
          fontSize: 12,
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }} data-testid="log-count">
          Action requests: {log.length}
        </div>
        {log.length === 0 && (
          <div style={{ color: 'hsl(var(--muted-foreground))' }}>
            (none yet — one line will appear per selected record)
          </div>
        )}
        {log.map((e, i) => (
          <div key={i} style={{ color: e.status === 200 ? 'inherit' : 'hsl(var(--destructive))' }}>
            {e.status} {e.url} · record={e.recordId} · params={e.params}
          </div>
        ))}
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <I18nProvider resources={{ en }} language="en">
    {/* A handler registered under a bare NAME — the compat path that legacy
        `bulkActions` entries must keep working for. */}
    <ActionProvider
      handlers={{
        legacy_only_handler: async () => {
          pushLog({ url: '(runner handler)', recordId: 'all-selected', params: '{}', status: 200 });
          return { success: true };
        },
      }}
    >
      <Demo />
    </ActionProvider>
  </I18nProvider>,
);
