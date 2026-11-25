// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { AiContextSchema, type AiContext } from '@objectstack/spec/ai';
import { REFERENCE_VALUE_TYPES, referenceTargetOf } from '@objectstack/spec/data';

/**
 * [ADR-0160 D4, "The seams" ③] The objects a `get_record_context` call may
 * read, known from the call alone.
 *
 * The read set is the root object, each `related[].object` of the pack the
 * call selects, and the target object of each lookup the pack lists — in
 * `fields` or in a `related` entry's `fields`. It is a function of the
 * validated arguments and PUBLISHED metadata only, never of the caller or of
 * record data, so anything installed on the ordinary tool seams (an audit, a
 * masking or an AI-identity interceptor — cloud ADR-0119 D3) can judge the
 * call before it runs. The executor plans its reads from this same function
 * ({@link selectContextPack} and {@link planObjectsOf} are what both use), and
 * a caller's projected plan reads a subset of the set, never more.
 *
 * The set is the call's plan when it is computed, not a guarantee across a
 * publish: a pack published between an interceptor's judgement and the
 * executor's reads changes it. The data door still decides every read.
 */

/** What the read-set function reads: published metadata only. */
export interface RecordContextMetadataReads {
  /** The published context packs. */
  listContextPacks(): Promise<readonly unknown[]>;
  /** An object's published definition, or `null`. */
  publishedObjectDefinitionOf(objectName: string): Promise<Record<string, unknown> | null>;
}

/** The arguments the read set is a function of. */
export interface RecordContextReadSetArgs {
  objectName: string;
  context?: string;
}

/** The outcome of pack selection (ADR-0160 D4 step 3). */
export type ContextPackSelection =
  | { kind: 'selected'; pack: AiContext }
  | { kind: 'unknown_name' }
  | { kind: 'none' }
  | { kind: 'several'; names: string[] }
  | { kind: 'duplicate'; name: string };

/** The published packs that parse, in listing order. A row that does not parse is no pack. */
export function parsedContextPacks(rows: readonly unknown[]): AiContext[] {
  const packs: AiContext[] = [];
  for (const row of rows) {
    const parsed = AiContextSchema.safeParse(row);
    if (parsed.success) packs.push(parsed.data as AiContext);
  }
  return packs;
}

/**
 * Pack selection, with no silent fallback: `context` names a pack rooted on
 * `objectName` or nothing is selected (one outcome for a name no pack has and
 * for a pack rooted on another object); without `context`, the one pack rooted
 * on `objectName`, or none, or several. Two published packs of one name on one
 * root (two packages may each ship one) are never chosen between: the name is
 * refused as `duplicate`, whether `context` names it or it is the only name.
 */
export function selectContextPack(packs: readonly AiContext[], args: RecordContextReadSetArgs): ContextPackSelection {
  const rooted = packs.filter((p) => p.object === args.objectName);
  if (args.context !== undefined) {
    const named = rooted.filter((p) => p.name === args.context);
    if (named.length > 1) return { kind: 'duplicate', name: args.context };
    return named.length === 1 ? { kind: 'selected', pack: named[0] } : { kind: 'unknown_name' };
  }
  if (rooted.length === 0) return { kind: 'none' };
  const names = [...new Set(rooted.map((p) => p.name))].sort();
  if (names.length > 1) return { kind: 'several', names };
  return rooted.length === 1 ? { kind: 'selected', pack: rooted[0] } : { kind: 'duplicate', name: names[0] };
}

/** An object definition's fields as a name → definition map (both stored shapes). */
export function fieldMapOf(def: Record<string, unknown> | null | undefined): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const raw = def?.fields;
  if (Array.isArray(raw)) {
    for (const f of raw) {
      if (f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string') {
        out.set((f as { name: string }).name, f as Record<string, unknown>);
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [name, f] of Object.entries(raw as Record<string, unknown>)) {
      if (f && typeof f === 'object') out.set(name, f as Record<string, unknown>);
    }
  }
  return out;
}

/** The object a reference field points at, or `undefined` for any other field. */
export function lookupTargetOf(def: Record<string, unknown> | undefined): string | undefined {
  if (!def || typeof def.type !== 'string' || !REFERENCE_VALUE_TYPES.has(def.type)) return undefined;
  try {
    return referenceTargetOf(def);
  } catch {
    // A carrier no reader can read is no relationship.
    return undefined;
  }
}

/**
 * The link field of a `related` entry, resolved ONCE on the child's published
 * definition: the named field when it points at the root, else the child's
 * one reference field that does. `undefined` is an author defect (no such
 * field, or several with none named), reported on author surfaces.
 */
export function resolveRelatedLink(
  entry: { field?: string },
  childPublished: Map<string, Record<string, unknown>>,
  root: string,
): string | undefined {
  if (entry.field !== undefined) {
    return lookupTargetOf(childPublished.get(entry.field)) === root ? entry.field : undefined;
  }
  const links = [...childPublished.keys()].filter((name) => lookupTargetOf(childPublished.get(name)) === root);
  return links.length === 1 ? links[0] : undefined;
}

/**
 * The objects a selected pack reaches, in first-reached order: the root, each
 * related child, then each lookup target of the root's listed fields and of
 * each related entry's listed columns — read off the PUBLISHED definitions.
 */
export async function planObjectsOf(
  pack: AiContext,
  publishedObjectDefinitionOf: RecordContextMetadataReads['publishedObjectDefinitionOf'],
): Promise<string[]> {
  const objects: string[] = [pack.object];
  const add = (name: string | undefined) => {
    if (name && !objects.includes(name)) objects.push(name);
  };
  for (const entry of pack.related ?? []) add(entry.object);
  const rootFields = fieldMapOf(await publishedObjectDefinitionOf(pack.object));
  for (const name of pack.fields ?? []) add(lookupTargetOf(rootFields.get(name)));
  for (const entry of pack.related ?? []) {
    if (!entry.fields?.length) continue;
    const childFields = fieldMapOf(await publishedObjectDefinitionOf(entry.object));
    for (const name of entry.fields) add(lookupTargetOf(childFields.get(name)));
  }
  return objects;
}

/**
 * [ADR-0160 D4 ③] The read set of a `get_record_context` call: the selected
 * pack (when one is selected) and every object the call may read. When no
 * pack is selected the set is the root alone — the one object the call reads
 * before it is refused.
 */
export async function recordContextReadSet(
  args: RecordContextReadSetArgs,
  reads: RecordContextMetadataReads,
): Promise<{ pack?: string; objects: string[] }> {
  const selection = selectContextPack(parsedContextPacks(await reads.listContextPacks()), args);
  if (selection.kind !== 'selected') return { objects: [args.objectName] };
  return {
    pack: selection.pack.name,
    objects: await planObjectsOf(selection.pack, (name) => reads.publishedObjectDefinitionOf(name)),
  };
}
