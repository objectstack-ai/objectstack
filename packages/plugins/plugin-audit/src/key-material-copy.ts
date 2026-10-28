// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The key-material columns a COPY of a row never carries, shared by the two
 * places that hold such a copy to it: the audit writer (`ledgerView` in
 * `audit-writers.ts`), which omits them from every new `sys_audit_log` /
 * `sys_activity` copy at write time, and the at-rest rewrite of the copies
 * written before it did (`key-material-copy-migration.ts`). One function, so a
 * copy the writer makes today and a copy the rewrite repaired read the same.
 *
 * ## What the list holds
 *
 * A column that stores encrypted key material and is declared as an ordinary
 * text column, so neither of the writer's declaration-keyed limbs reaches it:
 * it is not a credential field (`secret` / `password`, masked), and it is not
 * flagged `internal` (omitted) — its producers read it back through the
 * generic engine read, which an `internal` flag would strip. The objects that
 * hold such a column:
 *
 *  - the secret store itself — the cipher of every encrypted settings value,
 *    `secret`-field value and datasource credential. The store is readable by
 *    the platform only; a ledger copy is a second, longer-lived home for the
 *    same cipher, kept after the store has destroyed a rotated or deleted one.
 *  - the two settings holders (the tenant/user rung and the deployment rung).
 *    Their encrypted-value column holds a handle into the store when a crypto
 *    provider is wired and the cipher inline when the legacy adapter path wrote
 *    it; the holder's own declaration promises the ledger only a placeholder
 *    and a digest of an encrypted value. A copy cannot tell a handle from a
 *    cipher, so it carries neither: fail closed.
 *
 * Omitted rather than masked, for the reason the `internal` limb gives: the
 * mask says "a value is set", which on a required column carries nothing, and
 * a holder's `encrypted` flag already says it for the settings rows. What the
 * ledger keeps is the rest of the row — which record, its producer-scoped
 * label, its key id, algorithm and version, and who changed it when — so a
 * rotation still writes its row (version and key id move), with no cipher on
 * either side.
 *
 * ## Closed and declared
 *
 * An object is a member only by being listed here, and the object names are
 * the platform-object definitions' own, never re-typed. A new object that
 * stores key material in a plain column joins by a line here and a census row
 * in `audit-internal-field-omission.test.ts`, which also pins that every listed
 * column is declared by its object, so a renamed column reds instead of
 * silently reaching the ledger again.
 */

import { SysPlatformSetting, SysSecret, SysSetting } from '@objectstack/platform-objects/system';

/** Per object: the columns no ledger copy of its rows carries. */
export const KEY_MATERIAL_COPY_COLUMNS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  [SysSecret.name, ['ciphertext']],
  [SysSetting.name, ['value_enc']],
  [SysPlatformSetting.name, ['value_enc']],
]);

/** The objects {@link KEY_MATERIAL_COPY_COLUMNS} lists. */
export const KEY_MATERIAL_COPY_OBJECTS: readonly string[] = [...KEY_MATERIAL_COPY_COLUMNS.keys()];

/** The key-material columns of `objectName` — empty for an object the list does not name. */
export function keyMaterialColumnsOf(objectName: unknown): readonly string[] {
  return typeof objectName === 'string' ? KEY_MATERIAL_COPY_COLUMNS.get(objectName) ?? [] : [];
}

/**
 * Omit the key-material columns from one copy of an `objectName` row, IN
 * PLACE. A copy of any object the list does not name is left as it is, and a
 * column the copy does not carry is never invented.
 *
 * Returns whether any column was removed — `false` on a copy that already
 * carries none, which is what makes the at-rest rewrite idempotent.
 */
export function omitKeyMaterialFromCopy(objectName: unknown, copy: Record<string, unknown>): boolean {
  let changed = false;
  for (const column of keyMaterialColumnsOf(objectName)) {
    if (!(column in copy)) continue;
    delete copy[column];
    changed = true;
  }
  return changed;
}
