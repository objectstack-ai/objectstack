/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DetailViewSection.headerColor` -> a Tailwind background class.
 *
 * ## Why a lookup and not a template literal (objectui#6178)
 *
 * Tailwind v4 has no runtime. It builds the stylesheet by scanning source
 * TEXT for complete class tokens (the `@source` globs in each consuming app's
 * CSS entry; this workspace ships no `bg-*` safelist). The previous read here
 * was a template literal — `bg-` concatenated with the authored value — which
 * is never a complete token in scanned text, so the call site contributed
 * NOTHING to the compiled stylesheet. Measured, not assumed: compiling
 * `apps/console/src/index.css` with the template literal deleted produced a
 * byte-identical stylesheet (same sha256, 441302 bytes), and offering `bg-`
 * to the design system as a candidate emits no rule.
 *
 * An authored value therefore styled the header only when some OTHER source
 * file happened to use the identical class literally — `bg-muted` appears 691
 * times and `bg-primary/10` 63 times elsewhere in the workspace, which is why
 * both documented examples appeared to work. That liveness was accidental and
 * unversioned: it moved with unrelated edits in unrelated packages.
 *
 * Every class below is a COMPLETE literal, present verbatim in this file, and
 * this file is inside every consuming app's scan (`packages/plugin-detail/
 * src/**` in `apps/console`, `examples/console-starter`, and
 * `examples/byo-backend-console`). The key now works because this module
 * declares it, not because a neighbour happens to.
 *
 * ## Shape
 *
 * The same one this repo already uses for the sibling problem — `useRowColor`'s
 * `COLOR_TO_CLASS` in `@object-ui/plugin-grid`: a lookup of literal classes, a
 * verbatim pass-through for a value that is already a `bg-*` class, and
 * `undefined` for everything else. Never a fabricated class string.
 *
 * The AGENTS.md custom-property carve-out (`bg-[color:var(--os-…)]` fed by an
 * inline custom property, as `getBadgeHexAppearance` does in `@object-ui/
 * fields`) is the right answer for a key whose value is a CSS COLOUR. It does
 * not fit this one: `headerColor` is documented as a Tailwind class and its
 * values are design-system tokens (`muted`, `primary/10`), which have no
 * meaning as a CSS colour.
 *
 * ## Vocabulary
 *
 * Tints only. `CardHeader` sets no foreground colour, so a solid `bg-primary`
 * or `bg-destructive` would leave the section title unreadable; those need a
 * paired `text-*-foreground` and are left to the pass-through, where the
 * pairing is the author's explicit choice. Both values the `@object-ui/types`
 * mirror documents (`muted`, `primary/10`) are in the map, so nothing that
 * worked before this module stops working.
 */
const HEADER_COLOR_CLASSES: Readonly<Record<string, string>> = Object.freeze({
  muted: 'bg-muted',
  'muted/50': 'bg-muted/50',
  accent: 'bg-accent',
  'primary/10': 'bg-primary/10',
  'secondary/10': 'bg-secondary/10',
  'destructive/10': 'bg-destructive/10',
});

/** The declared vocabulary, for tests and for callers that enumerate it. */
export const headerColorVocabulary = HEADER_COLOR_CLASSES;

/**
 * Resolve an authored `headerColor` to a class the stylesheet actually
 * carries, or `undefined` when there is none — never a concatenated guess.
 *
 * A value that is already a complete `bg-*` class is handed through
 * untouched, exactly as `useRowColor` does. It then renders on the same terms
 * as any `className` a schema carries: the host app's Tailwind build has to
 * generate it.
 */
export function headerColorClass(headerColor: string | undefined): string | undefined {
  if (!headerColor) return undefined;
  const value = headerColor.trim();
  if (!value) return undefined;
  if (value.startsWith('bg-')) return value;
  // `hasOwnProperty` rather than a bare index: a plain object literal inherits
  // `constructor`, `toString` and friends, and indexing it with an authored
  // string would hand one of those back as the "class". (`Object.hasOwn` is
  // ES2022; this workspace compiles against the ES2020 lib.)
  return Object.prototype.hasOwnProperty.call(HEADER_COLOR_CLASSES, value)
    ? HEADER_COLOR_CLASSES[value]
    : undefined;
}
