/**
 * DEV-ONLY metadata-designer gallery harness.
 *
 * Renders every registered metadata Preview (the "designers") with a
 * representative sample draft inside chrome that mirrors the real
 * ResourceEditPage canvas (dotted-grid background, toolbar, edit mode +
 * live selection/patch state). Lets us browser-test and beautify each
 * designer without a live backend.
 *
 * Served as a standalone Vite entry: open /preview-gallery.html.
 * Excluded from the production build (no route references it).
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { I18nProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererContext } from '@object-ui/react';
import { MemoryRouter } from 'react-router-dom';
import { Button } from '@object-ui/components';
import { RecordPickerDialog, getCellRenderer } from '@object-ui/fields';
import type { DataSource, DeclaredNode, LookupColumnDef, QueryParams } from '@object-ui/types';

// Register the renderers the schema-driven previews rely on.
import '@object-ui/plugin-grid';
import '@object-ui/plugin-form';
import '@object-ui/plugin-view';
import '@object-ui/plugin-list';
import '@object-ui/plugin-detail';

// Lazy renderers used by the dashboard / report designers.
// objectui#10859 batch 8 (phase 2b): `dashboard-grid` is retired, and the
// `metric` / `metric-card` stubs decline the bare key like their registrations
// (`skipFallback: true`) — this is a second `registerLazy` site for the same
// plugin, and the doc gate's key universe is the UNION of every such loop.
for (const variant of [
  'dashboard',
  'object-metric',
  'pivot',
]) {
  ComponentRegistry.registerLazy(variant, () => import('@object-ui/plugin-dashboard'), {
    namespace: 'plugin-dashboard',
    category: 'view',
  });
}
for (const variant of ['metric', 'metric-card']) {
  ComponentRegistry.registerLazy(variant, () => import('@object-ui/plugin-dashboard'), {
    namespace: 'plugin-dashboard',
    skipFallback: true,
    category: 'view',
  });
}
// ⛔ `line-chart` / `area-chart` are RETIRED here too (objectui#8760): this
// list is a second `registerLazy` site for the same plugin, and the doc gate's
// key universe is the UNION of every such loop. Retiring them from
// `register-plugins.ts` alone would have left both keys blessed by
// `check:doc-types` from THIS file, so the retirement would have changed
// nothing an author can observe. Chart families are reached as
// `{ "type": "chart", "chartType": "line" | "area" }`. `pie-chart` left this list
// with its registration (objectui#10859 batch 8, phase 2c), for the same reason:
// author `{ "type": "chart", "chartType": "pie" }`.
for (const variant of ['chart', 'bar-chart']) {
  ComponentRegistry.registerLazy(variant, () => import('@object-ui/plugin-charts'), {
    namespace: 'plugin-charts',
    category: 'chart',
  });
}

import {
  useRegisteredMetadataPreview,
  useRegisteredMetadataPreviewTypes,
  useRegisteredMetadataInspector,
} from '@object-ui/app-shell';
import type { MetadataSelection } from '@object-ui/app-shell';
import { SAMPLES } from './preview-samples';

// Importing the @object-ui/app-shell root registers the built-in previews and
// inspectors, from a chunk the package entry loads with a dynamic `import()`
// (objectui#11939 step 2) — so they land AFTER this module has rendered once.
// The gallery is the designers' browser-verification path (the `verify` skill),
// so it waits for that chunk (`GalleryOnceDesignersArrive` below) and never
// lists zero designers while it is in flight.

const ORDER = [
  'object',
  'page',
  'view',
  'dashboard',
  'app',
  'report',
  'flow',
  'workflow',
  'approval',
  'job',
  'agent',
  'tool',
  'skill',
  'action',
  'permission',
  'profile',
  'role',
  'validation',
  'datasource',
  'translation',
  'email_template',
];

/**
 * Dev-harness locale override — `?locale=zh-CN` (or `#locale=zh-CN`) renders the
 * designers in that locale so i18n coverage can be eyeballed / browser-tested
 * without wiring the full console LocaleSwitcher. Defaults to English.
 */
function galleryLocale(): 'en-US' | 'zh-CN' {
  if (typeof window === 'undefined') return 'en-US';
  const q = new URLSearchParams(window.location.search).get('locale');
  const h = window.location.hash.match(/locale=([a-zA-Z-]+)/)?.[1];
  const raw = q ?? h ?? '';
  // Normalize to the metadata-admin SupportedLocale union so it satisfies the
  // typed `locale` prop on the previews/inspectors.
  return /^zh/i.test(raw) ? 'zh-CN' : 'en-US';
}

function DesignerCard({ type }: { type: string }) {
  // Observed reads (objectui#11939): a designer registered after the gallery
  // rendered appears without a reload. Both are hooks, so both are read above
  // the early return below.
  const Preview = useRegisteredMetadataPreview(type);
  const registeredInspector = useRegisteredMetadataInspector(type);
  const [draft, setDraft] = React.useState<Record<string, unknown>>(
    () => SAMPLES[type] ?? { name: type, label: type },
  );
  const [selection, setSelection] = React.useState<MetadataSelection | null>(null);

  if (!Preview) return null;

  const onPatch = (patch: Record<string, unknown>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const Inspector = selection ? registeredInspector : undefined;
  const locale = galleryLocale();

  return (
    <section className="scroll-mt-4" id={`designer-${type}`}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{type}</h2>
        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {String(draft.name ?? '')}
        </code>
        {selection && (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
            selected: {selection.label ?? selection.id}
          </span>
        )}
      </div>
      {/* Mirror the ResourceEditPage canvas chrome */}
      <div className="relative flex h-[520px] flex-col overflow-hidden rounded-md border bg-background">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
          <div className="inline-flex items-center rounded-md border bg-muted/40 p-0.5">
            <span className="rounded bg-background px-2 py-1 text-xs text-foreground shadow-sm">
              Design
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">designer · {type}</span>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex-1 min-h-0 overflow-auto bg-muted/30 p-4 bg-[radial-gradient(circle_at_1px_1px,theme(colors.border)_1px,transparent_0)] [background-size:16px_16px]">
            {React.createElement(Preview, {
              type,
              name: String(draft.name ?? ''),
              draft,
              editing: true,
              selection,
              onSelectionChange: setSelection,
              onPatch,
              locale,
            })}
          </div>
          {Inspector && selection && (
            <div className="w-80 shrink-0 overflow-auto border-l bg-background">
              {React.createElement(Inspector, {
                type,
                name: String(draft.name ?? ''),
                draft,
                selection,
                onPatch,
                onClearSelection: () => setSelection(null),
                onSelectionChange: setSelection,
                readOnly: false,
                locale,
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * objectui#11903 — the record picker, on a page a human can look at.
 *
 * `RecordPickerDialog` in `multiple` mode over three columns, the shape of a
 * related list's *Add* (name, email, email verified), served by an in-memory
 * data source so the dialog's layout can be judged by eye without a backend.
 * Twelve users, so the footer bar carries its page controls too.
 *
 * Isolate it with `?only=record_picker`, which also opens the dialog.
 */
const RECORD_PICKER_KEY = 'record_picker';

const PICKER_USER_SEED: ReadonlyArray<readonly [name: string, verified: boolean]> = [
  ['Ada Lovelace', true],
  ['Alan Turing', true],
  ['Barbara Liskov', false],
  ['Claude Shannon', true],
  ['Donald Knuth', true],
  ['Edsger Dijkstra', false],
  ['Frances Allen', true],
  ['Grace Hopper', true],
  ['John Backus', false],
  ['Ken Thompson', true],
  ['Margaret Hamilton', true],
  ['Radia Perlman', false],
];

const PICKER_USERS = PICKER_USER_SEED.map(([name, verified], i) => ({
  id: `usr_${String(i + 1).padStart(2, '0')}`,
  name,
  email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
  email_verified: verified,
}));

const PICKER_FIELDS: Record<string, { type: string; label: string }> = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'email', label: 'Email' },
  email_verified: { type: 'boolean', label: 'Email verified' },
};

const PICKER_COLUMNS: LookupColumnDef[] = [
  { field: 'name', label: 'Name' },
  { field: 'email', label: 'Email' },
  { field: 'email_verified', label: 'Email verified' },
];

/** Read-only, in-memory `sys_user`: search, page and sort over `PICKER_USERS`. */
const pickerDataSource: DataSource = {
  async find(_resource: string, params?: QueryParams) {
    const term = typeof params?.$search === 'string' ? params.$search.toLowerCase() : '';
    let rows = PICKER_USERS.filter(
      (u) => !term || u.name.toLowerCase().includes(term) || u.email.includes(term),
    );
    const orderby = params?.$orderby;
    const sort =
      orderby && typeof orderby === 'object' && !Array.isArray(orderby)
        ? Object.entries(orderby)[0]
        : undefined;
    if (sort) {
      const [field, direction] = sort;
      rows = [...rows].sort((a, b) => {
        const key = field as keyof (typeof PICKER_USERS)[number];
        const cmp = String(a[key]).localeCompare(String(b[key]));
        return direction === 'desc' ? -cmp : cmp;
      });
    }
    const skip = params?.$skip ?? 0;
    const top = params?.$top ?? rows.length;
    return { data: rows.slice(skip, skip + top), total: rows.length };
  },
  async findOne(_resource: string, id: string) {
    return PICKER_USERS.find((u) => u.id === id) ?? null;
  },
  async create() {
    throw new Error('The record picker specimen is read-only.');
  },
  async update() {
    throw new Error('The record picker specimen is read-only.');
  },
  async delete() {
    throw new Error('The record picker specimen is read-only.');
  },
  async getObjectSchema(objectName: string) {
    return { name: objectName, fields: PICKER_FIELDS };
  },
};

function RecordPickerSpecimen({ autoOpen }: { autoOpen: boolean }) {
  const [open, setOpen] = React.useState(autoOpen);
  const [picked, setPicked] = React.useState<string[]>([]);

  return (
    <section className="scroll-mt-4" id="record-picker">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">record picker</h2>
        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          RecordPickerDialog · multiple · 3 columns
        </code>
      </div>
      <div className="flex items-center gap-3 rounded-md border bg-background p-4">
        <Button type="button" onClick={() => setOpen(true)}>
          Assign user
        </Button>
        <span className="text-xs text-muted-foreground">{picked.length} picked</span>
      </div>
      <RecordPickerDialog
        open={open}
        onOpenChange={setOpen}
        multiple
        title="Assign user"
        dataSource={pickerDataSource}
        objectName="sys_user"
        columns={PICKER_COLUMNS}
        fieldsMeta={PICKER_FIELDS}
        cellRenderer={getCellRenderer}
        value={picked}
        onSelect={(ids: unknown) => setPicked(Array.isArray(ids) ? ids.map(String) : [])}
      />
    </section>
  );
}

/**
 * objectui#12197 — the five product-page blocks (`hero`, `stat`, `usage-bar`,
 * `checklist`, `tile-grid`), each drawn through the real `SchemaRenderer` from
 * the node a product page authors. The last row binds the spec's API data
 * source to an in-memory answer (the host fetch on `SchemaRendererContext`),
 * so the bound path draws without a backend too.
 *
 * Isolate it with `?only=product_blocks`; add `&theme=dark` for dark mode.
 */
const PRODUCT_BLOCKS_KEY = 'product_blocks';

const PRODUCT_BLOCK_SPECIMENS: ReadonlyArray<{ title: string; node: DeclaredNode }> = [
  {
    title: 'hero',
    node: {
      type: 'hero',
      properties: {
        title: { en: 'Acme workspace', 'zh-CN': 'Acme 工作区' },
        subtitle: 'Production environment · Team plan',
        meta: 'acme.objectos.app',
        status: 'Active',
        statusTone: 'success',
        primary: { type: 'element:button', properties: { label: 'Open' } },
        secondary: { type: 'element:button', properties: { label: 'Install app', variant: 'secondary' } },
      },
    },
  },
  {
    title: 'stat',
    node: {
      type: 'flex',
      direction: 'row',
      gap: 4,
      wrap: true,
      children: [
        { type: 'stat', className: 'min-w-44', properties: { label: 'Members', value: 3, hint: 'of 5 seats' } },
        { type: 'stat', className: 'min-w-44', properties: { label: 'Open deals', value: 12500 } },
        { type: 'stat', className: 'min-w-44', properties: { label: 'Plan', value: 'Team' } },
      ],
    },
  },
  {
    title: 'usage-bar',
    node: {
      type: 'flex',
      direction: 'col',
      gap: 4,
      children: [
        { type: 'usage-bar', properties: { label: 'Storage', used: 256, limit: 1024, unit: 'MB' } },
        { type: 'usage-bar', properties: { label: 'AI seats', used: 6, limit: 5 } },
        { type: 'usage-bar', properties: { label: 'Records', used: 48210, limit: 0 } },
      ],
    },
  },
  {
    title: 'checklist',
    node: {
      type: 'checklist',
      properties: {
        collapsedWhenDone: true,
        items: [
          { label: 'Create a production environment', done: true },
          { label: 'Install your first app', done: false, action: { type: 'element:button', properties: { label: 'Browse apps', size: 'small' } } },
          { label: 'Invite a teammate', done: false },
        ],
      },
    },
  },
  {
    title: 'tile-grid',
    node: {
      type: 'tile-grid',
      properties: {
        items: [
          { label: 'CRM', href: '/apps/crm', icon: 'briefcase', caption: 'Sales' },
          { label: 'Helpdesk', href: '/apps/helpdesk', icon: 'life-buoy' },
          { label: 'Projects', href: '/apps/projects', icon: 'folder-kanban', caption: '2 hr. ago' },
        ],
        addTile: { label: 'Add app', href: '/marketplace' },
      },
    },
  },
  {
    title: 'bound to an API data source',
    node: {
      type: 'flex',
      direction: 'col',
      gap: 4,
      children: [
        {
          type: 'hero',
          dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data' },
          properties: { title: 'Your workspace', meta: '${data.environments[0].hostname}', status: '${data.environments[0].status}', statusTone: 'success' },
        },
        {
          type: 'usage-bar',
          dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data' },
          properties: { label: 'Storage', used: '${data.storage.usedMb}', limit: '${data.storage.limitMb}', unit: 'MB' },
        },
        {
          type: 'checklist',
          dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data' },
          properties: {
            items: [
              { label: 'Environment', done: '${data.checklist.environment}' },
              { label: 'First app', done: '${data.checklist.firstApp}' },
              { label: 'Teammate', done: '${data.checklist.teammate}' },
            ],
          },
        },
      ],
    },
  },
];

/** The in-memory answer the bound row reads, in the control plane's envelope. */
const PRODUCT_BLOCKS_HOME = {
  success: true,
  data: {
    environments: [{ hostname: 'acme.objectos.app', status: 'active' }],
    storage: { usedMb: 640, limitMb: 1024 },
    checklist: { environment: true, firstApp: true, teammate: false },
  },
};

const productBlocksFetch = async (): Promise<Response> =>
  new Response(JSON.stringify(PRODUCT_BLOCKS_HOME), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

function ProductBlocksSpecimen() {
  return (
    <section className="scroll-mt-4 space-y-6" id="product-blocks" data-testid="product-blocks-specimen">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">product-page blocks</h2>
      <MemoryRouter>
        <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch: productBlocksFetch }}>
          {PRODUCT_BLOCK_SPECIMENS.map(({ title, node }) => (
            <div key={title} className="space-y-2" data-testid={`product-block-${title.split(' ')[0]}`}>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{title}</code>
              <div className="rounded-md border bg-background p-4">
                <SchemaRenderer schema={node} />
              </div>
            </div>
          ))}
        </SchemaRendererContext.Provider>
      </MemoryRouter>
    </section>
  );
}

function Gallery() {
  const registered = new Set(useRegisteredMetadataPreviewTypes());
  const all = ORDER.filter((t) => registered.has(t));
  // Dev-harness isolation: `?only=flow` (or `#only=flow`) renders a single
  // designer full-width so browser automation can interact without the other
  // stacked designers churning element refs.
  const only = React.useMemo(() => {
    const q = new URLSearchParams(window.location.search).get('only');
    const h = window.location.hash.match(/only=([a-z_]+)/)?.[1];
    return q ?? h ?? null;
  }, []);
  const pickerOnly = only === RECORD_PICKER_KEY;
  const blocksOnly = only === PRODUCT_BLOCKS_KEY;
  const types = pickerOnly || blocksOnly ? [] : only && all.includes(only) ? [only] : all;
  const [active, setActive] = React.useState(types[0]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold tracking-tight">Metadata Designer Gallery</h1>
        <p className="text-xs text-muted-foreground">
          {types.length} designer{types.length === 1 ? '' : 's'} · dev harness
          {only ? ` · isolated: ${only}` : ''} · {' '}
          <span className="text-muted-foreground/80">
            view/dashboard/report need a live data adapter and degrade to empty states here
          </span>
        </p>
        {!only && (
          <nav className="mt-2 flex flex-wrap gap-1">
            {all.map((t) => (
              <a
                key={t}
                href={`#designer-${t}`}
                onClick={() => setActive(t)}
                className={
                  'rounded px-2 py-0.5 text-[11px] transition-colors ' +
                  (active === t
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70')
                }
              >
                {t}
              </a>
            ))}
            <a
              href="#product-blocks"
              className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/70"
            >
              product blocks
            </a>
            <a
              href="#record-picker"
              className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/70"
            >
              record picker
            </a>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-5xl space-y-10 px-6 py-8">
        {types.map((t) => (
          <DesignerCard key={t} type={t} />
        ))}
        {(!only || blocksOnly) && <ProductBlocksSpecimen />}
        {(!only || pickerOnly) && <RecordPickerSpecimen autoOpen={pickerOnly} />}
      </main>
    </div>
  );
}

/**
 * The await of the package entry's own designer chunk. Its registrations
 * notify the observable registry (objectui#11939), so this re-renders when they
 * land and only then mounts the gallery. Until then it says what is happening;
 * if the chunk fails, the package entry reports why on the console.
 */
function GalleryOnceDesignersArrive() {
  const types = useRegisteredMetadataPreviewTypes();
  if (types.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">Loading the built-in designers…</p>;
  }
  return <Gallery />;
}

// Dev-harness theme override — `?theme=dark` renders the gallery in dark mode.
if (new URLSearchParams(window.location.search).get('theme') === 'dark') {
  document.documentElement.classList.add('dark');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider config={{ defaultLanguage: 'en' }}>
      <GalleryOnceDesignersArrive />
    </I18nProvider>
  </React.StrictMode>,
);
