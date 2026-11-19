// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A field the caller may not write keeps its stored value, whatever its type —
 * a `secret` field included. These helpers let the update door's read-only
 * strips judge a `secret` field's caller value by who wrote it, across the
 * credential pass that seals it.
 *
 * The credential pass (`encryptSecretFields`) runs on the post-hook payload
 * ahead of both read-only strips (the static `readonly` strip and the
 * `readonlyWhen` strip), and it puts the reference to the row it seals on the
 * payload in place of the value. Both strips decide "the caller wrote this
 * key" by the key still holding the value the caller sent (the entry snapshot,
 * `suppliedValues`). So authorship of a `secret` key is read once, before the
 * pass ({@link secretKeysHoldingCallerValues}), and the strips are handed a
 * view of the submission in which each such key holds the reference that now
 * stands for the caller's value ({@link suppliedOverSealedSecrets}).
 *
 * What the view does not change:
 *  - it is read by the strips (and the views they build) only; a hook still
 *    reads `ctx.submitted`, the entry snapshot itself;
 *  - an unlocked `secret` is sealed and stored as a reference, as before;
 *  - a value a hook wrote on a `secret` key stays the hook's: the view moves a
 *    key only where the payload still held the caller's own value when the
 *    pass began.
 *
 * The other half is {@link sealedSecretsNamedBy}: a key a strip takes back
 * out takes its sealed `sys_secret` row with it, so a credential row is
 * written only where the payload handed to the statement names it.
 */

import { collectSecretFields, makeSecretRef } from './secret-fields.js';
import type { PendingSecretRow } from './engine-secret-internal-fields.js';

type Payload = Record<string, unknown> | null | undefined;

/**
 * The `secret` keys on `payload` that still hold the caller's own value — read
 * immediately BEFORE the credential pass rewrites them. The same two-part test
 * the read-only strips apply (own property of the submission, `Object.is` on
 * the value), so the answer is theirs, taken at the last point it can be read.
 */
export function secretKeysHoldingCallerValues(
  schema: Parameters<typeof collectSecretFields>[0],
  payload: Payload,
  supplied: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  const held = new Set<string>();
  if (!payload || typeof payload !== 'object') return held;
  for (const field of collectSecretFields(schema)) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
    if (!Object.prototype.hasOwnProperty.call(supplied, field)) continue;
    if (Object.is(payload[field], supplied[field])) held.add(field);
  }
  return held;
}

/**
 * The submission as the read-only strips judge it after the credential pass:
 * `supplied` itself when the pass sealed no key the caller held, else a copy
 * in which each such key holds the reference the pass put on the payload. A
 * key is moved only when the payload still names the row sealed for it.
 */
export function suppliedOverSealedSecrets(
  supplied: Readonly<Record<string, unknown>>,
  callerHeld: ReadonlySet<string>,
  payload: Payload,
  sealed: readonly PendingSecretRow[],
): Readonly<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object' || callerHeld.size === 0 || sealed.length === 0) return supplied;
  let view: Record<string, unknown> | undefined;
  for (const one of sealed) {
    if (!callerHeld.has(one.field)) continue;
    const ref = makeSecretRef(one.handleId);
    if (payload[one.field] !== ref) continue;
    view ??= { ...supplied };
    view[one.field] = ref;
  }
  return view ?? supplied;
}

/**
 * The sealed rows the payload handed to the statement still names — each
 * row's column holds exactly that row's reference. A row whose key a strip
 * took back out names nothing and is not written.
 */
export function sealedSecretsNamedBy(
  sealed: readonly PendingSecretRow[],
  payload: Payload,
): PendingSecretRow[] {
  if (!payload || typeof payload !== 'object') return [];
  return sealed.filter((one) => payload[one.field] === makeSecretRef(one.handleId));
}
