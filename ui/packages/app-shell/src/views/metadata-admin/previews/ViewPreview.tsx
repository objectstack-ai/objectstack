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
import { t as tr } from '../i18n.js';
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

/**
 * The protocol's per-kind config blocks on a list view — the keys
 * `ObjectListViewSchema` carries at the top level, and the ones `plugin-view`'s
 * `ObjectView` reads off a named view (its `canonicalViewKindBlocks`).
 */
const VIEW_KIND_BLOCKS = ['kanban', 'calendar', 'gallery', 'timeline', 'gantt', 'map', 'chart', 'tree'] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * objectui#7928 — translate a STORED list body into the named-view shape, at
 * the one door that relays a stored body into `object-view`'s `listViews`.
 *
 * A stored list overlay may carry the legacy per-kind bag `options.KIND`: the
 * protocol declares it on that wire and nowhere else (objectstack#20051), and
 * objectui#10380 ruling A keeps it legal there. The named-view record this body
 * is injected into is the protocol's strict `ObjectListViewSchema`, which
 * refuses `options`, and `plugin-view` no longer reads it off a named view. So
 * the bag is folded here, before the node is built: each `options.KIND` block
 * becomes the top-level `KIND` block, and where both spell a key the TOP-LEVEL
 * value wins — the same per-key merge the objectstack#20051 door describes and the one
 * `ObjectView` applied while it still read the bag. `options` itself is not
 * relayed; the renderer read nothing from it but these blocks.
 *
 * Director ruling on objectui#7928 (comment 5856694523, Q1 A). ⛔ This is the
 * wire → authoring translation for a STORED body only; it is not a tolerance
 * for authored `options`, which the contract refuses by name.
 *
 * A body without `options` is returned as the same object, so nothing changes
 * for the population that never carried the bag.
 */
export function foldStoredListOptions(body: Record<string, unknown>): Record<string, unknown> {
  if (!('options' in body)) return body;
  const { options, ...rest } = body;
  if (!isPlainObject(options)) return rest;
  const folded: Record<string, unknown> = { ...rest };
  for (const kind of VIEW_KIND_BLOCKS) {
    const legacy = options[kind];
    if (!isPlainObject(legacy)) continue;
    const canonical = rest[kind];
    if (canonical === undefined) folded[kind] = { ...legacy };
    else if (isPlainObject(canonical)) folded[kind] = { ...legacy, ...canonical };
    // A top-level value that is not a block wins as written; the record judges it.
  }
  return folded;
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
    showSubmit: false,
    showCancel: false,
  };
}

/** The view's authored `label` as the preview heading; nothing when it is unauthored or empty. */
function ViewLabelHeading({ label }: { label: string | undefined }) {
  if (!label || !label.trim()) return null;
  return <h3 className="border-b px-3 py-2 text-sm font-medium text-foreground truncate">{label}</h3>;
}

export function ViewPreview({ name, draft, editing, locale }: MetadataPreviewProps) {
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
  // view (with unsaved edits) rather than the object's saved default. The body
  // is a STORED ViewItem config, so a legacy `options.KIND` bag is folded onto
  // the top-level blocks first (`foldStoredListOptions`, objectui#7928).
  const { listViews, defaultViewId, defaultViewType } = React.useMemo(() => {
    if (!body) {
      return { listViews: {}, defaultViewId: undefined, defaultViewType: 'grid' };
    }
    const id = String(name) || 'default';
    return {
      listViews: {
        [id]: {
          ...foldStoredListOptions(body),
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
