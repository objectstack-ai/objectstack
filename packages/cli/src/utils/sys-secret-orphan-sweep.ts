// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8103 — the deletion half: planning a `sys_secret` orphan sweep over the
 * COMPLETE cross-producer reference union.
 *
 * Pure. Nothing here reads a database, writes one, or decrypts anything; the
 * command (`os secret orphans`) does the I/O and hands the readings in. That
 * split is what makes the safety property testable: every refusal below is a
 * value returned by a function, not a branch that only exists inside a
 * command.
 *
 * ## The predicate, and why it is not the shipped one
 *
 * The maintainer ruling (2026-08-27, option B') states the deletion predicate
 * exactly: **attributable AND unreferenced by the COMPLETE union**. Both
 * conjuncts are load-bearing and neither is the shipped classifier's:
 *
 *  - `classifySysSecretRows` (`@objectstack/service-settings`) answers
 *    "unreferenced by `sys_setting`", because that is all its package can see.
 *    Under that predicate a LIVE, engine-owned credential lands in the
 *    `orphaned` bucket — measured against the real producers, not argued, in
 *    `secret-reference-union.test.ts` and again in this module's own test.
 *    ⛔ That bucket is therefore NOT a deletion list, and this module never
 *    treats it as one: the reference side comes from
 *    {@link SecretReferenceUnion} over all three producer families.
 *  - Attribution stays exactly as narrow as it is: `(namespace, key)`
 *    membership in the registered manifests' encrypted specifiers. It is a
 *    NAME MATCH, not proof of ownership, so it can only ever be used to
 *    SHRINK the deletable set — never to grow it. A row nothing attributes is
 *    `unattributable` and the ruling puts it permanently out of reach.
 *
 * ## What an incomplete union does here
 *
 * It empties the deletable set, and it says which family is missing. The union
 * models three independent gap sources (the host did not declare; the engine
 * exposes no accessor; neither reaches), and ⛔ this module does not flatten
 * them into a boolean: {@link SysSecretSweepPlan.families} carries every
 * family's own status and reason through to the operator and to `--json`, and
 * a withheld row names `union_incomplete` as its own withhold class rather
 * than being lumped in with the rest.
 *
 * "The read did not happen" and "there are no references" are different facts.
 * Only the second is safe to delete on, and the audit trail cannot tell them
 * apart afterwards: it records content digests, never handles (re-measured
 * 2026-08-28 — `LocalCryptoProvider.digest()` is `sha256:` + sha256(plain),
 * and the only values reaching the audit payload are that digest or `null`),
 * so a row deleted in error can never be NAMED again, let alone recovered.
 * That single fact is why the export is mandatory rather than advisory.
 *
 * ## The two look-alike classes, both withheld rather than warned about
 *
 *  - **Legacy inline crypto, in the opposite direction from #8063's reaper.**
 *    The pre-Phase-3 path stores the ciphertext ITSELF in
 *    `sys_setting.value_enc`. Such a value names no handle, so it contributes
 *    nothing to the union — and a `sys_secret` row sharing its
 *    `(namespace, key)` therefore looks unreferenced by construction. The
 *    shipped report flags that pair `legacyInlineSibling` and tells an
 *    operator to look. A DELETING command cannot delegate to an operator's
 *    attention: here the class is {@link WITHHELD_LEGACY_INLINE_SIBLING},
 *    excluded from the deletable set and reported.
 *  - **A re-wrap is not a retirement.** `rotateKey()` re-wraps in place and
 *    keeps `id` stable (re-measured 2026-08-28: `local-crypto-provider.ts`
 *    returns `id: handle.id` with `version + 1`), so a re-wrapped row is the
 *    row still in force. `version` and `rotated_at` are therefore REPORTED and
 *    ⛔ never verdict inputs — a classifier reading "version > 1" as "was
 *    rotated, therefore retired" deletes the value in force.
 *
 * ## What this sweep does NOT do, stated because the opposite reads better
 *
 * ⛔ It does not "clean up leaked old credentials". Measured on the pre-fix
 * rotation path, the framing is inverted: the handle was never repointed, so
 * the value STILL IN FORCE is the OLDEST one — the credential the
 * administrator believed they had replaced — while each orphan holds a value
 * the administrator INTENDED to set and which never took effect. Deleting the
 * orphans therefore removes nothing that is exposed; the exposed credential is
 * the referenced one and it stays. And if the administrator also rotated at
 * the provider, the newest orphan may be a credential that is CURRENTLY VALID
 * there. {@link SWEEP_EXPOSURE_NOTES} is that paragraph in the form the
 * command prints, so the operator-facing wording is pinned by test rather than
 * left to a rendering site.
 */

import type {
  EncryptedSpecifierRef,
  SecretRowSnapshot,
  SettingRowSnapshot,
} from '@objectstack/service-settings';
import type {
  SecretReferenceFamily,
  SecretReferenceUnion,
} from './secret-reference-union.js';

export type { EncryptedSpecifierRef, SecretRowSnapshot, SettingRowSnapshot };

/**
 * Why a row that is not referenced is still not deletable.
 *
 * Separate constants rather than free strings so each class is countable and
 * each is pinned by its own test. Every one of them is a REFUSAL: the sweep
 * only ever removes rows from the deletable set, it never adds one.
 */
export const WITHHELD_UNION_INCOMPLETE = 'union_incomplete';
/** The class the ruling puts permanently out of reach. */
export const WITHHELD_UNATTRIBUTABLE = 'unattributable';
/** The legacy inline-crypto guard, in the opposite direction from #8063's. */
export const WITHHELD_LEGACY_INLINE_SIBLING = 'legacy_inline_sibling';

/** The closed set of withhold classes. */
export const WITHHOLD_CLASSES = [
  WITHHELD_UNION_INCOMPLETE,
  WITHHELD_UNATTRIBUTABLE,
  WITHHELD_LEGACY_INLINE_SIBLING,
] as const;

export type WithholdClass = (typeof WITHHOLD_CLASSES)[number];

/** What the sweep decided about one `sys_secret` row. */
export type SweepDecision = 'referenced' | 'deletable' | 'withheld';

/**
 * One `sys_secret` row, as the sweep reports it.
 *
 * ⛔ No `ciphertext` member, the same discipline as the shipped report's
 * `SecretRowSnapshot`: this shape is printed and serialised to `--json`, and
 * cipher material must not be reachable from a surface that is expected to be
 * safe to show. The pre-delete export is the one place cipher material travels
 * (see {@link buildPreDeleteExport}), and it is a separate type for that
 * reason.
 */
export interface SweptSecretRow {
  id: string;
  namespace: string;
  key: string;
  decision: SweepDecision;
  /** Set only when `decision === 'withheld'`. */
  withheld?: WithholdClass;
  /** Justification, safe to print. */
  reason: string;
  /**
   * Holder coordinates naming this handle, from the union — e.g.
   * `object-field: smtp.password#rec_7`. Empty when nothing names it. This is
   * the evidence the digest-only audit trail can never reconstruct after a
   * delete, so it travels into the export too.
   */
  holders: string[];
  /** Re-wrap evidence. Reported only — ⛔ never a verdict input. */
  rewrapped?: boolean;
  /** Its `(namespace, key)` currently resolves through a legacy inline value. */
  legacyInlineSibling?: boolean;
  /** `(namespace, key)` matches a declared encrypted settings specifier. */
  attributable: boolean;
  version?: number | null;
  kms_key_id?: string | null;
  created_at?: string | null;
  rotated_at?: string | null;
}

/** Per-family passthrough of the union's own outcome. ⛔ Never a boolean. */
export interface SweepFamilyStatus {
  family: SecretReferenceFamily;
  status: 'enumerated' | 'gap';
  /** Present only on a gap — the union's own words for why. */
  reason?: string;
  /** References this family contributed (real even on a gap). */
  referenceCount: number;
}

/** The refusal a plan carries when the union could not be completed. */
export interface SweepRefusal {
  /** ADR-0112 pair, mirroring `IncompleteSecretReferenceUnionError`. */
  code: 'PRECONDITION_REQUIRED';
  status: 428;
  /** Which families could not be enumerated, and why. */
  gaps: ReadonlyArray<{ family: SecretReferenceFamily; reason: string }>;
  message: string;
}

/** The plan. Counts, row ids and holder coordinates — never cipher material. */
export interface SysSecretSweepPlan {
  /**
   * `null` when every family enumerated. Otherwise the reason deletion is
   * refused, naming the families — and {@link SysSecretSweepPlan.deletable} is
   * then guaranteed empty.
   */
  refusal: SweepRefusal | null;
  counts: {
    total: number;
    referenced: number;
    deletable: number;
    withheld: number;
  };
  /** Withheld rows by class. Keys are the closed {@link WITHHOLD_CLASSES}. */
  withheldByClass: Record<WithholdClass, number>;
  rows: SweptSecretRow[];
  /** The ids `--delete` would remove. Empty whenever `refusal` is set. */
  deletable: string[];
  families: Record<SecretReferenceFamily, SweepFamilyStatus>;
  /**
   * `sys_setting` rows still on the legacy inline path. They reference no
   * `sys_secret` row at all; rows sharing their `(namespace, key)` are
   * withheld.
   */
  legacyInlineRows: Array<{
    namespace: string;
    key: string;
    scope?: string | null;
    user_id?: string | null;
  }>;
  /** What an operator must read before acting. Never claims a cleanup. */
  notes: string[];
}

/**
 * The composite `(namespace, key)` map key.
 *
 * NUL separator, written as the ESCAPE and never as a raw byte
 * (`scripts/check-nul-bytes.mjs`) — byte-identical at run time. Same choice
 * and same reason as the shipped classifier: neither a namespace nor a key can
 * contain one, so no two distinct pairs alias into a single composite, and an
 * aliased pair here would silently change a row's DECISION.
 */
const refKey = (namespace: string, key: string) => `${namespace}\u0000${key}`;

/**
 * The operator-facing exposure paragraph, as measured.
 *
 * Kept as data, and asserted by test, because the tempting sentence — "this
 * cleans up leaked old credentials" — is false in this population and would be
 * the single most damaging thing this command could tell an operator.
 */
export const SWEEP_EXPOSURE_NOTES: readonly string[] = [
  'These rows are NOT "old credentials that were replaced". On the pre-fix rotation path the '
    + 'handle was never repointed, so the value STILL IN FORCE is the OLDEST one — the credential '
    + 'the administrator believed they had replaced — while each orphan holds a value the '
    + 'administrator INTENDED to set and which never took effect.',
  'Deleting these rows therefore retires NOTHING that is exposed. The exposed credential is the '
    + 'referenced one, and this command never touches a referenced row.',
  'If the administrator also rotated at the provider, the newest orphan may be a credential that '
    + 'is CURRENTLY VALID there. Read the export before deleting.',
  'The audit trail records content digests, never handles, so a row deleted in error cannot be '
    + 'named afterwards. The pre-delete export is the only record that survives the delete.',
];

/**
 * Is this `sys_setting.value_enc` a handle rather than inline ciphertext?
 *
 * The producer's own published predicate is injected by
 * {@link useHandlePredicate} rather than restated here — a restated `sec_`
 * prefix is a second de-facto contract that drifts, and the failure it
 * produces is a legacy inline row silently counted as a reference. The
 * fallback keeps this module usable in isolation; every shipping path installs
 * the real one, and the test pins that the two agree on a handle minted by the
 * real `LocalCryptoProvider`.
 */
let isHandleShaped: (value: unknown) => boolean = (value) =>
  typeof value === 'string' && value.startsWith('sec_');

/** Install the producer's own handle predicate (`isSecretHandle`). */
export function useHandlePredicate(predicate: (value: unknown) => boolean): void {
  isHandleShaped = predicate;
}

/**
 * Plan a sweep.
 *
 * @param input.secrets  every `sys_secret` row, read unscoped.
 * @param input.union    the cross-producer reference union.
 * @param input.attributableTo `(namespace, key)` pairs the REGISTERED settings
 *   manifests declare encrypted (`collectEncryptedSpecifierRefs`). An empty set
 *   is legal and yields zero deletable rows — the safe direction.
 * @param input.settingRows `sys_setting` rows, for the legacy inline guard.
 */
export function planSysSecretOrphanSweep(input: {
  secrets: readonly SecretRowSnapshot[];
  union: SecretReferenceUnion;
  attributableTo: readonly EncryptedSpecifierRef[];
  settingRows: readonly SettingRowSnapshot[];
}): SysSecretSweepPlan {
  const secrets = input.secrets ?? [];
  const union = input.union;
  const attributable = new Set(
    (input.attributableTo ?? []).map((r) => refKey(r.namespace, r.key)),
  );

  // The legacy inline guard, computed the same way the shipped report computes
  // it and for the same reason: a `value_enc` that is not a handle references
  // no `sys_secret` row, so a row sharing its pair looks unreferenced BECAUSE
  // of the legacy value rather than in spite of it.
  const legacyInlineRows: SysSecretSweepPlan['legacyInlineRows'] = [];
  const legacyInlinePairs = new Set<string>();
  for (const row of input.settingRows ?? []) {
    const enc = row?.value_enc;
    if (typeof enc !== 'string' || enc === '') continue;
    if (isHandleShaped(enc)) continue;
    legacyInlineRows.push({
      namespace: row.namespace,
      key: row.key,
      scope: row.scope ?? null,
      user_id: row.user_id ?? null,
    });
    legacyInlinePairs.add(refKey(row.namespace, row.key));
  }

  const holdersById = new Map<string, string[]>();
  for (const ref of union.references) {
    const entry = `${ref.family}: ${ref.holder}`;
    const list = holdersById.get(ref.handleId);
    if (list) list.push(entry);
    else holdersById.set(ref.handleId, [entry]);
  }

  const refusal: SweepRefusal | null = union.complete
    ? null
    : {
      code: 'PRECONDITION_REQUIRED',
      status: 428,
      gaps: union.gaps,
      message:
        `Refusing to delete: ${union.gaps.length} of 3 sys_secret producer families could not be `
        + `enumerated (${union.gaps.map((g) => g.family).join(', ')}). A handle absent from an `
        + 'INCOMPLETE union is not thereby unreferenced — the missing family may hold it — and '
        + 'the audit trail records digests rather than handles, so an erroneous delete cannot be '
        + 'named afterwards. Close the gap and re-run.',
    };

  const rows: SweptSecretRow[] = [];
  const withheldByClass: Record<WithholdClass, number> = {
    [WITHHELD_UNION_INCOMPLETE]: 0,
    [WITHHELD_UNATTRIBUTABLE]: 0,
    [WITHHELD_LEGACY_INLINE_SIBLING]: 0,
  };
  let referenced = 0;
  const deletable: string[] = [];

  for (const secret of secrets) {
    // Reported, never a verdict input — a re-wrap keeps the handle stable.
    const rewrapped =
      (typeof secret.version === 'number' && secret.version > 1)
      || (typeof secret.rotated_at === 'string' && secret.rotated_at !== '');
    const legacyInlineSibling = legacyInlinePairs.has(refKey(secret.namespace, secret.key));
    const isAttributable = attributable.has(refKey(secret.namespace, secret.key));
    const holders = holdersById.get(secret.id) ?? [];

    const common = {
      id: secret.id,
      namespace: secret.namespace,
      key: secret.key,
      holders,
      attributable: isAttributable,
      version: secret.version ?? null,
      kms_key_id: secret.kms_key_id ?? null,
      created_at: secret.created_at ?? null,
      rotated_at: secret.rotated_at ?? null,
      ...(rewrapped ? { rewrapped: true } : {}),
      ...(legacyInlineSibling ? { legacyInlineSibling: true } : {}),
    };

    // 1. Referenced by ANY family — including a family that gapped partway,
    //    because the references it did gather are real. A handle a partial
    //    read already proved LIVE is live whatever happens to the rest.
    if (union.handleIds.has(secret.id)) {
      rows.push({
        ...common,
        decision: 'referenced',
        reason: rewrapped
          ? `named by ${holders.length} live holder(s); re-wrapped in place (handle stable) — a `
            + 're-wrap is not a retirement'
          : `named by ${holders.length} live holder(s)`,
      });
      referenced += 1;
      continue;
    }

    // 2. The union is not complete ⇒ "absent" means nothing. This is the
    //    falsifiable criterion: the refusal is a per-row class, and the plan
    //    names which family is missing.
    if (refusal) {
      rows.push({
        ...common,
        decision: 'withheld',
        withheld: WITHHELD_UNION_INCOMPLETE,
        reason:
          'no ENUMERATED family names this handle, but the union is incomplete '
          + `(${refusal.gaps.map((g) => g.family).join(', ')} could not be enumerated), so `
          + '"absent" does not mean "unreferenced"',
      });
      withheldByClass[WITHHELD_UNION_INCOMPLETE] += 1;
      continue;
    }

    // 3. Never deletable by the ruling: nothing attributes it to settings, so
    //    the sweep cannot claim ownership of it even with a complete union.
    if (!isAttributable) {
      rows.push({
        ...common,
        decision: 'withheld',
        withheld: WITHHELD_UNATTRIBUTABLE,
        reason:
          'no family names this handle, and its (namespace, key) matches no declared encrypted '
          + 'settings specifier — nothing attributes it to a producer this sweep speaks for. '
          + 'Never deletable.',
      });
      withheldByClass[WITHHELD_UNATTRIBUTABLE] += 1;
      continue;
    }

    // 4. The legacy inline guard, in the opposite direction from #8063's
    //    reaper: this pair currently resolves through an inline ciphertext,
    //    which names no handle — so the row's absence from the union is
    //    explained by the legacy value rather than by retirement.
    if (legacyInlineSibling) {
      rows.push({
        ...common,
        decision: 'withheld',
        withheld: WITHHELD_LEGACY_INLINE_SIBLING,
        reason:
          'attributable and unreferenced, but its (namespace, key) currently resolves through a '
          + 'LEGACY INLINE sys_setting value, which names no handle — the absence is explained by '
          + 'the legacy value, not by retirement. Migrate that setting off the inline path first.',
      });
      withheldByClass[WITHHELD_LEGACY_INLINE_SIBLING] += 1;
      continue;
    }

    rows.push({
      ...common,
      decision: 'deletable',
      reason:
        'attributable to a declared encrypted settings specifier AND named by no family of the '
        + 'COMPLETE reference union',
    });
    deletable.push(secret.id);
  }

  const families = {} as Record<SecretReferenceFamily, SweepFamilyStatus>;
  for (const [family, result] of Object.entries(union.families) as Array<
    [SecretReferenceFamily, SecretReferenceUnion['families'][SecretReferenceFamily]]
  >) {
    families[family] = {
      family,
      status: result.status,
      ...(result.status === 'gap' ? { reason: result.reason } : {}),
      referenceCount: result.references.length,
    };
  }

  const notes = [...SWEEP_EXPOSURE_NOTES];
  if (attributable.size === 0) {
    notes.push(
      'No encrypted specifiers were supplied, so nothing is attributable to the settings producer '
        + 'and nothing is deletable. Boot with the settings service registered so its manifests '
        + 'are readable.',
    );
  }
  if (legacyInlineRows.length > 0) {
    notes.push(
      `${legacyInlineRows.length} sys_setting row(s) still hold inline ciphertext rather than a `
        + 'handle. They reference no sys_secret row; rows sharing their (namespace, key) are '
        + 'withheld rather than deleted.',
    );
  }
  notes.push(
    'Attribution is by (namespace, key), which is a NAME MATCH and not proof of ownership — '
      + 'sys_secret carries no producer column. It is used here only to SHRINK the deletable set; '
      + 'a row nothing attributes is never deleted.',
  );

  return {
    refusal,
    counts: {
      total: rows.length,
      referenced,
      deletable: deletable.length,
      withheld:
        withheldByClass[WITHHELD_UNION_INCOMPLETE]
        + withheldByClass[WITHHELD_UNATTRIBUTABLE]
        + withheldByClass[WITHHELD_LEGACY_INLINE_SIBLING],
    },
    withheldByClass,
    rows,
    deletable,
    families,
    legacyInlineRows,
    notes,
  };
}

/**
 * A `sys_secret` row as the EXPORT carries it — cipher material included.
 *
 * The one shape in this feature that holds `ciphertext`, and it is separate
 * from {@link SweptSecretRow} for exactly that reason: the report type cannot
 * accidentally acquire cipher material, and this type cannot accidentally be
 * printed in place of the report.
 *
 * It carries the cipher material because the export's job is RESTORATION, not
 * merely naming. The audit trail records digests rather than handles, so after
 * an erroneous delete nothing in the database can say which row existed; an
 * export that named the row without its ciphertext would make the mistake
 * describable and still permanent. Every column `sys_secret` declares is
 * carried, so a row can be re-inserted as it stood.
 */
export interface ExportedSecretRow {
  id: string;
  namespace: string;
  key: string;
  kms_key_id?: string | null;
  alg?: string | null;
  version?: number | null;
  ciphertext?: string | null;
  created_at?: string | null;
  rotated_at?: string | null;
}

/** The pre-delete export document. */
export interface PreDeleteExport {
  /** Format marker, so a restorer can refuse a document it does not know. */
  format: 'objectstack.sys_secret.pre-delete-export.v1';
  generatedAt: string;
  /** The command that produced it, for the operator reading it months later. */
  producedBy: string;
  /**
   * ⛔ Reads as a warning, not a footnote: this file holds the cipher material
   * of the rows that were deleted. It is a backup of part of the secrets table
   * and must be handled as one.
   */
  warning: string;
  /** Per-family status of the union the decision was made on. */
  families: Record<SecretReferenceFamily, SweepFamilyStatus>;
  /** The rows about to be deleted, with the cipher material. */
  rows: ExportedSecretRow[];
  /**
   * Why each id was judged deletable, and the holder evidence at the time —
   * the reasoning the digest-only audit trail cannot reconstruct.
   */
  decisions: Array<{ id: string; reason: string; holders: string[] }>;
}

/** How to put a row back. Written into the export so the file is self-describing. */
export const EXPORT_RESTORE_HINT =
  'To restore a row, re-insert it into `sys_secret` with every column below verbatim — the id '
  + 'included, since the id IS the handle every holder column names. Restoring the row does not '
  + 'restore any reference to it.';

/**
 * Build the export document for the rows a `--delete` run is about to remove.
 *
 * Pure, and deliberately driven by the PLAN's deletable list rather than by a
 * caller-supplied id set: the export and the delete then cannot disagree about
 * which rows are in scope. A deletable id with no raw row available is a hard
 * error rather than a silently shorter export — a delete whose export is
 * missing a row is precisely the un-nameable outcome the export exists to
 * prevent.
 */
export function buildPreDeleteExport(input: {
  plan: SysSecretSweepPlan;
  /** The raw `sys_secret` rows, keyed by id, as read from the driver. */
  rawById: ReadonlyMap<string, Record<string, unknown>>;
  producedBy: string;
  now?: () => Date;
}): PreDeleteExport {
  const { plan, rawById } = input;
  const rows: ExportedSecretRow[] = [];
  const decisions: PreDeleteExport['decisions'] = [];

  for (const id of plan.deletable) {
    const raw = rawById.get(id);
    if (!raw) {
      throw new Error(
        `Cannot build the pre-delete export: no raw sys_secret row was read for '${id}', which the `
        + 'plan lists as deletable. Refusing to delete a row the export cannot record — the audit '
        + 'trail holds digests rather than handles, so it could never be named afterwards.',
      );
    }
    const swept = plan.rows.find((r) => r.id === id);
    rows.push({
      id: String(raw.id),
      namespace: String(raw.namespace),
      key: String(raw.key),
      kms_key_id: (raw.kms_key_id as string | null | undefined) ?? null,
      alg: (raw.alg as string | null | undefined) ?? null,
      version: (raw.version as number | null | undefined) ?? null,
      ciphertext: (raw.ciphertext as string | null | undefined) ?? null,
      created_at: (raw.created_at as string | null | undefined) ?? null,
      rotated_at: (raw.rotated_at as string | null | undefined) ?? null,
    });
    decisions.push({
      id,
      reason: swept?.reason ?? 'deletable',
      holders: swept?.holders ?? [],
    });
  }

  return {
    format: 'objectstack.sys_secret.pre-delete-export.v1',
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    producedBy: input.producedBy,
    warning:
      'This file contains the CIPHER MATERIAL of the sys_secret rows that were deleted. It is a '
      + 'partial backup of the secrets table: protect it exactly as you protect a database backup, '
      + 'and delete it only once you are certain the sweep was correct. '
      + EXPORT_RESTORE_HINT,
    families: plan.families,
    rows,
    decisions,
  };
}
