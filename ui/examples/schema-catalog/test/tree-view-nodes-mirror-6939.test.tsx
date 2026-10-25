/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6939, the `tree-view` group — the RENDER half. The validator-side
 * contract is pinned in
 * `packages/types/src/__tests__/tree-view-data-optional-6939.test.ts`.
 *
 * `TreeViewSchema` REQUIRED `data`, the limb the renderer reads THIRD
 * (`boundData || schema.nodes || schema.data || []`,
 * `renderers/data-display/tree-view.tsx:105`), so all four catalog entries —
 * which author `nodes`, the spelling the registration's own `inputs` and
 * `defaultProps` use, and which ARE those `defaultProps` — were refused by
 * `safeValidateSchema` while drawing correctly.
 *
 * ## Why the render half is the discriminating half
 *
 * From objectui#6318's triage: a "correction" that renders identically proves
 * the SCHEMA was wrong, not the fixture. So a repair on the schema side has to
 * clear the mirror image of that bar — the validator's verdict must change and
 * the renderer's output must NOT. `PRE_REPAIR` was measured on `origin/main` at
 * `fe4e7a9e8`, BEFORE either face was touched, through THIS file's harness.
 *
 * ⚠️ The card's table reports "identical — 14 elements" for this row. The
 * identity reproduces exactly (all four tiles, element count, tag census and a
 * SHA-256 of `textContent`); the absolute 14 does NOT reproduce in this
 * harness, which measures 28 / 28 / 12 / 34. Element counts are harness-bound —
 * the docs-gallery harness (`catalog-gallery-render.test.tsx`, provider plus
 * `SidebarProvider` plus a padded wrapper) gives different absolutes for the
 * same tile — so identity WITHIN one harness is the claim that discriminates,
 * and the number is recorded here rather than carried over from the card.
 *
 * Three readings per tile, because a count alone cannot tell a swapped element
 * from an equal one: element count, a tag census, and the text (literally, plus
 * a SHA-256 of it).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createHash } from 'node:crypto';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { TreeViewSchema, safeValidateSchema } from '@object-ui/types/zod';
import { getExample } from '../src/index.js';

const IDS = [
  'components-data-display-tree-view/deep-nesting',
  'components-data-display-tree-view/file-tree',
  'components-data-display-tree-view/org-chart',
  'components-data-display-tree-view/sidebar-navigation',
] as const;

/**
 * Measured on `origin/main` @ `fe4e7a9e8` through `measure()` below, both faces
 * untouched. Every one of the four reported `: Invalid input` from
 * `safeValidateSchema` at that commit, and every one drew exactly this.
 */
const PRE_REPAIR: Record<(typeof IDS)[number], {
  elements: number;
  tags: Record<string, number>;
  text: string;
  sha256: string;
}> = {
  'components-data-display-tree-view/deep-nesting': {
    elements: 28,
    tags: { DIV: 10, H3: 1, BUTTON: 2, svg: 5, path: 6, SPAN: 4 },
    text: 'Project Structuresrcpublicpackage.json',
    sha256: 'e55f4d288401013fd1d6d5f1045e77eba31b07c9a62656efdcc94945e7503167',
  },
  'components-data-display-tree-view/file-tree': {
    elements: 28,
    tags: { DIV: 10, H3: 1, BUTTON: 2, svg: 5, path: 6, SPAN: 4 },
    text: 'File ExplorerDocumentsPhotosREADME.md',
    sha256: '3f2f5a7468194a1af717c2c798a3dd4f9421df445b6c36dae9748eb83639d84a',
  },
  'components-data-display-tree-view/org-chart': {
    elements: 12,
    tags: { DIV: 5, H3: 1, BUTTON: 1, svg: 2, path: 2, SPAN: 1 },
    text: 'OrganizationCEO',
    sha256: '45f07e1527f23fbd805de7c378192a8fc79d82641d0e98fc35e745d721a17985',
  },
  'components-data-display-tree-view/sidebar-navigation': {
    elements: 34,
    tags: { DIV: 13, H3: 1, SPAN: 6, svg: 6, path: 6, BUTTON: 2 },
    text: 'NavigationDashboardProductsOrdersSettings',
    sha256: '6126579fe6fca4c4d9c5e25d1ca32f8d3967f2ec1fd1f88bcafa2d8c3f399d01',
  },
};

/** Render one entry the way the docs gallery does and measure what it drew. */
function measure(schema: unknown) {
  const { container, unmount } = render(
    <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />,
  );
  const nodes = Array.from(container.querySelectorAll('*'));
  const text = container.textContent ?? '';
  const out = {
    elements: nodes.length,
    tags: nodes.reduce<Record<string, number>>((h, el) => ((h[el.tagName] = (h[el.tagName] ?? 0) + 1), h), {}),
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
  unmount();
  return out;
}

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

/** The fixture as authored, and the "correction" objectui#6318's triage asks about. */
function asAuthored(id: (typeof IDS)[number]) {
  return getExample(id).schema as Record<string, unknown>;
}
function asDataSpelling(id: (typeof IDS)[number]) {
  const { nodes, ...rest } = asAuthored(id);
  return { ...rest, data: nodes };
}

describe('objectui#6939 — the four tree-view entries the mirror refused now validate', () => {
  it.each(IDS)('%s validates under safeValidateSchema', (id) => {
    expect(reasons(asAuthored(id))).toEqual([]);
  });
});

describe('objectui#6939 — and the repair moved the validator, not the renderer', () => {
  it.each(IDS)('%s renders exactly what it rendered before', (id) => {
    const after = measure(asAuthored(id));
    const before = PRE_REPAIR[id];
    expect(after.elements).toBe(before.elements);
    expect(after.tags).toEqual(before.tags);
    expect(after.text).toBe(before.text);
    expect(after.sha256).toBe(before.sha256);
  });

  it.each(IDS)('%s anti-vacuity: the tile drew its AUTHORED tree, not an empty box', (id) => {
    // A tile that renders nothing — or the error boundary — satisfies
    // "identical" trivially. The authored title and every root label on screen
    // prove the nodes reached the renderer through `nodes`, the spelling the
    // mirror refused.
    const schema = asAuthored(id) as { title: string; nodes: { label: string }[] };
    const m = measure(schema);
    expect(m.elements).toBeGreaterThan(10);
    expect(m.text.trim().length).toBeGreaterThan(0);
    expect(m.text).not.toContain('failed to render');
    expect(m.text).toContain(schema.title);
    for (const node of schema.nodes) expect(m.text).toContain(node.label);
  });
});

describe('objectui#6939 — the fixtures were the side that was right', () => {
  it.each(IDS)('%s: spelling it `data` now draws an EMPTY tree — the retired limb is not read (objectui#6951)', (id) => {
    // Flipped. At objectui#6939 the spelling swap moved nothing (the renderer
    // read `data` third), which is how the fixtures were shown to be the right
    // side. objectui#6951 then RETIRED `data` on both faces and dropped the
    // renderer's read of it, so the same swap now blanks the tree body: the
    // title still draws, every authored root label is gone. That is the
    // enforce-or-remove half measured through the DOM.
    const schema = asAuthored(id) as { title: string; nodes: { label: string }[] };
    const authored = measure(schema);
    const corrected = measure(asDataSpelling(id));
    expect(corrected.elements).toBeLessThan(authored.elements);
    expect(corrected.text).toContain(schema.title);
    for (const node of schema.nodes) expect(corrected.text).not.toContain(node.label);
  });

  it.each(IDS)('%s stays on the spelling its renderer reads FIRST', (id) => {
    const schema = asAuthored(id);
    expect(schema.nodes).toBeDefined();
    expect('data' in schema).toBe(false);
  });

  it('only `nodes` validates now — `data` is refused by name (objectui#6951)', () => {
    // Flipped from "both spellings validate". ⛔ Do NOT "repair" a future red
    // here by migrating the fixtures to `data`: that spelling is retired. The
    // refusal names the key and the spelling to write instead.
    for (const id of IDS) {
      expect(reasons(asAuthored(id))).toEqual([]);
      // The union door refuses (its top-level issue is the `invalid_union`
      // envelope); the arm-level issue on the `data` path carries the guidance.
      expect(reasons(asDataSpelling(id)).length).toBeGreaterThan(0);
      const direct = TreeViewSchema.safeParse(asDataSpelling(id));
      expect(direct.success).toBe(false);
      if (!direct.success) {
        const issue = direct.error.issues.find((i) => i.path.join('.') === 'data');
        expect(issue?.message).toContain('write `nodes`');
      }
    }
  });

  it('the keys are DECLARED, not passthrough holes', () => {
    // Counter-probes on keys the mirror declares; an unknown key proves nothing
    // here, because `BaseSchema` is `.passthrough()`.
    const shape = (TreeViewSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(['nodes', 'title', 'data']));
    expect(TreeViewSchema.safeParse({ type: 'tree-view', nodes: 'not-an-array' }).success).toBe(false);
    expect(TreeViewSchema.safeParse({ type: 'tree-view', data: 'not-an-array' }).success).toBe(false);
    // …and a good shape still passes, so the two above are not failing for some
    // unrelated reason. (`data` stays in the shape as a TOMBSTONE since
    // objectui#6951 — declared and refused by name, never a passthrough hole.)
    // objectui#6951: the carrier is `nodes`-only now — `data` is retired, so a
    // both-spellings carrier would redden for the retirement, not for shape.
    expect(TreeViewSchema.safeParse({
      type: 'tree-view', title: 'File Explorer', nodes: [{ id: '1', label: 'Documents' }],
    }).success).toBe(true);
  });
});
