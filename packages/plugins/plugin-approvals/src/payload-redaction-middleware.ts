// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  redactSnapshot,
  resolveReadableSnapshotFields,
  type FieldVisibilitySource,
} from './payload-redaction.js';

/**
 * [#10749] Read-time snapshot redaction on the GENERIC data door.
 *
 * ## Why a second seam exists at all
 *
 * `ApprovalService.getRequest` / `listRequests` are not the only way to read
 * `sys_approval_request`. The object declares `enable.apiMethods: ['get',
 * 'list']`, so a caller reaches the very same row — and the very same
 * `payload_json` string — straight through the generic data path, which never
 * touches the service and therefore never touches the service's redaction.
 *
 * That generic path is not one door but a family of them, all sharing a single
 * PRODUCER: `find` / `findOne` on the engine. Registering here, at the engine,
 * covers the whole family at once — the REST data routes, ObjectQL callers, the
 * CSV/XLSX export route (a read-derived projection), the MCP data tool and the
 * AI-context interceptor. Fixing them one consumer at a time is how most of
 * them would stay open, and a seam that covers the service door while leaving
 * this one manufactures the belief that the path is masked.
 *
 * ## Why middleware rather than an `afterFind` hook
 *
 * A hook receives `hookContext.session`, which `Engine.buildSession` builds
 * WITHOUT `onBehalfOf`. `getReadableFields` intersects the delegator's field
 * mask on an on-behalf-of read (ADR-0090 D10, fail-closed on a dangling
 * delegator), so a hook-based seam would silently drop that intersection and
 * answer a delegated read more permissively than the service door does.
 * Middleware carries `opCtx.context` — the real `ExecutionContext` — so both
 * doors narrow identically.
 *
 * ## The at-rest guarantee
 *
 * This rewrites `payload_json` only on the RESULT ROWS handed back from a read,
 * after the driver has answered. Storage is untouched: the full snapshot stays
 * in the column as the approval record's audit evidence of what was actually
 * submitted, which is the half of the maintainer's ruling that write-time
 * trimming would have given away.
 */

/** The engine surface this seam needs. */
export interface MiddlewareEngine {
  registerMiddleware(
    fn: (opCtx: any, next: () => Promise<void>) => Promise<void> | void,
    options?: { object?: string },
  ): void;
}

export const APPROVAL_REQUEST_OBJECT = 'sys_approval_request';

/** Parse a stored snapshot string; non-JSON is left alone. */
function parseSnapshot(raw: unknown): { ok: boolean; value: unknown } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/**
 * Redact `payload_json` on rows a generic read is about to hand back.
 *
 * Exported for direct testing: the middleware body is this function plus the
 * registration, so a test can pin the narrowing without standing up an engine.
 */
export async function redactRowsInPlace(
  rows: unknown,
  security: FieldVisibilitySource | undefined,
  context: unknown,
  logger?: { warn?: (msg: string, meta?: Record<string, any>) => void },
): Promise<void> {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  if (list.length === 0) return;
  // One readable-field resolution per subject object, not per row.
  const cache = new Map<string, string[] | undefined>();
  for (const row of list as any[]) {
    if (!row || typeof row !== 'object') continue;
    const raw = row.payload_json;
    const parsed = parseSnapshot(raw);
    if (!parsed.ok) continue;
    const object = String(row.object_name ?? '').trim();
    if (!object) continue;
    if (!cache.has(object)) {
      cache.set(object, await resolveReadableSnapshotFields(security, object, context, logger));
    }
    const readable = cache.get(object);
    if (readable === undefined) continue;
    const { payload, redactedKeys } = redactSnapshot(parsed.value, readable);
    if (redactedKeys.length === 0) continue;
    row.payload_json = JSON.stringify(payload);
  }
}

/**
 * Register the generic-door seam. `getSecurity` is resolved lazily on each
 * read because the security plugin may register after this one.
 */
export function bindSnapshotRedactionMiddleware(
  engine: MiddlewareEngine,
  getSecurity: () => FieldVisibilitySource | undefined,
  logger?: { warn?: (msg: string, meta?: Record<string, any>) => void },
): void {
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    await next();
    if (opCtx?.operation !== 'find' && opCtx?.operation !== 'findOne') return;
    // A system read is the audit/replay channel — it gets the whole snapshot,
    // mirroring the `isSystem` skip every other field-visibility gate takes.
    if ((opCtx?.context as any)?.isSystem) return;
    try {
      await redactRowsInPlace(opCtx.result, getSecurity(), opCtx.context, logger);
    } catch (err: any) {
      logger?.warn?.('[approvals] snapshot redaction middleware failed', {
        error: err?.message ?? String(err),
      });
    }
  }, { object: APPROVAL_REQUEST_OBJECT });
}
