/**
 * Catalog-wide guardrail: a `div` whose className spells a first-class layout
 * component's own capability is authored as that component, with props
 * (objectui#4003, the vocabulary-independent half of objectui#3965).
 *
 * 189 `div` nodes shipped in this catalog; 106 of them hand-wrote in Tailwind
 * exactly what `flex` / `stack` / `container` / `grid` already expose as declared
 * props (`items-center` → `align`, `space-y-4` → `gap`, `max-w-6xl` → `maxWidth`,
 * `md:grid-cols-3` → `columns`). Every example here is copy-paste reference
 * material and an AI few-shot retrieval source, so a `div` carrying layout intent
 * teaches authors to reimplement a component instead of configuring it — and
 * teaches it at the scale of the whole docs site.
 *
 * Three different facts get pinned:
 *
 *  1. RATCHET — no `div` anywhere in the catalog carries layout-intent classes,
 *     except two nodes that cannot be converted and say why (below; the third
 *     was recycled by objectui#4889). This is the "keep the 107th out" guard,
 *     and the allowlist is what keeps it honest: a future conversion that
 *     regresses to `div` fails here.
 *  2. NO DEAD SLOT — no `flex` / `stack` / `grid` / `container` node carries a
 *     `body` key. `div` renders `children || body`; all four layout renderers
 *     render `children` ONLY, so a body-keyed node re-typed naively renders
 *     EMPTY, silently. Four catalog `div` nodes use `body` today (the sidebars),
 *     which is exactly how this trap gets hit by the next sweep.
 *  3. EQUIVALENCE — for a sample of each category, the converted node and the
 *     `div` it replaced are rendered through the real `SchemaRenderer` and their
 *     subtrees compared byte-for-byte, with the converted node's own class string
 *     pinned literally. The `div` fixtures below are the ACTUAL pre-conversion
 *     className strings, so the comparison is against what shipped, not a guess.
 *
 * On the class deltas the pins encode. Three are deliberate and none is a
 * regression:
 *   - `flex-row` / `justify-start` / `items-stretch` / `gap-0` / `p-0` are the
 *     CSS initial values the bare `div` already had — the renderer states them
 *     explicitly where the utility class list left them implicit.
 *   - `grid-cols-1` makes explicit the single-column base that a bare `grid` with
 *     only responsive `md:grid-cols-*` classes already resolved to.
 *   - `gap-N` becomes a mobile-first ladder (`gap-3` → `gap-2 sm:gap-3`). Below
 *     640px that is NOT byte-identical, and it is the correct exemplar: the
 *     ladder is what `FlexSchema.gap` means. It is deliberately NOT faked back to
 *     byte-equality by declaring `gap: 0` and leaving `gap-3` in `className` —
 *     that spelling contradicts itself and re-teaches the very anti-pattern this
 *     card removes.
 *
 * Module-scope import of `@object-ui/components`, not `beforeAll` (AGENTS.md
 * §测试纪律): registering the renderers is an unbounded module load and must not
 * be billed to a bounded hook timeout.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer } from '@object-ui/react';
import { allExamples } from '../src/index.js';

type Node = Record<string, unknown>;

const LAYOUT_TYPES = new Set(['flex', 'stack', 'grid', 'container']);

/**
 * The two `div` nodes that keep layout-intent classes, each for a reason that
 * survives any terminal state of #3965.
 *
 *   `components-basic-div/custom-card` (2 nodes) — rendered by
 *   `content/docs/components/basic/div.mdx` under "Legacy Examples (For Reference
 *   Only)". They exist to SHOW the deprecated spelling; converting them deletes
 *   the thing the page documents.
 *
 * RECYCLED (objectui#4889). `components-layout-page/documentation-page` (1 node,
 * `prose prose-slate max-w-none`) was the third entry, and it was the one
 * measured victim of a defect rather than a documented intent: `max-w-none`
 * REMOVES a max-width — it cancels the typography plugin's own — and no
 * `maxWidth` value rendered it. `ContainerSchema` declared `false` for the
 * no-constraint case, but `container.tsx` read it as `schema.maxWidth || 'xl'`,
 * so `false` rendered `max-w-xl`; converting the node would have changed what
 * it rendered. #4889 made `false` reachable AND made it emit `max-w-none` (an
 * explicit cancel, not an omitted class — the distinction this very node
 * depends on), so the node is now authored as a `container` and the exemption
 * is gone. An exemption outliving its cause is an exemption nobody can audit.
 */
const DIV_EXEMPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['components-basic-div/custom-card', 'max-w-sm rounded-lg border bg-card text-card-foreground shadow-sm'],
  ['components-basic-div/custom-card', 'p-6 space-y-2'],
];

/** Does this className spell a capability one of the four layout types owns? */
function layoutIntent(className: unknown): string | null {
  if (typeof className !== 'string' || className.trim() === '') return null;
  const t = className.split(/\s+/);
  const hasFlex = t.some((x) => /^((sm|md|lg|xl|2xl):)?flex$/.test(x));
  const hasFlexCol = t.some((x) => /(^|:)flex-col$/.test(x));
  if (hasFlex && !hasFlexCol) return 'flex';
  if (t.some((x) => /(^|:)space-y-/.test(x))) return 'stack';
  if (t.some((x) => /(^|:)max-w-/.test(x))) return 'container';
  if (t.some((x) => /(^|:)grid$/.test(x) || /(^|:)grid-cols-/.test(x))) return 'grid';
  return null;
}

function collect(node: unknown, pred: (n: Node) => boolean, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, pred, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const rec = node as Node;
    if (pred(rec)) out.push(rec);
    for (const value of Object.values(rec)) collect(value, pred, out);
  }
  return out;
}

/**
 * Where a layout node's own props live. An authored `flex` takes them — its
 * child list included — in its `properties` bag (objectui#11276, the
 * maintainer's ruling A on objectui#11300); `stack`, `grid` and `container`
 * keep them on the node. `SchemaRenderer` hoists the bag before the renderer
 * runs, so both render alike; this only says where to READ them in a fixture.
 */
function propsOf(node: Node): Node {
  return node.type === 'flex' && node.properties && typeof node.properties === 'object'
    ? (node.properties as Node)
    : node;
}

describe('schema-catalog — layout intent is authored as props, not className (#4003)', () => {
  it('no div carries layout-intent classes outside the documented exemptions', () => {
    const offenders = allExamples().flatMap((example) =>
      collect(example.schema, (n) => n.type === 'div')
        .map((n) => [example.id, String(n.className ?? '')] as const)
        .filter(([, cn]) => layoutIntent(cn) !== null)
        .filter(([id, cn]) => !DIV_EXEMPTIONS.some(([eid, ecn]) => eid === id && ecn === cn))
        .map(([id, cn]) => `${id} :: ${cn} (→ ${layoutIntent(cn)})`),
    );
    expect(
      offenders,
      'a `div` whose className already names a first-class layout component\'s own ' +
        'props teaches authors to reimplement the component instead of configuring ' +
        'it. Author it as flex/stack/container/grid with props (#4003).',
    ).toEqual([]);
  });

  it('every documented exemption is still present (allowlist is not stale)', () => {
    for (const [id, className] of DIV_EXEMPTIONS) {
      const example = allExamples().find((e) => e.id === id);
      expect(example, `${id} is missing from the catalog`).toBeTruthy();
      const found = collect(example!.schema, (n) => n.type === 'div').some(
        (n) => n.className === className,
      );
      expect(found, `exemption \`${id} :: ${className}\` no longer matches any div — ` +
        'delete the entry rather than leaving the allowlist wider than the facts').toBe(true);
    }
  });

  it('sees enough converted layout nodes for the ratchet to mean something', () => {
    const nodes = allExamples().flatMap((e) =>
      collect(e.schema, (n) => typeof n.type === 'string' && LAYOUT_TYPES.has(n.type as string)),
    );
    // 441 at the time of writing (flex 248, stack 153, grid 26, container 14),
    // of which 103 were converted by #4003. A floor, so adding examples never
    // fails this.
    expect(nodes.length).toBeGreaterThanOrEqual(430);
  });

  it('no layout node carries a `body` key, which those renderers never render', () => {
    const offenders = allExamples().flatMap((example) =>
      collect(
        example.schema,
        (n) => typeof n.type === 'string' && LAYOUT_TYPES.has(n.type as string) && 'body' in n,
      ).map((n) => `${example.id} (type: ${String(n.type)})`),
    );
    expect(
      offenders,
      'flex/stack/grid/container render `children` only — `div` was the one that ' +
        'also rendered `body`. A `body` key on these types is content that never ' +
        'reaches the DOM, and it fails silently (#4003).',
    ).toEqual([]);
  });
});

/**
 * Render-level equivalence. Each case carries the EXACT className the converted
 * node replaced; the `div` is rebuilt around the converted node's own children so
 * the subtree comparison isolates this one conversion rather than re-measuring
 * descendants that were converted too.
 */
describe('converted nodes render what their div rendered (#4003)', () => {
  const cases: ReadonlyArray<readonly [string, string, string, string]> = [
    // [example id, className of the div it replaced, converted type, pinned class]
    [
      'components-complex-scroll-area/document-browser',
      'p-3 hover:bg-slate-50 cursor-pointer flex items-center gap-3',
      'flex',
      'flex flex-row justify-start items-center gap-2 sm:gap-3 p-3 hover:bg-slate-50 cursor-pointer',
    ],
    [
      'marketing/features-grid',
      'h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center',
      'flex',
      'flex flex-row justify-center items-center gap-0 h-12 w-12 rounded-lg bg-primary/10',
    ],
    [
      'components-form-file-upload/form-example',
      'max-w-md space-y-6 p-6 border rounded-lg',
      'stack',
      'flex flex-col justify-start items-stretch gap-3 sm:gap-4 md:gap-6 max-w-md p-6 border rounded-lg',
    ],
    [
      'components-complex-scroll-area/short-150px',
      'space-y-2',
      'stack',
      'flex flex-col justify-start items-stretch gap-1.5 sm:gap-2',
    ],
    [
      'marketing/pricing-table',
      'w-full max-w-6xl mx-auto',
      'container',
      'w-full max-w-6xl mx-auto p-0',
    ],
    [
      'components-layout-semantic/complete-layout',
      'max-w-4xl border rounded-lg overflow-hidden',
      'container',
      'w-full max-w-4xl p-0 border rounded-lg overflow-hidden',
    ],
    [
      // The #4889 recycle: this is the node the allowlist used to exempt. Its
      // `max-w-none` now comes from `maxWidth: false` instead of a hand-written
      // class, and `prose prose-slate` stays in `className` because that is
      // typography, not layout.
      'components-layout-page/documentation-page',
      'prose prose-slate max-w-none',
      'container',
      'w-full max-w-none p-0 prose prose-slate',
    ],
    [
      'ecommerce/product-grid',
      'grid sm:grid-cols-2 lg:grid-cols-4 gap-6',
      'grid',
      'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6',
    ],
    [
      'marketing/testimonials',
      'grid md:grid-cols-3 gap-6',
      'grid',
      'grid grid-cols-1 md:grid-cols-3 gap-6',
    ],
  ];

  function renderNode(schema: unknown) {
    const { container } = render(<SchemaRenderer schema={schema as never} />);
    const el = container.firstElementChild as HTMLElement;
    return { className: el.className, innerHTML: el.innerHTML };
  }

  it('covers every category at least twice (sample is not lopsided)', () => {
    for (const type of LAYOUT_TYPES) {
      expect(cases.filter((c) => c[2] === type).length, `${type} needs 2+ cases`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it.each(cases)('%s (%s → %s)', (id, originalClassName, type, expectedClass) => {
    const example = allExamples().find((e) => e.id === id);
    expect(example, `${id} is missing from the catalog`).toBeTruthy();

    const node = collect(example!.schema, (n) => n.type === type).find((n) => {
      const { className } = renderNode(n);
      return className === expectedClass;
    });
    expect(node, `${id} has no ${type} node rendering \`${expectedClass}\``).toBeTruthy();

    // Rebuild the div this node replaced, around the SAME children.
    const asDiv: Node = { type: 'div', className: originalClassName };
    if (propsOf(node!).children !== undefined) asDiv.children = propsOf(node!).children;

    const after = renderNode(node!);
    const before = renderNode(asDiv);

    // The whole content of the node still reaches the DOM. This is the assertion
    // that a naive re-type of a body-keyed node would fail.
    expect(after.innerHTML).toBe(before.innerHTML);
    expect(after.className).toBe(expectedClass);
  });
});

/**
 * The recycled node, measured on the fact it was exempted FOR (objectui#4889).
 *
 * The exemption was never "this node prefers a div" — it was "no `maxWidth`
 * value can express cancelling an inherited max-width". So the conversion is
 * only genuinely done if this node, as authored today, still computes
 * `max-width: none` under the typography plugin's `.prose`. Asserting the class
 * string alone would not show that: an implementation that merely stopped
 * emitting a max-width class produces a perfectly reasonable-looking class list
 * and leaves `.prose`'s 65ch standing.
 *
 * happy-dom resolves author stylesheets in `getComputedStyle`, so the cascade
 * below is real. Values are the shipped ones (`.prose` → `maxWidth: '65ch'`
 * from the plugin's `DEFAULT`; `--container-xl: 36rem` from Tailwind's theme),
 * and the utilities are declared after `.prose` because that is the layer order
 * Tailwind emits — equal specificity, so source order decides, as in the real
 * CSS. Renderer-level coverage of the same rule lives in
 * `packages/components/src/__tests__/container-max-width-false.test.tsx`.
 */
describe('the recycled documentation-page node still cancels prose\'s max-width (#4889)', () => {
  let sheet: HTMLStyleElement;

  beforeEach(() => {
    sheet = document.createElement('style');
    sheet.textContent = [
      '.prose { max-width: 65ch; }',
      '.max-w-none { max-width: none; }',
      '.max-w-xl { max-width: 36rem; }',
    ].join('\n');
    document.head.appendChild(sheet);
  });

  afterEach(() => {
    sheet.remove();
  });

  it('computes max-width: none, not the 65ch it would inherit', () => {
    const example = allExamples().find((e) => e.id === 'components-layout-page/documentation-page');
    expect(example, 'documentation-page is missing from the catalog').toBeTruthy();

    const node = collect(example!.schema, (n) => n.type === 'container')[0];
    expect(node, 'documentation-page no longer authors a container').toBeTruthy();
    expect(node!.maxWidth, 'the node must author the declared no-constraint value').toBe(false);

    const { container } = render(<SchemaRenderer schema={node as never} />);
    const el = container.firstElementChild as HTMLElement;
    expect(getComputedStyle(el).maxWidth).toBe('none');
  });
});

/**
 * The SECOND sweep over the same catalog surface (objectui#4891 + objectui#4890),
 * landing here because #4003 already built the ratchet and these are the same
 * files, the same anti-pattern, and the same "keep the next one out" job.
 *
 * #4003 converted nodes whose TYPE was wrong (`div` carrying layout intent).
 * These two cards are about nodes whose type was already right:
 *
 *  - #4891 — 140 nodes across 33 files were already `flex` / `stack` /
 *    `container`, and still hand-wrote, in `className`, props their own type
 *    declares: `items-center` for `align`, `justify-between` for `justify`,
 *    `gap-2` for `gap`, `flex-wrap` for `wrap`, `p-4` for a container's
 *    `padding`. Re-measured on `origin/main` before the sweep: 231 such tokens,
 *    distributed `flex` 221 / `container` 7 / `stack` 3 / `grid` 0 — the card's
 *    own figures, reproduced exactly.
 *  - #4890 — 135 `stack` nodes across 39 files authored `spacing`, a key NO
 *    schema declares. `StackSchema extends Omit<FlexSchema, 'type'>`, whose only
 *    spacing key is `gap`; `stack.tsx` read `spacing` anyway through an `as any`,
 *    which is what made an undeclared key look authorable for as long as it did.
 *    Fixed at the producer and the alias deleted, per AGENTS.md #0.1 — NOT by
 *    legalising `spacing` into `StackSchema`, which would only have added a
 *    second name for `gap`.
 *
 * Why it matters here and not only in a renderer test: `className` wins over the
 * renderer's own classes (`cn()` is `clsx` + `tailwind-merge`, author string
 * last), so every one of these 275 nodes RENDERED CORRECTLY. There was no
 * failure to notice — only 423 shipped examples, read by the docs site and
 * retrieved as AI few-shot material, teaching authors to reimplement a
 * component's props in Tailwind and to spell a key the types do not have.
 *
 * And the props are not merely a tidier spelling: `gap` / `padding` render a
 * MOBILE-FIRST LADDER (`gap: 3` → `gap-2 sm:gap-3`), while a hand-written
 * `gap-3` is one dead value at every width. That is why the equivalence cases
 * below are split into two kinds instead of asserting one blanket rule.
 *
 * THE THIRD PASS (objectui#5690) is the one token #4891 excluded by design.
 * Nine `flex` nodes across five files spelled horizontal spacing as
 * `space-x-N`, which is not in #4891's token set — and excluding it is exactly
 * why that card's headline figure re-measured to the digit. `space-x-N` is not
 * a second spelling of `gap`: it compiles to a margin on
 * `& > :not([hidden]) ~ :not([hidden])`, `gap` is the flexbox gap property, and
 * they diverge wherever a row WRAPS (`space-x` puts no gutter above a wrapped
 * row) or a child is conditionally absent. So the nine could not be renamed
 * through; they had to be measured, and both of those divergence axes are
 * measured per node in the last describe of this file.
 *
 * What the measurement turned up, and what nothing before it had noticed: the
 * nine were rendering BOTH spacings, additively. None of them declared `gap`,
 * so `flex.tsx`'s `schema.gap ?? 2` was emitting `gap-1.5 sm:gap-2` on every
 * one of them, and `tailwind-merge` does not collapse that against `space-x-N`
 * because they are different CSS properties. The shipped gutter on a
 * `space-x-2` node was therefore gap 0.375rem PLUS margin 0.5rem, not 0.5rem.
 * The conversion drops the accidental half and lands the number the author
 * actually wrote: `gap: N` tops its ladder out at exactly `space-x-N`'s value.
 * That is a real rendering change at every width, which is why these cases are
 * `ladder` and not `identical`, and why a byte-equivalence claim would have
 * been false for them in a way it was not false for #4891's.
 */

const ALIGN_VALUES = new Set(['start', 'end', 'center', 'baseline', 'stretch']);
const JUSTIFY_VALUES = new Set(['start', 'end', 'center', 'between', 'around', 'evenly']);
const DIRECTION_TOKENS = new Set(['flex-row', 'flex-col', 'flex-row-reverse', 'flex-col-reverse']);
/**
 * The gap steps each renderer actually maps. A step OUTSIDE its ladder is not an
 * offender: `flex.tsx` has no `gap === 9` arm, so `gap: 9` would emit no gap
 * class at all and moving `gap-9` out of `className` would DELETE the spacing.
 * The ratchet must only demand extraction where extraction is lossless.
 */
const GAP_LADDER: Record<string, ReadonlySet<number>> = {
  flex: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]),
  stack: new Set([0, 1, 2, 3, 4, 5, 6, 8, 10]),
  grid: new Set([0, 1, 2, 3, 4, 5, 6, 8, 10, 12]),
};
const CONTAINER_PADDING = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16]);
const CONTAINER_MAX_W = new Set([
  'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'full', 'none', 'screen-2xl',
]);

/**
 * The className tokens on this node that spell a prop THIS node's own type
 * declares — i.e. the ones the node should be authoring as props.
 *
 * PREFIXED TOKENS ARE NEVER OFFENDERS. `md:items-start` is a responsive
 * override and the props are not responsive (`grid.columns` is the one
 * exception, and it takes an object rather than a class). Stripping a
 * breakpoint-prefixed class into a flat prop would silently discard the
 * breakpoint, so they stay in `className` by design — as does everything
 * decorative (`border-b`, `bg-muted`), and everything belonging to a DIFFERENT
 * type (`max-w-md` on a `flex`: a flex node has no `maxWidth` prop, so that
 * class is the only way to say it) or describing this node AS A FLEX ITEM
 * rather than as a container (`flex-shrink-0`).
 *
 * `space-x-*` USED TO BE ON THAT LAST LINE, and it was wrong (objectui#5690).
 * `flex-shrink-0` styles the node itself as somebody else's flex item;
 * `space-x-N` styles the node's OWN CHILDREN, which makes it a container
 * utility — and on a row-major node it is a hand-written spelling of that node's
 * `gap`. Nine catalog nodes sat behind that sentence for two sweeps; the arm
 * below is what keeps the tenth out.
 *
 * DIRECTION DECIDES WHICH AXIS `gap` SPANS, so the `space-x` arm takes it. On a
 * column-major node `space-x-N` indents the children rather than spacing them,
 * and `gap` cannot express that — flagging it would demand a conversion that
 * changes what renders. `direction` is defaulted per renderer (`flex.tsx` →
 * `row`, `stack.tsx` → `col`), so the arm fires for a bare `flex` and stays
 * silent on a bare `stack`. The older `space-y` arm below does NOT take
 * direction: that is #4891's token set, left exactly as it landed, and the card
 * that added this one was scoped out of re-opening it. The catalog has zero
 * counter-examples for either arm today (measured: 0 `space-y` on any `stack`,
 * 0 `space-x` on any column-major node). If one ever appears, make that arm
 * direction-aware too — never add an exemption entry.
 */
function ownPropTokens(type: string, className: unknown, direction?: unknown): string[] {
  if (typeof className !== 'string') return [];
  const hits: string[] = [];
  // Which axis this node's `gap` spans, defaulted the way each renderer defaults
  // it. `space-x` is only that node's `gap` when the main axis is horizontal.
  const dir = typeof direction === 'string' ? direction : type === 'stack' ? 'col' : 'row';
  const rowMajor = dir === 'row' || dir === 'row-reverse';
  for (const token of className.trim().split(/\s+/).filter(Boolean)) {
    if (token.includes(':')) continue; // breakpoint / state override — stays
    let m: RegExpExecArray | null;
    if (type === 'flex' || type === 'stack') {
      if ((m = /^items-(.+)$/.exec(token)) && ALIGN_VALUES.has(m[1])) { hits.push(token); continue; }
      if ((m = /^justify-(.+)$/.exec(token)) && JUSTIFY_VALUES.has(m[1])) { hits.push(token); continue; }
      if ((m = /^gap-(\d+)$/.exec(token)) && GAP_LADDER[type].has(Number(m[1]))) { hits.push(token); continue; }
      if (token === 'flex-wrap') { hits.push(token); continue; }
      if (DIRECTION_TOKENS.has(token)) { hits.push(token); continue; }
      if (type === 'stack' && (m = /^space-y-(\d+)$/.exec(token)) && GAP_LADDER.stack.has(Number(m[1]))) {
        hits.push(token); continue;
      }
      // Gated on the ladder for the same reason the `gap-N` arm is: a step the
      // renderer does not map emits no gap class at all, so extracting it would
      // DELETE the spacing rather than move it (objectui#5690).
      if (rowMajor && (m = /^space-x-(\d+)$/.exec(token)) && GAP_LADDER[type].has(Number(m[1]))) {
        hits.push(token); continue;
      }
    }
    if (type === 'container') {
      if ((m = /^p-(\d+)$/.exec(token)) && CONTAINER_PADDING.has(Number(m[1]))) { hits.push(token); continue; }
      if ((m = /^max-w-(.+)$/.exec(token)) && CONTAINER_MAX_W.has(m[1])) { hits.push(token); continue; }
      if (token === 'mx-auto') { hits.push(token); continue; }
    }
    if (type === 'grid') {
      if ((m = /^gap-(\d+)$/.exec(token)) && GAP_LADDER.grid.has(Number(m[1]))) { hits.push(token); continue; }
      if (/^grid-cols-\d+$/.test(token)) { hits.push(token); continue; }
    }
  }
  return hits;
}

describe('schema-catalog — a layout node configures itself with props (#4891)', () => {
  it('no flex/stack/container/grid node hand-writes its own props in className', () => {
    const offenders = allExamples().flatMap((example) =>
      collect(
        example.schema,
        (n) => typeof n.type === 'string' && LAYOUT_TYPES.has(n.type as string),
      ).flatMap((n) =>
        ownPropTokens(String(n.type), n.className, propsOf(n).direction).map(
          (token) => `${example.id} :: ${String(n.type)} :: ${token} (in "${String(n.className)}")`,
        ),
      ),
    );
    expect(
      offenders,
      'a first-class layout node that spells its OWN declared prop in Tailwind ' +
        'teaches every reader to bypass the props — and `gap`/`padding` props ' +
        'render a mobile-first ladder that a hand-written single value cannot ' +
        '(#4891). Author the prop; leave decoration and breakpoint-prefixed ' +
        'overrides in className.',
    ).toEqual([]);
  });

  it('sees enough layout nodes WITH a className for the ratchet to mean something', () => {
    // The guard is only interesting over nodes that still carry a className at
    // all. The census, re-measured by each sweep rather than carried forward:
    // 252 before #4891; 187 after it (65 nodes had nothing left to say once
    // their props were extracted); 178 after #5690, whose nine nodes spelled
    // `space-x-N` and NOTHING else, so extracting it emptied their className
    // too. A floor, so adding examples never fails this, but a mass deletion of
    // classNames would — and it is deliberately TIGHTER than the 7 of headroom
    // it replaces (178 measured, 175 here). The number moved because a counted,
    // ruled sweep moved it; the next unexplained drop should be audible sooner,
    // not later.
    const withClassName = allExamples().flatMap((e) =>
      collect(e.schema, (n) => typeof n.type === 'string' && LAYOUT_TYPES.has(n.type as string))
        .filter((n) => typeof n.className === 'string' && n.className.trim() !== ''),
    );
    expect(withClassName.length).toBeGreaterThanOrEqual(175);
  });
});

describe('schema-catalog — `spacing` is not a key (#4890)', () => {
  it('no node anywhere authors `spacing`, which no schema declares', () => {
    const offenders = allExamples().flatMap((example) =>
      collect(example.schema, (n) => 'spacing' in n).map(
        (n) => `${example.id} (type: ${String(n.type)}, spacing: ${JSON.stringify(n.spacing)})`,
      ),
    );
    expect(
      offenders,
      '`spacing` is declared by nothing — `StackSchema` extends `FlexSchema`, ' +
        'whose spacing key is `gap`. It rendered only because `stack.tsx` read it ' +
        'behind an `as any`, and that reader is gone (#4890). A `stack` node ' +
        'authoring `spacing` now renders the DEFAULT gap; re-typing one to `flex` ' +
        'always did. Author `gap`.',
    ).toEqual([]);
  });

  it('the rename landed on every node, carrying every value across', () => {
    // Measured on `origin/main` before the sweep: 153 stack nodes, of which 18
    // already authored `gap` and the other 135 authored `spacing` — none had
    // neither. So "all 153 declare a gap" is the statement that all 135 arrived,
    // and the per-value counts are the statement that each arrived with the
    // value it had. The renamed 135 were {0:5, 1:13, 2:68, 3:14, 4:28, 6:7};
    // adding the 18 that already said `gap` ({2:5, 3:5, 4:7, 6:1}) gives the
    // census below. A rename that dropped a node, or coerced a value, moves one
    // of these numbers.
    const stacks = allExamples().flatMap((e) => collect(e.schema, (n) => n.type === 'stack'));
    expect(stacks.length, 'catalog stack-node count (a floor, so new examples are free)')
      .toBeGreaterThanOrEqual(153);

    const declared = stacks.filter((n) => typeof n.gap === 'number');
    expect(
      stacks.length - declared.length,
      'every stack node declares a numeric gap; the 135 that said `spacing` now say `gap`',
    ).toBe(0);

    const census: Record<string, number> = {};
    for (const n of declared) census[String(n.gap)] = (census[String(n.gap)] ?? 0) + 1;
    expect(census).toEqual({ '0': 5, '1': 13, '2': 73, '3': 19, '4': 35, '6': 8 });

    // Every value in that census is a step `stack.tsx` actually maps. An unmapped
    // step (the ladder skips 7) emits NO gap class at all, so the rename would
    // have been render-neutral in name only.
    for (const value of Object.keys(census)) {
      expect(GAP_LADDER.stack.has(Number(value)), `stack gap ${value} is not on the ladder`).toBe(true);
    }
  });
});

/**
 * Render-level equivalence for #4891, in the two kinds the conversion actually
 * produces. Each case carries the pre-sweep node as it shipped on `origin/main`,
 * rebuilt around the node's own children so the comparison isolates this one
 * conversion.
 *
 * This harness measures the className→props half ONLY. #4890's half cannot be
 * measured this way and must not appear to be: rendering a pre-sweep `spacing`
 * node through today's renderer exercises the DELETED leg's absence, not the
 * rename — see the note on the two stack cases below, and the deleted leg's own
 * reverse-verification in the PR.
 *
 * The comparison is on the class TOKEN SET, not the class string. `cn()` emits
 * the renderer's own classes first and the author's `className` last, so moving
 * a token from the author string into a prop moves it earlier in the output;
 * `tailwind-merge` has already resolved every same-property conflict by then, so
 * the surviving tokens do not conflict with one another and their order carries
 * no meaning. Asserting the string would be asserting `cn()`'s argument order.
 * The post-sweep string is still pinned literally, per case.
 *
 * `identical` — the set is unchanged: the author's token and the prop's token are
 * the same class. Every `align` / `justify` / `wrap` / `direction` extraction is
 * this kind.
 *
 * `ladder` — the set differs, in the gap/padding group ONLY, and deliberately:
 * `gap: 2` is `gap-1.5 sm:gap-2`, not `gap-2`. Below the `sm` breakpoint that is
 * genuinely a different rendering, and it is the correct one — the ladder IS what
 * the prop means (#4891's card says so, and #4003 pinned the same delta). Each
 * ladder case pins BOTH sides' spacing tokens and asserts everything else is
 * untouched, so "only the ladder moved" is a measurement rather than a claim.
 *
 * `grid` has no case because the sweep converted no grid node: re-measured on
 * `origin/main`, grid's unprefixed className tokens were `mb-6` and `p-4`, and a
 * grid declares neither. Zero hits, so there is nothing to sample.
 */
describe('the swept nodes render what they rendered before (#4891/#4890)', () => {
  type SweepCase = {
    readonly id: string;
    readonly type: string;
    /** the node exactly as it shipped before the sweep, minus children */
    readonly before: Record<string, unknown>;
    /** the class string the node renders now, pinned literally */
    readonly after: string;
    readonly kind: 'identical' | 'ladder';
  };

  const SWEEP_CASES: readonly SweepCase[] = [
    // ---- #4891, align/justify: same classes, now declared ----
    {
      id: 'actions/action-toolbar',
      type: 'flex',
      before: { className: 'items-center justify-between border-b pb-3 mb-4' },
      after: 'flex flex-row justify-between items-center gap-1.5 sm:gap-2 border-b pb-3 mb-4',
      kind: 'identical',
    },
    {
      id: 'app/application-header',
      type: 'flex',
      before: { className: 'items-center justify-between p-3 border rounded-lg bg-background' },
      after: 'flex flex-row justify-between items-center gap-1.5 sm:gap-2 p-3 border rounded-lg bg-background',
      kind: 'identical',
    },
    // ---- #4891, gap/wrap: the mobile-first ladder appears ----
    {
      id: 'actions/action-button-variants',
      type: 'flex',
      before: { className: 'gap-2 flex-wrap' },
      after: 'flex flex-row justify-start items-start gap-1.5 sm:gap-2 flex-wrap',
      kind: 'ladder',
    },
    {
      id: 'app/application-header',
      type: 'flex',
      before: { className: 'items-center gap-3' },
      after: 'flex flex-row justify-start items-center gap-2 sm:gap-3',
      kind: 'ladder',
    },
    // ---- #4891, container padding ----
    {
      id: 'dashboard/dashboard-overview',
      type: 'container',
      before: { className: 'p-4' },
      after: 'w-full max-w-xl mx-auto p-2 sm:p-3 md:p-4',
      kind: 'ladder',
    },
    {
      id: 'dashboard/recent-activity-card',
      type: 'container',
      before: { className: 'p-6' },
      after: 'w-full max-w-xl mx-auto p-3 sm:p-4 md:p-6',
      kind: 'ladder',
    },
    // ---- stack, where BOTH cards land on the same node ----
    // These two shipped as `spacing: N` + `items-center …`. `before` writes the
    // gap as `gap: N`, NOT as the `spacing: N` actually authored, and that is
    // deliberate: the leg that resolved `spacing` is deleted, so rendering the
    // literal pre-sweep node here would render the DEFAULT gap and this harness
    // would be measuring the alias removal instead of the className extraction.
    // (It would also pass for the wrong reason wherever the authored value
    // happened to be the default, 2 — which is how this was caught.) So the
    // rename is held to its own assertions — `spacing` banned above, the value
    // census below, and the renderer pin in
    // `packages/components/src/__tests__/stack-spacing-alias-removed.test.tsx` —
    // and what these two cases measure is the className half, on the resolved
    // gap the node had either way.
    {
      id: 'block-schema/feature-card-block',
      type: 'stack',
      before: { gap: 4, className: 'items-center text-center p-4' }, // shipped as `spacing: 4`
      after: 'flex flex-col justify-start items-center gap-2 sm:gap-3 md:gap-4 text-center p-4',
      kind: 'identical',
    },
    {
      id: 'block-schema/block-with-variable-overrides-analytics-feature',
      type: 'stack',
      before: { gap: 3, className: 'items-center text-center p-4' }, // shipped as `spacing: 3`
      after: 'flex flex-col justify-start items-center gap-2 sm:gap-3 text-center p-4',
      kind: 'identical',
    },
    // ---- objectui#5690: `space-x-N` on a row-major flex WAS that node's gap ----
    // Sampled the way #4891 sampled: both step values that shipped (2 and 4) and
    // both prop shapes the nine come in (`align`, `justify`). The `before` here
    // is the node exactly as it shipped, `space-x-N` and no `gap` — which is why
    // its spacing group has THREE tokens: the renderer's default `gap ?? 2`
    // ladder was rendering all along, additively, underneath the hand-written
    // margin (see the header note).
    {
      id: 'auth/login-simple',
      type: 'flex',
      before: { align: 'center', className: 'space-x-2' },
      after: 'flex flex-row justify-start items-center gap-1.5 sm:gap-2',
      kind: 'ladder',
    },
    {
      id: 'dashboard/recent-activity-card',
      type: 'flex',
      before: { align: 'center', className: 'space-x-4' },
      after: 'flex flex-row justify-start items-center gap-2 sm:gap-3 md:gap-4',
      kind: 'ladder',
    },
    {
      id: 'forms/settings-form',
      type: 'flex',
      before: { justify: 'end', className: 'space-x-2' },
      after: 'flex flex-row justify-end items-start gap-1.5 sm:gap-2',
      kind: 'ladder',
    },
  ];

  function renderClass(schema: unknown) {
    const { container } = render(<SchemaRenderer schema={schema as never} />);
    const el = container.firstElementChild as HTMLElement;
    return { className: el.className, innerHTML: el.innerHTML };
  }

  // The spacing group a `ladder` conversion is allowed to move. `space-x` /
  // `space-y` join `gap` / `p` here for objectui#5690: `space-x-4` IS the
  // pre-conversion spelling of the gap on those nodes, so leaving it outside the
  // group would make the "everything else is untouched" assertion fail on the
  // one token the conversion exists to move. No pre-#5690 case carries a
  // `space-*` token on either side, so widening the group changes none of their
  // verdicts (checked by re-running them: all nine unchanged).
  const isSpacingToken = (t: string) => /(^|:)(gap|p|space-[xy])-/.test(t);
  const sorted = (s: string) => s.trim().split(/\s+/).filter(Boolean).sort();

  it('covers every converted category and both kinds of delta', () => {
    expect(SWEEP_CASES.filter((c) => c.kind === 'identical').length).toBeGreaterThanOrEqual(2);
    expect(SWEEP_CASES.filter((c) => c.kind === 'ladder').length).toBeGreaterThanOrEqual(2);
    for (const type of ['flex', 'stack', 'container']) {
      expect(SWEEP_CASES.filter((c) => c.type === type).length, `${type} needs 2+ cases`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it.each(SWEEP_CASES.map((c) => [`${c.id} (${c.type}, ${c.kind})`, c] as const))(
    '%s',
    (_label, testCase) => {
      const example = allExamples().find((e) => e.id === testCase.id);
      expect(example, `${testCase.id} is missing from the catalog`).toBeTruthy();

      const node = collect(example!.schema, (n) => n.type === testCase.type).find(
        (n) => renderClass(n).className === testCase.after,
      );
      expect(
        node,
        `${testCase.id} has no ${testCase.type} node rendering \`${testCase.after}\` — ` +
          'the pin is stale, or the sweep was undone',
      ).toBeTruthy();

      // Rebuild the pre-sweep node around the SAME children. It shipped flat,
      // and a stored flat node still renders (the hoist reads both spellings).
      const asAuthoredBefore: Node = { type: testCase.type, ...testCase.before };
      if (propsOf(node!).children !== undefined) asAuthoredBefore.children = propsOf(node!).children;

      const after = renderClass(node!);
      const before = renderClass(asAuthoredBefore);

      expect(after.className).toBe(testCase.after);
      // Content still reaches the DOM — the failure a naive re-type produces.
      expect(after.innerHTML).toBe(before.innerHTML);

      if (testCase.kind === 'identical') {
        expect(
          sorted(after.className),
          'this conversion changes no class at all; the props emit exactly the ' +
            'tokens the author had written by hand',
        ).toEqual(sorted(before.className));
      } else {
        // Everything that is NOT gap/padding is untouched...
        expect(
          sorted(after.className).filter((t) => !isSpacingToken(t)),
          'a ladder conversion must move the gap/padding group and NOTHING else',
        ).toEqual(sorted(before.className).filter((t) => !isSpacingToken(t)));
        // ...and the spacing group genuinely differs, which is the upgrade.
        expect(
          sorted(after.className).filter(isSpacingToken),
          'the whole point of the prop: a single hand-written step becomes a ' +
            'mobile-first ladder',
        ).not.toEqual(sorted(before.className).filter(isSpacingToken));
      }
    },
  );
});

/**
 * objectui#5690's OPPOSITE ARM, measured rather than assumed.
 *
 * The card ruled the nine `space-x-*` nodes drift, and ruled the ruling
 * checkable: a node that genuinely wants "gutters between siblings but no gutter
 * above a wrapped row" is asking for `space-x`, and converting THAT node would
 * be a regression. So the conversion is only honest if every one of the nine was
 * checked and none of them was that node. All nine were; none was; and the check
 * lives here rather than in a PR sentence so it cannot quietly stop being true.
 *
 * HOW THE WRAP QUESTION IS DECIDED, and why not by sampling pixels. A flex
 * container wraps if and only if its computed `flex-wrap` is `wrap` or
 * `wrap-reverse` (CSS Flexible Box, §5.1: a `nowrap` container is single-line).
 * That is a property of the container, not of the viewport or the content —
 * children of a `nowrap` container shrink or overflow, they never move to a
 * second row. `flex.tsx` emits `flex-wrap` only for `wrap: true`, and Tailwind's
 * `.flex` sets no flex-wrap of its own, so a rendered class list with no
 * flex-wrap token leaves the CSS initial value standing. Reading that token off
 * the REAL renderer therefore answers the question at every width at once, which
 * strictly subsumes any finite sample of viewport widths — and it is the only
 * honest instrument available here anyway, because happy-dom has no layout
 * engine (`offsetTop` is 0 for everything, so "did this row wrap" cannot be
 * observed by measuring boxes in this environment).
 *
 * Both sides are read, not just the converted one: if the node as it SHIPPED
 * could wrap, it is the intent case regardless of what it renders now.
 *
 * The second divergence axis is the selector. `space-x` skips hidden siblings
 * (`> :not([hidden]) ~ :not([hidden])`) and is order-sensitive in a way `gap` is
 * not, so a node whose child list is not a static row can diverge without ever
 * wrapping. Each of the nine is a fixed pair — an auth checkbox and its label,
 * an activity avatar and its name block, a cancel/save button pair — with no
 * `hidden` / `visible` expression on either child, which is asserted below
 * rather than described.
 */
describe('the nine converted `space-x` nodes were single-line static rows (#5690)', () => {
  /**
   * The nine sites, at the paths the card enumerated them by, so this table is
   * auditable against the card instead of against itself. Third element is the
   * `gap` that replaced the node's `space-x-N` — the same N. A step under a
   * `flex` parent passes through that parent's bag (`properties.children.N`),
   * where objectui#11276 moved the child list; the steps are otherwise the
   * card's.
   */
  const SPACE_X_SITES: ReadonlyArray<readonly [string, string, number]> = [
    ['auth/login-simple', 'children.0.children.2.properties.children.0', 2],
    ['auth/signup', 'children.0.children.3', 2],
    ['dashboard/recent-activity-card', 'children.0.children.1.children.0.properties.children.0', 4],
    ['dashboard/recent-activity-card', 'children.0.children.1.children.1.properties.children.0', 4],
    ['dashboard/recent-activity-card', 'children.0.children.1.children.2.properties.children.0', 4],
    ['dashboard/recent-activity-card', 'children.0.children.1.children.3.properties.children.0', 4],
    ['dashboard/recent-activity-card', 'children.0.children.1.children.4.properties.children.0', 4],
    ['forms/newsletter-signup', 'children.0.children.2', 2],
    ['forms/settings-form', 'children.1.children.0.children.3', 2],
  ];

  const WRAP_TOKEN = /^(.*:)?flex-wrap(-reverse)?$/;

  const at = (schema: unknown, path: string): Node | undefined =>
    path.split('.').reduce<unknown>(
      (acc, key) => (acc == null ? undefined : (acc as Node)[key]),
      schema,
    ) as Node | undefined;

  /** The node exactly as it shipped before the conversion: flat, `space-x-N` in place of `gap`. */
  const asShipped = (node: Node): Node => {
    const before: Node = { ...node, ...propsOf(node), className: `space-x-${String(propsOf(node).gap)}` };
    delete before.properties;
    delete before.gap;
    return before;
  };

  function renderedClass(schema: unknown): string {
    const { container } = render(<SchemaRenderer schema={schema as never} />);
    return (container.firstElementChild as HTMLElement).className;
  }

  it('covers all nine sites the card enumerated, not a sample', () => {
    expect(SPACE_X_SITES.length).toBe(9);
    const missing = SPACE_X_SITES.filter(
      ([id, path]) => !at(allExamples().find((e) => e.id === id)?.schema, path),
    ).map(([id, path]) => `${id} :: ${path}`);
    expect(missing, 'a site no longer resolves — the paths are stale, not the sweep').toEqual([]);
  });

  it('every site now declares `gap` and has no className left to declare it in', () => {
    const offenders = SPACE_X_SITES.flatMap(([id, path, gap]) => {
      const node = at(allExamples().find((e) => e.id === id)?.schema, path);
      if (!node) return [];
      const problems: string[] = [];
      if (node.type !== 'flex') problems.push(`type is ${String(node.type)}, not flex`);
      if (propsOf(node).gap !== gap) problems.push(`gap is ${JSON.stringify(propsOf(node).gap)}, not ${gap}`);
      if (node.className !== undefined) {
        problems.push(`className survived as ${JSON.stringify(node.className)}`);
      }
      return problems.map((p) => `${id} :: ${path} — ${p}`);
    });
    expect(
      offenders,
      'each of the nine spelled `space-x-N` and nothing else, so the conversion ' +
        'moves N into `gap` and leaves the node with no className at all (#5690)',
    ).toEqual([]);
  });

  it('not one of the nine could wrap — the place `space-x` and `gap` diverge', () => {
    const intentCases = SPACE_X_SITES.flatMap(([id, path]) => {
      const node = at(allExamples().find((e) => e.id === id)?.schema, path);
      if (!node) return [];
      const reasons: string[] = [];

      // Read the wrap token off the real renderer, on BOTH sides.
      for (const [side, schema] of [
        ['as it shipped', asShipped(node)],
        ['as converted', node],
      ] as const) {
        const wrapTokens = renderedClass(schema).split(/\s+/).filter((t) => WRAP_TOKEN.test(t));
        if (wrapTokens.length > 0) {
          reasons.push(`${side} it declares \`${wrapTokens.join(' ')}\``);
        }
      }

      // ...and the selector axis: a fixed pair, neither half conditional.
      const children = Array.isArray(propsOf(node).children) ? (propsOf(node).children as Node[]) : [];
      if (children.length !== 2) {
        reasons.push(`its child list is ${children.length} long, not the static pair measured`);
      }
      if (children.some((c) => c && typeof c === 'object' && ('hidden' in c || 'visible' in c))) {
        reasons.push('one of its children is conditionally rendered');
      }
      return reasons.map((r) => `${id} :: ${path} — ${r}`);
    });

    expect(
      intentCases,
      'THIS NODE IS THE INTENT CASE, not drift: `space-x` and `gap` differ ' +
        'precisely where a row wraps or a sibling drops out, so a node that can ' +
        'do either was asking for `space-x` and must be left unconverted, with ' +
        'the reason recorded in `ownPropTokens()`\'s docblock (#5690, the card\'s ' +
        'own opposite arm).',
    ).toEqual([]);
  });

  it('the ratchet arm refuses a tenth `space-x` node', () => {
    // Fails on the pre-#5690 helper, which returned [] for every line here:
    // `space-x-*` was not in its token set, which is how nine of them shipped.
    expect(ownPropTokens('flex', 'space-x-2 border-b')).toEqual(['space-x-2']);
    expect(ownPropTokens('flex', 'space-x-4')).toEqual(['space-x-4']);
    expect(
      ownPropTokens('stack', 'space-x-2', 'row'),
      'a row-major stack is a flex row; its `gap` is the horizontal one',
    ).toEqual(['space-x-2']);

    // ...and the four shapes it must NOT claim, each for a reason that would
    // otherwise cost a wrong conversion:
    expect(
      ownPropTokens('flex', 'space-x-2', 'col'),
      'column-major: `space-x` indents the children, and `gap` cannot say that',
    ).toEqual([]);
    expect(
      ownPropTokens('stack', 'space-x-2'),
      'a bare stack is column-major — `stack.tsx` defaults `direction` to col',
    ).toEqual([]);
    expect(
      ownPropTokens('flex', 'sm:space-x-2'),
      'breakpoint-prefixed tokens stay in className; the props are not responsive',
    ).toEqual([]);
    expect(
      ownPropTokens('flex', 'space-x-9'),
      '9 is off the flex gap ladder, so extracting it would delete the spacing',
    ).toEqual([]);
  });
});
