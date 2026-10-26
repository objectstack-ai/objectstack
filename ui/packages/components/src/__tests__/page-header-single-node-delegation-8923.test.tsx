/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * "One page, one h1" — the SINGLE-NODE arity (objectui#8923).
 *
 * `page-single-h1.test.tsx` pinned the rule for `regions[].components`, where
 * the shape is declared `SchemaNode[]` and only ever a list. The delegation
 * check `containsTitledPageHeader` opened with `if (!Array.isArray(nodes)) …
 * return false`, so every channel whose declared arity is
 * `SchemaNode | SchemaNode[]` — the page node's flat content list and, through
 * the recursion, every nested child list — took that early
 * return and answered "no titled header here". PageRenderer then drew its own
 * `h1` next to the one the header renders: the exact broken document outline
 * objectui#3434 closed, reopened for the arity the README flagship example
 * actually authors (`children: { type: 'grid', … }`, a bare node).
 *
 * The single-node arity became a declared, first-class authored shape in
 * objectui#8914 (card objectui#8310), which widened the page node's flat content list /
 * `.children` to `SchemaNode | SchemaNode[]`; `FlatContent` in the same file has
 * always normalised a bare node into a one-element list. This suite is the
 * runtime reproduction the card asked the fixing seat to take first: assertions
 * are written against the ACCESSIBLE TREE (`getAllByRole` with an explicit
 * level), never against class names.
 *
 * Row taxonomy, so the evidence value of each row is readable without running
 * the ablation:
 *   - `DISCRIMINATING` — red before the normaliser, green after.
 *   - `LIVE CONTROL`   — green on BOTH ablation legs. These are the rows that
 *     say the fix did not cross a boundary: the list arity that already worked,
 *     and the deliberately conservative "a header that renders no heading does
 *     NOT take the page's h1 away" rule.
 *   - `CANNOT DISCRIMINATE` — identical on both legs AND not a boundary the fix
 *     could plausibly cross; pinned only so the depth budget cannot move
 *     silently. Explicitly NOT evidence that the fix works.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Module scope, not a hook: registers PageRenderer (`app`/`home`/`record`/…),
// `page:header` and `card`. A cold `await import()` inside a hook is billed to
// `hookTimeout` and races the assertions (AGENTS.md §测试纪律, objectui#3010).
import '../renderers';

const PAGE_LABEL = 'New Project + Tasks';
const HEADER_TITLE = 'Authored header title';

/** A titled `page:header` — the node that renders the page's real heading. */
function titledHeader(props: Record<string, unknown> = { title: HEADER_TITLE }) {
  return { type: 'page:header', properties: props } as any;
}

/**
 * A region-less page. `children` is handed through verbatim so each
 * row controls the ARITY under test — the whole point of the suite.
 */
function pageWith(extra: Record<string, unknown>) {
  return {
    type: 'app',
    pageType: 'app',
    name: 'single_node_body_page',
    // Spec pages carry `label`; PageRenderer dual-reads it as the page title.
    label: PAGE_LABEL,
    template: 'default',
    ...extra,
  } as any;
}

function renderPage(schema: any) {
  return render(
    <ActionProvider>
      <SchemaRenderer schema={schema} />
    </ActionProvider>,
  );
}

/**
 * A chain of `cards` nested containers whose INNERMOST `children` is the bare
 * header node and whose every outer `children` is a one-element list. The header is
 * therefore examined at recursion depth `cards`, through the single-node hop —
 * exactly the arity the budget must keep treating like the list arity.
 */
function chainToBareHeader(cards: number): any {
  let node: any = { type: 'card', children: titledHeader() };
  for (let i = 1; i < cards; i += 1) {
    node = { type: 'card', children: [node] };
  }
  return node;
}

describe('PageRenderer — a single-node `children` delegates the h1 too (objectui#8923)', () => {
  // -------------------------------------------------------------------------
  // A1 — the reproduction the card asked for, at the top level.
  // -------------------------------------------------------------------------
  it('DISCRIMINATING — `children` as a SINGLE titled `page:header` node renders exactly ONE h1', () => {
    renderPage(pageWith({ children: titledHeader() }));

    // Before the normaliser this read 2: the page's implicit `label` h1 plus
    // the header's own. `getAllByRole` is the locator the live e2e depends on.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADER_TITLE);
    expect(screen.queryByText(PAGE_LABEL)).toBeNull();
  });

  it('DISCRIMINATING — `children` as a SINGLE titled `page:header` node renders exactly ONE h1', () => {
    // `PageNodeSchema.children` carries the same `SchemaNode | SchemaNode[]`
    // arity and is the second channel `pageHeaderOwnsTitle` reads.
    renderPage(pageWith({ children: titledHeader() }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADER_TITLE);
  });

  // -------------------------------------------------------------------------
  // A2 — the hole is per-RECURSION-LEVEL, not only at the top. The recursion
  // feeds `n.children` back into the SAME early return.
  // -------------------------------------------------------------------------
  it('DISCRIMINATING — a nested container whose `children` is a SINGLE titled header still delegates', () => {
    renderPage(pageWith({ children: [{ type: 'card', children: titledHeader() }] }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADER_TITLE);
  });

  it('DISCRIMINATING — a nested container whose `children` is a SINGLE titled header still delegates', () => {
    renderPage(pageWith({ children: [{ type: 'card', children: titledHeader() }] }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADER_TITLE);
  });

  it('DISCRIMINATING — a bare node at EVERY level of the chain (single-node all the way down)', () => {
    // Neither the outer `children` nor any inner one is a list. Before the fix the
    // walk stopped at the very first hop.
    renderPage(
      pageWith({
        children: { type: 'card', children: { type: 'card', children: titledHeader() } },
      }),
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADER_TITLE);
  });

  // -------------------------------------------------------------------------
  // LIVE CONTROLS — the list arity that already worked. Green on BOTH ablation
  // legs; they are what says the normaliser did not cross a boundary.
  // -------------------------------------------------------------------------
  it('LIVE CONTROL — `children` as a one-element LIST still renders exactly ONE h1', () => {
    renderPage(pageWith({ children: [titledHeader()] }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADER_TITLE);
  });

  it('LIVE CONTROL — a nested container whose `children` is a LIST still renders exactly ONE h1', () => {
    renderPage(pageWith({ children: [{ type: 'card', children: [titledHeader()] }] }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADER_TITLE);
  });

  it('LIVE CONTROL — a page that authors NO `page:header` keeps its own implicit h1', () => {
    renderPage(pageWith({ children: { type: 'element:text', properties: { text: 'body' } } }));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(PAGE_LABEL);
  });

  // -------------------------------------------------------------------------
  // LIVE CONTROLS — the conservatism `pageHeaderOwnsTitle` documents. A header
  // that renders NO heading must NOT take the page's h1 away; the normaliser
  // widens the arity, never the "counts as titled" test. Without these rows the
  // repair could trade a duplicate h1 for a page with ZERO h1 — strictly worse.
  // -------------------------------------------------------------------------
  it('LIVE CONTROL — single-node `children` header with NO title leaves the page its own h1', () => {
    // PageHeaderRenderer's bare branch renders `{explicitTitle && <h1>}`, so an
    // untitled header contributes no heading at all.
    renderPage(pageWith({ children: titledHeader({ subtitle: 'Just a subtitle' }) }));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(PAGE_LABEL);
  });

  it('LIVE CONTROL — single-node `children` header whose title interpolates to nothing leaves the page its own h1', () => {
    // `title: '{name}'` with no record in scope → `interpolate()` blanks it.
    renderPage(pageWith({ children: titledHeader({ title: '{name}' }) }));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(PAGE_LABEL);
  });

  it('DISCRIMINATING — delegating from a single-node `children` keeps the page `description`', () => {
    renderPage(pageWith({ children: titledHeader(), description: 'Page-level prose.' }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Page-level prose.')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Depth budget. The normaliser runs INSIDE the same invocation as the
  // `depth > 6` check, so wrapping a bare node must not spend a level.
  // -------------------------------------------------------------------------
  describe('depth budget (`depth > 6`) — unchanged by the normaliser', () => {
    it('DISCRIMINATING — a bare header at the LAST in-budget depth (6) still delegates', () => {
      // Six containers; the header is reached through the innermost container's
      // single-node `children`, so it is examined at depth 6 — the last value the
      // guard admits. If normalising a bare node spent a depth level this row
      // would fall out of budget and the page would draw a second h1.
      renderPage(pageWith({ children: [chainToBareHeader(6)] }));

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADER_TITLE);
    });

    it('CANNOT DISCRIMINATE — a header one level BEYOND the budget (7) is still not found', () => {
      // ⚠️ NOT evidence that this fix works — identical on both ablation legs.
      // It is here so the budget cannot silently WIDEN: the normaliser must not
      // buy the walk an extra level. The duplicate h1 it asserts is the
      // pre-existing outcome for headers buried deeper than the walk looks
      // (objectui#3434's depth bound), and is out of scope for objectui#8923.
      renderPage(pageWith({ children: [chainToBareHeader(7)] }));

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(2);
    });
  });
});
