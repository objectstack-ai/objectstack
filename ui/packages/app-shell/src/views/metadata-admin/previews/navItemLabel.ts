// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An `I18nLabel` as the Studio's designers read and write it, and the text a
 * nav ENTRY shows in them.
 *
 * Three readers share this module, so they cannot come to disagree:
 *
 *  - {@link navItemLabelText} reads any spec `I18nLabel` (a plain string or an
 *    inline locale map) in the designer locale. It started as the nav-item
 *    label reader and now also reads an app's own label (the Interfaces
 *    pillar's rail heading) and an action's label (`ObjectActionsPanel`), so
 *    its name is narrower than what it does: it knows nothing about nav items.
 *  - {@link navEntryLabelText} is a nav entry's DISPLAY text. An authored label
 *    reads through `navItemLabelText`; an ABSENT one goes to the runtime's own
 *    inheritance rule (objectui#11196), below.
 *  - {@link renamedLabel} is what an edit of the label writes, and
 *    {@link clearedLabel} what an edit that empties it leaves. Editors of a nav
 *    label import them rather than choose the map entry themselves, so two
 *    editors of one label write the same entry (objectui#11128,
 *    objectui#11148). ⛔ Never copy the key choice into an editor: a second
 *    copy is how two editors would come to disagree about which entry an edit
 *    changes.
 *
 * Internal to app-shell: not exported from the package root.
 */

import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { resolveNavItemLabel, type NavTargetLabelResolver } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';

/**
 * The text of an `I18nLabel` in the designer `locale`, resolved through the
 * spec's own resolver, or `''` when there is none.
 *
 * `label` only: `title` / `name` / `path` are not nav-item keys. A locale map
 * is never stringified (that renders `[object Object]`). The text is returned
 * untrimmed, so an input bound to it echoes exactly what the author typed.
 */
export function navItemLabelText(label: I18nLabel | undefined, locale: string | undefined): string {
  return resolveI18nLabel(label, locale) ?? '';
}

/**
 * A nav entry as the designers hold it: a draft record, loosely typed, whose
 * `label` is the spec's `I18nLabel` and whose other keys are whatever the
 * entry's `type` declares (`objectName`, `pageName`, `children`, …).
 */
export interface NavEntryLike {
  label?: I18nLabel;
  [key: string]: unknown;
}

/**
 * The text a nav entry INHERITS: what it shows when it carries no `label`.
 *
 * This is the runtime's rule, called — never restated (objectui#11196). The
 * spec made a nav entry's `label` optional with a declared semantic: absent ⇒
 * the entry shows, at render time, the CURRENT label of what it opens. The
 * console draws that through `resolveNavItemLabel` (`@object-ui/layout`) with a
 * {@link NavTargetLabelResolver}; the designer passes the same resolver
 * (`useNavTargetLabel`), so a label-less entry reads here exactly as the
 * console's sidebar draws it. The ladder and its fallbacks are the runtime's:
 * a view / object / dashboard target's metadata label, else its machine name;
 * any other target's machine name (`pageName`, `reportName`, `url`,
 * `componentRef`, `actionDef.actionName`); else the entry's `id`. A target the
 * resolver cannot read (a draft app, an unsaved page, no metadata loaded) falls
 * to the machine name, as it does in the console before its metadata loads.
 *
 * The label is taken off before the rule is asked, so the answer is the
 * inherited text even for an entry that has one: an inspector shows it as the
 * placeholder of a label field, the text the entry falls back to when cleared.
 * `''` for a separator (the rule's own answer: it names nothing) and for an
 * entry the rule cannot name at all (no target and no `id`, which the spec
 * refuses).
 */
export function inheritedNavEntryText(entry: NavEntryLike, targetLabel?: NavTargetLabelResolver): string {
  const text = resolveNavItemLabel(
    { ...entry, label: undefined } as unknown as NavigationItem,
    undefined,
    targetLabel,
  );
  return typeof text === 'string' ? text : '';
}

/**
 * The text a nav entry SHOWS in the designer: its authored label in the
 * designer `locale`, or — when it has none — the text it inherits
 * ({@link inheritedNavEntryText}).
 *
 * The branch is keyed on ABSENCE alone, as the runtime's is: an authored label
 * is shown verbatim and is never swapped for the target's label, however it is
 * spelled. A label that is present but resolves to nothing (an empty locale
 * map) is not absent, so it inherits nothing and reads `''`, and the caller's
 * own empty-text handling applies.
 */
export function navEntryLabelText(
  entry: NavEntryLike,
  locale: string | undefined,
  targetLabel?: NavTargetLabelResolver,
): string {
  if (entry.label !== undefined) return navItemLabelText(entry.label, locale);
  return inheritedNavEntryText(entry, targetLabel);
}

/**
 * The label an edit writes (objectui#11128).
 *
 * A plain string (or no label) is replaced by the new string, as before. A
 * locale map is NEVER replaced by a string: that would delete every other
 * language's text. Only the designer locale's entry changes, and every other
 * entry is kept. The entry written is the one `resolveI18nLabel` reads first
 * for this locale — the exact tag, else its bare language (`en` under
 * `en-US`) — so the editor shows the new text straight after the edit. A map
 * with neither gains an entry under the exact tag; an entry the resolver only
 * reached as another language's fallback (`default`, `en` under `zh-CN`, a
 * sibling region) is left as it was. Because the new entry is under the exact
 * tag, the next edit finds it first: an editor that writes on every keystroke
 * adds that entry once, never one per keystroke.
 */
export function renamedLabel(cur: I18nLabel | undefined, next: string, locale: string): I18nLabel {
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return next;
  const map: Record<string, string> = cur;
  const key = ownEntryKey(map, locale) ?? locale.trim();
  return { ...map, [key]: next };
}

/**
 * The label an edit that EMPTIES the field leaves (objectui#11196): the
 * inverse of {@link renamedLabel}.
 *
 * Clearing restores inheritance, so a plain string (or no label) answers
 * `undefined` and the caller REMOVES the key. ⛔ It is never written as `''`:
 * an empty string is a present label, so the entry would show nothing rather
 * than inherit, and the save door refuses it. A locale map loses only the entry
 * `renamedLabel` would write for this locale, and every other language keeps
 * its text; the entry then shows what the map resolves to for this locale. A
 * map left with no text in any language answers `undefined` too.
 */
export function clearedLabel(cur: I18nLabel | undefined, locale: string): I18nLabel | undefined {
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
  const map: Record<string, string> = { ...cur };
  const key = ownEntryKey(map, locale);
  if (key !== undefined) delete map[key];
  return Object.values(map).some((v) => typeof v === 'string') ? map : undefined;
}

/** The map entry an edit in `locale` owns: the exact tag, else its bare language; `undefined` when the map has neither. */
function ownEntryKey(map: Record<string, string>, locale: string): string | undefined {
  const tag = locale.trim();
  const own = (key: string) => Object.prototype.hasOwnProperty.call(map, key) && typeof map[key] === 'string';
  return [tag, tag.split('-')[0]].find(own);
}
