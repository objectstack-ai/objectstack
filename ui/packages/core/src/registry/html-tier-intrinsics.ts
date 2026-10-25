/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0081 §2 — the html tier's registered intrinsic-element roster, as the
 * published manifest declares it (objectui#10735, executing the maintainer's
 * ruling A on objectstack#20112).
 *
 * A `kind:'html'` page is author-written HTML expressed as constrained JSX,
 * parsed (never executed) into the SDUI tree. Its everyday tags — headings,
 * paragraphs, links, lists, images, emphasis, the sectioning tags — each
 * resolve to a renderer: `renderers/basic/html-elements.tsx` registers the
 * flow/inline set from its `TAGS` loop, `renderers/layout/semantic.tsx` the
 * seven sectioning tags, and `span` / `table` / `label` are registered by
 * their own modules. The console's html-tier compile whitelists
 * `ComponentRegistry.getKnownTypes()` minus the types whose registration is
 * deprecated on the `'html'` surface (objectui#10757), so those pages render
 * today.
 *
 * The PUBLISHED contract did not say so. `sdui.manifest.json` is
 * `getPublicConfigs()` serialised, and that read was the curated JSON-surface
 * vocabulary (`PUBLIC_BLOCKS`) alone — so the objectstack CLI gate, which reads
 * the manifest as the html tier's tag whitelist, refused every plain HTML tag as
 * `forbidden-tag` / `unknown-component` on pages the renderer accepts. The
 * ruling: the manifest declares the html tier's registered intrinsic set
 * exactly as the registry declares it, with each tag's registered `inputs` and
 * child slot.
 *
 * ## Why a SECOND roster, and a marker, rather than entries in `PUBLIC_BLOCKS`
 *
 * The manifest is one flat `components` map and it feeds two readers with two
 * meanings: the objectstack gate reads its keys as the html tier's whitelist;
 * objectui reads the same set as the curated AI-authoring vocabulary — the
 * `kind:'react'` JSX scope (`renderers/layout/react-page.tsx`), the generated
 * block list, the console's contract census. Listing `h1` or `p` in
 * `PUBLIC_BLOCKS` would have widened that curated vocabulary silently, which
 * the ruling forbids. So the tier is declared here, on its own list, and every
 * entry it contributes to `getPublicConfigs()` is stamped `tier: 'html'`;
 * `manifestFromConfigs` carries the stamp into the manifest as the component's
 * `tier`, and a consumer that means the CURATED vocabulary filters on it. A
 * consumer that ignores the key — the objectstack gate does — sees the tags as
 * legal, which is the ruling's whole intent for that reader.
 *
 * ## What is deliberately NOT here
 *
 *   - `div` — deprecated on the JSON surface in favour of `box` (objectui#3965,
 *     PR objectui#6878) and kept out of the published contract by the same
 *     ruling that admits the rest: the gate keeps refusing `<div>` on an html
 *     page. The renderer still registers it, and its declared deprecation names
 *     both surfaces, `json` and `html` (objectui#10757): the console's html
 *     compile refuses it too, naming `box`, so the renderer and the gate agree.
 *   - `kbd` — a `ui` component under an HTML tag name (renders `keys` /
 *     `label`), not named by the ruling. Admitting it is additive and cheap on
 *     a named need; retracting a declared tag is a narrowing.
 *   - `form`, `input`, `textarea`, `select`, `switch`, `progress`, `dialog`,
 *     `summary`, `object`, `view` — JSON-surface components (or `field:` /
 *     plugin fallbacks) that happen to squat on HTML tag names; the tier
 *     excludes form controls by design (html-elements.tsx's own exclusion
 *     list) and none of the rest is an element passthrough.
 *   - `button`, `text`, `image`, `html` — HTML tag names that are ALREADY
 *     curated in `PUBLIC_BLOCKS`; they reach the manifest from there, unmarked.
 *
 * `code` was on that list when the roster landed: the ruling named it
 * "registered elsewhere", but the only bare `code` registration was the
 * `field:code` widget's namespace fallback — a code editor reading `value`, no
 * child slot — so an html author's `<code>inline</code>` drew the editor and lost
 * its text. objectui#10756 registers `code` as a sanitised passthrough in
 * `html-elements.tsx`'s `TAGS` and has the widget stand down from the bare key
 * (`FIELD_TYPES_SKIP_FALLBACK` in `@object-ui/fields`; it stays `field:code`),
 * so the tag is declared here exactly as its siblings are.
 *
 * The console's `html-tier-manifest` test derives the population of
 * HTML-named registrations from `@types/react`'s `IntrinsicElements` and
 * holds every member to one of: this roster, `PUBLIC_BLOCKS`, or its exclusion
 * ledger with a reason — so a registration that newly squats on a tag name
 * lands there by absence.
 *
 * A tag listed here that is not registered is skipped, exactly as an
 * unregistered `PUBLIC_BLOCKS` entry is (aspirational-safe). ⛔ A tag may not be
 * on both rosters: the curated read wins the dedupe, so the html marker would
 * silently not apply; `__tests__/html-tier-intrinsics.test.ts` pins the
 * disjointness.
 */
export const HTML_TIER_INTRINSICS: readonly string[] = [
  // ── `renderers/basic/html-elements.tsx` `TAGS` — the safe flow/inline set ──
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'a', 'blockquote', 'pre', 'code',
  'strong', 'em', 'b', 'i', 'u', 'small', 'mark', 'sub', 'sup', 'del', 'ins', 'abbr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'figure', 'figcaption', 'img', 'hr', 'br', 'time', 'address', 'cite', 'q',
  // ── registered elsewhere, each with its own module ────────────────────────
  // `renderers/basic/span.tsx` — deprecated on the JSON surface, permanent
  // vocabulary of the html tier (objectui#4000); the declaration travels with
  // the registration, so nothing here restates it.
  'span',
  // `renderers/complex/table.tsx` — the data-driven table (`columns` / `data`),
  // declared exactly as registered: no child slot, so a `<table>` authored with
  // element children draws `not-a-container` rather than rendering them.
  'table',
  // `renderers/form/label.tsx` — reads `text`, declared exactly as registered.
  'label',
  // ── `renderers/layout/semantic.tsx` — the seven sectioning tags ──────────
  'aside', 'main', 'header', 'nav', 'footer', 'section', 'article',
];

/** Fast membership set built from {@link HTML_TIER_INTRINSICS}. */
export const HTML_TIER_INTRINSIC_SET: ReadonlySet<string> = new Set(HTML_TIER_INTRINSICS);
