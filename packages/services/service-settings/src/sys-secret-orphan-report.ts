// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8103 — **report-only** classification of `sys_secret` rows against the
 * settings subsystem's references. Read-only by construction: nothing here
 * writes, deletes, or decrypts.
 *
 * ## Why a report and not a sweep
 *
 * #8030 / PR #8063 made a settings rotation reap the ciphertext it retired,
 * but the reaping is **forward-only** — it fires on the write that repoints a
 * handle. Rows orphaned by rotations that already happened on a deployed
 * instance are untouched by it. Removing those is a destructive, irreversible
 * delete-many over stored credentials; the vehicle for it (migration / admin
 * command / opt-in script) is a maintainer decision and is escalated
 * separately. ⛔ This module deliberately contains no deletion, and must not
 * grow one.
 *
 * ## The measurement that shapes this module's contract
 *
 * #8063's point-delete argues reachability from three facts. Re-measured on
 * this checkout (see `sys-secret-orphan-report.test.ts`), **one of them is
 * false**, and it is the one a sweep depends on most:
 *
 *  - ✅ Handle ids are minted per `encrypt()` call — `LocalCryptoProvider`
 *    mints `sec_` + 16 random bytes inside `encrypt`, and `rotateKey` keeps
 *    `id` stable, so a handle names exactly one ciphertext lineage.
 *  - ❌ **`sys_setting.value_enc` is NOT the only column that holds a handle.**
 *    `sys_secret` has *three* privileged producers, as its own schema says
 *    (`platform-objects/src/system/sys-secret.object.ts`): `SettingsService`,
 *    the engine's `secret`-field encryption (`encryptSecretFields`, which
 *    stores `secret:<id>` on an arbitrary business row), and the datasource
 *    credential binder (which stores `sys_secret:<id>` at
 *    `external.credentialsRef`). Two of the three are invisible from this
 *    package, and the engine's set of holders is not even statically
 *    enumerable — it is every `secret`-typed field on every registered object,
 *    including tenant-authored ones.
 *  - ✅ The audit trail records digests, not handles (`old_hash` / `new_hash`
 *    are content digests; `SettingsService` passes the provider's `digest()`),
 *    so audit stays readable after a ciphertext is destroyed — and, the other
 *    way round, audit can never be used to reconstruct which handles existed.
 *
 * That falsified fact is why this module's verdict vocabulary has a third
 * value. A row this package cannot ATTRIBUTE to the settings producer is
 * reported {@link SecretRowVerdict `'unattributable'`}, never `'orphaned'` —
 * "unreferenced by `sys_setting`" and "unreferenced" are different claims, and
 * conflating them is what would delete a live datasource credential or a live
 * business-row secret. The attribution guard is the safety property; it is
 * pinned by test and ⛔ must not be relaxed into "everything unreferenced is an
 * orphan".
 *
 * ## The two directional guards the card names
 *
 *  - **Legacy inline crypto, in the other direction from #8063's reaper.** The
 *    pre-Phase-3 path stores the ciphertext ITSELF in `value_enc` rather than a
 *    `sec_` handle. #8063 guards its delete with a `sec_` prefix check; the
 *    guard needed *here* is that such a row contributes no handle to the
 *    referenced set and must never make a `sys_secret` row look collectable by
 *    implication. Rows whose `(namespace, key)` currently resolves through a
 *    legacy inline value are flagged {@link ClassifiedSecretRow.legacyInlineSibling}
 *    so an operator sees that the pair has been written through both paths.
 *  - **`rotateKey()` is not a retirement.** It re-wraps in place
 *    (`secretStore.update`) and keeps `id` stable, so a re-wrapped row is still
 *    the referenced one. Classification is therefore by REFERENCE only —
 *    `version` / `rotated_at` never contribute to a verdict, they are reported
 *    as {@link ClassifiedSecretRow.rewrapped} for the operator's eyes. A
 *    classifier that read "version > 1" as "was rotated, therefore retired"
 *    would delete the value in force; that inversion is pinned by test.
 *
 * ## Shape
 *
 * A pure function over snapshots the caller has already read. It takes no
 * store, no engine and no provider, so it cannot write and cannot decrypt, and
 * it adds nothing to any persistence port — the collection surface (how an
 * operator obtains these snapshots, and through which command) is part of the
 * escalated vehicle decision and is deliberately not settled here.
 *
 * ⛔ Snapshots must not carry `ciphertext`. The maintainer ruling of
 * 2026-08-12 on this card is that report mode "names counts and row ids
 * without decrypting", and {@link SecretRowSnapshot} is typed to make carrying
 * the cipher material a type error rather than a review question.
 */

import type { SettingsManifest } from '@objectstack/spec/system';

/**
 * Prefix of a `sys_secret` handle id as minted by `ICryptoProvider.encrypt`.
 *
 * Must agree with the two literals `SettingsService` uses (the `sec_` guard in
 * `reapRotatedSecret` and the dereference branch in `materialiseRow`). Pinned
 * against the real minter rather than against those literals: the test mints a
 * handle through `LocalCryptoProvider` and asserts {@link isSecretHandle}
 * accepts it, so the prefix is checked against the code that actually produces
 * ids, not against a copy of the same string.
 */
export const SECRET_HANDLE_PREFIX = 'sec_';

/** True when `value` is a `sys_secret` handle id rather than inline ciphertext. */
export function isSecretHandle(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SECRET_HANDLE_PREFIX);
}

/**
 * A `sys_secret` row as the report sees it.
 *
 * ⛔ Deliberately has no `ciphertext` member. The report never decrypts and
 * never needs the cipher material; leaving it off the type means a caller
 * cannot accidentally pipe cleartext-recoverable bytes into a reporting
 * surface that is expected to be safe to print.
 */
export interface SecretRowSnapshot {
  /** `sys_secret.id` — the handle. */
  id: string;
  /** `sys_secret.namespace`. Overloaded across producers; see `attributable`. */
  namespace: string;
  /** `sys_secret.key`. */
  key: string;
  /** Wrapping version. Reported, never a verdict input. */
  version?: number | null;
  /** KMS key id. Reported, never a verdict input. */
  kms_key_id?: string | null;
  created_at?: string | null;
  /** Set when the row was re-wrapped in place. Never a verdict input. */
  rotated_at?: string | null;
}

/** A `sys_setting` row as the report sees it. */
export interface SettingRowSnapshot {
  namespace: string;
  key: string;
  scope?: string | null;
  user_id?: string | null;
  /** Handle id (`sec_…`) or, on the legacy inline path, the ciphertext itself. */
  value_enc?: string | null;
  encrypted?: boolean | null;
}

/** A `(namespace, key)` pair the settings manifests declare as encrypted. */
export interface EncryptedSpecifierRef {
  namespace: string;
  key: string;
}

/**
 * Verdict for one `sys_secret` row.
 *
 *  - `in_force` — a live `sys_setting` row's `value_enc` names this handle.
 *  - `orphaned` — nothing in `sys_setting` names it AND it is attributable to
 *    the settings producer. The only class a settings-scoped sweep could ever
 *    consider, and even then only after the vehicle decision.
 *  - `unattributable` — nothing in `sys_setting` names it and this package
 *    cannot prove settings produced it. Belongs to (or may belong to) the
 *    engine's `secret`-field channel or the datasource binder. ⛔ NOT an
 *    orphan; a sweep must leave it alone.
 */
export type SecretRowVerdict = 'in_force' | 'orphaned' | 'unattributable';

/** One classified `sys_secret` row. */
export interface ClassifiedSecretRow {
  id: string;
  namespace: string;
  key: string;
  verdict: SecretRowVerdict;
  /** Human-readable justification, safe to print (no cipher material). */
  reason: string;
  /**
   * True when the row's `(namespace, key)` currently resolves through a LEGACY
   * INLINE `sys_setting` value rather than a handle. The pair has been written
   * through both storage paths; an operator should look before acting.
   */
  legacyInlineSibling?: boolean;
  /**
   * True when the row carries re-wrap evidence (`version > 1` or `rotated_at`).
   * Reported only — a re-wrap keeps the handle stable and is NOT a retirement.
   */
  rewrapped?: boolean;
}

/** The report. Counts and row ids only — never plaintext, never ciphertext. */
export interface SysSecretOrphanReport {
  counts: {
    total: number;
    inForce: number;
    orphaned: number;
    unattributable: number;
  };
  rows: ClassifiedSecretRow[];
  /**
   * `sys_setting` rows still on the legacy inline path (encrypted, but
   * `value_enc` is not a handle). They reference no `sys_secret` row at all.
   */
  legacyInlineRows: Array<{
    namespace: string;
    key: string;
    scope?: string | null;
    user_id?: string | null;
  }>;
  /**
   * What this report could NOT establish. Non-empty by design: an operator
   * reading counts without these would over-trust the `orphaned` number.
   */
  caveats: string[];
}

/**
 * Collect the `(namespace, key)` pairs the given manifests declare
 * `encrypted: true` — the settings producer's attribution set.
 *
 * Only these pairs can ever have been written to `sys_secret` BY
 * `SettingsService`, because the service's encrypted branch is gated on the
 * manifest's `encryptedKeys`. A `sys_secret` row outside this set was produced
 * by someone else (or by a manifest this instance no longer registers — see the
 * caveat the report emits).
 */
export function collectEncryptedSpecifierRefs(
  manifests: readonly SettingsManifest[],
): EncryptedSpecifierRef[] {
  const out: EncryptedSpecifierRef[] = [];
  for (const manifest of manifests ?? []) {
    const namespace = manifest?.namespace;
    if (!namespace) continue;
    for (const specifier of manifest.specifiers ?? []) {
      if (specifier && (specifier as { encrypted?: unknown }).encrypted === true) {
        out.push({ namespace, key: specifier.key });
      }
    }
  }
  return out;
}

const refKey = (namespace: string, key: string) => `${namespace} ${key}`;

/**
 * Classify every `sys_secret` row against the settings subsystem's references.
 *
 * Pure and read-only. `attributableTo` is the set of `(namespace, key)` pairs
 * the caller's REGISTERED manifests declare encrypted — pass
 * {@link collectEncryptedSpecifierRefs} over the manifests the instance boots
 * with. Passing an empty set is legal and yields zero orphans and an explicit
 * caveat: with nothing to attribute against, no row can be proven to be
 * settings' to collect, which is the safe direction.
 */
export function classifySysSecretRows(input: {
  secrets: readonly SecretRowSnapshot[];
  settingRows: readonly SettingRowSnapshot[];
  attributableTo: readonly EncryptedSpecifierRef[];
}): SysSecretOrphanReport {
  const secrets = input.secrets ?? [];
  const settingRows = input.settingRows ?? [];
  const attributable = new Set(
    (input.attributableTo ?? []).map((r) => refKey(r.namespace, r.key)),
  );

  // The referenced set: handles named by a live `sys_setting` row. A legacy
  // inline value is NOT a handle and contributes nothing here — that is the
  // `sec_` guard in the other direction from #8063's reaper.
  const referenced = new Set<string>();
  const legacyInlineRows: SysSecretOrphanReport['legacyInlineRows'] = [];
  const legacyInlinePairs = new Set<string>();

  for (const row of settingRows) {
    const enc = row?.value_enc;
    if (typeof enc !== 'string' || enc === '') continue;
    if (isSecretHandle(enc)) {
      referenced.add(enc);
      continue;
    }
    // Inline ciphertext (or a non-handle value on an encrypted row).
    legacyInlineRows.push({
      namespace: row.namespace,
      key: row.key,
      scope: row.scope ?? null,
      user_id: row.user_id ?? null,
    });
    legacyInlinePairs.add(refKey(row.namespace, row.key));
  }

  const rows: ClassifiedSecretRow[] = [];
  let inForce = 0;
  let orphaned = 0;
  let unattributable = 0;

  for (const secret of secrets) {
    // Re-wrap evidence is REPORTED, never a verdict input: `rotateKey` keeps
    // the handle stable, so a re-wrapped row is the row still in force.
    const rewrapped =
      (typeof secret.version === 'number' && secret.version > 1) ||
      (typeof secret.rotated_at === 'string' && secret.rotated_at !== '');
    const legacyInlineSibling = legacyInlinePairs.has(refKey(secret.namespace, secret.key));

    let verdict: SecretRowVerdict;
    let reason: string;

    if (referenced.has(secret.id)) {
      verdict = 'in_force';
      reason = rewrapped
        ? 'referenced by a live sys_setting.value_enc; re-wrapped in place (handle stable) — not a retirement'
        : 'referenced by a live sys_setting.value_enc';
      inForce += 1;
    } else if (attributable.has(refKey(secret.namespace, secret.key))) {
      verdict = 'orphaned';
      reason = legacyInlineSibling
        ? 'no sys_setting row names this handle; attributable to a declared encrypted specifier, ' +
          'but that (namespace, key) currently resolves through a LEGACY INLINE value — inspect before acting'
        : 'no sys_setting row names this handle, and (namespace, key) matches a declared encrypted specifier';
      orphaned += 1;
    } else {
      verdict = 'unattributable';
      reason =
        'no sys_setting row names this handle AND (namespace, key) matches no declared encrypted ' +
        'specifier — may belong to the engine secret-field channel or the datasource credential ' +
        'binder, which this report cannot see. NOT an orphan.';
      unattributable += 1;
    }

    rows.push({
      id: secret.id,
      namespace: secret.namespace,
      key: secret.key,
      verdict,
      reason,
      ...(legacyInlineSibling ? { legacyInlineSibling: true } : {}),
      ...(rewrapped ? { rewrapped: true } : {}),
    });
  }

  const caveats: string[] = [
    'Settings-scoped only. `sys_secret` has three producers (SettingsService, the engine ' +
      'secret-field channel storing `secret:<id>` on arbitrary business rows, and the datasource ' +
      'credential binder storing `sys_secret:<id>` at `external.credentialsRef`). This report reads ' +
      'only `sys_setting`, so a row it calls `unattributable` may be live elsewhere.',
    'The engine secret-field holders are not statically enumerable — they are every `secret`-typed ' +
      'field on every registered object, including tenant-authored ones. A complete reference set ' +
      'cannot be built from this package.',
    '`sys_secret` carries no producer column, and `namespace`/`key` mean different things per ' +
      'producer (settings namespace/specifier key; object name/field name; `datasource`/datasource ' +
      'name). Attribution by (namespace, key) is therefore a HEURISTIC: an object named like a ' +
      'settings namespace with a field named like a specifier key would be attributed to settings.',
  ];
  if (attributable.size === 0) {
    caveats.push(
      'No encrypted specifiers were supplied, so nothing could be attributed to the settings ' +
        'producer and no row is reported as orphaned. Pass the registered manifests.',
    );
  }
  if (legacyInlineRows.length > 0) {
    caveats.push(
      `${legacyInlineRows.length} sys_setting row(s) still hold inline ciphertext rather than a ` +
        'handle. They reference no sys_secret row; rows sharing their (namespace, key) are flagged ' +
        '`legacyInlineSibling`.',
    );
  }
  caveats.push(
    'A manifest that is no longer registered makes its previously-encrypted keys unattributable, ' +
      'so genuine settings orphans can be under-reported. Under-reporting is the safe direction.',
  );

  return {
    counts: { total: rows.length, inForce, orphaned, unattributable },
    rows,
    legacyInlineRows,
    caveats,
  };
}
