// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio → Data → an object → Form → Public forms (objectstack#36444): the
 * design half of public forms, as data. A public form is a form view item of
 * its object (`viewKind: 'form'`) whose `sharing` opens it to anonymous
 * intake (`anonymousFormIntakeCandidates`, `@objectstack/spec/ui`). No new
 * metadata shape: the designer reads and writes that item.
 *
 * This module is the designer's rules, free of React:
 *
 * - which of the object's fields a form may hold ({@link fillableFields}):
 *   none that is hidden, read-only, a system field, a formula, a roll-up or an
 *   auto-number, since nobody filling the form in could give it a value;
 * - which fields the form must keep ({@link objectRequiredFields}): a field the
 *   object requires, and fills in for nobody, cannot be removed, or no
 *   submission could be saved;
 * - the form as the designer edits it ({@link PublicFormModel}), read from the
 *   item ({@link publicFormModelOf}) and written back into it
 *   ({@link publicFormItemOf}), keeping every key the designer does not edit;
 * - the address rule ({@link addressProblem}): a slug of lowercase letters,
 *   digits and hyphens that no other form of the environment uses.
 */

import { anonymousFormIntakeCandidates, anonymousFormObjectName, publicFormSlug } from '@objectstack/spec/ui';
import { STUDIO_SYSTEM_FIELD_NAMES } from '../DataPillarHelpers.js';

type FormDoc = Record<string, any>;

const isDoc = (v: unknown): v is FormDoc => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A field type nobody filling a form in can give a value to. */
const COMPUTED_FIELD_TYPES: ReadonlySet<string> = new Set(['formula', 'summary', 'autonumber']);

/** One field of the object, as the designer offers it. */
export interface DesignerField {
  name: string;
  label: string;
  type: string;
  /**
   * The object requires it and nothing fills it in for a submission that
   * leaves it out: the form must keep it, and it is always required on the form.
   */
  objectRequired: boolean;
}

/**
 * Whether a record written without the field would be refused: the object
 * requires it and gives it no value of its own (a `defaultValue`, or a choice
 * option marked `default: true`, which the write path falls back to).
 */
export function isRequiredWithoutDefault(def: Readonly<FormDoc>): boolean {
  if (def.required !== true) return false;
  if (def.defaultValue !== undefined && def.defaultValue !== null && def.defaultValue !== '') return false;
  const options = Array.isArray(def.options) ? def.options : [];
  return !options.some((o: unknown) => isDoc(o) && o.default === true);
}

/** The object's fields as `[name, definition]` pairs, from `fields` as a map or an array. */
function fieldEntries(objectDef: unknown): Array<[string, FormDoc]> {
  const fields = isDoc(objectDef) ? objectDef.fields : undefined;
  if (Array.isArray(fields)) {
    return fields.filter(isDoc).filter((f) => typeof f.name === 'string').map((f) => [f.name as string, f]);
  }
  if (isDoc(fields)) return Object.entries(fields).filter((e): e is [string, FormDoc] => isDoc(e[1]));
  return [];
}

/** Whether a field of the object can be filled in on a form. */
export function isFillableField(name: string, def: Readonly<FormDoc>): boolean {
  if (STUDIO_SYSTEM_FIELD_NAMES.has(name)) return false;
  if (def.system === true || def.hidden === true || def.readonly === true) return false;
  return !COMPUTED_FIELD_TYPES.has(text(def.type));
}

/** The object's fields a public form may hold, in the object's order. */
export function fillableFields(objectDef: unknown): DesignerField[] {
  return fieldEntries(objectDef)
    .filter(([name, def]) => isFillableField(name, def))
    .map(([name, def]) => ({
      name,
      label: text(def.label) || name,
      type: text(def.type) || 'text',
      objectRequired: isRequiredWithoutDefault(def),
    }));
}

/** The fillable fields the object requires: every public form of it must hold them. */
export function objectRequiredFields(objectDef: unknown): string[] {
  return fillableFields(objectDef).filter((f) => f.objectRequired).map((f) => f.name);
}

/** One field on the form. */
export interface PublicFormFieldEntry {
  field: string;
  required: boolean;
}

/** One named section of the form. */
export interface PublicFormSection {
  /** The section's stable key (`name`). */
  key: string;
  label: string;
  fields: PublicFormFieldEntry[];
}

/** The public form as the designer edits it. */
export interface PublicFormModel {
  /** The view item's name: `<object>.<key>`. */
  name: string;
  object: string;
  title: string;
  description: string;
  /** The address slug (`/f/<slug>`). */
  slug: string;
  /** Whether the form takes submissions (`sharing.enabled`); switched in Setup, kept as it is here. */
  enabled: boolean;
  sections: PublicFormSection[];
  /** What the person sees after submitting (`submitBehavior: { kind: 'thank-you' }`). */
  thankYouTitle: string;
  thankYouMessage: string;
}

/** The slug a `publicLink` names, or `''`. */
function slugOf(sharing: unknown): string {
  return isDoc(sharing) && typeof sharing.publicLink === 'string' ? publicFormSlug(sharing.publicLink) : '';
}

/**
 * Whether a view item is a public form: a form item whose form opens to
 * anonymous intake once switched on (the listing rule of Setup's page, so the
 * two surfaces list the same forms).
 */
export function isPublicFormItem(item: unknown): item is FormDoc {
  if (!isDoc(item) || item.viewKind !== 'form' || !isDoc(item.config) || typeof item.name !== 'string') return false;
  const on = { ...item, config: { ...item.config, sharing: { ...(isDoc(item.config.sharing) ? item.config.sharing : {}), enabled: true } } };
  return anonymousFormIntakeCandidates(on).some((c) => c.key === item.name);
}

/** The object a public form item submits into. */
export function publicFormObjectOf(item: FormDoc): string | undefined {
  return anonymousFormObjectName(item, item.config);
}

/**
 * The name a form is shown by, in the words its author gave it: the served
 * (translated) label, else the form's title or label, else the label of its
 * first section (what the form's own page heads it with), else its name
 * without the object prefix (`crm_lead.web_to_lead` → `web_to_lead`). Setup's
 * list names forms the same way.
 */
export function publicFormShownName(item: Readonly<FormDoc>): string {
  const config: FormDoc = isDoc(item.config) ? item.config : {};
  const first = Array.isArray(config.sections) ? config.sections.find(isDoc) : undefined;
  const name = text(item.name);
  const dot = name.lastIndexOf('.');
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
  return (
    pick(item.label) ??
    pick(config.title) ??
    pick(config.label) ??
    pick(first?.label) ??
    (dot >= 0 && dot < name.length - 1 ? name.slice(dot + 1) : name)
  );
}

/** A form's stored sections, the objects among them, in order. */
function storedSections(config: FormDoc): FormDoc[] {
  return (Array.isArray(config.sections) ? config.sections : []).filter(isDoc);
}

/**
 * The key of each stored section, in order: its `name`, or for a section
 * stored without one `section_<n>` by its place (never one another section
 * uses). The model and the write-back key sections by the same rule, so an
 * unnamed section is matched with what it stored.
 */
function sectionKeysOf(sections: readonly FormDoc[]): string[] {
  const named = new Set(sections.map((s) => text(s.name)).filter(Boolean));
  const used = new Set<string>();
  return sections.map((s, i) => {
    let key = text(s.name);
    if (!key || used.has(key)) {
      let n = i + 1;
      while (named.has(`section_${n}`) || used.has(`section_${n}`)) n += 1;
      key = `section_${n}`;
    }
    used.add(key);
    return key;
  });
}

/** The designer's model of a public form item. */
export function publicFormModelOf(item: FormDoc): PublicFormModel {
  const config: FormDoc = isDoc(item.config) ? item.config : {};
  const stored = storedSections(config);
  const keys = sectionKeysOf(stored);
  const sections = stored.map((s, i) => ({
    key: keys[i],
    label: text(s.label),
    fields: (Array.isArray(s.fields) ? s.fields : [])
      .map((f: unknown) =>
        typeof f === 'string'
          ? { field: f, required: false }
          : isDoc(f) && typeof f.field === 'string'
            ? { field: f.field, required: f.required === true }
            : null,
      )
      .filter((f: PublicFormFieldEntry | null): f is PublicFormFieldEntry => f !== null),
  }));
  const thankYou = isDoc(config.submitBehavior) && config.submitBehavior.kind === 'thank-you' ? config.submitBehavior : {};
  return {
    name: String(item.name),
    object: publicFormObjectOf(item) ?? text(item.object),
    title: text(config.title) || text(item.label),
    description: text(config.description),
    slug: slugOf(config.sharing),
    enabled: isDoc(config.sharing) && config.sharing.enabled === true,
    sections,
    thankYouTitle: text(thankYou.title),
    thankYouMessage: text(thankYou.message),
  };
}

/**
 * A section's stored body, keeping the keys the designer does not edit.
 * `was` is the section as stored (by the same key); `fieldsWas` every field
 * entry the form stored, so a field moved to another section keeps its own
 * keys. A label the designer shows as it was (including one stored as a map
 * of translations, which it shows empty) is kept as stored.
 */
function sectionBody(section: PublicFormSection, was: FormDoc | undefined, fieldsWas: ReadonlyMap<string, FormDoc>): FormDoc {
  const body: FormDoc = { ...(was ?? {}), name: section.key, fields: section.fields.map((f) => {
    const entry: FormDoc = { ...(fieldsWas.get(f.field) ?? {}), field: f.field };
    if (f.required) entry.required = true;
    else delete entry.required;
    return entry;
  }) };
  if (was && section.label === text(was.label)) return body;
  if (section.label) body.label = section.label;
  else delete body.label;
  return body;
}

/**
 * The view item a model is saved as. `base` is the item as its author stored
 * it (the layered read, untranslated), or `null` for a new form: every key the
 * designer does not edit is kept as it is, and a text the designer did not
 * change (its title, description, after-submit message, a section's label) is
 * kept as stored, even one stored as a map of translations.
 */
export function publicFormItemOf(model: PublicFormModel, base: FormDoc | null): FormDoc {
  const item: FormDoc = {};
  for (const [key, value] of Object.entries(base ?? {})) if (!key.startsWith('_')) item[key] = value;
  const config: FormDoc = isDoc(item.config) ? { ...item.config } : {};
  // What the designer read from `base`: a text equal to it was not edited.
  const read = base ? publicFormModelOf({ ...base, name: model.name }) : null;
  const stored = storedSections(config);
  const keys = sectionKeysOf(stored);
  const sectionsWas = new Map<string, FormDoc>(stored.map((s, i) => [keys[i], s]));
  const fieldsWas = new Map<string, FormDoc>();
  for (const s of stored) {
    for (const f of Array.isArray(s.fields) ? s.fields : []) {
      if (isDoc(f) && typeof f.field === 'string' && !fieldsWas.has(f.field)) fieldsWas.set(f.field, f);
    }
  }
  config.type = config.type ?? 'simple';
  config.data = isDoc(config.data) ? { ...config.data, object: model.object } : { provider: 'object', object: model.object };
  const titleEdited = !read || model.title !== read.title;
  if (titleEdited) {
    if (model.title) config.title = model.title;
    else delete config.title;
  }
  if (!read || model.description !== read.description) {
    if (model.description) config.description = model.description;
    else delete config.description;
  }
  config.sections = model.sections.map((s) => sectionBody(s, sectionsWas.get(s.key), fieldsWas));
  config.sharing = {
    ...(isDoc(config.sharing) ? config.sharing : {}),
    enabled: model.enabled,
    allowAnonymous: true,
    publicLink: `/forms/${model.slug}`,
  };
  if (!read || model.thankYouTitle !== read.thankYouTitle || model.thankYouMessage !== read.thankYouMessage) {
    const was = isDoc(config.submitBehavior) && config.submitBehavior.kind === 'thank-you' ? config.submitBehavior : null;
    if (model.thankYouTitle || model.thankYouMessage) {
      const thankYou: FormDoc = { ...(was ?? {}), kind: 'thank-you' };
      // Each of the two texts is kept as stored unless it was edited.
      for (const [key, value, before] of [
        ['title', model.thankYouTitle, read?.thankYouTitle],
        ['message', model.thankYouMessage, read?.thankYouMessage],
      ] as const) {
        if (was && value === before) continue;
        if (value) thankYou[key] = value;
        else delete thankYou[key];
      }
      config.submitBehavior = thankYou;
    } else if (was) {
      delete config.submitBehavior;
    }
  }
  item.name = model.name;
  item.object = model.object;
  item.viewKind = 'form';
  if (titleEdited && model.title) item.label = model.title;
  item.config = config;
  return item;
}

/** The fields a model holds, in form order. */
export function fieldsOnForm(model: PublicFormModel): string[] {
  return model.sections.flatMap((s) => s.fields.map((f) => f.field));
}

/** An address slug's shape: lowercase letters, digits and single hyphens, 2 to 64 characters. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What is wrong with an address, or `null`. */
export type AddressProblem = 'empty' | 'shape' | 'taken';

/**
 * Whether `slug` can be this form's address: well formed, and used by no
 * other form of the environment (`taken`: slug → the form that holds it).
 */
export function addressProblem(slug: string, formName: string, taken: ReadonlyMap<string, string>): AddressProblem | null {
  if (!slug) return 'empty';
  if (slug.length < 2 || slug.length > 64 || !SLUG_RE.test(slug)) return 'shape';
  const holder = taken.get(slug);
  return holder !== undefined && holder !== formName ? 'taken' : null;
}

/** Every address the environment's view items use: slug → the form that holds it (switched off included). */
export function takenAddresses(items: readonly unknown[]): Map<string, string> {
  const taken = new Map<string, string>();
  for (const item of items) {
    if (!isDoc(item) || typeof item.name !== 'string' || !isDoc(item.config)) continue;
    const slug = slugOf(item.config.sharing);
    if (slug && !taken.has(slug)) taken.set(slug, item.name);
  }
  return taken;
}

/** A slug made from a title: `Demo signup` → `demo-signup`. */
export function slugFromTitle(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

/** The view item name of a new form of `object` at `slug`: `<object>.<slug, underscored>`. */
export function newPublicFormName(object: string, slug: string): string {
  return `${object}.${slug.replace(/-/g, '_')}`;
}

/** A new public form of `object`: one section holding the fields the object requires. */
export function newPublicFormModel(object: string, title: string, slug: string, objectDef: unknown): PublicFormModel {
  return {
    name: newPublicFormName(object, slug),
    object,
    title,
    description: '',
    slug,
    enabled: true,
    sections: [
      {
        key: 'main',
        label: '',
        fields: objectRequiredFields(objectDef).map((field) => ({ field, required: true })),
      },
    ],
    thankYouTitle: '',
    thankYouMessage: '',
  };
}

// ---------------------------------------------------------------------------
// Edits. Each returns a new model, or the same model when the edit is refused.
// ---------------------------------------------------------------------------

/** Why a field cannot leave the form, or `null`. */
export function removeFieldRefusal(field: string, requiredByObject: ReadonlySet<string>): 'object-required' | null {
  return requiredByObject.has(field) ? 'object-required' : null;
}

/** `model` without `field`: refused (the same model) for a field the object requires. */
export function withoutField(model: PublicFormModel, field: string, requiredByObject: ReadonlySet<string>): PublicFormModel {
  if (removeFieldRefusal(field, requiredByObject)) return model;
  return { ...model, sections: model.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.field !== field) })) };
}

/** `model` with `field` added at the end of section `sectionKey` (first section when absent). */
export function withField(model: PublicFormModel, field: string, sectionKey: string | null, requiredByObject: ReadonlySet<string>): PublicFormModel {
  if (fieldsOnForm(model).includes(field)) return model;
  const sections = model.sections.length > 0 ? model.sections : [{ key: 'main', label: '', fields: [] }];
  const target = sections.find((s) => s.key === sectionKey) ?? sections[0];
  return {
    ...model,
    sections: sections.map((s) =>
      s === target ? { ...s, fields: [...s.fields, { field, required: requiredByObject.has(field) }] } : s,
    ),
  };
}

/** `model` with `field` marked required or not; a field the object requires stays required. */
export function withRequired(model: PublicFormModel, field: string, required: boolean, requiredByObject: ReadonlySet<string>): PublicFormModel {
  const value = requiredByObject.has(field) ? true : required;
  return {
    ...model,
    sections: model.sections.map((s) => ({
      ...s,
      fields: s.fields.map((f) => (f.field === field ? { ...f, required: value } : f)),
    })),
  };
}

/**
 * `model` with `field` moved to `index` of section `sectionKey` (drag and
 * drop, or the move buttons). An index past the end appends.
 */
export function withFieldMoved(model: PublicFormModel, field: string, sectionKey: string, index: number): PublicFormModel {
  let moving: PublicFormFieldEntry | undefined;
  const lifted = model.sections.map((s) => {
    const at = s.fields.findIndex((f) => f.field === field);
    if (at < 0) return s;
    moving = s.fields[at];
    return { ...s, fields: s.fields.filter((_, i) => i !== at) };
  });
  if (!moving || !lifted.some((s) => s.key === sectionKey)) return model;
  return {
    ...model,
    sections: lifted.map((s) => {
      if (s.key !== sectionKey) return s;
      const fields = [...s.fields];
      fields.splice(Math.max(0, Math.min(index, fields.length)), 0, moving!);
      return { ...s, fields };
    }),
  };
}

/** A section key not used by `model`. */
function freshSectionKey(model: PublicFormModel): string {
  const used = new Set(model.sections.map((s) => s.key));
  let n = model.sections.length + 1;
  while (used.has(`section_${n}`)) n += 1;
  return `section_${n}`;
}

/** `model` with a new, empty section named `label` at the end. */
export function withSection(model: PublicFormModel, label: string): PublicFormModel {
  return { ...model, sections: [...model.sections, { key: freshSectionKey(model), label, fields: [] }] };
}

/** `model` with section `sectionKey` renamed. */
export function withSectionLabel(model: PublicFormModel, sectionKey: string, label: string): PublicFormModel {
  return { ...model, sections: model.sections.map((s) => (s.key === sectionKey ? { ...s, label } : s)) };
}

/** `model` with section `sectionKey` moved one place up (-1) or down (+1). */
export function withSectionMoved(model: PublicFormModel, sectionKey: string, step: -1 | 1): PublicFormModel {
  const at = model.sections.findIndex((s) => s.key === sectionKey);
  const to = at + step;
  if (at < 0 || to < 0 || to >= model.sections.length) return model;
  const sections = [...model.sections];
  [sections[at], sections[to]] = [sections[to], sections[at]];
  return { ...model, sections };
}

/**
 * `model` without section `sectionKey`; its fields move to the section before
 * it (or after it, for the first), so removing a section never removes a
 * field. The last section cannot be removed.
 */
export function withoutSection(model: PublicFormModel, sectionKey: string): PublicFormModel {
  const at = model.sections.findIndex((s) => s.key === sectionKey);
  if (at < 0 || model.sections.length < 2) return model;
  const heir = at > 0 ? at - 1 : 1;
  const moved = model.sections[at].fields;
  return {
    ...model,
    sections: model.sections
      .map((s, i) => (i === heir ? { ...s, fields: at > 0 ? [...s.fields, ...moved] : [...moved, ...s.fields] } : s))
      .filter((_, i) => i !== at),
  };
}

/** The object-required fields a model is missing (a form read from elsewhere may lack one). */
export function missingRequiredFields(model: PublicFormModel, requiredByObject: ReadonlySet<string>): string[] {
  const on = new Set(fieldsOnForm(model));
  return [...requiredByObject].filter((f) => !on.has(f));
}

/** What the live preview renders: the runtime form's sections, as `ObjectForm` takes them. */
export function previewSectionsOf(model: PublicFormModel): Array<{ name?: string; label?: string; fields: Array<{ field: string; required?: boolean }> }> {
  // An untitled section is drawn with no heading, as the form's own page draws
  // it: the renderer would head it with its key.
  return model.sections.map((s) => ({
    ...(s.label ? { name: s.key, label: s.label } : {}),
    fields: s.fields.map((f) => (f.required ? { field: f.field, required: true } : { field: f.field })),
  }));
}
