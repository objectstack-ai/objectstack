// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { MiddlewareEngine } from './payload-redaction-middleware.js';
import { readerLabelsFor, type ReaderLabelI18n } from './reader-locale-labels.js';

/**
 * [#37531] An approval action row's step label and system note in the
 * READER's language on the GENERIC data door, by the render the approvals
 * door's timeline applies.
 *
 * `sys_approval_action` is read straight through the generic data path:
 * Setup's Approval Actions list (views `recent`, `by_actor`, `all_actions`),
 * the action's record page, a lookup's title, the export. Engine middleware
 * on the object covers that whole family for the reason
 * `reader-locale-labels-middleware.ts` gives for the request's labels, beside
 * it: one registration at the engine, and `opCtx.context` carries the door's
 * real `ExecutionContext`, whose `locale` is the one both doors read.
 *
 * ⛔ Nothing here renders. The rows go to `localize`, which is
 * `ApprovalService.localizeActionRows`, the function the approvals door's
 * timeline is served by, so both doors pick the same text by the same keys and
 * fall back to the stored text on the same misses.
 *
 * ## What it overlays, and what it borrows
 *
 * Only the columns the read already carries: `step_label` and `comment`. A
 * list projects only its columns, so when a read selects one of them without
 * the columns its text is picked by (`request_id` and `step_name` for the
 * step label; `id`, `request_id`, `action` and `actor_id` for a note), those
 * are borrowed into the projection for the read and taken off every row
 * before the rows go back: the caller is served exactly the columns it asked
 * for.
 *
 * ## What stays
 *
 * Storage is untouched: the stored `step_label` stays the authored snapshot
 * and the stored `comment` the English. A system read (the engine's own reads,
 * the boot fills) is passed through as stored, and so is a read with no
 * locale, no `i18n` service, or no pack entry.
 */

/** The overlaid columns, and the columns each one's text is picked by. */
const TEXT_KEY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  step_label: ['request_id', 'step_name'],
  comment: ['id', 'request_id', 'action', 'actor_id'],
};

/**
 * Add to `ast.fields` the columns a projected text needs and the projection
 * lacks, in place; answer the columns added. A read with no projection is
 * served every column, so it borrows nothing.
 */
export function borrowActionTextColumns(ast: { fields?: unknown } | undefined): string[] {
  const fields = ast?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return [];
  const borrowed: string[] = [];
  for (const [text, keys] of Object.entries(TEXT_KEY_COLUMNS)) {
    if (!fields.includes(text)) continue;
    for (const key of keys) {
      if (!fields.includes(key) && !borrowed.includes(key)) borrowed.push(key);
    }
  }
  if (borrowed.length > 0) ast!.fields = [...fields, ...borrowed];
  return borrowed;
}

/** Renders the rows' texts in the reader's language, in place: `ApprovalService.localizeActionRows`. */
export type ActionRowLocalizer = (rows: Array<Record<string, unknown>>, context: ExecutionContext) => Promise<void>;

/**
 * Register the generic-door seam. `getI18n` is resolved on each read because
 * the `i18n` service is contributed by another plugin and may start after this
 * one; it only decides whether the read can pick anything at all.
 */
export function bindActionLocaleMiddleware(
  engine: MiddlewareEngine,
  getI18n: () => ReaderLabelI18n | undefined,
  localize: ActionRowLocalizer,
  logger?: { warn?: (msg: string, meta?: Record<string, any>) => void },
): void {
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    if (opCtx?.operation !== 'find' && opCtx?.operation !== 'findOne') return next();
    const context = opCtx?.context;
    if (!context || context.isSystem) return next();
    let picks = false;
    try {
      picks = readerLabelsFor(getI18n(), context.locale) !== undefined;
    } catch {
      // The i18n service is optional and late-bound: the stored text stands.
      picks = false;
    }
    if (!picks) return next();
    const borrowed = borrowActionTextColumns(opCtx.ast);
    await next();
    const result = opCtx.result;
    const rows = (Array.isArray(result) ? result : result ? [result] : [])
      .filter((row: unknown): row is Record<string, unknown> => !!row && typeof row === 'object');
    try {
      await localize(rows, context);
    } catch (err: any) {
      logger?.warn?.('[approvals] action locale middleware failed — the stored text is served', {
        error: err?.message ?? String(err),
      });
    }
    for (const row of rows) for (const column of borrowed) delete row[column];
  }, { object: 'sys_approval_action' });
}
