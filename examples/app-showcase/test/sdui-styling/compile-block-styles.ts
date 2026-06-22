// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Reference compiler for the SDUI styling model (ADR-0065).
 *
 * Turns a per-component, breakpoint-keyed style-object into **id-scoped CSS**,
 * the way Builder.io's SDK does (`createCssClass` →
 * `Builder.io SDK: packages/sdks/src/helpers/css.ts`). This is the open
 * *mechanism* prototype: pure `data → CSS string`, no Tailwind, no build-time
 * class scanning. It exists here as the thing the showcase test verifies; the
 * production home is `@objectstack/spec`/objectui (ADR-0065 follow-up).
 *
 * Desktop-first, matching Builder.io
 * (`packages/sdks/src/constants/device-sizes.ts:34`, `@media (max-width: …)`):
 * `large` is the unconditional base; `medium`/`small`/`xsmall` are max-width
 * overrides. Responsive is owned by the *model*, never by author-written
 * `md:`-style variant classes — which is what deletes the layer-vs-media-query
 * inversion class entirely (ADR-0065 §Decision-2).
 */

export type StyleMap = Record<string, string>;

export interface ResponsiveStyles {
  /** Unconditional base (desktop-first). */
  large?: StyleMap;
  medium?: StyleMap;
  small?: StyleMap;
  xsmall?: StyleMap;
}

/** max-width breakpoints (px). Mirrors Builder.io's default device sizes. */
export const BREAKPOINTS: Record<'medium' | 'small' | 'xsmall', number> = {
  medium: 991,
  small: 640,
  xsmall: 479,
};

const camelToKebab = (k: string): string =>
  k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** A style-map → `prop: value;` declarations. Values pass through **verbatim** —
 * that verbatim passthrough is the whole point: arbitrary values (`13px`,
 * `#1a2b3c`) and design tokens (`var(--space-6)`) work with zero build step. */
const mapToDeclarations = (m: StyleMap): string =>
  Object.entries(m)
    .map(([k, v]) => `${camelToKebab(k)}: ${v};`)
    .join(' ');

/**
 * Compile one component's responsive style-object to id-scoped CSS.
 * Returns '' for a missing id (no global, unscoped rule is ever emitted —
 * that scoping is what makes two independently-built stylesheets unable to
 * collide; ADR-0065 §Decision-1/2).
 */
export function compileBlockStyles(id: string, styles: ResponsiveStyles): string {
  if (!id) return '';
  const rules: string[] = [];
  if (styles.large) {
    rules.push(`.${id} { ${mapToDeclarations(styles.large)} }`);
  }
  for (const size of ['medium', 'small', 'xsmall'] as const) {
    const s = styles[size];
    if (s) {
      rules.push(
        `@media (max-width: ${BREAKPOINTS[size]}px) { .${id} { ${mapToDeclarations(s)} } }`,
      );
    }
  }
  return rules.join('\n');
}

/** Compile a whole page's blocks, concatenating their scoped CSS. */
export function compilePageStyles(
  blocks: Array<{ id: string; responsiveStyles?: ResponsiveStyles }>,
): string {
  return blocks
    .filter((b) => b.responsiveStyles)
    .map((b) => compileBlockStyles(b.id, b.responsiveStyles as ResponsiveStyles))
    .filter(Boolean)
    .join('\n');
}
