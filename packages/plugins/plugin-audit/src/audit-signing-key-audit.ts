// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31908, ADR-0154 D6] The `audit_signing_key_change` row in the compliance
 * ledger: one deployment-level row each time the key that signs audit
 * checkpoints changes — the first key's creation, and (when a rotation verb
 * exists) each rotation — naming the new and the retired fingerprints.
 *
 * `sys_audit_signing_key` is kept out of the audit writer
 * (`AUDIT_EXCLUDED_OBJECTS`), so this row is the ledger's only record of a key
 * change, and the deployment chain seals it like any other row (D5).
 *
 * Called by the default signer (`audit-seal/signer.ts`) BEFORE it writes the
 * key row: a key nothing recorded never signs. A failure here is the signer's
 * failure, which the sealer reports.
 *
 * ⛔ Never key material, a `sys_secret` handle or a ciphertext: a fingerprint
 * is the lowercase hex SHA-256 of the public key, and is re-checked as one.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';

/** The `sys_audit_log.action` value this writer emits. */
export const AUDIT_SIGNING_KEY_CHANGE_ACTION = 'audit_signing_key_change' as const;

/** The service principal the row names as its actor: the sealer, not a person. */
export const AUDIT_SEALER_ACTOR = 'svc:audit-sealer' as const;

/** One key change. */
export interface AuditSigningKeyChange {
  /** The fingerprint of the key that signs from now on. */
  newFingerprint: string;
  /** The fingerprint of the key it replaces; `null` for the first key. */
  retiredFingerprint: string | null;
}

/** A key fingerprint: 64 lowercase hex digits. */
const FINGERPRINT = /^[0-9a-f]{64}$/;

/** The ledger row of one key change. Refuses a fingerprint that is not one. Exported for the tests. */
export function buildAuditSigningKeyChangeRow(change: AuditSigningKeyChange): Record<string, unknown> {
  if (!FINGERPRINT.test(change.newFingerprint)) throw new Error('audit_signing_key_change: the new fingerprint is not 64 lowercase hex digits');
  if (change.retiredFingerprint !== null && !FINGERPRINT.test(change.retiredFingerprint)) {
    throw new Error('audit_signing_key_change: the retired fingerprint is not 64 lowercase hex digits');
  }
  return {
    action: AUDIT_SIGNING_KEY_CHANGE_ACTION,
    // No human acted: the sealer created the key it needed.
    user_id: null,
    actor: AUDIT_SEALER_ACTOR,
    // About the deployment's key, not a record of an object the ledger's read gate resolves.
    object_name: null,
    record_id: null,
    old_value: null,
    new_value: null,
    ip_address: null,
    user_agent: null,
    // [ADR-0131 D7] The key is the deployment's: a deployment-level row.
    tenant_id: null,
    metadata: JSON.stringify({ new_fingerprint: change.newFingerprint, retired_fingerprint: change.retiredFingerprint }),
  };
}

/** Write the row, in the system context. Throws when it does not land. */
export async function writeAuditSigningKeyChange(
  engine: Pick<IDataEngine, 'insert'>,
  change: AuditSigningKeyChange,
): Promise<void> {
  await engine.insert('sys_audit_log', buildAuditSigningKeyChangeRow(change), { context: { isSystem: true } });
}
