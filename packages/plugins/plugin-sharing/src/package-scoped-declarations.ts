// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Declared sharing rules, queues and assignment rules on `(package, name)` (ADR-0150 D3/D4, child E4)
 *
 * The three types this plugin reads from the registry are behavioural metadata
 * (ADR-0150 D1 bucket 2): two installed packages may each ship an item of the
 * same name, and that is not a conflict. What used to read them by bare name
 * took the FIRST registered holder in silence (`declaredItems().find`, the
 * declared sharing rules' one-rule-per-name skip), or, in one reader, the LAST
 * (`queuesOf`'s `new Map(declared…)`). Each reader now asks
 * {@link resolveDeclaredName}, and it answers one item or refuses, naming every
 * candidate.
 *
 * ## The one rule, and who owns it
 *
 * ⛔ This file does not resolve anything itself. A name the listing holds
 * more than once is resolved by objectql's {@link resolvePackageScopedName}
 * (child R, ADR-0150 D3), the one resolver every reader of the epic shares;
 * there is no first-registered fallback and no pick between candidates here.
 *
 * What this file adds is the POPULATION it asks about: the items
 * `listItems(type)` lists — which hides a disabled package's items, as every
 * one of these readers did before (the console stops serving a disabled
 * package's metadata; disable is reversible). So:
 *
 *  - **no listed item** of the name → not found, as before;
 *  - **one listed item** → that item: there is one enabled holder and nothing
 *    to choose, the answer every reader gave before (ADR-0150 reading (b));
 *  - **two or more** → the resolver decides: the environment's own item, or
 *    the unique package holder (an ADR-0005 overlay bound to it answers for
 *    it), or a refusal naming every holder. The caller is the environment
 *    (no package): these reads are the platform enumerating its declarations
 *    and the Setup doors that switch or guard them, which belong to no
 *    package (ADR-0150 D3, "a caller with no package").
 *
 * A registry that cannot answer `(package, name)` — one with no
 * package-scoped slice (`packageScopedHoldersOf` and its two readers), such
 * as the kernel `metadata` service the declared sharing rules fall back to on
 * a registry-less host — gets no pick either: a name listed under two
 * holders is refused, naming them; under one holder, it is that holder's.
 *
 * ## The two red lines (epic #31527)
 *
 *  - **Never loosens.** A name with one listed holder answers what it
 *    answered; a name with two answers a refusal where it answered the first
 *    (the narrowing ADR-0150's E4 row declares). Nothing that refused before
 *    answers now.
 *  - **Ambiguity is reported, never guessed.** Every refusal is the
 *    resolver's {@link PackageScopedRefusal}, naming every candidate in its
 *    vocabulary; a door answers it as {@link PackageScopedNameRefusedError}
 *    (`409 RESOURCE_CONFLICT`, ADR-0150 D5's status for ambiguity).
 */

import {
  packageScopedRefusalMessage,
  resolvePackageScopedName,
  type PackageScopedHolder,
  type PackageScopedRefusal,
  type PackageScopedRegistry,
  type PackageScopedType,
} from '@objectstack/objectql';

/** The three declared types this plugin reads (ADR-0150 D1 bucket 2). */
export type SharingDeclarationType = Extract<PackageScopedType, 'sharing_rule' | 'queue' | 'assignment_rule'>;

/** What one bare name of a declared type answers. */
export type DeclaredNameAnswer<T> =
  | { readonly status: 'resolved'; readonly item: T }
  | { readonly status: 'not-found' }
  | { readonly status: 'refused'; readonly refusal: PackageScopedRefusal };

/** The package an item is registered under (`_packageId`, the registry's stamp), or `null`. */
export function declaredPackageIdOf(item: unknown): string | null {
  const record = item as { _packageId?: unknown; packageId?: unknown } | null | undefined;
  const id = record?._packageId ?? record?.packageId;
  return typeof id === 'string' && id !== '' && id !== 'sys_metadata' ? id : null;
}

/** An item's name, or `null` for an item that carries none. */
function nameOf(item: unknown): string | null {
  const name = (item as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name !== '' ? name : null;
}

/** Does `registry` carry the package-scoped slice the resolver reads? */
export function isPackageScopedRegistry(registry: unknown): registry is PackageScopedRegistry {
  const r = registry as Partial<Record<keyof PackageScopedRegistry, unknown>> | null | undefined;
  return (
    typeof r?.packageScopedHoldersOf === 'function' &&
    typeof r.getPackageScopedItem === 'function' &&
    typeof r.getEnvironmentScopedItem === 'function' &&
    typeof r.getPackage === 'function' &&
    typeof r.getAllPackages === 'function'
  );
}

/**
 * A listing that cannot be asked `(package, name)` holds `name` under two or
 * more holders: the refusal, in the resolver's own vocabulary and words.
 */
function listingRefusal(type: SharingDeclarationType, name: string, holders: readonly (string | null)[]): PackageScopedRefusal {
  const candidates: PackageScopedHolder[] = holders.map((id) =>
    id === null ? { kind: 'environment' } : { kind: 'package', packageId: id },
  );
  const base = {
    status: 'refused' as const,
    reason: 'ambiguous-in-environment' as const,
    type,
    name,
    callerPackageId: null,
    candidates,
  };
  return { ...base, message: packageScopedRefusalMessage(base) };
}

/**
 * Resolve the bare `name` of a declared `type` among `listed` — the items
 * `listItems(type)` (or the fallback source) lists — as the module doc says:
 * one listed item answers itself, two or more are asked of
 * {@link resolvePackageScopedName} when `registry` can answer it, and
 * refused otherwise.
 */
export function resolveDeclaredName<T>(
  registry: unknown,
  type: SharingDeclarationType,
  name: string,
  listed: readonly T[],
): DeclaredNameAnswer<T> {
  const matches = listed.filter((item) => nameOf(item) === name);
  if (matches.length === 0) return { status: 'not-found' };
  const holders = [...new Set(matches.map(declaredPackageIdOf))];
  if (matches.length === 1) return { status: 'resolved', item: matches[0] };
  if (!isPackageScopedRegistry(registry)) {
    // The same holder listed twice is one item; two holders are a refusal.
    return holders.length === 1 ? { status: 'resolved', item: matches[0] } : { status: 'refused', refusal: listingRefusal(type, name, holders) };
  }
  const resolution = resolvePackageScopedName<T>(registry, { type, name });
  if (resolution.status === 'resolved') return { status: 'resolved', item: resolution.item };
  if (resolution.status === 'refused') return { status: 'refused', refusal: resolution };
  return { status: 'not-found' };
}

/**
 * Every listed declaration, one per name — each name resolved by
 * {@link resolveDeclaredName}, in the order the listing first names it. A
 * refused name serves nothing and is handed to `onRefused` (the reader reports
 * it); it is never served as its first or last holder.
 */
export function servedDeclarations<T>(
  registry: unknown,
  type: SharingDeclarationType,
  listed: readonly T[],
  onRefused?: (refusal: PackageScopedRefusal) => void,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of listed) {
    const name = nameOf(item);
    if (name === null) {
      out.push(item); // nameless: the reader's own shape check refuses it, as before
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    const answer = resolveDeclaredName(registry, type, name, listed);
    if (answer.status === 'resolved') out.push(answer.item);
    else if (answer.status === 'refused') onRefused?.(answer.refusal);
  }
  return out;
}

/**
 * A bare name of a declared sharing rule, queue or assignment rule that two or
 * more packages hold, read where a door needs ONE: the resolver's refusal,
 * with every candidate. `code` + `status` are the ADR-0112 envelope, the
 * status ADR-0150 D5 gives an ambiguous bare name (`409`), under the
 * conflict code this plugin's name guards already answer.
 */
export class PackageScopedNameRefusedError extends Error {
  readonly code = 'RESOURCE_CONFLICT';
  readonly status = 409;
  readonly refusal: PackageScopedRefusal;
  constructor(refusal: PackageScopedRefusal) {
    super(refusal.message);
    this.name = 'PackageScopedNameRefusedError';
    this.refusal = refusal;
  }
}

/**
 * The refusal a reader reports when it leaves a name unserved: once per type
 * and name per process (the caller keeps the set), at `error` — the
 * declaration that would grant, route or staff is not in force while nothing
 * else looks wrong (AGENTS.md, degradation log levels).
 */
export function reportRefusedDeclaration(
  logger: { error?: (m: string, meta?: any) => void; warn?: (m: string, meta?: any) => void } | undefined,
  reported: Set<string>,
  refusal: PackageScopedRefusal,
): void {
  const key = `${refusal.type}::${refusal.name}::${refusal.callerPackageId ?? ''}`;
  if (reported.has(key)) return;
  reported.add(key);
  const message = `[package-scoped] ${refusal.message} Nothing is served for that name until it resolves.`;
  const meta = {
    type: refusal.type,
    name: refusal.name,
    reason: refusal.reason,
    candidates: refusal.candidates.map((c) => (c.kind === 'package' ? c.packageId : 'environment')),
  };
  if (logger?.error) logger.error(message, meta);
  else logger?.warn?.(message, meta);
}
