// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35901, epic #35896] Where an object extension's own items go: the one
 * application of `ObjectExtensionSchema.place`, run by the registry fold
 * (`foldExtendersOntoDefinition`) after every contributor's fields are merged,
 * so the record page, the forms and Studio read one arrangement.
 *
 * Three passes, in this order, each over the extensions in ascending
 * `priority` and then package id (so two packages at one anchor come out in
 * the same order on every build):
 *
 *  1. groups — a field group the extension adds, spliced into the object's
 *     `fieldGroups` after / before one of its groups, or last;
 *  2. fields — a field the extension adds, spliced into a group's member list
 *     after / before a member, or last in the group. A group that lists no
 *     `fields` gets its current members (the fields whose `group` names it,
 *     in declaration order) written out on the served copy first, so its own
 *     order does not move; the placed field's `group` is set to the group;
 *  3. lists — a child list of the extension's package, spliced into the
 *     object's `relatedLists` after / before a tab, or at the end of the tabs
 *     (before a trailing approvals / activity-stream tab).
 *
 * Several items at one anchor keep reading order: after an anchor they follow
 * it lowest priority first; before an anchor they precede it lowest priority
 * first. An anchor the object does not have puts the item at the end and is
 * named. An item the object (or the base the fold starts from) already
 * arranges keeps that position, silently: the owner's position wins, and a
 * body that already carries the placements re-folds to itself.
 *
 * Nothing here drops an item from the object: a placement that does not apply
 * leaves the item where the merge put it (the field among the fields, the
 * list in the automatic tab order) and is named once.
 */

import { readFieldGroupMembership, relatedListEntryName } from '@objectstack/spec/data';
import type { ServiceObject } from '@objectstack/spec/data';
import type { ObjectContributor } from './registry-top-level.js';

/**
 * [#35901, Sales ruling 7073014077 on F1 / F2] The ONE switch for what
 * placement arranges. `true`: list placements apply only where the extended
 * object declares a non-empty `relatedLists`, and group and field placements
 * only where it declares a non-empty `fieldGroups`; elsewhere its automatic
 * arrangement stays, and each placement is named as not applied. Read only by
 * {@link arrangementDeclared}.
 */
export const PLACEMENT_ARRANGES_DECLARED_ONLY = true;

/** The record-page tabs a trailing run of which an end-placed list goes before. */
const TRAILING_BUILTIN_TABS: ReadonlySet<string> = new Set(['sys_approval_request', 'sys_activity']);

/** One extension's placements, as the fold hands them over. */
export interface PlacementContributor {
  readonly packageId: string | undefined;
  readonly priority: number;
  /** The extension's `place` entries, as registered (un-parsed tolerant read). */
  readonly place: readonly unknown[];
  /** The field names this extension's own `fields` declares. */
  readonly ownFields: ReadonlySet<string>;
}

/** What the fold knows beyond the object itself. */
export interface PlacementContext {
  /** The extended object's name, for the notes. */
  readonly objectName: string;
  /** The group keys the extended object's OWNER declares (the packaged body, not a tenant base). */
  readonly ownerGroupKeys: ReadonlySet<string>;
  /**
   * The package that owns a registered child object: a package id, `null`
   * when it is registered with no package, `undefined` when it is not
   * registered (yet). Only a registered child owned by ANOTHER package skips a
   * list placement; an absent one is never a verdict, since its package may
   * register it later in the same boot.
   */
  readonly childPackageOf: (childObject: string) => string | null | undefined;
}

/** One placement that did not apply as written, named once by the fold. */
export interface ExtensionPlacementNote {
  /** Dedup key: object, package, entry. */
  readonly key: string;
  readonly packageId: string | undefined;
  readonly message: string;
}

type AnyRecord = Record<string, unknown>;

/** One ordered item a pass splices into: its name, and the anchor that placed it there. */
interface Slot<T> {
  readonly name: string;
  readonly value: T;
  readonly placedAfter?: string;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * [#35901] Does the extended object declare the arrangement a placement of
 * `kind` arranges? The arm switch {@link PLACEMENT_ARRANGES_DECLARED_ONLY}
 * is read here and nowhere else.
 */
export function arrangementDeclared(kind: 'lists' | 'groups', object: unknown): boolean {
  if (!PLACEMENT_ARRANGES_DECLARED_ONLY) return true;
  const value = isRecord(object) ? object[kind === 'lists' ? 'relatedLists' : 'fieldGroups'] : undefined;
  return Array.isArray(value) && value.length > 0;
}

/**
 * Splice `slot` into `slots` after / before its anchor, or at `endIndex()`
 * when it names none. Returns false when it names an anchor `slots` does not
 * hold (the item then goes to the end).
 */
function splice<T>(slots: Slot<T>[], name: string, value: T, after: string | undefined, before: string | undefined, endIndex: () => number): boolean {
  if (after !== undefined) {
    const at = slots.findIndex((slot) => slot.name === after);
    if (at !== -1) {
      let index = at + 1;
      while (index < slots.length && slots[index].placedAfter === after) index += 1;
      slots.splice(index, 0, { name, value, placedAfter: after });
      return true;
    }
  } else if (before !== undefined) {
    const at = slots.findIndex((slot) => slot.name === before);
    if (at !== -1) {
      slots.splice(at, 0, { name, value });
      return true;
    }
  }
  slots.splice(endIndex(), 0, { name, value });
  return after === undefined && before === undefined;
}

/** The extensions in placement order: ascending priority, then package id. */
function inPlacementOrder(extensions: readonly PlacementContributor[]): PlacementContributor[] {
  return extensions
    .map((extension, index) => ({ extension, index }))
    .sort((a, b) => {
      if (a.extension.priority !== b.extension.priority) return a.extension.priority - b.extension.priority;
      const pa = a.extension.packageId ?? '';
      const pb = b.extension.packageId ?? '';
      if (pa !== pb) return pa < pb ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ extension }) => extension);
}

function anchorOf(entry: AnyRecord): { after?: string; before?: string } {
  return { after: stringOrUndefined(entry.after), before: stringOrUndefined(entry.before) };
}

function anchorText(after: string | undefined, before: string | undefined): string {
  return after !== undefined ? `after '${after}'` : `before '${before}'`;
}

/** The child object a list name (`child` or `child.field`) names. */
function childOf(list: string): string {
  const dot = list.indexOf('.');
  return dot === -1 ? list : list.slice(0, dot);
}

/**
 * Does the running tab list already arrange `list`? An entry of the same
 * name, a bare child entry covering every list of that child, or (for a bare
 * child placement) an entry naming one of that child's relationships.
 */
function tabsArrange(names: readonly string[], list: string): boolean {
  const child = childOf(list);
  const bare = list === child;
  return names.some((name) => name === list || name === child || (bare && childOf(name) === child));
}

/**
 * [#35901] The `extend` contributors that carry placements, in the fold's
 * hands: each one's `place` and the names of its own `fields`.
 */
export function placementContributorsOf(contributors: readonly ObjectContributor[]): PlacementContributor[] {
  const out: PlacementContributor[] = [];
  for (const contributor of contributors) {
    if (contributor.ownership !== 'extend') continue;
    const body = contributor.definition as unknown as AnyRecord;
    if (!Array.isArray(body.place) || body.place.length === 0) continue;
    out.push({
      packageId: contributor.packageId,
      priority: contributor.priority,
      place: body.place,
      ownFields: new Set(isRecord(body.fields) ? Object.keys(body.fields) : []),
    });
  }
  return out;
}

/** The group keys an object body declares in `fieldGroups` (none for `undefined`). */
export function fieldGroupKeysOf(object: unknown): ReadonlySet<string> {
  const groups = isRecord(object) ? object.fieldGroups : undefined;
  const keys = new Set<string>();
  if (Array.isArray(groups)) {
    for (const group of groups) {
      const key = isRecord(group) ? stringOrUndefined(group.key) : undefined;
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

/**
 * [#35901] Apply every extension's `place` to `object` (the fold's merged
 * body). Returns the object to serve (by reference when nothing applies) and
 * the notes to name. Pure: the caller names the notes, once.
 */
export function applyExtensionPlacements(
  object: ServiceObject,
  extensions: readonly PlacementContributor[],
  context: PlacementContext,
): { object: ServiceObject; notes: ExtensionPlacementNote[] } {
  const notes: ExtensionPlacementNote[] = [];
  const placing = inPlacementOrder(extensions.filter((extension) => extension.place.length > 0));
  if (placing.length === 0) return { object, notes };

  const objectName = context.objectName;
  const from = (packageId: string | undefined): string => (packageId ? ` from package "${packageId}"` : '');
  const note = (extension: PlacementContributor, entry: number, subject: string, message: string): void => {
    const text = `[Registry] An extension of object "${objectName}"${from(extension.packageId)} ${message}`;
    notes.push({ key: `${entry}|${subject}|${text}`, packageId: extension.packageId, message: text });
  };

  const groupsDeclared = arrangementDeclared('groups', object);
  const listsDeclared = arrangementDeclared('lists', object);
  const record = object as unknown as AnyRecord;
  let fields = isRecord(record.fields) ? record.fields : {};
  let fieldsChanged = false;

  // ── 1. groups ───────────────────────────────────────────────────────────
  const groupSlots: Slot<unknown>[] = (Array.isArray(record.fieldGroups) ? record.fieldGroups : [])
    .map((group) => ({ name: isRecord(group) ? stringOrUndefined(group.key) ?? '' : '', value: group }));
  const groupAddedBy = new Map<string, string | undefined>();
  let groupsChanged = false;
  for (const extension of placing) {
    extension.place.forEach((entry, index) => {
      if (!isRecord(entry) || !isRecord(entry.group)) return;
      const key = stringOrUndefined(entry.group.key);
      if (key === undefined) return;
      const { after, before } = anchorOf(entry);
      if (!groupsDeclared) {
        note(extension, index, `group:${key}`,
          `places field group '${key}' (place[${index}]), which is not applied: "${objectName}" declares no ` +
          '`fieldGroups`, so its fields show ungrouped, in declaration order, and the fields this group lists ' +
          'show among them. It applies once the object declares `fieldGroups`.');
        return;
      }
      if (context.ownerGroupKeys.has(key)) {
        note(extension, index, `group:${key}`,
          `adds field group '${key}' (place[${index}]), which is a group "${objectName}" declares itself, so ` +
          'the group is not added. An extension adds groups of its own: give it a key of its own, or place ' +
          `its fields into the object's '${key}' with { field, group: '${key}' }.`);
        return;
      }
      if (groupAddedBy.has(key)) {
        const other = groupAddedBy.get(key);
        note(extension, index, `group:${key}`,
          `adds field group '${key}' (place[${index}]), which package "${other ?? '(none)'}" already adds to ` +
          'this object, so the group is not added again. Give it a key of its own.');
        return;
      }
      // A base that already carries the key (a body that carries these
      // placements, or a tenant base) keeps its own position.
      if (groupSlots.some((slot) => slot.name === key)) return;
      const anchored = splice(groupSlots, key, { ...entry.group }, after, before, () => groupSlots.length);
      groupAddedBy.set(key, extension.packageId);
      groupsChanged = true;
      if (!anchored) {
        note(extension, index, `group:${key}`,
          `places field group '${key}' ${anchorText(after, before)} (place[${index}]), but "${objectName}" has ` +
          'no such group, so it is placed after the last group.');
      }
    });
  }

  // ── 2. fields ───────────────────────────────────────────────────────────
  // Members of each group the pass touches, read once from the running
  // groups (so a group's `fields`, then the fields whose `group` names it).
  const memberSlots = new Map<string, Slot<string>[]>();
  const groupsNow = (): AnyRecord[] => groupSlots.map((slot) => slot.value).filter(isRecord);
  const listedSomewhere = (field: string): boolean =>
    groupsNow().some((group) => Array.isArray(group.fields) && group.fields.includes(field));
  for (const extension of placing) {
    extension.place.forEach((entry, index) => {
      if (!isRecord(entry) || typeof entry.field !== 'string') return;
      const field = entry.field;
      const key = stringOrUndefined(entry.group);
      if (key === undefined) return;
      const { after, before } = anchorOf(entry);
      if (!extension.ownFields.has(field)) {
        note(extension, index, `field:${field}`,
          `places field \`${field}\` (place[${index}]), which is not a field this extension adds, so it is not ` +
          'moved: a field of the extended object, or of another package\'s extension, is arranged by its owner.');
        return;
      }
      if (!isRecord(fields[field])) return;
      if (!groupsDeclared) {
        note(extension, index, `field:${field}`,
          `places field \`${field}\` in group '${key}'${after !== undefined || before !== undefined ? ` ${anchorText(after, before)}` : ''} ` +
          `(place[${index}]), which is not applied: "${objectName}" declares no \`fieldGroups\`, so the field ` +
          'shows among its fields in declaration order, after the object\'s own. It applies once the object ' +
          'declares `fieldGroups`.');
        return;
      }
      const group = groupsNow().find((candidate) => candidate.key === key);
      if (group === undefined) {
        note(extension, index, `field:${field}`,
          `places field \`${field}\` in group '${key}' (place[${index}]), but "${objectName}" has no such group, ` +
          'so the field shows among the ungrouped fields.');
        return;
      }
      if (typeof group.relatedList === 'string' || isRecord(group.relatedList)) {
        note(extension, index, `field:${field}`,
          `places field \`${field}\` in group '${key}' (place[${index}]), which places a related list and holds ` +
          'no fields, so the field shows among the ungrouped fields.');
        return;
      }
      // The object (or the base the fold starts from) already lists it: its position wins.
      if (listedSomewhere(field)) return;
      let slots = memberSlots.get(key);
      if (slots === undefined) {
        const membership = readFieldGroupMembership({ fields, fieldGroups: groupsNow() });
        slots = (membership.members.get(key) ?? []).map((name) => ({ name, value: name }));
        memberSlots.set(key, slots);
      }
      const at = slots.findIndex((slot) => slot.name === field);
      if (at !== -1) slots.splice(at, 1);
      const anchored = splice(slots, field, field, after, before, () => slots!.length);
      if (fields[field] && (fields[field] as AnyRecord).group !== key) {
        fields = { ...fields, [field]: { ...(fields[field] as AnyRecord), group: key } };
        fieldsChanged = true;
      }
      if (!anchored) {
        note(extension, index, `field:${field}`,
          `places field \`${field}\` ${anchorText(after, before)} in group '${key}' (place[${index}]), but that ` +
          'group has no such member, so the field is placed last in the group.');
      }
    });
  }
  if (memberSlots.size > 0) {
    for (let index = 0; index < groupSlots.length; index += 1) {
      const slot = groupSlots[index];
      const members = memberSlots.get(slot.name);
      if (members === undefined || !isRecord(slot.value)) continue;
      groupSlots[index] = { ...slot, value: { ...slot.value, fields: members.map((member) => member.name) } };
    }
    groupsChanged = true;
  }

  // ── 3. lists ────────────────────────────────────────────────────────────
  const tabSlots: Slot<unknown>[] = (Array.isArray(record.relatedLists) ? record.relatedLists : [])
    .map((entry) => ({ name: relatedListEntryName(entry) ?? '', value: entry }));
  const tabsEnd = (): number => {
    let end = tabSlots.length;
    while (end > 0 && TRAILING_BUILTIN_TABS.has(tabSlots[end - 1].name)) end -= 1;
    return end;
  };
  let tabsChanged = false;
  for (const extension of placing) {
    extension.place.forEach((entry, index) => {
      if (!isRecord(entry) || typeof entry.list !== 'string') return;
      const list = entry.list;
      const { after, before } = anchorOf(entry);
      const label = stringOrUndefined(entry.label);
      const columns = Array.isArray(entry.columns) && entry.columns.length > 0 ? entry.columns : undefined;
      const owner = context.childPackageOf(childOf(list));
      if (owner !== undefined && (owner ?? undefined) !== extension.packageId) {
        note(extension, index, `list:${list}`,
          `places list '${list}' (place[${index}]), whose object '${childOf(list)}' is ` +
          `${owner === null ? 'registered with no package' : `package "${owner}"'s`}, not a child object this ` +
          'package defines, so it is not placed: the lists of the extended object and of other packages are ' +
          'arranged by their owners.');
        return;
      }
      if (!listsDeclared) {
        note(extension, index, `list:${list}`,
          `places list '${list}' (place[${index}]), which is not applied: "${objectName}" declares no ` +
          '`relatedLists`, so its tabs keep the automatic order and the list shows there' +
          (label !== undefined || columns !== undefined
            ? ', and this entry\'s `label` / `columns` are not applied either (write `relatedListTitle` / ' +
              '`relatedListColumns` on the child\'s lookup field, which apply on every parent)'
            : '') +
          '. It applies once the object declares `relatedLists`.');
        return;
      }
      if (tabsArrange(tabSlots.map((slot) => slot.name), list)) return;
      const value = label !== undefined || columns !== undefined
        ? { list, ...(label !== undefined ? { label } : {}), ...(columns !== undefined ? { columns: [...columns] } : {}) }
        : list;
      const anchored = splice(tabSlots, list, value, after, before, tabsEnd);
      tabsChanged = true;
      // Before a trailing built-in tab the object leaves unlisted is the end
      // of the tabs anyway (the approvals and the stream follow every listed
      // tab), so that miss is the position asked for and is not named.
      if (!anchored && !(before !== undefined && TRAILING_BUILTIN_TABS.has(before))) {
        note(extension, index, `list:${list}`,
          `places list '${list}' ${anchorText(after, before)} (place[${index}]), but "${objectName}" has no such ` +
          'tab in its `relatedLists`, so the list is placed at the end of the tabs.');
      }
    });
  }

  if (!groupsChanged && !tabsChanged && !fieldsChanged) return { object, notes };
  const out = { ...record } as AnyRecord;
  if (groupsChanged) out.fieldGroups = groupSlots.map((slot) => slot.value);
  if (tabsChanged) out.relatedLists = tabSlots.map((slot) => slot.value);
  if (fieldsChanged) out.fields = fields;
  return { object: out as unknown as ServiceObject, notes };
}
