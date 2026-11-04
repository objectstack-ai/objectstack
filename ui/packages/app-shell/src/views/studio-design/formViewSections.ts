// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30057 — the Studio form designer's model of a FORM VIEW's
 * layout: the view's `sections` (`FormSectionSchema`, `@objectstack/spec/ui`)
 * read as an ordered list of drop zones, and written back from the
 * designer's container map.
 *
 * Why it exists: when the object has a form view the app opens
 * (`selectRecordFormView`), the create and edit dialogs render THAT view's
 * sections, never the object's `fieldGroups`. The designer therefore edits
 * those sections, through these helpers, and the object's `fieldGroups` only
 * when no such view exists (`object-fields-io`).
 *
 * The shape already holds everything the designer arranges, so no key is
 * added: a section's `fields` are its members in order, `label` its heading,
 * `columns` its own per-row count, and a field the view lists in no section is
 * not on the form at all. What the designer does not arrange rides back as it
 * was: every other key of a section, every key of a field entry
 * (`{ field, required, … }`), and every entry whose field the canvas does not
 * show (a hidden system field, a name the object no longer declares).
 *
 * A section that points `group` at one of the object's field groups (the
 * ADR-0085 §5 reference form) inherits that group's members and heading. It
 * is shown with them, and is written back untouched while its members are; a
 * drag that changes them writes the members out (`name` = the group key,
 * `label` = the group's label, `fields`), because the spec refuses `fields`
 * beside `group`.
 */

import { genGroupKey, type ObjectFieldGroup } from '../metadata-admin/previews/object-fields-io.js';

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Where a form view item keeps its body: the record shape (`{ name, object,
 * viewKind, config }`) under `config`; a flat overlay is its own body. The
 * same discriminant `MetadataProvider`'s `viewItemBody` asks.
 */
export function formViewBodyOf(row: Row): Row {
  return isRow(row.config) ? row.config : row;
}

/** The view's sections, objects only, in order; `[]` when it declares none. */
export function formViewSectionsOf(row: Row | null | undefined): Row[] {
  if (!row) return [];
  const sections = formViewBodyOf(row).sections;
  return Array.isArray(sections) ? sections.filter(isRow) : [];
}

/** `row` with its body's `sections` replaced, every other key kept. */
export function withFormViewSections(row: Row, sections: Row[]): Row {
  if (isRow(row.config)) return { ...row, config: { ...row.config, sections } };
  return { ...row, sections };
}

/**
 * A section's key on the canvas: its `name`, else its place (`#0`, `#1`, …).
 * A place key is never written: an unnamed section stays unnamed.
 */
export function formSectionKey(section: Row, index: number): string {
  return typeof section.name === 'string' && section.name ? section.name : `#${index}`;
}

/** The field a section entry names: a bare name, or an entry's `field`; `null` for neither. */
export function formSectionFieldName(entry: unknown): string | null {
  if (typeof entry === 'string') return entry || null;
  if (isRow(entry) && typeof entry.field === 'string' && entry.field) return entry.field;
  return null;
}

/** The field group a section references (`group`), `null` for a section that lists its own fields. */
function referencedGroup(section: Row): string | null {
  return typeof section.group === 'string' && section.group ? section.group : null;
}

/** One section as the canvas draws it. */
export interface FormSectionSlot {
  key: string;
  /** The heading as authored (a referenced group's label for a `group` section). */
  label: string;
  /** The `name` translations address, `undefined` for an unnamed section. */
  name?: string;
  /** The section's own `columns`, `undefined` when it declares none. */
  columns?: number;
}

/** The sections as canvas slots, in order. `groups` are the object's field groups. */
export function formSectionSlots(sections: readonly Row[], groups: readonly ObjectFieldGroup[]): FormSectionSlot[] {
  return sections.map((section, i) => {
    const ref = referencedGroup(section);
    const group = ref ? groups.find((g) => g.key === ref) : undefined;
    const name = ref ?? (typeof section.name === 'string' && section.name ? section.name : undefined);
    const label = group ? group.label || group.key : typeof section.label === 'string' ? section.label : '';
    const columns = typeof section.columns === 'number' ? section.columns : Number(section.columns) || undefined;
    return { key: formSectionKey(section, i), label: label || name || '', name, columns };
  });
}

/**
 * The fields each section holds, by section key, among `shown` (the fields
 * the canvas draws, in object order): a section's own entries, or a `group`
 * section's members (the shown fields whose `group` is its key). A field two
 * sections list is drawn in the first. `groupOf` reads a field's `group`.
 */
export function formSectionMembers(
  sections: readonly Row[],
  shown: readonly string[],
  groupOf: (field: string) => string | undefined,
): Map<string, string[]> {
  const shownSet = new Set(shown);
  const placed = new Set<string>();
  const out = new Map<string, string[]>();
  sections.forEach((section, i) => {
    const ref = referencedGroup(section);
    const names = ref
      ? shown.filter((f) => groupOf(f) === ref)
      : (Array.isArray(section.fields) ? section.fields : []).map(formSectionFieldName);
    const list: string[] = [];
    for (const name of names) {
      if (!name || !shownSet.has(name) || placed.has(name)) continue;
      placed.add(name);
      list.push(name);
    }
    out.set(formSectionKey(section, i), list);
  });
  return out;
}

/**
 * The sections a drop leaves: each section's shown fields replaced by
 * `layout[key]` in its order, the entry each field had kept as it was (a new
 * member enters as `{ field }`), and the entries the canvas does not show kept
 * after them. A field `layout` places in no section leaves the form. A `group`
 * section whose members are unchanged is returned as it was.
 */
export function writeFormSectionLayout(
  sections: readonly Row[],
  layout: ReadonlyMap<string, readonly string[]>,
  shown: readonly string[],
  groups: readonly ObjectFieldGroup[],
  groupOf: (field: string) => string | undefined,
): Row[] {
  const shownSet = new Set(shown);
  const entryOf = new Map<string, unknown>();
  for (const section of sections) {
    for (const entry of Array.isArray(section.fields) ? section.fields : []) {
      const name = formSectionFieldName(entry);
      if (name && !entryOf.has(name)) entryOf.set(name, entry);
    }
  }
  const before = formSectionMembers(sections, shown, groupOf);
  return sections.map((section, i) => {
    const key = formSectionKey(section, i);
    const next = [...(layout.get(key) ?? [])];
    const ref = referencedGroup(section);
    if (ref) {
      const was = before.get(key) ?? [];
      if (was.length === next.length && was.every((f, j) => f === next[j])) return section;
      const group = groups.find((g) => g.key === ref);
      const rest: Row = { ...section };
      delete rest.group;
      return { ...rest, name: ref, label: group?.label || ref, fields: next.map((f) => ({ field: f })) };
    }
    const kept = (Array.isArray(section.fields) ? section.fields : []).filter((entry) => {
      const name = formSectionFieldName(entry);
      return !name || !shownSet.has(name);
    });
    return { ...section, fields: [...next.map((f) => entryOf.get(f) ?? { field: f }), ...kept] };
  });
}

/** Append an empty section named after `label` (a snake_case `name` no section holds). */
export function addFormSection(sections: readonly Row[], label: string): Row[] {
  const clean = label.trim() || 'New section';
  const taken = sections.map((s, i) => formSectionKey(s, i));
  return [...sections, { name: genGroupKey(clean, taken), label: clean, fields: [] }];
}

/** Relabel the section at `key`; a `group` section's heading is its group's, so it is left alone. */
export function renameFormSection(sections: readonly Row[], key: string, label: string): Row[] {
  const clean = label.trim();
  if (!clean) return [...sections];
  return sections.map((s, i) => (formSectionKey(s, i) === key && !referencedGroup(s) ? { ...s, label: clean } : s));
}

/** Move the section at `key` one place up (`-1`) or down (`1`). */
export function moveFormSection(sections: readonly Row[], key: string, dir: -1 | 1): Row[] {
  const from = sections.findIndex((s, i) => formSectionKey(s, i) === key);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= sections.length) return [...sections];
  const next = [...sections];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Remove the section at `key`; its fields leave the form. */
export function removeFormSection(sections: readonly Row[], key: string): Row[] {
  return sections.filter((s, i) => formSectionKey(s, i) !== key);
}
