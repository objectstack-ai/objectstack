// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two visible fields of one object that a reader sees under the same label
 * (`field-label-duplicate`).
 *
 * Every surface that draws an object's fields names a column by its label: the
 * list grid's header, the kanban card's field line, the form's caption, the
 * export file's header, the import template's column. Two visible fields with
 * one label are two columns a person cannot tell apart, and a person who edits
 * one of them believes they changed the other. The common case is a field the
 * author adds beside a platform field it duplicates: a `user` field `assignee`
 * labelled "负责人" on an object that already carries the injected `owner_id`,
 * which a zh-CN reader is served as "负责人" too. The two are not the same
 * thing (`owner_id` drives record ownership and visibility, the author's field
 * drives nothing), so the reader cannot even pick the right one by meaning.
 *
 * ## What is compared
 *
 * The fields an object SERVES: its own fields with every `objectExtensions`
 * field of the same stack folded in (`objectsAsServed`, the package's one
 * fold; a field two packages tie on is left out, since which definition wins
 * is registration order), plus the platform columns the registry injects on it
 * (`injectedColumnDefsFor`, the spec tables `applySystemFields` spreads; an
 * authored field of the same name replaces the injected one). A field declared
 * `hidden: true` is drawn on no default surface and is not compared; the
 * injected tenant, business-unit and queue columns are hidden by their own
 * definitions, so the comparison sees `owner_id` and the four audit columns.
 *
 * Labels are compared as the reader is served them, in each locale this stack
 * can be read in, through the spec's own read-exit translator
 * (`translateObject`, the function the `/meta` read applies), never a second
 * copy of its ladder:
 *
 *  - the AUTHORED pass: each field's label as written, with the injected
 *    columns under their definition's label;
 *  - one pass per locale: every locale a `translations` bundle of this stack
 *    carries, plus every locale the platform's built-in system-field labels
 *    carry (`BUILTIN_SYSTEM_FIELD_LABEL_LOCALES`). The second set matters
 *    without any bundle: a `/meta` read in one of those locales serves the
 *    injected columns translated while an author's untranslated field keeps
 *    the label it was written with, which is exactly the "负责人" pair above.
 *
 * Labels are compared after trimming surrounding white space, otherwise
 * exactly. A field with no label is drawn under its name, which is unique on
 * the object, and is not compared.
 *
 * ## What is reported
 *
 * One finding per group of fields that share a label: in the authored pass
 * (then the label clashes for every reader the stack does not translate, and
 * the finding names no locale), or else only in some locales (the finding
 * names them). Each finding names every field of the group and nothing
 * positional beyond the object, so the message is the same on every run, which
 * is what the publish door's differential compares.
 *
 * `error`: the build, `os validate`, `os lint` and the publish door refuse it.
 * At the door, as for every gating rule there, a write of ANOTHER object is
 * never charged with a stored object's clash, while a write of the object
 * itself is judged on the body it sends, so re-saving an object that still
 * carries a clash is refused until the clash is fixed. Nothing on the boot or
 * registration path runs the author-time rules, so an app that is already
 * installed keeps loading and serving.
 *
 * ## The `object_extension` door
 *
 * An extension published at runtime (Studio's add-field on a `.custom` pair,
 * the `/meta` doors, an MCP or AI author) adds fields to an object it does not
 * own, so it can add one under a label the target already shows, `owner_id`
 * included, or two of its own fields under one label the target does not
 * show; both are refused. The door hands the gate the written entry as the stack's only
 * `objectExtensions` member and the live objects as the registry serves them,
 * the target without the written package's own stored extension (which the
 * write replaces), so the fold below judges the target as it will be served
 * after the write. Two inputs make that the build's fold: the target's OTHER
 * packages' extensions with their priorities (`storedObjectExtensions`), so a
 * field two packages tie on is left out as the build leaves it out, and the
 * injected columns read back to the platform's own definitions
 * (`stripInjectedSystemColumns`, as the expression rule reads the served
 * objects there), so `owner_id` is named as the platform's column. The write
 * is charged only with a clash its entry creates: a clash the target already
 * carried is in the gate's baseline too, with the same message, and a group
 * every member of which already shared the label on the target (what is left
 * of a clash after the entry took a member out, by a new label, `hidden: true`
 * or a tie at the deciding priority) is not reported, since its message names
 * fewer fields than the baseline's and would otherwise read as new. The door
 * carries no `translations`, so it compares the authored labels and the
 * platform's own translations of its columns only; a clash a translation
 * bundle creates is the build's to find, and the hint offers no bundle.
 */

import {
  BUILTIN_SYSTEM_FIELD_LABEL_LOCALES,
  translateObject,
  type ObjectLike,
  type TranslationBundle,
} from '@objectstack/spec/system';
import { stripInjectedSystemColumns } from '@objectstack/metadata-core';
import {
  objectExtensionsByTarget,
  objectsAsServed,
  objectsWithoutTiedFields,
  recordsOf,
  type StoredObjectExtension,
} from './object-graph.js';
import { injectedColumnDefsFor } from './system-fields.js';

type AnyRec = Record<string, unknown>;

export const FIELD_LABEL_DUPLICATE = 'field-label-duplicate';

export interface DuplicateFieldLabelFinding {
  severity: 'error';
  rule: typeof FIELD_LABEL_DUPLICATE;
  /** `object "e9gv_ticket"`. */
  where: string;
  /** `objects[N].fields` — positional in the stack's own `objects`. */
  path: string;
  message: string;
  hint: string;
}

/** The authored pass's key in a group's pass set; no locale tag is spelled like this. */
const AUTHORED = '';

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The stack's translation bundles narrowed to ONE object's field entries and
 * merged per locale key, a later bundle's entry overriding an earlier one's key
 * by key (the order the app plugin loads them into the i18n service).
 */
function fieldBundleFor(stack: AnyRec, objectName: string): TranslationBundle {
  const merged: Record<string, { objects: Record<string, { fields: Record<string, AnyRec> }> }> = {};
  const bundles = Array.isArray(stack.translations) ? stack.translations : [];
  for (const bundle of bundles) {
    if (!isRec(bundle)) continue;
    for (const [locale, data] of Object.entries(bundle)) {
      if (!isRec(data) || !isRec(data.objects)) continue;
      const node = data.objects[objectName];
      if (!isRec(node) || !isRec(node.fields)) continue;
      const slot = (merged[locale] ??= { objects: { [objectName]: { fields: {} } } }).objects[objectName].fields;
      for (const [fieldName, entry] of Object.entries(node.fields)) {
        if (isRec(entry)) slot[fieldName] = { ...(slot[fieldName] ?? {}), ...entry };
      }
    }
  }
  return merged as unknown as TranslationBundle;
}

/** The locales this object's labels are compared in: the bundle's, then the built-in table's. */
function localesOf(bundle: TranslationBundle): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of [...Object.keys(bundle), ...BUILTIN_SYSTEM_FIELD_LABEL_LOCALES]) {
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }
  return out;
}

/** field name → the label a reader sees, for the visible fields of `fields`. */
function visibleLabels(fields: Readonly<Record<string, AnyRec>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, def] of Object.entries(fields)) {
    if (def.hidden === true) continue;
    if (typeof def.label !== 'string') continue;
    const label = def.label.trim();
    if (label.length > 0) out.set(name, label);
  }
  return out;
}

/** Fields grouped by the label they share, groups of two or more only. */
function clashes(labels: ReadonlyMap<string, string>): Map<string, string[]> {
  const byLabel = new Map<string, string[]>();
  for (const [name, label] of labels) {
    const group = byLabel.get(label);
    if (group) group.push(name);
    else byLabel.set(label, [name]);
  }
  for (const [label, names] of byLabel) if (names.length < 2) byLabel.delete(label);
  return byLabel;
}

function quoteList(names: readonly string[]): string {
  const quoted = names.map((n) => `'${n}'`);
  if (quoted.length <= 2) return quoted.join(' and ');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** What the `object_extension` publish door states beyond the stack (see the module note). */
export interface DuplicateFieldLabelOptions {
  /**
   * The written extension's target's other packages' published extensions,
   * folded among the written entry by priority. Stated by the door only.
   */
  storedObjectExtensions?: readonly StoredObjectExtension[];
  /**
   * The publish door's `object_extension` write: the objects are the
   * registry's SERVED definitions (the injected columns carried as declared
   * fields), read back to the authored shape first; and a group the written
   * entry did not create (every member already shared the label on the
   * target) is not reported. Set by the door on that write only.
   */
  extensionWrite?: boolean;
}

/**
 * Report every object that serves two or more visible fields under one label.
 * Returns a (possibly empty) list of findings; never throws.
 */
export function lintDuplicateFieldLabels(stack: AnyRec): DuplicateFieldLabelFinding[] {
  return duplicateFieldLabelFindings(stack);
}

/**
 * One object's clashing label groups per pass (the authored pass, then each
 * locale), over `servedObj`'s fields with the injected columns beneath them.
 */
function clashPassesOf(
  obj: AnyRec,
  objectName: string,
  servedObj: AnyRec | undefined,
  bundle: TranslationBundle,
): { injectedNames: Set<string>; passes: Map<string, Map<string, string[]>> } {
  // The injected columns first, so an authored field of the same name
  // replaces the platform's definition, as it does at registration.
  const fields: Record<string, AnyRec> = {};
  const injectedNames = new Set<string>();
  for (const [name, def] of injectedColumnDefsFor(obj)) {
    fields[name] = { ...def };
    injectedNames.add(name);
  }
  for (const f of recordsOf(servedObj?.fields)) {
    if (typeof f.name !== 'string') continue;
    fields[f.name] = f;
    injectedNames.delete(f.name);
  }
  const passes = new Map<string, Map<string, string[]>>();
  passes.set(AUTHORED, clashes(visibleLabels(fields)));
  for (const locale of localesOf(bundle)) {
    const doc = translateObject({ name: objectName, fields } as ObjectLike, bundle, { locale });
    passes.set(locale, clashes(visibleLabels((doc.fields ?? {}) as Record<string, AnyRec>)));
  }
  return { injectedNames, passes };
}

/**
 * {@link lintDuplicateFieldLabels} with what the `object_extension` publish
 * door states beyond the stack. The registry entry calls this; it is not on
 * the package's entries, so the published signature is unchanged.
 */
export function duplicateFieldLabelFindings(
  stack: AnyRec,
  options: DuplicateFieldLabelOptions = {},
): DuplicateFieldLabelFinding[] {
  const findings: DuplicateFieldLabelFinding[] = [];
  if (!isRec(stack)) return findings;
  const extensionWrite = options.extensionWrite === true;
  if (extensionWrite) {
    stack = { ...stack, objects: recordsOf(stack.objects).map((o) => stripInjectedSystemColumns(o)) };
  }
  const stored = options.storedObjectExtensions ?? [];
  const declared = recordsOf(stack.objects);
  const served = objectsWithoutTiedFields(objectsAsServed(stack, stored));
  // On an extension write, each target as served WITHOUT the written entry:
  // the same objects and stored extensions, no `objectExtensions` of the
  // stack's own. Index-aligned with `declared` (the fold maps one to one).
  // Read only for the objects the written entry extends: any other object's
  // clashes are the same before and after the write, and the gate's
  // differential already leaves them uncharged.
  const before = extensionWrite
    ? objectsWithoutTiedFields(objectsAsServed({ objects: stack.objects }, stored))
    : undefined;
  const writtenTargets = extensionWrite ? new Set(objectExtensionsByTarget(stack).keys()) : undefined;

  declared.forEach((obj, i) => {
    const objectName = typeof obj.name === 'string' ? obj.name : undefined;
    if (!objectName) return;

    const bundle = fieldBundleFor(stack, objectName);
    const { injectedNames, passes: candidatePasses } = clashPassesOf(obj, objectName, served[i], bundle);
    const beforePasses =
      before && writtenTargets?.has(objectName) ? clashPassesOf(obj, objectName, before[i], bundle).passes : undefined;

    // group key (sorted field names + label) → the passes it clashes in.
    const groups = new Map<string, { names: string[]; label: string; passes: string[] }>();
    for (const [pass, clashing] of candidatePasses) {
      for (const [label, names] of clashing) {
        // [#33644] On an extension write a group every member of which
        // already shared this label on the target in this pass is no clash
        // the entry created: it is the target's own, or what is left of it
        // after the entry took a member out (relabelled, hidden, or tied at
        // the deciding priority). The gate's differential compares whole
        // messages, which name every member, so a shrunken group would
        // otherwise read as new.
        const prior = beforePasses?.get(pass)?.get(label);
        if (prior && names.every((n) => prior.includes(n))) continue;
        const sorted = [...names].sort();
        const key = `${sorted.join('\u0000')}\u0001${label}`;
        const group = groups.get(key) ?? { names: sorted, label, passes: [] };
        group.passes.push(pass);
        groups.set(key, group);
      }
    }

    for (const { names, label, passes } of groups.values()) {
      const authored = passes.includes(AUTHORED);
      const locales = passes.filter((p) => p !== AUTHORED);
      // A clash in the authored pass names no locale: every reader the stack
      // does not translate sees it, and the locale passes that repeat it
      // under the same label are the same group.
      const injected = names.filter((n) => injectedNames.has(n));
      const scope = authored ? '' : ` when read in ${locales.length === 1 ? 'locale' : 'locales'} ${locales.join(', ')}`;
      findings.push({
        severity: 'error',
        rule: FIELD_LABEL_DUPLICATE,
        where: `object "${objectName}"`,
        path: `objects[${i}].fields`,
        message:
          `object "${objectName}" shows fields ${quoteList(names)} under one label "${label}"${scope}, so ` +
          'a person sees more than one column of that name in lists, cards and forms and cannot tell which one they edit.' +
          (injected.length > 0
            ? ` ${quoteList(injected)} ${injected.length === 1 ? 'is a column' : 'are columns'} the platform adds to the object.`
            : ''),
        hint:
          'Give each visible field its own label' +
          // The extension door reads no translation bundle (the clash it finds
          // in a locale is the platform's own translation), so its hint
          // offers none: a bundle is judged at `os build` / `os validate`.
          (authored || extensionWrite ? '' : ' (in the translation bundle too, for a locale only a translation clashes in)') +
          ', or set `hidden: true` on the one readers should not see, or drop the duplicate field' +
          (injected.length > 0
            ? ` and use the platform's ${quoteList(injected)} instead of declaring a second field for the same thing.`
            : '.'),
      });
    }
  });
  return findings;
}
