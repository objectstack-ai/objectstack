/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The layout guide's action passages DRAW BUTTONS (objectui#7926, maintainer
 * ruling 2026-09-09, decision batch #107 item 2 — option A).
 *
 * ## Why this file exists beside the schema pin
 *
 * The ruling names two pins, and they are not interchangeable. The contract half
 * — "`actions` on a `page` node is refused at parse" — lives in
 * `packages/types/src/__tests__/page-actions-refusal-7926.test.ts`. It is
 * satisfied by DELETING the key from the guide, which is exactly the outcome the
 * ruling calls out as a failure: docs edited, still nothing drawn.
 *
 * So this file asserts the RENDERED RESULT, through the real `SchemaRenderer` and
 * the real renderers, on the fences as they are committed. It is the load-bearing
 * half.
 *
 * ## The measurement this replaces
 *
 * objectui#7926 measured the old shape end to end:
 *
 *     page node with actions: [{type:'button',label:'Add Product'}, {…}]
 *       -> buttons found in the DOM: 0
 *       -> "Add Product" appears anywhere in the DOM: false
 *     the SAME two buttons moved into the page's child list
 *       -> buttons found in the DOM: 2   texts: ["Add Product","Export"]
 *
 * `renders nothing when authored as page.actions` below is that first reading
 * kept as a LIVE CONTROL. Without it, "at least one button" would be satisfied by
 * a renderer that draws a button for any input at all, and the assertion could
 * not fail for the reason it exists.
 *
 * ## The passages are DERIVED, not listed
 *
 * A hand-maintained list of line numbers or headings is the artefact that rots.
 * The sections are found by their heading text matching /action/i, and the fences
 * inside them by parsing; the count is pinned so a passage that quietly loses its
 * fence reddens instead of shrinking the population to zero and passing.
 *
 * ⚠️ `content/docs/**` is EXCLUDED from `ci.yml`'s full-run decision on
 * `pull_request` (`ci.yml`'s "Decide whether this change needs a full run" step),
 * so a green PR page is NOT evidence that this file ran on a docs-only edit. It is
 * placed in `packages/components` — a package a `page`/`button` change does move —
 * on purpose.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律):
 * registering them is an unbounded module load and must not be billed to a
 * bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';

const GUIDE_PATH = resolve(__dirname, '../../../../content/docs/guide/layout.md');

interface Passage {
  heading: string;
  line: number;
  doc: Record<string, unknown>;
}

/**
 * Every `### `-delimited section whose heading mentions an action, paired with the
 * `type: "page"` document its first parseable JSON fence carries.
 */
function actionPassages(): Passage[] {
  const src = readFileSync(GUIDE_PATH, 'utf8');
  const lines = src.split('\n');
  const out: Passage[] = [];
  let heading: string | null = null;
  let headingLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = /^### (.+)$/.exec(lines[i]);
    if (h) {
      heading = h[1];
      headingLine = i + 1;
      continue;
    }
    if (!heading || !/action/i.test(heading)) continue;
    if (lines[i] !== '```json') continue;
    const end = lines.indexOf('```', i + 1);
    if (end === -1) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(lines.slice(i + 1, end).join('\n'));
    } catch {
      i = end;
      continue;
    }
    if (doc && typeof doc === 'object' && (doc as Record<string, unknown>).type === 'page') {
      out.push({ heading, line: headingLine, doc: doc as Record<string, unknown> });
    }
    i = end;
  }
  return out;
}

/** Buttons the real renderers put in the DOM for this document. */
function buttonsDrawnBy(doc: unknown): string[] {
  const { container } = render(<SchemaRenderer schema={doc as never} />);
  const texts = Array.from(container.querySelectorAll('button')).map(
    (b) => b.textContent?.trim() ?? '',
  );
  cleanup();
  return texts;
}

const PASSAGES = actionPassages();

describe('objectui#7926 — the guide’s action passages draw buttons (render half)', () => {
  it('the population is the three passages the ruling names', () => {
    // Derived, but PINNED — a passage that loses its fence would otherwise shrink
    // this to an empty list and every assertion below would pass vacuously.
    expect(PASSAGES.map((p) => p.heading)).toEqual([
      'With Action Buttons',
      'Detail Page with Actions',
      '3. Action Buttons at the Top of the Body',
    ]);
  });

  it.each(PASSAGES.map((p) => [p.heading, p.doc] as const))(
    'renders at least one button: %s',
    (_heading, doc) => {
      const texts = buttonsDrawnBy(doc);
      expect(texts.length).toBeGreaterThanOrEqual(1);
      expect(texts.every((t) => t.length > 0)).toBe(true);
    },
  );

  it('the button LABELS the passages teach reach the DOM', () => {
    // "at least one button" alone would be satisfied by chrome the renderer draws
    // for itself. These are the words the author copied out of the page.
    const all = PASSAGES.flatMap((p) => buttonsDrawnBy(p.doc));
    for (const label of ['Add Product', 'Export', 'Edit', 'Delete', 'New Order']) {
      expect({ label, drawn: all.some((t) => t.includes(label)) }).toEqual({
        label,
        drawn: true,
      });
    }
  });

  it('LIVE CONTROL — the SAME buttons authored as `page.actions` draw nothing', () => {
    // The reading objectui#7926 was filed on. If this ever draws a button, the
    // node grew a reader (option B, refused) and every assertion above stopped
    // measuring what it claims to.
    const retired = {
      type: 'page',
      title: 'Products',
      actions: [
        { type: 'button', label: 'Add Product', variant: 'default', icon: 'plus' },
        { type: 'button', label: 'Export', variant: 'outline', icon: 'download' },
      ],
    };
    const texts = buttonsDrawnBy(retired);
    expect(texts).toEqual([]);
    const { container } = render(<SchemaRenderer schema={retired as never} />);
    expect(container.textContent).not.toContain('Add Product');
    cleanup();
  });

  it('LIVE CONTROL — the same two buttons moved into `children` draw both', () => {
    // The other half of the original measurement: the remedy the refusal message
    // names is the one that works, so "0 buttons" above is about the KEY and not
    // about this test being unable to draw anything.
    const texts = buttonsDrawnBy({
      type: 'page',
      title: 'Products',
      children: [
        {
          type: 'flex',
          justify: 'end',
          gap: 2,
          children: [
            { type: 'button', label: 'Add Product', variant: 'default', icon: 'plus' },
            { type: 'button', label: 'Export', variant: 'outline', icon: 'download' },
          ],
        },
      ],
    });
    expect(texts.filter((t) => /Add Product|Export/.test(t))).toHaveLength(2);
  });
});
