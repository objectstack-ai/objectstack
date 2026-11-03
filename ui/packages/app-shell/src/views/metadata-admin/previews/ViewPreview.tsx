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

function buildFormPreviewSchema(
  objectName: string,
  body: Record<string, unknown>,
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
    // objectstack#29676 — the view's `layout` (`vertical` | `horizontal`, the
    // label above or beside its control). `ObjectForm` and every layout under
    // it read `schema.layout`; this canvas dropped it, so a horizontal view
    // drew stacked in Studio Design and Run while the console drew it beside.
    layout: body.layout,
    showSubmit: false,
    showCancel: false,
  };
}

/**
 * objectstack#29311 — where a served warning on a form view points, said with
 * the section's own authored text: the section's `label` (resolved in the
 * designer `locale`), else its `name`. The path is the item-relative one the
 * server writes (`config.sections.0.fields.1`); `body` is the item's `config`.
 * A path into no section is shown as the server wrote it, and an absent one
 * names nothing.
 */
function warningPlace(path: string | undefined, body: Record<string, unknown>, locale: string | undefined): string | undefined {
  if (!path) return undefined;
  const at = /^config\.sections\.(\d+)(?:\.|$)/.exec(path);
  const section = at && Array.isArray(body.sections) ? (body.sections as unknown[])[Number(at[1])] : undefined;
  if (!section || typeof section !== 'object') return path;
  const s = section as { label?: Parameters<typeof resolveI18nLabel>[0]; name?: unknown };
  const label = resolveI18nLabel(s.label, locale);
  if (label && label.trim()) return label;
  return typeof s.name === 'string' && s.name ? s.name : path;
}

/**
 * objectstack#29311 — a form view's served warnings (a section naming a field
 * its object lacks: the server's `form-field-unknown`), each at the section it
 * points into, in the canvas's existing warn block. The message is the
 * server's, as served. Errors are not this block's: the editor that holds the
 * verdict says those. Nothing is drawn when there are none.
 */
function FormViewWarnings({
  diagnostics,
  body,
  locale,
}: {
  diagnostics: MetadataPreviewProps['diagnostics'];
  body: Record<string, unknown>;
  locale: string | undefined;
}) {
  const warnings = (diagnostics ?? []).filter((d) => d.severity === 'warning');
  if (warnings.length === 0) return null;
  return (
    <PreviewMessage tone="warn">
      <div data-testid="view-form-warnings">
        <div className="font-medium">
          {tFormat('engine.edit.diagnostics.warnTitle', locale, { count: warnings.length })}
        </div>
        <ul className="mt-1 space-y-0.5 text-xs">
          {warnings.map((w, i) => {
            const place = warningPlace(w.path, body, locale);
            return (
              <li key={i} data-testid="view-form-warning" data-path={w.path} className="whitespace-normal break-words">
                {place && <span className="font-medium">{place}: </span>}
                {w.message}
              </li>
            );
          })}
        </ul>
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
    const formSchema = buildFormPreviewSchema(objectName, body as Record<string, unknown>);
    return (
      <PreviewShell hint={`view · ${rawType} · form${designMode ? ' · design' : ''}`}>
        <ViewLabelHeading label={viewLabel} />
        <FormViewWarnings diagnostics={diagnostics} body={body as Record<string, unknown>} locale={locale} />
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
  return (
    <PreviewShell hint={`view · ${defaultViewType}${designMode ? ' · design' : ''}`}>
      <ViewLabelHeading label={viewLabel} />
      <PreviewErrorBoundary fallbackHint={tr('engine.viewPreview.listFailed', locale)}>
        <div className="min-h-[300px] max-h-[75vh] overflow-auto">
          <PreviewModeProvider><SchemaRenderer schema={schema as any} /></PreviewModeProvider>
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}
