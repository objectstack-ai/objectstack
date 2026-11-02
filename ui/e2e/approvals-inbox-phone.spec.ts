import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for the Approvals flow at phone width (objectstack#29070): the
 * approvals inbox's phone face, its inline Reject confirmation, and the record
 * approval panel's Send reminder, at 375×812 and 390×844.
 *
 * The run record on the card drove the real flow in Chromium against the
 * showcase and CRM examples. It measured no horizontal page scroll and every
 * dialog inside the viewport, and it measured the inbox's own controls under
 * the 44 px touch floor: tabs, search and filters at 32 px, the phone cards'
 * Approve / Reject at 28 px, the confirmation's buttons at 40 px, and Send
 * reminder at 24 px. The fix gives each of them the 44 px height below 768 px
 * (`useIsMobile`): Button's `lg` size, `h-11` where the control has no size.
 * This file holds those three measurable checks: no horizontal scroll, 44 px
 * targets on the flow's controls, the confirmation inside the viewport.
 *
 * ⚠️ A Playwright spec and not a vitest test for the reason
 * `record-path-phone-row.spec.ts` gives: jsdom has no layout engine, so a
 * height or width read there is 0 and an assertion on it is vacuous.
 *
 * REAL, read out of the source files at run time: the phone arm of every
 * size the fix chose (`controlHeight`, `tabTouch`, the search field's arm,
 * the `lg` buttons, `footerButton`, Send reminder's arm), the class strings of
 * the page, toolbar, card and dialog containers, and the base classes of the
 * `@object-ui/components` primitives they render through (Button's `cva`,
 * Input, SelectTrigger, Tabs, Card, Textarea, AlertDialog), merged the way
 * `cn` merges them (the components package's own `tailwind-merge`), plus real
 * Tailwind compiled from the installed `tailwindcss` for exactly those
 * candidates. FIXTURE: the labels, and the element tree, transcribed from
 * `ApprovalsInboxPage.tsx` and `RecordApprovalsPanel.tsx`.
 *
 * Not vacuous: the same tree built from the DESKTOP arm of each ternary has
 * controls under 44 px, so a floor that measured nothing would fail there.
 */

const REPO_ROOT = uiRoot();
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const PAGE_FILE = 'apps/console/src/pages/system/ApprovalsInboxPage.tsx';
const PANEL_FILE = 'packages/app-shell/src/views/RecordApprovalsPanel.tsx';
const UI = 'packages/components/src/ui';
const SRC: Record<string, string> = {
  [PAGE_FILE]: read(PAGE_FILE),
  [PANEL_FILE]: read(PANEL_FILE),
};
for (const f of ['button', 'input', 'select', 'tabs', 'card', 'textarea', 'alert-dialog']) {
  SRC[`${UI}/${f}.tsx`] = read(`${UI}/${f}.tsx`);
}

/** One capture out of a source file; a capture missing a token throws, so a drifted match cannot pass. */
function grab(file: string, re: RegExp, mustContain: string[] = []): string {
  const m = SRC[file].match(re);
  if (!m) throw new Error(`${file}: nothing matched ${re}`);
  const cls = m[1];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(`${file}: ${re} matched "${cls}", which does not carry "${token}" — the extraction walked onto the wrong string.`);
    }
  }
  return cls;
}

// `cn` is `twMerge(clsx(...))`; resolve the components package's own copy.
const requireFromComponents = createRequire(path.join(REPO_ROOT, 'packages/components/package.json'));
const { twMerge } = requireFromComponents('tailwind-merge') as { twMerge: (...c: string[]) => string };
const cn = (...parts: Array<string | false | undefined>) => twMerge(parts.filter(Boolean).join(' '));

const BTN = `${UI}/button.tsx`;
const button = {
  base: grab(BTN, /cva\(\s*"([^"]+)"/, ['inline-flex']),
  default: grab(BTN, /variant: \{\s*default: "([^"]+)"/, ['bg-primary']),
  outline: grab(BTN, /outline:\s*"([^"]+)"/, ['border']),
  sizeDefault: grab(BTN, /size: \{\s*default: "([^"]+)"/, ['h-10']),
  sm: grab(BTN, /\bsm: "([^"]+)"/, ['h-9']),
  lg: grab(BTN, /\blg: "([^"]+)"/, ['h-11']),
};
const sizeOf = (s: string) => (s === 'lg' ? button.lg : s === 'sm' ? button.sm : button.sizeDefault);

const BASE = {
  input: grab(`${UI}/input.tsx`, /"(flex h-10 w-full rounded-md border border-input[^"]+)"/, ['h-10']),
  selectTrigger: grab(`${UI}/select.tsx`, /"(flex h-10 w-full items-center justify-between[^"]+)"/, ['h-10']),
  tabsList: grab(`${UI}/tabs.tsx`, /"(inline-flex h-10 items-center justify-center rounded-md bg-muted[^"]+)"/, ['h-10']),
  tabsTrigger: grab(`${UI}/tabs.tsx`, /"(inline-flex items-center justify-center whitespace-nowrap rounded-sm[^"]+)"/, ['px-3']),
  card: grab(`${UI}/card.tsx`, /"(rounded-lg border bg-card[^"]+)"/, ['border']),
  textarea: grab(`${UI}/textarea.tsx`, /"(flex min-h-\[80px\] w-full[^"]+)"/, ['text-base']),
  dialogContent: grab(`${UI}/alert-dialog.tsx`, /"(fixed left-\[50%\] top-\[50%\][^"]+)"/, ['max-w-lg']),
  dialogHeader: grab(`${UI}/alert-dialog.tsx`, /"(flex flex-col space-y-2 text-center[^"]+)"/, ['flex-col']),
  dialogFooter: grab(`${UI}/alert-dialog.tsx`, /"(flex flex-col-reverse[^"]+)"/, ['flex-col-reverse']),
  dialogCancelExtra: grab(`${UI}/alert-dialog.tsx`, /variant: "outline" \}\),\s*"([^"]+)"/, ['mt-2']),
};

/** The two arms of each size the page and panel choose with `isMobile`. */
type Arm = 'phone' | 'desktop';
const ARMS = {
  controlHeight: grab(PAGE_FILE, /const controlHeight = isMobile \? '([^']+)' : '[^']+'/, ['h-11']),
  controlHeightDesktop: grab(PAGE_FILE, /const controlHeight = isMobile \? '[^']+' : '([^']+)'/, ['h-8']),
  tabTouch: grab(PAGE_FILE, /const tabTouch = cn\(isMobile && '([^']+)'\)/, ['min-h-11']),
  tabsList: grab(PAGE_FILE, /<TabsList className=\{cn\(isMobile && '([^']+)'\)\}/, ['h-auto']),
  search: grab(PAGE_FILE, /cn\('pl-8', isMobile \? '([^']+)' : '[^']+'\)/, ['h-11']),
  searchDesktop: grab(PAGE_FILE, /cn\('pl-8', isMobile \? '[^']+' : '([^']+)'\)/, ['h-8']),
  footerSize: grab(PAGE_FILE, /const footerButton = isMobile \? buttonVariants\(\{ variant: null, size: '([^']+)' \}\)/, []),
  reminderSize: grab(PANEL_FILE, /size=\{isMobile \? '([^']+)' : '[^']+'\}/, []),
  reminderSizeDesktop: grab(PANEL_FILE, /size=\{isMobile \? '[^']+' : '([^']+)'\}/, []),
  reminder: grab(PANEL_FILE, /className=\{isMobile \? '([^']+)' : '[^']+'\}/, ['px-4']),
  reminderDesktop: grab(PANEL_FILE, /className=\{isMobile \? '[^']+' : '([^']+)'\}/, ['h-6']),
};

const PAGE = {
  body: grab(PAGE_FILE, /<div className="(flex flex-col gap-4 sm:gap-6 p-4[^"]+)">/, ['p-4']),
  toolbar: grab(PAGE_FILE, /Toolbar: search \+ filters \*\/\}[\s\S]*?<div className="([^"]+)">/, ['flex-wrap']),
  searchBox: grab(PAGE_FILE, /<div className="(relative flex-1 min-w-\[200px\][^"]+)">/, ['relative']),
  selectExtra: grab(PAGE_FILE, /<SelectTrigger className=\{cn\(controlHeight, '([^']+)'\)\}/, ['w-auto']),
  cardList: grab(PAGE_FILE, /\{\/\* Mobile cards \*\/\}\s*<div className="([^"]+)">/, ['md:hidden']),
  card: grab(PAGE_FILE, /<Card key=\{r\.id\} className="([^"]+)"/, ['cursor-pointer']),
  cardContent: grab(PAGE_FILE, /<Card key=\{r\.id\}[^\n]*\n\s*<CardContent className="([^"]+)"/, ['p-3']),
  cardButtons: grab(PAGE_FILE, /className="(flex gap-2 pt-1)"/, ['pt-1']),
  approveSize: grab(PAGE_FILE, /<Button size="([^"]+)" className="flex-1 px-3" disabled=\{inlineActing === r\.id/, []),
  approveCls: grab(PAGE_FILE, /<Button size="lg" className="([^"]+)" disabled=\{inlineActing === r\.id/, ['flex-1']),
  rejectSize: grab(PAGE_FILE, /size="([^"]+)" variant="outline" className="flex-1 px-3 border-destructive/, []),
  rejectCls: grab(PAGE_FILE, /size="lg" variant="outline" className="([^"]+)"/, ['border-destructive']),
};

function btn(variant: 'default' | 'outline', size: string, extra = '') {
  return cn(button.base, button[variant], sizeOf(size), extra);
}

function fixture(arm: Arm): string {
  const phone = arm === 'phone';
  const control = phone ? ARMS.controlHeight : ARMS.controlHeightDesktop;
  const tab = (label: string) =>
    `<button data-control="tab ${label}" class="${cn(BASE.tabsTrigger, phone && ARMS.tabTouch)}">${label}</button>`;
  const select = (label: string) =>
    `<button data-control="filter ${label}" class="${cn(BASE.selectTrigger, control, PAGE.selectExtra)}"><span>${label}</span><span style="width:16px;height:16px;display:inline-block"></span></button>`;
  const card = (title: string, record: string) =>
    `<div class="${cn(BASE.card, PAGE.card)}"><div class="${PAGE.cardContent}">` +
    `<div class="flex items-start justify-between gap-2"><div class="font-medium text-sm truncate">${title}</div><span class="text-xs">Pending</span></div>` +
    `<div class="text-sm truncate">${record}</div>` +
    `<div class="${PAGE.cardButtons}">` +
    // the phone cards exist only below `md`; their size has one arm
    `<button data-control="card approve" class="${btn('default', PAGE.approveSize, PAGE.approveCls)}">Approve</button>` +
    `<button data-control="card reject" class="${btn('outline', PAGE.rejectSize, PAGE.rejectCls)}">Reject</button>` +
    `</div></div></div>`;
  const footer = phone ? cn(button.base, button.lg) : undefined;
  const reminder = phone
    ? btn('outline', ARMS.reminderSize, ARMS.reminder)
    : btn('outline', ARMS.reminderSizeDesktop, ARMS.reminderDesktop);
  return (
    `<div id="page" class="${PAGE.body}">` +
    `<div role="tablist" class="${cn(BASE.tabsList, phone && ARMS.tabsList)}">` +
    tab('My Pending 3') + tab('Submitted by me') + tab('All') + `</div>` +
    `<div class="${PAGE.toolbar}"><div class="${PAGE.searchBox}">` +
    `<input data-control="search" placeholder="Search record, process, requester…" class="${cn(BASE.input, phone ? ARMS.search : ARMS.searchDesktop)}" /></div>` +
    select('All processes') + select('All objects') + select('Newest first') + `</div>` +
    `<div class="${PAGE.cardList}">` +
    card('High-Value Expense — Committee Quorum', 'EXP-DEMO Expense Report · 8,900') +
    card('Invoice Dual Sign-off (parallel approval)', 'INV-1008 Invoice') +
    `</div>` +
    `<div class="rounded-lg border bg-card px-4 py-3"><div class="flex flex-wrap gap-1">` +
    `<span class="text-[11px]">finance 0/1</span><span class="text-[11px]">legal 0/1</span>` +
    `<button data-control="send reminder" class="${reminder}">Send reminder</button></div></div>` +
    `</div>` +
    `<div id="dialog" role="alertdialog" class="${BASE.dialogContent}" data-state="open">` +
    `<div class="${BASE.dialogHeader}"><h2 class="text-lg font-semibold">Reject "INV-1008"?</h2>` +
    `<p class="text-sm text-muted-foreground">This rejects the request and notifies the submitter.</p></div>` +
    `<div class="space-y-1.5"><label class="text-sm font-medium">Comment (optional)</label><textarea rows="3" class="${BASE.textarea}"></textarea></div>` +
    `<div class="${BASE.dialogFooter}">` +
    `<button data-control="dialog cancel" class="${cn(button.base, button.outline, button.sizeDefault, BASE.dialogCancelExtra, footer)}">Cancel</button>` +
    `<button data-control="dialog reject" class="${cn(button.base, button.default, button.sizeDefault, footer, 'bg-destructive')}">Reject</button>` +
    `</div></div>`
  );
}

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
  const candidates = [fixture('phone'), fixture('desktop')].join(' ').match(/class="([^"]+)"/g) ?? [];
  css = compiler.build(candidates.flatMap((c) => c.slice(7, -1).split(/\s+/)).filter(Boolean));
  if (!css.includes('@media')) throw new Error('Tailwind produced no media queries — `md:hidden` would be inert.');
});

type Reading = {
  docScrollWidth: number;
  controls: { name: string; w: number; h: number }[];
  dialog: { left: number; top: number; right: number; bottom: number; innerScroll: boolean };
};

async function measure(page: Page, arm: Arm, width: number, height: number): Promise<Reading> {
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>html,body{margin:0}${css}</style>${fixture(arm)}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const d = document.getElementById('dialog')!;
    const r = d.getBoundingClientRect();
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      controls: Array.from(document.querySelectorAll<HTMLElement>('[data-control]')).map((el) => {
        const b = el.getBoundingClientRect();
        return { name: el.dataset.control ?? '', w: round(b.width), h: round(b.height) };
      }),
      dialog: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, innerScroll: d.scrollWidth > d.clientWidth + 1 },
    };
  });
}

test.describe('Approvals flow at phone width (objectstack#29070)', () => {
  for (const [width, height] of [[375, 812], [390, 844]] as const) {
    test(`no horizontal scroll, 44 px targets and the confirmation inside the viewport at ${width}×${height}`, async ({ page }) => {
      const r = await measure(page, 'phone', width, height);
      expect(r.docScrollWidth, `the page is ${r.docScrollWidth}px wide in a ${width}px viewport`).toBeLessThanOrEqual(width);
      expect(r.controls.length, 'no control was measured').toBeGreaterThanOrEqual(12);
      for (const c of r.controls) {
        expect(c.h, `"${c.name}" is ${c.h}px tall`).toBeGreaterThanOrEqual(44);
        expect(c.w, `"${c.name}" is ${c.w}px wide`).toBeGreaterThanOrEqual(44);
      }
      expect(r.dialog.left).toBeGreaterThanOrEqual(0);
      expect(r.dialog.top).toBeGreaterThanOrEqual(0);
      expect(r.dialog.right).toBeLessThanOrEqual(width + 0.5);
      expect(r.dialog.bottom).toBeLessThanOrEqual(height + 0.5);
      expect(r.dialog.innerScroll, 'the confirmation scrolls sideways').toBe(false);
    });
  }

  test('not vacuous: the desktop arm of the same tree has controls under 44 px', async ({ page }) => {
    const r = await measure(page, 'desktop', 375, 812);
    const small = r.controls.filter((c) => c.h < 44).map((c) => c.name);
    for (const name of ['search', 'filter All processes', 'dialog reject', 'send reminder']) {
      expect(small, `"${name}" measured 44 px on the desktop arm, so the phone floor measures nothing`).toContain(name);
    }
  });
});
