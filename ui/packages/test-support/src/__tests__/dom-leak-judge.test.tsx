/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE JUDGE PROVES ITSELF — once, for every gate that imports it
 * (objectui#4434).
 *
 * Two fixtures, and between them they are the whole reason the judge may be
 * trusted by a gate that scans hundreds of elements:
 *
 *   - CLEAN: ordinary, correct markup that must yield ZERO findings. This is
 *     the half that catches a happy-dom upgrade CHANGING IDL coverage — every
 *     entry in `HAPPY_DOM_IDL_GAPS` and every attribute in `SVG_ATTRIBUTES`
 *     that a gate relies on is exercised here, so an exception that stops being
 *     needed, or a reflection that stops working, fails loudly instead of
 *     quietly turning a sweep into noise.
 *   - PLANTED: markup carrying fake attributes that must ALL be reported. This
 *     is the half that catches the judge going blind — the failure mode where a
 *     gate reports "no leaks" because it stopped being able to see any.
 *
 * ## These fixtures are the UNION of the two that used to exist
 *
 * Both gates carried their own calibration pair, and each only exercised the
 * knowledge ITS gate happened to need:
 *
 *   - the fields pair (#3291) covered lucide's SVG attributes, `<a>`/`<img>`,
 *     the cmdk marks and the four happy-dom IDL gaps it had measured, and
 *     planted the field-renderer prop names;
 *   - the sweep pair (#4425) covered a subset of that markup, and planted the
 *     SDUI injection names (`schema`, `bind`, `events`, `props`, the camelCase
 *     ARIA pair) instead.
 *
 * Unioning the judge without unioning the fixtures would have left the merged
 * knowledge half-calibrated, and in one specific place it was calibrated by
 * NOBODY: the ten recharts marker/gradient/pattern attributes the sweep added
 * to `SVG_ATTRIBUTES` had no clean-markup fixture behind them in either file.
 * They do now — see the `<defs>` block below.
 */

import { describe, it, expect } from 'vitest';
import { findLeaks, isKnownAttribute } from '../dom-leak-judge';

/**
 * Ordinary, correct markup. Every attribute here is one HTML defines, several
 * chosen precisely because their IDL name differs from the attribute
 * (`readonly`/`maxlength`/`colspan`/`class`/`for`), plus every happy-dom IDL
 * gap the judge excepts (`select[size]`, `option[label]`, `textarea[wrap]`,
 * `col[span]`, `colgroup[span]`) and a cmdk mark.
 *
 * The `<svg>` block is deliberately two producers' markup: the lucide icon
 * shape both gates have always rendered, and — inside `<defs>` — the recharts
 * marker/gradient/pattern attributes that only the app-shell sweep renders.
 */
const CLEAN_FIXTURE = `
  <div id="root" class="a b" title="t" role="group" tabindex="0" hidden
       data-testid="x" aria-label="l" data-state="open">
    <input type="text" name="n" value="v" placeholder="p" readonly maxlength="5"
           minlength="1" required autofocus autocomplete="off" inputmode="text"
           step="1" min="0" max="9" pattern=".*" list="dl" />
    <textarea rows="3" cols="4" wrap="soft" readonly></textarea>
    <select size="2" multiple><option label="L" value="v" selected></option></select>
    <button type="button" disabled formnovalidate value="on">b</button>
    <a href="#" target="_blank" rel="noopener" download hreflang="en"></a>
    <label for="root">l</label>
    <img src="s.png" alt="a" width="10" height="10" loading="lazy" decoding="async" />
    <table><colgroup span="2"><col span="2" /></colgroup><tbody><tr>
      <td colspan="2" rowspan="1" headers="h"></td></tr></tbody></table>
    <div cmdk-root=""><div cmdk-list=""></div></div>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
         stroke-linejoin="round" class="icon">
      <defs>
        <marker orient="auto" refX="5" refY="5" markerWidth="10" markerHeight="10"
                markerUnits="userSpaceOnUse"><path d="M0 0h4v4H0z" /></marker>
        <linearGradient gradientUnits="userSpaceOnUse" spreadMethod="pad">
          <stop offset="0%" stop-color="#000" stop-opacity="1" /></linearGradient>
        <pattern patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" />
      </defs>
      <path d="M0 0h24v24H0z" pathLength="100" /></svg>
  </div>
`;

/**
 * Every planted attribute here MUST be reported — the union of what the two
 * gates each planted, on one `<input>` so nothing can be excused by a
 * permissive container.
 */
const PLANTED_LEAKS: ReadonlyArray<readonly [string, string]> = [
  // ── The props a host INJECTS (#4425's sweep) ────────────────────────────
  ['schema', '[object Object]'],
  ['events', '[object Object]'],
  ['bind', 'data.revenue'],
  ['props', '[object Object]'],
  ['arialabel', 'Canary label'],
  ['ariadescribedby', 'canary-desc'],
  ['datasource', '[object Object]'],
  ['colorvariant', 'success'],
  // ── The renderer-only props that reached the DOM in the #3291 audit ─────
  ['error', 'Title is required'],
  ['emptyhint', 'Select country first'],
  ['dependentvalues', '[object Object]'],
  ['dependson', 'country'],
  ['inputtype', 'text'],
  ['compact', 'true'],
  ['onselectrecord', 'function'],
  // The SDUI-only extra.
  ['label', 'Title'],
  // ── The open tail: arbitrary keys an author wrote on the node ───────────
  ['zzcanary', 'CANARY-STR'],
  ['zzcanaryobj', '[object Object]'],
  ['zzcanarynum', '42'],
  ['zzcanarycamel', 'CANARY-CAMEL'],
  ['reference_to', 'contacts'],
];

describe('the DOM-leak judge is calibrated (objectui#3291 / #4425 / #4434)', () => {
  it('reports NOTHING on standard markup — no false positives', () => {
    const host = document.createElement('div');
    host.innerHTML = CLEAN_FIXTURE;
    document.body.appendChild(host);
    try {
      const leaks = findLeaks(host);
      expect(
        leaks.map((l) => `<${l.tag}> ${l.attribute}="${l.value}"`).join('\n'),
      ).toBe('');
    } finally {
      host.remove();
    }
  });

  it('reports EVERY planted fake attribute — no false negatives', () => {
    const host = document.createElement('div');
    const planted = PLANTED_LEAKS.map(([name, value]) => `${name}="${value}"`).join(' ');
    // On an `<input>`, so nothing can be excused by a permissive container.
    host.innerHTML = `<input type="text" name="n" ${planted} />`;
    document.body.appendChild(host);
    try {
      const found = new Set(findLeaks(host).map((leak) => leak.attribute));
      const missed = PLANTED_LEAKS.map(([name]) => name).filter((name) => !found.has(name));
      expect(missed).toEqual([]);
      // Exact count, not "at least": a judge that reported the whole element
      // would also satisfy the line above.
      expect(found.size).toBe(PLANTED_LEAKS.length);
    } finally {
      host.remove();
    }
  });

  it('judges SVG by its own list, because reflection does not hold there', () => {
    // The mechanism behind the `<defs>` block above, asserted directly: the
    // recharts half of the union is SVG-namespaced markup, and `markerwidth`
    // is not an IDL property of anything happy-dom builds. If this ever passes
    // through reflection instead, the SVG list has stopped being load-bearing
    // and the clean fixture would no longer be testing it.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    expect(isKnownAttribute(svg, 'markerWidth')).toBe(true);
    expect(isKnownAttribute(svg, 'zzcanary')).toBe(false);

    const div = document.createElement('div');
    expect(isKnownAttribute(div, 'markerWidth')).toBe(false);
  });
});
