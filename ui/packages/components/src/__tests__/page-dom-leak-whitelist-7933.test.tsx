/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * PIN: the `page` wrapper carries only what may legitimately be a DOM
 * attribute, and an UNDECLARED authored key is DROPPED — never stringified
 * onto the element (objectui#7933).
 *
 * ## The defect
 *
 * `PageRenderer` used to strip PageSchema's descriptor keys with a
 * hand-maintained destructure list and spread the remainder onto its wrapper
 * `<div>`, under a comment instructing the next reader to "keep this list
 * aligned with PageSchema". The alignment is what failed. React forwards an
 * unknown lowercase attribute in complete silence and stringifies object
 * values, so a key the list did not name did not fail loudly — it landed:
 *
 *     class="min-h-full w-full bg-background p-3 md:p-4 lg:p-6"
 *     data-page-type="record"
 *     data-obj-type="page"
 *     actions="[object Object],[object Object]"      <- the defect
 *
 * When this pin was written, `actions` was declared nowhere on `PageNodeSchema`
 * (it survived parse only through `BaseSchema`'s `.passthrough()`) and
 * `PageRenderer` had zero read points for it, so it was neither read nor
 * dropped. That capability question has since been ANSWERED: objectui#7926 was
 * ruled 2026-09-09 (decision batch #107 item 2, option A) — `page` grows NO
 * `actions` reader, and `PageNodeSchema` now REFUSES the key by name
 * (`packages/types/src/__tests__/page-actions-refusal-7926.test.ts`).
 *
 * ⭐ This pin is unchanged by that, and deliberately so: it renders rather than
 * parses, so it still measures the DOM outcome for a document the validator now
 * rejects — which is the case that matters, because a host can hand
 * `SchemaRenderer` a node that never went through `safeParse`. An authored key
 * must end up either read or dropped, and never as an illegal HTML attribute.
 *
 * ## Why this is a whitelist and not a longer list
 *
 * The set of keys an author may put on a node is unbounded; the set a widget
 * may put on an element is declared. A deny-list bounded by enumeration cannot
 * be finished — which is the objectui#4425 ruling, and why `toDomProps` lives
 * in `@object-ui/core` as ONE executor for every converged SDUI surface. This
 * renderer was one of the last faces still closing the leak with an
 * enumeration of its own.
 *
 * ## What the two halves of this file prove, and why BOTH are needed
 *
 *  - {@link LEGITIMATE_ATTRIBUTES} drives the POSITIVE half: nothing outside
 *    that declared set reaches the wrapper. Restoring the hand-maintained
 *    destructure list turns this red and prints the leaked attribute names.
 *  - The NEGATIVE half asserts the attributes the wrapper genuinely needs are
 *    still THERE. A whitelist is a dropping mechanism, so "the leak is gone"
 *    is half a measurement: a fix that also dropped `class`, `style` or
 *    `data-page-type` would satisfy the positive half completely while
 *    trading one bug for a worse one. `style` in particular is NOT on the
 *    element-agnostic whitelist — it survives only because the renderer
 *    forwards it by name — so nothing but this half is watching it.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
// Module scope, not a hook: registers PageRenderer under all five of its
// registry keys. A cold `await import()` inside a hook is billed to
// `hookTimeout` and races the assertions (AGENTS.md §测试纪律, objectui#3010).
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
import '../renderers';

/** The five registry keys `PageRenderer` is registered under. */
const PAGE_REGISTRY_KEYS = ['page', 'app', 'home', 'utility', 'record'] as const;

/**
 * Everything the wrapper `<div>` may legitimately carry. Declared here rather
 * than derived from the render, so this file states an EXPECTATION instead of
 * echoing whatever the code happens to emit.
 *
 * `class` / `style` are the renderer's own; `data-page-type`, `data-obj-id`
 * and `data-obj-type` are the debug/designer channel it forwards by name; the
 * rest are `@object-ui/core`'s SDUI pass-through set (`id`, `role`,
 * `tabindex`) plus the open `data-*` / `aria-*` families.
 */
const LEGITIMATE_ATTRIBUTES = new Set([
  'class',
  'style',
  'id',
  'role',
  'tabindex',
  'data-page-type',
  'data-obj-id',
  'data-obj-type',
]);

const isOpenFamily = (name: string) => name.startsWith('data-') || name.startsWith('aria-');

/**
 * A page node authoring the reported instance verbatim, plus the other key
 * shapes measured leaking on this tree — an object value, a scalar, a spec key
 * with no read point, and the `context` bag `app-shell`'s `PageView` injects
 * into EVERY page it renders (so the leak did not need an unusual author to
 * appear in production).
 */
function canaryPage(registryKey: string) {
  return {
    type: registryKey,
    pageType: registryKey === 'page' ? 'record' : registryKey,
    label: 'Products',
    regions: [
      { name: 'main', width: 'full', components: [{ type: 'element:text', properties: { text: 'body' } }] },
    ],

    /* ── undeclared / unread keys: every one of these must be DROPPED ────── */
    // The reported instance (objectui#7933 / objectui#7926).
    actions: [
      { type: 'button', label: 'Add Product' },
      { type: 'button', label: 'Export' },
    ],
    // Declared on `PageNodeSchema` but with no read point on this wrapper.
    slots: { header: [] },
    // Host-injected, not authored: `PageView.tsx` adds this to every page.
    context: { params: {}, refreshKey: 0 },
    // Scalars — these leak as readable-but-illegal attributes rather than
    // `[object Object]`, which is the shape easiest to mistake for intentional.
    name: 'product_page',
    pageName: 'products',
    // Internal synth metadata: the `_` prefix used to need its own filter.
    _packageId: 'pkg_products',

    /* ── legitimate: every one of these must SURVIVE ─────────────────────── */
    // `data-obj-id` / `data-obj-type` are NOT authored here on purpose:
    // `SchemaRenderer` derives them from the node's `id` and `type`
    // (SchemaRenderer.tsx, `'data-obj-id': evaluatedSchema.id`), so authoring
    // them would assert a value the pipeline overwrites.
    id: 'page_products',
    role: 'region',
    tabIndex: -1,
    style: { minHeight: '100vh' },
    'data-testid': 'products-page',
    'aria-label': 'Products page',
  } as unknown as Parameters<typeof SchemaRenderer>[0]['schema'];
}

function renderWrapper(registryKey: string): HTMLElement {
  const { container } = render(
    <ActionProvider>
      <SchemaRenderer schema={canaryPage(registryKey)} />
    </ActionProvider>,
  );
  const wrapper = container.querySelector<HTMLElement>('[data-page-type]');
  // A missing wrapper would make every assertion below vacuously true.
  expect(wrapper, `PageRenderer rendered no [data-page-type] wrapper for type:'${registryKey}'`).not.toBeNull();
  return wrapper as HTMLElement;
}

describe("PageRenderer — the wrapper's DOM attributes are a whitelist (objectui#7933)", () => {
  it.each(PAGE_REGISTRY_KEYS)(
    "type:'%s' — an undeclared authored key never reaches the wrapper as an attribute",
    (registryKey) => {
      const wrapper = renderWrapper(registryKey);
      const illegitimateAttributes = [...wrapper.attributes]
        .map((a) => a.name)
        .filter((name) => !LEGITIMATE_ATTRIBUTES.has(name) && !isOpenFamily(name))
        .sort();

      // Compared as a labelled object so a failure NAMES ITSELF: the report
      // carries the pin, the exact element it read, and the leaked attribute
      // names — not a bare "expected [] to equal [...]".
      expect({
        pin: 'objectui#7933 — page wrapper DOM pass-through whitelist',
        surface: `PageRenderer wrapper <div data-page-type> for registry key '${registryKey}'`,
        illegitimateAttributes,
      }).toEqual({
        pin: 'objectui#7933 — page wrapper DOM pass-through whitelist',
        surface: `PageRenderer wrapper <div data-page-type> for registry key '${registryKey}'`,
        illegitimateAttributes: [],
      });

      // The reported instance, asserted by name as well as by the set above —
      // so the regression that reopened THIS card is legible on its own.
      expect(wrapper.getAttribute('actions')).toBeNull();
      expect(wrapper.outerHTML).not.toContain('[object Object]');
    },
  );

  it.each(PAGE_REGISTRY_KEYS)(
    "type:'%s' — NEGATIVE CONTROL: the attributes the wrapper needs are still delivered",
    (registryKey) => {
      const wrapper = renderWrapper(registryKey);

      // The renderer's own styling channel and its debug/designer attributes.
      expect(wrapper.getAttribute('class')).toContain('min-h-full');
      expect(wrapper.getAttribute('class')).toContain('bg-background');
      expect(wrapper.getAttribute('data-page-type')).toBe(
        registryKey === 'page' ? 'record' : registryKey,
      );
      // Derived by `SchemaRenderer` from the node's `id` / `type`, then
      // forwarded by name here; they must survive the whitelist either way.
      expect(wrapper.getAttribute('data-obj-id')).toBe('page_products');
      expect(wrapper.getAttribute('data-obj-type')).toBe(registryKey);
      // Forwarded BY NAME, not by the whitelist — the one legitimate attribute
      // a whitelist-only fix would silently drop.
      expect(wrapper.style.minHeight).toBe('100vh');

      // The SDUI pass-through set, which a blunter fix would have taken out.
      expect(wrapper.getAttribute('id')).toBe('page_products');
      expect(wrapper.getAttribute('role')).toBe('region');
      expect(wrapper.getAttribute('tabindex')).toBe('-1');

      // The two open families stay open.
      expect(wrapper.getAttribute('data-testid')).toBe('products-page');
      expect(wrapper.getAttribute('aria-label')).toBe('Products page');
    },
  );
});
