// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  packageScopedHolderSource,
  resolvePackageScopedHolders,
  RUNTIME_COMPATIBILITY_PACKAGE_ID,
} from '@objectstack/core';
import { AiContextSchema, deriveAiFaceName, type AiContext } from '@objectstack/spec/ai';
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

/**
 * [ADR-0150 D6, addendum 2026-11-25] The manifest namespace of an installed
 * package, by its id — what a package's pack face is derived from
 * (`NS-NAME`). `undefined` for an id the host cannot place.
 */
export type PackageNamespaceOf = (packageId: string) => string | undefined | Promise<string | undefined>;

/** What the read-set function reads: published metadata only. */
export interface RecordContextMetadataReads {
  /** The published context packs. */
  listContextPacks(): Promise<readonly unknown[]>;
  /** An object's published definition, or `null`. */
  publishedObjectDefinitionOf(objectName: string): Promise<Record<string, unknown> | null>;
  /**
   * [ADR-0150 D6] The namespace of the package holding a pack
   * ({@link PackageNamespaceOf}). OPTIONAL: absent, every pack's face is its
   * bare name, as an environment pack's is.
   */
  packageNamespace?: PackageNamespaceOf;
}

/** The arguments the read set is a function of. */
export interface RecordContextReadSetArgs {
  objectName: string;
  context?: string;
}

/**
 * [ADR-0150 addendum 2026-11-25] One published pack as selection reads it:
 * the pack, its holder and its AI face. A pack is identified by
 * `(package, name)` (bucket 3, beside `skill`): two packages may each ship a
 * pack of one name, and the face tells them apart where a model types the
 * name — `NS-NAME` for a package's pack (`deriveAiFaceName`, the one
 * derivation), the bare `NAME` for an environment pack.
 */
export interface ContextPackCandidate {
  pack: AiContext;
  /** The package holding the pack (its row's `_packageId`); absent for an environment pack. */
  packageId?: string;
  /** The pack's AI face: `NS-NAME` for a package's pack, its bare name otherwise. */
  face: string;
}

/** How an answer names one candidate: its face, and its holder for a face two packs derive. */
export interface ContextPackCandidateName {
  face: string;
  /** The holder's package id; absent for an environment pack. */
  packageId?: string;
}

/** The outcome of pack selection (ADR-0160 D4 step 3). */
export type ContextPackSelection =
  | { kind: 'selected'; pack: AiContext; face: string }
  | { kind: 'unknown_name' }
  | { kind: 'none' }
  /** `context` omitted and several packs on the root: each by its face, with its label. */
  | { kind: 'several'; packs: Array<{ face: string; label: string }> }
  /** Never chosen between: a face two packs derive, or a bare name D3 cannot resolve; every candidate named. */
  | { kind: 'duplicate'; name: string; candidates: ContextPackCandidateName[] };

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
 * The package a pack's row is bound to: a non-empty `_packageId` that is not
 * the package-less row's `sys_metadata` sentinel nor the runtime's
 * compatibility id (the two spellings ADR-0150 D3 reads as "no package").
 */
function holderOf(pack: AiContext): string | undefined {
  const id = (pack as { _packageId?: unknown })._packageId;
  return typeof id === 'string' && id !== '' && id !== 'sys_metadata' && id !== RUNTIME_COMPATIBILITY_PACKAGE_ID
    ? id
    : undefined;
}

/**
 * Each pack with its holder and its face ({@link ContextPackCandidate}), in
 * listing order. A holder's namespace is asked once per package; a host that
 * cannot answer it (no `namespaceOf`, or an id it cannot place) derives the
 * bare name, as for an environment pack.
 */
export async function contextPackCandidates(
  packs: readonly AiContext[],
  namespaceOf?: PackageNamespaceOf,
): Promise<ContextPackCandidate[]> {
  const namespaces = new Map<string, string | undefined>();
  const out: ContextPackCandidate[] = [];
  for (const pack of packs) {
    const packageId = holderOf(pack);
    let namespace: string | undefined;
    if (packageId !== undefined && namespaceOf) {
      if (!namespaces.has(packageId)) {
        let ns: string | undefined;
        try {
          ns = await namespaceOf(packageId);
        } catch {
          ns = undefined;
        }
        namespaces.set(packageId, typeof ns === 'string' && ns !== '' ? ns : undefined);
      }
      namespace = namespaces.get(packageId);
    }
    out.push({
      pack,
      ...(packageId !== undefined ? { packageId } : {}),
      face: deriveAiFaceName({ name: pack.name, namespace }),
    });
  }
  return out;
}

const nameOf = (c: ContextPackCandidate): ContextPackCandidateName =>
  (c.packageId !== undefined ? { face: c.face, packageId: c.packageId } : { face: c.face });

/**
 * Pack selection, with no silent fallback (ADR-0160 D4 step 3; ADR-0150's
 * addendum of 2026-11-25, reader 1). The candidates are the packs rooted on
 * `objectName`: a pack on another root is answered as no pack, one outcome
 * with a name no pack has.
 *
 * `context` given, read as a skill prompt's name is (`lookupSkillPrompt` in
 * `@objectstack/mcp`):
 *
 * 1. **a face** answers its one pack; a face two packs derive is refused,
 *    naming each holder;
 * 2. **otherwise a bare name** resolves by ADR-0150 D3 for a caller with no
 *    package (`resolvePackageScopedHolders`): the environment's own pack
 *    (whose face IS its bare name, so step 1 already answered it), else the
 *    one package holder, else a refusal naming each candidate by its face;
 * 3. neither: no pack.
 *
 * `context` omitted: the one pack rooted on `objectName`, or none, or several
 * — each listed by its face with its label. Several packs that all derive one
 * face are never chosen between either: refused, naming each holder.
 */
export function selectContextPack(
  candidates: readonly ContextPackCandidate[],
  args: RecordContextReadSetArgs,
): ContextPackSelection {
  const rooted = candidates.filter((c) => c.pack.object === args.objectName);
  if (args.context !== undefined) {
    const wanted = args.context;
    const faced = rooted.filter((c) => c.face === wanted);
    if (faced.length === 1) return { kind: 'selected', pack: faced[0].pack, face: faced[0].face };
    if (faced.length > 1) return { kind: 'duplicate', name: wanted, candidates: faced.map(nameOf) };
    const named = rooted.filter((c) => c.pack.name === wanted);
    if (named.length === 0) return { kind: 'unknown_name' };
    // A holder holds a name once (one slot per `(package, name)`); two rows of
    // one holder are a malformed listing, never chosen between.
    const holders = new Set(named.map((c) => c.packageId ?? null));
    if (holders.size !== named.length) return { kind: 'duplicate', name: wanted, candidates: named.map(nameOf) };
    const resolution = resolvePackageScopedHolders<ContextPackCandidate>(
      { type: 'ai_context', name: wanted, callerPackageId: null },
      packageScopedHolderSource(named.map((c) => [c.packageId ?? null, c] as const)),
      // A caller with no package is never asked for a closure.
      () => new Set<string>(),
    );
    if (resolution.status === 'resolved') {
      return { kind: 'selected', pack: resolution.item.pack, face: resolution.item.face };
    }
    if (resolution.status === 'refused') return { kind: 'duplicate', name: wanted, candidates: named.map(nameOf) };
    return { kind: 'unknown_name' };
  }
  if (rooted.length === 0) return { kind: 'none' };
  if (rooted.length === 1) return { kind: 'selected', pack: rooted[0].pack, face: rooted[0].face };
  const faces = new Set(rooted.map((c) => c.face));
  if (faces.size === 1) return { kind: 'duplicate', name: rooted[0].face, candidates: rooted.map(nameOf) };
  const packs = rooted
    .map((c) => ({ face: c.face, label: c.pack.label }))
    .sort((a, b) => (a.face === b.face ? a.label.localeCompare(b.label) : a.face < b.face ? -1 : 1));
  return { kind: 'several', packs };
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
 * pack (when one is selected), by its AI face (ADR-0150's addendum of
 * 2026-11-25: `NS-NAME` for a package's pack, so two packages' packs of one
 * name are told apart; the bare name for an environment pack), and every
 * object the call may read. When no pack is selected the set is the root
 * alone — the one object the call reads before it is refused.
 */
export async function recordContextReadSet(
  args: RecordContextReadSetArgs,
  reads: RecordContextMetadataReads,
): Promise<{ pack?: string; objects: string[] }> {
  const candidates = await contextPackCandidates(parsedContextPacks(await reads.listContextPacks()), reads.packageNamespace);
  const selection = selectContextPack(candidates, args);
  if (selection.kind !== 'selected') return { objects: [args.objectName] };
  return {
    pack: selection.face,
    objects: await planObjectsOf(selection.pack, (name) => reads.publishedObjectDefinitionOf(name)),
  };
}
