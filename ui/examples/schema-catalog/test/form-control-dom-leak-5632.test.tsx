/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * No form-control renderer puts an authored schema prop on the DOM
 * (objectui#5632, the `BARE_SPREAD_MINUS_NAME` slice of objectui#5574).
 *
 * ## What this measures that the sweep gate cannot
 *
 * The same split `layout-dom-leak-5574.test.tsx` next door describes, applied
 * to the other mechanism group. `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx`
 * is the gate for this class and the stronger instrument for the OPEN TAIL — it
 * plants canary keys no schema declares. What it does not plant are the
 * renderer's OWN DECLARED PROPS: its canary node authors no `inputType`, no
 * `options`, no `buttonText`. Adding them there would rewrite the measured
 * attribute set of the 97 renderers still ledgered, i.e. destroy the arrival
 * reading that file exists to preserve.
 *
 * So the declared-prop half is measured HERE, at catalog scale, on real authored
 * nodes — and for this group it is most of the reading: `button[label]` alone is
 * 140 of the 284 attributes measured before the fix, and `label` is a key
 * `ButtonRenderer` CONSUMES off `schema` to render the button's text before
 * forwarding it to the element as well.
 *
 * ## Why the shared judge, and not this file's own `isLegitimate`
 *
 * The layout probe next door hand-rolls a six-line legitimacy test. It can,
 * because every host it measures is a `<div>`. This group's hosts are
 * `<input>`, `<textarea>` and `<button>`, where legitimacy is ELEMENT-SPECIFIC:
 * `name` and `disabled` are real attributes on a control and leaks on a
 * container, and `value` / `placeholder` / `checked` / `min` / `step` are legal
 * on some controls and not others. A hand-rolled list would either report the
 * legitimate ones (noise that makes a zero unreachable) or allow them
 * everywhere (a hole exactly where this group lives). `@object-ui/test-support`'s
 * judge already answers per element, by IDL reflection, and is the one the sweep
 * gate grades with — so this file uses it rather than becoming a second judge
 * with a different opinion (objectui#4434).
 *
 * ## Designing against the failure mode this test could have
 *
 * A zero here means nothing on its own: a renderer that renders NOTHING spreads
 * nothing and reads clean, and so does a walk that found no nodes. Both are how
 * a broken instrument reports a healthy tree. Three guards:
 *
 *   1. NODE COUNTS are asserted, per type, against the census below — and the
 *      census was read IDENTICAL in the before and after runs, so the after-zero
 *      is a reading and not a walk that stopped finding nodes.
 *   2. `ui:grid` is measured in the same list as a CONTROL. It was converged by
 *      objectui#4787 / PR #5573 and reads 0 in every configuration of this test,
 *      so on its own it discriminates nothing; what it does is read 0 in the
 *      SAME run in which its 15 unconverged siblings read 284, which is what
 *      says the instrument was not blind. A control that runs somewhere else is
 *      not a control.
 *   3. The JUDGE is self-checked, and in the direction this file depends on:
 *      that it is ELEMENT-AWARE. A judge that simply allowed `name` everywhere
 *      would pass every assertion below and hide the whole group.
 *
 * ## Why each node is rendered without its children
 *
 * `findLeaks` walks the whole subtree, so a node's nested SDUI children get
 * their leaks attributed to the parent. Measured, before the fix: scanning
 * subtrees put 61 attributes on `grid` — the CONTROL — every one of them from a
 * child `ui:icon` / `ui:button` / `ui:label` belonging to a different mechanism
 * group. That is not a control any more, it is a mixture. Rendering each node
 * with `children` / `body` removed scopes the reading to the renderer's own
 * markup; nothing is lost, because the walk below collects nested nodes of the
 * measured types separately and renders each on its own turn.
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

/**
 * The fourteen `ui:` members of objectui#5632's group that the catalog authors,
 * plus `grid` as the control (see guard 2 above).
 *
 * Three of the group's eighteen members are absent because the catalog contains
 * no node of them: `ui:sonner`, and the two `action:` types — `action:button`
 * and `action:icon` are reached through an `action:bar`'s `actions` array rather
 * than as nodes carrying their own `type`, so a `type`-keyed walk cannot find
 * them at all. All three are covered by the sweep gate, which is registry-driven
 * and needs no authored node; this file is the DECLARED-PROP half only, and its
 * scope is what the catalog actually contains.
 *
 * A fourth, `ui:sidebar-menu-button`, left with objectui#10859 batch 8 phase 2d:
 * its node key is retired, and the four `components-basic-sidebar` documents
 * that authored its 15 nodes now author the `sidebar` node, with `button`
 * children for their items.
 */
const MEASURED_TYPES = [
  'button', 'input', 'checkbox', 'switch', 'textarea', 'combobox', 'date-picker',
  'email', 'password', 'file-upload', 'input-otp', 'radio-group', 'slider',
  'toggle',
  'grid',
] as const;

/**
 * Nodes of each type in the catalog today, and how many of them render no
 * element at all. Asserted, so a zero leak reading is always accompanied by
 * proof that something was actually rendered to read.
 *
 * These move when the CATALOG is authored, not when a renderer changes. A diff
 * that changes these numbers and nothing else is an example being added; update
 * them. A diff that changes them while touching a renderer is the thing this
 * guard is for — `noElement` in particular, because a renderer made to bail
 * early reads CLEAN below and has earned nothing.
 */
const NODE_CENSUS: Readonly<Record<string, { rendered: number; noElement: number }>> = {
  // 140 -> 126 with objectui#6250: the fourteen `components-feedback-toast/*`
  // and `components-feedback-sonner/*` demos were `type: 'button'` nodes
  // carrying an action object on `onClick`, and are now the registered
  // `toast` / `sonner` nodes their own renderers execute. Catalog-authored,
  // no renderer touched — the case this table's header sanctions.
  //
  // 126 -> 118 with objectui#7693: the four `components-overlay-alert-dialog/*`
  // fixtures each authored two `type: 'button'` nodes under an `actions` array
  // the `alert-dialog` renderer never reads, so those eight nodes drew nothing
  // and the demos showed an empty footer. They are now the two label keys the
  // renderer DOES read (`cancelText` / `actionText`), which are strings rather
  // than nodes and so leave this walk. Catalog-authored, no renderer touched —
  // the case this table's header sanctions.
  //
  // 118 -> 116 with objectui#3906: the PageHeader docs demo was a `page-header`
  // alias node carrying two `type: 'button'` children, and is now the canonical
  // `page:header` node, which draws no children (the contract refuses the key
  // on it), so the demo authors none. Catalog-authored, no renderer touched —
  // the case this table's header sanctions.
  //
  // 116 -> 127 with objectui#10859 batch 8 phase 2d: the four
  // `components-basic-sidebar` documents composed the retired `sidebar-*`
  // primitives, and now author one `sidebar` node whose items are eleven
  // `type: 'button'` nodes (basic 4, grouped 4, collapsible 3; the badge
  // demo's items are `flex` rows). Catalog-authored — the `sidebar-menu-button`
  // row they replace left the table with them.
  button: { rendered: 127, noElement: 0 },
  input: { rendered: 48, noElement: 0 },
  checkbox: { rendered: 12, noElement: 0 },
  switch: { rendered: 7, noElement: 0 },
  textarea: { rendered: 9, noElement: 0 },
  combobox: { rendered: 5, noElement: 0 },
  'date-picker': { rendered: 7, noElement: 0 },
  email: { rendered: 2, noElement: 0 },
  password: { rendered: 4, noElement: 0 },
  'file-upload': { rendered: 7, noElement: 0 },
  'input-otp': { rendered: 5, noElement: 0 },
  'radio-group': { rendered: 8, noElement: 0 },
  slider: { rendered: 1, noElement: 0 },
  toggle: { rendered: 17, noElement: 0 },
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

describe('schema-catalog — no form-control renderer leaks an authored prop to the DOM (#5632)', () => {
  it('the judge is element-aware — a zero below is a reading, not a blind spot', () => {
    // Rendered directly rather than through the registry: this checks the
    // JUDGE, and it must keep working even if every renderer in the repo is
    // fixed. Without it, `findLeaks` could return `[]` unconditionally and every
    // assertion in this file would still pass.
    //
    // The bag is spread rather than written as JSX attributes, which is not a
    // typing dodge but the defect's own shape: `<div name="x" label="y">` does
    // not type-check, and a bare spread of an untyped record is exactly how
    // these attributes got onto real elements without anyone hearing about it.
    const bag: Record<string, unknown> = {
      className: 'c',
      id: 'i',
      'data-obj-id': 'd',
      name: 'canary_node',
      disabled: true,
      label: 'L',
      inputtype: 'text',
    };

    // On a CONTROL, `name` and `disabled` are real attributes and only the two
    // undeclared keys are leaks. This is the half of the judge objectui#5632
    // depends on: it is why `name` was never in the eighteen deleted rows, and
    // therefore why forwarding it is not a regression this file can see.
    const control = render(<input {...bag} />);
    expect(
      findLeaks(control.container.firstElementChild!)
        .map((leak) => leak.attribute)
        .sort(),
    ).toEqual(['inputtype', 'label']);

    // On a CONTAINER the same bag leaks `name` and `disabled` too — the judge
    // answers per element rather than from one flat list. A judge that did not
    // would report `[]` for the whole group and this file would be vacuous.
    const container = render(<div {...bag} />);
    expect(
      findLeaks(container.container.firstElementChild!)
        .map((leak) => leak.attribute)
        .sort(),
    ).toEqual(['disabled', 'inputtype', 'label', 'name']);
  });

  it('every catalog node of these fifteen types renders, and none leaks', () => {
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
        // children" above. `SidebarProvider` was the one React host this set
        // needed: `ui:sidebar-menu-button` read `useSidebar()` and THREW
        // without it, and a caught throw renders attribute-clean markup that
        // reads as a clean pass (the sweep gate's trap 3, at catalog scale).
        // That key retired with objectui#10859 batch 8 phase 2d; the host
        // stays, so the render context of the types still measured is
        // unchanged.
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
      'an authored schema prop reached the DOM as an HTML attribute. Route the ' +
        'spread through `toFormControlDomProps` ' +
        '(`packages/components/src/lib/form-control-dom-props.ts`) — never ' +
        'widen that declaration and never add an exemption here. A key that ' +
        'genuinely belongs on this control is DECLARED and forwarded BY NAME ' +
        '(objectui#4435), the way `style` is at every call site.',
    ).toEqual([]);
  }, 120000);
});
