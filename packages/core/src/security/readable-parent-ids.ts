// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { withoutOperationPrivateKeys } from './operation-private-keys.js';

/**
 * The one engine read {@link resolveReadableParentIds} needs: a caller-scoped
 * `find`. Structural, so every package's engine facade satisfies it without a
 * dependency on the engine package.
 */
export interface ReadableParentIdsEngine {
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
}

/**
 * Which of these parent records can the CALLER read? Answered per parent
 * object by ONE caller-scoped engine read of the candidate ids, so the parent
 * object's own OWD/sharing, RLS and object-level CRUD decide.
 *
 * This is the one answer every parent-derived read gate asks: the comment
 * thread and activity / ledger gates (`@objectstack/plugin-audit`), the
 * attachment gate and its write door's not-visible check
 * (`@objectstack/service-storage`), and the mail association and message gates
 * (`@objectstack/service-mailbox`). One evaluator, so a record can never be
 * readable under one gate and unreadable under another — ⛔ do not hand-copy
 * this probe into a gate, import it.
 *
 * Batched: one read per parent OBJECT, never one per row. An object whose read
 * throws (unknown to the engine, refused, driver fault) contributes no visible
 * id — fail closed — and a record that no longer exists is simply not found.
 *
 * The caller's envelope, minus the operation-private keys
 * ({@link withoutOperationPrivateKeys}): this probe reads a DIFFERENT object
 * than the one the middleware resolved its depth for, and `__readScope` /
 * `__expandRead` are widening inputs that would arrive attached to the wrong
 * question (the security middleware re-stamps the depth for THIS object when
 * it resolves any set, so the only thing dropping them can do is leave the
 * owner-match at its narrowest — the safe direction).
 */
export async function resolveReadableParentIds(
  engine: ReadableParentIdsEngine,
  callerContext: Record<string, unknown> | undefined,
  idsByObject: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<Map<string, Set<string>>> {
  const callerEnvelope = withoutOperationPrivateKeys((callerContext ?? {}) as Record<string, unknown>);
  const visibleByObject = new Map<string, Set<string>>();
  for (const [parentObject, idSet] of idsByObject) {
    const ids = [...idSet];
    let visible: string[] = [];
    try {
      const rows = await engine.find(parentObject, {
        where: { id: { $in: ids } },
        fields: ['id'],
        limit: ids.length,
        context: { ...callerEnvelope },
      });
      visible = rows.map((r) => String(r.id)).filter(Boolean);
    } catch {
      // Unknown/failing parent object → none visible (fail closed).
      visible = [];
    }
    visibleByObject.set(parentObject, new Set(visible));
  }
  return visibleByObject;
}
