// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared picklists at runtime — the judgments the registry and the boot audit
 * share, kept pure so each has ONE spelling.
 *
 * A select field may author `picklist: '<name>'` instead of `options`
 * (`FieldSchema.picklist`, `data/picklist.zod.ts`). The runtime owes three
 * things for it, and every one of them is answered from the ONE resolved list
 * this module builds:
 *
 *  1. **Merge.** A picklist's options are its own, followed by what every
 *     `picklistExtensions` entry adds. Additive only: a value the list already
 *     carries is REFUSED, never overwritten — last-wins would let a second
 *     package silently relabel or recolour a value the owner declared
 *     ({@link findDuplicatePicklistValue}).
 *  2. **Serve.** A field bound to a picklist is served with the resolved
 *     options written onto it and `picklist` kept, the
 *     `PicklistServedFieldSchema` shape ({@link resolvePicklistFieldsOnto}).
 *     The write door reads the same served field, so the set a client is
 *     offered and the set a write is judged by cannot diverge.
 *  3. **Refuse an unknown name.** A field naming a list no loaded package
 *     declares is a load-time error naming the field and the package, never a
 *     field served with no options ({@link describeUnresolvedPicklistReferences}).
 *
 * The resolved field is RE-DERIVED on every fold, never trusted: a body that
 * already carries `options` beside `picklist` (a served copy written back
 * into the metadata service by the boot bridge) has them replaced by the
 * current list, and has them REMOVED when the list is gone. A stale copy can
 * therefore never widen what a write accepts — with no list, the record
 * validator refuses every value of the field instead of accepting any.
 */

/** One option, as `SelectOptionSchema` declares it (only `value` is read here). */
export interface PicklistOptionLike {
  value: string | number | boolean;
  label?: string;
  [key: string]: unknown;
}

/** One contribution to a picklist's options: the owning list's own, or one extension's. */
export interface PicklistContribution {
  /** The package that declared these options; `undefined` for a bare registration. */
  packageId: string | undefined;
  /** `'picklist'` for the owning list, `'extension'` for a `picklistExtensions` entry. */
  kind: 'picklist' | 'extension';
  options: readonly PicklistOptionLike[];
}

/** One field that names a picklist, with the package that declared the field. */
export interface PicklistReference {
  object: string;
  field: string;
  picklist: string;
  packageId: string | undefined;
}

/** The ADR-0112 envelope every refusal here is thrown in — the code the registration seams already use. */
export interface PicklistMetadataError extends Error {
  code: 'INVALID_METADATA';
  status: 422;
  httpStatus: 422;
}

export function picklistMetadataError(message: string): PicklistMetadataError {
  const err = new Error(message) as PicklistMetadataError;
  err.code = 'INVALID_METADATA';
  err.status = 422;
  err.httpStatus = 422;
  return err;
}

function describePackage(packageId: string | undefined): string {
  return packageId ? `package '${packageId}'` : 'a registration with no package';
}

function describeContribution(c: PicklistContribution): string {
  return c.kind === 'picklist'
    ? `the picklist itself (${describePackage(c.packageId)})`
    : `an extension from ${describePackage(c.packageId)}`;
}

/**
 * The first value two contributions both declare, in merge order — or
 * `undefined` when every value is distinct. Values compare by their string
 * form, the form the record validator matches a written value against.
 *
 * A value repeated INSIDE one contribution counts too: two entries for one
 * value in a single list are the same ambiguity (which label, which colour)
 * whoever declared them.
 */
export function findDuplicatePicklistValue(
  contributions: readonly PicklistContribution[],
): { value: string; first: PicklistContribution; second: PicklistContribution } | undefined {
  const seen = new Map<string, PicklistContribution>();
  for (const contribution of contributions) {
    for (const option of contribution.options) {
      if (!option || typeof option !== 'object' || option.value === undefined) continue;
      const value = String(option.value);
      const first = seen.get(value);
      if (first) return { value, first, second: contribution };
      seen.set(value, contribution);
    }
  }
  return undefined;
}

/** The refusal for a value the list already carries, naming both declarations. */
export function duplicatePicklistValueError(
  picklist: string,
  duplicate: { value: string; first: PicklistContribution; second: PicklistContribution },
): PicklistMetadataError {
  return picklistMetadataError(
    `Picklist '${picklist}' would carry the value '${duplicate.value}' twice: it is declared by `
    + `${describeContribution(duplicate.first)} and again by ${describeContribution(duplicate.second)}. `
    + 'A picklist merges its extensions additively, so a value already in the list cannot be added '
    + 'again — the later declaration does not replace the earlier one. Remove the repeated value, or '
    + 'give the new option a value of its own.',
  );
}

/** The merged options of a picklist: every contribution's, in order. */
export function mergePicklistOptions(contributions: readonly PicklistContribution[]): PicklistOptionLike[] {
  const merged: PicklistOptionLike[] = [];
  for (const contribution of contributions) {
    for (const option of contribution.options) merged.push({ ...option });
  }
  return merged;
}

function resolveField(field: unknown, resolve: (picklist: string) => readonly PicklistOptionLike[] | undefined): unknown {
  if (!field || typeof field !== 'object') return field;
  const picklist = (field as { picklist?: unknown }).picklist;
  if (typeof picklist !== 'string' || picklist.length === 0) return field;
  const options = resolve(picklist);
  if (options) return { ...(field as object), options: options.map((o) => ({ ...o })) };
  // Unresolved: drop any options the body carried, so a stale served copy
  // cannot stand in for the list. The validator refuses every value of a
  // picklist-bound field that has none.
  if (!('options' in (field as object))) return field;
  const { options: _stale, ...rest } = field as Record<string, unknown>;
  return rest;
}

/**
 * Write each picklist-bound field's resolved options onto an object body.
 *
 * Returns the body BY REFERENCE when it has no picklist-bound field, so every
 * object that does not use the feature is served byte-identically. Handles
 * both field spellings a served body carries (a name-keyed record, an array).
 */
export function resolvePicklistFieldsOnto<T>(
  body: T,
  resolve: (picklist: string) => readonly PicklistOptionLike[] | undefined,
): T {
  if (!body || typeof body !== 'object') return body;
  const fields = (body as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object') return body;
  const bound = (f: unknown): boolean =>
    !!f && typeof f === 'object' && typeof (f as { picklist?: unknown }).picklist === 'string';
  if (Array.isArray(fields)) {
    if (!fields.some(bound)) return body;
    return { ...(body as object), fields: fields.map((f) => resolveField(f, resolve)) } as T;
  }
  const entries = Object.entries(fields as Record<string, unknown>);
  if (!entries.some(([, f]) => bound(f))) return body;
  const next: Record<string, unknown> = {};
  for (const [name, f] of entries) next[name] = resolveField(f, resolve);
  return { ...(body as object), fields: next } as T;
}

/** Every field of an object body that names a picklist. */
export function collectPicklistReferences(
  object: string,
  body: unknown,
  packageId: string | undefined,
): PicklistReference[] {
  const refs: PicklistReference[] = [];
  const fields = (body as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return refs;
  const entries: Array<[string, unknown]> = Array.isArray(fields)
    ? fields.map((f) => [String((f as { name?: unknown })?.name ?? ''), f])
    : Object.entries(fields as Record<string, unknown>);
  for (const [field, def] of entries) {
    const picklist = (def as { picklist?: unknown } | undefined)?.picklist;
    if (typeof picklist === 'string' && picklist.length > 0) refs.push({ object, field, picklist, packageId });
  }
  return refs;
}

/** A `picklistExtensions` entry whose `extend` names a list no loaded package declares. */
export interface OrphanPicklistExtension {
  picklist: string;
  packageId: string | undefined;
}

/**
 * The load-time refusal for picklist names nothing declares — every field
 * that references one, and every `picklistExtensions` entry that extends one,
 * so an author fixes the whole set in one pass. `undefined` when there are
 * none.
 *
 * An extension of an undeclared list is refused for the same reason the
 * field is: its options would otherwise be held for a list that never
 * arrives, and the values an author added would silently go nowhere.
 */
export function describeUnresolvedPicklistReferences(
  unresolved: readonly PicklistReference[],
  orphanExtensions: readonly OrphanPicklistExtension[] = [],
): PicklistMetadataError | undefined {
  if (unresolved.length === 0 && orphanExtensions.length === 0) return undefined;
  const lines = [
    ...unresolved.map(
      (r) => `field '${r.object}.${r.field}' (${describePackage(r.packageId)}) references picklist '${r.picklist}'`,
    ),
    ...orphanExtensions.map(
      (e) => `a \`picklistExtensions\` entry (${describePackage(e.packageId)}) extends picklist '${e.picklist}'`,
    ),
  ];
  return picklistMetadataError(
    `${lines.length === 1 ? 'A picklist is named' : `${lines.length} picklist names are used`} `
    + `that no loaded package declares: ${lines.join('; ')}. A field bound to a picklist takes its options `
    + 'from that list and has none of its own, and an extension adds options to a list that must exist, so '
    + 'neither can take effect until the list does. Declare the picklist (a `*.picklist.ts` file, or '
    + '`defineStack({ picklists })`) in the package or in one it depends on, or correct the name.',
  );
}

/** A manifest's `objects` in either authored spelling, as `[name, body]` pairs. */
function manifestObjects(source: any): Array<[string, unknown]> {
  const objects = source?.objects;
  if (Array.isArray(objects)) return objects.map((o: any) => [String(o?.name ?? ''), o]);
  if (objects && typeof objects === 'object') return Object.entries(objects);
  return [];
}

/** The manifest itself and its nested `plugins[]`, which register under its package (`registerPlugin`). */
function manifestSources(manifest: any): any[] {
  const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins.filter((p: unknown) => p && typeof p === 'object') : [];
  return [manifest, ...plugins];
}

/**
 * The picklist references one manifest brings — its objects', its
 * `objectExtensions`' and its nested plugins' fields — attributed to the
 * package that registers them. Read before the manifest is registered, by the
 * post-boot install door.
 */
export function collectManifestPicklistReferences(manifest: any, packageId: string | undefined): PicklistReference[] {
  const refs: PicklistReference[] = [];
  for (const source of manifestSources(manifest)) {
    for (const [name, body] of manifestObjects(source)) refs.push(...collectPicklistReferences(name, body, packageId));
    for (const ext of Array.isArray(source?.objectExtensions) ? source.objectExtensions : []) {
      refs.push(...collectPicklistReferences(String(ext?.extend ?? ''), ext, packageId));
    }
  }
  return refs;
}

/** The picklist names one manifest declares, nested plugins included. */
export function collectManifestPicklistNames(manifest: any): Set<string> {
  const names = new Set<string>();
  for (const source of manifestSources(manifest)) {
    for (const p of Array.isArray(source?.picklists) ? source.picklists : []) {
      if (typeof p?.name === 'string') names.add(p.name);
    }
  }
  return names;
}

/** The `picklistExtensions` targets one manifest brings, nested plugins included. */
export function collectManifestPicklistExtensions(manifest: any, packageId: string | undefined): OrphanPicklistExtension[] {
  const out: OrphanPicklistExtension[] = [];
  for (const source of manifestSources(manifest)) {
    for (const ext of Array.isArray(source?.picklistExtensions) ? source.picklistExtensions : []) {
      if (typeof ext?.extend === 'string') out.push({ picklist: ext.extend, packageId });
    }
  }
  return out;
}
