// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20831] `object-grid.grouping` and `object-kanban.grouping` are judged by
 * the list view's own `GroupingConfigSchema` — by reference, not by a copy.
 *
 * ## The defect this file closes
 *
 * Both `ComponentPropsMap` rows declared `grouping: z.unknown()`, while both
 * renderers read the `GroupingConfigSchema` shape: the grid groups by every
 * `grouping.fields[i].field` (and reads `.order` / `.collapsed`), and the
 * kanban board takes `grouping.fields[0].field` as its swimlane fallback when
 * no `swimlaneField` is authored. So a padded field name — refused on
 * `list-view` since #17360 — or a value of the wrong shape parsed green on
 * these two doors and rendered one empty group / one lane holding every card,
 * with no error anywhere.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE REFUSALS, per row: the padded name at `grouping.fields.0.field`
 *   (`custom`), `grouping: 42` at `grouping` (`invalid_type` — there is no
 *   `fields[0]` for a number to fail at), and the three other accept-set
 *   changes the shared schema brings with it (an empty `fields`, an unknown
 *   key inside the config, a bare string). Each is the code AND the path, so a
 *   refusal for the wrong reason reds.
 * - §2 THE CONTROLS: a fully-spelled grouping parses byte-identical, a short
 *   one parses clean, and an absent `grouping` stays absent. A refusal pin
 *   with no lit control passes just as well when the door refuses everything.
 * - §3 ONE SCHEMA: both rows hold `GroupingConfigSchema` itself, and answer
 *   exactly what it answers on every value in the corpus. A later copy of the
 *   shape — the thing triage ruled out — reds the identity half even while it
 *   still agrees on today's corpus.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ComponentPropsMap, ObjectGridPropsSchema, ObjectKanbanPropsSchema } from './component.zod';
import { GroupingConfigSchema } from './view.zod';

const ROWS = [
  { type: 'object-grid', schema: () => ComponentPropsMap['object-grid'] },
  { type: 'object-kanban', schema: () => ComponentPropsMap['object-kanban'] },
] as const;

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

/** Every refused `grouping` value, with the one issue each must raise. */
const REFUSED: ReadonlyArray<readonly [label: string, grouping: unknown, code: string, path: string]> = [
  ['a padded field name', { fields: [{ field: '  business_unit  ' }] }, 'custom', 'grouping.fields.0.field'],
  ['a number', 42, 'invalid_type', 'grouping'],
  ['a bare field-name string', 'business_unit', 'invalid_type', 'grouping'],
  ['an empty fields list', { fields: [] }, 'too_small', 'grouping.fields'],
  ['an unknown key inside the config', { fields: [{ field: 'business_unit' }], showCounts: true }, 'unrecognized_keys', 'grouping'],
];

// ───────────────────────────────────────────────────────────────────────────
// §1 the refusals, on both rows
// ───────────────────────────────────────────────────────────────────────────

describe('§1 object-grid and object-kanban refuse a grouping the list view refuses', () => {
  for (const row of ROWS) {
    for (const [label, grouping, code, path] of REFUSED) {
      it(`${row.type}: refuses ${label} — ${code} at ${path}`, () => {
        const r = row.schema().safeParse({ objectName: 'account', grouping });
        expect(r.success).toBe(false);
        expect(issues(r)).toEqual([{ code, path }]);
      });
    }

    it(`${row.type}: the padded-name refusal names the value it received and the name to write`, () => {
      const r = row.schema().safeParse({ objectName: 'account', grouping: { fields: [{ field: '  business_unit  ' }] } });
      expect(r.success).toBe(false);
      const message = r.success ? '' : r.error.issues[0].message;
      expect(message).toContain(JSON.stringify('  business_unit  '));
      expect(message).toContain(`Write ${JSON.stringify('business_unit')}.`);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the controls
// ───────────────────────────────────────────────────────────────────────────

describe('§2 a valid grouping still parses, and absence stays absence', () => {
  for (const row of ROWS) {
    it(`${row.type}: LIT CONTROL — a fully-spelled grouping parses byte-identical`, () => {
      const grouping = {
        fields: [
          { field: 'business_unit', order: 'desc', collapsed: true },
          { field: 'owner.name', order: 'asc', collapsed: false },
        ],
      };
      const r = row.schema().safeParse({ objectName: 'account', grouping });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data.grouping).toStrictEqual(grouping);
    });

    it(`${row.type}: LIT CONTROL — the short form parses clean, with the list view's defaults`, () => {
      const r = row.schema().safeParse({ objectName: 'account', grouping: { fields: [{ field: 'business_unit' }] } });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data.grouping).toStrictEqual({
        fields: [{ field: 'business_unit', order: 'asc', collapsed: false }],
      });
    });

    it(`${row.type}: an absent grouping stays absent`, () => {
      const r = row.schema().safeParse({ objectName: 'account' });
      expect(issues(r)).toEqual([]);
      expect(r.success && 'grouping' in r.data).toBe(false);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one schema, not a copy of its shape
// ───────────────────────────────────────────────────────────────────────────

describe('§3 both rows hold GroupingConfigSchema itself', () => {
  const HELD = [
    ['object-grid', ObjectGridPropsSchema],
    ['object-kanban', ObjectKanbanPropsSchema],
  ] as const;

  for (const [type, schema] of HELD) {
    it(`${type}: the grouping member unwraps to GroupingConfigSchema — the same def, by identity`, () => {
      const member = schema.shape.grouping;
      expect(member.unwrap()._zod.def).toBe(GroupingConfigSchema._zod.def);
    });

    it(`${type}: answers what GroupingConfigSchema answers, one level down, on every corpus value`, () => {
      const corpus: unknown[] = [
        ...REFUSED.map(([, grouping]) => grouping),
        { fields: [{ field: 'business_unit', order: 'desc', collapsed: true }] },
        { fields: [{ field: 'business_unit' }] },
      ];
      for (const grouping of corpus) {
        const direct = issues(GroupingConfigSchema.safeParse(grouping)).map(({ code, path }) => ({
          code,
          path: path ? `grouping.${path}` : 'grouping',
        }));
        expect(issues(schema.safeParse({ objectName: 'account', grouping }))).toEqual(direct);
      }
    });
  }
});
