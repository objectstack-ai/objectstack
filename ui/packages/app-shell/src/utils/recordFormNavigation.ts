/**
 * Resolvers for record-form navigation targets.
 *
 * Pure helpers extracted from `AppContent.tsx` so the routing rules behind
 * the modal-vs-page decision are unit-testable in isolation. Keep this file
 * free of React / router imports — it must run in a node test environment.
 *
 * @module utils/recordFormNavigation
 */

import { FormViewSchema, type FormView } from '@objectstack/spec/ui';
import type { RecordFlowSurface } from '@objectstack/spec/data';

/**
 * Subset of the object metadata shape consumed by the resolver. Mirrors the
 * fields read from the runtime objects list (`useMetadata().objects`).
 */
export interface ObjectDefinitionForNavigation {
  /** API name used in URLs. */
  name: string;
  /** Optional UI mode override for create/edit interactions. */
  editMode?: 'modal' | 'page';
}

/**
 * Result of the modal-vs-page decision. `kind: 'modal'` means the caller
 * should open the global `<ModalForm>`; `kind: 'page'` means the caller
 * should `navigate(url)` to the full-screen create/edit route.
 */
export type RecordFormTarget =
  | { kind: 'modal' }
  | { kind: 'page'; url: string };

/**
 * The record the console's `onEdit` is handed: an existing record (it carries
 * an id), or a NEW one — `null`, or a record with no id, which may carry the
 * values the create form opens with (objectui#12291).
 */
export type RecordFormRecord = { id?: unknown; _id?: unknown; [field: string]: unknown };

/**
 * The values a NEW record carries into the create form (objectui#12291), or
 * `undefined` when there are none to carry.
 *
 * The console's `onEdit` has always read a record without an id as a new one
 * (the list's "New" hands it no record at all). A record without an id that
 * carries field values is a create SEEDED with them: the calendar's empty-day
 * hand-off sends the day that was clicked (its start date field, and its end
 * date field when bound), so the full create form opens with the date set.
 * An existing record carries none — the edit form reads the stored row.
 * `null` / `undefined` entries carry nothing and are dropped.
 */
export function recordFormCreateValues(
  record: RecordFormRecord | null | undefined,
): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const rawId = record.id ?? record._id;
  if (rawId != null && rawId !== '') return undefined;
  const values: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    if (field === 'id' || field === '_id' || value === undefined || value === null) continue;
    values[field] = value;
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

/**
 * The history-state key a seeded create rides on to the record-form OVERLAY
 * (objectui#12291) — the overlay's own create values, beside the `?form=new`
 * that opens it.
 *
 * History state, not a URL param, for the reason the post-create landing in
 * `AppContent` already gives for its `from` origin: the reserved console URL
 * params are a contract (`urlParams.ts`), and a create form's opening values
 * are not something anyone shares or bookmarks. History state still gives what
 * a URL would here: it belongs to the entry the overlay was opened on, so Back
 * closes the overlay with it, and a refresh of that entry restores it.
 */
export const RECORD_FORM_CREATE_VALUES_STATE = 'recordFormCreateValues';

/** The create values a history entry carries for the overlay, if any. */
export function readRecordFormCreateValues(state: unknown): Record<string, unknown> | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const values = (state as Record<string, unknown>)[RECORD_FORM_CREATE_VALUES_STATE];
  return values && typeof values === 'object' && !Array.isArray(values)
    ? (values as Record<string, unknown>)
    : undefined;
}

/**
 * Build a record-form navigation target.
 *
 * Returns:
 *   - `{ kind: 'modal' }` when the object metadata does not opt in to page
 *     mode (default behavior — preserves backward compatibility).
 *   - `{ kind: 'page', url }` when `objectDef.editMode === 'page'`. The
 *     URL points at `/{baseUrl}/{objectName}/new` for create, or
 *     `/{baseUrl}/{objectName}/record/{recordId}/edit` for edit. The
 *     `recordId` is derived from `record.id` or `record._id`, falling
 *     back to create-mode if neither is present. A create seeded with
 *     values ({@link recordFormCreateValues}, objectui#12291) carries them
 *     as the query-string pairs `RecordFormPage` already reads as its
 *     create prefill (`/new?field=value`).
 *
 * Notes:
 *   - Returns `{ kind: 'modal' }` when `objectDef` is missing or has no
 *     `name` — the caller (AppContent) treats this as "no actionable
 *     state" and falls back to the existing modal flow.
 *   - `recordId` is URL-encoded so non-ASCII / reserved characters in
 *     object IDs (e.g. UUIDs with `:` separators) are safe.
 */
export function resolveRecordFormTarget(opts: {
  objectDef: ObjectDefinitionForNavigation | null | undefined;
  baseUrl: string;
  record: RecordFormRecord | null | undefined;
}): RecordFormTarget {
  const { objectDef, baseUrl, record } = opts;

  if (!objectDef?.name || objectDef.editMode !== 'page') {
    return { kind: 'modal' };
  }

  const rawId = record?.id ?? record?._id;
  if (record && rawId != null && rawId !== '') {
    const encoded = encodeURIComponent(String(rawId));
    return {
      kind: 'page',
      url: `${baseUrl}/${objectDef.name}/record/${encoded}/edit`,
    };
  }

  const createValues = recordFormCreateValues(record);
  if (!createValues) return { kind: 'page', url: `${baseUrl}/${objectDef.name}/new` };
  const prefill = new URLSearchParams(
    Object.entries(createValues).map(([field, value]) => [field, String(value)]),
  );
  return { kind: 'page', url: `${baseUrl}/${objectDef.name}/new?${prefill.toString()}` };
}

/**
 * Subset of the default form-view shape consumed by
 * {@link resolveFormViewLayout}. This is the flattened `config` body of the
 * object's default `viewKind: 'form'` ViewItem (ADR-0017), merged onto the
 * object by `MetadataProvider` as `objectDef.form` (and mirrored under
 * `objectDef.formViews.default` for the legacy aggregated-container shape).
 */
export interface FormViewDefinition {
  /**
   * Layout family declared by the form view (`simple` | `tabbed` | `wizard`
   * | `split`). Only `tabbed` changes the *modal's* internal layout; the
   * others still render their curated sections, just stacked.
   */
  type?: string;
  /** Curated field sections — the selection, order, and grouping to render. */
  sections?: any[];
  /** Inline child collections (master-detail). */
  subforms?: any[];
  /** The modal's size bucket, as the spec's `FormView.modalSize` declares it. */
  modalSize?: FormView['modalSize'];
}

/**
 * Object metadata subset carrying the default form view, as merged onto the
 * runtime objects list (`useMetadata().objects`).
 */
export interface ObjectDefinitionForFormView {
  /** API name — the prefix of the object's served form-view names. */
  name?: string;
  form?: FormViewDefinition | null;
  /**
   * The object's form views by served name. A container's named form views
   * arrive as `OBJECT.KEY` (`expandViewContainer` in `@objectstack/spec/ui`,
   * merged by `MetadataProvider`); `default` is the legacy container shape.
   */
  formViews?: Record<string, FormViewDefinition | null | undefined> | null;
}

/**
 * Which record flow a form view is selected for (objectui#13099). A create
 * and an edit can read different form views, so every caller states the
 * flow it opens rather than leaving the resolver to infer it.
 */
export type RecordFormFlow = 'create' | 'edit';

/**
 * Select the form view a record flow renders (objectui#13099, ruling B′ on
 * objectstack-ai/objectstack#24692).
 *
 *   - EDIT (and a caller that names no flow): the default form view —
 *     `objectDef.form`, else the legacy `objectDef.formViews.default`.
 *   - CREATE: the object's `create` form view when it declares one, else that
 *     same default. This is the documented create-vs-edit model: author
 *     `formViews.create` on the view container and the create entry uses it.
 *
 * The `create` form view is looked up under the name it is SERVED by: a
 * container's `formViews.create` expands to the form item `OBJECT.create`
 * (`expandViewContainer` in `@objectstack/spec/ui`), and `MetadataProvider`
 * keys `formViews` by that served name. No other named form view is ever
 * picked for a create — a named form (a public intake form, a wizard) is
 * reached only by its name.
 */
export function selectRecordFormView(
  objectDef: ObjectDefinitionForFormView | null | undefined,
  flow: RecordFormFlow = 'edit',
): FormViewDefinition | undefined {
  if (flow === 'create' && objectDef?.name) {
    const createView = objectDef.formViews?.[`${objectDef.name}.create`];
    if (createView) return createView;
  }
  return objectDef?.form ?? objectDef?.formViews?.default ?? undefined;
}

/**
 * Layout props derived from an object's default form view, ready to spread
 * into a `<ModalForm>` schema.
 */
export interface FormViewModalLayout {
  /** Curated sections to render (omitted when the form view declares none). */
  sections?: any[];
  /** `'tabbed'` when the form view is tabbed; omitted otherwise (stacked). */
  contentLayout?: 'tabbed';
  /** Inline child collections for a master-detail modal. */
  subforms?: any[];
  /**
   * The form view's authored `modalSize` (objectui#12803), copied only when
   * it is a value the spec's `FormView.modalSize` enum allows. Omitted when
   * the form view authors none, so the modal keeps its own default size.
   */
  modalSize?: FormView['modalSize'];
}

/**
 * Resolve a `<ModalForm>`'s layout props from the form view the record flow
 * selects ({@link selectRecordFormView}): the object's DEFAULT FORM VIEW, or
 * for a create its `create` form view when declared (objectui#13099) —
 * curated sections + field selection/order, plus master-detail subforms.
 *
 * The create / edit record modal otherwise falls back to the raw object
 * schema — rendering every field in schema order and ignoring the curated
 * form view entirely. This resolver lets the New/Edit modal honor the same
 * view-driven layout the full-screen record page (`RecordFormPage`) does.
 *
 * The default resolution mirrors `RecordFormPage`: prefer `objectDef.form`
 * (the default ViewItem) and fall back to `objectDef.formViews.default`
 * (legacy container). `flow` is the flow being opened; a caller that names
 * none gets the default form view.
 *
 * Returns an EMPTY object when the object has no form view, or a form view
 * that declares no sections, subforms or `modalSize` — the caller then keeps
 * its existing behavior (a flat field list, i.e. the raw object schema, at the
 * modal's own default size). Empty `sections` / `subforms` arrays are treated
 * as absent so an empty curation never blanks out the form.
 *
 * `modalSize` is copied independently of `sections` (objectui#12803): a form
 * view can size the dialog without curating its fields. Only a value the
 * spec's `FormView.modalSize` enum accepts is copied; the enum is read from
 * `FormViewSchema` itself, so this file keeps no second copy of it. Where the
 * console's create / edit modal combines it with the derived flow surface,
 * see {@link resolveRecordFormModalLayout}.
 */
export function resolveFormViewLayout(
  objectDef: ObjectDefinitionForFormView | null | undefined,
  flow?: RecordFormFlow,
): FormViewModalLayout {
  const formView = selectRecordFormView(objectDef, flow);
  if (!formView) return {};

  const layout: FormViewModalLayout = {};

  if (Array.isArray(formView.sections) && formView.sections.length > 0) {
    layout.sections = formView.sections;
    // Only 'tabbed' maps to a modal content layout; 'wizard'/'split' have no
    // modal equivalent and degrade to a stacked section list.
    if (formView.type === 'tabbed') layout.contentLayout = 'tabbed';
  }

  if (Array.isArray(formView.subforms) && formView.subforms.length > 0) {
    layout.subforms = formView.subforms;
  }

  const authoredSize = formView.modalSize;
  if (authoredSize !== undefined && FormViewSchema.shape.modalSize.safeParse(authoredSize).success) {
    layout.modalSize = authoredSize;
  }

  return layout;
}

/**
 * The layout the console's create / edit `<ModalForm>` is handed: the default
 * form view's layout ({@link resolveFormViewLayout}) with its `modalSize`
 * resolved against the record flow's derived surface (objectui#12803).
 *
 * Precedence, stated here rather than left to spread order:
 *
 *   1. a derived `size: 'full'` — the phone posture of `deriveRecordFlowSurface`
 *      — stays `'full'`. It is a viewport rule, not an authored bucket, so an
 *      authored size never shrinks a phone's full-screen modal;
 *   2. otherwise the form view's authored `modalSize` wins on desktop;
 *   3. otherwise no `modalSize` key at all, so `<ModalForm>` sizes the dialog
 *      itself (its bounded default) exactly as before.
 *
 * `derivedSize` is the `size` of `deriveRecordFlowSurface(objectDef, flow)`
 * for the flow being opened; `flow` selects the form view
 * ({@link selectRecordFormView}, objectui#13099).
 */
export function resolveRecordFormModalLayout(
  objectDef: ObjectDefinitionForFormView | null | undefined,
  derivedSize: RecordFlowSurface['size'],
  flow?: RecordFormFlow,
): FormViewModalLayout {
  const { modalSize: authoredSize, ...layout } = resolveFormViewLayout(objectDef, flow);
  const modalSize = derivedSize === 'full' ? 'full' : authoredSize;
  return modalSize ? { ...layout, modalSize } : layout;
}

/**
 * Result of the post-create-save navigation decision (objectstack-ai/objectstack#2604 save invariant:
 * *create takes you to the record you made*). `kind: 'none'` means stay put
 * (no usable record id came back from the save).
 */
export type PostCreateTarget =
  | { kind: 'none' }
  | { kind: 'detail-page' | 'detail-drawer'; url: string };

/**
 * Decide where a CREATE save lands (objectstack-ai/objectstack#2604): the new record's detail, on the
 * record's own derived surface.
 *
 *   - `surface: 'page'` (field-heavy) → the detail ROUTE
 *     `{baseUrl}/{objectName}/record/{id}` — deep-linkable, and the detail
 *     page's own "← all records" affordance covers the way back.
 *   - `surface: 'drawer'` (light) → the CURRENT list route with
 *     `?recordId={id}` — the detail drawer opens OVER the still-intact list
 *     (ObjectView treats that param as the drawer's source of truth), so the
 *     list context is preserved for free.
 *
 * The `form` overlay param is stripped from the drawer URL so the create
 * overlay does not reopen underneath the drawer. Pure and router-free: the
 * caller derives `surface` (deriveRecordSurface) and performs the navigation
 * (with `replace: true`, so Back skips the transient form state).
 */
export function resolvePostCreateTarget(opts: {
  objectName: string;
  baseUrl: string;
  /** Current location pathname (the list route the create started from). */
  pathname: string;
  /** Current location search (query string, with or without leading `?`). */
  search?: string;
  /**
   * The record's derived VIEW surface (`deriveRecordSurface(objectDef)`).
   * `deriveRecordSurface` only ever emits `'page'` / `'drawer'`; `'modal'` is
   * accepted (spec widened `RecordSurface` to include it) and treated like a
   * drawer — this helper only branches page-vs-not-page.
   */
  surface: 'page' | 'drawer' | 'modal';
  /** Saved record id (`result.id ?? result._id`). */
  recordId: unknown;
}): PostCreateTarget {
  const { objectName, baseUrl, pathname, search, surface, recordId } = opts;
  if (recordId == null || recordId === '' || !objectName) return { kind: 'none' };
  const encoded = encodeURIComponent(String(recordId));

  if (surface === 'page') {
    return { kind: 'detail-page', url: `${baseUrl}/${objectName}/record/${encoded}` };
  }

  const sp = new URLSearchParams(search ?? '');
  sp.delete('form');
  sp.set('recordId', String(recordId));
  return { kind: 'detail-drawer', url: `${pathname}?${sp.toString()}` };
}

/**
 * Action descriptor accepted by the navigate-create / navigate-edit
 * handlers: the runner's `ActionDef` as the handler receives it, NOT the
 * authored node. Loose-typed because the same shape is constructed
 * dynamically at runtime.
 *
 * `params` here is the runner's static-values channel. On an authored
 * `action:button` / `action:icon` node those values are written under
 * `properties.params`, which the renderer forwards as this `params`
 * (objectui#10289, ruling A). A node-level `params` is only ever the
 * `ActionParam[]` input list, and an object written there is not forwarded.
 */
export interface NavigationActionDef {
  /** Optional explicit object name (overrides any context). */
  objectName?: string;
  /** Optional explicit record id (only meaningful for `navigate_edit`). */
  recordId?: string | number;
  /**
   * The runner's static values: the authored node's `properties.params`,
   * forwarded by the action renderer. Preferred location for
   * objectName / recordId.
   */
  params?: {
    objectName?: string;
    recordId?: string | number;
    [key: string]: any;
  };
}

/**
 * Optional context typically supplied by an `ActionRunner` (e.g. when the
 * action button is mounted inside an `ObjectView`, the view registers its
 * `objectName` and `baseUrl` on the runner so action JSON can omit them).
 *
 * Tolerant of additional unknown keys because the upstream
 * `ActionRunner.getContext()` returns a generic `ActionContext` with an
 * open index signature; we only read the two fields we care about.
 */
export interface NavigationActionContext {
  objectName?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export type NavigationActionResult =
  | { success: true; url: string }
  | { success: false; error: string };

/**
 * Resolve the URL for a `navigate_create` action.
 *
 * Order of precedence for `objectName`:
 *   1. `action.params.objectName`
 *   2. `action.objectName`
 *   3. `context.objectName`
 *
 * `baseUrl` falls back to `context.baseUrl`, then to the supplied
 * `defaultBaseUrl` (typically `/apps/{appName}`).
 *
 * Returns `{ success: false }` with a descriptive error when `objectName`
 * cannot be resolved — the caller (`ActionRunner`) surfaces this to the UI.
 */
export function resolveNavigateCreateUrl(opts: {
  action: NavigationActionDef;
  context?: NavigationActionContext;
  defaultBaseUrl: string;
}): NavigationActionResult {
  const { action, context = {}, defaultBaseUrl } = opts;
  const objectName =
    action.params?.objectName ?? action.objectName ?? context.objectName;
  const baseUrl = context.baseUrl ?? defaultBaseUrl;
  if (!objectName) {
    return {
      success: false,
      error: 'navigate_create: objectName is required',
    };
  }
  return { success: true, url: `${baseUrl}/${objectName}/new` };
}

/**
 * Resolve the URL for a `navigate_edit` action.
 *
 * Same `objectName` precedence as {@link resolveNavigateCreateUrl}.
 * `recordId` is read from `action.params.recordId` or `action.recordId`
 * (no context fallback — record ids are intrinsically per-action).
 *
 * Returns `{ success: false }` with a descriptive error when either
 * `objectName` or `recordId` is missing.
 */
export function resolveNavigateEditUrl(opts: {
  action: NavigationActionDef;
  context?: NavigationActionContext;
  defaultBaseUrl: string;
}): NavigationActionResult {
  const { action, context = {}, defaultBaseUrl } = opts;
  const objectName =
    action.params?.objectName ?? action.objectName ?? context.objectName;
  const recordId = action.params?.recordId ?? action.recordId;
  const baseUrl = context.baseUrl ?? defaultBaseUrl;
  if (!objectName || recordId == null || recordId === '') {
    return {
      success: false,
      error: 'navigate_edit: objectName and recordId are required',
    };
  }
  const encoded = encodeURIComponent(String(recordId));
  return {
    success: true,
    url: `${baseUrl}/${objectName}/record/${encoded}/edit`,
  };
}
