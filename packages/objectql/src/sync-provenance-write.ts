// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D4] "Nothing writes the `_sync_` columns except the pull. … A
 * `_sync_` column in any write except the pull's is refused by name, whatever
 * the caller's context."
 *
 * The five provenance columns (`SYNC_PROVENANCE_COLUMNS`,
 * `@objectstack/spec/data`) are injected on a `managedBy: 'synced'` object.
 * A member cannot write such an object at all (the engine write guard refuses
 * every generic write on the bucket), but a system-context write can: a
 * declared action's body runs as the system and may write a synced row's
 * mapped fields (ADR-0153 D4). `readonly: true` does not stop it, because the
 * static `readonly` strip exempts `isSystem`. So the engine judges the
 * caller's payload by NAME, before anything else runs: a key starting
 * `_sync_` is refused unless the write carries the pull's mark.
 *
 * ## The mark, and why it reaches exactly one write
 *
 * {@link SYNC_PULL_WRITE} is a symbol key on the write's CONTEXT. The pull
 * writes through the import runner and the protocol's data door, which hand
 * the context down by spreading it, so a context key is the one carrier that
 * reaches the engine (an engine option does not cross the protocol). A symbol,
 * so no context a door builds from a request can carry it (JSON has no
 * symbols); `Symbol.for`, so every bundle of this package names one key, the
 * shape `SUMMARY_RECOMPUTE_WRITE` takes for the same reason.
 *
 * A context key would otherwise travel on: a hook's `ctx.api` write carries
 * the context it was handed. {@link refuseSyncProvenanceWrite} therefore
 * CONSUMES the mark — the engine continues with a copy of the context without
 * it — so a hook or flow the pull's write triggers writes as any other system
 * caller, and is refused like one.
 *
 * ## The hooks' own writes
 *
 * The caller's payload is judged before anything runs; the `before*` hooks run
 * after, as server code, and may assign to the write's data. A `_sync_` key a
 * hook assigns, changes or removes is refused too, the pull's write included
 * (there a hook would overwrite the stamps D3 marks by): the engine snapshots
 * the write's `_sync_` keys before the hooks ({@link snapshotSyncKeys}) and
 * compares after them ({@link refuseHookSyncProvenanceWrite}), so the pull's
 * stamps reach the driver exactly as the pull wrote them, and no other write
 * carries one at all.
 */

import { SYNC_PROVENANCE_PREFIX } from '@objectstack/spec/data';

/** The pull's mark on its write context (see the module header). */
export const SYNC_PULL_WRITE: unique symbol = Symbol.for('objectstack.objectql.syncPullWrite');

/**
 * The context the sync-in pull writes with: `context` plus {@link SYNC_PULL_WRITE}.
 * Only the pull calls it (`@objectstack/service-automation`).
 */
export function markSyncPullWrite<C extends object>(context: C): C & { [SYNC_PULL_WRITE]: true } {
  return { ...context, [SYNC_PULL_WRITE]: true as const };
}

/**
 * The code a write naming a `_sync_` column without the pull's mark is refused
 * with. Registered in `ERROR_CODE_LEDGER` under `@objectstack/objectql`.
 */
export const SYNC_PROVENANCE_WRITE_REFUSED_CODE = 'ERR_SYNC_PROVENANCE_WRITE_REFUSED' as const;

/**
 * A write named a `_sync_` provenance column and is not the pull's, or a
 * `before*` hook of a write assigned, changed or removed one (`by: 'hook'`).
 * Nothing was written: the caller's payload is refused before the middleware,
 * the defaults and the hooks, a hook's write before the driver. 400, since the
 * payload itself is what is refused, whoever sent it.
 *
 * Identified by `code` rather than `instanceof`, the convention every engine
 * error here follows.
 */
export class SyncProvenanceWriteRefusedError extends Error {
  readonly code = SYNC_PROVENANCE_WRITE_REFUSED_CODE;
  readonly status = 400;
  /** The same number under ADR-0112 D5's spelling. */
  readonly httpStatus = 400;

  constructor(
    public readonly object: string,
    public readonly fields: string[],
    public readonly operation: 'insert' | 'update',
    /** Who named the columns: the caller's payload, or a `before*` hook of the write. */
    public readonly by: 'caller' | 'hook' = 'caller',
  ) {
    super(
      `Cannot ${operation} '${object}': ${by === 'hook' ? `a before${operation === 'insert' ? 'Insert' : 'Update'} hook wrote ` : ''}`
      + `${fields.map((f) => `'${f}'`).join(', ')}, ${fields.length === 1 ? 'a ' : ''}`
      + `sync-in provenance column${fields.length === 1 ? '' : 's'}, which only the sync-in pull writes (ADR-0153 D4), `
      + 'whatever the caller\'s context. Leave the _sync_ columns out of the write'
      + (by === 'hook' ? ' and out of the hook' : '') + ': the next pull of the mapping stamps them.',
    );
    this.name = 'SyncProvenanceWriteRefusedError';
  }
}

/** The `_sync_` keys a payload (one row or several) carries, in first-seen order. */
function syncKeysOf(data: unknown): string[] {
  const rows = Array.isArray(data) ? data : [data];
  const found: string[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (key.startsWith(SYNC_PROVENANCE_PREFIX) && !found.includes(key)) found.push(key);
    }
  }
  return found;
}

/**
 * Judge one write's caller payload and consume the pull's mark.
 *
 * Throws {@link SyncProvenanceWriteRefusedError} when the payload names a
 * `_sync_` key and the context carries no {@link SYNC_PULL_WRITE}. Otherwise
 * returns the context the engine continues with: the same reference when no
 * mark was present, a copy without the mark when one was.
 */
export function refuseSyncProvenanceWrite<C>(
  object: string,
  data: unknown,
  context: C,
  operation: 'insert' | 'update',
): C {
  const marked = context !== null && typeof context === 'object'
    && (context as Record<PropertyKey, unknown>)[SYNC_PULL_WRITE] === true;
  if (!marked) {
    const keys = syncKeysOf(data);
    if (keys.length > 0) throw new SyncProvenanceWriteRefusedError(object, keys, operation);
    return context;
  }
  const { [SYNC_PULL_WRITE]: _consumed, ...rest } = context as Record<PropertyKey, unknown>;
  return rest as C;
}

/**
 * The write's `_sync_` keys and values before the `before*` hooks run, per row.
 * A non-object row has none.
 */
export function snapshotSyncKeys(row: unknown): ReadonlyMap<string, unknown> {
  const snap = new Map<string, unknown>();
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return snap;
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(SYNC_PROVENANCE_PREFIX)) snap.set(key, value);
  }
  return snap;
}

/**
 * Judge what the `before*` hooks did to one row's `_sync_` keys: any key they
 * assigned, changed or removed relative to {@link snapshotSyncKeys} is refused
 * with {@link SyncProvenanceWriteRefusedError} (`by: 'hook'`). On a write the
 * caller judged clean the snapshot is empty, so any `_sync_` key is a hook's;
 * on the pull's write it holds the pull's stamps, which must reach the driver
 * as written.
 *
 * The comparison is by identity (`Object.is`), so a hook that replaced the
 * payload with a deep copy would be refused if a stamp were held as an object
 * such as a `Date`; the pull hands every stamp in as a string, and the error
 * errs toward refusing, so nothing is stored wrongly.
 */
export function refuseHookSyncProvenanceWrite(
  object: string,
  before: ReadonlyMap<string, unknown>,
  after: unknown,
  operation: 'insert' | 'update',
): void {
  const now = snapshotSyncKeys(after);
  const touched: string[] = [];
  for (const [key, value] of now) {
    if (!before.has(key) || !Object.is(before.get(key), value)) touched.push(key);
  }
  for (const key of before.keys()) {
    if (!now.has(key)) touched.push(key);
  }
  if (touched.length > 0) throw new SyncProvenanceWriteRefusedError(object, touched, operation, 'hook');
}
