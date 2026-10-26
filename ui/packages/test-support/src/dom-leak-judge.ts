/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE DOM-LEAK JUDGE: is this attribute one HTML actually defines?
 *
 * One judge, shared by every DOM-leak gate in the repo (objectui#4434). It
 * answers exactly one question — given an element and an attribute name, is
 * that attribute something HTML/SVG defines for that element, or does it only
 * exist because a non-DOM prop was spread onto the element? — and it knows
 * nothing about widgets, canaries, targets or ledgers. Those stay in each gate.
 *
 * ## Why it lives here instead of in a test file
 *
 * It used to live twice, inline, in two test files that cannot import each
 * other:
 *
 *   - `packages/fields/src/__tests__/widget-dom-leak-e2e.test.tsx` (#3291, the
 *     original)
 *   - `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx` (#4425
 *     phase 1, the generalized sweep)
 *
 * The copies had ALREADY diverged when objectui#4434 was filed: the sweep's SVG
 * list carried ten recharts presentation attributes the fields copy never
 * needed, and the two `findLeaks` records truncated differently. What this
 * module encodes is measured ENVIRONMENT fact — happy-dom's IDL gaps, the SVG
 * presentation surface, the open attribute families — so it drifts whenever
 * happy-dom, lucide or recharts is upgraded. Discovering that drift twice, in
 * two places, is how one judge silently becomes two disagreeing judges.
 *
 * The knowledge below is therefore the UNION of the two copies, and the
 * calibration fixtures that prove it live next door in
 * `__tests__/dom-leak-judge.test.tsx` — once, rather than once per gate.
 *
 * ## Where the line is
 *
 * This module holds exactly what was DUPLICATED, and nothing else. Canary
 * sets, target enumerations, readiness selectors, the sweep's leak ledger and
 * every assertion stay in the gate that owns them — including helpers that
 * only ever existed in one gate (`leakedAttributeNames` is the sweep's ledger
 * unit and stays there). A judge that starts accumulating one gate's policy is
 * back to being two judges wearing one name.
 *
 * ## The mechanism, and why it is reflection rather than a table
 *
 * The core check is IDL reflection: "does this element's prototype chain carry
 * a property with this name, case-insensitively?". That covers
 * `readonly→readOnly`, `maxlength→maxLength`, `colspan→colSpan` and every other
 * per-tag attribute automatically, instead of a hand-kept table per element
 * type that would rot. Everything else in this file is the measured exceptions
 * where reflection alone gives the wrong answer.
 */

/**
 * Open families. `data-*` is the one open family the widget contract declares.
 */
export const OPEN_PREFIXES: readonly string[] = [
  'data-',
  'aria-',
  // `cmdk-root` / `cmdk-input` / `cmdk-list` … are marks the cmdk library puts
  // on ITS OWN DOM. Not prop pass-through, and present on every cmdk-based
  // picker (`object-ref`, `lookup`, …) the moment it renders.
  'cmdk-',
];

/**
 * Global HTML attributes, legitimate on any element. Most are also IDL
 * properties and would be caught by the reflection check below; they are listed
 * because a missing IDL for a genuinely global attribute would otherwise read
 * as a leak.
 */
export const GLOBAL_HTML_ATTRIBUTES: ReadonlySet<string> = new Set([
  'id', 'class', 'style', 'title', 'lang', 'dir', 'hidden', 'tabindex', 'role',
  'slot', 'part', 'exportparts', 'itemid', 'itemprop', 'itemref', 'itemscope',
  'itemtype', 'translate', 'draggable', 'spellcheck', 'autocapitalize',
  'autocorrect', 'contenteditable', 'enterkeyhint', 'inputmode', 'accesskey',
  'nonce', 'is', 'popover', 'inert', 'autofocus',
]);

/**
 * Attributes whose IDL property is spelled differently enough that the
 * case-insensitive reflection match below cannot find them.
 */
export const ATTRIBUTE_TO_IDL_ALIAS: Readonly<Record<string, string>> = {
  'class': 'className',
  'for': 'htmlFor',
  'accept-charset': 'acceptCharset',
  'http-equiv': 'httpEquiv',
};

/**
 * MEASURED gaps in happy-dom's IDL, kept deliberately tiny — each entry is an
 * attribute HTML defines that happy-dom's element does not reflect as a
 * property, so reflection alone would report it as a leak.
 *
 * Every one of these was found BY the calibration fixture next door, not by
 * guesswork, and the fixture is what fails loudly when a happy-dom upgrade
 * changes IDL coverage in either direction.
 */
export const HAPPY_DOM_IDL_GAPS: Readonly<Record<string, ReadonlySet<string>>> = {
  // `HTMLSelectElement.size` is standard; happy-dom does not define it.
  select: new Set(['size']),
  // `HTMLOptionElement.label` is standard; happy-dom does not define it.
  option: new Set(['label']),
  // `HTMLTextAreaElement.wrap` is standard; happy-dom does not define it.
  textarea: new Set(['wrap']),
  // `HTMLTableColElement.span` is standard; happy-dom does not define it.
  col: new Set(['span']),
  colgroup: new Set(['span']),
};

/**
 * SVG needs its own list: the reflection trick does NOT hold for SVG under
 * happy-dom (`SVGElement` reflects almost nothing), and the icon/chart
 * libraries put a fixed set of presentation attributes on the markup they
 * render.
 *
 * Two producers, one list. The first block is what lucide icons emit — the
 * only SVG the `packages/fields` gate ever renders. The second block is
 * recharts' marker/gradient/pattern markup, which only the app-shell sweep
 * renders; it is the divergence objectui#4434 was filed for, and the union is
 * what makes one judge serve both gates.
 */
export const SVG_ATTRIBUTES: ReadonlySet<string> = new Set([
  'xmlns', 'xmlns:xlink', 'version', 'viewbox', 'preserveaspectratio',
  'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx',
  'ry', 'd', 'points', 'transform', 'fill', 'fill-rule', 'fill-opacity',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
  'clip-path', 'clip-rule', 'mask', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'patternunits', 'text-anchor',
  'dominant-baseline', 'font-size', 'font-family', 'font-weight',
  'vector-effect', 'shape-rendering', 'focusable', 'overflow', 'color',
  // recharts markup — the sweep-only half of the union (objectui#4434).
  'orient', 'refx', 'refy', 'markerwidth', 'markerheight', 'markerunits',
  'patterncontentunits', 'spreadmethod', 'gradientscale', 'pathlength',
]);

/** Lowercased IDL property names on a tag's prototype chain, cached per tag. */
const idlCache = new Map<string, Set<string>>();

function idlPropertiesFor(tagName: string): Set<string> {
  const tag = tagName.toLowerCase();
  const cached = idlCache.get(tag);
  if (cached) return cached;

  const names = new Set<string>();
  const element = document.createElement(tag);
  for (const own of Object.getOwnPropertyNames(element)) names.add(own.toLowerCase());
  for (
    let proto = Object.getPrototypeOf(element);
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name.toLowerCase());
  }
  idlCache.set(tag, names);
  return names;
}

/**
 * The rule: an attribute is legitimate when HTML/SVG defines it for that
 * element, or when it belongs to an open family.
 *
 * The reflection check ("does the element's prototype chain carry a property
 * with this name, case-insensitively?") is what makes this maintainable — it
 * covers `readonly→readOnly`, `maxlength→maxLength`, `colspan→colSpan` and
 * every other per-tag attribute automatically, instead of a hand-kept table
 * per element type that would rot.
 */
export function isKnownAttribute(element: Element, attribute: string): boolean {
  const name = attribute.toLowerCase();

  if (OPEN_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;

  // Inline event handlers (`onclick`) reflect as IDL properties on every
  // element; React never emits them as attributes, so reaching one means a
  // handler-shaped prop was stringified onto the DOM. Treat as a leak.
  if (name.startsWith('on')) return false;

  const tag = element.tagName.toLowerCase();

  if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
    return SVG_ATTRIBUTES.has(name) || GLOBAL_HTML_ATTRIBUTES.has(name);
  }

  if (GLOBAL_HTML_ATTRIBUTES.has(name)) return true;
  if (HAPPY_DOM_IDL_GAPS[tag]?.has(name)) return true;

  const idl = idlPropertiesFor(tag);
  const alias = ATTRIBUTE_TO_IDL_ALIAS[name];
  if (alias && idl.has(alias.toLowerCase())) return true;
  return idl.has(name);
}

/** One unexplained attribute, with enough context to name it in a failure. */
export interface Leak {
  tag: string;
  attribute: string;
  value: string;
  outerHTML: string;
}

/**
 * How much of a leaked value and its markup a {@link Leak} record keeps.
 *
 * The two copies disagreed here and neither bound is load-bearing for any
 * assertion — both gates assert on attribute NAMES, so these numbers only
 * shape the failure message. The union takes the defensive answer on each
 * axis: the value is BOUNDED (the fields copy kept it whole, and a leaked
 * value can be an arbitrarily long serialized object), and the markup keeps
 * the WIDER of the two bounds, because the markup is what tells you which
 * element in a 46-widget sweep produced the finding.
 */
const VALUE_CHARS = 80;
const OUTER_HTML_CHARS = 400;

/** Every unexplained attribute on `root` and its descendants. */
export function findLeaks(root: Element): Leak[] {
  const leaks: Leak[] = [];
  const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (isKnownAttribute(element, attribute.name)) continue;
      leaks.push({
        tag: element.tagName.toLowerCase(),
        attribute: attribute.name,
        value: attribute.value.slice(0, VALUE_CHARS),
        outerHTML: element.outerHTML.slice(0, OUTER_HTML_CHARS),
      });
    }
  }
  return leaks;
}

/**
 * Renders the findings as the assertion's "actual" value, so a failure names
 * the element, the attribute, its value and the markup. A 46-widget sweep
 * failing as `expected [] to equal [ …47 items ]` is unusable.
 *
 * `label` is whatever identifies the thing being scanned to the gate that owns
 * it — the fields gate passes `field:<type> [<variant>]`, the app-shell sweep
 * passes the registry type. Unifying on one label parameter is what let both
 * call sites keep the exact message they produced before.
 */
export function leakReport(label: string, leaks: readonly Leak[]): string {
  if (leaks.length === 0) return '';
  const lines = leaks.map(
    (leak) =>
      `  <${leak.tag}> leaked ${leak.attribute}="${leak.value}"\n` +
      `      in: ${leak.outerHTML}`,
  );
  return `${label} leaked ${leaks.length} non-DOM attribute(s):\n${lines.join('\n')}`;
}
