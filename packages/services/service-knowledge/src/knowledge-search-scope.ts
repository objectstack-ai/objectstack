// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0161 K8, item 17, as its dated note of 2026-11-25 shapes it] The record
 * scope of a search: the bounds a caller's `KnowledgeSearchOptions.scope` is
 * held to, the terms the service builds from it for each source
 * (`AdapterSearchOptions.scope`), and the check every hit passes after the
 * adapter answers.
 *
 * An entry `{ object, ids }` becomes, for one source:
 *
 * - a `record` term, when `object` is the object the source indexes;
 * - a `metadata` term on the ONE field of the source's `metadataFields` that is
 *   a parent link to `object` — a `lookup` or `master_detail` field whose
 *   target (`referenceTargetOf`, the spec's one answer) is `object`, and that
 *   assembly does not withhold (credential-class, `internal`);
 * - nothing otherwise: no such field, no registered definition, or two or more
 *   such fields (reading (4) of the note: the entry does not reach the source).
 *
 * A `user` field is not a parent link (reading (3)), and neither is a field of
 * the indexed object that points back at it: an entry naming the source's own
 * object is the `record` term and nothing else (reading (2)).
 *
 * The scope is judged on the index copy — the values assembly stored with the
 * document — and never decides access: the permission re-read of every hit
 * stays the access decision. Source admission already holds every
 * `metadataFields` member to be queryable by the caller, so a `metadata` term
 * is a filter the caller could run on the object's own rows; the parent row is
 * never read.
 */

import type { AdapterScopeTerm, KnowledgeSearchOptions } from '@objectstack/spec/contracts';
import type { KnowledgeHit, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import { referenceTargetOf } from '@objectstack/spec/data';
import { collectCredentialWriteResponseFields, collectInternalWriteResponseFields } from '@objectstack/core';
import { declaredFields } from './knowledge-source-admission.js';

/** One entry of `KnowledgeSearchOptions.scope`. */
export type SearchScopeEntry = NonNullable<KnowledgeSearchOptions['scope']>[number];

/** Most entries a search scope may hold (stated on `AdapterSearchOptions.scope`). */
export const SEARCH_SCOPE_MAX_ENTRIES = 10;
/** Most ids one scope entry may hold (stated on `AdapterSearchOptions.scope`). */
export const SEARCH_SCOPE_MAX_IDS = 500;

/** The field types that link a record to a parent record (reading (3)): never `user`, never `tree`. */
const PARENT_LINK_TYPES: ReadonlySet<string> = new Set(['lookup', 'master_detail']);

const ENTRY_KEYS: ReadonlySet<string> = new Set(['object', 'ids']);

/** An ADR-0112 coded refusal of a scope past its bounds. */
function scopeRefusal(message: string): Error {
  return Object.assign(new Error(`[knowledge] search scope: ${message}`), {
    code: 'VALIDATION_ERROR' as const,
    status: 400 as const,
  });
}

/**
 * The caller's `scope`, held to its bounds: `undefined` for no scope, else the
 * entries as given (an empty list, or an entry with no ids, is kept — it is
 * answered with no hits, never read as "no scope"). Throws a coded refusal
 * (`VALIDATION_ERROR`, 400) naming the first thing that is wrong: anything but
 * a list, more than {@link SEARCH_SCOPE_MAX_ENTRIES} entries, an entry that is
 * not `{ object, ids }`, an `object` or id that is not a non-empty string, or
 * more than {@link SEARCH_SCOPE_MAX_IDS} ids in one entry.
 */
export function readSearchScope(scope: unknown): SearchScopeEntry[] | undefined {
  if (scope === undefined) return undefined;
  if (!Array.isArray(scope)) throw scopeRefusal('takes a list of { object, ids } entries.');
  if (scope.length > SEARCH_SCOPE_MAX_ENTRIES) {
    throw scopeRefusal(`takes at most ${SEARCH_SCOPE_MAX_ENTRIES} entries, got ${scope.length}.`);
  }
  return scope.map((entry: unknown, i): SearchScopeEntry => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw scopeRefusal(`entry ${i} is not an object; each entry is { object, ids }.`);
    }
    const unknownKey = Object.keys(entry).find((key) => !ENTRY_KEYS.has(key));
    if (unknownKey !== undefined) {
      throw scopeRefusal(`entry ${i} has the key '${unknownKey}'; an entry takes only object and ids.`);
    }
    const { object, ids } = entry as { object?: unknown; ids?: unknown };
    if (typeof object !== 'string' || object.length === 0) {
      throw scopeRefusal(`entry ${i} needs object, a non-empty string naming an object.`);
    }
    if (!Array.isArray(ids)) throw scopeRefusal(`entry ${i} needs ids, a list of record ids.`);
    if (ids.length > SEARCH_SCOPE_MAX_IDS) {
      throw scopeRefusal(`entry ${i} takes at most ${SEARCH_SCOPE_MAX_IDS} ids, got ${ids.length}.`);
    }
    if (!ids.every((id) => typeof id === 'string' && id.length > 0)) {
      throw scopeRefusal(`entry ${i} has an id that is not a non-empty string.`);
    }
    return { object, ids: [...(ids as string[])] };
  });
}

/** What {@link scopeTermsFor} answers for one source. */
export interface SourceScope {
  /** The terms the source's search is handed; empty when no entry reaches it (not searched). */
  terms: AdapterScopeTerm[];
  /** Entries a source does not reach because it lists two or more parent links to their object (reading (4)). */
  ambiguous: Array<{ object: string; fields: string[] }>;
}

/**
 * The terms `scope` gives one source. `schemaOf` answers an object's
 * registered definition (`undefined` when none is registered). An entry with
 * no ids gives no term: it holds for no document.
 */
export function scopeTermsFor(
  source: KnowledgeSource,
  scope: readonly SearchScopeEntry[],
  schemaOf: (object: string) => unknown,
): SourceScope {
  const out: SourceScope = { terms: [], ambiguous: [] };
  const objSource = source.source;
  let links: Map<string, string[]> | undefined;
  for (const entry of scope) {
    if (entry.ids.length === 0) continue;
    if (entry.object === objSource.object) {
      out.terms.push({ kind: 'record', ids: [...entry.ids] });
      continue;
    }
    links ??= parentLinksOf(objSource, schemaOf(objSource.object));
    const fields = links.get(entry.object) ?? [];
    if (fields.length === 1) out.terms.push({ kind: 'metadata', field: fields[0], ids: [...entry.ids] });
    else if (fields.length > 1) out.ambiguous.push({ object: entry.object, fields: [...fields] });
  }
  return out;
}

/**
 * The parent links a source carries: each `metadataFields` member that is a
 * `lookup` / `master_detail` field of the indexed object, not withheld by
 * assembly, by the object it points at. Empty without a registered definition.
 * A field whose target cannot be read is no link.
 */
function parentLinksOf(objSource: ObjectKnowledgeSource, schema: unknown): Map<string, string[]> {
  const links = new Map<string, string[]>();
  const declared = declaredFields(schema);
  if (declared === undefined) return links;
  const defs = new Map(declared);
  const withheld = new Set<string>([
    ...collectCredentialWriteResponseFields(schema),
    ...collectInternalWriteResponseFields(schema),
  ]);
  for (const field of new Set(objSource.metadataFields ?? [])) {
    if (withheld.has(field)) continue;
    const def = defs.get(field);
    const type = (def as { type?: unknown } | null | undefined)?.type;
    if (typeof type !== 'string' || !PARENT_LINK_TYPES.has(type)) continue;
    let target: string | undefined;
    try {
      target = referenceTargetOf(def);
    } catch {
      target = undefined;
    }
    if (target === undefined) continue;
    const fields = links.get(target);
    if (fields) fields.push(field);
    else links.set(target, [field]);
  }
  return links;
}

/**
 * The most record ids a non-system caller's visible-id read may answer and
 * still narrow a source's search to them ({@link narrowToVisible}): the same
 * bound one scope entry is held to. The read asks one more than this, so a
 * caller who may read more is told apart from one who may read exactly this many.
 */
export const SEARCH_VISIBLE_IDS_MAX = SEARCH_SCOPE_MAX_IDS;

/**
 * The terms a source's search is handed once the ids of its records the caller
 * may read are known (`visible`, at most {@link SEARCH_VISIBLE_IDS_MAX}). The
 * adapter ranks only the rows some term holds for, so it never spends `topK` on
 * a row the permission re-check would remove.
 *
 * The adapter ORs the terms it is handed, so the visible ids are never added as
 * one more term: that would widen a caller's own scope to every record they may
 * read. They are intersected with it instead:
 *
 * - no caller scope → one `record` term holding the visible ids;
 * - a caller scope of `record` terms only → one `record` term holding the
 *   caller's ids (in their order, once each) that are visible;
 * - a caller scope with a `metadata` (parent) term → `undefined`: a union of
 *   terms cannot say "this parent AND these records", so the source is searched
 *   on the caller's terms alone, as before, and its hits re-checked one by one.
 *
 * A returned term may hold no ids: the caller may read none of the records the
 * search could answer.
 */
export function narrowToVisible(
  terms: readonly AdapterScopeTerm[] | undefined,
  visible: readonly string[],
): AdapterScopeTerm[] | undefined {
  if (terms === undefined) return [{ kind: 'record', ids: [...new Set(visible)] }];
  if (terms.some((term) => term.kind !== 'record')) return undefined;
  const readable = new Set(visible);
  const ids = new Set<string>();
  for (const term of terms) for (const id of term.ids) if (readable.has(id)) ids.add(id);
  return [{ kind: 'record', ids: [...ids] }];
}

/**
 * The check every hit passes after its adapter answers, whatever the adapter
 * did: `true` when some term holds for the hit, judged on the hit's
 * `sourceRecordId` (a `record` term) or `metadata[field]` (a `metadata` term).
 * A hit that does not carry the value is out of scope (fail closed).
 */
export function scopeCheck(terms: readonly AdapterScopeTerm[]): (hit: KnowledgeHit) => boolean {
  const compiled = terms.map((term) => ({ term, ids: new Set(term.ids) }));
  return (hit) =>
    compiled.some(({ term, ids }) =>
      valueInIds(term.kind === 'record' ? hit.sourceRecordId : hit.metadata?.[term.field], ids),
    );
}

/**
 * A stored value against a term's ids, compared as strings: a string or a
 * number matches when `String(value)` is one of them, a list when any element
 * does (a `multiple: true` lookup), anything else never.
 */
function valueInIds(value: unknown, ids: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some((element) => scalarInIds(element, ids));
  return scalarInIds(value, ids);
}

function scalarInIds(value: unknown, ids: ReadonlySet<string>): boolean {
  return (typeof value === 'string' || typeof value === 'number') && ids.has(String(value));
}
