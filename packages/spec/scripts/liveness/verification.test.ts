// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for the `verifiedAt` re-verification clock (#3714 follow-up).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  DEFAULT_STALE_DAYS,
  buildVerificationReport,
  parseVerifiedAt,
  verificationAgeDays,
} from './verification.mts';

const here = dirname(fileURLToPath(import.meta.url));
const ledgerRoot = resolve(here, '../../liveness');
const NOW = new Date('2026-07-28T12:00:00Z');

describe('parseVerifiedAt', () => {
  it('accepts a strict YYYY-MM-DD date in the past', () => {
    const r = parseVerifiedAt('2026-07-28', NOW);
    expect(r.ok).toBe(true);
    expect(r.ok && r.date.toISOString()).toBe('2026-07-28T00:00:00.000Z');
  });

  it('rejects loose or non-string forms', () => {
    for (const bad of ['2026-07', '2026/07/28', '28-07-2026', '2026-07-28T00:00:00Z', '', 20260728, null, true]) {
      expect(parseVerifiedAt(bad as unknown, NOW).ok).toBe(false);
    }
  });

  it('rejects a calendar-invalid date instead of silently rolling it over', () => {
    // `new Date('2026-02-30')` yields March 2 rather than throwing.
    const r = parseVerifiedAt('2026-02-30', NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/not a real calendar date/);
  });

  it('rejects a FUTURE date — it would park the entry outside every window forever', () => {
    const r = parseVerifiedAt('2027-01-01', NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/in the future/);
  });
});

describe('verificationAgeDays', () => {
  it('counts whole days elapsed', () => {
    expect(verificationAgeDays(new Date('2026-07-28T00:00:00Z'), NOW)).toBe(0);
    expect(verificationAgeDays(new Date('2026-07-18T00:00:00Z'), NOW)).toBe(10);
  });

  it('never returns a negative age', () => {
    expect(verificationAgeDays(new Date('2026-08-28T00:00:00Z'), NOW)).toBe(0);
  });
});

describe('buildVerificationReport', () => {
  const entries = [
    { key: 'action/undoable', status: 'live', verifiedAt: '2026-07-28' }, // fresh
    { key: 'action/shortcut', status: 'dead', verifiedAt: '2025-01-01' }, // stale
    { key: 'flow/status', status: 'live', verifiedAt: '2024-06-01' }, // staler
    { key: 'field/type', status: 'live' }, // undated
    { key: 'tool/active', status: 'dead', verifiedAt: 'yesterday' }, // malformed
  ];

  it('sorts stale entries oldest-first and buckets the rest', () => {
    const r = buildVerificationReport(entries, { now: NOW, staleDays: 180 });
    expect(r.fresh).toBe(1);
    expect(r.stale.map((s) => s.key)).toEqual(['flow/status', 'action/shortcut']);
    expect(r.unverified).toEqual(['field/type']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/tool\/active/);
  });

  it('honours a custom threshold', () => {
    const r = buildVerificationReport(entries, { now: NOW, staleDays: 100_000 });
    expect(r.stale).toHaveLength(0);
    expect(r.fresh).toBe(3);
  });

  it('treats a malformed value as an ERROR, never as fresh', () => {
    // The whole point: a bad date must not silently buy an entry a clean bill
    // of health — that is the silent-no-op shape this ledger exists to catch.
    const r = buildVerificationReport([{ key: 'x/y', status: 'live', verifiedAt: '2099-13-45' }], { now: NOW });
    expect(r.fresh).toBe(0);
    expect(r.stale).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });

  it('defaults to DEFAULT_STALE_DAYS', () => {
    const justInside = new Date(NOW.getTime() - (DEFAULT_STALE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    const justOutside = new Date(NOW.getTime() - (DEFAULT_STALE_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
    const r = buildVerificationReport(
      [{ key: 'a/b', status: 'live', verifiedAt: justInside }, { key: 'c/d', status: 'live', verifiedAt: justOutside }],
      { now: NOW },
    );
    expect(r.fresh).toBe(1);
    expect(r.stale.map((s) => s.key)).toEqual(['c/d']);
  });
});

// Contract test against the REAL ledgers — the gate fails on a malformed
// `verifiedAt`, so a typo committed to a ledger must surface here too.
describe('shipped ledgers', () => {
  it('every `verifiedAt` in packages/spec/liveness/*.json parses', () => {
    const entries: Array<{ key: string; status: string; verifiedAt?: unknown }> = [];
    for (const type of ['action', 'field', 'flow', 'object', 'view', 'agent', 'tool', 'skill']) {
      const ledger = JSON.parse(readFileSync(join(ledgerRoot, `${type}.json`), 'utf8'));
      for (const [key, entry] of Object.entries<any>(ledger.props || {})) {
        if (entry?.verifiedAt !== undefined) entries.push({ key: `${type}/${key}`, status: entry.status, verifiedAt: entry.verifiedAt });
        for (const [ck, centry] of Object.entries<any>(entry?.children || {})) {
          if (centry?.verifiedAt !== undefined) entries.push({ key: `${type}/${key}.${ck}`, status: centry.status, verifiedAt: centry.verifiedAt });
        }
      }
    }
    expect(buildVerificationReport(entries).errors).toEqual([]);
  });
});
