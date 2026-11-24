// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35901] Where an object extension's `place` will not land as written, said
 * at `os validate` — warnings, never refusals: the registry merge places the
 * item at the end (or leaves the object's automatic arrangement) and names the
 * same placement in the boot log, which stays the main channel, since this
 * rule sees an extension's target only when the target object is in the same
 * stack (a target in another package is outside it).
 *
 *  - `extension-placement-not-applied`: the extended object declares no
 *    `relatedLists` (for a list placement) or no `fieldGroups` (for a group or
 *    field placement), so the placement is not applied (Sales ruling
 *    7073014077 on #35901, arm (a)): the list keeps the automatic tab order,
 *    with the entry's `label` / `columns` not applied either; the field keeps
 *    its place among the fields, its `after` / `before` not applied.
 *  - `extension-placement-anchor-missing`: the `after` / `before` names a tab,
 *    group or group member the extended object has not (nor any extension of
 *    it in this stack places), so the item goes to the end; or a field
 *    placement names a group the object has not, so the field shows
 *    ungrouped. `before` a trailing built-in tab the object leaves unlisted is
 *    the end of the tabs anyway, and is not named.
 *
 * Which items an extension may place at all (its own fields, a group key of
 * its own, a child list of its own package) is `defineStack`'s refusal and the
 * object extension parse's, not this rule's.
 */

import { readFieldGroupMembership, relatedListEntryName } from '@objectstack/spec/data';
import { recordsOf } from './object-graph.js';

/** A placement the extended object declares no arrangement for. */
export const EXTENSION_PLACEMENT_NOT_APPLIED = 'extension-placement-not-applied';

/** A placement whose anchor (or group) the extended object does not have. */
export const EXTENSION_PLACEMENT_ANCHOR_MISSING = 'extension-placement-anchor-missing';

export interface ExtensionPlacementFinding {
  severity: 'warning';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

const TRAILING_BUILTIN_TABS: ReadonlySet<string> = new Set(['sys_approval_request', 'sys_activity']);

interface Extension {
  readonly at: string;
  readonly target: string;
  readonly place: readonly unknown[];
  readonly fields: readonly AnyRec[];
}

/** Every `objectExtensions` entry of the stack and of each package body, with its path. */
function extensionsOf(stack: AnyRec): Extension[] {
  const out: Extension[] = [];
  const collect = (entries: unknown, at: string): void => {
    if (!Array.isArray(entries)) return;
    entries.forEach((ext, i) => {
      if (!isRec(ext) || typeof ext.extend !== 'string' || !Array.isArray(ext.place)) return;
      out.push({ at: `${at}objectExtensions[${i}]`, target: ext.extend, place: ext.place, fields: recordsOf(ext.fields) });
    });
  };
  collect(stack.objectExtensions, '');
  if (Array.isArray(stack.packages)) {
    stack.packages.forEach((entry, j) => {
      const body = isRec(entry) ? entry.manifest : undefined;
      if (isRec(body)) collect(body.objectExtensions, `packages[${j}].manifest.`);
    });
  }
  return out;
}

/** Every object the stack declares, top level and in each package body, by name. */
function objectsByName(stack: AnyRec): Map<string, AnyRec> {
  const byName = new Map<string, AnyRec>();
  const add = (objects: unknown): void => {
    for (const obj of recordsOf(objects)) if (typeof obj.name === 'string') byName.set(obj.name, obj);
  };
  add(stack.objects);
  if (Array.isArray(stack.packages)) {
    for (const entry of stack.packages) {
      const body = isRec(entry) ? entry.manifest : undefined;
      if (isRec(body)) add(body.objects);
    }
  }
  return byName;
}

/** An object's fields as a record by name, whichever shape it writes, with the extensions' fields added. */
function fieldRecord(obj: AnyRec, extensionFields: readonly AnyRec[]): Record<string, AnyRec> {
  const out: Record<string, AnyRec> = {};
  const raw = obj.fields;
  if (isRec(raw)) {
    for (const [name, def] of Object.entries(raw)) if (isRec(def)) out[name] = def;
  } else {
    for (const def of recordsOf(raw)) if (typeof def.name === 'string') out[def.name] = def;
  }
  for (const def of extensionFields) if (typeof def.name === 'string' && !(def.name in out)) out[def.name] = def;
  return out;
}

/**
 * Judge every `place` entry of every object extension whose target object
 * the stack declares. Pure `(stack) => Finding[]`.
 */
export function validateExtensionPlacement(stack: AnyRec): ExtensionPlacementFinding[] {
  const findings: ExtensionPlacementFinding[] = [];
  if (!isRec(stack)) return findings;
  const extensions = extensionsOf(stack);
  if (extensions.length === 0) return findings;
  const objects = objectsByName(stack);

  for (const ext of extensions) {
    const target = objects.get(ext.target);
    if (!target) continue;
    // What every extension of this target in the stack places: an anchor may name one of them.
    const siblings = extensions.filter((other) => other.target === ext.target);
    const placedLists = new Set<string>();
    const placedGroups = new Set<string>();
    const placedFields = new Map<string, Set<string>>();
    for (const other of siblings) {
      for (const entry of other.place) {
        if (!isRec(entry)) continue;
        if (typeof entry.list === 'string') placedLists.add(entry.list);
        if (isRec(entry.group) && typeof entry.group.key === 'string') placedGroups.add(entry.group.key);
        if (typeof entry.field === 'string' && typeof entry.group === 'string') {
          const set = placedFields.get(entry.group) ?? new Set<string>();
          set.add(entry.field);
          placedFields.set(entry.group, set);
        }
      }
    }
    const tabs = Array.isArray(target.relatedLists) ? target.relatedLists : [];
    const groups = Array.isArray(target.fieldGroups) ? target.fieldGroups : [];
    const tabNames = new Set(tabs.map((entry) => relatedListEntryName(entry)).filter((n): n is string => n !== undefined));
    const groupKeys = new Set(groups.map((g) => (isRec(g) ? str(g.key) : undefined)).filter((k): k is string => k !== undefined));
    const membership = readFieldGroupMembership({ fields: fieldRecord(target, siblings.flatMap((other) => other.fields)), fieldGroups: groups });
    const who = `object extension of "${ext.target}"`;

    ext.place.forEach((entry, k) => {
      if (!isRec(entry)) return;
      const path = `${ext.at}.place[${k}]`;
      const after = str(entry.after);
      const before = str(entry.before);
      const anchor = after ?? before;
      const anchorWord = after !== undefined ? 'after' : 'before';
      const missing = (subject: string, kind: string, hint: string): void => {
        findings.push({
          severity: 'warning',
          rule: EXTENSION_PLACEMENT_ANCHOR_MISSING,
          where: `${who} › place`,
          path,
          message: `${path} places ${subject} ${anchorWord} '${anchor}', but '${ext.target}' has no such ${kind}, so the item goes to the end.`,
          hint,
        });
      };
      const notApplied = (subject: string, key: 'relatedLists' | 'fieldGroups', shows: string): void => {
        findings.push({
          severity: 'warning',
          rule: EXTENSION_PLACEMENT_NOT_APPLIED,
          where: `${who} › place`,
          path,
          message:
            `${path} places ${subject}, which is not applied: '${ext.target}' declares no \`${key}\`, so ${shows}. ` +
            `It applies once '${ext.target}' declares \`${key}\`.`,
          hint:
            key === 'relatedLists'
              ? `Ask the owner of '${ext.target}' to declare relatedLists; to title the list and choose its columns on every parent, write relatedListTitle / relatedListColumns on your child object's lookup field.`
              : `Ask the owner of '${ext.target}' to declare fieldGroups; until then your fields show after its own, in declaration order.`,
        });
      };

      if (typeof entry.list === 'string') {
        const list = entry.list;
        if (tabs.length === 0) {
          const inert = entry.label !== undefined || entry.columns !== undefined;
          notApplied(
            `list '${list}'`,
            'relatedLists',
            `its tabs keep the automatic order and the list shows there${inert ? ', and this entry\'s label / columns are not applied either' : ''}`,
          );
          return;
        }
        if (anchor === undefined || tabNames.has(anchor) || placedLists.has(anchor)) return;
        if (before !== undefined && TRAILING_BUILTIN_TABS.has(before)) return;
        missing(`list '${list}'`, 'tab in its relatedLists', `Name a relatedLists entry of '${ext.target}', or drop the anchor to place the list at the end of the tabs.`);
        return;
      }
      if (isRec(entry.group)) {
        const key = str(entry.group.key) ?? '?';
        if (groups.length === 0) {
          notApplied(`field group '${key}'`, 'fieldGroups', 'its fields show ungrouped, and the fields this group lists show among them');
          return;
        }
        if (anchor === undefined || groupKeys.has(anchor) || placedGroups.has(anchor)) return;
        missing(`field group '${key}'`, 'field group', `Name a fieldGroups key of '${ext.target}', or drop the anchor to place the group last.`);
        return;
      }
      if (typeof entry.field === 'string' && typeof entry.group === 'string') {
        const field = entry.field;
        const group = entry.group;
        if (groups.length === 0) {
          notApplied(
            `field \`${field}\` in group '${group}'${anchor !== undefined ? ` ${anchorWord} '${anchor}'` : ''}`,
            'fieldGroups',
            'the field shows among its fields in declaration order, after the object\'s own',
          );
          return;
        }
        if (!groupKeys.has(group) && !placedGroups.has(group)) {
          findings.push({
            severity: 'warning',
            rule: EXTENSION_PLACEMENT_ANCHOR_MISSING,
            where: `${who} › place`,
            path,
            message: `${path} places field \`${field}\` in group '${group}', but '${ext.target}' has no such field group, so the field shows among the ungrouped fields.`,
            hint: `Name a fieldGroups key of '${ext.target}', or add the group with a { group: { key: '${group}', label } } entry.`,
          });
          return;
        }
        if (anchor === undefined) return;
        const members = membership.members.get(group) ?? [];
        if (members.includes(anchor) || placedFields.get(group)?.has(anchor)) return;
        missing(`field \`${field}\``, `member in group '${group}'`, `Name a field of group '${group}', or drop the anchor to place the field last in the group.`);
      }
    });
  }
  return findings;
}
