/**
 * objectstack#36372 — editing a dashboard on its own page, for the people who
 * may design its package.
 *
 * The page's Edit button opens an edit state over the dashboard as it is
 * stored (never the served, translated copy): the cards draw dashed and can be
 * dragged, corner-resized and clicked; the panel at the right is Studio's own
 * dashboard panels, as they stand (`DashboardWidgetInspector` for a selected
 * card, `DashboardDefaultInspector` for the page and its filters). Save writes
 * where Studio's would, and publishes that one item in the same act, so the
 * change applies to everyone at once without the app's package being
 * published; Discard drops every change.
 *
 * Where a save lands is {@link resolveDashboardSaveTarget}'s answer: the
 * owning package when it is writable, else the app's customization package
 * `<base>.custom` (ADR-0146), so an installed app is edited too. Over a draft
 * already pending there (a Studio edit not yet published) the edit state is
 * not entered: that draft is its saver's, and is never published on their
 * behalf.
 *
 * Out of scope here: undo, a business user's own copy, a new dashboard, chart
 * drawing and drill-down.
 */

import * as React from 'react';
import { Badge, Button } from '@object-ui/components';
import { Pencil } from 'lucide-react';
import { completeWidgetLayout, defaultWidgetPlacement, type DashboardWidgetSchema } from '@object-ui/types';
import { useSafeTranslate } from '@object-ui/i18n';
import {
  dashboardSaveBody,
  resolveDashboardSaveTarget,
  saveDashboardInPlace,
  unwrapDraftBody,
  type DashboardSaveTarget,
  type DashboardSaveTargetDoors,
  type SaveAndPublishOutcome,
} from './runtime-metadata-persistence.js';
import { useStudioEntryGate } from '../hooks/useStudioDesignGate.js';
import { DashboardWidgetInspector } from './metadata-admin/inspectors/DashboardWidgetInspector.js';
import { DashboardDefaultInspector } from './metadata-admin/inspectors/DashboardDefaultInspector.js';
import { AddWidgetPicker } from './metadata-admin/previews/AddWidgetPicker.js';
import { WIDGET_TYPE_META } from './metadata-admin/previews/widget-types.js';
import { appendArray, uniqueId } from './metadata-admin/inspectors/_shared.js';
import { getDashboardForm } from './metadata-admin/dashboard-schema.js';
import { useMetadataLocale, type SupportedLocale } from './metadata-admin/i18n.js';
import type { MetadataSelection } from './metadata-admin/preview-registry.js';

/** A save target the editor can write to. */
export type WritableDashboardSaveTarget = Exclude<DashboardSaveTarget, { kind: 'refused' }>;

/** What opening a dashboard for editing found. */
export type DashboardEditOpening =
  | { kind: 'ready'; target: WritableDashboardSaveTarget; doc: Record<string, unknown> }
  | { kind: 'refused'; reason: 'no-package' | 'pending-draft' | 'load-failed'; detail?: string };

/** The metadata client calls {@link openDashboardForEdit} makes. */
export interface DashboardEditReader {
  getDraft(type: string, name: string, options?: { packageId?: string }): Promise<unknown>;
  layered(
    type: string,
    name: string,
    options?: { packageId?: string },
  ): Promise<{ code: unknown; effective: unknown }>;
}

function authoredDoc(layers: { code: unknown; effective: unknown } | null): Record<string, unknown> | null {
  const doc = layers ? (layers.effective ?? layers.code) : null;
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null;
}

/**
 * Open `name` for editing: where a save would land, and the document as
 * authored there (its layered read's `effective`, the buffer Studio edits; a
 * customization package that does not hold the item yet starts from its
 * base's). Refused when there is no package to save into, when a draft is
 * already pending there, or when the item cannot be read.
 */
export async function openDashboardForEdit(
  name: string,
  ownerPackageId: string | null | undefined,
  client: DashboardEditReader,
  doors?: DashboardSaveTargetDoors,
): Promise<DashboardEditOpening> {
  const target = await resolveDashboardSaveTarget(ownerPackageId, doors);
  if (target.kind === 'refused') return { kind: 'refused', reason: 'no-package', detail: target.reason };
  const at = target.kind === 'unbound' ? {} : { packageId: target.packageId };
  try {
    if (unwrapDraftBody(await client.getDraft('dashboard', name, at))) {
      return { kind: 'refused', reason: 'pending-draft' };
    }
    let doc = authoredDoc(await client.layered('dashboard', name, at));
    if (!doc && target.kind === 'customization') {
      doc = authoredDoc(await client.layered('dashboard', name, { packageId: target.base }));
    }
    if (!doc) return { kind: 'refused', reason: 'load-failed' };
    return { kind: 'ready', target, doc };
  } catch (err) {
    return { kind: 'refused', reason: 'load-failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

type Widget = DashboardWidgetSchema & { id?: string };

function widgetsOf(doc: Record<string, unknown>): Widget[] {
  return Array.isArray(doc.widgets) ? (doc.widgets as Widget[]) : [];
}

/**
 * `doc` with a new card of `type` appended, the way Studio's Add widget makes
 * one (a unique `widget_N` id, the type's defaults), and the id it got.
 */
export function withAddedWidget(
  doc: Record<string, unknown>,
  type: string,
): { doc: Record<string, unknown>; id: string; label: string } {
  const widgets = widgetsOf(doc);
  const id = uniqueId('widget', widgets.map((w) => w?.id).filter(Boolean) as string[]);
  const meta = WIDGET_TYPE_META[type];
  const label = meta ? `New ${meta.label.toLowerCase()}` : 'New widget';
  const widget = { id, type, title: label, ...(meta?.defaults ?? {}) } as unknown as Widget;
  return { doc: { ...doc, widgets: appendArray(widgets, widget) }, id, label };
}

/**
 * `doc` with card `widgetId` spanning `span` grid tracks: its `layout` keeps
 * every coordinate the span does not name (`completeWidgetLayout`).
 */
export function withResizedWidget(
  doc: Record<string, unknown>,
  widgetId: string,
  span: { w: number; h: number },
): Record<string, unknown> {
  const widgets = widgetsOf(doc);
  const index = widgets.findIndex((w) => w?.id === widgetId);
  if (index < 0) return doc;
  const widget = widgets[index] as Widget & { layout?: Record<string, number> };
  const layout = completeWidgetLayout(widget.layout, span, defaultWidgetPlacement(index));
  const next = widgets.slice();
  next[index] = { ...widget, layout } as Widget;
  return { ...doc, widgets: next };
}

/** The label of the panel section that edits the page filters (`globalFilters`). */
export function filtersSectionLabel(locale: SupportedLocale): string | null {
  const form = getDashboardForm(locale);
  const section = form?.sections?.find((s) =>
    (s.fields ?? []).some((f) => (typeof f === 'string' ? f : f.field) === 'globalFilters'),
  );
  return typeof section?.label === 'string' ? section.label : null;
}

/**
 * Whether this principal is offered the Edit button for a dashboard
 * `ownerPackageId` owns: the gate of the app → Studio entries
 * (`useStudioEntryGate`: a workspace admin who may author metadata, on a
 * package Studio lists, writable or not; never a kernel package). A
 * read-only package's dashboard is edited through its customization package.
 */
export function useDashboardEditOffered(ownerPackageId: string | null | undefined): boolean {
  const path = ownerPackageId ? `/studio/${encodeURIComponent(ownerPackageId)}` : null;
  return useStudioEntryGate(path) !== null;
}

/** The page header's Edit button. */
export function DashboardEditButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  const tt = useSafeTranslate();
  return (
    <Button
      variant="outline"
      size="sm"
      // The edit state needs the side panel: offered from `sm` up.
      className="hidden sm:inline-flex"
      onClick={onClick}
      disabled={busy}
      aria-label={tt('dashboard.inPageEdit.editLabel', 'Edit this dashboard')}
      data-testid="dashboard-edit"
    >
      <Pencil className="mr-2 h-4 w-4" />
      {busy ? tt('dashboard.inPageEdit.loading', 'Opening the dashboard for editing…') : tt('dashboard.inPageEdit.edit', 'Edit')}
    </Button>
  );
}

/** The page header's badge while editing. */
export function DashboardEditingBadge() {
  const tt = useSafeTranslate();
  return (
    <Badge variant="secondary" data-testid="dashboard-editing-badge">
      {tt('dashboard.inPageEdit.editing', 'Editing')}
    </Badge>
  );
}

/** The page header's actions while editing: Add card, Discard, Save. */
export function DashboardEditActions({
  onAddCard,
  onDiscard,
  onSave,
  saving,
  dirty,
}: {
  onAddCard: (type: string) => void;
  onDiscard: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}) {
  const tt = useSafeTranslate();
  return (
    <div className="flex items-center gap-2" data-testid="dashboard-edit-actions">
      <AddWidgetPicker onAdd={onAddCard} label={tt('dashboard.inPageEdit.addCard', 'Add card')} />
      <Button variant="outline" size="sm" onClick={onDiscard} disabled={saving} data-testid="dashboard-edit-discard">
        {tt('dashboard.inPageEdit.discard', 'Discard')}
      </Button>
      <Button size="sm" onClick={onSave} disabled={saving || !dirty} data-testid="dashboard-edit-save">
        {saving ? tt('dashboard.inPageEdit.saving', 'Saving…') : tt('dashboard.inPageEdit.save', 'Save')}
      </Button>
    </div>
  );
}

/**
 * The right panel while editing: Studio's card panel for the selected card,
 * its dashboard panel (label, cards, filters, layout) otherwise. `revealFilters`
 * opens and scrolls to the filters section, the "Add filter" path.
 */
export function DashboardEditPanel({
  name,
  draft,
  selection,
  onPatch,
  onSelectionChange,
  revealFilters,
  onFiltersRevealed,
}: {
  name: string;
  draft: Record<string, unknown>;
  selection: MetadataSelection | null;
  onPatch: (patch: Record<string, unknown>) => void;
  onSelectionChange: (next: MetadataSelection | null) => void;
  revealFilters: boolean;
  onFiltersRevealed: () => void;
}) {
  const locale = useMetadataLocale();
  const tt = useSafeTranslate();
  const ref = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!revealFilters || selection) return;
    const label = filtersSectionLabel(locale);
    const trigger = label
      ? Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button[data-state]') ?? []).find(
          (b) => b.querySelector('span > span')?.textContent === label,
        )
      : undefined;
    if (trigger) {
      if (trigger.getAttribute('data-state') === 'closed') trigger.click();
      trigger.scrollIntoView?.({ block: 'start' });
    }
    onFiltersRevealed();
  }, [revealFilters, selection, locale, onFiltersRevealed]);

  return (
    <aside
      ref={ref}
      aria-label={tt('dashboard.inPageEdit.panelTitle', 'Properties')}
      className="w-full shrink-0 overflow-auto border-t bg-background p-3 sm:w-80 sm:border-l sm:border-t-0"
      data-testid="dashboard-edit-panel"
    >
      {selection?.kind === 'widget' ? (
        <DashboardWidgetInspector
          type="dashboard"
          name={name}
          draft={draft}
          selection={selection}
          onPatch={onPatch}
          onClearSelection={() => onSelectionChange(null)}
          onSelectionChange={onSelectionChange}
          readOnly={false}
          locale={locale}
        />
      ) : (
        <DashboardDefaultInspector
          type="dashboard"
          name={name}
          draft={draft}
          onPatch={onPatch}
          onSelectionChange={onSelectionChange}
          readOnly={false}
          locale={locale}
        />
      )}
    </aside>
  );
}

/** The client {@link useDashboardInPageEdit} reads and writes through. */
export type DashboardEditClient = DashboardEditReader & {
  save: (...args: any[]) => Promise<unknown>;
  publish: (...args: any[]) => Promise<unknown>;
  reset: (...args: any[]) => Promise<unknown>;
};

/** The edit state of one dashboard page. */
export interface DashboardInPageEdit {
  /** The document being edited, `null` outside the edit state. */
  draft: Record<string, unknown> | null;
  opening: boolean;
  saving: boolean;
  dirty: boolean;
  selection: MetadataSelection | null;
  revealFilters: boolean;
  /** Enter the edit state; resolves the refusal when it is not entered. */
  open: () => Promise<Extract<DashboardEditOpening, { kind: 'refused' }> | null>;
  discard: () => void;
  /** Save and publish; resolves what the save did, or throws its refusal. */
  save: () => Promise<SaveAndPublishOutcome | 'invalid-body'>;
  patch: (patch: Record<string, unknown>) => void;
  select: (next: MetadataSelection | null) => void;
  addCard: (type: string) => void;
  resize: (widgetId: string, span: { w: number; h: number }) => void;
  reorder: (widgets: unknown) => void;
  requestFilters: () => void;
  filtersRevealed: () => void;
}

/** The edit state's buffer, selection and save. */
export function useDashboardInPageEdit({
  name,
  ownerPackageId,
  client,
  dataSource,
  doors,
}: {
  name: string;
  ownerPackageId: string | null | undefined;
  client: DashboardEditClient;
  dataSource?: object | null;
  doors?: DashboardSaveTargetDoors;
}): DashboardInPageEdit {
  const [session, setSession] = React.useState<{
    target: WritableDashboardSaveTarget;
    draft: Record<string, unknown>;
    dirty: boolean;
  } | null>(null);
  const [opening, setOpening] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [selection, setSelection] = React.useState<MetadataSelection | null>(null);
  const [revealFilters, setRevealFilters] = React.useState(false);

  // Another dashboard on the same route drops the edit state.
  React.useEffect(() => {
    setSession(null);
    setSelection(null);
  }, [name]);

  const update = React.useCallback((fn: (doc: Record<string, unknown>) => Record<string, unknown>) => {
    setSession((s) => (s ? { ...s, draft: fn(s.draft), dirty: true } : s));
  }, []);

  const open = React.useCallback(async () => {
    setOpening(true);
    try {
      const opened = await openDashboardForEdit(name, ownerPackageId, client, doors);
      if (opened.kind === 'refused') return opened;
      setSession({ target: opened.target, draft: opened.doc, dirty: false });
      setSelection(null);
      return null;
    } finally {
      setOpening(false);
    }
  }, [name, ownerPackageId, client, doors]);

  const discard = React.useCallback(() => {
    setSession(null);
    setSelection(null);
    setRevealFilters(false);
  }, []);

  const save = React.useCallback(async (): Promise<SaveAndPublishOutcome | 'invalid-body'> => {
    if (!session) return 'published';
    const body = dashboardSaveBody(session.draft, session.target);
    if (!body) return 'invalid-body';
    setSaving(true);
    try {
      const outcome = await saveDashboardInPlace(name, body, session.target, {
        metadataClient: client,
        dataSource: (dataSource ?? null) as any,
      });
      if (outcome === 'published') {
        setSession(null);
        setSelection(null);
      }
      return outcome;
    } finally {
      setSaving(false);
    }
  }, [session, name, client, dataSource]);

  const addCard = React.useCallback(
    (type: string) => {
      if (!session) return;
      const added = withAddedWidget(session.draft, type);
      setSession({ ...session, draft: added.doc, dirty: true });
      setSelection({ kind: 'widget', id: added.id, label: added.label });
    },
    [session],
  );

  return {
    draft: session?.draft ?? null,
    opening,
    saving,
    dirty: session?.dirty ?? false,
    selection,
    revealFilters,
    open,
    discard,
    save,
    patch: React.useCallback((p: Record<string, unknown>) => update((doc) => ({ ...doc, ...p })), [update]),
    select: setSelection,
    addCard,
    resize: React.useCallback(
      (widgetId: string, span: { w: number; h: number }) => update((doc) => withResizedWidget(doc, widgetId, span)),
      [update],
    ),
    reorder: React.useCallback((widgets: unknown) => update((doc) => ({ ...doc, widgets })), [update]),
    requestFilters: React.useCallback(() => {
      setSelection(null);
      setRevealFilters(true);
    }, []),
    filtersRevealed: React.useCallback(() => setRevealFilters(false), []),
  };
}
