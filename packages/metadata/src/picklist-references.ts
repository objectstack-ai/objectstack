// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/metadata/picklist-references` — which picklists a manifest's
 * fields name, and the residual-picklist refusal built on that walk: ONE
 * spelling of each, called by the engine and by the author-time doors.
 *
 * ## The walk
 *
 * A select field may author `picklist: '<name>'` instead of `options`
 * (`FieldSchema.picklist`). What a manifest brings, picklist-wise, is read off
 * the manifest itself and each nested `plugins[]` entry (which registers under
 * the manifest's package): the `picklist` of every field its `objects` (a
 * name-keyed record or an array) and its `objectExtensions` declare
 * ({@link collectManifestPicklistReferences}), the lists it declares
 * ({@link collectManifestPicklistNames}) and the lists its
 * `picklistExtensions` extend ({@link collectManifestPicklistExtensions}).
 * `@objectstack/objectql`'s registry, its boot audit and its install door read
 * these through `picklist-resolution.ts`, which re-exports them.
 *
 * ## The residual-picklist refusal
 *
 * A composed stack (one that carries `packages[]`) keeps its RESIDUAL
 * picklists — top-level lists no package body declares, as the residual rule
 * answers it (`unclaimedTopLevel`, `@objectstack/metadata`) — as metadata
 * only: the engine never registers them (ADR-0130 D4). One that a field names
 * is loud already: a residual object's field makes that object listed and not
 * served, and a body's field fails the boot's picklist audit. One that NO
 * field the engine registers names would go missing from the engine with
 * nothing said, so it is refused ({@link unreferencedResidualPicklists}):
 *
 *  - by the engine's `manifest` service, before anything of the stack
 *    registers, as one `INVALID_METADATA` naming every such list;
 *  - by `os validate` and `os build`, which foretell that boot, as one
 *    `picklist-residual-unreferenced` finding per list.
 *
 * Both read the lists, the location and the words from here, so the boot and
 * the doors cannot disagree about which lists are refused or what is said.
 * ⛔ Never a second copy at a door.
 *
 * "Named" is judged off the fields the engine registers from the stack: every
 * package body's (its objects, its `objectExtensions` and its nested
 * `plugins[]`) and the residual's own objects. ⛔ Never off the whole top
 * level: in a composed stack a top-level `objectExtensions` entry, a
 * top-level copy of an object a body declares and a top-level `plugins[]`
 * entry are registered by no door, so a list only they name is dropped all
 * the same. And never off a registry, which is still filling while a boot
 * registers.
 *
 * ## Why a subpath of its own
 *
 * The engine's registry reads the walk, and objectql's ADR-0076 lean entry
 * must not reach this package's ROOT entry, which loads the manager and the
 * filesystem machinery. The judgement takes the residual answer as a value
 * rather than calling `unclaimedTopLevel` itself for the same reason, and so
 * the CLI imports it without booting a kernel. Pure: nothing here throws or
 * registers; the engine throws its envelope, the doors report.
 */

/** One field that names a picklist, with the package that declared the field. */
export interface PicklistReference {
  object: string;
  field: string;
  picklist: string;
  packageId: string | undefined;
}

/** A `picklistExtensions` entry's target, with the package that brings it. */
export interface OrphanPicklistExtension {
  picklist: string;
  packageId: string | undefined;
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
 * package that registers them.
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

/**
 * The part of a stack's residual this judgement reads — what
 * `unclaimedTopLevel` (`@objectstack/metadata`) answers, taken structurally so
 * this entry does not load the root.
 */
export interface ResidualPicklistInput {
  ownerId: string | undefined;
  items: ReadonlyArray<{ field: string; index: number; type: string; item: unknown }>;
}

/** The words of the refusal: what is wrong, then what to do. */
export interface ResidualPicklistWording {
  judgement: string;
  prescription: string;
  /** `judgement` and `prescription` as one message: the engine's `INVALID_METADATA` text. */
  text: string;
}

/** One residual picklist nothing names, located in the stack. */
export interface UnreferencedResidualPicklist {
  /** The list's `name`. */
  name: string;
  /** The stack collection it sits in (`picklists`). */
  field: string;
  /** Its position there, for the finding's `path` (`picklists[1]`). */
  index: number;
  /** The refusal of this one list: an author-time door's finding. */
  wording: ResidualPicklistWording;
}

/** What {@link unreferencedResidualPicklists} answers. */
export interface UnreferencedResidualPicklists {
  /** The stack the lists sit on, as the words name it. */
  owner: string;
  /** Every refused list, in the residual's order. */
  picklists: UnreferencedResidualPicklist[];
  /** The refusal of all of them in one sentence: the engine's message. */
  wording: ResidualPicklistWording;
}

function residualPicklistWording(names: readonly string[], owner: string): ResidualPicklistWording {
  const one = names.length === 1;
  const listed = names.map((name) => `'${name}'`).join(', ');
  const judgement =
    `${one ? 'Picklist' : 'Picklists'} ${listed} ${one ? 'is' : 'are'} `
    + `declared on the top level of stack '${owner}', and no package body declares `
    + `${one ? 'it' : 'them'} and no object field the engine registers names `
    + `${one ? 'it' : 'them'} (in a composed stack, a top-level \`objectExtensions\` entry, a `
    + 'top-level copy of an object a package body declares and a top-level `plugins[]` entry are not '
    + 'registered). The engine registers a top-level picklist only through a package body, so this list '
    + 'would be missing from the engine with nothing said.';
  const prescription =
    'Declare it inside the `packages[]` entry of the package whose objects use it; or name it from a field of '
    + 'the object meant to use it (a top-level object that does is then listed and not served until both move '
    + 'into a package body); or remove it from the top level.';
  return { judgement, prescription, text: `${judgement} ${prescription}` };
}

/**
 * [ADR-0130 D4] Every residual picklist of a composed stack that no object
 * field the engine registers names — the lists the boot refuses and
 * `os validate` / `os build` refuse first — with their locations and the
 * words, or `undefined` when there is none. See the module header.
 *
 * @param residual The stack's residual, as `unclaimedTopLevel` answers it
 *   (`undefined` for a stack without `packages[]`, which has none).
 * @param bodies   The stack's package bodies (the manifests the boot
 *   registers); their order does not matter.
 */
export function unreferencedResidualPicklists(
  residual: ResidualPicklistInput | undefined,
  bodies: readonly unknown[],
): UnreferencedResidualPicklists | undefined {
  if (!residual) return undefined;
  const lists = residual.items
    .filter((entry) => entry.type === 'picklist')
    .map((entry) => ({ entry, name: String((entry.item as { name?: unknown } | undefined)?.name) }));
  if (lists.length === 0) return undefined;
  const named = new Set<string>();
  const residualObjects = residual.items.filter((entry) => entry.type === 'object').map((entry) => entry.item);
  for (const source of [...bodies, { objects: residualObjects }]) {
    for (const ref of collectManifestPicklistReferences(source, undefined)) named.add(ref.picklist);
  }
  const unreferenced = lists.filter(({ name }) => !named.has(name));
  if (unreferenced.length === 0) return undefined;
  const owner = residual.ownerId ?? '<none>';
  return {
    owner,
    picklists: unreferenced.map(({ entry, name }) => ({
      name,
      field: entry.field,
      index: entry.index,
      wording: residualPicklistWording([name], owner),
    })),
    wording: residualPicklistWording(unreferenced.map(({ name }) => name), owner),
  };
}
