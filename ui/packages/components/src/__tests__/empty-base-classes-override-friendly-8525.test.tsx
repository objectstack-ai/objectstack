/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `Empty`'s base classes are override-friendly, and carry no inert border
 * (objectui#8525).
 *
 * ## What was wrong
 *
 * The container's base string read `… rounded-lg border-dashed p-6 … md:p-12`.
 *
 *   * `md:p-12` is a different tailwind-merge VARIANT from any unprefixed
 *     padding a caller passes, so `cn()` kept it next to `px-3 py-8`, and from
 *     768px up the `md:` rule won the cascade. Three app-shell sites that wrote
 *     "less padding" (`ConversationsSidebar` `px-3 py-8`, `AuditPanel` `py-10`
 *     twice) got the full 48px back on every desktop viewport — the card
 *     measured 118.8px with and without the override, identical. Even a full
 *     `p-4` lost: tailwind-merge dropped `p-6` for it and `md:p-12` survived.
 *   * `border-dashed` sets `border-style` only. Preflight zeroes `border-width`
 *     on every element and nothing at any of the 44 call sites supplied a
 *     width, so the class drew nothing. Ruled: REMOVE it; ⛔ never add a width
 *     here — a frame around every empty state is a product-wide visual decision
 *     nobody has made, and it gets its own card if anyone wants it.
 *
 * ## The instrument, and why this is not a class-string pin
 *
 * The class attribute is read off the REAL component (RTL render). The CSS the
 * workspace Tailwind emits for exactly those classes is built through the public
 * compiler with explicit candidates and `base` pinned to the repo root, on the
 * shipped `@theme` (`packages/components/src/index.css`, the block every
 * consuming app loads). No source is scanned, so the reading does not depend on
 * the cwd Tailwind is launched from — this repo's scanning compiles do.
 *
 * A small cascade evaluator then walks that stylesheet in source order and
 * answers, per padding side and per viewport width, WHICH declaration wins.
 * Every selector here is one class inside one `@layer`, so source order is the
 * whole cascade: the evaluator implements no specificity and refuses any
 * selector it cannot map back to one class. The control below shows it
 * reproduces the defect on the OLD base shape, so a green reading on the new
 * shape is a measurement and not an inert instrument.
 *
 * Values are spacing units (`p-6` → 6). `12` on every side at 768px for a site
 * with NO override is the non-regression axis — the caricature that drops
 * `md:p-12` outright makes every override "win" and fails exactly there. `8` on
 * the block axis at 768px for `px-3 py-8` is the fix.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { compile } from 'tailwindcss';
import { Empty } from '../custom/empty';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/** The shipped `@theme` block, as `headerColor.test.ts` reads it. */
function themeBlock(): string {
  const css = fs.readFileSync(path.join(repoRoot, 'packages/components/src/index.css'), 'utf8');
  const start = css.indexOf('@theme {');
  expect(start, 'components/src/index.css should declare a @theme block').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unterminated @theme block');
}

/**
 * One compiler per file. `build()` is cumulative on a compiler instance, so the
 * stylesheet grows across calls — harmless, because the evaluator applies only
 * the rules whose class is on the element it evaluates, as a browser would.
 */
let compilerPromise: ReturnType<typeof compile> | undefined;
async function buildCss(candidates: string[]): Promise<string> {
  compilerPromise ??= (async () => {
    const twEntry = path.join(repoRoot, 'node_modules/tailwindcss/index.css');
    const twDir = path.dirname(fs.realpathSync(twEntry));
    return compile(`@import "tailwindcss";\n${themeBlock()}\n`, {
      base: repoRoot,
      loadStylesheet: async (id: string, base: string) => {
        const file = id === 'tailwindcss'
          ? path.join(twDir, 'index.css')
          : id.startsWith('tailwindcss/')
            ? path.join(twDir, id.slice('tailwindcss/'.length))
            : path.resolve(base, id);
        return { base: path.dirname(file), path: file, content: fs.readFileSync(file, 'utf8') };
      },
    });
  })();
  return (await compilerPromise).build(candidates);
}

/** The class list the real component puts in the DOM for a given override. */
function classesOf(className?: string): string[] {
  const { container, unmount } = render(<Empty className={className} />);
  const el = container.querySelector('[data-slot="empty"]');
  expect(el, 'Empty renders its data-slot="empty" container').not.toBeNull();
  const classes = (el!.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  unmount();
  return classes;
}

// ---------------------------------------------------------------------------
// A cascade evaluator for single-class utilities in one layer.
// ---------------------------------------------------------------------------

interface Rule { className: string; media: string[]; decls: Array<[string, string]> }

/** Walk `css` and return every single-class rule inside `@layer utilities`, in source order. */
function utilityRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (src: string, media: string[], inUtilities: boolean) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open === -1) break;
      let head = src.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      const segs = head.split(/[;}]/);
      head = segs[segs.length - 1].trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith('@layer')) {
        walk(body, media, inUtilities || /^@layer\s+utilities\b/.test(head));
      } else if (head.startsWith('@media')) {
        walk(body, [...media, head.slice('@media'.length).trim()], inUtilities);
      } else if (head.startsWith('@')) {
        // @property / @keyframes / @supports … — nothing here reads them.
      } else if (inUtilities && head) {
        if (!head.startsWith('.') || /[\s>+~,]|(?<!\\):/.test(head.slice(1).replace(/\\./g, 'x'))) {
          throw new Error(`evaluator cannot map selector to one class: ${head}`);
        }
        const className = head.slice(1).replace(/\\(.)/g, '$1');
        const decls = body
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(';')
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d): [string, string] => {
            const k = d.indexOf(':');
            return [d.slice(0, k).trim(), d.slice(k + 1).trim()];
          });
        rules.push({ className, media, decls });
      }
      i = j;
    }
  };
  walk(css, [], false);
  return rules;
}

/** Does every media condition hold at `widthPx`? Refuses shapes it does not know. */
function mediaHolds(media: string[], widthPx: number): boolean {
  return media.every((m) => {
    const ge = m.match(/\(\s*width\s*>=\s*([\d.]+)(rem|px)\s*\)/);
    if (ge) return widthPx >= Number(ge[1]) * (ge[2] === 'rem' ? 16 : 1);
    const lt = m.match(/\(\s*width\s*<\s*([\d.]+)(rem|px)\s*\)/);
    if (lt) return widthPx < Number(lt[1]) * (lt[2] === 'rem' ? 16 : 1);
    const min = m.match(/min-width:\s*([\d.]+)(rem|px)/);
    if (min) return widthPx >= Number(min[1]) * (min[2] === 'rem' ? 16 : 1);
    throw new Error(`evaluator cannot read media query: ${m}`);
  });
}

type Side = 'top' | 'right' | 'bottom' | 'left';
type Sides = Record<Side, number>;
const SIDES_OF: Record<string, Side[]> = {
  'padding': ['top', 'right', 'bottom', 'left'],
  'padding-inline': ['left', 'right'],
  'padding-block': ['top', 'bottom'],
  'padding-top': ['top'],
  'padding-right': ['right'],
  'padding-bottom': ['bottom'],
  'padding-left': ['left'],
  'padding-inline-start': ['left'],
  'padding-inline-end': ['right'],
};

/**
 * The padding a browser would compute for an element carrying `classes`, at
 * `widthPx`, in spacing units — from the winning declaration per side after a
 * source-order walk of the rules that match the element.
 */
function computedPadding(css: string, classes: string[], widthPx: number): Sides {
  const onElement = new Set(classes);
  const env = new Map<string, string>();
  const raw: Partial<Record<Side, string>> = {};
  for (const rule of utilityRules(css)) {
    if (!onElement.has(rule.className) || !mediaHolds(rule.media, widthPx)) continue;
    for (const [prop, value] of rule.decls) {
      if (prop.startsWith('--')) env.set(prop, value);
      else if (prop in SIDES_OF) for (const side of SIDES_OF[prop]) raw[side] = value;
    }
  }
  const resolve = (side: Side): number => {
    let value = raw[side];
    if (value === undefined) throw new Error(`no padding declaration reached side "${side}" at ${widthPx}px`);
    value = value.replace(/var\((--[\w-]+)\)/g, (token, name: string) => {
      // `--spacing` is the theme token the unit regex below reads verbatim; every
      // other custom property must have been set on this element.
      if (name === '--spacing') return token;
      const v = env.get(name);
      if (v === undefined) throw new Error(`"${name}" is consumed but never set on this element at ${widthPx}px`);
      return v;
    });
    const units = value.match(/^calc\(var\(--spacing\) \* ([\d.]+)\)$/);
    if (units) return Number(units[1]);
    if (/^0(px)?$/.test(value)) return 0;
    throw new Error(`evaluator cannot read a padding value: ${value}`);
  };
  return { top: resolve('top'), right: resolve('right'), bottom: resolve('bottom'), left: resolve('left') };
}

const all = (n: number): Sides => ({ top: n, right: n, bottom: n, left: n });

/** Every default breakpoint, one pixel either side, plus a phone and a desktop. */
const LADDER = [320, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1535, 1536, 1920];

/** The `md` breakpoint in px, read from the theme through the same compiler. */
async function mdPx(): Promise<number> {
  const rule = utilityRules(await buildCss(['md:hidden'])).find((r) => r.className === 'md:hidden');
  expect(rule?.media, 'md:hidden is emitted under one media query').toHaveLength(1);
  const m = rule!.media[0].match(/\(\s*width\s*>=\s*([\d.]+)(rem|px)\s*\)/);
  expect(m, `md media query has a readable threshold: ${rule!.media[0]}`).not.toBeNull();
  return Number(m![1]) * (m![2] === 'rem' ? 16 : 1);
}

async function paddingAcrossLadder(override?: string): Promise<Array<{ width: number; sides: Sides }>> {
  const classes = classesOf(override);
  const css = await buildCss(classes);
  return LADDER.map((width) => ({ width, sides: computedPadding(css, classes, width) }));
}

describe('Empty — the padding default and every override, cascade-evaluated on the emitted CSS', () => {
  it('the evaluator itself reproduces the defect on the OLD base shape (control)', async () => {
    // `p-6 … md:p-12` with a caller's `px-3 py-8`, as tailwind-merge left it:
    // at md the base wins on every side. A green run on the new shape below
    // therefore means the shape changed, not that the instrument is inert.
    const old = ['p-6', 'md:p-12', 'px-3', 'py-8'];
    const css = await buildCss(old);
    const md = await mdPx();
    expect(computedPadding(css, old, md - 1)).toEqual({ top: 8, right: 3, bottom: 8, left: 3 });
    expect(computedPadding(css, old, md)).toEqual(all(12));
  });

  it('a site with NO override still gets 6 below md and 12 at and above it (the non-regression axis)', async () => {
    const md = await mdPx();
    for (const { width, sides } of await paddingAcrossLadder(undefined)) {
      expect(sides, `no override at ${width}px`).toEqual(all(width >= md ? 12 : 6));
    }
  });

  it('`px-3 py-8` (ConversationsSidebar) wins on every side at every width', async () => {
    for (const { width, sides } of await paddingAcrossLadder('px-3 py-8')) {
      expect(sides, `px-3 py-8 at ${width}px`).toEqual({ top: 8, right: 3, bottom: 8, left: 3 });
    }
  });

  it('`py-10` (AuditPanel) wins on the block axis at every width, and the inline axis keeps the responsive default', async () => {
    const md = await mdPx();
    for (const { width, sides } of await paddingAcrossLadder('py-10')) {
      const inline = width >= md ? 12 : 6;
      expect(sides, `py-10 at ${width}px`).toEqual({ top: 10, right: inline, bottom: 10, left: inline });
    }
  });

  it('a full `p-4` wins on every side at every width', async () => {
    for (const { width, sides } of await paddingAcrossLadder('p-4')) {
      expect(sides, `p-4 at ${width}px`).toEqual(all(4));
    }
  });

  it('a caller can still be responsive itself: `p-2 md:p-4` reads 2 below md and 4 at and above it', async () => {
    const md = await mdPx();
    for (const { width, sides } of await paddingAcrossLadder('p-2 md:p-4')) {
      expect(sides, `p-2 md:p-4 at ${width}px`).toEqual(all(width >= md ? 4 : 2));
    }
  });

  it('a prefixed-only override keeps the default below its breakpoint: `md:p-3` reads 6 then 3', async () => {
    const md = await mdPx();
    for (const { width, sides } of await paddingAcrossLadder('md:p-3')) {
      expect(sides, `md:p-3 at ${width}px`).toEqual(all(width >= md ? 3 : 6));
    }
  });
});

describe('Empty — the mechanism, as rendered', () => {
  it('no padding utility in the base classes carries a variant prefix', () => {
    // A `VARIANT:p*-` token in the base is exactly what an unprefixed override
    // cannot beat through `cn()`; the responsive default has to travel some
    // other way (today: a custom property).
    const prefixedPadding = classesOf(undefined).filter((token) => {
      const bare = token.replace(/^(?:[^\s:[\]]+:)+/, '');
      return bare !== token && /^-?p[xytrblse]?-/.test(bare);
    });
    expect(prefixedPadding).toEqual([]);
  });

  it('a caller\'s override tokens reach the DOM untouched', () => {
    for (const override of ['px-3 py-8', 'py-10', 'p-4']) {
      const classes = classesOf(override);
      for (const token of override.split(' ')) expect(classes, override).toContain(token);
    }
  });
});

describe('Empty — the border half', () => {
  it('control: on this workspace build `border-dashed` alone is style-only, `border` carries the width, and preflight zeroes every border', async () => {
    const css = await buildCss(['border-dashed', 'border']);
    const rules = utilityRules(css);
    const dashed = rules.find((r) => r.className === 'border-dashed')!;
    const border = rules.find((r) => r.className === 'border')!;
    expect(dashed.decls.map(([k]) => k)).toContain('border-style');
    expect(dashed.decls.some(([k]) => /width$/.test(k) || k === 'border')).toBe(false);
    expect(border.decls.some(([k, v]) => k === 'border-width' && v === '1px')).toBe(true);
    // preflight: `*, ::after, ::before, … { … border: 0 solid; }`
    expect(css).toMatch(/\*,\s*::after,\s*::before[^{]*\{[^}]*\bborder:\s*0 solid\b/);
  });

  it('the base classes never declare a border-style without a border-width (the inert-frame class of defect)', async () => {
    const classes = classesOf(undefined);
    const rules = utilityRules(await buildCss(classes)).filter((r) => classes.includes(r.className));
    const styleSetters = rules.filter((r) => r.decls.some(([k]) => /^border(-\w+)?-style$/.test(k))).map((r) => r.className);
    const widthSetters = rules.filter((r) => r.decls.some(([k]) => /^border(-[\w-]+)?-width$/.test(k) || k === 'border')).map((r) => r.className);
    expect(styleSetters.length === 0 || widthSetters.length > 0, `style ${styleSetters} without width`).toBe(true);
  });

  it('carries no border utility today — the former `border-dashed` was inert, and a frame is a design change with its own card', () => {
    // The ADR-0049 remove branch. A future deliberate frame updates this pin
    // together with the card that decides it; it does not arrive by accident.
    expect(classesOf(undefined).filter((token) => /^border(-|$)/.test(token))).toEqual([]);
  });
});
