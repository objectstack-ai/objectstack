// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27069 — related-list name integrity] Every name an object gives one of its
 * related lists — each `relatedLists[i]` (the business order of its record
 * page's related lists) and each `fieldGroups[i].relatedList` (a group that
 * stands for one body table) — must match an INBOUND relationship: a `lookup`
 * / `master_detail` field of a child object whose `reference` is this object.
 * An entry is a child object name (every relationship of that child) or
 * `object.field` (that one FK).
 *
 * ## Why a lint rule as well as `defineStack`
 *
 * `defineStack` already refuses such an entry (`STACK_CROSS_REFERENCE_INVALID`,
 * `collectRelatedListNameErrors` in `@objectstack/spec`), so `os validate` and
 * `os build` refuse it. The runtime publish door does not run `defineStack`:
 * an object written through `PUT /api/v1/meta/object` — Studio's object form,
 * a REST `/meta` author, an MCP/AI author — is judged by the authoring rules
 * alone, and the object parse cannot judge a cross-object name. Without this
 * member the door stored a misspelt entry, and the record page placed nothing
 * for it, silently. This rule gives the door the same verdict: `error`, and the
 * same sentence `defineStack` writes (held equal by this rule's test).
 *
 * ## Which children are judged — the universe the caller hands over
 *
 * The children are the stack's `objects` (map or array form) with the fields
 * their `objectExtensions` add merged in by name, since an extension can be
 * the one that adds the FK.
 *
 *  - A named child that IS in the stack but carries no such FK is refused on
 *    every surface: that child's fields are known.
 *  - A named child that is NOT in the stack is refused only when the stack is
 *    the whole collection the host serves — the runtime gate on a write with
 *    no package closure in force (`wholeCollection`, the #24668 reading:
 *    registry plus stored rows, unnarrowed), where a child missing from it
 *    exists nowhere. Under a package closure a child outside it may be a
 *    downstream package's object that points in, which the closure does not
 *    carry by construction; on the CLI it may be a sibling package's or a
 *    platform object, and `defineStack` judges it there with the artifact's
 *    scope. Both stay unjudged here.
 *
 * The audit / ownership FKs (`created_by`, `updated_by`, `owner_id`) never
 * become a related list (objectui `deriveRelatedLists`), so they are not
 * inbound relationships an entry may name — the set `defineStack` excludes.
 *
 * ## A field group names body tables only (#27478)
 *
 * A field group's `relatedList` positions a BODY TABLE; it never promotes a
 * side card (ruling B on #27055: body-ness is the FK's own keys,
 * `isBodyTableRelationship` in `@objectstack/spec/data`). So a group whose
 * entry names a relationship that is not one — a side card, or a list hidden by
 * `relatedList: false` — is `related-list-group-not-body` at `error`: the
 * record page would draw nothing at the group. Judged on the same children as
 * the name check above (a child the stack holds, whose FK keys are known), and
 * the sentence is `fieldGroupBodyTableRefusal`'s, the one `defineStack` writes.
 * `relatedLists` entries are not judged this way: they order body tables and
 * side cards alike.
 */

import { fieldGroupBodyTableRefusal, type NamedInboundRelationship } from '@objectstack/spec/data';
import { recordsOf } from './object-graph.js';

/** A related-list entry that matches no inbound relationship of its object. */
export const RELATED_LIST_REF_UNKNOWN = 'related-list-ref-unknown';

/** A field group's `relatedList` naming a relationship that is not a body table. */
export const RELATED_LIST_GROUP_NOT_BODY = 'related-list-group-not-body';

export interface RelatedListRefFinding {
  /** Always `error`: the same verdict `defineStack` gives. */
  severity: 'error';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `object "crm_lead" › relatedLists`. */
  where: string;
  /** Machine path, e.g. `objects[0].relatedLists[1]`. */
  path: string;
  message: string;
  hint: string;
}

export interface RelatedListRefOptions {
  /**
   * The stack's `objects` is the whole collection the host serves, so a child
   * missing from it exists nowhere and is refused. Set by the runtime gate on
   * a write with no package closure in force; absent on the CLI.
   */
  wholeCollection?: boolean;
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Never a related list, so never an inbound relationship (objectui `AUDIT_FK_FIELDS`). */
const AUDIT_FKS: ReadonlySet<string> = new Set(['created_by', 'updated_by', 'owner_id']);

const HINT =
  'Name a child object that has a lookup / master_detail field pointing at this object, ' +
  'or object.field to pick one FK of a child with several; remove the entry otherwise.';

const NOT_BODY_HINT =
  "Mark the relationship relatedList: 'primary' on the child's FK (or leave relatedList off an inline-edited " +
  "master_detail), name only a body table as object.field, or remove the group's relatedList.";

/** The inbound relationships, spelled the way an entry may name them. */
function spell(relationships: ReadonlyArray<{ child: string; field: string }>): string {
  if (relationships.length === 0) return 'it has none';
  const perChild = new Map<string, number>();
  for (const r of relationships) perChild.set(r.child, (perChild.get(r.child) ?? 0) + 1);
  const names = relationships.map((r) => (perChild.get(r.child) === 1 ? r.child : `${r.child}.${r.field}`));
  return `the inbound relationships are ${[...new Set(names)].map((n) => `'${n}'`).join(', ')}`;
}

/**
 * Validate every object's `relatedLists` entries and field-group `relatedList`
 * names against the inbound relationships the stack's objects declare. Pure
 * `(stack) => Finding[]`; no I/O, safe on the parsed stack and the raw config.
 */
export function validateRelatedListRefs(stack: AnyRec, options?: RelatedListRefOptions): RelatedListRefFinding[] {
  const findings: RelatedListRefFinding[] = [];
  if (!isRec(stack)) return findings;
  const objects = recordsOf(stack.objects);
  if (objects.length === 0) return findings;

  // Child object name → its fields (declaration and extensions merged by name).
  const fieldsByObject = new Map<string, AnyRec>();
  for (const obj of objects) {
    if (typeof obj.name !== 'string') continue;
    fieldsByObject.set(obj.name, { ...fieldsByObject.get(obj.name), ...(isRec(obj.fields) ? obj.fields : {}) });
  }
  for (const ext of recordsOf(stack.objectExtensions)) {
    if (typeof ext.extend !== 'string') continue;
    fieldsByObject.set(ext.extend, { ...fieldsByObject.get(ext.extend), ...(isRec(ext.fields) ? ext.fields : {}) });
  }

  // Parent name → its inbound relationships, in child then field order.
  const inbound = new Map<string, NamedInboundRelationship[]>();
  for (const [child, fields] of fieldsByObject) {
    for (const [field, def] of Object.entries(fields)) {
      if (!isRec(def) || (def.type !== 'lookup' && def.type !== 'master_detail')) continue;
      if (typeof def.reference !== 'string' || AUDIT_FKS.has(field)) continue;
      const list = inbound.get(def.reference) ?? [];
      list.push({ child, field, def });
      inbound.set(def.reference, list);
    }
  }

  // Walk the raw collection so reported positions count what the author wrote.
  const raw = stack.objects;
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.map((obj, i) => [`objects[${i}]`, obj])
    : isRec(raw)
      ? Object.entries(raw).map(([name, def]) => [`objects.${name}`, isRec(def) ? { name, ...def } : def])
      : [];

  for (const [objPath, obj] of entries) {
    if (!isRec(obj) || typeof obj.name !== 'string' || obj.name.length === 0) continue;
    const parentName = obj.name;
    const relationships = inbound.get(parentName) ?? [];

    // The inbound relationships an entry names: every FK of a bare child, or the one `object.field`.
    const namedBy = (entry: string): NamedInboundRelationship[] => {
      const dot = entry.indexOf('.');
      const child = dot === -1 ? entry : entry.slice(0, dot);
      const field = dot === -1 ? undefined : entry.slice(dot + 1);
      return relationships.filter((r) => r.child === child && (field === undefined || r.field === field));
    };
    const judge = (entry: unknown, subject: string, key: string, path: string): void => {
      if (typeof entry !== 'string' || entry.length === 0) return;
      const child = entry.includes('.') ? entry.slice(0, entry.indexOf('.')) : entry;
      if (namedBy(entry).length > 0) return;
      if (!fieldsByObject.has(child) && !options?.wholeCollection) return;
      findings.push({
        severity: 'error',
        rule: RELATED_LIST_REF_UNKNOWN,
        where: `object "${parentName}" › ${key}`,
        path,
        // The sentence `defineStack` writes for the same entry, word for word.
        message:
          `Object '${parentName}' ${subject} '${entry}' matches no inbound relationship of '${parentName}' ` +
          `(a lookup / master_detail field of a child object whose reference is '${parentName}'); ` +
          `${spell(relationships)}. Name the child object, or object.field when that child has more than one.`,
        hint: HINT,
      });
    };

    if (Array.isArray(obj.relatedLists)) {
      obj.relatedLists.forEach((entry, i) =>
        judge(entry, `relatedLists[${i}]`, 'relatedLists', `${objPath}.relatedLists[${i}]`));
    }
    if (Array.isArray(obj.fieldGroups)) {
      obj.fieldGroups.forEach((group, i) => {
        if (!isRec(group) || group.relatedList === undefined) return;
        const path = `${objPath}.fieldGroups[${i}].relatedList`;
        judge(group.relatedList, `fieldGroups[${i}].relatedList`, 'fieldGroups', path);
        if (typeof group.relatedList !== 'string' || group.relatedList.length === 0) return;
        const message = fieldGroupBodyTableRefusal(parentName, i, group.relatedList, namedBy(group.relatedList));
        if (message === undefined) return;
        findings.push({
          severity: 'error',
          rule: RELATED_LIST_GROUP_NOT_BODY,
          where: `object "${parentName}" › fieldGroups`,
          path,
          // The sentence `defineStack` writes for the same group, word for word.
          message,
          hint: NOT_BODY_HINT,
        });
      });
    }
  }
  return findings;
}
