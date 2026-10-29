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

/** The body of `ObjectQL#encryptSecretFields`; the method's docblock there is its contract. */
export async function encryptSecretFields(
  this: Pick<SecretInternalFieldsHost, '_registry' | 'cryptoProvider' | 'getDriver'>,
  object: string,
  row: Record<string, unknown>,
  context: ExecutionContext | undefined,
  driverOptions: unknown,
): Promise<PendingSecretRow[]> {
  const pending: PendingSecretRow[] = [];
  if (!row || typeof row !== 'object') return pending;
  const schema = this._registry.getObject(object);

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
    if (isSecretRef(value)) continue; // already encrypted ref

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

/** The body of `ObjectQL#persistSecretRows`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#releaseSecretHandles`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#refuseEmptyPasswordFields`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#maskSecretFields`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#omitInternalFields`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#stripSearchCompanionFromRead`; the method's docblock there is its contract. */
export function stripSearchCompanionFromRead(
  rows: unknown,
  requestedFields: readonly string[] | undefined,
  context: ExecutionContext | undefined,
): void {
  if (context?.isSystem && isSearchCompanionRequested(requestedFields)) return;
  stripSearchCompanion(rows);
}

/** The body of `ObjectQL#privilegedReadDriverOptions`; the method's docblock there is its contract. */
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
