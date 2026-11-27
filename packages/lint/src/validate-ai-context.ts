// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D1] Context packs (`aiContexts`) that name what the stack does not
 * have: author defects, reported on the author surfaces.
 *
 * A pack is read at call time by `get_record_context`, which takes a name the
 * published definition lacks out of its plan and SAYS NOTHING about it
 * (ADR-0160 D3: only an entry the caller's schema hides is stated). That
 * silence is right at the tool — a caller must not learn what the author got
 * wrong — and is exactly why the author has to hear it here instead: a typo in
 * a pack ships as a pack that quietly reads less than it says.
 *
 * Six verdicts, each a `warning` (the pack loads and reads what resolves):
 *
 * - `ai-context-field-unknown`: a name in `fields`, a `related` entry's
 *   `fields`, `where` or `orderBy`, or `body.field` that the object does not
 *   define — neither declares nor carries as an injected system column, which
 *   the published definition the tool reads carries and the tool serves like
 *   any field (a `where` or `orderBy` field the child lacks leaves the whole list
 *   out of every answer, ADR-0160 D1/D3 second amendment — the tool never
 *   runs a filter with one of its conditions removed);
 * - `ai-context-field-unprovisioned`: a name in any of those positions, or a
 *   related list's link field, that resolves only BECAUSE it is an injected
 *   system column, on an ADR-0015 `external` object: the platform registers
 *   the anchor without provisioning a column (`unprovisionedInjectedColumnsFor`,
 *   the spec's provenance derivation every unprovisioned-anchor rule here
 *   reads), so the name resolves and the read finds no value behind it. An
 *   author-declared column of the same name is the author's and never judged;
 * - `ai-context-sort-field-unsortable`: a `related` entry's `orderBy` field
 *   the child does not offer as a sort — the sortability projection's
 *   `sortable: false` (`resolveObjectSortability`): a formula, or a field
 *   whose author declared `sortable: false`. Both MCP doors refuse such an
 *   order with `INVALID_SORT`, so `get_record_context` leaves the list out of
 *   every answer instead and states nothing (ADR-0160 D1: an author defect);
 * - `ai-context-related-link-unknown`: a `related` entry with no reference
 *   field to the root — `field` names none that points at it, or, omitted, the
 *   child has none or several (then `field` must say which);
 * - `ai-context-body-not-long-text`: `body.field` is not a long-text field
 *   (`textarea`, `markdown`, `html`, `richtext`);
 * - `ai-context-object-unknown`: the root or a `related` object is not an
 *   object this stack defines.
 *
 * Skips, as every field-existence rule in this package takes them: an object
 * the stack does not define is reported once (the root, or the related entry)
 * and its fields are not judged; an object with no readable field map is not
 * judged; a `sys_*` object is the platform's and is not judged here.
 *
 * Under a package closure the runtime publish gate states (`options.packageScope`,
 * ruling #9612) the snapshot's `objects` ARE that closure, so an object missing
 * from it may be installed and read by `get_record_context` here, yet is out of
 * the package's reach wherever it is installed without that dependency. The
 * object verdict is then worded for the closure and carries the remedy every
 * save-door rule judging an object name under a scope prints
 * ({@link closureDependencyRemedy}). Still a `warning`: the tier never refuses.
 * With no closure (`os validate`, a write naming no package) the wording is
 * unchanged.
 */

import { AI_CONTEXT_BODY_FIELD_TYPES, aiContextWhereFields } from '@objectstack/spec/ai';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { REFERENCE_VALUE_TYPES, referenceTargetOf } from '@objectstack/spec/data';
import { closureDependencyRemedy, recordsOf } from './object-graph.js';
import {
  injectedColumnDefsFor,
  unprovisionedAnchorFix,
  unprovisionedAnchorVerdict,
  unprovisionedInjectedColumnsFor,
} from './system-fields.js';

export type AiContextSeverity = 'warning';

export interface AiContextFinding {
  severity: AiContextSeverity;
  rule: string;
  /** Human-readable location, e.g. `context pack "policy_document" · related "policy_revision"`. */
  where: string;
  /** Config path, e.g. `aiContexts[0].related[1].fields[2]`. */
  path: string;
  message: string;
  hint: string;
}

export const AI_CONTEXT_OBJECT_UNKNOWN = 'ai-context-object-unknown';
export const AI_CONTEXT_FIELD_UNKNOWN = 'ai-context-field-unknown';
export const AI_CONTEXT_FIELD_UNPROVISIONED = 'ai-context-field-unprovisioned';
export const AI_CONTEXT_RELATED_LINK_UNKNOWN = 'ai-context-related-link-unknown';
export const AI_CONTEXT_BODY_NOT_LONG_TEXT = 'ai-context-body-not-long-text';
export const AI_CONTEXT_SORT_FIELD_UNSORTABLE = 'ai-context-sort-field-unsortable';

type AnyRec = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * An object's fields as a name → definition map, or `undefined` when it declares no readable map.
 *
 * The EFFECTIVE map: the declared fields plus the system columns the registry
 * injects without the author declaring them (`owner_id`, `created_at`, …;
 * {@link injectedColumnDefsFor}, the tables `applySystemFields` and the served
 * read's `applyInjectedSystemColumns` spread), a declared field winning over
 * the injected one of its name. `get_record_context` judges a pack against
 * the published definition, which carries those columns, and reads them: a
 * verdict over the declared fields alone warns on a name the tool serves.
 */
function fieldMapOf(object: AnyRec): Map<string, AnyRec> | undefined {
  const raw = object.fields;
  if (!raw || typeof raw !== 'object') return undefined;
  const fields = new Map(recordsOf(raw).map((f) => [str(f.name), f] as const).filter(([name]) => name !== ''));
  for (const [name, def] of injectedColumnDefsFor(object)) if (!fields.has(name)) fields.set(name, { ...def });
  return fields;
}

/** The object a reference field points at, or `undefined` for any other field. */
function referenceOf(def: AnyRec | undefined): string | undefined {
  if (!def || !REFERENCE_VALUE_TYPES.has(str(def.type))) return undefined;
  try {
    return referenceTargetOf(def);
  } catch {
    return undefined;
  }
}

/**
 * Report the names every context pack of `stack` gives that the stack does not
 * define. Reads `stack.aiContexts` and `stack.objects`; safe on any shape.
 */
export function validateAiContext(
  stack: AnyRec,
  options: { packageScope?: { readonly packageId: string; readonly dependencies: readonly string[] } } = {},
): AiContextFinding[] {
  const closure = options.packageScope;
  const out: AiContextFinding[] = [];
  const objects = new Map<string, AnyRec>();
  for (const o of recordsOf(stack.objects)) if (str(o.name)) objects.set(str(o.name), o);
  // [ADR-0015] Each object's injected columns with no storage behind them —
  // empty on every object whose storage the platform provisions. Existence
  // (the field map above) and provenance are separate questions: a name this
  // set holds resolves, and is judged here instead of as unknown.
  const anchorsOf = new Map<string, ReadonlySet<string>>();
  const unprovisionedOf = (object: string): ReadonlySet<string> => {
    let anchors = anchorsOf.get(object);
    if (!anchors) anchorsOf.set(object, (anchors = unprovisionedInjectedColumnsFor(objects.get(object))));
    return anchors;
  };
  /** The finding for a name that resolves on an unprovisioned anchor of `object`. */
  const unprovisioned = (object: string, name: string, where: string, path: string, subject: string, consequence: string) =>
    out.push({
      severity: 'warning',
      rule: AI_CONTEXT_FIELD_UNPROVISIONED,
      where,
      path,
      // One verdict sentence, the shared short anchor clause; why the anchor
      // has no storage and how to vouch for it is `os explain ai-context-field-unprovisioned`.
      message: `${subject}: ${unprovisionedAnchorVerdict(object, name)}, so ${consequence}`,
      hint: unprovisionedAnchorFix(object, name),
    });

  const packs = Array.isArray(stack.aiContexts) ? (stack.aiContexts as unknown[]) : [];
  packs.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const pack = raw as AnyRec;
    const packName = str(pack.name) || `aiContexts[${i}]`;
    const at = `context pack "${packName}"`;
    const root = str(pack.object);

    /** The object's field map, or `undefined` (reported once, or not judged). */
    const judged = (object: string, where: string, path: string): Map<string, AnyRec> | undefined => {
      if (!object || object.startsWith('sys_')) return undefined;
      const def = objects.get(object);
      if (!def) {
        out.push(closure
          ? {
              severity: 'warning',
              rule: AI_CONTEXT_OBJECT_UNKNOWN,
              where,
              path,
              message:
                `names object '${object}', which is outside the closure of package "${closure.packageId}" ` +
                '(the package, the packages its manifest declares in `dependencies`, and platform objects), so ' +
                'the pack reads nothing of it where the package is installed without that dependency',
              hint: closureDependencyRemedy(object, closure.packageId, 'name an object inside that closure'),
            }
          : {
              severity: 'warning',
              rule: AI_CONTEXT_OBJECT_UNKNOWN,
              where,
              path,
              message: `names object '${object}', which this stack does not define, so the pack reads nothing of it`,
              hint: 'Name an object the stack defines (check the spelling), or remove the entry',
            });
        return undefined;
      }
      return fieldMapOf(def);
    };
    const unknownFields = (names: string[], fields: Map<string, AnyRec>, object: string, where: string, path: string) => {
      names.forEach((name, k) => {
        if (fields.has(name)) {
          if (unprovisionedOf(object).has(name)) {
            unprovisioned(object, name, where, `${path}[${k}]`, `names field '${name}'`, 'the pack reads it empty on every record');
          }
          return;
        }
        out.push({
          severity: 'warning',
          rule: AI_CONTEXT_FIELD_UNKNOWN,
          where,
          path: `${path}[${k}]`,
          message: `names field '${name}', which object '${object}' does not define, so the pack silently leaves it out`,
          hint: `Name a field of '${object}' (check the spelling), or remove it from the list`,
        });
      });
    };

    const rootFields = judged(root, at, `aiContexts[${i}].object`);
    if (rootFields) {
      unknownFields(strings(pack.fields), rootFields, root, at, `aiContexts[${i}].fields`);
      const body = pack.body as AnyRec | undefined;
      const bodyField = str(body?.field);
      if (bodyField) {
        const def = rootFields.get(bodyField);
        if (!def) {
          out.push({
            severity: 'warning',
            rule: AI_CONTEXT_FIELD_UNKNOWN,
            where: `${at} · body`,
            path: `aiContexts[${i}].body.field`,
            message: `\`body.field\` names '${bodyField}', which object '${root}' does not define, so the pack carries no body`,
            hint: `Name a long-text field of '${root}' (check the spelling)`,
          });
        } else if (!(AI_CONTEXT_BODY_FIELD_TYPES as readonly string[]).includes(str(def.type))) {
          out.push({
            severity: 'warning',
            rule: AI_CONTEXT_BODY_NOT_LONG_TEXT,
            where: `${at} · body`,
            path: `aiContexts[${i}].body.field`,
            message:
              `\`body.field\` names '${bodyField}', a ${str(def.type) || 'untyped'} field; a body is a long-text ` +
              `field (${AI_CONTEXT_BODY_FIELD_TYPES.join(', ')}), so the pack carries no body`,
            hint: `Name a long-text field of '${root}' as the body, or list '${bodyField}' in \`fields\` instead`,
          });
        }
        // Type and storage are separate questions: no injected column is long
        // text, so this finding rides beside the one above, naming the cause.
        if (def && unprovisionedOf(root).has(bodyField)) {
          unprovisioned(root, bodyField, `${at} · body`, `aiContexts[${i}].body.field`, `\`body.field\` names '${bodyField}'`, 'the pack carries no body');
        }
      }
    }

    const related = Array.isArray(pack.related) ? (pack.related as unknown[]) : [];
    related.forEach((rawEntry, j) => {
      if (!rawEntry || typeof rawEntry !== 'object') return;
      const entry = rawEntry as AnyRec;
      const child = str(entry.object);
      const where = `${at} · related "${child || j}"`;
      const path = `aiContexts[${i}].related[${j}]`;
      const childFields = judged(child, where, `${path}.object`);
      if (!childFields) return;
      unknownFields(strings(entry.fields), childFields, child, where, `${path}.fields`);
      // [ADR-0160 D1, second amendment] The fields `where` and `orderBy` name.
      // One the child lacks is no condition dropped: the list is left out.
      const listLeftOut = (name: string, key: 'where' | 'orderBy', at: string) => {
        out.push({
          severity: 'warning',
          rule: AI_CONTEXT_FIELD_UNKNOWN,
          where,
          path: at,
          message:
            `\`${key}\` names field '${name}', which object '${child}' does not define, so the list is left out of ` +
            'every answer (a filter or an order is never read with one of its fields removed)',
          hint: `Name a field of '${child}' (check the spelling), or remove it from \`${key}\``,
        });
      };
      const noRows = 'a condition on it can never match a real value and the list reads no rows';
      for (const name of aiContextWhereFields(entry.where)) {
        if (!childFields.has(name)) listLeftOut(name, 'where', `${path}.where`);
        else if (unprovisionedOf(child).has(name)) unprovisioned(child, name, where, `${path}.where`, `\`where\` names field '${name}'`, noRows);
      }
      const orderBy = Array.isArray(entry.orderBy) ? (entry.orderBy as unknown[]) : [];
      // Judged by the projection the doors refuse by, never by a second reading of `type` or `sortable`.
      const sortability = orderBy.length > 0 ? resolveObjectSortability({ fields: Object.fromEntries(childFields) }).fields : {};
      orderBy.forEach((node, k) => {
        const name = node && typeof node === 'object' ? str((node as AnyRec).field) : '';
        if (!name) return;
        if (!childFields.has(name)) {
          listLeftOut(name, 'orderBy', `${path}.orderBy[${k}].field`);
          return;
        }
        if (unprovisionedOf(child).has(name)) {
          unprovisioned(child, name, where, `${path}.orderBy[${k}].field`, `\`orderBy\` sorts by field '${name}'`,
            'the order finds no column and the list is read in an arbitrary order');
        }
        const verdict = sortability[name];
        if (verdict?.sortable !== false) return;
        const why = verdict.reason === 'virtual-type' ? 'is a formula, computed on read' : 'declares `sortable: false`';
        out.push({
          severity: 'warning',
          rule: AI_CONTEXT_SORT_FIELD_UNSORTABLE,
          where,
          path: `${path}.orderBy[${k}].field`,
          message:
            `\`orderBy\` sorts by field '${name}' of object '${child}', which ${why}, so it is not offered as a sort ` +
            'and the list is left out of every answer (an order is never read with one of its fields removed)',
          hint: `Order the list by a field of '${child}' that is offered as a sort, or remove '${name}' from \`orderBy\``,
        });
      });
      if (!root || !objects.has(root)) return;
      const named = str(entry.field);
      const links = [...childFields.keys()].filter((name) => referenceOf(childFields.get(name)) === root);
      const link = named ? (referenceOf(childFields.get(named)) === root ? named : undefined) : links.length === 1 ? links[0] : undefined;
      if (link !== undefined) {
        // The link is a name the rule reads too: an injected reference to the
        // root (`owner_id` → `sys_user`) on an external child matches no row.
        if (unprovisionedOf(child).has(link)) {
          unprovisioned(child, link, where, named ? `${path}.field` : path, `the list links to '${root}' through '${link}'`, noRows);
        }
        return;
      }
      out.push({
        severity: 'warning',
        rule: AI_CONTEXT_RELATED_LINK_UNKNOWN,
        where,
        path: named ? `${path}.field` : path,
        message: named
          ? `\`field\` names '${named}', which is not a reference from '${child}' to '${root}', so the list is never read`
          : links.length === 0
            ? `'${child}' has no reference field to '${root}', so the list is never read`
            : `'${child}' has ${links.length} reference fields to '${root}' (${links.join(', ')}), so the list is never read until \`field\` names one`,
        hint: named || links.length === 0
          ? `Name the field of '${child}' that points at '${root}' in \`field\``
          : `Set \`field\` to one of ${links.join(', ')}`,
      });
    });
  });
  return out;
}
