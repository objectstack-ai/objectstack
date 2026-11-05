// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 5] The secret and internal-field bodies of `ObjectQL`, moved out
 * of `engine.ts` whole: the write-side credential pass (`encryptSecretFields`,
 * `refuseEmptyPasswordFields`), the read-side strips (`maskSecretFields`,
 * `omitInternalFields`, `stripSearchCompanionFromRead`), and the three
 * privileged read verbs with the driver options they share (`resolveSecret`,
 * `resolveSecretField`, `resolveInternalField`, `privilegedReadDriverOptions`).
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited: the same fail-closed throws, the same echoed-mask drop,
 * the same mask-then-omit order, the same refusals before any driver read, and
 * the same ambient-transaction rule for the privileged reads. Each method's
 * docblock stays on the method in `engine.ts`, which is still the contract.
 *
 * [#27495] One later change, on the write side: `encryptSecretFields` seals a
 * value without writing its `sys_secret` row and hands the row back, and two
 * bodies joined it — `persistSecretRows` writes the sealed rows immediately
 * before the record's own driver write, and `releaseSecretHandles` removes a
 * handle once a write that did not land, or a committed one that moved the
 * column off it, has left it unreferenced. [#27581] A committed delete hands
 * the same release every handle the deleted rows held (`deletedSecretSlots`).
 *
 * [#27582] And one on the value already spelled as a ref: a non-system write
 * may only seal a new value or keep its own record's ref. `encryptSecretFields`
 * takes the write's own stored rows ({@link StoredRowsReader}) and refuses any
 * other ref with {@link SecretRefWriteError}; the system principal keeps the
 * pass-through.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method as
 * `engine-realtime-publish.ts` applies it. The class keeps all eleven methods —
 * the published `.d.ts` lists each one's name and position — and each body is
 * one literal of exactly the {@link SecretInternalFieldsHost} members that
 * method reads, plus a `.call`. The four fields the bodies read
 * (`_registry`, `cryptoProvider`, `txStore`, `logger`) go as GETTERS, so each
 * read happens when the body makes it: `setCryptoProvider` replaces the
 * provider at any time, and a body sees whatever is installed at the moment it
 * reads, as it did. The six methods they call (`getDriver`,
 * `transactionCoversDriverFor`, `isClosedUnitHandle`, `omitInternalFields`,
 * `privilegedReadDriverOptions`, `resolveSecret`) go as late-bound closures
 * over the instance, so a double or spy set on the engine — tests replace
 * `resolveInternalField` and `resolveSecretField` on the instance — is still
 * the one a call reaches. `stripSearchCompanionFromRead` reads no member and
 * is called directly.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 */

import type { CryptoHandle } from '@objectstack/spec/contracts';
import type { DriverOptions } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { redactBoundStatement, redactPropagatedDriverFault } from '@objectstack/types';
import {
  collectSecretFields,
  collectMaskedReadFields,
  collectMaskedPasswordFields,
  collectInternalReadFields,
  makeSecretRef,
  parseSecretRef,
  isSecretRef,
  EmptyCredentialWriteError,
  SECRET_MASK,
} from './secret-fields.js';
import { isSearchCompanionRequested, stripSearchCompanion } from './search-companion.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface SecretInternalFieldsHost {
  readonly _registry: ObjectQL['_registry'];
  readonly cryptoProvider: ObjectQL['cryptoProvider'];
  readonly txStore: ObjectQL['txStore'];
  readonly logger: ObjectQL['logger'];
  getDriver: ObjectQL['getDriver'];
  transactionCoversDriverFor: ObjectQL['transactionCoversDriverFor'];
  isClosedUnitHandle: ObjectQL['isClosedUnitHandle'];
  omitInternalFields: ObjectQL['omitInternalFields'];
  privilegedReadDriverOptions: ObjectQL['privilegedReadDriverOptions'];
  resolveSecret: ObjectQL['resolveSecret'];
}

/**
 * [#27495] A `sys_secret` row the credential pass sealed for one record write
 * and has not written yet: the column it was minted for, the handle id the
 * row's ref now names, the row itself, and the driver options the pass was
 * handed. {@link persistSecretRows} writes it immediately before the record's
 * own driver write, so a write refused before that point leaves nothing behind.
 */
export interface PendingSecretRow {
  readonly field: string;
  readonly handleId: string;
  readonly row: Record<string, unknown>;
  readonly driverOptions: unknown;
}

/** [#27495] A handle a write may have left unreferenced, and the column it was minted for. */
export interface SecretHandleSlot {
  readonly field: string;
  readonly handleId: string;
}

/**
 * [#27582] The rows a write's own record(s) hold in storage now, read for one
 * question: is a ref on a non-system payload the value that record's column
 * already holds? Each call site says what its own rows are — none for an
 * insert (a new record holds no ref of its own), the pre-image for a by-id
 * update, the matched rows for a predicate update — and the reader is called
 * only when a non-system payload carries a ref, so every other write reads
 * nothing more than it did.
 */
export type StoredRowsReader = () => Promise<readonly (Record<string, unknown> | null | undefined)[] | null>;

/**
 * [#27582] The ADR-0112 pair carried by the refusal of a ref that is not the
 * record's own. `VALIDATION_ERROR` / 400 is the standard-catalog member the
 * sibling credential refusals use (`EMPTY_CREDENTIAL_REFUSAL_CODE`): the
 * payload is wrong and the caller can fix it, so no ledger registration is
 * needed.
 */
export const SECRET_REF_WRITE_REFUSAL_CODE = 'VALIDATION_ERROR';
export const SECRET_REF_WRITE_REFUSAL_STATUS = 400;

/**
 * [#27582] Refusal of a `secret:` ref on a non-system write that is not the
 * value the record's own column already holds. Fail closed, with one answer:
 * the message names the column and never the ref, and nothing about the handle
 * the ref names is looked up, so the answer is the same whatever it names.
 */
export class SecretRefWriteError extends Error {
  readonly code = SECRET_REF_WRITE_REFUSAL_CODE;
  readonly status = SECRET_REF_WRITE_REFUSAL_STATUS;
  /** The same number under ADR-0112 D5's spelling, as `EmptyCredentialWriteError` carries it. */
  readonly httpStatus = SECRET_REF_WRITE_REFUSAL_STATUS;
  readonly object: string;
  readonly field: string;
  constructor(object: string, field: string) {
    super(
      `Stored-reference value refused for secret field "${object}.${field}": a value that starts with "secret:" `
        + 'is read as a reference to a credential already stored, not as a credential, and a write may only keep '
        + 'the reference this record already holds. To set the secret, send its value; to clear it, write null; '
        + 'to leave it unchanged, omit the field. Nothing was written.',
    );
    this.name = 'SecretRefWriteError';
    this.object = object;
    this.field = field;
  }
}

/**
 * Normalize credential fields on `row` in place before it reaches the driver.
 *
 * Two channels share the read mask ({@link SECRET_MASK}) but differ on write
 * (see ADR-0100):
 *
 *  - **`secret`** — encrypted: each plaintext is wrapped by the ICryptoProvider
 *    and replaced on `row` by an opaque ref. Cleartext never reaches the
 *    business table. [#27495] The `sys_secret` row is SEALED here and handed
 *    back, not written: the caller writes it with {@link persistSecretRows}
 *    immediately before the record's own driver write, so a write refused
 *    after this pass (validation, the post-image seam) leaves no row behind.
 *  - **`password`** (generic, non-`better-auth`) — plaintext at rest: stored
 *    verbatim, no encryption and no `sys_secret` row. Only the echoed-mask drop
 *    below applies to it.
 *
 * Rules:
 *  - Any masked field (secret or password) whose value equals the read mask ⇒
 *    the key is dropped, so a form round-trip that echoes the mask does not
 *    overwrite the stored value.
 *  - No secret fields on the object ⇒ no further work (fast path, no crypto).
 *  - `null`/`undefined` secret value ⇒ left as-is (clears the secret).
 *  - [#8559] `""` secret value ⇒ REFUSED with {@link EmptyCredentialWriteError}
 *    (ADR-0112 `VALIDATION_ERROR`/400, message names `null` as the clear
 *    spelling). Encrypting it would mint a `sys_secret` row that decrypts to
 *    nothing behind a perfectly valid ref, so every read reports "a secret is
 *    set" while the dereference returns nothing — the contradictory state
 *    #8542/#8558 defend consumers against. Refused, not folded into the
 *    `null` branch: silently reinterpreting the write was explicitly rejected
 *    (maintainer ruling 2026-08-13 on #8559). The `password` half of the same
 *    ruling lands at its own seam — {@link refuseEmptyPasswordFields} — since
 *    the two types share the read mask but not this encryption path.
 *  - Secret value already a ref ⇒ [#27582] a non-system write may only seal
 *    a new value or keep its own record's ref. From the system principal
 *    (`context.isSystem === true`) it is left as-is, as it always was. From
 *    any other caller it is kept only when every row the write lands on
 *    already holds exactly that ref in that column — read from `storedRows`,
 *    which each call site supplies (none for an insert, the pre-image for a
 *    by-id update, the matched rows for a predicate update) — and then the
 *    key is dropped, as the echoed mask is. Any other ref is REFUSED with
 *    {@link SecretRefWriteError} (ADR-0112 `VALIDATION_ERROR`/400), one
 *    answer whatever the ref names.
 *  - **Fail-closed:** any other secret value with no CryptoProvider registered,
 *    or no reachable `sys_secret` store, THROWS — never persists cleartext.
 *    (A `password` field needs no CryptoProvider — it is stored as-is.)
 */
export async function encryptSecretFields(
  this: Pick<SecretInternalFieldsHost, '_registry' | 'cryptoProvider' | 'getDriver'>,
  object: string,
  row: Record<string, unknown>,
  context: ExecutionContext | undefined,
  driverOptions: unknown,
  storedRows: StoredRowsReader,
): Promise<PendingSecretRow[]> {
  const pending: PendingSecretRow[] = [];
  if (!row || typeof row !== 'object') return pending;
  const schema = this._registry.getObject(object);
  let ownRows: readonly (Record<string, unknown> | null | undefined)[] | undefined;

  // Echoed-mask drop for every field the read path masks (secret + generic
  // password). The read path returns SECRET_MASK; a client that PATCHes it
  // back means "unchanged", so drop the key rather than persist the literal
  // mask. Doing this up front keeps the better-auth exemption in one place
  // (collectMaskedReadFields) and covers objects that have a password field
  // but no secret field. (#2036, ADR-0100)
  for (const field of collectMaskedReadFields(schema)) {
    if (field in row && row[field] === SECRET_MASK) delete row[field];
  }

  const secretFields = collectSecretFields(schema);
  if (secretFields.length === 0) return pending;

  for (const field of secretFields) {
    if (!(field in row)) continue;
    const value = row[field];

    if (value === null || typeof value === 'undefined') continue; // clear
    // [#8559] The empty string is neither a clear (`null` is) nor a storable
    // credential — refuse it BEFORE the crypto gates below: this is a verdict
    // on the payload, so it must not depend on whether a CryptoProvider or
    // sys_secret store happens to be wired.
    if (value === '') throw new EmptyCredentialWriteError(object, field, 'secret');
    if (isSecretRef(value)) {
      // The system principal's ref passes through as it always has: a system
      // writer may copy a ref on purpose (seed replay, migration).
      if (context?.isSystem === true) continue;
      // [#27582] A non-system write may only seal a new value or keep its own
      // record's ref: every row this write lands on must already hold exactly
      // this value in this column. A write with no own row (an insert, a
      // predicate that matches nothing) has nothing to keep. Kept, the key is
      // dropped, as the echoed mask is: the column is not rewritten at all, so
      // the verdict cannot go stale before the statement runs.
      ownRows ??= (await storedRows()) ?? [];
      const keepsOwn = ownRows.length > 0 && ownRows.every((own) => own?.[field] === value);
      if (!keepsOwn) throw new SecretRefWriteError(object, field);
      delete row[field];
      continue;
    }

    if (!this.cryptoProvider) {
      throw new Error(
        `Cannot persist secret field "${object}.${field}": no CryptoProvider is registered. `
          + 'Wire one via engine.setCryptoProvider(...) (e.g. LocalCryptoProvider in dev, '
          + 'a KMS/Vault provider in production). Refusing to store cleartext (fail-closed).',
      );
    }

    const plain = typeof value === 'string' ? value : JSON.stringify(value);
    // ADR-0128 D1: this producer's own scope, so the AAD names the
    // object-secret-field vocabulary and no other producer's context opens it.
    const handle: CryptoHandle = await this.cryptoProvider.encrypt(plain, {
      scope: 'object_secret_field',
      namespace: object,
      key: field,
      tenantId: context?.tenantId,
    });

    // Fail-closed on a missing store HERE, before validation, as before: the
    // row is only written later (#27495), but whether it could be is a verdict
    // on the composition, not on the record.
    try {
      this.getDriver('sys_secret');
    } catch {
      throw new Error(
        `Cannot persist secret field "${object}.${field}": the sys_secret store is not available. `
          + 'Ensure the platform-objects (sys_secret) are registered before writing secret fields (fail-closed).',
      );
    }

    // [#27495] Sealed, not written: the ref goes on the row now, so validation
    // and the post-image seam judge the stored reference as they always have,
    // and the row reaches `sys_secret` only with the record that names it.
    pending.push({
      field,
      handleId: handle.id,
      row: {
        id: handle.id,
        namespace: object,
        key: field,
        kms_key_id: handle.kmsKeyId,
        alg: handle.alg,
        version: handle.version,
        ciphertext: handle.ciphertext,
        created_at: new Date().toISOString(),
      },
      driverOptions,
    });

    row[field] = makeSecretRef(handle.id);
  }
  return pending;
}

/** [#27495] The `secret` fields a write payload carries a key for — the columns the write can move. */
export function secretFieldsWritten(
  schema: Parameters<typeof collectSecretFields>[0],
  payload: unknown,
): string[] {
  if (!payload || typeof payload !== 'object') return [];
  return collectSecretFields(schema).filter((field) => field in (payload as Record<string, unknown>));
}

/**
 * [#27495] The handles a committed update moved its columns off: for each
 * `secret` field the payload carries, every prior row's handle the payload
 * does not keep — a `null` clear or a new value, never an echoed ref or a
 * dropped echoed mask. A candidate list, not a verdict: `releaseSecretHandles`
 * verifies each one against storage before anything is removed.
 */
export function retiredSecretSlots(
  schema: Parameters<typeof collectSecretFields>[0],
  priorRows: readonly (Record<string, unknown> | null | undefined)[],
  payload: unknown,
): SecretHandleSlot[] {
  const out: SecretHandleSlot[] = [];
  for (const field of secretFieldsWritten(schema, payload)) {
    const next = (payload as Record<string, unknown>)[field];
    for (const prior of priorRows) {
      const handleId = parseSecretRef(prior?.[field]);
      if (handleId && next !== makeSecretRef(handleId)) out.push({ field, handleId });
    }
  }
  return out;
}

/**
 * [#27581] The `secret` columns a delete reads off the rows it removes, before
 * its statement takes them away; empty for an object that declares none, so a
 * delete anywhere else reads nothing more.
 */
export function deletedSecretColumns(schema: Parameters<typeof collectSecretFields>[0]): string[] {
  return collectSecretFields(schema);
}

/**
 * [#27581] The handles a committed delete let go of: every handle the deleted
 * rows held in a `secret` column. A delete lets go of each column's value at
 * once, so the candidates are exactly what a `null` clear of every one of
 * those columns retires ({@link retiredSecretSlots}), and the same
 * `releaseSecretHandles` checks decide each one: there is one release rule.
 */
export function deletedSecretSlots(
  schema: Parameters<typeof collectSecretFields>[0],
  deletedRows: readonly (Record<string, unknown> | null | undefined)[],
): SecretHandleSlot[] {
  const clearEvery = Object.fromEntries(deletedSecretColumns(schema).map((field) => [field, null]));
  return retiredSecretSlots(schema, deletedRows, clearEvery);
}

/**
 * [#27495] Write the `sys_secret` rows {@link encryptSecretFields} sealed for
 * one record write. Called immediately before that record's driver write and
 * after every pass that can refuse it, so the credential row is written only
 * with the record that names it. Each row lands on `written` as it is
 * written, which is what the write's failure path hands to
 * {@link releaseSecretHandles} when the record write does not land.
 */
export async function persistSecretRows(
  this: Pick<SecretInternalFieldsHost, 'getDriver'>,
  pending: readonly PendingSecretRow[],
  written: PendingSecretRow[],
): Promise<void> {
  for (const one of pending) {
    await this.getDriver('sys_secret').create('sys_secret', one.row, one.driverOptions as any);
    written.push(one);
  }
}

/**
 * [#27495] Remove each `sys_secret` row in `slots` that the column it was
 * minted for no longer names — best-effort, and never a throw.
 *
 * Two occasions reach it. `'refused'`: a write that sealed and wrote a row
 * did not complete, so the row may name nothing. `'retired'`: a committed
 * update cleared the field (`null`) or replaced its value, so the handle the
 * column named before may name nothing; [#27581] a committed delete reaches
 * it the same way, for every handle the removed rows held. The same three
 * checks decide both,
 * and every one that cannot pass KEEPS the row, the recoverable direction
 * (deleting a handle a row still names destroys that credential, and nothing
 * can name what was lost):
 *
 *  - **Verified, never inferred.** No row of `object` may still name the
 *    handle in that column: a predicate write seals ONE handle for every row
 *    it matches, so clearing one of them leaves the handle in force for the
 *    rest; a write that did land after all (a partially applied batch) still
 *    names its row.
 *  - **This column's own handle.** The `sys_secret` row's `namespace`/`key`
 *    must be this object and field; a ref a system writer copied onto another
 *    column is not released through that column.
 *  - **Inside the record's unit.** The count and the delete ride the open
 *    transaction where it covers their drivers, so they see the write's own
 *    state and roll back with it; a record write in a unit that does not
 *    cover the `sys_secret` store keeps the row, since the delete could
 *    outlive a rollback of the record.
 *
 * A row kept for a failure (not for being in use) is reported once at
 * `error`, naming the column and the remedy: the caller's answer does not
 * change, and the stored ciphertext is exactly what the operator believes
 * gone. Legacy orphans written before this existed are not swept here; the
 * orphan report lists them.
 */
export async function releaseSecretHandles(
  this: Pick<SecretInternalFieldsHost, 'getDriver' | 'txStore' | 'transactionCoversDriverFor' | 'isClosedUnitHandle' | 'logger'>,
  object: string,
  slots: readonly SecretHandleSlot[],
  context: ExecutionContext | undefined,
  occasion: 'refused' | 'retired',
): Promise<void> {
  if (slots.length === 0) return;
  const kept = (slot: SecretHandleSlot, why: string, error?: unknown): void => {
    // The column, never the handle id: a handle is what a stored ref names.
    const what = occasion === 'refused'
      ? `the sys_secret row sealed for a write on "${object}.${slot.field}" that did not complete`
      : `the sys_secret row that "${object}.${slot.field}" named before this write`;
    const redacted = error === undefined ? undefined : redactBoundStatement(error);
    this.logger.error(
      `Credential row kept: ${what} was not removed, because ${why}. The write's own answer is unchanged, `
        + 'but that ciphertext is still stored and decryptable with nothing pointing at it. '
        + '`os secret orphans` reports it.',
      redacted instanceof Error ? redacted : undefined,
      { object, field: slot.field },
    );
  };
  // The unit the record write rode, chosen as `buildDriverOptions` chooses it:
  // an explicit, still-open handle first, then the ambient one.
  const explicit = context?.transaction;
  const tx = explicit !== undefined && !this.isClosedUnitHandle(explicit)
    ? explicit
    : this.txStore.getStore()?.transaction;
  const recordInUnit = tx !== undefined && this.transactionCoversDriverFor(object, tx);
  const storeInUnit = tx !== undefined && this.transactionCoversDriverFor('sys_secret', tx);
  const seen = new Set<string>();
  for (const slot of slots) {
    const dedupe = `${slot.field}:${slot.handleId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    // A record write inside a unit the store is not part of can still roll
    // back after this delete, and would then name a row that is gone: keep
    // the orphan, the recoverable direction.
    if (recordInUnit && !storeInUnit) {
      kept(slot, 'the record write ran in a transaction that does not cover the sys_secret store, so the delete could outlive a rollback');
      continue;
    }
    try {
      // Verify, never infer: no row of the column may still name the handle —
      // a predicate write shares one handle across every row it matched.
      const recordOptions: DriverOptions | undefined = recordInUnit ? { transaction: tx } : undefined;
      const refs = await this.getDriver(object).count(
        object,
        { where: { [slot.field]: makeSecretRef(slot.handleId) } },
        recordOptions,
      );
      if (refs > 0) continue;
      const storeOptions: DriverOptions | undefined = storeInUnit ? { transaction: tx } : undefined;
      const secretDriver = this.getDriver('sys_secret');
      const found = await secretDriver.find('sys_secret', { where: { id: slot.handleId } }, storeOptions);
      const secret: any = Array.isArray(found) ? found[0] : found;
      if (!secret) continue;
      // Only this column's own handle: a ref a system writer copied onto
      // another column says nothing about the column the handle was minted for.
      if (secret.namespace !== object || secret.key !== slot.field) continue;
      await secretDriver.delete('sys_secret', slot.handleId, storeOptions);
    } catch (e) {
      kept(slot, 'storage could not confirm the column let go of it, or could not delete it', e);
    }
  }
}

/**
 * [#8559] Refuse `""` on a `password`-typed field before it reaches the
 * driver — the `password` half of the same maintainer ruling (2026-08-13)
 * that makes {@link encryptSecretFields} refuse `""` on a `secret` field.
 *
 * Its own seam, deliberately NOT routed through the encryption path: the two
 * types share the read mask and the echoed-mask drop but a `password` field
 * is plaintext at rest (no CryptoProvider, no `sys_secret` row — ADR-0100),
 * so the refusal binds where its write actually flows. Storing `""` verbatim
 * would produce the same contradiction as the secret arm without the cipher
 * row: a non-null stored value that every read masks as "a password is set"
 * while the credential has no content. `null` (clear) and the echoed mask
 * (drop, handled in {@link encryptSecretFields}) keep their meanings.
 *
 * Scope is {@link collectMaskedPasswordFields}: `managedBy: 'better-auth'`
 * objects are exempt — their password column is not masked on read, so the
 * "reads as set, holds nothing" contradiction cannot arise there, and its
 * write path belongs to the auth subsystem.
 *
 * Called at every call site of {@link encryptSecretFields} (single/bulk
 * insert, single-id update, multi update) so the two halves of the ruling
 * guard the same doors.
 */
export function refuseEmptyPasswordFields(
  this: Pick<SecretInternalFieldsHost, '_registry'>,
  object: string,
  row: Record<string, unknown>,
): void {
  if (!row || typeof row !== 'object') return;
  const schema = this._registry.getObject(object);
  for (const field of collectMaskedPasswordFields(schema)) {
    if (field in row && row[field] === '') {
      throw new EmptyCredentialWriteError(object, field, 'password');
    }
  }
}

/**
 * Mask credential fields on read so plaintext never leaves the engine through
 * the normal query path. Covers `secret` fields (always) and `password` fields
 * on generic, non-`better-auth` objects (see {@link collectMaskedReadFields}
 * and ADR-0100). A set value becomes {@link SECRET_MASK}; an unset one stays
 * `null`. Privileged callers that genuinely need a secret's plaintext use
 * {@link resolveSecret} against the stored ref; a `password` field is stored
 * as plaintext at rest, so its cleartext is only ever reachable off this path.
 *
 * [#7728] Second collector branch, same choke point: a field declared
 * `internal: true` is OMITTED rather than masked — see
 * {@link omitInternalFields} for why the two dispositions differ.
 */
export function maskSecretFields(
  this: Pick<SecretInternalFieldsHost, '_registry' | 'omitInternalFields'>,
  object: string,
  rows: any,
): void {
  if (!rows) return;
  const schema = this._registry.getObject(object);
  const maskedFields = collectMaskedReadFields(schema);
  if (maskedFields.length > 0) {
    const list = Array.isArray(rows) ? rows : [rows];
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      for (const field of maskedFields) {
        if (!(field in row)) continue;
        row[field] = row[field] == null ? null : SECRET_MASK;
      }
    }
  }
  // Runs AFTER the mask, so a field that is somehow both `secret`-typed and
  // `internal` ends up omitted rather than masked — the stricter disposition
  // wins, which is the only safe way for the two to compose.
  this.omitInternalFields(object, rows);
}

/**
 * [#7728] Drop every field declared `internal: true` from the rows the engine
 * hands back — "the declared value is never returned on the generic data
 * path". This is the read protection for ADR-0100's third credential channel:
 * auth-subsystem one-way hashes stored in `text` columns, which the two
 * type-keyed credential collectors structurally cannot reach.
 *
 * **OMIT, not mask** (maintainer ruling 2026-08-12 on #7728). The credential
 * mask exists to signal "a value is set" without leaking it. The column this
 * was minted for — `sys_api_key.key` — is `required: true`, so it is ALWAYS
 * set: the signal carries zero bits, while still shipping a value under a
 * field whose own description says it is "never exposed to clients". Omission
 * also leaves that description string untouched, so the four generated
 * translation bundles that mirror it do not churn.
 *
 * **`?select=` is covered by construction, and that is load-bearing.** The
 * strip acts on the RESULT ROWS, not on the projection, so a client that
 * spells the column out (`?select=id,key`) gets a 200 without it rather than
 * a bypass. `select` only gates on whether a field is KNOWN
 * (`assertProjectionFieldsExist`) and a flagged column is known, so a
 * projection-aware strip would have shipped looking complete and still leaked
 * to any caller who named the column — measured on the sibling column in
 * #7823, and reproduced here on `sys_api_key.key` before the fix.
 *
 * **No system carve-out**, and this is where the shape deliberately diverges
 * from its sibling {@link stripSearchCompanionFromRead}. That one keeps the
 * `__search` companion for a system caller who names it by projection,
 * because it has exactly one such reader whose backfill comparison would
 * otherwise rewrite every row on every run. This flag has no such reader: the
 * API-key verifier uses the column as a `where` FILTER and never reads it off
 * the result (`resolveApiKeyPrincipal` takes `expires_at` / `user_id` /
 * `organization_id` / `scopes`), and the mint path returns the plaintext it
 * generated, not the row it inserted. An escape hatch nobody needs is a hole
 * in a non-exposure guarantee, so there isn't one — if a legitimate system
 * reader ever appears, it reads the column through a purpose-built privileged
 * accessor, the way {@link resolveSecret} does for `secret`.
 *
 * Nothing below storage is touched. The strip runs on rows the driver has
 * already produced, so the predicate has been evaluated and the index used
 * before this method sees anything — which is precisely why authentication
 * keeps working.
 *
 * **READ path only** (#7823, maintainer ruling 2026-08-13 / A-prime). This
 * used to run at the two write-response sites as well (the 201 create body
 * and the by-id-update 200 body), which conflated "never returned on the
 * generic data path" with "never returned to the engine-level caller that
 * performed the write" — and broke authentication for `sys_session.token`,
 * whose minted value better-auth reads back off the insert result. The
 * write-response half of the guarantee now lives at the generic-data-path
 * ingress (`omitInternalFieldsFromWriteResponse` in
 * `@objectstack/metadata-protocol`, tripwire-enforced across every `*Data`
 * write face); engine write results keep the stored row whole. Lifecycle
 * consumers that need a flagged value back off a READ go through
 * {@link resolveInternalField} — never a carve-out here.
 */
export function omitInternalFields(
  this: Pick<SecretInternalFieldsHost, '_registry'>,
  object: string,
  rows: any,
): void {
  if (!rows) return;
  const schema = this._registry.getObject(object);
  const internalFields = collectInternalReadFields(schema);
  if (internalFields.length === 0) return;
  const list = Array.isArray(rows) ? rows : [rows];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    for (const field of internalFields) delete row[field];
  }
}

/**
 * [#7642] Strip the hidden `__search` companion column from what a read
 * hands back, unless a SYSTEM caller named it in its projection.
 *
 * The column is declared client-invisible (`hidden` + `readonly` + `system`
 * + `searchable: false`) and the enforcement that exists is real: it is kept
 * out of auto-views, out of the `$search` auto-default, and a `$searchFields`
 * override naming it is refused with a 400 ("is hidden"). What was missing is
 * the PROJECTION half — a query that names no `fields` reaches the driver
 * with `ast.fields` undefined, every driver answers that with `SELECT *`, and
 * the companion rode back in every record body: list results, GET by id,
 * `/search` hits (which are `engine.find` rows verbatim) and the 201 create
 * body. The rule is applied HERE, at the engine, because the engine is the
 * PRODUCER those four surfaces share; fixing them one consumer at a time is
 * how three of the four would stay broken.
 *
 * Two carve-outs, both measured rather than defensive:
 *
 *  - **A system caller that asks for it by name keeps it.** The companion has
 *    exactly one such reader: `plugin-pinyin-search`'s backfill/reconcile
 *    walk, which projects `['id', ...sources, '__search']` under
 *    `{ isSystem: true }` and compares the stored blob against the recomputed
 *    one. Strip it unconditionally and that comparison reads `undefined`
 *    every pass — the backfill would rewrite every row of every object on
 *    every run, which is worse than the disclosure it was fixing.
 *  - **A non-system caller does NOT keep it, even by name.** `select` only
 *    gates on whether a field is KNOWN (`assertProjectionFieldsExist`), and
 *    the companion is known once provisioned — so `?select=__search` would
 *    otherwise be an open door straight through this strip, and a
 *    client-invisibility rule with a documented spelling that bypasses it is
 *    not one. `isSystem` is server-derived (never client input), the same
 *    trust the read-only strips on the write path already place in it.
 *
 * ## Why this door is SILENT where the `$searchFields` door returns a 400
 *
 * Asked on #7876 and ruled there on 2026-08-12 (direction C): the divergence
 * is intended, and it is not reopenable on symmetry alone. The two doors are
 * two KINDS of surface.
 *
 *  - `$searchFields` is AUTHORING input — it tells the server how to RUN the
 *    query. A value the server will not honour has to be said out loud, or
 *    the caller gets a WIDER answer than the one they narrowed to, in a
 *    response with nothing to distinguish it from a satisfied one. That is
 *    why `assertSearchFieldsAreSearchable` refuses the name with a 400
 *    (#4254) — the refusal is protecting the ROW SET.
 *  - `select` is a READ PROJECTION — it names what the caller would like
 *    back. Dropping a column the caller may not see leaves the answer
 *    correct: the rows are still the rows that were asked for, one key
 *    lighter. {@link omitInternalFields} directly above answers
 *    `?select=id,key` exactly this way, for exactly this reason (#7728), so
 *    silence here is the platform's existing read-path rule, not an
 *    exception to it.
 *
 * ⛔ Do not add a refusal here to make the two doors agree. That was option B
 * on #7876, weighed and declined: it turns a request that answers 200
 * today into a failure, for tidiness, on a spelling no non-system caller in
 * this tree uses — the companion's only deliberate reader is the backfill
 * carved out above. If a REAL caller is ever burned by the silent drop, that
 * measurement reopens it; the asymmetry by itself does not.
 *
 * ⚠️ `requestedFields` must be the CALLER's `fields`, captured before
 * `planFormulaProjection` — that pass rewrites the projection to every stored
 * column when a formula is in play, companion included.
 */
export function stripSearchCompanionFromRead(
  rows: unknown,
  requestedFields: readonly string[] | undefined,
  context: ExecutionContext | undefined,
): void {
  if (context?.isSystem && isSearchCompanionRequested(requestedFields)) return;
  stripSearchCompanion(rows);
}

/**
 * Driver options for a PRIVILEGED, driver-level read so it JOINS the open
 * ambient transaction instead of asking the pool for a second connection.
 *
 * The three privileged read verbs — {@link resolveSecret},
 * {@link resolveSecretField}, {@link resolveInternalField} — deliberately
 * read at DRIVER level, the only layer where the masked/omitted value still
 * exists. That bypasses hooks, field-level security and sharing by design;
 * what it must NOT bypass is the connection the surrounding transaction is
 * holding. {@link buildDriverOptions} threads the ambient handle onto every
 * ordinary read for that reason (ADR-0034); these three passed NO options at
 * all, so their read went to a FRESH pooled connection.
 *
 * On a roomy pool that is invisible — the pool simply hands out a second
 * connection. On a **single-connection pool it is a deadlock**: SQLite's knex
 * pool is `max: 1` (`driver-sqlite-wasm` and `driver-sql`/better-sqlite3
 * both), so the open transaction holds the one connection and the privileged
 * read waits for a connection that cannot be freed until the transaction
 * that is waiting on the read commits. Measured on the erasure path
 * (`runSubjectErasureAtomically` → better-auth `/admin/remove-user` →
 * `reattachInternalFieldsOnRead` → `resolveInternalField`): the read blocked
 * until knex's own acquire timeout fired ("Timeout acquiring a connection.
 * The pool is probably full", from `Transaction_Sqlite.acquireConnection`),
 * and the vendor route degraded that into an authentication refusal — a
 * signed-in caller answered `401` after ~120 s, on a route reachable without
 * credentials. Postgres/MySQL (`max >= 10`) never exhibited it.
 *
 * Reads only, and only the transaction: the same-origin gate (#5351) still
 * decides whether the handle is this object's driver's to use, so a
 * privileged read that resolves to a DIFFERENT datasource keeps its own
 * connection rather than executing on the wrong one. Returns `undefined`
 * when there is no ambient transaction, which is the pre-existing shape.
 */
export function privilegedReadDriverOptions(
  this: Pick<SecretInternalFieldsHost, 'txStore' | 'transactionCoversDriverFor'>,
  object: string,
): { transaction: unknown } | undefined {
  const tx = this.txStore.getStore()?.transaction;
  if (tx === undefined) return undefined;
  if (!this.transactionCoversDriverFor(object, tx)) return undefined;
  return { transaction: tx };
}

/** The body of `ObjectQL#resolveSecret`; the method's docblock there is its contract. */
export async function resolveSecret(
  this: Pick<SecretInternalFieldsHost, 'cryptoProvider' | 'getDriver' | 'privilegedReadDriverOptions'>,
  ref: unknown,
  opts?: { tenantId?: string },
): Promise<string | null> {
  const id = parseSecretRef(ref);
  if (!id) return null;
  if (!this.cryptoProvider) {
    throw new Error('Cannot resolve secret: no CryptoProvider is registered (fail-closed).');
  }
  const secretDriver = this.getDriver('sys_secret');
  const found = await secretDriver.find(
    'sys_secret',
    { where: { id } },
    this.privilegedReadDriverOptions('sys_secret'),
  );
  const secret: any = Array.isArray(found) ? found[0] : found;
  if (!secret) {
    throw new Error(`Cannot resolve secret: sys_secret row "${id}" not found (fail-closed).`);
  }
  const handle: CryptoHandle = {
    id: secret.id,
    kmsKeyId: secret.kms_key_id,
    alg: secret.alg,
    version: secret.version,
    ciphertext: secret.ciphertext,
  };
  // ADR-0128 D1: a `secret:` ref is the object-secret-field producer's
  // holder, so the scope is that producer's. A row another producer sealed
  // under a scoped derivation therefore does not open here.
  return this.cryptoProvider.decrypt(handle, {
    scope: 'object_secret_field',
    namespace: secret.namespace,
    key: secret.key,
    tenantId: opts?.tenantId,
  });
}

/** The body of `ObjectQL#resolveSecretField`; the method's docblock there is its contract. */
export async function resolveSecretField(
  this: Pick<SecretInternalFieldsHost, '_registry' | 'getDriver' | 'privilegedReadDriverOptions' | 'resolveSecret'>,
  object: string,
  recordId: string,
  field: string,
  opts?: { tenantId?: string },
): Promise<string | null> {
  const schema = this._registry.getObject(object);
  if (!collectSecretFields(schema).includes(field)) {
    throw new Error(
      `Cannot resolve secret field "${object}.${field}": it is not declared as type 'secret'. `
        + 'Only the encrypted secret channel is dereferenceable — a `password` field is stored as '
        + 'plaintext at rest and is masked deliberately (ADR-0100), so dereferencing one here '
        + 'would be a mask bypass, not a decrypt.',
    );
  }
  const driver = this.getDriver(object);
  let found: unknown;
  try {
    found = await driver.find(
      object,
      { where: { id: recordId } },
      this.privilegedReadDriverOptions(object),
    );
  } catch (e) {
    // [#21274] A boundary outside the middleware seam: the record id is bound.
    throw redactPropagatedDriverFault(e);
  }
  const row: any = Array.isArray(found) ? found[0] : found;
  if (!row) return null;
  return this.resolveSecret(row[field], opts);
}

/** The body of `ObjectQL#resolveInternalField`; the method's docblock there is its contract. */
export async function resolveInternalField(
  this: Pick<SecretInternalFieldsHost, '_registry' | 'getDriver' | 'privilegedReadDriverOptions'>,
  object: string,
  recordIds: readonly string[],
  field: string,
): Promise<Map<string, unknown>> {
  const schema = this._registry.getObject(object);
  if (!collectInternalReadFields(schema).includes(field)) {
    const err: Error & { code?: string; status?: number; httpStatus?: number; object?: string; field?: string } =
      new Error(
        `Cannot resolve internal field "${object}.${field}": it is not declared \`internal: true\`. `
          + 'Only fields the engine omits from the generic read path are dereferenceable here — '
          + 'anything else either comes back on find/findOne already, or is protected by its own '
          + 'channel (`secret` refs via resolveSecretField; `password` is masked deliberately, '
          + 'ADR-0100, so dereferencing one here would be a mask bypass).',
      );
    err.code = 'INVALID_FIELD';
    err.status = 400;
    err.httpStatus = 400;
    err.object = object;
    err.field = field;
    throw err;
  }
  const out = new Map<string, unknown>();
  if (recordIds.length === 0) return out;
  const driver = this.getDriver(object);
  let found: unknown;
  try {
    found = await driver.find(
      object,
      {
        where: { id: { $in: [...recordIds] } },
        fields: ['id', field],
      },
      this.privilegedReadDriverOptions(object),
    );
  } catch (e) {
    // [#21274] A boundary outside the middleware seam: the record ids are bound.
    throw redactPropagatedDriverFault(e);
  }
  for (const row of Array.isArray(found) ? found : [found]) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as Record<string, unknown>).id;
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    out.set(String(id), (row as Record<string, unknown>)[field] ?? null);
  }
  return out;
}
