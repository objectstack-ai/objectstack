// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17166] `ComponentPropsMap['object-grid'].exportOptions`'s `.describe()` must
 * name every member the renderer reads — because here the prose IS the shape.
 *
 * ## Why this key is different from its neighbours
 *
 * The entry is `z.unknown()`. Nothing is parsed, nothing is refused, nothing is
 * stripped: an author who writes a member that does not exist gets no error and
 * no effect, and an author who omits one that does exist has no way to discover
 * it. So the `.describe()` string is not a SUMMARY of an enforced shape — it is
 * the entire account of the shape that exists at this position, and it projects
 * straight into `content/docs/references/ui/component.mdx`, which is what an
 * author (or a generating model, ADR-0033) reads.
 *
 * Until #17166 that string named two members, `formats` and `streaming`, of the
 * five the only renderer reads.
 *
 * ## What was measured, and on which tree
 *
 * Measured at the `.objectui-sha` pin `53ded82bf7a494f54e344e19099dbf00854b8694`
 * — objectui `packages/plugin-grid/src/ObjectGrid.tsx`, through the
 * `schema.exportOptions` expression and the `exportConfig` local bound to it,
 * with objectui's own scanner (`ObjectGrid.exportOptionsKeys.test.ts`, whose
 * comment/string stripping is what keeps a prose mention of a key from being
 * counted as a read):
 *
 *   formats 2 · streaming 2 · maxRecords 1 · includeHeaders 1 · fileNamePrefix 1
 *
 * and an absent-name control (`zzzNotAMember`) reading 0 on the same instrument,
 * which is what makes those five counts readings rather than a matcher that
 * matches anything. ⚠️ Those counts are a dated observation and belong to that
 * tree; this pin does NOT re-derive them, and ⛔ must not be read as asserting
 * them today.
 *
 * ## Why the list is DERIVED here and not restated
 *
 * A restated list is a third copy of the contract, and the copy is what drifts —
 * which is the whole defect this file closes. So the expected member list is
 * read from `ListViewSchema.exportOptions`'s object branch
 * (`ListViewExportOptionsSchema`), the spec's OWN five-key declaration of this
 * same authoring block, itself derived from that same read set at #8010. Both
 * spellings — the page-component `object-grid` props and the list view's
 * `exportOptions` — reach one renderer, so the two surfaces describe one block.
 *
 * ⇒ Narrowing or widening the declared block reds this pin instead of leaving
 * the `z.unknown()` prose quietly behind, which is the direction of rot that has
 * no other guard: the declared side has parse failures, this side has nothing.
 *
 * ⛔ This pin does NOT ask the key to stop being `z.unknown()`. Giving it a real
 * shape is an accept-set change with its own review requirements; the last test
 * below records that it is unvalidated TODAY, so that change reds here and is
 * made deliberately rather than by accident.
 */

import { describe, it, expect } from 'vitest';
import { ComponentPropsMap } from './component.zod';
import { ListViewSchema } from './view.zod';

/**
 * The member names enumerated inside the first `({ … })` group of a describe
 * string, e.g. `Export config ({ formats, streaming })` -> `['formats', 'streaming']`.
 *
 * Deliberately anchored to the parenthesised group rather than "any identifier
 * in the sentence": the prose around it names `z.unknown()` and
 * `ListViewSchema.exportOptions`, and a scan that read those as members would
 * pass for the wrong reason. The self-test below is what proves the anchor
 * discriminates instead of matching anything.
 */
function describedMembers(description: string): string[] {
  const group = /\(\{([^}]*)\}\)/.exec(description);
  if (!group) return [];
  return group[1]!.split(',').map((k) => k.trim()).filter(Boolean);
}

/** The spec's own declaration of this block: the object branch of the list view's union. */
function declaredMembers(): string[] {
  const optional = (ListViewSchema as unknown as { shape: Record<string, unknown> })
    .shape.exportOptions as { unwrap(): { options: Array<{ shape?: Record<string, unknown> }> } };
  const branches = optional.unwrap().options;
  const objectBranch = branches.find((b) => b.shape !== undefined);
  return objectBranch === undefined ? [] : Object.keys(objectBranch.shape!);
}

const gridProps = ComponentPropsMap['object-grid'] as unknown as {
  shape: Record<string, { description?: string }>;
  safeParse(v: unknown): { success: boolean };
};
const description = gridProps.shape.exportOptions?.description ?? '';

describe('object-grid `exportOptions` — the describe names every declared member (#17166)', () => {
  it('the parser discriminates: it reads a member group and does not invent one', () => {
    // Lit control — a planted group is read back exactly.
    expect(describedMembers('Export config ({ alpha, beta })')).toEqual(['alpha', 'beta']);
    // Dark control — a sentence with no member group yields nothing, so a
    // green equality below can never come from a matcher that matches anything.
    expect(describedMembers('Export config, unvalidated.')).toEqual([]);
    // And a name absent from the group is not produced by prose that mentions it.
    expect(describedMembers('Export config ({ alpha }) — zzzNotAMember is not a member'))
      .toEqual(['alpha']);
  });

  it('scans something: both sides are non-empty and the authority is the five-key block', () => {
    // Non-vacuity floor. The assertion below is an equality, and an equality
    // between two empty lists passes for the worst possible reason.
    expect(description).not.toBe('');
    expect(describedMembers(description).length).toBeGreaterThanOrEqual(5);
    expect(declaredMembers().length).toBeGreaterThanOrEqual(5);
    expect(declaredMembers()).toContain('formats');
  });

  it('names exactly the members `ListViewExportOptionsSchema` declares', () => {
    // Named rather than counted: a failure must say WHICH member the prose is
    // short of, because the fix is to name it — the reader gets nothing else.
    expect([...describedMembers(description)].sort()).toEqual([...declaredMembers()].sort());
  });

  it('is still unvalidated, which is why the prose carries the whole account', () => {
    // The premise of this file, asserted rather than assumed: an undeclared
    // member is neither refused nor honoured here. If this ever goes red the
    // key grew an accept set and the describe's "Unvalidated here" sentence —
    // and this pin's reason to exist — need re-deciding, deliberately.
    expect(gridProps.safeParse({ exportOptions: { zzzNotAMember: 1 } }).success).toBe(true);
    expect(description).toContain('Unvalidated here');
  });
});
