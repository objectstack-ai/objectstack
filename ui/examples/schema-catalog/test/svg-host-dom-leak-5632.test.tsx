/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Neither SVG-hosted renderer puts an authored schema prop on the DOM, and
 * neither stopped putting a REAL one there (objectui#5632, the
 * `BARE_SPREAD_ON_SVG` slice of objectui#5574).
 *
 * ## What this measures that the sweep gate cannot
 *
 * The same split the two probes next door describe
 * (`layout-dom-leak-5574.test.tsx`, `form-control-dom-leak-5632.test.tsx`).
 * `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx` is the gate
 * for this class and the stronger instrument for the OPEN TAIL — it plants
 * canary keys no schema declares. What it does not plant are the renderers' OWN
 * DECLARED PROPS: its canary node authors no `icon`, no `size`, no `color`.
 * Adding them there would rewrite the measured attribute set of the renderers
 * still ledgered, i.e. destroy the arrival reading that file preserves.
 *
 * For this group the declared half is the whole catalog-scale reading:
 * `icon[icon]` is 71 of the 71 attributes measured before the fix — the glyph
 * key the renderer CONSUMES to pick the component and then forwarded to the
 * element as well.
 *
 * ## The half a leak gate cannot see, which on an SVG host is most of it
 *
 * A leak gate reports attributes that ARRIVE illegitimately. It has no case for
 * one that STOPS arriving — and this is the group where that blind spot is
 * widest, because `@object-ui/test-support`'s judge counts `stroke`, `width`,
 * `height`, `fill` and `color` as legitimate on an SVG host. Everything lucide
 * emits therefore sits in the judge's legitimate half, invisible in BOTH
 * directions.
 *
 * That is not a hypothetical blind spot here. Two of this slice's three
 * measured behaviour changes live inside it, and one of them was a live defect:
 *
 *   - `spinner` declares `size` as an ENUM (`sm`/`md`/`lg`/`xl`) and consumes it
 *     through `sizeClasses`. The bare spread ALSO handed the string to lucide's
 *     numeric `size` prop, so a `size: 'lg'` node carried `width="lg"
 *     height="lg"` — invalid SVG dimensions, on every spinner in the catalog
 *     that sets a size, moving no number the gate watches.
 *   - `icon` declares `color` as a Tailwind CLASS ("Color Class") and applies it
 *     through `cn()`. The spread also reached lucide's `color` prop, emitting
 *     `stroke="text-red-500"` — an invalid paint value — beside the class doing
 *     the real work. All three `color` values authored in this catalog are
 *     classes, so nothing depended on the raw-CSS-colour accident.
 *
 * So the assertions below pin the LEGITIMATE attributes too, not just a zero.
 * A zero leak reading plus an unpinned legitimate set is exactly how the
 * sibling slice could have un-named and re-enabled every form control while its
 * gate went green.
 *
 * ## Designing against the failure mode this test could have
 *
 * A zero means nothing on its own: a renderer that renders NOTHING spreads
 * nothing and reads clean, and so does a walk that found no nodes. Three
 * guards, the same three the sibling probe carries:
 *
 *   1. NODE COUNTS are asserted, per type, against the census below — read
 *      IDENTICAL in the before and after runs, so the after-zero is a reading
 *      and not a walk that stopped finding nodes.
 *   2. `ui:grid` is measured in the SAME run as a CONTROL. Converged by
 *      objectui#4787 / PR #5573, it reads 0 in every configuration of this test,
 *      so on its own it discriminates nothing; what it does is read 0 in the
 *      same run in which `icon` read 71.
 *   3. The JUDGE is self-checked for ELEMENT-AWARENESS, in the direction THIS
 *      file depends on: an SVG host and an HTML host must disagree about the
 *      same bag. A judge that allowed `color`/`width` everywhere — or one that
 *      lowercased SVG attribute names — would pass every assertion below while
 *      seeing none of this group.
 *
 * ## Why each node is rendered without its children
 *
 * `findLeaks` walks the whole subtree, so a node's nested SDUI children get
 * their leaks attributed to the parent (measured next door: subtree scanning
 * put 61 attributes on `grid`, the CONTROL, all from child nodes of other
 * mechanism groups). Rendering each node with `children`/`body` removed scopes
 * the reading to the renderer's own markup; nothing is lost, because the walk
 * collects nested nodes of the measured types separately.
 *
 * Module-scope import of `@object-ui/components`, not `beforeAll` (AGENTS.md
 * §测试纪律): registering the renderers is an unbounded module load and must not
 * be billed to a bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SidebarProvider } from '@object-ui/components';
import { SchemaRenderer } from '@object-ui/react';
import { findLeaks, leakReport } from '@object-ui/test-support';
import { allExamples } from '../src/index.js';

type Node = Record<string, unknown>;

/** Both members of the group, plus `grid` as the control (guard 2 above). */
const MEASURED_TYPES = ['icon', 'spinner', 'grid'] as const;

/**
 * Nodes of each type in the catalog today, and how many render no element at
 * all. Asserted, so a zero leak reading always comes with proof that something
 * was rendered to read.
 *
 * These move when the CATALOG is authored, not when a renderer changes. A diff
 * that changes them and nothing else is an example being added; update them. A
 * diff that changes them while touching a renderer is what this guard is for —
 * `noElement` in particular, because `ui:icon` has a branch that used to
 * `return null` (objectui#5631) and a renderer made to bail early reads CLEAN
 * below having earned nothing.
 */
const NODE_CENSUS: Readonly<Record<string, { rendered: number; noElement: number }>> = {
  icon: { rendered: 71, noElement: 0 },
  spinner: { rendered: 6, noElement: 0 },
  // 26 -> 27 with objectui#11070 round 10: the new `fields-grid/line-items-grid`
  // fixture's form field entry is `type: 'grid'`, which this structural walk
  // collects, as it collects the other `fields-grid` entries. Catalog
  // authoring, not a renderer change.
  grid: { rendered: 27, noElement: 0 },
};

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

/** Every attribute on the host element of a standalone node, `name="value"`, sorted. */
function attributesOf(schema: Record<string, unknown>): string[] {
  const { container, unmount } = render(
    <div data-probe-root="">
      <SchemaRenderer schema={schema as never} />
    </div>,
  );
  const host = container.querySelector('[data-probe-root]')?.firstElementChild;
  expect(host, `no element rendered for ${JSON.stringify(schema)}`).toBeTruthy();
  const attributes = Array.from(host!.attributes)
    .map((attribute) => `${attribute.name}="${attribute.value}"`)
    .sort();
  unmount();
  return attributes;
}

describe('schema-catalog — no SVG-hosted renderer leaks an authored prop to the DOM (#5632)', () => {
  it('the judge is element-aware — a zero below is a reading, not a blind spot', () => {
    // Rendered directly rather than through the registry: this checks the
    // JUDGE, and it must keep working even if every renderer in the repo is
    // fixed. Without it, `findLeaks` could return `[]` unconditionally and
    // every assertion in this file would still pass.
    //
    // The bag is spread rather than written as JSX attributes, which is not a
    // typing dodge but the defect's own shape: `<svg label="y">` does not
    // type-check, and a bare spread of an untyped record is exactly how these
    // attributes reached real elements without anyone hearing about it.
    const bag: Record<string, unknown> = {
      className: 'c',
      id: 'i',
      'data-obj-id': 'd',
      color: 'red',
      width: '24',
      label: 'L',
      zzcanary: 'S',
    };

    // On an SVG host `color` and `width` are real attributes, so only the two
    // undeclared keys are leaks. This is the half objectui#5632 depends on: it
    // is why dropping them from the spread is invisible to a leak gate, and
    // therefore why this file pins the legitimate set below as well.
    const svg = render(<svg {...bag} />);
    expect(
      findLeaks(svg.container.firstElementChild!)
        .map((leak) => leak.attribute)
        .sort(),
    ).toEqual(['label', 'zzcanary']);

    // On an HTML container the SAME bag leaks `color` and `width` too — the
    // judge answers per element rather than from one flat list. A judge that
    // did not would report the same set for both and this file would be
    // vacuous exactly where the group lives.
    const div = render(<div {...bag} />);
    expect(
      findLeaks(div.container.firstElementChild!)
        .map((leak) => leak.attribute)
        .sort(),
    ).toEqual(['color', 'label', 'width', 'zzcanary']);
  });

  it('every catalog node of these three types renders, and none leaks', () => {
    const leaks: string[] = [];
    const rendered = new Map<string, number>();
    const noElement = new Map<string, number>();
    const bump = (map: Map<string, number>, key: string) =>
      map.set(key, (map.get(key) ?? 0) + 1);

    for (const example of allExamples()) {
      for (const node of collect(example.schema)) {
        const type = String(node.type);
        bump(rendered, type);
        // Children removed — see "Why each node is rendered without its
        // children" above. `SidebarProvider` keeps the harness identical to the
        // sibling probe's, so the before/after readings are comparable.
        const { children: _children, body: _body, ...own } = node;
        const { container, unmount } = render(
          <SidebarProvider>
            <div data-probe-root="">
              <SchemaRenderer schema={own as never} />
            </div>
          </SidebarProvider>,
        );
        const host = container.querySelector('[data-probe-root]')?.firstElementChild;
        if (!host) {
          bump(noElement, type);
          unmount();
          continue;
        }
        const found = findLeaks(host);
        if (found.length > 0) leaks.push(`${example.id} :: ${leakReport(type, found)}`);
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
      'an authored schema prop reached the DOM as an attribute. Route the spread ' +
        'through `toDomProps` (`@object-ui/core`) — never widen that list to ' +
        'reach one host and never add an exemption here. A key that genuinely ' +
        'belongs on this element is DECLARED and forwarded BY NAME ' +
        '(objectui#4435), the way `style` is.',
    ).toEqual([]);
  }, 120000);

  /**
   * The other direction, which no leak gate can assert: the attributes that
   * SHOULD be on these elements still are. Full sets, not spot checks — a
   * subset assertion would not have caught `stroke="text-red-500"` arriving,
   * and will not catch `stroke` disappearing.
   */
  it('the legitimate SVG attributes still arrive, and the declared paths still work', () => {
    // `color` is a Tailwind CLASS, which is what `IconSchema.color` declares.
    // It belongs in `class` and NOWHERE else: before this slice it also reached
    // lucide's `color` prop and came out as `stroke="text-blue-500"`, an invalid
    // paint value the judge counts as legitimate.
    expect(attributesOf({ type: 'icon', icon: 'check', color: 'text-blue-500' })).toEqual([
      'aria-hidden="true"',
      'class="lucide lucide-check text-blue-500"',
      'data-obj-type="icon"',
      'fill="none"',
      'height="24"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
      'stroke-width="2"',
      'stroke="currentColor"',
      'viewBox="0 0 24 24"',
      'width="24"',
      'xmlns="http://www.w3.org/2000/svg"',
    ]);

    // `IconSchema.size` is declared in PIXELS and this renderer consumes it into
    // an inline `style`. That style is the channel the authored size renders
    // through — CSS `width`/`height` win over the SVG presentation attributes —
    // and it is untouched here; only the redundant second channel through
    // lucide's `size` prop goes.
    expect(attributesOf({ type: 'icon', icon: 'check', size: 48 })).toEqual([
      'aria-hidden="true"',
      'class="lucide lucide-check"',
      'data-obj-type="icon"',
      'fill="none"',
      'height="24"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
      'stroke-width="2"',
      'stroke="currentColor"',
      'style="width: 48px; height: 48px;"',
      'viewBox="0 0 24 24"',
      'width="24"',
      'xmlns="http://www.w3.org/2000/svg"',
    ]);

    // The unresolved-glyph branch of objectui#5631 spreads too, and its
    // `role`/`aria-label`/`data-*` must survive the filter — `role` is on the
    // SDUI pass-through list and the other two are open families.
    const unresolved = attributesOf({ type: 'icon', icon: 'no-such-glyph-xyz' });
    expect(unresolved).toContain('role="img"');
    expect(unresolved).toContain('aria-label="Unresolved icon: no-such-glyph-xyz"');
    expect(unresolved).toContain('data-objectui-icon-unresolved="no-such-glyph-xyz"');
    expect(unresolved.filter((attribute) => attribute.startsWith('icon='))).toEqual([]);

    // `SpinnerSchema.size` is an ENUM consumed through `sizeClasses`. Spreading
    // it handed the string to lucide's numeric `size` prop, which is how
    // `width="lg" height="lg"` reached every sized spinner in the catalog.
    // `class` carries lucide's own classes AND both of this renderer's —
    // `animate-spin` and the size class. Before this slice it carried ONLY
    // lucide's: the spread's `className` overrode the computed one, so a
    // `ui:spinner` rendered through `SchemaRenderer` did not spin.
    //
    // `lucide-loader-2` is lucide's own RETIRED-ALIAS class, not a leak. It
    // appeared when `createLucideIcon` was reshaped to take an icon-data object
    // carrying `aliases` (lucide-react 1.43.0; absent in 1.31.0, where icon
    // modules have no `aliases` field at all) and it now emits one class per
    // alias. Measured on the installed artifact: 248 of 1818 icon modules carry
    // aliases, so any icon with one gains a class here. The assertion stays
    // EXACT on purpose — this list is what catches an authored prop reaching
    // the DOM, which is the whole point of objectui#5632; loosening it to a
    // substring match would retire the check rather than update it.
    expect(attributesOf({ type: 'spinner', size: 'lg' })).toEqual([
      'aria-hidden="true"',
      'class="lucide lucide-loader-circle lucide-loader-2 animate-spin h-8 w-8"',
      'data-obj-type="spinner"',
      'fill="none"',
      'height="24"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
      'stroke-width="2"',
      'stroke="currentColor"',
      'viewBox="0 0 24 24"',
      'width="24"',
      'xmlns="http://www.w3.org/2000/svg"',
    ]);
  });
});
