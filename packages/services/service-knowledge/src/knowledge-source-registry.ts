// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The knowledge service's registry of sources: one slot per `(package, name)`
 * (ADR-0150, addendum of 2026-11-25; ADR-0161 K4), filled through two doors.
 *
 * ## The two doors, one schema
 *
 * - **The metadata door**: `KnowledgeServicePlugin` loads each published
 *   `knowledge_source` item. Its holder is the package the item's row is
 *   bound to, or none for a source authored in the environment.
 * - **The code door**: `KnowledgeServicePlugin({ sources })` and
 *   `IKnowledgeService.registerSource`. A source registered in code belongs to
 *   no package: it is read as the environment's own source and takes the one
 *   package-less slot of its name.
 *
 * Both parse with `KnowledgeSourceSchema` ({@link parseKnowledgeSource}), so a
 * door refuses exactly what the other refuses. The code door runs no ADR-0087
 * conversion: a registration that still writes a retired key is refused with
 * that key's own prescription (ADR-0161 K6, "every door runs the same kit" —
 * this door's half is the refusal).
 *
 * ## One name, one source
 *
 * A slot is `(package, name)`. Two packages' sources of one name are two
 * sources, and so are a package's source and a package-less one. Within the
 * package-less slot, a registration from one door never replaces a source
 * that arrived through the other: the second arrival is refused, naming both
 * doors. The same door registering its name again replaces its own earlier
 * version (a metadata item that reloads, a host that registers twice).
 *
 * ## The three spellings of a source
 *
 * - **Its name** — what the author wrote. Unique only within its holder.
 * - **Its face** — how every caller names it: a package's source is
 *   `NAMESPACE-NAME` (ADR-0150 D6, `deriveAiFaceName`), a package-less one its
 *   bare name. `search_knowledge` lists and takes faces, and so do the by-name
 *   members of `IKnowledgeService`, the hits `search` answers and the
 *   operator's rebuild action.
 * - **Its index key** ({@link indexKeyOf}) — what its index is keyed by: the
 *   document ids and what an adapter keeps for it. Never shown to a caller.
 *
 * ## Reading a caller's spelling ({@link KnowledgeSourceRegistry.resolve})
 *
 * 1. a face answers its one source; a face two sources derive is refused,
 *    naming each holder;
 * 2. otherwise a bare name resolves by ADR-0150 D3 for a caller with no
 *    package (`resolvePackageScopedHolders`): the package-less source first
 *    (its face is its bare name, so step 1 already answered it), else the one
 *    package holder, else a refusal naming each candidate by its face;
 * 3. neither: no source.
 *
 * A refusal is `409 RESOURCE_CONFLICT` (ADR-0150 D5), never a pick.
 */

import { createHash } from 'node:crypto';
import {
  RUNTIME_COMPATIBILITY_PACKAGE_ID,
  packageScopedHolderSource,
  resolvePackageScopedHolders,
} from '@objectstack/core';
import { KnowledgeSourceSchema, deriveAiFaceName, type KnowledgeSource } from '@objectstack/spec/ai';

/** The metadata type a knowledge source is. */
export const KNOWLEDGE_SOURCE_TYPE = 'knowledge_source';

/** Which door a source arrived through. */
export type KnowledgeSourceDoor = 'code' | 'metadata';

/** How a refusal names each door. */
const DOOR_TEXT: Record<KnowledgeSourceDoor, string> = {
  code: 'a registration in code (KnowledgeServicePlugin({ sources }) or registerSource)',
  metadata: 'a knowledge_source metadata item authored in this environment',
};

/** One registered source. */
export interface KnowledgeSourceEntry {
  /** What the source's index is keyed by ({@link indexKeyOf}). */
  readonly key: string;
  /** How a caller names the source: `NAMESPACE-NAME`, or the bare name of a package-less one. */
  readonly face: string;
  readonly door: KnowledgeSourceDoor;
  /** The package that holds the source; absent for a package-less one. */
  readonly packageId?: string;
  /** The holder's namespace, when the host could answer it. */
  readonly namespace?: string;
  /** The source as its author wrote it, parsed. */
  readonly authored: KnowledgeSource;
  /**
   * The source as the service and every adapter are handed it: the authored
   * source with `name` set to {@link key}. An adapter keys its store by the
   * name of the source it is handed, so two packages' sources of one name
   * never meet in a store, with no member added to the adapter contract.
   */
  readonly handed: KnowledgeSource;
}

/** Who holds a metadata item's source. */
export interface KnowledgeSourceHolder {
  packageId?: string;
  namespace?: string;
}

/** An ADR-0112 coded error. */
export function codedError(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { code, status, httpStatus: status });
}

/**
 * The key a source's index is held under.
 *
 * - A package-less source: its bare `name`.
 * - A package's source: `_p`, the first 16 hex characters of SHA-256 over the
 *   package id, `_`, the name. A package id is free text (dots, dashes, a
 *   scope) and an adapter may put the key in an identifier, so the id is
 *   hashed, not embedded; the result stays snake_case.
 *
 * A name is letter-led (`KnowledgeSourceSchema` refuses a leading `_`), so no
 * package-less key can equal a package's.
 */
export function indexKeyOf(packageId: string | undefined, name: string): string {
  if (packageId === undefined) return name;
  return `_p${createHash('sha256').update(packageId).digest('hex').slice(0, 16)}_${name}`;
}

/**
 * The package a metadata row is bound to: a non-empty `_packageId` that is not
 * the package-less row's `sys_metadata` sentinel nor the runtime's
 * compatibility id (the two spellings ADR-0150 D3 reads as "no package").
 */
export function packageIdOfItem(item: unknown): string | undefined {
  const id = (item as { _packageId?: unknown } | null | undefined)?._packageId;
  return typeof id === 'string' && id !== '' && id !== 'sys_metadata' && id !== RUNTIME_COMPATIBILITY_PACKAGE_ID
    ? id
    : undefined;
}

/**
 * Parse `input` with the one schema of the type. Answers the parsed source, or
 * the refusal's sentence: every issue, each at its own path with the schema's
 * own message (a retired key's prescription, an unknown key's suggestion).
 */
export function parseKnowledgeSource(input: unknown): { ok: true; source: KnowledgeSource } | { ok: false; message: string } {
  const parsed = KnowledgeSourceSchema.safeParse(input);
  if (parsed.success) return { ok: true, source: parsed.data as KnowledgeSource };
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path === '' ? issue.message : `at \`${path}\`: ${issue.message}`;
  });
  return { ok: false, message: issues.join(' ') };
}

/** How a refusal or a log line names an entry's holder. */
function holderText(entry: Pick<KnowledgeSourceEntry, 'packageId' | 'door'>): string {
  if (entry.packageId !== undefined) return `package "${entry.packageId}"`;
  return entry.door === 'code' ? 'no package (registered in code)' : 'no package (authored in this environment)';
}

/** The registry: every registered source, one per `(package, name)`. */
export class KnowledgeSourceRegistry {
  /** By index key, in registration order. */
  private readonly byKey = new Map<string, KnowledgeSourceEntry>();

  /** Every entry, in registration order. */
  entries(): KnowledgeSourceEntry[] {
    return [...this.byKey.values()];
  }

  /** The entry held under an index key. */
  byIndexKey(key: string): KnowledgeSourceEntry | undefined {
    return this.byKey.get(key);
  }

  /** The entry of exactly this holder and name, with no resolution. */
  slot(packageId: string | undefined, name: string): KnowledgeSourceEntry | undefined {
    const entry = this.byKey.get(indexKeyOf(packageId, name));
    return entry !== undefined && entry.packageId === packageId ? entry : undefined;
  }

  /**
   * Register a parsed source in its slot. Answers the entry and the one it
   * replaced (the same door's earlier version of the same slot), if any.
   *
   * Refused, `409 RESOURCE_CONFLICT`:
   * - the package-less slot is held by a source that arrived through the
   *   other door — naming both doors;
   * - another package's source already holds the same index key (two package
   *   ids whose hashes agree on 64 bits) — naming both packages; never merged.
   */
  register(
    source: KnowledgeSource,
    door: KnowledgeSourceDoor,
    holder: KnowledgeSourceHolder = {},
  ): { entry: KnowledgeSourceEntry; replaced?: KnowledgeSourceEntry } {
    const packageId = holder.packageId;
    const key = indexKeyOf(packageId, source.name);
    const existing = this.byKey.get(key);
    if (existing !== undefined && existing.packageId !== packageId) {
      throw codedError(
        'RESOURCE_CONFLICT',
        409,
        `[knowledge] source '${source.name}' of ${holderText({ packageId, door })} was not registered: its index key ` +
          `'${key}' is already held by source '${existing.authored.name}' of ${holderText(existing)}. Two package ids ` +
          'hash to the same key; rename one of the two sources.',
      );
    }
    if (existing !== undefined && existing.door !== door) {
      throw codedError(
        'RESOURCE_CONFLICT',
        409,
        `[knowledge] source '${source.name}' was not registered: the name is already held by a source that arrived ` +
          `through the other door. Held by: ${DOOR_TEXT[existing.door]}. Refused: ${DOOR_TEXT[door]}. ` +
          'One name is one source (ADR-0161 K4), and a registration from one door never replaces a source from the ' +
          'other. Rename one of the two, or remove the one that is not wanted.',
      );
    }
    const namespace = packageId !== undefined && typeof holder.namespace === 'string' && holder.namespace !== ''
      ? holder.namespace
      : undefined;
    const entry: KnowledgeSourceEntry = {
      key,
      face: packageId === undefined ? source.name : deriveAiFaceName({ name: source.name, namespace }),
      door,
      ...(packageId === undefined ? {} : { packageId }),
      ...(namespace === undefined ? {} : { namespace }),
      authored: source,
      handed: { ...source, name: key },
    };
    this.byKey.set(key, entry);
    return existing === undefined ? { entry } : { entry, replaced: existing };
  }

  /** Remove the entry held under an index key; answers it, or `undefined` when none was. */
  remove(key: string): KnowledgeSourceEntry | undefined {
    const entry = this.byKey.get(key);
    if (entry !== undefined) this.byKey.delete(key);
    return entry;
  }

  /**
   * The source a caller's spelling names ({@link resolveSourceRef}), or
   * `undefined` when it names none. Throws `409 RESOURCE_CONFLICT` when it
   * names more than one.
   */
  resolve(ref: string): KnowledgeSourceEntry | undefined {
    return resolveSourceRef(this.entries(), ref, (entry) => ({
      face: entry.face,
      name: entry.authored.name,
      packageId: entry.packageId,
    }));
  }
}

/** What {@link resolveSourceRef} reads of a candidate. */
export interface KnowledgeSourceSpelling {
  face: string;
  name: string;
  packageId?: string;
}

/**
 * The one rule for reading a caller's spelling of a source (the module doc),
 * over whichever candidates the caller may name: the registry's every entry,
 * or `search_knowledge`'s exposed sources — so a refusal never names a source
 * the caller is not shown. Answers the candidate, or `undefined` when `ref`
 * names none; throws `409 RESOURCE_CONFLICT` when it names more than one,
 * listing each by its face and holder.
 */
export function resolveSourceRef<T>(
  candidates: readonly T[],
  ref: string,
  spell: (candidate: T) => KnowledgeSourceSpelling,
): T | undefined {
  const spelled = candidates.map((candidate) => ({ candidate, ...spell(candidate) }));
  const faced = spelled.filter((c) => c.face === ref);
  if (faced.length === 1) return faced[0].candidate;
  if (faced.length > 1) throw ambiguous(ref, faced);
  const named = spelled.filter((c) => c.name === ref);
  if (named.length === 0) return undefined;
  // A holder holds a name once; two candidates of one holder are a malformed
  // listing, never chosen between.
  if (new Set(named.map((c) => c.packageId ?? null)).size !== named.length) throw ambiguous(ref, named);
  const resolution = resolvePackageScopedHolders<T>(
    { type: KNOWLEDGE_SOURCE_TYPE, name: ref, callerPackageId: null },
    packageScopedHolderSource(named.map((c) => [c.packageId ?? null, c.candidate] as const)),
    // A caller with no package is never asked for a closure.
    () => new Set<string>(),
  );
  if (resolution.status === 'resolved') return resolution.item;
  if (resolution.status === 'refused') throw ambiguous(ref, named);
  return undefined;
}

function ambiguous(ref: string, candidates: readonly KnowledgeSourceSpelling[]): Error {
  const list = candidates
    .map((c) => `'${c.face}' (${c.packageId === undefined ? 'held by no package' : `package "${c.packageId}"`})`)
    .join(', ');
  return Object.assign(
    codedError(
      'RESOURCE_CONFLICT',
      409,
      `[knowledge] ${JSON.stringify(ref.length > 64 ? `${ref.slice(0, 64)}…` : ref)} names ${candidates.length} knowledge sources: ${list}. ` +
        'Name the one you mean by its NAMESPACE-NAME spelling, as search_knowledge lists it in `sources`.',
    ),
    { candidates: candidates.map((c) => ({ face: c.face, ...(c.packageId === undefined ? {} : { packageId: c.packageId }) })) },
  );
}
