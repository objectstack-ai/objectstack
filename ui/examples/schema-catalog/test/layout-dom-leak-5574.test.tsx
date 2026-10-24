/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * No layout renderer puts an authored schema prop on the DOM (objectui#5574).
 *
 * ## What this measures that the sweep gate cannot
 *
 * `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx` is the gate
 * for this class, and it is the stronger instrument for the OPEN TAIL: it plants
 * canary keys no schema declares (`zzcanary`, a flattened `props` container, an
 * injected adapter) on one node per registered type. What it does not plant are
 * the renderer's OWN DECLARED PROPS — its canary node authors no `align`, no
 * `gap`, no `padding`. Adding them there would rewrite the measured attribute set
 * of all 115 renderers still ledgered, i.e. destroy the arrival reading that file
 * exists to preserve.
 *
 * So the declared-prop half is measured HERE instead, at catalog scale, on real
 * authored nodes. That is not a hypothetical distinction: every one of the 1194
 * attributes objectui#5574 measured was a DECLARED prop being consumed off
 * `schema` AND forwarded to the element — `align`, `gap`, `justify`, `direction`,
 * `padding`, `maxWidth`, `content`, `value`. A regression that re-spread only the
 * declared keys would pass the sweep gate and fail here.
 *
 * ## The reading this pins
 *
 * Before the fix, rendering every catalog node of these five types through the
 * real `SchemaRenderer` and reading the DOM:
 *
 *     text[content]      522     container[padding]   14
 *     flex[align]        198     container[maxwidth]   6
 *     flex[gap]          193     flex[direction]       5
 *     stack[gap]         153     stack[align]          4
 *     flex[justify]       98     text[value]           1
 *                                              TOTAL 1194
 *
 * `grid` read ZERO in that same run, across 26 nodes, because objectui#4787 /
 * PR #5573 had already converged it on `toDomProps`. That is what made the
 * reading trustworthy rather than merely alarming — a fixed renderer read clean
 * and its unfixed siblings did not, so the instrument was demonstrably not blind.
 *
 * ## Designing against the failure mode this test could have
 *
 * A zero here means nothing on its own: a renderer that renders NOTHING spreads
 * nothing and reads clean, and so does a walk that found no nodes. Both are how
 * a broken instrument reports a healthy tree. Two guards, and they are the
 * reason this file is not just an `expect([]).toEqual([])`:
 *
 *   1. NODE COUNTS are asserted, per type, against the census below. If the
 *      catalog grows this fails and the number gets updated; if the walk breaks,
 *      or a renderer starts returning `null`, it fails and cannot read as clean.
 *   2. The JUDGE is self-checked against a deliberately leaking element, so a
 *      zero can never come from an attribute reader that reports nothing.
 *
 * The 159 `text` nodes that render NO element are recorded rather than hidden:
 * `text` returns a bare fragment when a node carries neither designer id,
 * className, `variant` nor `align`, and 159 catalog nodes take that path. They
 * were never evidence of safety, which is the phantom-clean class
 * objectui#5574's first pass found seven real leaks behind. (176 before
 * objectui#6942 taught `ui:text` to read `variant` and `align`: a node that
 * authors either now needs an element to carry the class, so 13 of them left
 * this class for the measured one.)
 *
 * Module-scope import of `@object-ui/components`, not `beforeAll` (AGENTS.md
 * §测试纪律): registering the renderers is an unbounded module load and must not
 * be billed to a bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer } from '@object-ui/react';
import { allExamples } from '../src/index.js';

type Node = Record<string, unknown>;

/**
 * The four renderers objectui#5574 converged, plus `grid` — kept in the same
 * list, not as a courtesy but because a control that runs somewhere else is not
 * a control. It reads clean in every configuration of this test, so on its own
 * it discriminates nothing; what it does is carry PR #5573's fix forward under
 * the same instrument that grades the other four.
 */
const MEASURED_TYPES = ['flex', 'stack', 'container', 'grid', 'text', 'box'] as const;

/**
 * Nodes of each type in the catalog today, and how many of them render no
 * element at all. Asserted, so a zero leak reading is always accompanied by
 * proof that something was actually rendered to read.
 *
 * These move when the CATALOG is authored, not when a renderer changes —
 * objectui#5574's own measurement drifted by 9 `flex[gap]` between two readings
 * purely because PR #5826 re-authored nine `space-x-*` nodes as `gap`. A diff
 * that changes these numbers and nothing else is an example being added; update
 * them. A diff that changes them while touching a renderer is the thing this
 * guard is for.
 */
const NODE_CENSUS: Readonly<Record<string, { rendered: number; noElement: number }>> = {
  // 248 -> 252 with objectui#10859 batch 8 phase 2d: the four
  // `components-basic-sidebar` documents now author one `sidebar` node, and
  // `sidebar-with-badges`' four items are `flex` rows (`properties.children`).
  // Catalog authoring, not a renderer change.
  flex: { rendered: 252, noElement: 0 },
  stack: { rendered: 153, noElement: 0 },
  container: { rendered: 15, noElement: 0 },
  // 26 -> 27 with objectui#11070 round 10: the new `fields-grid/line-items-grid`
  // fixture's form field entry is `type: 'grid'`, which this structural walk
  // collects, as it collects the other `fields-grid` entries. Catalog
  // authoring, not a renderer change.
  grid: { rendered: 27, noElement: 0 },
  // 699 -> 702: the two components-layout-box exemplars author 3 text nodes
  // (objectui#3965). 702 -> 701 and 176 -> 162 with objectui#6942, and the two
  // moves have different causes: `components-basic-text/muted.json` was deleted
  // (one node fewer), and 13 nodes LEFT the no-element class because `ui:text`
  // began reading `variant` and `align` — a node that authors either now needs
  // an element to carry the class. Those 13 are the 7 variant-carrying
  // `components-basic-text` entries, the 3 `text-alignment` children, the
  // `components-feedback-loading/with-text` label, and the `h3` headings in
  // `components-layout-container/basic-container` and
  // `components-layout-stack/basic-stack`. This is the census moving in the
  // SAFE direction: fewer phantom-clean nodes, more elements actually read.
  // 162 -> 159 with objectui#7444, the same move one card later: the three
  // `components-basic-text/text-with-colors` nodes authored a phantom `color`
  // nothing declared or read, and now author `className`, which the renderer
  // DOES forward — so each one needs an element to carry its colour class.
  // 701 -> 696 and 159 -> 154 with objectui#6829 (arm A): the five `text`
  // nodes that were the `children` of five `badge` nodes are gone, folded into
  // each badge's `label`. `ui:badge` never rendered them (it reads `label` and
  // `body`, not `children`), and as bare text nodes carrying no className,
  // `variant` or `align` they sat in the no-element class — so both counts
  // move by exactly five. Catalog authoring, not a renderer change.
  // 696 -> 698 with objectui#6877: `components-basic-div/use-box-instead` is
  // the `div` -> `box` before/after the migration guide was missing, and its
  // two `text` nodes both carry a className, so both need an element — the
  // no-element count is unmoved. Catalog authoring, not a renderer change.
  // 698 -> 699 and 154 -> 155 with objectui#11070 round 10: the new
  // `fields-grid/line-items-grid` fixture's `product` grid column is
  // `type: 'text'`, which this structural walk collects as a `text` node;
  // rendered on its own it draws no element. Catalog authoring, not a
  // renderer change.
  // 699 -> 687 and 155 -> 140 with objectui#10859 batch 8 phase 2d: the four
  // `components-basic-sidebar` documents authored 19 bare `text` nodes (the
  // menu-button labels and four "Main content area" strings), none carrying a
  // className, so all 19 sat in the no-element class. They now author 7: three
  // group headings with a className (basic 1, grouped 2), which need an
  // element, and the badge demo's four bare item labels, which do not — so
  // rendered moves by 12 and no-element by 15. The other items are `button`
  // labels. Catalog authoring, not a renderer change.
  // 687 -> 684 and 140 -> 137 with objectui#5250 slice C: the three items of
  // `components-data-display-list/basic-list` carried a `type: 'text'` that
  // `ui:list` never reads (it draws each item's `content`), so this structural
  // walk collected them as three bare text nodes that draw no element. The
  // items now author `content` alone, so both counts move by exactly three.
  // Catalog authoring, not a renderer change.
  text: { rendered: 684, noElement: 137 },
  // The objectui#3965 migration population (80 nodes retyped from `div`) plus
  // the 4 nodes of the components-layout-box exemplars. `box` is born on
  // `toDomProps` and class-transparency, so it joins the measured set as a
  // converged renderer from day one — 84 real authored nodes, every one
  // expected to render its element and leak nothing.
  // 84 -> 86 with objectui#6877: the same new fixture is two `box` nodes (an
  // outer wrapper and an inner padding box), mirroring the `div` exemplar it
  // teaches the conversion away from.
  // 86 -> 82 with objectui#10859 batch 8 phase 2d: the four
  // `components-basic-sidebar` documents each wrapped their main-content text
  // in a padding `box` inside the retired `sidebar-inset`; the rewritten
  // documents author the `sidebar` node alone. Catalog authoring.
  box: { rendered: 82, noElement: 0 },
};

/**
 * Attributes that are legitimately on a host element, so the judge ignores them.
 * Deliberately NOT a list of what to catch — the set of keys an author may write
 * is unbounded, which is the whole argument of
 * `packages/core/src/utils/dom-props.ts`. Everything not named here is reported.
 */
function isLegitimate(name: string): boolean {
  return (
    name === 'class' ||
    name === 'style' ||
    name === 'id' ||
    name === 'role' ||
    name === 'tabindex' ||
    name.startsWith('data-') ||
    name.startsWith('aria-')
  );
}

/** Every attribute on `host` the SDUI DOM contract does not allow there. */
function illegitimateAttributes(host: Element): string[] {
  return Array.from(host.attributes)
    .map((attribute) => attribute.name)
    .filter((name) => !isLegitimate(name))
    .sort();
}

function collect(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const record = node as Node;
    if (
      typeof record.type === 'string' &&
      (MEASURED_TYPES as readonly string[]).includes(record.type)
    ) {
      out.push(record);
    }
    for (const value of Object.values(record)) collect(value, out);
  }
  return out;
}

describe('schema-catalog — no layout renderer leaks an authored prop to the DOM (#5574)', () => {
  it('the judge reports a real leak — a zero below is a reading, not a blind spot', () => {
    // Rendered directly rather than through the registry: this checks the
    // ATTRIBUTE READER, and it must keep working even if every renderer in the
    // repo is fixed. Without it, `illegitimateAttributes` could return `[]`
    // unconditionally and every assertion in this file would still pass.
    //
    // The bag is spread rather than written as JSX attributes, which is not a
    // typing dodge but the defect's own shape: `<div align="start">` does not
    // type-check, and a bare spread of an untyped record is exactly how these
    // attributes got onto real elements without anyone hearing about it.
    const bag: Record<string, unknown> = {
      className: 'c',
      id: 'i',
      'data-obj-id': 'd',
      align: 'start',
      gap: 4,
      content: 'x',
    };
    const { container } = render(<div {...bag} />);
    expect(illegitimateAttributes(container.firstElementChild!)).toEqual([
      'align',
      'content',
      'gap',
    ]);
  });

  it('every catalog node of these five types renders, and none leaks', () => {
    const leaks: string[] = [];
    const rendered = new Map<string, number>();
    const noElement = new Map<string, number>();
    const bump = (map: Map<string, number>, key: string) =>
      map.set(key, (map.get(key) ?? 0) + 1);

    for (const example of allExamples()) {
      for (const node of collect(example.schema)) {
        const type = String(node.type);
        bump(rendered, type);
        const { container, unmount } = render(<SchemaRenderer schema={node as never} />);
        const host = container.firstElementChild;
        if (!host) {
          bump(noElement, type);
          unmount();
          continue;
        }
        for (const name of illegitimateAttributes(host)) {
          leaks.push(`${example.id} :: ${type}[${name}]`);
        }
        unmount();
      }
    }

    // Asserted BEFORE the leak reading, so a walk that rendered nothing fails
    // as a broken instrument rather than passing as a clean tree.
    const census = Object.fromEntries(
      MEASURED_TYPES.map((type) => [
        type,
        { rendered: rendered.get(type) ?? 0, noElement: noElement.get(type) ?? 0 },
      ]),
    );
    expect(
      census,
      'the catalog node census moved. If this diff only adds/removes examples, ' +
        'update NODE_CENSUS. If it touches a renderer, a node stopped rendering ' +
        'an element — and a renderer that renders nothing reads CLEAN below.',
    ).toEqual(NODE_CENSUS);

    expect(
      leaks,
      'an authored schema prop reached the DOM as an HTML attribute. These keys ' +
        'are CONSUMED off `schema` by the renderer; forwarding them as well is ' +
        'the objectui#3291 leak. Route the spread through `toDomProps` — never ' +
        'widen the whitelist and never add an exemption here.',
    ).toEqual([]);
  }, 120000);
});
