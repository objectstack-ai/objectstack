// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The at-rest re-wrap of version-1 `sys_secret` ciphertext — ADR-0128 §4.2.
 *
 * ADR-0128 D1–D3 made every new seal bind its producer's scope into a
 * delimiter-safe, versioned AAD. A ciphertext sealed before that carries the
 * older binding over `(namespace, key)` alone, and keeps it until it is
 * re-wrapped. This module plans that re-wrap and runs it through the seam §4
 * names, `rotateKey`, which opens a row with the derivation the row records and
 * seals it again under the current one. `os secret rewrap` does the I/O.
 *
 * §4.2 fixes three properties, and each one is a structure here, not a hope:
 *
 *  - **Resumable.** All progress lives in the rows themselves: a row sealed
 *    under the current derivation reads `current` off its own marker and is
 *    skipped as done. There is no run log to lose. A run stopped part-way is
 *    re-run, re-reads the rows, and finishes the rest. Re-running a finished
 *    run writes nothing.
 *  - **Safe against a live deployment.** Each row is written by ONE conditional
 *    update keyed on the row's id AND the exact ciphertext this run read and
 *    re-sealed (`updateMany` with that `where`, which every driver serves as a
 *    single filtered statement and answers with the count it changed). A
 *    producer that changed or removed the row in between leaves the update
 *    matching nothing: the row is reported `write_conflict` and its new value
 *    is never overwritten. A re-run picks it up again.
 *  - **Fails closed.** A row that does not open is not written. Neither is a
 *    row whose re-seal does not open, under the same scope, to the same
 *    plaintext — verified BEFORE the write. Each such row is reported and the
 *    run carries on with the rest, then the command exits non-zero. A row is
 *    written in one statement or not at all.
 *
 * ## Whose scope a row is re-sealed under
 *
 * `rotateKey(handle, ctx)` seals under the CALLER's scope, and `sys_secret`
 * records no producer. A version-1 ciphertext does not bind a scope, so
 * opening it proves nothing about which producer sealed it. The scope
 * therefore comes from the row's HOLDER, through the reachability
 * classification the orphan sweep already makes: the cross-producer reference
 * union (`secret-reference-union.ts`). Each of its references carries the
 * holder's family, so no second holder walk exists here, only a grouping of
 * the union's references by handle. {@link SCOPE_OF_HOLDER_FAMILY} maps each
 * family to its producer's scope.
 *
 * ⛔ Never a guessed scope (ADR-0128 D3). A row is LEFT as it is, and reported
 * by class, when:
 *
 *  - no holder references it (an orphan);
 *  - its holders belong to different producers (a conflicting scope);
 *  - the union is incomplete. A family that could not be enumerated may hold
 *    the row too, so a single visible scope is not proof that there is only
 *    one.
 *
 * Sealing a row under a scope its producer does not open with would make it
 * unreadable to that producer, and would put it in a vocabulary that is not
 * its own. Several holders of ONE scope are one attribution, and the row is
 * re-wrapped once.
 *
 * ## What leaves this module
 *
 * Classes and counts only. ⛔ No plaintext, no ciphertext, no key material, and
 * no row id beside its holder's coordinates. The plaintext a row opens to
 * exists for the length of that row's step, for the verify comparison, and is
 * never returned.
 */

import type { CryptoContext, CryptoContextScope, CryptoHandle } from '@objectstack/spec/contracts';
import type { CiphertextDerivationStatus } from '@objectstack/service-settings';
import {
  SECRET_REFERENCE_FAMILIES,
  type SecretReferenceFamily,
  type SecretReferenceUnion,
} from './secret-reference-union.js';

/**
 * The producer scope each holder family's references are sealed under.
 *
 * A `Record` over the closed family set, so a fourth family cannot join the
 * union without a scope here: the map stops compiling first. The pairing is
 * the producers' own (ADR-0128 D1): `SettingsService` holds in
 * `sys_setting.value_enc` and seals under `settings`, the engine's
 * secret-field path holds a `secret:` ref on the business row and seals under
 * `object_secret_field`, and the datasource binder holds a `sys_secret:`
 * `credentialsRef` and seals under `datasource_credential`.
 */
export const SCOPE_OF_HOLDER_FAMILY: Readonly<Record<SecretReferenceFamily, CryptoContextScope>> =
  Object.freeze({
    settings: 'settings',
    'object-field': 'object_secret_field',
    datasource: 'datasource_credential',
  });

/**
 * Where one `sys_secret` row ended up. Closed, and every row lands in exactly
 * one class.
 *
 *  - `rewrap` — attributed to one producer, opened, re-sealed and verified.
 *    Written under `--apply`, and only reported in a dry run.
 *  - `done` — already sealed under the current derivation. Skipped.
 *  - `left_orphan` · `left_conflicting_scope` · `left_union_incomplete` —
 *    no single producer can be attributed, so the row is left as it is.
 *  - `refused_unreadable` — the row does not open under its producer's
 *    context, or its stored fields do not form a handle. Not written.
 *  - `refused_unknown_derivation` — its marker names a derivation the provider
 *    does not know. Not written.
 *  - `refused_verify_failed` — the re-seal did not open to the same plaintext
 *    under the same scope. Not written.
 *  - `write_conflict` — (`--apply`) the row changed between this run's read
 *    and its write. Not overwritten.
 *  - `write_failed` — (`--apply`) the store refused the write, or answered
 *    something other than a count.
 */
export const REWRAP_CLASSES = [
  'rewrap',
  'done',
  'left_orphan',
  'left_conflicting_scope',
  'left_union_incomplete',
  'refused_unreadable',
  'refused_unknown_derivation',
  'refused_verify_failed',
  'write_conflict',
  'write_failed',
] as const;

export type RewrapClass = (typeof REWRAP_CLASSES)[number];

/** The classes a row is LEFT in: no single producer could be attributed. */
export type RewrapLeftClass = 'left_orphan' | 'left_conflicting_scope' | 'left_union_incomplete';

/**
 * The classes that make a run exit non-zero: a row the run could not finish.
 * `left_*` is not among them. A left row is the answer, not a failure.
 */
export const REWRAP_UNFINISHED_CLASSES: readonly RewrapClass[] = [
  'refused_unreadable',
  'refused_unknown_derivation',
  'refused_verify_failed',
  'write_conflict',
  'write_failed',
];

/** A `sys_secret` row as the driver returned it. Only the re-wrap reads it. */
export interface RewrapSecretRow {
  id: string;
  namespace: string;
  key: string;
  kms_key_id?: unknown;
  alg?: unknown;
  version?: unknown;
  ciphertext?: unknown;
}

/** The provider slice the re-wrap uses: open, re-seal, and nothing else. */
export interface RewrapProviderLike {
  decrypt(handle: CryptoHandle, ctx: CryptoContext): Promise<string>;
  rotateKey(handle: CryptoHandle, ctx: CryptoContext): Promise<CryptoHandle>;
}

/**
 * The single WRITE the re-wrap needs: a conditional update that answers how
 * many rows it changed. Declared apart from the union's read-only driver port
 * so the two cannot be confused. `updateMany` is optional on `IDataDriver`, so
 * {@link asCompareAndSetWriter} checks for it rather than casting.
 */
export interface RewrapWriterLike {
  updateMany(object: string, query: Record<string, unknown>, data: Record<string, unknown>): Promise<unknown>;
}

/** The driver, if it can perform the conditional write. `null` is a refusal. */
export function asCompareAndSetWriter(driver: unknown): RewrapWriterLike | null {
  const candidate = driver as Partial<RewrapWriterLike> | null | undefined;
  return candidate && typeof candidate.updateMany === 'function'
    ? (candidate as RewrapWriterLike)
    : null;
}

/** Per-family passthrough of the union's own outcome. ⛔ Never a boolean. */
export interface RewrapFamilyStatus {
  status: 'enumerated' | 'gap';
  /** Present only on a gap: the union's own words for why. */
  reason?: string;
  referenceCount: number;
}

/** The refusal an `--apply` run carries when the union is incomplete. */
export interface RewrapRefusal {
  gaps: ReadonlyArray<{ family: SecretReferenceFamily; reason: string }>;
  message: string;
}

/** One planned row. `scope` is set exactly when the row is to be attempted. */
export interface RewrapPlanEntry {
  row: RewrapSecretRow;
  /** The attributed producer scope. Present iff the row is to be attempted. */
  scope?: CryptoContextScope;
  /** The class already settled at planning time. Absent iff `scope` is set. */
  settled?: RewrapClass;
}

/** The plan. Holds rows for the executor. ⛔ Never printed or serialised. */
export interface SysSecretRewrapPlan {
  entries: RewrapPlanEntry[];
  families: Record<SecretReferenceFamily, RewrapFamilyStatus>;
  /** `null` when the union is complete. */
  refusal: RewrapRefusal | null;
  /** Rows the executor will open. */
  attempts: number;
}

/**
 * Group the union's references by handle into the set of producer scopes
 * holding each one.
 *
 * This is not a second holder walk. The union walked the holders once, and
 * every reference it returns already names its holder's family. This only
 * groups those references.
 */
export function holderScopesByHandle(
  union: SecretReferenceUnion,
): ReadonlyMap<string, ReadonlySet<CryptoContextScope>> {
  const byHandle = new Map<string, Set<CryptoContextScope>>();
  for (const ref of union.references) {
    const scope = SCOPE_OF_HOLDER_FAMILY[ref.family];
    const set = byHandle.get(ref.handleId);
    if (set) set.add(scope);
    else byHandle.set(ref.handleId, new Set([scope]));
  }
  return byHandle;
}

/**
 * The producer scope a row is re-sealed under, or the reason it is left.
 *
 * ⛔ Never a guess (ADR-0128 D3). The order matters:
 *
 *  1. Holders of more than one scope are a conflict however complete the
 *     union is. A missing family could add a holder, never remove one.
 *  2. An incomplete union cannot prove a single visible scope is the only
 *     one, and it cannot tell an orphan from a row the missing family holds.
 *  3. A row no holder references has no producer to attribute.
 */
export function attributeRewrapScope(
  scopes: ReadonlySet<CryptoContextScope> | undefined,
  unionComplete: boolean,
): { scope: CryptoContextScope } | { left: RewrapLeftClass } {
  if (scopes && scopes.size > 1) return { left: 'left_conflicting_scope' };
  if (!unionComplete) return { left: 'left_union_incomplete' };
  if (!scopes || scopes.size === 0) return { left: 'left_orphan' };
  const [scope] = scopes;
  return { scope };
}

/**
 * Plan a re-wrap. Pure: nothing here opens, writes or reads a store.
 *
 * @param input.secrets every `sys_secret` row, read unscoped.
 * @param input.union the cross-producer reference union.
 * @param input.derivationOf the provider's own marker reading
 *   (`ciphertextDerivationStatus`), injected rather than restated.
 */
export function planSysSecretRewrap(input: {
  secrets: readonly RewrapSecretRow[];
  union: SecretReferenceUnion;
  derivationOf: (ciphertext: unknown) => CiphertextDerivationStatus;
}): SysSecretRewrapPlan {
  const { union, derivationOf } = input;
  const scopesOf = holderScopesByHandle(union);
  const entries: RewrapPlanEntry[] = [];
  let attempts = 0;

  for (const row of input.secrets ?? []) {
    // The derivation first: a row sealed under the current one is done
    // whoever holds it, and an unknown one is refused whoever holds it.
    const derivation = derivationOf(row.ciphertext);
    if (derivation === 'current') { entries.push({ row, settled: 'done' }); continue; }
    if (derivation === 'unknown') { entries.push({ row, settled: 'refused_unknown_derivation' }); continue; }

    const attribution = attributeRewrapScope(scopesOf.get(row.id), union.complete);
    if ('left' in attribution) { entries.push({ row, settled: attribution.left }); continue; }
    entries.push({ row, scope: attribution.scope });
    attempts += 1;
  }

  const families = {} as Record<SecretReferenceFamily, RewrapFamilyStatus>;
  for (const family of SECRET_REFERENCE_FAMILIES) {
    const result = union.families[family];
    families[family] = {
      status: result.status,
      ...(result.status === 'gap' ? { reason: result.reason } : {}),
      referenceCount: result.references.length,
    };
  }

  const refusal: RewrapRefusal | null = union.complete
    ? null
    : {
      gaps: union.gaps,
      message:
        `Refusing to re-wrap: ${union.gaps.length} of ${SECRET_REFERENCE_FAMILIES.length} holder families `
        + `could not be enumerated (${union.gaps.map((g) => g.family).join(', ')}). A row's producer `
        + 'scope comes from its holders, and a family that was not read may hold the row too, so no '
        + 'row can be attributed until every family is. Close the gap and re-run.',
    };

  return { entries, families, refusal, attempts };
}

/** A stored `version` as a handle needs it, or `null` when it is not one. */
function handleVersionOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^[0-9]{1,15}$/.test(value)) return Number(value);
  return null;
}

/** The handle a stored row describes, or `null` when its fields cannot form one. */
function handleOf(row: RewrapSecretRow): CryptoHandle | null {
  const version = handleVersionOf(row.version);
  if (typeof row.ciphertext !== 'string' || row.ciphertext === '' || version === null) return null;
  return {
    id: row.id,
    kmsKeyId: typeof row.kms_key_id === 'string' ? row.kms_key_id : '',
    alg: typeof row.alg === 'string' ? row.alg : '',
    version,
    ciphertext: row.ciphertext,
  };
}

/**
 * Does the re-seal hold the same value, for the same producer, at the same
 * handle? Checked before anything is written.
 *
 * It must keep the id, record the current derivation, carry a usable version,
 * and open under the SAME context to the SAME plaintext. A re-seal that fails
 * any of these would replace a readable row with one its producer cannot use.
 */
async function resealHolds(input: {
  provider: RewrapProviderLike;
  derivationOf: (ciphertext: unknown) => CiphertextDerivationStatus;
  row: RewrapSecretRow;
  next: CryptoHandle;
  ctx: CryptoContext;
  plain: string;
}): Promise<boolean> {
  const { provider, derivationOf, row, next, ctx, plain } = input;
  if (!next || next.id !== row.id) return false;
  if (derivationOf(next.ciphertext) !== 'current') return false;
  if (handleVersionOf(next.version) === null) return false;
  try {
    return (await provider.decrypt(next, ctx)) === plain;
  } catch {
    return false;
  }
}

/** The outcome of a run. Classes and counts only. */
export interface SysSecretRewrapResult {
  /** One count per member of {@link REWRAP_CLASSES}. */
  byClass: Record<RewrapClass, number>;
  /** `rewrap` broken down by the producer scope each row was sealed under. */
  rewrapByScope: Record<CryptoContextScope, number>;
  total: number;
}

/**
 * Run a plan: open each attempted row under its attributed scope, re-seal it
 * through `rotateKey`, verify the re-seal, and, when a writer is given, write
 * it with one conditional update.
 *
 * `writer: null` is the dry run. Every row is still opened, re-sealed and
 * verified in memory, so `refused_*` reads the same as it would under
 * `--apply`, and nothing is written.
 */
export async function executeSysSecretRewrap(input: {
  plan: SysSecretRewrapPlan;
  /** Required whenever `plan.attempts > 0`. */
  provider: RewrapProviderLike | null;
  derivationOf: (ciphertext: unknown) => CiphertextDerivationStatus;
  writer: RewrapWriterLike | null;
  now?: () => Date;
}): Promise<SysSecretRewrapResult> {
  const { plan, provider, derivationOf, writer } = input;
  const now = input.now ?? (() => new Date());
  const byClass = Object.fromEntries(REWRAP_CLASSES.map((c) => [c, 0])) as Record<RewrapClass, number>;
  const rewrapByScope = { settings: 0, object_secret_field: 0, datasource_credential: 0 } as Record<
    CryptoContextScope,
    number
  >;
  if (plan.attempts > 0 && !provider) {
    throw new Error('executeSysSecretRewrap: the plan attempts rows, and no provider was given to open them.');
  }

  for (const entry of plan.entries) {
    if (entry.settled !== undefined || entry.scope === undefined) {
      byClass[entry.settled ?? 'refused_unreadable'] += 1;
      continue;
    }
    const outcome = await rewrapOne({
      row: entry.row,
      scope: entry.scope,
      provider: provider!,
      derivationOf,
      writer,
      now,
    });
    byClass[outcome] += 1;
    if (outcome === 'rewrap') rewrapByScope[entry.scope] += 1;
  }

  return { byClass, rewrapByScope, total: plan.entries.length };
}

/** One row, start to finish. Every exit is a class. Nothing escapes but the class. */
async function rewrapOne(input: {
  row: RewrapSecretRow;
  scope: CryptoContextScope;
  provider: RewrapProviderLike;
  derivationOf: (ciphertext: unknown) => CiphertextDerivationStatus;
  writer: RewrapWriterLike | null;
  now: () => Date;
}): Promise<RewrapClass> {
  const { row, scope, provider, derivationOf, writer, now } = input;
  const handle = handleOf(row);
  if (!handle) return 'refused_unreadable';
  // The row's own coordinate, the one every producer opens it with.
  const ctx: CryptoContext = { scope, namespace: row.namespace, key: row.key };

  let plain: string;
  let next: CryptoHandle;
  try {
    plain = await provider.decrypt(handle, ctx);
    next = await provider.rotateKey(handle, ctx);
  } catch {
    return 'refused_unreadable';
  }

  // Verify BEFORE the write: the re-seal must open, under the same scope, to
  // the same plaintext. Otherwise the row stays exactly as it is.
  if (!(await resealHolds({ provider, derivationOf, row, next, ctx, plain }))) {
    return 'refused_verify_failed';
  }

  if (!writer) return 'rewrap';

  // One statement, conditional on the ciphertext this run read and re-sealed.
  // A row a producer changed or removed since matches nothing, and is never
  // overwritten.
  let changed: unknown;
  try {
    changed = await writer.updateMany(
      'sys_secret',
      { where: { id: row.id, ciphertext: handle.ciphertext } },
      {
        ciphertext: next.ciphertext,
        version: next.version,
        kms_key_id: next.kmsKeyId,
        alg: next.alg,
        rotated_at: now().toISOString(),
      },
    );
  } catch {
    return 'write_failed';
  }
  if (changed === 0) return 'write_conflict';
  if (typeof changed !== 'number' || !Number.isFinite(changed) || changed < 0) return 'write_failed';
  return 'rewrap';
}

/** True when the result holds a row the run could not finish. */
export function rewrapUnfinished(result: SysSecretRewrapResult): boolean {
  return REWRAP_UNFINISHED_CLASSES.some((c) => result.byClass[c] > 0);
}

/** The report a run prints or serialises. Classes and counts only. */
export interface SysSecretRewrapReport {
  mode: 'dry-run' | 'apply';
  /** Where the data key came from (a source name, never a value), or `null` when no row was opened. */
  keySource: string | null;
  families: Record<SecretReferenceFamily, RewrapFamilyStatus>;
  refusal: RewrapRefusal | null;
  counts: {
    total: number;
    rewrap: number;
    done: number;
    left: number;
    refused: number;
    notWritten: number;
  };
  byClass: Record<RewrapClass, number>;
  rewrapByScope: Record<CryptoContextScope, number>;
  notes: string[];
}

/** Operator notes, kept as data so the wording is pinned rather than left to a rendering site. */
export const REWRAP_NOTES = {
  left:
    'A row is LEFT as it is when no holder references it, when its holders belong to different '
    + 'producers, or when a holder family could not be read. Its producer cannot be attributed, and '
    + 'it is never re-sealed under a guessed scope. It keeps the older binding over (namespace, key) alone.',
  resumable:
    'Re-running is safe. A row already sealed under the current derivation is skipped as done, so a '
    + 'run that stopped part-way finishes the rest, and a finished run writes nothing.',
  dryRun:
    'Dry run: every attributed row was opened, re-sealed and verified in memory, and nothing was '
    + 'written. Re-run with --apply to write.',
  unfinished:
    'Some rows were not re-wrapped (see the refused and not-written counts). Each was left exactly as '
    + 'it was. A row that changed during the run is picked up by a re-run.',
} as const;

/** Assemble the report. */
export function buildRewrapReport(input: {
  mode: 'dry-run' | 'apply';
  plan: SysSecretRewrapPlan;
  result: SysSecretRewrapResult;
  keySource: string | null;
}): SysSecretRewrapReport {
  const { mode, plan, result, keySource } = input;
  const c = result.byClass;
  const notes: string[] = [REWRAP_NOTES.left, REWRAP_NOTES.resumable];
  if (mode === 'dry-run') notes.push(REWRAP_NOTES.dryRun);
  if (rewrapUnfinished(result)) notes.push(REWRAP_NOTES.unfinished);
  return {
    mode,
    keySource,
    families: plan.families,
    refusal: plan.refusal,
    counts: {
      total: result.total,
      rewrap: c.rewrap,
      done: c.done,
      left: c.left_orphan + c.left_conflicting_scope + c.left_union_incomplete,
      refused: c.refused_unreadable + c.refused_unknown_derivation + c.refused_verify_failed,
      notWritten: c.write_conflict + c.write_failed,
    },
    byClass: { ...c },
    rewrapByScope: { ...result.rewrapByScope },
    notes,
  };
}
