import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for a record page in a narrow drawer (objectstack#34614): a
 * relative time never breaks word by word, and a key-field badge is never cut
 * to a letter.
 *
 * Measured on the real record page in a 380 px drawer before the fix: the meta
 * line's "Updated by NAME · 2 days ago" drew its time on two or three lines,
 * and an activity entry's header drew "3 days ago" as "3 days" over "ago",
 * because each time was a shrinkable piece of a row that could not wrap. Now
 * the time (with its dot on the meta line) is one `whitespace-nowrap` piece and
 * the row wraps between pieces, so the whole time moves to the next line.
 * Badges were measured whole or ellipsised with their label as the title; the
 * badge cases below hold that.
 *
 * A Playwright spec and not a vitest test for the reason
 * `record-header-title-width.spec.ts` gives: jsdom has no layout engine, so a
 * width read there is 0 and an assertion on it is vacuous. The class-shape
 * half is pinned beside the components in `narrowDrawerTime-34614.test.tsx`.
 *
 * REAL, read out of the sources at run time: the meta row, entry, time unit
 * and `<time>` classes (`RecordMetaFooter.tsx`), the activity comment row's
 * row, icon cell, content column, header row, right-hand tail and time classes
 * (`RecordActivityTimeline.tsx`, the dense day-grouped rows of objectstack#35602),
 * the badge's base classes (`ui/badge.tsx`), the select badge's own classes
 * (`@object-ui/fields`) and the default page's key-field grid cell
 * (`HeaderHighlight.tsx`), plus real Tailwind compiled from the installed
 * `tailwindcss` for exactly those candidates. FIXTURE: the names, labels and
 * times, and the element trees, transcribed from those sources.
 */

const REPO_ROOT = uiRoot();
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** One capture out of a source, asserting tokens so a drifted match throws. */
function grab(file: string, re: RegExp, mustContain: string[]): string {
  const m = read(file).match(re);
  if (!m) throw new Error(`${file}: nothing matched ${re}`);
  const cls = m[1];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(
        `${file}: ${re} matched "${cls}", which does not carry "${token}" — the extraction ` +
          'walked onto the wrong string, so this measurement would be meaningless.',
      );
    }
  }
  return cls;
}

const META = 'packages/plugin-detail/src/RecordMetaFooter.tsx';
const FEED = 'packages/plugin-detail/src/RecordActivityTimeline.tsx';
const STRIP = 'packages/plugin-detail/src/HeaderHighlight.tsx';
const BADGE = 'packages/components/src/ui/badge.tsx';
const FIELDS = 'packages/fields/src/index.tsx';

const CLS = {
  metaRow: grab(META, /'(flex flex-wrap items-center gap-x-4 gap-y-1)'/, ['flex-wrap']),
  metaText: grab(META, /'(text-xs text-muted-foreground)',\s*className/, ['text-xs']),
  metaEntry: grab(META, /<span className="([^"]+)" data-record-meta-entry="">/, ['inline-flex']),
  metaLabel: grab(META, /data-record-meta-entry="">\s*<span className="([^"]+)">\{label\}/, ['text-muted-foreground/70']),
  metaUser: grab(META, /<span className="(inline-flex items-center \[&_a\][^"]*)">/, ['inline-flex']),
  metaWhen: grab(META, /<span className="([^"]+)" data-record-meta-when="">/, ['inline-flex']),
  metaDot: grab(META, /data-record-meta-when="">\s*\{user \? <span className="([^"]+)">·<\/span>/, ['text-muted-foreground/40']),
  metaTime: grab(META, /<time\s+dateTime=\{[^}]+\}\s+className="([^"]+)"/, ['cursor-default']),
  feedRow: grab(FEED, /<div key=\{item\.id\} className="group" data-stream-comment-row="">\s*<div className="([^"]+)">/, ['flex', 'gap-2']),
  feedIcon: grab(FEED, /const STREAM_ICON_CELL =\s*'([^']+)'/, ['shrink-0', 'w-3.5']),
  feedContent: grab(FEED, /\{\/\* Content[^*]*\*\/\}\s*<div className="([^"]+)">/, ['flex-1', 'min-w-0']),
  feedHeader: grab(FEED, /const STREAM_COMMENT_HEADER =\s*'([^']+)'/, ['flex', 'flex-wrap', 'items-center']),
  feedActor: grab(FEED, /<span className="([^"]+)">\{item\.actor\}<\/span>\s*\{item\.source/, ['font-medium']),
  feedTail: grab(FEED, /<span className="(ml-auto [^"]+)">\s*\{\(toggleReaction/, ['ml-auto', 'flex']),
  feedWhen: grab(FEED, /<span className="([^"]+)" data-feed-when="">\s*\{formatTimestamp\(item\.createdAt/, ['text-xs']),
  badgeBase: grab(BADGE, /cva\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/, ['inline-flex', 'whitespace-nowrap', 'rounded-full']),
  badgeSelect: grab(FIELDS, /<Badge[\s\S]{0,200}?className=\{cn\('([^']+)', colorClasses\)\}/, ['max-w-full']),
  stripGrid: grab(STRIP, /className=\{gridFace \? cn\(\s*'([^']+)'/, ['grid', 'grid-cols-2']),
  stripCell: grab(STRIP, /className=\{gridFace \? '([^']+)' : cn\(/, ['min-w-0']),
  stripValueRow: grab(STRIP, /cn\(\s*'(flex items-start justify-between gap-1)'/, ['flex']),
  stripValueBox: grab(STRIP, /<div className="(min-w-0 flex-1)">\s*\{isBoolean/, ['flex-1']),
  stripValue: grab(STRIP, /'(block min-w-0 truncate text-sm font-semibold)'/, ['truncate']),
};

/** A meta line whose second entry cannot fit one 380/400 px line. */
const metaFixture = () => {
  const entry = (label: string, user: string, when: string, id: string) =>
    `<span class="${CLS.metaEntry}"><span id="${id}-label" class="${CLS.metaLabel}">${label}</span>` +
    `<span class="${CLS.metaUser}"><span>${user}</span></span>` +
    `<span class="${CLS.metaWhen}"><span class="${CLS.metaDot}">·</span>` +
    `<time id="${id}" class="${CLS.metaTime}">${when}</time></span></span>`;
  return (
    `<div id="row" class="${CLS.metaRow} ${CLS.metaText}">` +
    entry('Created by', 'Jianguo Zhuang', '3 days ago', 'created') +
    entry('Updated by', 'Alexandra Konstantinopoulou-Whitfield Administrator', '2 days ago', 'updated') +
    '</div>'
  );
};

/** An activity entry whose header cannot fit one 380/400 px line. */
const feedFixture = () =>
  `<div><div class="${CLS.feedRow}">` +
  `<div class="${CLS.feedIcon}"></div>` +
  `<div class="${CLS.feedContent}"><div id="header" class="${CLS.feedHeader}">` +
  `<span id="actor" class="${CLS.feedActor}">Jianguo Zhuang Administrator</span>` +
  '<span class="text-xs text-muted-foreground">via Email Gateway Integration</span>' +
  `<span class="${CLS.feedTail}"><span id="feed-when" class="${CLS.feedWhen}">3 days ago</span></span>` +
  '</div><p class="text-sm">Sent the revised quote.</p></div></div></div>';

/** Two key-field cells on the default page's grid, each holding a select badge. */
const badgeFixture = () => {
  const cell = (caption: string, label: string, id: string) =>
    `<div class="${CLS.stripCell}"><span class="text-xs font-medium">${caption}</span>` +
    `<div class="${CLS.stripValueRow}"><div class="${CLS.stripValueBox}">` +
    `<span class="${CLS.stripValue}" title="${label}">` +
    `<div id="${id}" class="${CLS.badgeBase} ${CLS.badgeSelect}" title="${label}" data-select-badge="">` +
    `<span class="truncate">${label}</span></div>` +
    '</span></div></div></div>';
  return (
    `<section class="@container"><div class="${CLS.stripGrid}">` +
    cell('Stage', '方案报价', 'short') +
    cell('Lead Source', 'Customer referral via partner channel program', 'long') +
    '</div></section>'
  );
};

let css = '';
test.beforeAll(async () => {
  const twEntry = fileURLToPath(import.meta.resolve('tailwindcss/index.css'));
  const compiler = await compile('@import "tailwindcss";', {
    base: path.dirname(twEntry),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? twEntry : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
  });
  css = compiler.build(
    [...Object.values(CLS), 'text-xs text-sm font-medium text-muted-foreground truncate @container']
      .join(' ')
      .split(/\s+/)
      .filter(Boolean),
  );
  if (!css.includes('white-space: nowrap')) {
    throw new Error('Tailwind produced no `white-space: nowrap` — the unit under test would be inert.');
  }
});

async function mount(page: Page, html: string, width: number) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(
    `<style>html,body{margin:0}body{font:14px/1.5 Inter,"WenQuanYi Zen Hei",sans-serif}${css}</style>` +
      `<div id="drawer" style="width:${width}px;margin-left:40px">${html}</div>`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts?.ready);
}

/** How many lines an element's text occupies, from its line boxes. */
const linesOf = (page: Page, id: string) =>
  page.evaluate((elId) => {
    const el = document.getElementById(elId)!;
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
    return tops.size;
  }, id);

const box = (page: Page, id: string) =>
  page.evaluate((elId) => {
    const r = document.getElementById(elId)!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, right: r.right, width: r.width };
  }, id);

test.describe('a record page in a narrow drawer (objectstack#34614)', () => {
  for (const width of [380, 400]) {
    test(`the meta line's times stay on one line at ${width}px`, async ({ page }) => {
      await mount(page, metaFixture(), width);
      for (const id of ['created', 'updated']) {
        expect(await linesOf(page, id), `the ${id} time broke across lines`).toBe(1);
      }
      // The long entry really did run out of line: its time moved down, whole,
      // and stays inside the drawer.
      const when = await box(page, 'updated');
      expect(when.top).toBeGreaterThanOrEqual((await box(page, 'updated-label')).bottom - 0.5);
      expect(when.right).toBeLessThanOrEqual((await box(page, 'drawer')).right + 0.5);
    });

    test(`an activity entry's time stays on one line at ${width}px`, async ({ page }) => {
      await mount(page, feedFixture(), width);
      expect(await linesOf(page, 'feed-when'), 'the entry time broke across lines').toBe(1);
      const when = await box(page, 'feed-when');
      const actor = await box(page, 'actor');
      // The header ran out of line, so the time moved to a line of its own.
      expect(when.top).toBeGreaterThanOrEqual(actor.bottom - 0.5);
      expect(when.right).toBeLessThanOrEqual((await box(page, 'drawer')).right + 0.5);
    });
  }

  test('CONTROL — at 900px the meta line and the entry header each stay one line', async ({ page }) => {
    await mount(page, metaFixture(), 900);
    // One line: the second entry's time starts above the first entry's time ends.
    expect((await box(page, 'updated')).top).toBeLessThan((await box(page, 'created')).bottom);
    expect(await linesOf(page, 'updated')).toBe(1);
    await mount(page, feedFixture(), 900);
    // One row: the time sits beside the actor (it starts above the actor's bottom).
    expect((await box(page, 'feed-when')).top).toBeLessThan((await box(page, 'actor')).bottom);
  });

  test('a short badge shows whole and a long one ends in an ellipsis with its title, at 380px', async ({ page }) => {
    await mount(page, badgeFixture(), 380);
    const read = (id: string) =>
      page.evaluate((elId) => {
        const badge = document.getElementById(elId)!;
        const inner = badge.querySelector('span')!;
        const cell = badge.closest('[class*="flex-col"]')!.getBoundingClientRect();
        const r = badge.getBoundingClientRect();
        return {
          clipped: inner.scrollWidth > inner.clientWidth,
          ellipsis: getComputedStyle(inner).textOverflow,
          title: badge.getAttribute('title'),
          width: r.width,
          withinCell: r.right <= cell.right + 0.5,
        };
      }, id);
    const short = await read('short');
    expect(short.clipped, '「方案报价」 was cut').toBe(false);
    expect(short.withinCell).toBe(true);
    const long = await read('long');
    expect(long.clipped).toBe(true);
    expect(long.ellipsis).toBe('ellipsis');
    expect(long.title).toBe('Customer referral via partner channel program');
    expect(long.withinCell, 'the long badge runs past its cell, cut with no ellipsis').toBe(true);
    // Never a letter: the ellipsised badge keeps most of its cell.
    expect(long.width).toBeGreaterThan(80);
  });
});
