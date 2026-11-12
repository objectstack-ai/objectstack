// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32537 — which package's permission set a Setup or Studio page
 * addresses when more than one package holds the set's name (objectstack
 * ADR-0150 D3/D4/D5).
 *
 * A permission set is identified by `(package, name)`. Three doors take the
 * holder's package: the grant through its stored column
 * `permission_set_package`, the clone door and the activation door through
 * `?package=PKG`. Each refuses a name two packages hold, addressed by the name
 * alone, with `409 RESOURCE_CONFLICT`; the clone and activation doors name
 * every holder structured in the envelope's `details.candidates`
 * (`{ kind: 'package', packageId }` or `{ kind: 'environment' }`).
 *
 * ## When a page names a package
 *
 * Only where the name alone does not address the set
 * ({@link addressingPackageOf}): the name has more than one holder and this
 * set is a package's. A name one package holds, and the environment's own set
 * (a caller with no package is served it), are addressed by the name as
 * before, so every request and screen for them is unchanged. The package named
 * is the one the page already holds for the item (the served `_packageId`),
 * ⛔ never a holder picked here.
 *
 * ## A refusal is shown as a pick, never resolved by order
 *
 * {@link holderCandidatesOf} reads the refusal's candidates; the page shows
 * them for the administrator to choose, and the request is sent again with the
 * chosen package ({@link candidatePackage}). ⛔ No candidate is chosen here.
 *
 * ## The readings that follow a holder
 *
 * {@link storedGrantHolders}, {@link ledgerRowHolders} and
 * {@link positionReach} read a stored grant, a ledger row or a position by the
 * one rule the server reads it with (the security catalog's stored and
 * position references, `@objectstack/core`'s `ledgerRowHolders`, ADR-0150
 * D3/D7/D8), so a page keyed by `(package, name)` shows what the server
 * enforces. They are applied only where the page lists more than one holder of
 * the name ({@link PermissionSetHolding}); a name with one holder is read by
 * the name, as before.
 */

/**
 * The `_packageId` a definition rehydrated from `sys_metadata` carries: the
 * environment's own item, not a package (`@objectstack/core`'s
 * `catalogEntryAddress` reads it the same way).
 */
export const OVERLAY_PROVENANCE_SENTINEL = 'sys_metadata';

/** One holder the server named in a refusal. */
export type PermissionSetHolderCandidate =
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'environment' };

/** A holder of a name: a package id, or `null` for the environment's own set. */
export type PermissionSetHolder = string | null;

/** A stored or served package id as the server reads it: empty and the overlay sentinel are no package. */
export function holderPackageOf(packageId: unknown): PermissionSetHolder {
  return typeof packageId === 'string' && packageId.trim() !== '' && packageId !== OVERLAY_PROVENANCE_SENTINEL
    ? packageId
    : null;
}

/** The holder of a served item of the `permission` registry, from its `_packageId`. */
export function servedHolderOf(item: unknown): PermissionSetHolder {
  return holderPackageOf((item as { _packageId?: unknown } | null | undefined)?._packageId);
}

/**
 * The holders of `name` among served items of the `permission` registry (one
 * item per `(package, name)`, plus the environment's own), each once, in the
 * order served.
 */
export function holdersOfName(items: readonly unknown[], name: string): PermissionSetHolder[] {
  const out: PermissionSetHolder[] = [];
  for (const raw of items) {
    const item = raw as { name?: unknown } | null;
    if (item?.name !== name) continue;
    const holder = servedHolderOf(item);
    if (!out.includes(holder)) out.push(holder);
  }
  return out;
}

/**
 * Which holder of a name a page shows — a package, or `null` for the
 * environment's own set — and every holder of the name the page lists. A page
 * passes one only where it lists more than one holder of the name.
 */
export interface PermissionSetHolding {
  readonly packageId: PermissionSetHolder;
  readonly holders: readonly PermissionSetHolder[];
}

/**
 * The holding of `item` among `items` (served items of the `permission`
 * registry), or `undefined` when its name has one holder — the name alone
 * addresses it, and every request and reading stays by the name.
 */
export function holdingOf(items: readonly unknown[], item: unknown): PermissionSetHolding | undefined {
  const name = (item as { name?: unknown } | null)?.name;
  if (typeof name !== 'string' || name === '') return undefined;
  const holders = holdersOfName(items, name);
  return holders.length > 1 ? { packageId: servedHolderOf(item), holders } : undefined;
}

/**
 * The holding a page that reads ONE set of `name` shows (the item editor),
 * from the served `items` and the package its read named (`readPackage`):
 * that package's set, else the set the name alone addresses, which is the
 * environment's own set when it holds the name.
 *
 * - `undefined`: the name has one holder or none. The page reads by the name,
 *   as before.
 * - `null`: more than one holder serves the name and the read addresses none
 *   of them. Two package holders read by the name alone are refused, and a
 *   named package that does not hold the name is refused too. So no holder's
 *   grants are this page's to list or remove.
 */
export function holdingOfRead(
  items: readonly unknown[],
  name: string,
  readPackage: string | undefined,
): PermissionSetHolding | undefined | null {
  const holders = holdersOfName(items, name);
  if (holders.length <= 1) return undefined;
  const shown: PermissionSetHolder | undefined =
    readPackage !== undefined && readPackage !== '' ? holderPackageOf(readPackage) : holders.includes(null) ? null : undefined;
  if (shown === undefined || !holders.includes(shown)) return null;
  return { packageId: shown, holders };
}

/**
 * The package a request must name to address `holder`'s set of a name held by
 * `holders`: `undefined` when the name alone addresses it (one holder, or the
 * environment's own set), else `holder`.
 */
export function addressingPackageOf(
  holders: readonly PermissionSetHolder[],
  holder: PermissionSetHolder,
): string | undefined {
  if (holder === null || holders.length <= 1) return undefined;
  return holder;
}

/** {@link addressingPackageOf} for a holding, or none when the page passed none. */
export function holdingPackage(holding: PermissionSetHolding | undefined): string | undefined {
  return holding ? addressingPackageOf(holding.holders, holding.packageId) : undefined;
}

/** A stable key for one holder, for a list that draws a row per holder. */
export function holderKey(holder: PermissionSetHolder): string {
  return holder ?? 'environment';
}

/** `?package=PKG` for a door that addresses a set by its package, or `''` when none is named. */
export function packageQuery(packageId: string | undefined): string {
  return packageId ? `?package=${encodeURIComponent(packageId)}` : '';
}

function isCandidate(value: unknown): value is PermissionSetHolderCandidate {
  const c = value as { kind?: unknown; packageId?: unknown } | null;
  if (c?.kind === 'environment') return true;
  return c?.kind === 'package' && typeof c.packageId === 'string' && c.packageId !== '';
}

/**
 * The holders a door's `409 RESOURCE_CONFLICT` names, structured
 * (`error.details.candidates`), or `null` for any other answer — a refusal of
 * another kind, or one that names no candidate.
 */
export function holderCandidatesOf(json: unknown): PermissionSetHolderCandidate[] | null {
  const error = (json as { error?: { code?: unknown; details?: { candidates?: unknown } } } | null)?.error;
  if (error?.code !== 'RESOURCE_CONFLICT') return null;
  const candidates = error.details?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0 || !candidates.every(isCandidate)) return null;
  return candidates as PermissionSetHolderCandidate[];
}

/** The package a chosen candidate is addressed by: its id, or none for the environment's own set. */
export function candidatePackage(candidate: PermissionSetHolderCandidate): string | undefined {
  return candidate.kind === 'package' ? candidate.packageId : undefined;
}

/**
 * A door refused the name because more than one package holds it (or the
 * named package does not): the server's sentence, and the holders it named,
 * for the page to offer as a pick.
 */
export class PermissionSetHolderConflict extends Error {
  readonly candidates: readonly PermissionSetHolderCandidate[];

  constructor(message: string, candidates: readonly PermissionSetHolderCandidate[]) {
    super(message);
    this.name = 'PermissionSetHolderConflict';
    this.candidates = candidates;
  }
}

/** The holder a candidate names: its package, or `null` for the environment's own set. */
function candidateHolder(candidate: PermissionSetHolderCandidate): PermissionSetHolder {
  return candidate.kind === 'package' ? holderPackageOf(candidate.packageId) : null;
}

/**
 * The holding the administrator picked from a refusal: the picked holder,
 * among every holder the refusal named (the doors name every holder of the
 * name), so the page then reads and writes that holder's set.
 */
export function holdingFromPick(
  conflict: PermissionSetHolderConflict,
  picked: PermissionSetHolderCandidate,
): PermissionSetHolding {
  const holders: PermissionSetHolder[] = [];
  for (const candidate of conflict.candidates) {
    const holder = candidateHolder(candidate);
    if (!holders.includes(holder)) holders.push(holder);
  }
  return { packageId: candidateHolder(picked), holders };
}

/**
 * The holder one stored grant (`sys_user_permission_set`) reaches, read as the
 * resolver reads it (ADR-0150 D8 R1, `storedPermissionSetScope`): its
 * `permission_set_package` names the holder; a grant naming no package, or one
 * that no longer serves the name, is read as a caller with no package — the
 * environment's own set when it holds the name, else the one holder, else
 * nothing (a name two packages hold, named by no package, grants nothing).
 */
export function storedGrantHolders(
  rowPackage: PermissionSetHolder,
  holders: readonly PermissionSetHolder[],
): PermissionSetHolder[] {
  if (rowPackage !== null && holders.includes(rowPackage)) return [rowPackage];
  if (holders.includes(null)) return [null];
  return holders.length === 1 ? [...holders] : [];
}

/**
 * The holders one activation-ledger `permission` row reaches, read as
 * `@objectstack/core`'s `ledgerRowHolders` reads it (ADR-0150 D8 R4): a row
 * naming a holder is that holder's; a row naming no package, or one that no
 * longer serves the name, is read by the name alone — the environment's own
 * set when it holds the name, else the one holder, else every holder.
 */
export function ledgerRowHolders(
  rowPackage: PermissionSetHolder,
  holders: readonly PermissionSetHolder[],
): PermissionSetHolder[] {
  if (rowPackage !== null && holders.includes(rowPackage)) return [rowPackage];
  if (holders.includes(null)) return [null];
  if (holders.length > 0) return [...holders];
  return [rowPackage];
}

/** The audience anchors: the environment's references, whatever package served them. */
const ANCHOR_POSITIONS: ReadonlySet<string> = new Set(['everyone', 'guest']);

/**
 * Which holder a position's `permissionSets` entry for a name reaches, read as
 * the security catalog reads a position's reference (ADR-0150 D3/D7): from the
 * package that declared the position, its own set first; an
 * environment-authored position and the audience anchors are the
 * environment's reference — the environment's own set, else the one holder,
 * else nothing (a name two packages hold, named by no package, grants nothing).
 * `'closure'` when the declaring package holds no set of the name: the server
 * judges it by that package's declared dependencies, which this page does not
 * read.
 *
 * A position served under a package that holds the name reaches that
 * package's set AND the environment's reference. The server reads an ADR-0005
 * overlay, or a `.custom` override, of a package's position as the
 * environment's reference (core `security-catalog.ts`, `referenceCaller`). It
 * serves that item under the package's `_packageId`, and the served item does
 * not say whether it is the shipped position or an override. So both readings
 * are listed and counted: a deactivation confirm never says fewer people than
 * lose access.
 */
export function positionReach(
  position: unknown,
  holders: readonly PermissionSetHolder[],
): PermissionSetHolder[] | 'closure' {
  const p = position as { name?: unknown } | null;
  const environmentReference = storedGrantHolders(null, holders);
  const caller = typeof p?.name === 'string' && ANCHOR_POSITIONS.has(p.name) ? null : servedHolderOf(position);
  if (caller === null) return environmentReference;
  if (!holders.includes(caller)) return 'closure';
  return environmentReference.includes(caller) ? [caller] : [caller, ...environmentReference];
}
