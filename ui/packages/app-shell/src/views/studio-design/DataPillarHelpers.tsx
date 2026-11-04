// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Data pillar's helpers: the create dialog's OWD option keys, the added-field
 * names, the system field names, the CEL panel stamps and the form preview
 * source, moved out of `StudioDesignSurface.tsx` unchanged by objectstack#29988
 * (slice 4 of the move-only split).
 */

import type { OwdCreateModel } from './owd-sharing.js';
import { readFields, toFieldNameLoose } from '../metadata-admin/previews/object-fields-io.js';
import { romanizeHan } from '../metadata-admin/romanizeHan.js';
import { isStudioHiddenSystemField } from './studioHiddenSystemField.js';
import { extensionFieldName, type ObjectExtensionBody } from './StudioCustomizeControls.js';

/**
 * The create dialog's OWD options reuse the SETTINGS tab's own label and gloss
 * strings verbatim (`7a90afdf9`). The complaint it answered was that the Settings
 * page "is excellent — four options, each with a plain-language gloss" and that
 * nothing routes the author there; copying the wording rather than writing a
 * second, shorter one is what keeps the two surfaces from drifting into two
 * descriptions of one security baseline.
 */
export const OWD_OPTION_LABEL_KEY: Record<OwdCreateModel, string> = {
  private: 'engine.studio.settings.sharingPrivate',
  public_read: 'engine.studio.settings.sharingPublicRead',
  public_read_write: 'engine.studio.settings.sharingPublicReadWrite',
};
export const OWD_OPTION_DESC_KEY: Record<OwdCreateModel, string> = {
  private: 'engine.studio.settings.sharingDescPrivate',
  public_read: 'engine.studio.settings.sharingDescPublicRead',
  public_read_write: 'engine.studio.settings.sharingDescPublicReadWrite',
};

/** Next unused `field_N` name for a freshly-added field. */
function nextFieldName(existing: string[]): string {
  let i = existing.length + 1;
  let name = `field_${i}`;
  while (existing.includes(name)) name = `field_${++i}`;
  return name;
}

/**
 * The api name of a field added with `label` (objectui#12516): the name the
 * field inspector's Label derives from it (`toFieldNameLoose`, a Chinese label
 * through its pinyin as the popover previewed it — `romanizeHan`), or, as the
 * inspector keeps the default when that derivation is empty (a label with no
 * Latin letters) or names another field, the next free `field_<N>`. The Add
 * field popover asks for the name in those two cases (objectui#13389), so the
 * `field_<N>` fallback is left for a caller that hands no name.
 */
export function addedFieldName(label: string, existing: string[]): string {
  const derived = toFieldNameLoose(romanizeHan(label));
  return derived && !existing.includes(derived) ? derived : nextFieldName(existing);
}

/**
 * objectstack#28575 — {@link addedFieldName} for a customer extension field:
 * the name the Add field popover shows, suffixed (`region__c`), or the next
 * free `field_<N>__c`.
 */
export function addedExtensionFieldName(label: string, existing: string[]): string {
  const derived = extensionFieldName(toFieldNameLoose(romanizeHan(label)).replace(/_+$/, ''));
  if (derived && !existing.includes(derived)) return derived;
  let i = existing.length + 1;
  let name = extensionFieldName(`field_${i}`);
  while (existing.includes(name)) name = extensionFieldName(`field_${++i}`);
  return name;
}

/** objectstack#28575 — an extension body's `fields` map; `{}` when it declares none. */
export function extensionFieldsOf(body: ObjectExtensionBody): Record<string, unknown> {
  const fields = body.fields;
  return fields && typeof fields === 'object' && !Array.isArray(fields) ? (fields as Record<string, unknown>) : {};
}

/**
 * Data pillar — the package's objects: a records grid (Airtable parity) plus
 * table-based field management. Add a field, or click a column header's edit
 * affordance, to open ObjectFieldInspector (full type list + per-type config)
 * in the right panel; changes persist via the object draft → publish overlay.
 */
/**
 * Framework-managed/audit fields. They lead the raw metadata order but aren't
 * what a user manages in a data grid, so the Data pillar drops them from the
 * column set (mirrors ObjectGrid's regular-vs-system split) to open on the
 * meaningful fields first — the same way Airtable hides system columns.
 *
 * objectui#11780 — this list is no longer the only test. The columns the
 * platform injects AND hides (`system: true` + `hidden: true` on the served
 * definition: `__search`, `owning_business_unit_id`, `organization_id`) are
 * dropped by `isStudioHiddenSystemField`, read off each field's definition
 * beside this list. The list keeps its own job: the audit columns are
 * `system` but NOT `hidden` in the platform's own definitions
 * (`AUDIT_FIELD_DEFS`), so the marks alone would put them back.
 */
export const STUDIO_SYSTEM_FIELD_NAMES = new Set<string>([
  '_id', 'id', 'organization_id', 'org_id', 'space_id',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'modified_at', 'modified_by', 'created_time', 'modified_time', 'updated_time',
  'deleted_at', 'deleted_by',
]);

/**
 * The form fields of an object definition's `fields`, in metadata order: the
 * platform's injected-and-hidden fields (objectui#11780) and the audit fields
 * dropped. Read for the draft (`formFields`) and the published baseline.
 */
export function formFieldNames(fields: unknown): string[] {
  return readFields(fields)
    .entries.filter((e) => !isStudioHiddenSystemField(e.def))
    .map((e) => e.name)
    .filter((n) => !STUDIO_SYSTEM_FIELD_NAMES.has(n));
}

/**
 * objectstack#27485 — what the field inspector's CEL verdict on `field` was
 * judged from, as the object draft holds it: the field's type, its CEL texts
 * (`expression`, the legacy `formula`, `visibleWhen`, `readonlyWhen`,
 * `requiredWhen`) and the object's field names its lint resolves references
 * against. The same stamp is the same verdict. `null` when the field is gone.
 */
export function fieldCelStamp(draft: Record<string, unknown>, field: string): string | null {
  const { entries } = readFields(draft.fields);
  const def = entries.find((e) => e.name === field)?.def;
  if (!def) return null;
  const cel = [def.type, def.expression, def.formula, def.visibleWhen, def.readonlyWhen, def.requiredWhen];
  return JSON.stringify([cel.map((v) => v ?? null), entries.map((e) => e.name)]);
}

/** objectstack#27629 — the Data pillar panels that mount a CEL editor and report per item. */
export type CelPanelTab = 'rules' | 'actions';
export const isCelPanelTab = (v: string): v is CelPanelTab => v === 'rules' || v === 'actions';

/** The rule (`rules`) or action (`actions`) named `item` in the object draft. */
export function panelItemOf(draft: Record<string, unknown>, tab: CelPanelTab, item: string): Record<string, unknown> | undefined {
  const list = tab === 'rules' ? draft.validations : draft.actions;
  if (!Array.isArray(list)) return undefined;
  return list.find(
    (e): e is Record<string, unknown> => !!e && typeof e === 'object' && String((e as { name?: unknown }).name ?? '') === item,
  );
}

/**
 * objectstack#27629 — what a panel's CEL verdict on `item` was judged from, as
 * the object draft holds it: the rule or action itself (its guard or
 * predicates among its keys) and the object's field names its lint resolves
 * references against. `fieldCelStamp`'s counterpart for the panel family; the
 * same stamp is the same verdict. `null` when the item is gone.
 */
export function panelItemCelStamp(draft: Record<string, unknown>, tab: CelPanelTab, item: string): string | null {
  const def = panelItemOf(draft, tab, item);
  if (!def) return null;
  return JSON.stringify([def, readFields(draft.fields).entries.map((e) => e.name)]);
}

/** The data-source writes the Form tab's Preview refuses (objectui#12515). */
const PREVIEW_REFUSED_WRITES = new Set<PropertyKey>(['create', 'update', 'delete', 'bulk', 'bulkUpdate', 'bulkDelete']);

/**
 * objectui#12515 — the data source the Form tab's Preview hands the runtime
 * `ObjectForm`, the same renderer the app's record form uses.
 *
 * The form reads the object's definition only through
 * `dataSource.getObjectSchema(name)`. With `draft` given, that read answers for
 * the open object from the pillar's buffer (the draft as served, plus the
 * edits not yet saved), so a draft-only object previews without a server read
 * and a published one previews its pending change. Every other read (another
 * object's definition, a lookup's options) goes to the real adapter.
 *
 * Preview never saves: the writes in `PREVIEW_REFUSED_WRITES` reject, in the
 * Draft and the Published preview alike.
 */
export function formPreviewSource(
  adapter: object | null,
  draft: { name: string; definition: Record<string, unknown> } | null,
): object | null {
  // No adapter, no data source: the form says so, as it does today.
  if (!adapter) return null;
  return new Proxy(adapter, {
    get(target, prop) {
      if (PREVIEW_REFUSED_WRITES.has(prop)) {
        return () => Promise.reject(new Error('The form preview does not save.'));
      }
      if (draft && prop === 'getObjectSchema') {
        const read = Reflect.get(target, prop, target) as ((name: string) => Promise<unknown>) | undefined;
        return (name: string) =>
          name === draft.name
            ? Promise.resolve(structuredClone({ ...draft.definition, name: draft.name }))
            : read
              ? read.call(target, name)
              : Promise.reject(new Error(`No definition for "${name}".`));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
