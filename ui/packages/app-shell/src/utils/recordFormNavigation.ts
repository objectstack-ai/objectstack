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
import { pickLocalized } from '@object-ui/i18n';

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
 * The form-view body a NAMED form carries (ADR-0017's `viewKind: 'form'`
 * item, flattened): what {@link resolveFormViewChrome} reads for a form that
 * is opened by its own name — a public form, a form an action of type `form`
 * opens, the Setup preview of a form view.
 *
 * ⛔ No record create or edit reads one (objectstack-ai/objectstack#36425): an
 * object's internal form views are not loaded by the console's create dialog,
 * full-page create, action-opened create or edit. Those lay out by the object's
 * `fieldGroups` and follow the rules on its fields.
 */
export interface FormViewDefinition {
  /**
   * The served view item's id (`OBJECT.KEY`), which `MetadataProvider`
   * stamps on every form view it merges (objectstack#30057).
   */
  name?: string;
  /** Layout family declared by the form view (`simple` | `tabbed` | `wizard` | `split`). */
  type?: string;
  /** Curated field sections. */
  sections?: any[];
  /** Field layout direction — see {@link resolveFormViewChrome}. */
  layout?: FormView['layout'];
  /** Per-button visibility and label — see {@link resolveFormViewChrome}. */
  buttons?: FormView['buttons'];
  /** Create-mode initial values — see {@link resolveFormViewChrome}. */
  defaults?: FormView['defaults'];
}

/**
 * The slice of a served object (`useMetadata().objects`) the record create
 * and edit forms read for their layout: its name, and the child collections
 * its field groups place (`groupSubforms`, derived by `MetadataProvider`'s
 * `attachInlineSubforms` from `fieldGroups[].relatedList`).
 */
export interface ObjectDefinitionForRecordForm {
  name?: string;
  groupSubforms?: any[] | null;
}

/** Which record flow a form host opens. */
export type RecordFormFlow = 'create' | 'edit';

/**
 * The inline child collections (master-detail) a record's create and edit
 * forms carry: the ones the object's field groups place
 * (`fieldGroups[].relatedList`, objectstack#35889), as `MetadataProvider`
 * derives them onto the served object. `undefined` when none.
 *
 * This is the only source. An object's internal form view, and any `subforms`
 * it declares, is no longer read (objectstack-ai/objectstack#36425).
 */
export function recordFormSubforms(
  objectDef: ObjectDefinitionForRecordForm | null | undefined,
): any[] | undefined {
  const subforms = objectDef?.groupSubforms;
  return Array.isArray(subforms) && subforms.length > 0 ? subforms : undefined;
}

/**
 * Whether a record flow asks for `field` (objectstack-ai/objectstack#36425):
 * a field declaring `showOnCreate: false` is left out of every create surface
 * (the create dialog, the full-page create, an action-opened create); an edit
 * asks for it as before. Absent or `true`: asked for.
 */
export function isFieldAskedOnFlow(
  field: { showOnCreate?: unknown } | null | undefined,
  flow: RecordFormFlow,
): boolean {
  return flow !== 'create' || field?.showOnCreate !== false;
}

/**
 * Layout props for the console's create / edit `<ModalForm>`.
 *
 * The layout itself is the object's: `ModalForm` lays the fields out by the
 * object's `fieldGroups` and follows each field's rules. An internal form view
 * steers nothing — not its sections, tabs, wizard steps, `subforms` or
 * `modalSize` (objectstack-ai/objectstack#36425). What is left:
 *
 *   - `subforms`: the child collections the field groups place
 *     ({@link recordFormSubforms});
 *   - `modalSize: 'full'` when the flow surface the host derived is `'full'`
 *     (the phone posture of `deriveRecordFlowSurface`). Otherwise no
 *     `modalSize` key, so `<ModalForm>` sizes the dialog itself.
 */
export interface RecordFormModalLayout {
  subforms?: any[];
  modalSize?: 'full';
}

export function resolveRecordFormModalLayout(
  objectDef: ObjectDefinitionForRecordForm | null | undefined,
  derivedSize: RecordFlowSurface['size'],
): RecordFormModalLayout {
  const layout: RecordFormModalLayout = {};
  const subforms = recordFormSubforms(objectDef);
  if (subforms) layout.subforms = subforms;
  if (derivedSize === 'full') layout.modalSize = 'full';
  return layout;
}

/**
 * The form chrome a console form host draws (objectstack-ai/objectstack#26843),
 * ready to spread into an `<ObjectForm>` or `<ModalForm>` schema: the action
 * buttons' visibility and labels, the field layout, and a create's opening
 * values. A named form takes it from its own definition
 * ({@link resolveFormViewChrome}); a record create or edit from the console's
 * defaults ({@link resolveRecordFormChrome}).
 */
export interface FormViewChrome {
  showSubmit: boolean;
  submitText: string;
  showCancel: boolean;
  cancelText: string;
  layout: 'vertical' | 'horizontal';
  /** Omitted when the flow opens with no values (an edit, or a bare create). */
  initialValues?: Record<string, unknown>;
}

/**
 * The opening values of a create that carries both a form view's `defaults`
 * and the host's own values, per `defaults` payload. The forms re-seed whenever
 * `initialValues` is a new object, so a merge rebuilt per render would wipe
 * what the user typed. The cache keys on the metadata payload and on the
 * host's values by CONTENT, never on a memoised identity (ui/AGENTS.md #10).
 */
const mergedCreateValues = new WeakMap<object, { key: string; values: Record<string, unknown> }>();

function createSeed(
  defaults: Record<string, unknown> | undefined,
  createValues: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!defaults || Object.keys(defaults).length === 0) return createValues;
  if (!createValues) return defaults;
  let key: string;
  try {
    key = JSON.stringify(createValues);
  } catch {
    return { ...defaults, ...createValues };
  }
  const hit = mergedCreateValues.get(defaults);
  if (hit && hit.key === key) return hit.values;
  const values = { ...defaults, ...createValues };
  mergedCreateValues.set(defaults, { key, values });
  return values;
}

/**
 * Resolve the {@link FormViewChrome} of a named form view (the Setup preview
 * of a form view reads it this way, so the canvas and a named form agree).
 *
 * Every console form host used to hard-set these props — `showSubmit: true`,
 * its own submit label, `layout: 'vertical'` — over the keys the form view
 * declares, so an authored `buttons`, `layout` or `defaults` saved, published
 * and never rendered. No flat `showSubmit` / `submitText` key is an author's
 * (the spec's form view refuses them), so the host's values are console
 * defaults and the author's keys win:
 *
 *   - `buttons.submit` / `buttons.cancel`: an authored `show` over the host's
 *     `true`; an authored `label`, an `I18nLabel` resolved against `language`,
 *     over the host's label. A form has no reset button: the spec refuses
 *     `buttons.reset` (objectstack-ai/objectstack#27153).
 *   - `layout`: the authored value when the spec's enum allows it, else
 *     `'vertical'`, the renderer default.
 *   - `defaults`, on a create only: the opening values under the ones the host
 *     already carries (`createValues`: a URL prefill, a parent pre-link, a
 *     seeded day), which win per field.
 */
export function resolveFormViewChrome(
  formView: FormViewDefinition | null | undefined,
  opts: {
    flow: RecordFormFlow;
    /** The UI language an authored `I18nLabel` resolves against. */
    language: string;
    /** The host's submit label when the form view authors none. */
    submitText: string;
    /** The host's cancel label when the form view authors none. */
    cancelText: string;
    /** The values the host opens a create with, if any. */
    createValues?: Record<string, unknown>;
  },
): FormViewChrome {
  const { submit, cancel } = formView?.buttons ?? {};
  const layout = formView?.layout !== undefined
    && FormViewSchema.shape.layout.safeParse(formView.layout).success
    ? formView.layout
    : undefined;
  const chrome: FormViewChrome = {
    showSubmit: submit?.show ?? true,
    submitText: pickLocalized(submit?.label, opts.language) || opts.submitText,
    showCancel: cancel?.show ?? true,
    cancelText: pickLocalized(cancel?.label, opts.language) || opts.cancelText,
    layout: layout ?? 'vertical',
  };
  const defaults = formView?.defaults && typeof formView.defaults === 'object' && !Array.isArray(formView.defaults)
    ? formView.defaults
    : undefined;
  const initialValues = opts.flow === 'create'
    ? createSeed(defaults, opts.createValues)
    : opts.createValues;
  if (initialValues) chrome.initialValues = initialValues;
  return chrome;
}

/**
 * The {@link FormViewChrome} of a record create or edit
 * (objectstack-ai/objectstack#36425): the host's own buttons and labels, the
 * vertical layout, and on a create the values the host opens it with (a URL
 * prefill, a parent pre-link, a seeded day). No internal form view's
 * `buttons`, `layout` or `defaults` is read; a create's opening values beyond
 * the host's come from each field's `defaultValue`, which the form applies.
 */
export function resolveRecordFormChrome(opts: {
  flow: RecordFormFlow;
  submitText: string;
  cancelText: string;
  createValues?: Record<string, unknown>;
}): FormViewChrome {
  return resolveFormViewChrome(null, { ...opts, language: '' });
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
