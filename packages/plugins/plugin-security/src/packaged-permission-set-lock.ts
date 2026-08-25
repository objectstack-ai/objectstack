// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LOCK THE BASE, CLONE TO CUSTOMIZE — the server half of the maintainer
 * ruling of 2026-08-24, recorded verbatim and untranslated:
 *
 *   > 同意 第一步(创业阶段,Salesforce 式)
 *
 * Step 1 of the mainstream-platform comparison: a package-declared permission
 * set is a LOCKED BASE. A Studio/API save that targets one is refused loudly,
 * with a message that names the sanctioned path — clone it and edit the clone.
 * The clone is an ordinary org-owned set with no upgrade linkage, so upgrades
 * keep flowing to the base untouched. No silent overlay row is ever minted
 * again.
 *
 * ⛔ Explicitly NOT chartered by that ruling, and deliberately absent here: the
 * ServiceNow-style explicit overlay layer (badge / customization list /
 * diff-vs-base / revert / upgrade skip-report). Recorded as the mature
 * direction if customer pull for in-place customization ever appears.
 *
 * ⛔ Also not chartered: any reap, merge or migration of overlays that already
 * exist. {@link detectPackagedPermissionSetOverlays} is a READING — count plus
 * names — and it writes nothing. Disposition of existing forks is a follow-up
 * reading for the maintainer.
 *
 * ## The question this module answers, and the read it refuses to use
 *
 * "Is this permission set package-declared?" is the ONE question the lock
 * turns on, so getting the read wrong inverts the whole feature: a read that
 * answers "not package-declared" when it merely failed to find out would
 * ACCEPT exactly the save this lock exists to refuse — a silent fork produced
 * by the code written to stop silent forks.
 *
 * ⛔ So the answer is NOT taken from a name-keyed page over
 * `sys_permission_set`. The batched existence oracle
 * (`seed-name-lookup.ts`'s `buildExistingByName`) capped its UNSCOPED page at
 * `limit: names.length`, which truncates the moment one name can carry more
 * than one row — and a truncated page read as `absent`. #11518 has since
 * repaired that: the page budget is measured (one row more than it will hold is
 * requested, so overflow is DETECTED) and an overflowing page degrades to the
 * per-item read instead of answering. ⚠️ That does not make this oracle safe to
 * ask HERE, and the reason is worth stating rather than re-deriving: unscoped,
 * `buildExistingByName` answers with the FIRST row by id for a name, so on a
 * name several organizations hold it can answer with somebody else's row — a
 * different wrong answer to the same question. This lock's read must have no
 * page in it at all.
 *
 * ⭐ The answer comes from the engine's SchemaRegistry instead — the same
 * source `bootstrapDeclaredPermissions`' {@link readDeclared} and
 * `permission-set-overlay-discard.ts`'s eligibility test already use, so this
 * plugin keeps ONE spelling of "package-declared" rather than two (Prime
 * Directive #8). That read is an in-memory array: no page, no cap, no `$in`,
 * no driver. Truncation is not a failure mode it HAS, which is a structural
 * property rather than a promise — `packaged-permission-set-lock.test.ts`
 * pins it by failing every name-keyed page read and showing the verdict
 * unchanged.
 *
 * ## Why not `managed_by`
 *
 * The ruling's parenthetical calls the target "a row carrying package
 * provenance", and the `managed_by` column is the obvious reading of that. It
 * is also measurably the WRONG fact, in both directions:
 *
 *  - too NARROW — the `provenance_skip` mechanism `permission-set-drift.ts`
 *    documents is precisely a genuinely package-declared set whose row's
 *    `managed_by` was never `'package'`. Gating on the column would leave the
 *    field-reported shape unlocked;
 *  - too BROAD — a `managed_by:'package'` row whose definition lives only in
 *    `sys_metadata` (authored and published through the METADATA door,
 *    ADR-0070, materialized by the ADR-0086 P2 publish path) has no artifact
 *    behind it. Editing it is a direct edit of the one stored definition; it
 *    forks nothing, and ADR-0094 D5-R names it the surviving
 *    `allowRuntimeCreate` neighbour. Locking it would retire a tier the ADR
 *    keeps on purpose, and would be the over-broad refusal the ruling did not
 *    ask for.
 *
 * So provenance is decided from the ARTIFACT, exactly as
 * `permission-set-overlay-discard.ts` decided it for the discard action.
 *
 * ## Fail-closed on ambiguity
 *
 * {@link classifyPackagedPermissionSet} has THREE verdicts, not two, for the
 * same reason `ExistingLookupResult` does: a read that could not ANSWER is not
 * the answer "no". Both sources are consulted; if every source that exists
 * fails — or none exists at all — the verdict is `unknown`, and the write door
 * refuses. Accepting on `unknown` would be a guess on a write door, in the one
 * direction that cannot be undone (an overlay, once minted, wins forever).
 */

/**
 * ⛔ This module imports NOTHING from the rest of the plugin, and that is
 * structural rather than stylistic: `permission-set-projection.ts` imports
 * THIS module (its write door is the lock's only enforcement point), so any
 * import back the other way — directly, or through
 * `bootstrap-declared-permissions.ts`, which itself imports the projection
 * module — would close a cycle around a write door.
 *
 * ⚠️ In particular it does not reuse {@link readDeclared}, and that is a
 * deliberate strictness difference rather than a second spelling: `readDeclared`
 * normalizes a failed registry read to `[]`, which is right for its callers
 * (boot seeders that can safely do nothing) and exactly wrong for a write door,
 * where `[]` would read as "no package declares this name" and ACCEPT. Same
 * source, same member, same `'permission'` type key — the tri-state is what
 * differs, and the module header says why.
 */

/**
 * The marker `permission-set-projection.ts` stamps on bodies it syncs into the
 * metadata manager's in-memory registry, so its own copy of an overlay body can
 * never masquerade as a shipped artifact.
 *
 * It lives HERE, and the projection module imports it from here, so the
 * constant has exactly one home — a lock that decides "packaged" partly by the
 * absence of this marker must not be reading a second, drifting spelling of it.
 */
export const ENV_PROJECTION_MARKER = '_envProjection';

/**
 * The `_packageId` value the metadata layer stamps on a RUNTIME SHADOW — an
 * item hydrated into the registry from a `sys_metadata` overlay row rather
 * than shipped as an artifact. `readDeclaredBody` in the projection module
 * excludes it for the same reason this does: a shadow is the overlay, not the
 * declaration it shadows, and reading it as "declared" would lock a set that
 * no package ships.
 */
const RUNTIME_SHADOW_PACKAGE_ID = 'sys_metadata';

/** Provenance verdict for one permission-set name. THREE outcomes, not two. */
export type PackagedSetVerdict =
  /** An installed package declares this name — the base is locked. */
  | { status: 'packaged'; packageId: string }
  /** No package declares it: an ordinary org-owned set, freely editable. */
  | { status: 'org' }
  /** Nothing could answer. The write door refuses; see the module header. */
  | { status: 'unknown'; reason: string };

/**
 * A layered read the caller already holds for the same name, so the classifier
 * can use it as a second artifact source without paying its own round trip.
 *
 * `failed` is deliberately representable: a caller that TRIED to read and was
 * refused must be able to say so, because that is the difference between "no
 * artifact" and "no answer".
 */
export type LayeredProbe =
  | { status: 'read'; envelope: unknown }
  | { status: 'failed'; reason: string };

/** Is this registry/layer item a real shipped artifact for `name`? */
function declaredPackageIdOf(item: any, name: string): string | null {
  if (!item || typeof item !== 'object') return null;
  if (item.name !== name) return null;
  // A projection echo is this plugin's own registry copy of an OVERLAY body —
  // never an artifact. Without this skip, minting an overlay would make the
  // set look packaged on the next pass, which is a lock that latches on the
  // wrong evidence.
  if (item[ENV_PROJECTION_MARKER]) return null;
  const packageId = item._packageId ?? item.packageId;
  if (typeof packageId !== 'string' || packageId === '') return null;
  if (packageId === RUNTIME_SHADOW_PACKAGE_ID) return null;
  return packageId;
}

/**
 * Decide whether `name` is declared by an installed package.
 *
 * Sources are consulted in order of authority; the FIRST positive answer wins,
 * and `unknown` is reported when every source that exists failed to answer.
 *
 *  1. the engine SchemaRegistry (`ql.registry.listItems('permission')`) — the
 *     one source this repo already calls "package-declared". In-memory, so it
 *     cannot truncate;
 *  2. the layered read's `code` layer, for kernels that expose no readable
 *     SchemaRegistry (minimal embeddings; the same fallback
 *     `projectPermissionMutation` already uses). One name, one envelope — no
 *     page and no cap here either.
 */
export function classifyPackagedPermissionSet(
  name: string,
  ql: any,
  layered?: LayeredProbe,
): PackagedSetVerdict {
  if (typeof name !== 'string' || name === '') {
    return { status: 'unknown', reason: 'no permission-set name to resolve provenance for' };
  }

  let anySourceAnswered = false;
  const failures: string[] = [];

  // ── source 1: the engine SchemaRegistry ──────────────────────────────────
  if (typeof ql?.registry?.listItems === 'function') {
    let items: unknown;
    let threw = false;
    try {
      items = ql.registry.listItems('permission');
    } catch (e) {
      threw = true;
      failures.push(`schema registry read failed (${(e as Error)?.message ?? e})`);
    }
    if (!threw) {
      if (Array.isArray(items)) {
        anySourceAnswered = true;
        for (const item of items) {
          const packageId = declaredPackageIdOf(item, name);
          if (packageId) return { status: 'packaged', packageId };
        }
      } else {
        // ⛔ NOT "nothing is declared". `readDeclared` normalizes a missing
        // list to `[]` because its callers are seeders that can safely do
        // nothing; a WRITE DOOR cannot, so the non-list is kept as a failure.
        failures.push('schema registry returned no list of declared permission sets');
      }
    }
  }

  // ── source 2: the layered read's `code` layer ────────────────────────────
  if (layered) {
    if (layered.status === 'failed') {
      failures.push(`layered metadata read failed (${layered.reason})`);
    } else {
      const envelope: any = layered.envelope;
      const isEnvelope = envelope && typeof envelope === 'object'
        && ('effective' in envelope || 'overlay' in envelope || 'code' in envelope);
      if (isEnvelope) {
        anySourceAnswered = true;
        const packageId = declaredPackageIdOf(envelope.code, name);
        if (packageId) return { status: 'packaged', packageId };
      } else {
        failures.push('layered metadata read returned no layer envelope');
      }
    }
  }

  if (anySourceAnswered) return { status: 'org' };
  return {
    status: 'unknown',
    reason: failures.length > 0
      ? failures.join('; ')
      : 'no artifact source available to decide package provenance',
  };
}

/**
 * The refusal a write door throws for a package-declared set.
 *
 * `NOT_OVERRIDABLE` / 403 is deliberately the SAME envelope the metadata
 * protocol's ADR-0005 tier gate already answers with for this exact condition
 * — one condition, one vocabulary (ADR-0112's closed set; the code is a
 * StandardErrorCode, so no ledger entry is minted). What changes is the
 * MESSAGE: the producer's says the type has not opted into overlay writes,
 * which tells an admin nothing they can act on. The ruling's whole point is
 * that the refusal teaches the sanctioned path.
 *
 * ⚠️ The message deliberately does NOT open with `[Security] Access denied`.
 * That prefix is a MATCHER (`isPermissionDeniedError`, `mapDataError`,
 * `rest-server`'s sanitiser all read it as "this is a 403 PERMISSION_DENIED"),
 * and opening with it would re-flatten this refusal's code on the wire —
 * see the note in `errors.ts`.
 *
 * `status` AND `statusCode`: the two transports read different property names
 * (`mapDataError` passes a domain error through on `.status`; the runtime
 * dispatcher's `errorFromThrown` reads `.status` then falls back to
 * `.statusCode`), and this throws on the DATA path, which reaches both.
 */
export class PackagedPermissionSetLockedError extends Error {
  readonly code = 'NOT_OVERRIDABLE';
  readonly status = 403;
  readonly statusCode = 403;
  constructor(name: string, packageId: string, operation: 'insert' | 'update') {
    super(
      `[Security] Permission set '${name}' is declared by package '${packageId}' and is locked in this `
      + `environment — editing it here would silently fork it from the package, and the fork would win over `
      + `every future upgrade with no signal. `
      + (operation === 'insert'
        ? `Choose a different name for your set, or clone '${name}' (the "Clone" action on the permission `
          + `set) and edit the clone.`
        : `Clone it instead (the "Clone" action on the permission set, or POST /api/v1/data/sys_permission_set `
          + `with a new name) and edit the clone — the clone is your organization's own set, and upgrades keep `
          + `flowing to '${name}' untouched.`),
    );
    this.name = 'PackagedPermissionSetLockedError';
  }
}

/** Thrown when provenance could not be determined at all — fail-closed. */
export class PackagedPermissionSetProvenanceUnknownError extends Error {
  readonly code = 'NOT_OVERRIDABLE';
  readonly status = 403;
  readonly statusCode = 403;
  constructor(name: string, reason: string) {
    super(
      `[Security] Permission set '${name}' cannot be saved right now: this environment could not determine `
      + `whether the set is declared by an installed package (${reason}). The save is refused rather than `
      + `accepted, because accepting it would silently fork a packaged set if it turns out to be one. Retry `
      + `once the metadata layer is readable; if you meant to customize a packaged set, clone it instead.`,
    );
    this.name = 'PackagedPermissionSetProvenanceUnknownError';
  }
}

/**
 * The write-door assertion: refuse a save that targets a package-declared set,
 * and refuse a save whose provenance cannot be determined.
 *
 * Returns the verdict on the accept path so a caller can log or branch on it.
 */
export function assertPermissionSetNotPackageDeclared(
  name: string,
  ql: any,
  operation: 'insert' | 'update',
  layered?: LayeredProbe,
): PackagedSetVerdict {
  const verdict = classifyPackagedPermissionSet(name, ql, layered);
  if (verdict.status === 'packaged') {
    throw new PackagedPermissionSetLockedError(name, verdict.packageId, operation);
  }
  if (verdict.status === 'unknown') {
    throw new PackagedPermissionSetProvenanceUnknownError(name, verdict.reason);
  }
  return verdict;
}
