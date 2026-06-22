// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time diagnostics for the SDUI scoped-styling model (ADR-0065).
//
// A pure `(stack) => Finding[]` rule (ADR-0019): the same bar holds for
// hand-authored and AI-generated pages, run from `os validate`/`compile` and
// reusable by AI authoring. It catches the deterministic ways a `responsiveStyles`
// block silently fails or drifts — the class of mistake an AI author is most
// likely to make — *before* render, with actionable hints it can self-correct on.
//
// What it does NOT catch: whether the result looks good. Visual/semantic quality
// (contrast, balance, "is it ugly") is only catchable by rendering + a VLM gate,
// which is a separate, render-time concern (ADR-0065 §Decision-5).

export type StyleSeverity = 'error' | 'warning';

export interface StyleFinding {
  severity: StyleSeverity;
  rule: string;
  /** Human-readable location, e.g. `page "pricing" › node "plan_solo"`. */
  where: string;
  /** Config path, e.g. `pages[0].regions[0].components[1]`. */
  path: string;
  message: string;
  hint: string;
}

// Rule ids (registry entries).
export const STYLE_NODE_MISSING_ID = 'style-node-missing-id';
export const STYLE_CLASSNAME_TAILWIND = 'style-classname-tailwind';
export const STYLE_RESPONSIVE_NO_BASE = 'style-responsive-no-base';
export const STYLE_UNKNOWN_CSS_PROPERTY = 'style-unknown-css-property';
export const STYLE_UNKNOWN_TOKEN = 'style-unknown-token';

type AnyRec = Record<string, unknown>;

const BREAKPOINTS = ['large', 'medium', 'small', 'xsmall'] as const;

/** SDUI design-token palette (ADR-0065) + base theme tokens, referenced as
 * `var(--name)`. Authors should resolve values against these. Kept in sync with
 * `apps/console/src/index.css` / `@object-ui/components` `:root`. */
const KNOWN_TOKENS = new Set<string>([
  // SDUI tokens
  'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'space-8', 'space-10', 'space-12',
  'radius', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl',
  'shadow-sm', 'shadow-md', 'shadow-lg',
  'surface', 'surface-sunken', 'text-strong', 'text-muted', 'brand', 'brand-foreground', 'hairline',
  // Base theme tokens (shadcn) — usually wrapped as hsl(var(--x)).
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
  'muted', 'muted-foreground', 'accent', 'accent-foreground',
  'destructive', 'destructive-foreground', 'border', 'input', 'ring',
  'success', 'success-foreground', 'warning', 'warning-foreground',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
]);

/** Common CSS properties (camelCase) an SDUI block realistically sets. Generous
 * on purpose: an unknown property is only a *warning* (typo catcher), never a
 * blocker. Custom properties (`--x`) are always allowed. */
const KNOWN_CSS_PROPERTIES = new Set<string>([
  'display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'zIndex', 'overflow', 'overflowX', 'overflowY', 'visibility', 'boxSizing', 'float', 'clear',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'aspectRatio',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'marginInline', 'marginBlock',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingInline', 'paddingBlock',
  'flex', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'alignItems', 'alignContent', 'alignSelf', 'justifyContent', 'justifyItems', 'justifySelf', 'gap', 'rowGap', 'columnGap', 'order', 'placeItems', 'placeContent',
  'grid', 'gridTemplate', 'gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas', 'gridColumn', 'gridRow', 'gridArea', 'gridAutoFlow', 'gridAutoColumns', 'gridAutoRows',
  'color', 'backgroundColor', 'background', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundClip', 'opacity', 'mixBlendMode',
  'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'textDecoration', 'textOverflow', 'whiteSpace', 'wordBreak', 'overflowWrap', 'fontVariantNumeric', 'verticalAlign', 'textShadow',
  'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderColor', 'borderWidth', 'borderStyle', 'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'outline', 'outlineOffset',
  'boxShadow', 'transform', 'transformOrigin', 'transition', 'transitionProperty', 'transitionDuration', 'transitionTimingFunction', 'transitionDelay', 'animation', 'filter', 'backdropFilter', 'willChange',
  'cursor', 'pointerEvents', 'userSelect', 'objectFit', 'objectPosition', 'content',
]);

const VAR_RE = /var\(\s*--([a-zA-Z0-9-]+)\s*[,)]/g;

// High-precision Tailwind-utility detection. A `className` in page metadata is
// "Tailwind-looking" if any token is a responsive/state variant, an arbitrary
// `[…]` value, a known utility stem followed by a Tailwind *value* (number /
// fraction / size keyword), or a bare layout utility. Tuned to NOT trip on
// ordinary custom class names (e.g. `my-custom-scope`, `os-s-plan_solo`).
const TW_VARIANT = /^(sm|md|lg|xl|2xl|hover|focus|active|disabled|dark|group-hover|peer-[a-z]+|first|last|odd|even):/;
const TW_STEM_VALUE = /^-?(p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|max-w|min-h|max-h|size|text|leading|tracking|bg|border|rounded|shadow|ring|opacity|inset|top|bottom|left|right|z|order|col|row|grid-cols|grid-rows|basis)-(\d+(\.\d+)?|\d+\/\d+|px|full|auto|none|screen|min|max|fit|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl)$/;
const TW_BARE = /^(flex|grid|block|inline|inline-block|inline-flex|hidden|contents|table|flow-root|grow|shrink|truncate|italic|underline|uppercase|lowercase|capitalize|antialiased|absolute|relative|fixed|sticky|static|isolate|flex-col|flex-row|flex-wrap|flex-nowrap|items-center|items-start|items-end|items-stretch|justify-center|justify-between|justify-around|justify-start|justify-end|text-center|text-left|text-right|font-bold|font-semibold|font-medium|font-normal|tabular-nums)$/;

function looksLikeTailwind(className: string): boolean {
  return className.split(/\s+/).some((tok) => {
    if (!tok) return false;
    if (TW_VARIANT.test(tok)) return true;
    if (/\[[^\]]+\]/.test(tok)) return true; // arbitrary value, e.g. p-[13px]
    if (TW_STEM_VALUE.test(tok)) return true;
    if (TW_BARE.test(tok)) return true;
    return false;
  });
}

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/** Child nodes can hang off `children`, `properties.children`, `body`, or
 * `properties.body` depending on block type — collect them all. */
function childrenOf(node: AnyRec): AnyRec[] {
  const props = (node.properties as AnyRec) ?? {};
  const out: AnyRec[] = [];
  for (const c of [node.children, props.children, node.body, props.body]) {
    if (Array.isArray(c)) out.push(...(c.filter((x) => x && typeof x === 'object') as AnyRec[]));
  }
  return out;
}

function checkNode(node: AnyRec, pageName: string, path: string, findings: StyleFinding[]): void {
  const id = typeof node.id === 'string' ? node.id : undefined;
  const type = typeof node.type === 'string' ? node.type : 'node';
  const where = `page "${pageName}" › ${id ? `node "${id}"` : `<${type}>`}`;
  const rs = node.responsiveStyles as AnyRec | undefined;
  const hasRs = !!rs && typeof rs === 'object' && BREAKPOINTS.some((b) => rs[b]);

  // (1) responsiveStyles needs an id to scope to — else the CSS is dropped.
  if (hasRs && !id) {
    findings.push({
      severity: 'error', rule: STYLE_NODE_MISSING_ID, where, path,
      message: `Node has responsiveStyles but no \`id\`; scoped CSS cannot be generated and the styles are silently dropped.`,
      hint: `Add a stable \`id\` to this node.`,
    });
  }

  // (2) responsive breakpoint without a `large` base → unstyled at desktop.
  if (hasRs && !rs!.large && BREAKPOINTS.slice(1).some((b) => rs![b])) {
    findings.push({
      severity: 'warning', rule: STYLE_RESPONSIVE_NO_BASE, where, path,
      message: `responsiveStyles sets a smaller breakpoint but no \`large\` base; the node is unstyled at desktop width.`,
      hint: `Put the unconditional/base styles under \`responsiveStyles.large\` (desktop-first).`,
    });
  }

  // (3) className that looks like Tailwind → won't render from metadata.
  if (typeof node.className === 'string' && node.className.trim() && looksLikeTailwind(node.className)) {
    findings.push({
      severity: 'warning', rule: STYLE_CLASSNAME_TAILWIND, where, path,
      message: `\`className\` contains Tailwind-looking utilities ("${node.className.trim().slice(0, 60)}"); these are not compiled from metadata and will silently do nothing.`,
      hint: `Style this node with \`responsiveStyles\` + design tokens instead of \`className\` (ADR-0065).`,
    });
  }

  // (4)+(5) unknown CSS property / unknown token inside each breakpoint map.
  if (rs && typeof rs === 'object') {
    for (const bp of BREAKPOINTS) {
      const map = rs[bp] as AnyRec | undefined;
      if (!map || typeof map !== 'object') continue;
      for (const [prop, value] of Object.entries(map)) {
        if (!prop.startsWith('--') && !KNOWN_CSS_PROPERTIES.has(prop)) {
          findings.push({
            severity: 'warning', rule: STYLE_UNKNOWN_CSS_PROPERTY, where, path: `${path}.responsiveStyles.${bp}`,
            message: `Unknown CSS property "${prop}" (typo?); if unintended it will not apply.`,
            hint: `Use a camelCase CSS property name (e.g. \`flexDirection\`, \`backgroundColor\`).`,
          });
        }
        if (typeof value === 'string') {
          let m: RegExpExecArray | null;
          VAR_RE.lastIndex = 0;
          while ((m = VAR_RE.exec(value))) {
            const token = m[1];
            if (!KNOWN_TOKENS.has(token) && !token.startsWith('tw-')) {
              findings.push({
                severity: 'warning', rule: STYLE_UNKNOWN_TOKEN, where, path: `${path}.responsiveStyles.${bp}.${prop}`,
                message: `References unknown design token \`var(--${token})\` (typo?); it will not resolve.`,
                hint: `Use a token from the ADR-0065 palette (e.g. \`var(--space-6)\`, \`var(--surface)\`, \`hsl(var(--primary))\`).`,
              });
            }
          }
        }
      }
    }
  }

  // Recurse.
  const kids = childrenOf(node);
  for (let i = 0; i < kids.length; i++) {
    checkNode(kids[i], pageName, `${path}.children[${i}]`, findings);
  }
}

/**
 * Validate every page's component tree for SDUI styling correctness (ADR-0065).
 * Returns findings (empty = clean). `error` findings describe styles that are
 * silently dropped and should fail validate/build; `warning` findings are
 * advisory (typos, drift, footguns).
 */
export function validateResponsiveStyles(stack: AnyRec): StyleFinding[] {
  const findings: StyleFinding[] = [];
  const pages = asArray(stack.pages);
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    const pageName = typeof page.name === 'string' ? page.name : `pages[${p}]`;
    const regions = asArray(page.regions);
    for (let r = 0; r < regions.length; r++) {
      const components = asArray(regions[r].components);
      for (let c = 0; c < components.length; c++) {
        checkNode(components[c], pageName, `pages[${p}].regions[${r}].components[${c}]`, findings);
      }
    }
  }
  return findings;
}
