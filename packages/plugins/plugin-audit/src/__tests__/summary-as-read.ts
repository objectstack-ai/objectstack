// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26167] A stored `sys_activity` row's `summary` as a reader in `locale` is
 * served it, for suites that write through the audit writer and read the row
 * straight from their store (no engine read, so no middleware ran). It applies
 * the read side's own overlay (`localizeActivityRow`) to a copy of the row, so
 * what it answers is what `installActivitySummaryLocale` serves that reader.
 */

import {
  localizeActivityRow,
  readerSummaryLocale,
  type ActivitySummaryI18n,
} from '../activity-summary-message.js';

/** The engine slice a summary's labels are read from. */
interface DefinitionSource {
  getSchema?(objectName: string): unknown;
}

export function summaryAsRead(
  row: Record<string, unknown> | undefined,
  i18n: unknown,
  locale: string | undefined,
  engine: DefinitionSource,
): unknown {
  if (!row) return undefined;
  const copy: Record<string, unknown> = { ...row };
  const reader = readerSummaryLocale(i18n as ActivitySummaryI18n | undefined, locale, (objectName) =>
    typeof engine.getSchema === 'function' ? engine.getSchema(objectName) : null,
  );
  localizeActivityRow(copy, reader, false);
  return copy.summary;
}
