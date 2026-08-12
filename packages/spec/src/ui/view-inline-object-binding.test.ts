// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7741] The runtime write door refuses an inline view config that carries no
 * object binding — maintainer ruling 2026-08-12, direction B.
 *
 * ## What QA run #7695 measured
 *
 * `PUT /api/v1/meta/view/<name>` with `{ name, type: 'grid', columns: […],
 * data: {…} }` — a single view's config written where the container belongs —
 * returned 200 in BOTH draft and active mode, published clean, and read back
 * with `_diagnostics: { valid: true }`. Meanwhile `expandViewContainer(...)`
 * returned `[]` and `GET /meta/view?object=…` omitted the row: registered,
 * reported valid, renders nothing. The same body handed to `defineView()`
 * throws the located "Wrap it: `defineView({ list: { … } })`" guidance — the
 * two doors disagreed in front of the same author.
 *
 * ## The ruled fix, and why the binding is a PAIR
 *
 * The inline (flattened overlay) arms of `ViewMetadataSchema` now REQUIRE
 * `object` + `viewKind`. Both, because that pair is what the object-bound read
 * paths actually filter on — measured, not assumed:
 * `packages/rest/src/rest-server.ts` (`GET /meta/view?object=` →
 * `v.viewKind && v.object === obj`) and
 * `packages/metadata/src/metadata-manager.ts` (`getViewsByObject()`, same
 * predicate). Requiring `object` alone would refuse the card's repro and then
 * instruct the author into a SECOND dead row — bound by `object`, still
 * invisible to the switcher for want of `viewKind`.
 *
 * ## Draft and active alike
 *
 * The ruling: 「draft 与 active 同样适用 …… 现在没有这个证据,不预留」. The pin
 * lives at the schema layer on purpose: `getMetadataTypeSchema('view')` is the
 * single entry `saveMetaItem` validates against for BOTH `mode: 'draft'` and
 * `mode: 'publish'` saves (ADR-0005 §Validation), so there is no draft-shaped
 * side door for the schema to miss. Whether some transport skips validation
 * entirely is a transport question a spec test cannot see.
 *
 * ## Reverse verification — direction decided before it was run
 *
 * Expected direction: restoring the two fields to `.optional()` turns the
 * card's repro body GREEN again through this same door (acceptance direction,
 * the plain before/after) while `defineView` keeps throwing — re-opening
 * exactly the two-door disagreement above. Observed on this branch (temporary
 * `git checkout origin/main -- src/ui/view.zod.ts` after committing the fix):
 * the repro parses `success: true` on the old schema, `success: false` on the
 * new one; no inverted or count-shaped surprises.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { ViewMetadataSchema, diagnoseViewMetadata, defineView } from './view.zod';

/** The card's exact repro body (#7741 / QA run #7695), verbatim shape. */
const REPRO = {
  name: 'qa_dead_view',
  type: 'grid',
  columns: ['title', 'status'],
  data: { provider: 'object', object: 'showcase_task' },
};

/** The same inline config, properly bound. */
const BOUND = { ...REPRO, object: 'showcase_task', viewKind: 'list' };

const door = () => getMetadataTypeSchema('view')!;

function refusalText(body: unknown): string {
  const r = door().safeParse(body);
  expect(r.success, `expected the door to REFUSE ${JSON.stringify(body)}`).toBe(false);
  return JSON.stringify((r as { error?: { issues?: unknown } }).error?.issues ?? []);
}

describe('[#7741] the runtime write door refuses the unbound inline view config', () => {
  it('REFUSES the card\'s exact repro body through getMetadataTypeSchema(\'view\')', () => {
    const r = door().safeParse(REPRO);
    expect(r.success).toBe(false);
  });

  it('the refusal is LOCATED: the claimed inline arm carries it at `object` / `viewKind`', () => {
    const r = door().safeParse(REPRO);
    expect(r.success).toBe(false);
    if (r.success) return;
    const root = r.error.issues[0] as unknown as {
      code: string;
      errors: Array<Array<{ path: PropertyKey[]; message: string }>>;
    };
    // The union envelope other consumers key on (ADR-0112 at the issue level).
    expect(root.code).toBe('invalid_union');
    expect(root.errors).toHaveLength(4);
    // Branch 2 is the listOverlay the body claims (`type: 'grid'`); #7510's
    // focusing mutes the other three, so the author reads ONLY the binding
    // prescription, at the paths of the keys to add.
    const claimed = root.errors[2]!;
    expect(claimed.map((i) => i.path)).toEqual([['object'], ['viewKind']]);
    for (const index of [0, 1, 3]) {
      expect(root.errors[index]).toHaveLength(1);
      expect(root.errors[index]![0]!.message).toContain('this body reads as `listOverlay`');
    }
  });

  it('…naming the offending shape and both halves of the remedy (bind, record, or wrap)', () => {
    const text = refusalText(REPRO);
    // The offending shape, by name.
    expect(text).toContain('inline view config');
    // The binding remedy, with the measured reason a binding is required.
    expect(text).toContain('names no `object`');
    expect(text).toContain('GET /meta/view?object=');
    expect(text).toContain('add `object:');
    // The record alternative.
    expect(text).toContain('{ name, object, viewKind, config: { … } }');
    // The wrap remedy — the SAME prose family `defineView` throws for this
    // body (the ruling: the write door reuses the build path's guidance).
    expect(text).toContain('Wrap it: `defineView({ list: { type, data, columns, … } })`');
    expect(text).toContain('defineView({ listViews: { my_view: { … } } })');
  });

  it('the guidance is the same prose family the build door throws for the repro', () => {
    // The contrast the card measured in step 5 of its reproduction: same body,
    // `defineView` door. Both doors now speak the wrap remedy.
    expect(() => defineView(REPRO as never)).toThrow(/defineView\(\{ list: \{ type, data, columns/);
  });

  it('a HALF binding is refused too — `object` alone or `viewKind` alone', () => {
    // `object` without `viewKind` is precisely the second dead row the pair
    // requirement exists to prevent (invisible to the switcher's
    // `v.viewKind && v.object === obj` filter).
    expect(refusalText({ ...REPRO, object: 'showcase_task' })).toContain('names no `viewKind`');
    expect(refusalText({ ...REPRO, viewKind: 'list' })).toContain('names no `object`');
  });

  it('the form-family inline arm refuses the same way', () => {
    const text = refusalText({ name: 'qa_dead_form', type: 'wizard' });
    expect(text).toContain('names no `object`');
  });

  it('diagnoseViewMetadata names the inline branch, so consumers render the binding guidance', () => {
    const d = diagnoseViewMetadata(REPRO);
    expect(d.success).toBe(false);
    if (d.success) return;
    expect(d.branch).toBe('listOverlay');
    expect(d.issues.map((i) => i.path)).toEqual([['object'], ['viewKind']]);
  });
});

describe('[#7741] what the door still accepts, byte for byte', () => {
  it('ACCEPTS the properly bound inline body — and adds nothing to it', () => {
    const r = door().safeParse(BOUND);
    expect(r.success, JSON.stringify((r as { error?: { issues?: unknown } }).error?.issues)).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual(BOUND);
  });

  it('ACCEPTS the ViewItem record arm byte-identically', () => {
    const record = {
      name: 'showcase_task.all',
      object: 'showcase_task',
      viewKind: 'list',
      config: { type: 'grid', columns: ['title'], data: { provider: 'object', object: 'showcase_task' } },
    };
    const r = door().safeParse(record);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual(record);
  });

  it('ACCEPTS the container arm byte-identically — #6391\'s union membership is intact', () => {
    const container = {
      object: 'showcase_task',
      list: { type: 'grid', columns: ['title'], data: { provider: 'object', object: 'showcase_task' } },
    };
    const r = door().safeParse(container);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual(container);
  });

  it('ACCEPTS the post-normalize personalization PUT (identity inherited from the shadowed entry)', () => {
    // What `normalizeViewMetadata` + `viewIdentityPatch` (#2555) actually hand
    // this schema for a console column-sort PUT on a real view.
    const r = door().safeParse({
      type: 'grid',
      data: { provider: 'object', object: 'showcase_task' },
      columns: ['title'],
      sort: [{ field: 'estimate_hours', order: 'desc' }],
      name: 'showcase_task.default',
      viewKind: 'list',
      object: 'showcase_task',
      label: 'All Tasks',
    });
    expect(r.success).toBe(true);
  });
});

describe('[#7741] the emitted contract declares what it enforces', () => {
  it('the inline arms\' JSON Schema marks `object` and `viewKind` required, in both io directions', () => {
    // Studio's SchemaForm is generated from this — declared = enforced means
    // an AI author is TOLD the binding is required before the 422 says so.
    for (const io of ['output', 'input'] as const) {
      const json = z.toJSONSchema(door(), { unrepresentable: 'any', io }) as {
        anyOf?: Array<{ required?: string[] }>;
      };
      expect(json.anyOf).toHaveLength(4);
      for (const member of [json.anyOf![2]!, json.anyOf![3]!]) {
        expect(member.required ?? []).toEqual(expect.arrayContaining(['object', 'viewKind']));
      }
    }
  });

  it('ViewMetadataSchema and the kernel registry entry are one schema — both modes, one verdict', () => {
    // `saveMetaItem` resolves BOTH draft and publish saves through
    // `getMetadataTypeSchema('view')`; pinning the identity here is the
    // schema-level half of "draft 与 active 同样适用".
    expect(door()).toBe(ViewMetadataSchema);
    expect(ViewMetadataSchema.safeParse(REPRO).success).toBe(false);
  });
});
