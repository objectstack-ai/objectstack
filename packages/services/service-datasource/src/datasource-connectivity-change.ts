// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which fields of a stored datasource record bear on CONNECTIVITY — i.e. on
 * what `DatasourceConnectionService.attemptConnect` builds the live pool from
 * (#13804).
 *
 * ## Why this set, read from the tree rather than from the record
 *
 * The update path rebuilds a pool only when one of these changed. The set was
 * verified by working BACKWARDS from what `attemptConnect` actually reads into
 * the driver construction, not forwards from the record's field list:
 *
 *  - `driver` — read by the pool-support gate, the connect policy, and
 *    `toSpec` (the `factory.create` input).
 *  - `config` — read wholesale by `toSpec` (`config: record.config ?? {}`).
 *    No sub-key is excluded on that path: the entire block is an input to
 *    `factory.create`, so the whole block is compared here.
 *  - `external` — read by the connect policy, `toSpec`, and
 *    `registerDatasourceDef`; its `credentialsRef` sub-key drives the
 *    fail-closed secret resolution (ADR-0062 D3). Comparing the block deep
 *    therefore covers the ruled `credentialsRef` member too. A supplied
 *    cleartext secret is the one credential change this comparison CANNOT see
 *    (a rewrap-in-place keeps the ref string while changing what it
 *    dereferences to), which is why `updateDatasource` treats "a secret was
 *    supplied" as a connectivity change alongside this function's verdict.
 *  - `pool` — read by the pool-support gate and `toSpec`.
 *  - `schemaMode` — read by the connect policy gate (`canConnect`), by
 *    `toSpec` (so it reaches `factory.create` and the driver it builds), and
 *    by `registerDatasourceDef` (the write gate's def). It is patchable on
 *    the update path, so all three of those readings can go stale.
 *  - `active` — never read by `attemptConnect`, but it governs whether a pool
 *    may exist at all: `connectDeclared` skips `active === false` at boot and
 *    rehydration filters on `active ?? true`, so an update flipping it must
 *    tear down or build accordingly.
 *
 * `label` is read by nothing on the connect path — the reverse control: an
 * edit to it must not churn a working connection.
 *
 * How `schemaMode` joined the set — RESOLVED, not open. It was found during
 * this card's premise verification and reported as a fork rather than added
 * unilaterally (an implementer does not widen a ruled set on its own). The
 * contract review then ruled it IN, in the same stroke: it is really read at
 * the three sites listed above, so leaving it out would have left a narrower
 * instance of the very stale-pool defect this module exists to close — a
 * schemaMode-only edit persisting a new record while the engine's datasource
 * def, the driver, and the policy decision all kept the OLD value until
 * restart.
 *
 * Two candidates were examined and are deliberately NOT members: `ssl` is a
 * `toSpec` input but is not a field of `StoredDatasource` or
 * `DatasourceDraft`, so it cannot change through the update path at all; and
 * `autoConnect` is neither patchable by `updateDatasource` nor read by
 * `attemptConnect`.
 */

import type { StoredDatasource } from './datasource-admin-service.js';

/** The slice of a stored record this comparison consults. */
export type ConnectivityBearingFields = Pick<
  StoredDatasource,
  'driver' | 'config' | 'external' | 'pool' | 'schemaMode' | 'active'
>;

/**
 * Did an update change what the live pool was built from?
 *
 * Normalisations mirror the connect path, not JavaScript identity:
 *  - `config` compares `?? {}` because `toSpec` sends `record.config ?? {}`.
 *  - `active` compares `?? true` because that is the spec default and the
 *    boot-rehydration filter's reading.
 *  - Keys holding `undefined` count as absent (JSON semantics, and the merge
 *    in `updateDatasource` writes `credentialsRef: undefined` onto a record
 *    that never had the key — that round-trip is not a change).
 *  - `schemaMode` compares strictly, with no default applied: the connect
 *    path applies none either (`toSpec` omits the key when the record has no
 *    value; the policy gate and `registerDatasourceDef` receive it raw), so
 *    an absent value and a defaulted one are not the same reading here.
 */
export function datasourceConnectivityChanged(
  before: ConnectivityBearingFields,
  after: ConnectivityBearingFields,
): boolean {
  if (before.driver !== after.driver) return true;
  if (!deepEqual(before.config ?? {}, after.config ?? {})) return true;
  if (!deepEqual(before.external, after.external)) return true;
  if (!deepEqual(before.pool, after.pool)) return true;
  if (before.schemaMode !== after.schemaMode) return true;
  if ((before.active ?? true) !== (after.active ?? true)) return true;
  return false;
}

/** Keys whose value is not `undefined` — the JSON reading of "present". */
function presentKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => obj[k] !== undefined);
}

/**
 * Deep equality over JSON-shaped data (plain objects, arrays, primitives) —
 * the only shapes a persisted datasource record can hold, since every row
 * round-trips through `JSON.stringify` in the sys_metadata store.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = presentKeys(ao);
  const bk = presentKeys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}
