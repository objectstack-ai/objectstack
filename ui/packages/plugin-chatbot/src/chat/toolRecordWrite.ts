/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What the record-write tool card reads from a write result.
 */

/** A record-write card value as a person reads it: nothing, a list, or the value itself. */
export function formatRecordWriteValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map((v) => formatRecordWriteValue(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The record a confirmed write answered with — `{ status:'written', objectName,
 * recordId, label? }` from the dispatcher — so the card can link to it.
 */
export function writtenRecordOf(
  result: unknown,
): { objectName: string; recordId: string; label?: string } | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as Record<string, unknown>;
  if (r.status !== 'written') return undefined;
  const objectName = typeof r.objectName === 'string' ? r.objectName : '';
  const recordId = typeof r.recordId === 'string' ? r.recordId : '';
  if (!objectName || !recordId) return undefined;
  return { objectName, recordId, ...(typeof r.label === 'string' && r.label ? { label: r.label } : {}) };
}
