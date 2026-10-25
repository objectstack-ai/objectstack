/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11405 — a bind-only `list` is accepted: `ListSchema.items` is
 * optional on both published faces, and the zod face requires AT LEAST ONE of
 * `bind` / `items`.
 *
 * ## The defect
 *
 * `list.tsx` reads `useDataScope(schema.bind)` first and falls back to
 * `schema.items` when the bound value is not an array, so a `list` carrying only
 * `bind` draws one entry per element of the bound array. Both published faces
 * nevertheless REQUIRED `items`: `safeValidateSchema({ type: 'list', bind:
 * 'customerNames' })` was refused with `invalid_type` at `items`, the strict face
 * agreed, and the TypeScript face refused the same literal (`TS2741`). Four
 * marked fences in two published guides author exactly that shape, and their
 * marker only checks that they parse, so nothing noticed.
 *
 * Triage's ruling (comment 5941529511): the arm follows the renderer, and the
 * guides are not edited. The rule is at least one and ⛔ not exactly one,
 * because `items` is the renderer's real fallback beside `bind`.
 *
 * ## What this file pins
 *
 * - the zod face, through the arm itself, through `safeValidateSchema` (the
 *   tolerant face) and through the strict face `objectui validate` runs: a bind-only
 *   `list`, an items-only one and one carrying both are accepted, and one with
 *   neither is refused ONCE, at the node, keyed `LIST_ENTRIES_REQUIRED`;
 * - the TypeScript face: the bind-only literal compiles. That half is judged by
 *   `tsc -p tsconfig.test.json` (`pnpm --filter @object-ui/types type-check`),
 *   not by vitest, which strips types. The TypeScript face cannot spell "at
 *   least one" with an optional member, so a literal with neither key still
 *   compiles; the rule lives on the mirror, as it does for `object-kanban`
 *   (objectui#7780);
 * - the guides: every marked fence that authors a bind-only `list` is READ OFF
 *   DISK with `scanSkillFences`, the reader the marker's own gate uses, and fed
 *   to `safeValidateSchema`. A copy here would not notice a guide change. A fence
 *   the guide itself marks ❌ is wrong for another reason (its `children` and
 *   its `${item.name}`), so for it this file pins only that `items` is no longer
 *   what refuses it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { scanSkillFences as scanUntyped, stripJsonComments as stripUntyped } from '../../../../scripts/check-skill-examples.mjs';
import { ListSchema, safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod';
import type { ListSchema as TsListSchema } from '../data-display';

/** Local annotations, since the import above is untyped — the call sites stay checked. */
type ScannedFence = { kind: 'ts' | 'json'; language: string; fenceLine: number; body: string; marked: boolean };
const scanSkillFences: (source: string) => { fences: ScannedFence[]; orphans: number[] } = scanUntyped;
const stripJsonComments: (source: string) => string = stripUntyped;

/** Rooted at THIS file, never at `process.cwd()`. */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

const GUIDES = [
  'skills/objectui/guides/data-integration.md',
  'skills/objectui/guides/schema-expressions.md',
] as const;

/* ── The TypeScript face (judged by `tsc -p tsconfig.test.json`) ── */

// Refused with TS2741 (`items` is missing) before objectui#11405.
const BIND_ONLY: TsListSchema = { type: 'list', bind: 'customerNames' };
const ITEMS_ONLY: TsListSchema = { type: 'list', items: [{ content: 'Ada' }] };
const BOTH: TsListSchema = { type: 'list', bind: 'rows', items: [{ content: 'Ada' }] };

type Issue = { code: string; path: PropertyKey[]; params?: Record<string, unknown> };

/** The issues a parse raised, or `[]` when it passed. */
function issuesOf(result: { success: boolean; error?: { issues: readonly unknown[] } }): Issue[] {
  return result.success ? [] : ((result.error?.issues ?? []) as Issue[]);
}

/** Every face a node goes through: the arm, the published validator, the strict face. */
const FACES = {
  arm: (node: unknown) => ListSchema.safeParse(node),
  safeValidateSchema: (node: unknown) => safeValidateSchema(node),
  strict: (node: unknown) => StrictAnyComponentSchema.safeParse(node),
} as const;

describe('a `list` needs at least one of `bind` / `items` (objectui#11405)', () => {
  for (const [face, parse] of Object.entries(FACES)) {
    it(`${face}: bind-only, items-only and both are accepted`, () => {
      for (const node of [BIND_ONLY, ITEMS_ONLY, BOTH]) {
        expect(issuesOf(parse(node)), JSON.stringify(node)).toEqual([]);
      }
    });

    it(`${face}: a list with neither is refused once, at the node, keyed LIST_ENTRIES_REQUIRED`, () => {
      const issues = issuesOf(parse({ type: 'list', ordered: true }));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: 'custom', path: [], params: { code: 'LIST_ENTRIES_REQUIRED' } });
    });
  }

  it('the rule is reported BESIDE an unrelated fault on the same node, not hidden by it', () => {
    const issues = issuesOf(safeValidateSchema({ type: 'list', ordered: 'yes' }));
    expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([
      ['invalid_type', 'ordered'],
      ['custom', ''],
    ]);
  });

  it('a `bind` that fails its own type is refused at `bind`, and the rule does not fire twice', () => {
    const issues = issuesOf(safeValidateSchema({ type: 'list', bind: 42 }));
    expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_type', 'bind']]);
  });

  it('a nested list with neither is refused at its own path', () => {
    const issues = issuesOf(safeValidateSchema({ type: 'div', children: [{ type: 'list' }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'custom', path: ['children', 0], params: { code: 'LIST_ENTRIES_REQUIRED' } });
  });
});

/* ── The guides' marked fences, read off disk ── */

type Fence = { guide: string; fenceLine: number; teachesWrong: boolean; node: Record<string, unknown> };

/** Every marked json/jsonc fence in the two guides whose root is a `list` with `bind` and no `items`. */
function bindOnlyListFences(): Fence[] {
  const out: Fence[] = [];
  for (const guide of GUIDES) {
    const { fences } = scanSkillFences(readFileSync(resolve(REPO_ROOT, guide), 'utf8'));
    for (const fence of fences) {
      if (!fence.marked || fence.kind !== 'json') continue;
      // The marker's own gate already requires every marked fence to parse.
      const node = JSON.parse(fence.language === 'jsonc' ? stripJsonComments(fence.body) : fence.body);
      if (!node || typeof node !== 'object' || node.type !== 'list') continue;
      if (node.bind === undefined || node.items !== undefined) continue;
      out.push({ guide, fenceLine: fence.fenceLine, teachesWrong: fence.body.includes('❌'), node });
    }
  }
  return out;
}

describe('the guides\' bind-only `list` fences (objectui#11405)', () => {
  const fences = bindOnlyListFences();

  it('COUNTER-PROBE: the reader reaches a bind-only list in each guide, and the ❌ example among them', () => {
    for (const guide of GUIDES) {
      expect(fences.filter((f) => f.guide === guide).length, guide).toBeGreaterThan(0);
    }
    expect(fences.some((f) => f.teachesWrong)).toBe(true);
  });

  it('every fence taught as valid passes safeValidateSchema and the strict face', () => {
    const taught = fences.filter((f) => !f.teachesWrong);
    expect(taught.length).toBeGreaterThan(0);
    for (const { guide, fenceLine, node } of taught) {
      const where = `${guide}, fence opened on its line ${fenceLine}`;
      expect(issuesOf(safeValidateSchema(node)), where).toEqual([]);
      expect(issuesOf(StrictAnyComponentSchema.safeParse(node)), where).toEqual([]);
    }
  });

  it('the ❌ example is still refused, and never for a missing `items`', () => {
    for (const { guide, fenceLine, node, teachesWrong } of fences) {
      if (!teachesWrong) continue;
      const where = `${guide}, fence opened on its line ${fenceLine}`;
      const issues = issuesOf(safeValidateSchema(node));
      expect(issues.length, where).toBeGreaterThan(0);
      expect(issues.filter((i) => i.path[0] === 'items'), where).toEqual([]);
      expect(issues.filter((i) => i.params?.code === 'LIST_ENTRIES_REQUIRED'), where).toEqual([]);
    }
  });
});
