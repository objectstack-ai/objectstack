/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#7658 — `extractToc`'s ids must be the ids `rehype-slug` actually
 * puts on the RENDERED headings, because that is the only thing a `#id` link
 * can resolve to.
 *
 * The truth source here is the real render pipeline (`MarkdownImpl` — the same
 * remark/rehype chain this plugin ships), NOT a second derivation of the slug
 * rules. Re-deriving them would only prove the two derivations agree; reading
 * the rendered `id` attribute proves the anchor exists.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import MarkdownImpl from './MarkdownImpl';
import { extractToc } from './toc';

/** The ids `rehype-slug` put on the rendered headings, in document order. */
function renderedHeadingIds(markdown: string): string[] {
  const html = renderToStaticMarkup(React.createElement(MarkdownImpl, { content: markdown }));
  return [...html.matchAll(/<h[1-6]\b[^>]*\bid="([^"]*)"/g)].map((m) => m[1]);
}

/** Every heading `extractToc` sees, in document order — h1–h6, not just the default h2–h3. */
function tocIds(markdown: string): string[] {
  return extractToc(markdown, { minDepth: 1, maxDepth: 6 }).map((item) => item.id);
}

/**
 * The three heading shapes this repository's own docs carry that hit the
 * defect: tag-shaped text inside a code span. In the DOM it is literal text
 * (a code span's content is a text value), so it is part of the anchor.
 *
 * `where` names FILES, never a line address. A line number in a test NAME is
 * read by nothing, so it cannot fail: it rots silently the first time a line is
 * inserted above the heading it points at. objectui#7853 ruled on that class —
 * cite the assertion by CONTENT — and #6998, #7289 and #7913 are its
 * recurrences. The heading text in `md` is the identifying content, and it is
 * already in the name.
 */
const LIVE_SHAPES: ReadonlyArray<{ md: string; id: string; where: string }> = [
  {
    md: '### `objectui generate <type> <name>` (alias `g`)',
    id: 'objectui-generate-type-name-alias-g',
    where: 'content/docs/utilities/cli.mdx, packages/cli/README.md',
  },
  {
    md: '### `objectui add <component>`',
    id: 'objectui-add-component',
    where: 'content/docs/utilities/cli.mdx, packages/cli/README.md',
  },
  {
    md: '#### Serving metadata over HTTP (`?api=<base>`)',
    id: 'serving-metadata-over-http-apibase',
    where: 'content/docs/utilities/runner.mdx',
  },
];

describe('extractToc ↔ rendered-anchor parity (objectui#7658)', () => {
  for (const { md, id, where } of LIVE_SHAPES) {
    it(`resolves the anchor for ${md} (${where})`, () => {
      const source = `${md}\n`;
      // Reading the truth source is itself the lit control: an empty list here
      // means the harness rendered nothing, and every comparison below it would
      // be a vacuous pass.
      expect(renderedHeadingIds(source)).toEqual([id]);
      expect(tocIds(source)).toEqual([id]);
    });
  }

  it('control: agrees on the inline shapes that never had the defect', () => {
    // Lit control — these ids are non-empty and already matched before the fix,
    // so a run in which they read `[]` (or drifted) is a broken instrument
    // rather than evidence about the defect.
    const source = '# Title\n\n## First Section\n\n## The **overlay** `rule` and a [link](/x)\n';
    const rendered = renderedHeadingIds(source);
    expect(rendered).toEqual(['title', 'first-section', 'the-overlay-rule-and-a-link']);
    expect(tocIds(source)).toEqual(rendered);
  });

  it('still drops genuine raw HTML, exactly as the renderer does', () => {
    // The raw-HTML rule is not being removed, only kept off code spans:
    // `remark-rehype` drops raw html nodes (no `allowDangerousHtml`), so the
    // rendered heading keeps the wrapped text and not the tags.
    const source = '## A <b>bold</b> tag\n';
    expect(tocIds(source)).toEqual(renderedHeadingIds(source));
  });

  it('keeps duplicate-suffix alignment across affected headings', () => {
    // The `-1/-2` suffixes only line up if EVERY heading slugs the same text
    // the renderer slugs — one wrong id upstream shifts every later anchor.
    const source =
      '# `objectui add <component>`\n\n' +
      '## `objectui add <component>`\n\n' +
      '## `objectui add <component>`\n';
    const rendered = renderedHeadingIds(source);
    expect(rendered).toEqual(['objectui-add-component', 'objectui-add-component-1', 'objectui-add-component-2']);
    expect(tocIds(source)).toEqual(rendered);
  });

  it('keeps a code span literal against every other inline rule', () => {
    // Markdown inside a code span is not markdown — the renderer emits the
    // bytes verbatim, so no inline rule may reach inside one.
    const source = '## `a_b_c` and `**not bold**` and `[x](y)`\n';
    expect(tocIds(source)).toEqual(renderedHeadingIds(source));
  });

  it('still collapses a link whose label is a code span', () => {
    // The masking must stay VISIBLE to the link rule as ordinary text,
    // otherwise `[`code`](url)` stops collapsing to its label.
    const source = '## Read [`getData`](/api) now\n';
    expect(tocIds(source)).toEqual(renderedHeadingIds(source));
  });
});

/**
 * objectui#7667 — the emphasis rules and CommonMark's FLANKING rule.
 *
 * `*` and `_` are not interchangeable. `*` opens emphasis anywhere, including
 * inside a word; a `_` run inside a word opens nothing, because it is both
 * left- and right-flanking with no adjacent punctuation and CommonMark lets
 * such a run neither open nor close. The renderer obeys that and keeps the
 * underscores, so the ids only agree if `stripInline` does too.
 *
 * Same truth source as above: the `id` the real chain puts on the rendered
 * heading, never a second derivation of the flanking rule.
 */
describe('extractToc ↔ rendered-anchor parity, emphasis flanking (objectui#7667)', () => {
  /** Asserts parity AND that the shared expectation is the id named here. */
  const bothAgree = (source: string, id: string) => {
    // Reading the renderer is the lit control: `[]` here means the harness
    // rendered nothing and the comparison below it would be vacuous.
    expect(renderedHeadingIds(source)).toEqual([id]);
    expect(tocIds(source)).toEqual([id]);
  };

  it('resolves the anchor for ### NON_GRID_ROW_CEILING', () => {
    // The live instance. Before the fix the TOC said `nongridrow_ceiling`:
    // the italic rule paired the 1st and 2nd underscores and ate `GRID`, then
    // resumed past them and ate `ROW` — an id no anchor on the page carries.
    bothAgree('### NON_GRID_ROW_CEILING\n', 'non_grid_row_ceiling');
  });

  it('leaves the ONE-underscore boundary exactly where it was', () => {
    // Why this went unnoticed: a lone underscore has nothing to pair with, so
    // ordinary `snake_case` prose was already correct. The fix must not move
    // it — this case is a regression pin, not a repair.
    bothAgree('## the snake_case name\n', 'the-snake_case-name');
  });

  it('keeps every intraword underscore run literal, whatever its length', () => {
    for (const [md, id] of [
      ['## A_B_C_D', 'a_b_c_d'], // 3 runs, so the naive rule paired two of them
      ['## snake_case_word', 'snake_case_word'],
      ['## MAX_ROWS vs MIN_ROWS', 'max_rows-vs-min_rows'],
      ['## file_name.ts and other_name.ts', 'file_namets-and-other_namets'],
      ['## trailing_underscore_', 'trailing_underscore_'], // nothing opened, so the closer stays
      ['## x__init__y', 'x__init__y'], // a `__` run is intraword too
    ] as const) {
      bothAgree(`${md}\n`, id);
    }
  });

  it('still strips underscore emphasis that CommonMark really opens', () => {
    // The intraword exemption is not "underscores are inert" — a run flanked
    // by whitespace or punctuation opens and closes exactly as before.
    for (const [md, id] of [
      ['## _em_ leading', 'em-leading'],
      ['## __bold__ leading', 'bold-leading'],
      ['## a _b_ c', 'a-b-c'],
      ['## a __b__ c', 'a-b-c'],
      ['## __init__', 'init'], // dunder at word boundaries DOES pair
      ['## _leading and trailing_', 'leading-and-trailing'],
      ['## _a_b_c_', 'a_b_c'], // outer runs pair; the inner two are intraword
    ] as const) {
      bothAgree(`${md}\n`, id);
    }
  });

  it('leaves the asterisk forms alone — only `_` carries the exemption', () => {
    // The counter-direction: a fix that gave `*` the same intraword exemption
    // would be wrong here, because `*` opens emphasis inside a word.
    for (const [md, id] of [
      ['## *em* asterisk', 'em-asterisk'],
      ['## **bold** asterisk', 'bold-asterisk'],
      ['## a*b*c intraword asterisk', 'abc-intraword-asterisk'],
      ['## a**b**c intraword asterisk bold', 'abc-intraword-asterisk-bold'],
      ['## *a_b_c*', 'a_b_c'], // asterisk emphasis wrapping intraword underscores
    ] as const) {
      bothAgree(`${md}\n`, id);
    }
  });

  it('agrees when the two markers meet in one heading', () => {
    for (const [md, id] of [
      ['## SOME_CONST and *em*', 'some_const-and-em'],
      ['## snake_case and *em* mixed', 'snake_case-and-em-mixed'],
      ['## snake_case *and* more_words', 'snake_case-and-more_words'],
    ] as const) {
      bothAgree(`${md}\n`, id);
    }
  });

  it('control: a heading with no emphasis marker at all is untouched', () => {
    // Lit control — a non-empty id that neither the old nor the new rule can
    // move. A run in which this reads `[]` or drifts is a broken instrument
    // rather than evidence about the flanking rule.
    bothAgree('## Plain heading text\n', 'plain-heading-text');
  });
});
