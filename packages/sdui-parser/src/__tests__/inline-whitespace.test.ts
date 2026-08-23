/**
 * The space between a text run and an adjacent inline element.
 *
 * ## The defect
 *
 * `parseChildren` collapsed each text run's whitespace to a single space
 * (right — that is HTML's own whitespace model) and then `.trim()`ed it
 * (wrong — HTML collapses a whitespace run to ONE space, it does not delete
 * it). The deleted space is exactly the one separating a run from an adjacent
 * inline sibling:
 *
 *     A <strong>kind:'html'</strong> page   ->   'A' {strong} 'page'
 *
 * so the same authored source produced a tree whose words run together
 * wherever it is rendered.
 *
 * ## The rule pinned here (triage decision, option (b))
 *
 * Collapse the run, then keep ONE leading space only when a sibling precedes
 * the run, and ONE trailing space only when a sibling ELEMENT follows it. At
 * the parent's own start/end the edge space is still dropped. Deliberately
 * mechanical: it invents no block/inline taxonomy for a schema tree that has
 * none (that was the rejected option (a)).
 *
 * This repo's copy of the parser adopts the rule the downstream copy already
 * landed, so the two parsers agree on BEHAVIOUR — these cases are the shared
 * contract, not a byte copy of the downstream source (the two files have
 * drifted and are expected to keep drifting).
 *
 * Its known cost is bounded and pinned below: a whitespace-only run BETWEEN
 * two siblings survives as a single space, so a pretty-printed `<ul>` gains
 * one `' '` string child per inter-item gap. The `<ul>` control asserts that
 * bound — exactly one space per gap, never the source's newline+indent, never
 * at the container's own edges, and never inside an `<li>`'s own text.
 *
 * This package is isomorphic and zero-React by design, so the tree IS the
 * observable here; the downstream copy carries the rendered-`textContent` half
 * of these same cases.
 */

import { describe, expect, it } from 'vitest';
import { parseJsx } from '../parse.js';
import type { SchemaElement, SchemaNode } from '../types.js';

/** The parsed children of a single-root source. */
function childrenOf(source: string): SchemaNode[] {
  const { tree, diagnostics } = parseJsx(source);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return (tree as SchemaElement).children ?? [];
}

/** Concatenated text of a subtree — the parse-tree stand-in for `textContent`. */
function flatten(node: SchemaNode | undefined): string {
  if (typeof node === 'string') return node;
  return (node?.children ?? []).map(flatten).join('');
}

describe('a text run keeps the space that separates it from a sibling element', () => {
  it("case 1 — 'A <strong>…</strong> page' keeps both spaces around the element", () => {
    const kids = childrenOf(
      `<p>A <strong>kind:'html'</strong> page — native HTML tags and the blocks' structured props.</p>`,
    );
    expect(kids).toEqual([
      'A ',
      expect.any(Object),
      " page — native HTML tags and the blocks' structured props.",
    ]);
    // The symptom as reported, stated so it cannot come back unnoticed.
    expect(flatten({ type: 'p', children: kids })).toBe(
      "A kind:'html' page — native HTML tags and the blocks' structured props.",
    );
    expect(flatten({ type: 'p', children: kids })).not.toBe(
      "Akind:'html'page — native HTML tags and the blocks' structured props.",
    );
  });

  it("case 2 — 'in the <em>html</em> tier.' keeps both spaces around the element", () => {
    const kids = childrenOf(`<li>Full HTML tag set in the <em>html</em> tier.</li>`);
    expect(kids).toEqual(['Full HTML tag set in the ', expect.any(Object), ' tier.']);
    expect(flatten({ type: 'li', children: kids })).toBe('Full HTML tag set in the html tier.');
  });

  it("case 3 — 'A trusted <a>…</a> behind a flag.' keeps both spaces around the element", () => {
    const kids = childrenOf(
      `<li>A trusted <a href="https://objectstack.ai">react tier</a> behind a flag.</li>`,
    );
    expect(kids).toEqual(['A trusted ', expect.any(Object), ' behind a flag.']);
    expect(flatten({ type: 'li', children: kids })).toBe('A trusted react tier behind a flag.');
  });

  it('collapses the run to ONE space — it never widens the gap', () => {
    // Multi-space and newline runs on BOTH sides of the element, and inside
    // the run itself. Every one of them must arrive as a single space.
    const kids = childrenOf('<p>A\n\n   long    run   <em>x</em>\n   tail</p>');
    expect(kids).toEqual(['A long run ', expect.any(Object), ' tail']);
  });

  it("still drops the edge space at the parent's own start and end", () => {
    // The half of `.trim()` that was correct. Nothing here is adjacent to a
    // sibling, so nothing is kept.
    expect(childrenOf('<p>   Hello   </p>')).toEqual(['Hello']);
    // A pretty-printed element child: the whitespace-only runs sit at the
    // parent's edges, so they leave no string children behind at all.
    expect(childrenOf('<p>\n  <strong>x</strong>\n</p>')).toEqual([expect.any(Object)]);
  });

  it("keeps the space when the element is the run's only neighbour", () => {
    expect(childrenOf('<p>Hello <strong>x</strong></p>')).toEqual(['Hello ', expect.any(Object)]);
    expect(childrenOf('<p><strong>x</strong> tail</p>')).toEqual([expect.any(Object), ' tail']);
  });

  describe("the bound on the rule's known over-generosity (a pretty-printed <ul>)", () => {
    const UL = `<ul>
        <li>Full HTML tag set in the <em>html</em> tier.</li>
        <li>A trusted <a href="https://objectstack.ai">react tier</a> behind a flag.</li>
        <li>Author writes markup; the platform renders it.</li>
      </ul>`;

    it('adds exactly one single-space child per inter-item gap, and none at the edges', () => {
      const kids = childrenOf(UL);
      expect(kids).toEqual([
        expect.any(Object),
        ' ',
        expect.any(Object),
        ' ',
        expect.any(Object),
      ]);
      // The bound, stated as the thing that could have gone wrong: no string
      // child is ever the source's newline + indentation, and no string child
      // sits before the first item or after the last.
      const strings = kids.filter((k): k is string => typeof k === 'string');
      expect(strings).toEqual([' ', ' ']);
      expect(typeof kids[0]).toBe('object');
      expect(typeof kids[kids.length - 1]).toBe('object');
    });

    it("leaves each <li>'s own text exactly as authored", () => {
      const items = childrenOf(UL).filter((k): k is SchemaElement => typeof k !== 'string');
      expect(items.map(flatten)).toEqual([
        'Full HTML tag set in the html tier.',
        'A trusted react tier behind a flag.',
        'Author writes markup; the platform renders it.',
      ]);
    });
  });
});
