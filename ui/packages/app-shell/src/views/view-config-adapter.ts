// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * view-config-adapter — bridges the runtime ObjectView's flat view shape and
 * the studio inspector's ViewItem draft shape.
 *
 * The runtime ObjectView keeps the active view as a FLAT NamedListView:
 *
 *   { id, label, type, columns, filter, sort, … }
 *
 * (read from the metadata overlay via the adapter's `listViews`).
 *
 * The studio {@link ViewVariantInspector} authors a canonical ViewItem draft
 * (ADR-0017, "Object has-many View"):
 *
 *   { name, object, viewKind: 'list' | 'form', label, config: { type, … } }
 *
 * where the inspector reads/writes the view BODY under `draft.config` and the
 * bound object additionally lives at `config.data.object` for list views.
 *
 * This adapter converts both ways so the runtime panel can host the studio
 * inspector: edits are kept as a ViewItem draft while the panel is open, then
 * flattened back to the runtime view shape on update / save / create (which
 * persist via the metadata draft/publish model).
 */

/** View `type`s that belong to the FORM family (no column list). */
const FORM_FAMILY_TYPES = new Set(['form', 'detail']);

/** Runtime flat view — the shape ObjectView's `activeView` carries. */
export interface RuntimeView {
  id: string;
  label?: string;
  type?: string;
  columns?: unknown[];
  filter?: unknown[];
  sort?: unknown[];
  [key: string]: unknown;
}

/** Studio ViewItem draft — the shape {@link ViewVariantInspector} consumes. */
export interface InspectorViewDraft {
  name: string;
  object: string;
  viewKind: 'list' | 'form';
  label?: string;
  config: Record<string, unknown>;
}

/** True when a view `type` denotes a form-family view. */
function isFormFamilyType(type: unknown): boolean {
  return typeof type === 'string' && FORM_FAMILY_TYPES.has(type);
}

/**
 * Convert a flat runtime view into a studio inspector draft.
 *
 * The whole flat view is denormalised into `config` (so view-type sub-blocks,
 * filter, sort, toolbar flags, … all round-trip), with the bound object
 * mirrored into `config.data.object` — the list body's render binding the
 * inspector reads first. `id` maps to the draft's `name`; the top-level
 * `object` is the canonical FK both list and form inspectors fall back to.
 */
export function runtimeViewToInspectorDraft(
  activeView: RuntimeView,
  objectName: string,
): InspectorViewDraft {
  const type = (activeView.type as string) || 'grid';
  const viewKind: 'list' | 'form' = isFormFamilyType(type) ? 'form' : 'list';
  const label = activeView.label;
  const existingData =
    activeView.data && typeof activeView.data === 'object'
      ? (activeView.data as Record<string, unknown>)
      : undefined;

  return {
    name: activeView.id,
    object: objectName,
    viewKind,
    label,
    config: {
      ...activeView,
      type,
      label,
      columns: Array.isArray(activeView.columns) ? activeView.columns : [],
      data: { ...existingData, object: objectName },
    },
  };
}

/**
 * Read a STORED view body — what a pending-draft read hands the panel to
 * resume — back into the runtime flat view the panel works in.
 *
 * Two shapes reach here, both members of the spec's `view` union:
 *
 * - a ViewItem envelope `{ name, object, viewKind, label, config }` — what the
 *   runtime save and create paths write (objectui#10210). Its body is under
 *   `config`; `name` is the row key, so it is also the runtime `id`; the
 *   row-level keys beside `config` (`isDefault`, `isPinned`, …) ride along so
 *   a resumed draft that is saved again carries them forward.
 * - a flat runtime view — what the config panel wrote before objectui#10210,
 *   still sitting as a pending draft until it is published or discarded. It
 *   is already the runtime shape and is returned as-is.
 *
 * Reading the envelope as if it were flat is what broke the resume: the body
 * nested one level too deep and the draft lost its identity, so the next Save
 * persisted nothing.
 */
export function storedViewToRuntimeView(body: Record<string, unknown>): RuntimeView {
  const config = body.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return body as RuntimeView;
  }
  const { config: _nested, ...item } = body;
  const name = typeof body.name === 'string' ? body.name : '';
  const nested = config as Record<string, unknown>;
  return {
    ...item,
    ...nested,
    id: name,
    name,
    label: (body.label as string | undefined) ?? (nested.label as string | undefined),
  };
}

/**
 * Flatten a studio inspector draft back into the runtime flat view the
 * ObjectView save / update / create handlers consume.
 *
 * The inspector-only `data` wrapper is dropped (the runtime view binds its
 * object via `objectName`, not `config.data.object`); everything else in
 * `config` is preserved. `id` is restored from `draft.name`, and the label
 * prefers the canonical top-level value.
 */
export function inspectorDraftToRuntimeView(
  draft: InspectorViewDraft,
): RuntimeView {
  const config = (draft.config ?? {}) as Record<string, unknown>;
  // Drop the inspector-only `data` wrapper; keep every other body field.
  const body = { ...config };
  delete body.data;
  return {
    ...body,
    id: draft.name,
    label: draft.label ?? (config.label as string | undefined),
  };
}
