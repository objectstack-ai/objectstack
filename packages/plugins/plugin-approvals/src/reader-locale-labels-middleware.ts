// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { APPROVAL_REQUEST_OBJECT, type MiddlewareEngine } from './payload-redaction-middleware.js';
import {
  localizeRequestLabels,
  readerLabelsFor,
  type LocalizableRequestRow,
  type ReaderLabelI18n,
  type ReaderLabels,
} from './reader-locale-labels.js';

/**
 * [#27041] A request's flow and step labels in the READER's language on the
 * GENERIC data door, by the one lookup the approvals door applies.
 *
 * ## What was wrong
 *
 * The approvals door (`listRequests`, `getRequest`) serves `process_label` and
 * `current_step_label` in the reader's language since #24863
 * (`reader-locale-labels.ts`). `sys_approval_request` is also read straight
 * through the generic data path (`enable.apiMethods: ['get', 'list']`): Setup's
 * request list (view `all_requests`), the request's record page, a lookup's
 * title, the export. That path never touches the service, so a zh-CN reader
 * saw the authoring language there while the inbox showed the same rows
 * translated.
 *
 * ## The seam
 *
 * Engine middleware on `sys_approval_request`, beside the snapshot redaction
 * (`payload-redaction-middleware.ts`) and for its reason: one registration at
 * the engine covers the whole generic-read family (the REST data routes,
 * ObjectQL callers, the CSV/XLSX export, the MCP data tool, the AI-context
 * interceptor), and a middleware carries `opCtx.context`, the door's real
 * `ExecutionContext`, whose `locale` is the one the approvals door reads (the
 * request's `Accept-Language`, else the `localization` settings).
 *
 * ⛔ Nothing here is a second lookup. The labels come from
 * {@link readerLabelsFor} and are placed by {@link localizeRequestLabels},
 * the approvals door's own pair, so both doors pick the same text by the same
 * keys, negotiate the locale by the same rule and fall back to the stored text
 * on the same misses.
 *
 * ## What it overlays, and what it borrows
 *
 * Only the label columns the read already carries: `process_label` and
 * `current_step_label`. The approvals door's served aliases (`step_label`,
 * `object_label`) are not columns, and this door does not add them.
 *
 * Each label's key is spelled from machine columns, `process_name` for the
 * flow and `current_step` for the step. A list projects only its columns
 * (`all_requests` selects the labels and not the machine values), so when a
 * read selects a label without its key column, the key column is borrowed into
 * the projection for the read and taken off every row before the rows go back:
 * the caller is served exactly the columns it asked for.
 *
 * ## What stays
 *
 * Storage is untouched: the overlay happens on the result rows after the
 * driver answered, and the stored `process_label` / `current_step_label` stay
 * the authored snapshot. A system read (the approval engine's own reads, the
 * boot fills) is passed through as stored, so nothing the platform reads back
 * and writes again ever carries a reader's language. A read with no locale, no
 * `i18n` service, or no pack entry for a key serves the stored text.
 */

/** The label columns this read overlays, and the machine columns each one's key is spelled from. */
const LABEL_KEY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  process_label: ['process_name'],
  current_step_label: ['process_name', 'current_step'],
};

/**
 * Add to `ast.fields` the key columns a projected label needs and the
 * projection lacks, in place; answer the columns added. A read with no
 * projection is served every column, so it borrows nothing.
 */
export function borrowLabelKeyColumns(ast: { fields?: unknown } | undefined): string[] {
  const fields = ast?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return [];
  const borrowed: string[] = [];
  for (const [label, keys] of Object.entries(LABEL_KEY_COLUMNS)) {
    if (!fields.includes(label)) continue;
    for (const key of keys) {
      if (!fields.includes(key) && !borrowed.includes(key)) borrowed.push(key);
    }
  }
  if (borrowed.length > 0) ast!.fields = [...fields, ...borrowed];
  return borrowed;
}

/**
 * Overlay the label columns `row` carries with the ones `labels` picks, then
 * take the `borrowed` key columns off it, in place.
 */
export function localizeStoredRequestLabels(
  row: Record<string, unknown>,
  labels: ReaderLabels,
  borrowed: readonly string[],
): void {
  const view: LocalizableRequestRow = {
    process_name: typeof row.process_name === 'string' ? row.process_name : undefined,
    current_step: typeof row.current_step === 'string' ? row.current_step : undefined,
  };
  localizeRequestLabels(view, labels);
  for (const column of Object.keys(LABEL_KEY_COLUMNS) as Array<keyof LocalizableRequestRow>) {
    if (column in row && view[column] !== undefined) row[column] = view[column];
  }
  for (const column of borrowed) delete row[column];
}

/**
 * Register the generic-door seam. `getI18n` is resolved on each read because
 * the `i18n` service is contributed by another plugin and may start after this
 * one.
 */
export function bindReaderLocaleLabelsMiddleware(
  engine: MiddlewareEngine,
  getI18n: () => ReaderLabelI18n | undefined,
  logger?: { warn?: (msg: string, meta?: Record<string, any>) => void },
): void {
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    if (opCtx?.operation !== 'find' && opCtx?.operation !== 'findOne') return next();
    const context = opCtx?.context;
    if (context?.isSystem) return next();
    let labels: ReaderLabels | undefined;
    try {
      labels = readerLabelsFor(getI18n(), context?.locale);
    } catch {
      // The i18n service is optional and late-bound: the stored labels stand.
      labels = undefined;
    }
    if (!labels) return next();
    const borrowed = borrowLabelKeyColumns(opCtx.ast);
    await next();
    const result = opCtx.result;
    const rows: unknown[] = Array.isArray(result) ? result : result ? [result] : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      try {
        localizeStoredRequestLabels(row as Record<string, unknown>, labels, borrowed);
      } catch (err: any) {
        logger?.warn?.('[approvals] reader-locale label middleware failed', {
          error: err?.message ?? String(err),
        });
        for (const column of borrowed) delete (row as Record<string, unknown>)[column];
      }
    }
  }, { object: APPROVAL_REQUEST_OBJECT });
}
