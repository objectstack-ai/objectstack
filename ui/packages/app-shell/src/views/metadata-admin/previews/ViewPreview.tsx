// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ViewPreview — renders a View metadata draft using the same `object-view`
 * SchemaRenderer the runtime ObjectView route uses, with the draft's own
 * `config` body injected as a named `listView` so the preview reflects the
 * unsaved edit (not the last saved version).
 *
 * A view is the canonical first-class **ViewItem** ({ viewKind, config }):
 * one view, one `config` body — there are no in-document variant tabs. An
 * object's *other* views are independent ViewItems surfaced by the view
 * switcher (a query), not nested here.
 *
 * The render path forks on `viewKind`:
 *   - list-family (grid / kanban / calendar / …) → `object-view`, with the
 *     draft body injected as a named listView (below);
 *   - form-family (simple / drawer / …) → `object-form`, with the draft's
 *     sections mapped onto the form schema (a form view binds a record layout,
 *     not a list, so the list renderer would just fall back to a bare grid).
 *
 * A raw single-schema draft (a bare `{ type, … }` with no `config` wrapper,
 * e.g. an ad-hoc preview) is rendered straight through SchemaRenderer.
 *
 * The view's own `label` (objectui#11027) is the preview's heading. It is
 * also relayed as the injected listView's label, but `object-view` draws a
 * named-view tab strip only for two or more entries and this preview always
 * injects one, so that copy never reached the screen. ⛔ The fix is not a
 * one-entry tab strip. The label is the spec's `I18nLabel`, resolved in the
 * designer `locale` through `resolveI18nLabel`; an unauthored label draws no
 * heading, and nothing stands in for it.
 */

import * as React from 'react';
import { SchemaRenderer, PreviewModeProvider } from '@object-ui/react';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import { toInlineFormType } from './form-preview.js';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { PreviewShell, PreviewErrorBoundary, PreviewMessage } from './PreviewShell.js';
import { primaryVariantBinding } from '../view-variant-model.js';
import { t as tr, tFormat } from '../i18n.js';
import { withNodes } from './row-nodes.js';
import { resolveFormViewChrome, type FormViewDefinition } from '../../../utils/recordFormNavigation.js';

/**
 * The object a stored `view` draft is bound to, read under the spellings the
 * spec declares: the row's `object` and its config's `data.object`.
 *
 * objectui#11013 (ruling 甲 on objectstack#20051): `objectName` was read here
 * too, on the body and on the draft. The spec declares it on no `view` member,
 * so the metadata door refuses a row bound by it alone; a draft that carries
 * no declared binding previews as unbound, which is what it is.
 */
export function resolveObjectName(
  draft: Record<string, unknown>,
  body?: Record<string, unknown>,
): string | undefined {
  const candidates: any[] = [
    body?.object,
    (body as any)?.data?.object,
    (draft as any).object,
    (draft as any).data?.object,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
  }
  return undefined;
}

// A ViewItem form section uses the spec's `{ field, readonly, … }` shape, but
// `object-form` selects fields by `name` and reads `readOnly`. Normalize so the
// section's fields resolve (otherwise every section comes up empty).
function toFormFieldEntry(f: unknown): string | Record<string, unknown> {
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object') {
    const o = f as Record<string, unknown>;
    const name = (o.field ?? o.name) as string | undefined;
    if (!name) return o;
    return { ...o, name, readOnly: o.readOnly ?? o.readonly };
  }
  return String(f);
}

/**
 * The `object-form` schema the form view canvas renders from a form view's
 * `config` body: Studio Design and Run both draw through it. Exported for its
 * pin (objectstack#29676); no other module reads it.
 */
export function buildFormPreviewSchema(
  objectName: string,
  body: Record<string, unknown>,
  locale: string | undefined,
): Record<string, unknown> {
  const rawType = typeof body.type === 'string' ? body.type : 'simple';
  const formType = toInlineFormType(rawType);
  const sections = Array.isArray(body.sections)
    ? (body.sections as any[]).map((s) => ({
        ...s,
        fields: Array.isArray(s?.fields) ? s.fields.map(toFormFieldEntry) : [],
      }))
    : undefined;
  return {
    type: 'object-form',
    objectName,
    // A blank create-mode form: the preview shows the layout without needing a
    // sample record to be selected.
    mode: 'create',
    formType,
    sections,
    fields: Array.isArray(body.fields) ? body.fields : undefined,
    // objectstack#29676 — the form view's keys `ObjectForm` and its layouts
    // read, which this canvas dropped, so Studio Design and Run drew a view
    // otherwise than the console does. `layout` (the label above or beside its
    // control) goes through the console form hosts' own mapping,
    // `resolveFormViewChrome`, so the canvas and the runtime read it one way;
    // only its layout is taken, as the canvas draws no submit / cancel and
    // seeds no create values. The rest are read as the record page reads
    // them: `columns` by the field grid, `defaultTab` / `tabPosition` by the
    // tabbed layout, `allowSkip` / `showStepIndicator` by the wizard.
    layout: resolveFormViewChrome(body as FormViewDefinition, {
      flow: 'create',
      language: locale ?? 'en',
      submitText: '',
      cancelText: '',
    }).layout,
    columns: body.columns,
    defaultTab: body.defaultTab,
    tabPosition: body.tabPosition,
    allowSkip: body.allowSkip,
    showStepIndicator: body.showStepIndicator,
    showSubmit: false,
    showCancel: false,
  };
}

/**
 * objectstack#31938 — the item-relative path of a served warning ON a list
 * column, the entry itself or its `field`: what the read's
 * `list-view-field-unknown` pass writes for a column naming a field its
 * object lacks (`config.columns.1.field`; `config.columns.1` for a
 * bare-string column). A position nested inside a column
 * (`config.columns.1.summary.field`) is not the column's own field.
 */
const LIST_COLUMN_WARNING_PATH = /^config\.columns\.(\d+)(?:\.field)?$/;

/**
 * objectstack#29311 — where a served warning on a view points, said with the
 * author's own text. The path is the item-relative one the server writes;
 * `body` is the item's `config`.
 *
 * - Into a form section (`config.sections.0.fields.1`): the section's `label`
 *   (resolved in the designer `locale`), else its `name`.
 * - objectstack#31938 — onto a list column ({@link LIST_COLUMN_WARNING_PATH}):
 *   the column's `label`, else the field it names; a bare-string column is
 *   its field name.
 *
 * A path into neither is shown as the server wrote it, and an absent one
 * names nothing.
 */
function warningPlace(path: string | undefined, body: Record<string, unknown>, locale: string | undefined): string | undefined {
  if (!path) return undefined;
  const column = LIST_COLUMN_WARNING_PATH.exec(path);
  if (column) return columnPlace(body, Number(column[1]), locale) ?? path;
  const at = /^config\.sections\.(\d+)(?:\.|$)/.exec(path);
  const section = at && Array.isArray(body.sections) ? (body.sections as unknown[])[Number(at[1])] : undefined;
  if (!section || typeof section !== 'object') return path;
  const s = section as { label?: Parameters<typeof resolveI18nLabel>[0]; name?: unknown };
  const label = resolveI18nLabel(s.label, locale);
  if (label && label.trim()) return label;
  return typeof s.name === 'string' && s.name ? s.name : path;
}

/** The column at `index` in a list view body, named as {@link warningPlace} says. */
function columnPlace(body: Record<string, unknown>, index: number, locale: string | undefined): string | undefined {
  const column = Array.isArray(body.columns) ? (body.columns as unknown[])[index] : undefined;
  if (typeof column === 'string') return column || undefined;
  if (!column || typeof column !== 'object') return undefined;
  const c = column as { label?: Parameters<typeof resolveI18nLabel>[0]; field?: unknown };
  const label = resolveI18nLabel(c.label, locale);
  if (label && label.trim()) return label;
  return typeof c.field === 'string' && c.field ? c.field : undefined;
}

/**
 * objectstack#31938 — whether a served warning stands on one of the list's
 * own columns. The query projects every column, and the server refuses the
 * whole query for one field the object lacks, so the canvas list could only
 * draw that refusal: the same fact the warnings block already states.
 */
function holdsListCanvas(diagnostics: MetadataPreviewProps['diagnostics']): boolean {
  return (diagnostics ?? []).some(
    (d) => d.severity === 'warning' && !!d.path && LIST_COLUMN_WARNING_PATH.test(d.path),
  );
}

/**
 * objectstack#29311 — a view's served warnings, each at the place it points
 * into ({@link warningPlace}), in the canvas's existing warn block: a form
 * view's `form-field-unknown` at its sections, and (objectstack#31938) a list
 * view's `list-view-field-unknown` at its columns. The message is the
 * server's, as served. Errors are not this block's: the editor that holds the
 * verdict says those. Nothing is drawn when there are none. `held` adds the
 * line saying the list preview waits for the columns to be fixed.
 */
function ViewWarnings({
  kind,
  diagnostics,
  body,
  locale,
  held = false,
}: {
  kind: 'form' | 'list';
  diagnostics: MetadataPreviewProps['diagnostics'];
  body: Record<string, unknown>;
  locale: string | undefined;
  held?: boolean;
}) {
  const warnings = (diagnostics ?? []).filter((d) => d.severity === 'warning');
  if (warnings.length === 0) return null;
  return (
    <PreviewMessage tone="warn">
      <div data-testid={`view-${kind}-warnings`}>
        <div className="font-medium">
          {tFormat('engine.edit.diagnostics.warnTitle', locale, { count: warnings.length })}
        </div>
        <ul className="mt-1 space-y-0.5 text-xs">
          {warnings.map((w, i) => {
            const place = warningPlace(w.path, body, locale);
            return (
              <li key={i} data-testid={`view-${kind}-warning`} data-path={w.path} className="whitespace-normal break-words">
                {place && <span className="font-medium">{place}: </span>}
                {w.message}
              </li>
            );
          })}
        </ul>
        {held && (
          <p data-testid="view-list-preview-held" className="mt-2 text-xs">
            {tr('engine.viewPreview.listHeldForColumns', locale)}
          </p>
        )}
      </div>
    </PreviewMessage>
  );
}

/** The view's authored `label` as the preview heading; nothing when it is unauthored or empty. */
function ViewLabelHeading({ label }: { label: string | undefined }) {
  if (!label || !label.trim()) return null;
  return <h3 className="border-b px-3 py-2 text-sm font-medium text-foreground truncate">{label}</h3>;
}

export function ViewPreview({ name, draft, editing, locale, diagnostics }: MetadataPreviewProps) {
  // The single ViewItem body (`draft.config`), or undefined for a raw schema.
  const body = React.useMemo(
    () => primaryVariantBinding(draft)?.schema,
    [draft],
  );
  const objectName = React.useMemo(
    () => resolveObjectName(draft, body),
    [draft, body],
  );

  const designMode = !!editing;

  const viewLabel = resolveI18nLabel(
    (draft as { label?: Parameters<typeof resolveI18nLabel>[0] }).label,
    locale,
  );

  // Surface the draft body as a named listView so the preview renders THIS
  // view (with unsaved edits) rather than the object's saved default. A stored
  // `options.KIND` bag was folded onto the top-level blocks here
  // (objectui#7928) until #25923: the server now serves a stored row with the
  // bag already folded (the spec's D2 conversion `list-view-options-bag-folded`),
  // and the view door refuses the bag on save.
  const { listViews, defaultViewId, defaultViewType } = React.useMemo(() => {
    if (!body) {
      return { listViews: {}, defaultViewId: undefined, defaultViewType: 'grid' };
    }
    const id = String(name) || 'default';
    return {
      listViews: {
        [id]: {
          ...body,
          label: (body as any).label ?? (draft as any).label ?? name,
        },
      },
      defaultViewId: id,
      defaultViewType: ((body as any).type as string) ?? 'grid',
    };
  }, [body, draft, name]);

  // Hoisted above the early returns below so this hook runs on every render
  // (hook order must stay stable). Only the final `object-view` branch reads it;
  // the earlier branches shadow it with their own local `schema`/`formSchema`.
  const schema = React.useMemo(
    () => ({
      type: 'object-view',
      objectName,
      defaultViewType,
      defaultListView: defaultViewId,
      listViews,
      showSearch: true,
      showFilters: true,
      showCreate: false,
      showViewSwitcher: true,
    }),
    [objectName, defaultViewType, defaultViewId, listViews],
  );

  // -------------------------------------------------------------------------
  // Raw single-schema draft (no ViewItem `config` wrapper): render directly.
  // -------------------------------------------------------------------------
  if (!body && (draft as any).type) {
    const schema = { ...(draft as Record<string, unknown>) };
    return (
      <PreviewShell hint={`view · ${(schema as any).type}${designMode ? ' · design' : ''}`}>
        <PreviewErrorBoundary fallbackHint={tr('engine.viewPreview.schemaFailed', locale)}>
          <div className="min-h-[300px] max-h-[75vh] overflow-auto">
            <PreviewModeProvider><SchemaRenderer schema={schema as any} /></PreviewModeProvider>
          </div>
        </PreviewErrorBoundary>
      </PreviewShell>
    );
  }

  if (!objectName) {
    return (
      <PreviewShell hint={`view${designMode ? ' · design' : ''}`}>
        <ViewLabelHeading label={viewLabel} />
        <PreviewMessage tone="warn">
          {/* The code span names the right panel's field by the label that
              panel shows it under (`ViewVariantInspector`), in the same locale. */}
          {withNodes(tr('engine.viewPreview.noObject', locale), {
            object: <code>{tr('engine.inspector.view.object', locale)}</code>,
          })}
        </PreviewMessage>
      </PreviewShell>
    );
  }

  // -------------------------------------------------------------------------
  // Form-family view (`viewKind: 'form'`): render the record form layout via
  // `object-form`. The list renderer (`object-view`) has no form layout, so a
  // form view routed through it just falls back to a bare grid.
  // -------------------------------------------------------------------------
  if ((draft as any).viewKind === 'form' && body) {
    const rawType = String((body as any).type ?? 'simple');
    const formSchema = buildFormPreviewSchema(objectName, body as Record<string, unknown>, locale);
    return (
      <PreviewShell hint={`view · ${rawType} · form${designMode ? ' · design' : ''}`}>
        <ViewLabelHeading label={viewLabel} />
        <ViewWarnings kind="form" diagnostics={diagnostics} body={body as Record<string, unknown>} locale={locale} />
        <PreviewErrorBoundary fallbackHint={tr('engine.viewPreview.formFailed', locale)}>
          <div className="min-h-[300px] max-h-[75vh] overflow-auto">
            <PreviewModeProvider><SchemaRenderer schema={formSchema as any} /></PreviewModeProvider>
          </div>
        </PreviewErrorBoundary>
      </PreviewShell>
    );
  }

  // -------------------------------------------------------------------------
  // Delegate to `object-view` — the same renderer the runtime route uses —
  // with the draft body injected so the preview reflects unsaved edits.
  // -------------------------------------------------------------------------
  // objectstack#31938 — the list view's served warnings above the canvas. A
  // warning on one of its columns holds the canvas: its query would be
  // refused, and the refusal would repeat the block.
  const held = !!body && holdsListCanvas(diagnostics);
  return (
    <PreviewShell hint={`view · ${defaultViewType}${designMode ? ' · design' : ''}`}>
      <ViewLabelHeading label={viewLabel} />
      {body && (
        <ViewWarnings kind="list" diagnostics={diagnostics} body={body as Record<string, unknown>} locale={locale} held={held} />
      )}
      {!held && (
        <PreviewErrorBoundary fallbackHint={tr('engine.viewPreview.listFailed', locale)}>
          <div className="min-h-[300px] max-h-[75vh] overflow-auto">
            <PreviewModeProvider><SchemaRenderer schema={schema as any} /></PreviewModeProvider>
          </div>
        </PreviewErrorBoundary>
      )}
    </PreviewShell>
  );
}
