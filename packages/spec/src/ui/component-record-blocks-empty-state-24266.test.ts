// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24266] The three BOUND record blocks — `record:details`,
 * `record:highlights` and `record:quick_actions`, the set that reads its one
 * binding as the node-level `dataSource` — declare an authored `emptyState`,
 * drawn only when that binding answers no row (the spec half of
 * objectstack-ai/objectui#12932).
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE KEY PARSES on each block: a full `emptyState` and a one-member one,
 *   the whole document green (a key-only check would stay green over a
 *   declaration that refused every value). A block WITHOUT `emptyState` still
 *   parses and gains no default — absent stays absent.
 * - §2 THE ROWS ARE STILL CLOSED: an unknown inner key and a re-spelled one
 *   are refused at `emptyState`'s own path, and an unknown top-level key is
 *   still refused at the row — the control that proves the widening did not
 *   open it. A record block that does not bind this way (`record:related_list`)
 *   still refuses the key: the per-type door.
 * - §3 ONE SCHEMA: each member unwraps to `EmptyStateSchema` itself, the def
 *   `object-grid.emptyState` holds (#20694) — never a re-spelled shape.
 * - §4 THE MARKER: each describe opens with `[PLANNED — not yet rendered]`,
 *   the one part of the prose a consumer parses (`check-liveness.mts`
 *   `MARKER_RE.planned` reads it as the key's liveness status).
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import {
  ComponentPropsMap,
  ObjectGridPropsSchema,
  RecordDetailsProps,
  RecordHighlightsProps,
  RecordQuickActionsProps,
} from './component.zod';
import { EmptyStateSchema } from './view.zod';

type Door = { safeParse: (v: unknown) => z.ZodSafeParseResult<unknown> };
type Member = { unwrap: () => { _zod: { def: unknown } }; description?: string };

/** Each bound block, with the smallest props document that is legal on its own. */
const BOUND = [
  ['record:details', RecordDetailsProps, {}],
  ['record:highlights', RecordHighlightsProps, { fields: ['status'] }],
  ['record:quick_actions', RecordQuickActionsProps, { actionNames: ['approve'] }],
] as const;

const door = (type: string): Door => ComponentPropsMap[type as keyof typeof ComponentPropsMap] as unknown as Door;
const member = (schema: unknown): Member =>
  (schema as { shape: Record<string, Member> }).shape.emptyState;

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

const FULL = { title: 'No production environment', message: 'Create one to see it here', icon: 'server' };

// ───────────────────────────────────────────────────────────────────────────
// §1 the key parses
// ───────────────────────────────────────────────────────────────────────────

describe('§1 each bound record block accepts an authored emptyState', () => {
  for (const [type, , base] of BOUND) {
    it(`${type}: the base document parses on its own — the positive control`, () => {
      const r = door(type).safeParse(base);
      expect(issues(r)).toEqual([]);
      expect(r.data as Record<string, unknown>).not.toHaveProperty('emptyState');
    });

    it(`${type}: a full emptyState parses GREEN and keeps what EmptyStateSchema keeps`, () => {
      const r = door(type).safeParse({ ...base, emptyState: FULL });
      expect(issues(r)).toEqual([]);
      expect((r.data as Record<string, unknown>).emptyState).toEqual(EmptyStateSchema.parse(FULL));
    });

    it(`${type}: an emptyState with one member parses`, () => {
      const r = door(type).safeParse({ ...base, emptyState: { message: 'Nothing bound yet' } });
      expect(issues(r)).toEqual([]);
      expect((r.data as Record<string, unknown>).emptyState).toEqual({ message: 'Nothing bound yet' });
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the rows are still closed
// ───────────────────────────────────────────────────────────────────────────

describe('§2 the bound rows still refuse what they do not declare', () => {
  for (const [type, , base] of BOUND) {
    it(`${type}: an unknown key INSIDE emptyState is refused at emptyState's own path`, () => {
      const r = door(type).safeParse({ ...base, emptyState: { title: 'x', notAnEmptyStateKey: 1 } });
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code: 'unrecognized_keys', path: 'emptyState' }]);
    });

    it(`${type}: a re-spelled member (\`description\` for \`message\`) is refused inside emptyState`, () => {
      const r = door(type).safeParse({ ...base, emptyState: { description: 'x' } });
      expect(r.success).toBe(false);
      expect(issues(r).length).toBeGreaterThan(0);
      for (const issue of issues(r)) expect(issue.path.startsWith('emptyState')).toBe(true);
    });

    it(`${type}: LIT CONTROL — an unknown top-level key is still refused at the row`, () => {
      const r = door(type).safeParse({ ...base, emptyState: FULL, notARecordBlockKey: 1 });
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code: 'unrecognized_keys', path: '' }]);
    });
  }

  it('a record block that does not bind this way refuses the key: the per-type door', () => {
    const related = door('record:related_list').safeParse({
      objectName: 'task',
      relationshipField: 'account_id',
      emptyState: FULL,
    });
    expect(issues(related)).toEqual([{ code: 'unrecognized_keys', path: '' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one schema, not a copy of its shape
// ───────────────────────────────────────────────────────────────────────────

describe('§3 each bound block holds EmptyStateSchema itself', () => {
  for (const [type, schema] of BOUND) {
    it(`${type}: emptyState unwraps to EmptyStateSchema — the same def object-grid holds, by identity`, () => {
      const def = member(schema).unwrap()._zod.def;
      expect(def).toBe(EmptyStateSchema._zod.def);
      expect(def).toBe(ObjectGridPropsSchema.shape.emptyState.unwrap()._zod.def);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the liveness marker
// ───────────────────────────────────────────────────────────────────────────

describe('§4 each describe carries the planned marker the ledger reads', () => {
  for (const [type, schema] of BOUND) {
    it(`${type}: the emptyState describe opens with the planned marker`, () => {
      expect(member(schema).description?.startsWith('[PLANNED — not yet rendered]')).toBe(true);
    });
  }
});
