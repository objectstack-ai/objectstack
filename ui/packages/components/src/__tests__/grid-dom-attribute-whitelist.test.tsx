/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:grid` forwards to the DOM by WHITELIST (objectui#4787).
 *
 * ## What is being observed, and why the obvious test is worthless here
 *
 * The observable is the RENDERED DOM, not the React tree. `SchemaRenderer` spreads
 * the authored node onto the registered component, and `grid.tsx` used to end in a
 * bare `{...gridProps}` spread onto its `<div>`, so the node's own vocabulary landed
 * as invalid HTML attributes. Measured on `origin/main` with the canary node below:
 *
 * ```
 * <div class="grid grid-cols-4 …" columns="4" gap="4" mdcolumns="2" smcolumns="2"
 *      id="grid-node" name="grid_node" props="[object Object]" zzcanary="leak"
 *      data-testid="g" aria-label="A grid" role="region" colorvariant="x"
 *      data-obj-id="grid-node" data-obj-type="grid"></div>
 * ```
 *
 * Every one of those renders. "The grid renders" is GREEN against the broken code —
 * every catalog grid example rendered today, wrong attributes and all. So the
 * assertion has to be that the offending attributes are ABSENT from the element.
 *
 * ## Why case 1 sweeps every attribute instead of naming the bad ones
 *
 * Naming `columns` / `gap` / `mdcolumns` would pass just as well against a renderer
 * that strips those four and keeps leaking the rest, and it would re-rot the moment
 * `GridSchema` grows a key — the exact staleness this defect IS. It also could never
 * reach the OPEN TAIL: `zzcanary` and the flattened `props` container are
 * author-supplied, so no finite list of schema keys names them. Case 1 therefore
 * asserts the whole attribute set against what the contract DECLARES as DOM-safe, so
 * a key added to `GridSchema` tomorrow is covered without editing this file.
 *
 * ## The positive control is load-bearing
 *
 * A renderer that stripped EVERYTHING would satisfy the absence assertions on its
 * own. Case 2 pins what must still arrive — the computed grid classes, the authored
 * `className` merged with them, `id`, `role`, the `data-*` / `aria-*` families
 * (including the designer's `data-obj-id` / `data-obj-type`), the forwarded `style`,
 * and the children — so "strips everything" fails here even while case 1 passes.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
// Registered at module scope, NOT in a `beforeAll` — there the cold transform is
// billed to the narrower `hookTimeout` (AGENTS.md 测试纪律, objectui#3010/#3021).
import '../renderers';

/**
 * Attribute names legal on the `<div>` this renderer produces: the exact keys
 * `@object-ui/core`'s SDUI pass-through set declares (lowercased, as the DOM stores
 * them — `className` becomes `class`, `tabIndex` becomes `tabindex`), plus `style`,
 * which `grid.tsx` forwards by name as its designer sizing channel.
 */
const ALLOWED_EXACT = new Set(['class', 'id', 'role', 'tabindex', 'autofocus', 'style']);

/** `data-*` and `aria-*` are open families in HTML and in the widget contract. */
const isAllowedAttribute = (name: string): boolean =>
  ALLOWED_EXACT.has(name) || name.startsWith('data-') || name.startsWith('aria-');

/**
 * A grid node carrying, deliberately, one of every category the leak drew from:
 * the renderer's own vocabulary, the four flat column keys it used to read,
 * SDUI node metadata, the `props` container, an unknown authored key, and the
 * legitimately forwarded DOM channels.
 */
const CANARY_NODE = {
  type: 'grid',
  // Renderer vocabulary — CONSUMED off `schema`, never forwarded.
  columns: 4,
  gap: 4,
  // The flat column keys, retired by objectui#11505: both zod faces refuse
  // them by name, and the renderer no longer reads them. They stay in the
  // canary because a document that skipped validation still carries them, and
  // they must reach the DOM no more than any other key the renderer ignores.
  smColumns: 2,
  mdColumns: 2,
  lgColumns: 3,
  xlColumns: 6,
  // SDUI node metadata `SchemaRenderer` hands down.
  name: 'grid_node',
  // The `props` container, whose contents get flattened onto the component.
  props: { colorVariant: 'x' },
  // The open tail: an authored key nothing declares.
  zzcanary: 'leak',
  // Legitimate DOM channels — the positive control.
  id: 'grid-node',
  className: 'authored-class',
  role: 'region',
  'aria-label': 'A grid',
  'data-testid': 'grid-el',
  children: [],
} as const;

function renderCanary(overrides: Record<string, unknown> = {}) {
  const { container } = render(
    <SchemaRenderer schema={{ ...CANARY_NODE, ...overrides } as never} />,
  );
  const el = container.firstElementChild as HTMLElement;
  expect(el, 'the canary grid must render at all').not.toBeNull();
  return el;
}

const attributeNames = (el: HTMLElement) => Array.from(el.attributes).map((a) => a.name);

describe('ui:grid — schema keys never reach the DOM (objectui#4787)', () => {
  it('case 1: no attribute outside the declared DOM-safe set survives', () => {
    const el = renderCanary();

    // The whole set, judged against the contract rather than against a list of
    // today's bad keys. The failure message carries the leaked names.
    expect(attributeNames(el).filter((n) => !isAllowedAttribute(n))).toEqual([]);

    // The named regressions from the card, spelled out so a future failure reads as
    // this defect rather than as an anonymous set difference. `mdColumns` reaches the
    // DOM lowercased (HTML attribute names are case-insensitive), which is why the
    // card records it as `mdcolumns`.
    for (const leaked of [
      'columns', 'gap', 'smcolumns', 'mdcolumns', 'lgcolumns', 'xlcolumns',
      'name', 'props', 'zzcanary', 'colorvariant',
    ]) {
      expect(el.hasAttribute(leaked), `"${leaked}" must not reach the DOM`).toBe(false);
    }

    // The headline symptom: an object stringified onto an attribute. Assert on the
    // serialized element so this cannot pass by the attribute merely being renamed.
    expect(el.outerHTML).not.toContain('[object Object]');
  });

  it('case 1b: a responsive `columns` OBJECT does not become columns="[object Object]"', () => {
    // The canary's flat `smColumns`/`mdColumns`/… keys are read by nothing since
    // objectui#11505, so they stay on the node: the object path drives the
    // classes alone. Until then they OVERRODE the object form, and this case
    // had to clear them.
    const el = renderCanary({ columns: { xs: 1, md: 3 } });

    expect(el.hasAttribute('columns')).toBe(false);
    expect(el.outerHTML).not.toContain('[object Object]');
    expect(attributeNames(el).filter((n) => !isAllowedAttribute(n))).toEqual([]);
    // Still CONSUMED: the object form drives the classes it always did.
    expect(el.className).toContain('grid-cols-1');
    expect(el.className).toContain('md:grid-cols-3');
  });

  it('case 2: positive control — everything legitimately forwarded still arrives', () => {
    const el = renderCanary({
      style: { minHeight: '10px' },
      children: [{ type: 'text', content: 'child-marker' }],
    });

    // Computed layout classes — the renderer's real output, merged with the
    // authored className. A filter that dropped `className` would fail here.
    // The bare `columns: 4` draws its mobile-first ramp: the canary's flat
    // `mdColumns: 2` is read by nothing (objectui#11505), so `md` is the bare
    // count, not the flat one.
    expect(el.className).toContain('grid');
    expect(el.className).toContain('sm:grid-cols-2');
    expect(el.className).toContain('md:grid-cols-4');
    expect(el.className).not.toContain('md:grid-cols-2');
    expect(el.className).toContain('gap-4');
    expect(el.className).toContain('authored-class');

    // Declared global attributes.
    expect(el.getAttribute('id')).toBe('grid-node');
    expect(el.getAttribute('role')).toBe('region');

    // The two open families, including the designer channel that used to be
    // hand-forwarded and now arrives through the `data-*` prefix rule.
    expect(el.getAttribute('aria-label')).toBe('A grid');
    expect(el.getAttribute('data-testid')).toBe('grid-el');
    expect(el.getAttribute('data-obj-id')).toBe('grid-node');
    expect(el.getAttribute('data-obj-type')).toBe('grid');

    // `style`, forwarded by name.
    expect(el.style.minHeight).toBe('10px');

    // And the container still contains things.
    expect(el.textContent).toContain('child-marker');
  });

  /**
   * The card's side-question, pinned as far as it can honestly be pinned.
   *
   * React DOES warn here — but only for the CAMEL-CASE keys (`mdColumns`,
   * `smColumns`, `colorVariant`): "React does not recognize the `%s` prop on a DOM
   * element. If you intentionally want it to appear in the DOM as a custom
   * attribute, spell it as lowercase `%s` instead." Measured on `origin/main`: eight
   * attributes leaked, three `console.error` calls. The all-lowercase ones —
   * `columns`, `gap`, `name`, `props`, `zzcanary`, and both attributes the card's
   * title names — produce NO warning at all, because React passes unknown lowercase
   * attributes through by design and stringifies object values silently.
   *
   * So this case is the WEAKER half and is kept only as a noise-floor ratchet on this
   * renderer: it can catch a camelCase key being reopened, and it is blind to the
   * majority of the very defect it accompanies. Case 1 is what actually closes the
   * class, because it reads the DOM instead of the console. Do not let this case's
   * green be read as coverage.
   *
   * Note it must SPY rather than rely on the run's output: Vitest 4's reporter
   * defaults to `silent: 'passed-only'`, so console output from a passing test is
   * discarded — the third reason this warning could never have turned a test red on
   * its own.
   *
   * And it must use a camelCase canary key of its OWN (`zzCanaryCamel`, authored
   * nowhere else in this file). React latches the unknown-prop warning per prop NAME
   * per module instance, so it fires only on the FIRST render that carries a given
   * key. Written against the shared canary this case PASSED against the broken
   * renderer — cases 1 and 1b render first and consume the latch for every key they
   * carry, leaving nothing for the spy to see. That is measured, not theorized: it is
   * how this case was first written, and reverse-verification caught it green on code
   * that leaked ten attributes. A unique key makes the case independent of order.
   * The latch is also the fourth reason the warning is useless as a gate.
   */
  it('case 3: React emits no unknown-prop warning for this renderer any more', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderCanary({ zzCanaryCamel: 'leak' });
      const unknownPropWarnings = errSpy.mock.calls.filter((args) =>
        /does not recognize the .* prop on a DOM element/.test(String(args[0])),
      );
      expect(unknownPropWarnings).toEqual([]);
    } finally {
      errSpy.mockRestore();
    }
  });
});
