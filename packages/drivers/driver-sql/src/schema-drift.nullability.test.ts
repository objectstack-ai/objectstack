// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0113 — nullability drift reads `storage.notNull`, not `required`.
 *
 * The full posture matrix, one test per cell that matters:
 *
 *   declaration                  column      verdict
 *   ─────────────────────────────────────────────────────────────
 *   storage.notNull: true        nullable    destructive tighten (backfill first)
 *   storage.notNull: true        NOT NULL    no drift
 *   required only (no storage)   NOT NULL    SILENT — every pre-17 source after
 *                                            a runtime upgrade; the write gate
 *                                            makes the constraint unreachable
 *   nothing declared             NOT NULL    needs_confirm — an omitting write
 *                                            dies as a raw driver error; ratify
 *                                            or relax, never auto-applied
 *   required only (no storage)   nullable    no drift — the ADR-0113 posture
 */

import { describe, it, expect } from 'vitest';
import { diffManagedTable } from './schema-drift';

const col = (name: string, nullable: boolean) => ({ name, type: 'varchar', nullable });

function nullabilityEntries(fields: Record<string, object>, nullable: boolean) {
  return diffManagedTable({
    table: 't',
    fields: fields as never,
    columns: Object.keys(fields).map((n) => col(n, nullable)),
    dialect: 'postgres',
  }).filter((d) => d.kind === 'nullability_mismatch');
}

describe('ADR-0113 nullability drift matrix', () => {
  it('storage.notNull over a nullable column is DESTRUCTIVE tighten drift', () => {
    const out = nullabilityEntries({ a: { type: 'text', required: true, storage: { notNull: true } } }, true);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('destructive');
    expect(out[0].op).toMatchObject({ type: 'tighten_not_null', column: 'a' });
    expect(out[0].message).toMatch(/storage\.notNull/);
  });

  it('storage.notNull matching a NOT NULL column is no drift', () => {
    const out = nullabilityEntries({ a: { type: 'text', required: true, storage: { notNull: true } } }, false);
    expect(out).toHaveLength(0);
  });

  it('required WITHOUT storage over a NOT NULL column is SILENT — the pre-17 legacy posture', () => {
    const out = nullabilityEntries({ a: { type: 'text', required: true } }, false);
    expect(out).toHaveLength(0);
  });

  it('an undeclared NOT NULL on a non-required field needs confirmation, never auto-applies', () => {
    const out = nullabilityEntries({ a: { type: 'text' } }, false);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('needs_confirm');
    expect(out[0].op).toMatchObject({ type: 'relax_not_null', column: 'a' });
    expect(out[0].message).toMatch(/os migrate meta|storage: \{ notNull: true \}/);
  });

  it('required without storage over a nullable column is the declared ADR-0113 posture — no drift', () => {
    const out = nullabilityEntries({ a: { type: 'text', required: true } }, true);
    expect(out).toHaveLength(0);
  });
});
