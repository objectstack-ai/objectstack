/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `PageRenderer` draws a flat content list given as ONE node and as a list
 * (objectui#8310, maintainer ruling 2026-09-07, director decision batch #2),
 * and the root README's flagship example draws its CHILDREN (objectui#8912).
 *
 * ## Two cards share this file, and they are not the same question
 *
 * objectui#8310 asked the ARITY of the page node's flat content list — one node,
 * or a list. ⚠️ It was decided about the `body` spelling; objectui#6771 retired
 * that spelling, so the ruling governs `children` and this file reads it there.
 * objectui#8912 asked whether the child key the flagship example AUTHORS has
 * any reader at all. This file now pins both, because both are properties of
 * the same transcribed snippet, and the second was originally left visible here
 * on purpose (see "History" below) rather than repaired.
 *
 * ## What each leg is, and which one is evidence
 *
 * - **objectui#8310 — a regression CONTROL, not evidence.** The ruling's repair
 *   on this side is the deletion of `FlatContent`'s `content as SchemaNode`
 *   cast, a TYPE-LEVEL change with no runtime effect: both arities rendered
 *   before it and both render after it. An assertion green in both worlds
 *   proves nothing about a change, and it is labelled so nobody quotes it as if
 *   it did. The discriminating half lives in
 *   `packages/types/src/__tests__/page-body-arity-8310.test.ts`.
 * - **objectui#8912 — evidence, and it is RENDER OUTPUT.** The three
 *   `statistic` labels the flagship authors must appear in the rendered tree.
 *   ⛔ No compile-time check could stand in for this leg when it was written:
 *   `BaseSchema` was `.passthrough()` with an `[key: string]: any` index
 *   signature, so the defective key validated, type-checked, rode onto the
 *   node and drew nothing.
 *   `check:doc-types` only asks whether a fence's `type` literal is registered
 *   (`grid` is), and `check:doc-examples` compiled against that same index
 *   signature (objectui#8347 removed it). Both were green on the defect BY
 *   DESIGN (objectui#4823), so a green from either is not a reading of this
 *   card.
 *
 * ## ⚠️ Why the negative-space leg renders the OLD spelling
 *
 * The `grid` renderer reads `schema.children` and nothing else. The third
 * describe block renders the pre-repair shape and asserts the grid element IS
 * drawn while its children are NOT — which is precisely why objectui#8912
 * failed silently, and precisely why a naive "did anything render?" control
 * passes on a broken build. It is also the floor set by coding standard #0.1
 * (contract-first): making `grid` read `items` as an alias for `children`, or
 * declaring `items` on `GridSchema`, were both REFUSED on objectui#8912 as the
 * lenient-fallback shape that standard forbids by name. Either one would redden
 * this block. ⛔ Do not "fix" it by teaching the renderer the second spelling.
 *
 * ## History — why this file once transcribed the defect on purpose
 *
 * Written for objectui#8310, when the README's flagship grid still spelled its
 * child list `items`. That defect was measured while writing this file and
 * filed as objectui#8912; the objectui#8310 ruling forbade touching the README,
 * so the transcription deliberately preserved `items` so the defect could not
 * hide inside a green. objectui#8912 has since repaired all three teaching
 * surfaces to `children`, so the transcription now follows the repaired
 * flagship — and the README-scan leg below keeps it from becoming fiction.
 * ⛔ Do not delete or weaken these legs to make an unrelated change pass.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SchemaRenderer } from '@object-ui/react';
// Module scope, not a hook: registers `page`, `grid` and `statistic`. A cold
// `await import()` inside a hook is billed to `hookTimeout` and races the
// assertions (AGENTS.md §测试纪律, objectui#3010).
import '../renderers';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');

/** The three `statistic` labels the README's flagship example authors. */
const LABELS = ['Total Users', 'Revenue', 'Orders'];

/** The README's flagship grid, transcribed as REPAIRED — child list `children`. */
const flagshipGrid = {
  type: 'grid',
  columns: 3,
  children: [
    { type: 'statistic', label: 'Total Users', value: '1234' },
    { type: 'statistic', label: 'Revenue', value: '$56,789' },
    { type: 'statistic', label: 'Orders', value: '432' },
  ],
};

/**
 * The same grid spelled the way it was BEFORE objectui#8912 — `items`, a key
 * `grid` never reads. Kept as the defect shape, never as a taught shape.
 */
const flagshipGridPreRepair = {
  type: 'grid',
  columns: 3,
  items: flagshipGrid.children,
};

function renderPage(children: unknown) {
  return render(<SchemaRenderer schema={{ type: 'page', title: 'Dashboard', children } as any} />);
}

const gridsIn = (container: HTMLElement) => container.querySelectorAll('[data-obj-type="grid"]');

describe('PageRenderer — both flat-content arities reach the renderer (objectui#8310, CONTROL)', () => {
  it('draws the node when `children` is ONE node — the README flagship shape', () => {
    const { container } = renderPage(flagshipGrid);
    expect(gridsIn(container)).toHaveLength(1);
  });

  it('draws the node when `children` is a LIST of nodes', () => {
    const { container } = renderPage([flagshipGrid]);
    expect(gridsIn(container)).toHaveLength(1);
  });

  it('draws nothing when `children` is absent — the negative control', () => {
    const { container } = renderPage(undefined);
    expect(gridsIn(container)).toHaveLength(0);
  });
});

describe('PageRenderer — the flagship example draws its CHILDREN (objectui#8912)', () => {
  it('renders every child of a single-node `children`', () => {
    const { container } = renderPage(flagshipGrid);
    for (const label of LABELS) expect(container.textContent).toContain(label);
  });

  it('renders every child of a list `children`', () => {
    const { container } = renderPage([flagshipGrid]);
    for (const label of LABELS) expect(container.textContent).toContain(label);
  });
});

describe('`grid` reads `children` and nothing else — the defect shape (objectui#8912)', () => {
  it('draws the grid ELEMENT for the pre-repair `items` spelling — the firing control', () => {
    const { container } = renderPage(flagshipGridPreRepair);
    expect(gridsIn(container)).toHaveLength(1);
  });

  it('draws NONE of its children — the silent failure objectui#8912 repaired', () => {
    const { container } = renderPage(flagshipGridPreRepair);
    for (const label of LABELS) expect(container.textContent).not.toContain(label);
  });
});

/* -------------------------------------------------------------------------- */
/* README leg — the transcription above is not allowed to become fiction       */
/* -------------------------------------------------------------------------- */

/**
 * The `const schema: DeclaredNode = {` object literal inside the README's "Basic Usage"
 * fence, returned as source text. Scanned with brace-depth tracking rather than
 * a regex so a nested array cannot end the span early.
 */
function basicUsageSchemaLiteral(): string {
  const heading = README.indexOf('#### Basic Usage');
  expect(heading).toBeGreaterThan(-1);
  // The example is typed as the node the `schema` prop takes since objectui#11466.
  const start = README.indexOf('const schema: DeclaredNode = {', heading);
  expect(start).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = README.indexOf('{', start); i < README.length; i += 1) {
    const ch = README[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return README.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces in the README "Basic Usage" schema literal');
}

describe('the root README authors the grid child list `grid` actually reads (objectui#8912)', () => {
  it('spells the flagship grid child list `children`, never `items`', () => {
    const literal = basicUsageSchemaLiteral();
    expect(literal).toContain('children: [');
    expect(literal).not.toMatch(/(^|[^.\w])items\s*:/);
  });

  it('still authors the page/grid/statistic shape transcribed above', () => {
    const literal = basicUsageSchemaLiteral();
    expect(literal).toContain('type: "grid"');
    expect(literal.match(/type: "statistic"/g) ?? []).toHaveLength(3);
    for (const label of LABELS) expect(literal).toContain(`label: "${label}"`);
  });
});
