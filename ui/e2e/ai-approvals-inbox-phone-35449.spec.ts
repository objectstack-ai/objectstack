import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for the AI approvals inbox at phone width (objectstack#35449).
 *
 * Measured by the cloud lane before the fix, in Chromium on the real
 * `AiPendingActionsInbox`: the table's fixed column widths made it far wider
 * than a phone, so at 360 and 390 px Approve / Reject / View sat off-screen
 * in a sideways scroller, the first column was the internal tool name, and
 * the detail drawer (the Sheet primitive's 75% width) ran its Reject button
 * past the screen's right edge. Now, below `md`, each action is a stacked
 * card that leads with the action and wraps its decision buttons inside the
 * card, and the drawer takes the full width below `sm`. This spec measures, at
 * 360 and 390 px, no horizontal page overflow, the action's name and every
 * decision button inside the viewport, and the drawer's buttons inside the
 * viewport; and at 1280 px the desktop table as before, with nothing to
 * scroll sideways.
 *
 * A Playwright spec and not a vitest test for the reason
 * `record-header-title-width.spec.ts` gives: jsdom has no layout engine, so a
 * width read there is 0 and an assertion on it is vacuous. The DOM-order half
 * (which face each breakpoint draws, the card naming the action before the
 * tool, every decision reaching its handler) is pinned beside the component in
 * `AiPendingActionsInbox.noProviderFallback.test.tsx`.
 *
 * REAL, read out of the sources at run time: every class string of the
 * inbox's toolbar row, table wrapper and header cells, phone card list, card,
 * its rows and its buttons, the drawer's content, body and button row
 * (`AiPendingActionsInbox.tsx`), and the base classes of the
 * `@object-ui/components` primitives they render through (Button's `cva`,
 * Badge, Card, Tabs, Table, Sheet's `cva` with its right side), merged the way
 * `cn` merges them (the components package's own `tailwind-merge`), plus real
 * Tailwind compiled from the installed `tailwindcss` for exactly those
 * candidates. FIXTURE: the labels (English and German, the longer one), the
 * rows, the page's 16 px gutter, and the element trees, transcribed from the
 * component.
 *
 * Not vacuous: the 390 px legs below also measure the pre-fix arms, the
 * desktop table shown at phone width and the drawer without the component's
 * width, and require them to fail the same checks.
 */

const REPO_ROOT = uiRoot();
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const INBOX_FILE = 'packages/plugin-chatbot/src/AiPendingActionsInbox.tsx';
const UI = 'packages/components/src/ui';
const SRC: Record<string, string> = { [INBOX_FILE]: read(INBOX_FILE) };
for (const f of ['button', 'badge', 'card', 'tabs', 'table', 'sheet']) SRC[`${UI}/${f}.tsx`] = read(`${UI}/${f}.tsx`);

/** The phone face's source: from the card list's marker on, so a capture cannot land in the table. */
const CARDS_MARK = 'data-testid="ai-inbox-cards"';
const cardsIdx = SRC[INBOX_FILE].indexOf(CARDS_MARK);
if (cardsIdx < 0) throw new Error(`${INBOX_FILE}: the phone card list (${CARDS_MARK}) is gone.`);
const lineStart = SRC[INBOX_FILE].lastIndexOf('\n', cardsIdx);
SRC['cards'] = SRC[INBOX_FILE].slice(lineStart);

/**
 * One capture out of a source; a capture missing a token throws, so a drifted
 * match cannot pass. The tokens are structural ones the capture always holds,
 * never a class this fix added, so an ablation of the fix reaches the
 * measurement instead of stopping here.
 */
function grab(file: string, re: RegExp, mustContain: string[] = []): string {
  const m = SRC[file].match(re);
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

// `cn` is `twMerge(clsx(...))`; resolve the components package's own copy.
const requireFromComponents = createRequire(path.join(REPO_ROOT, 'packages/components/package.json'));
const { twMerge } = requireFromComponents('tailwind-merge') as { twMerge: (...c: string[]) => string };
const cn = (...parts: Array<string | false | undefined>) => twMerge(parts.filter(Boolean).join(' '));

const BTN = `${UI}/button.tsx`;
const button = {
  base: grab(BTN, /cva\(\s*"([^"]+)"/, ['inline-flex']),
  default: grab(BTN, /variant: \{\s*default: "([^"]+)"/, ['bg-primary']),
  destructive: grab(BTN, /destructive:\s*"([^"]+)"/, ['bg-destructive']),
  outline: grab(BTN, /outline:\s*"([^"]+)"/, ['border']),
  sm: grab(BTN, /\bsm: "([^"]+)"/, ['h-9']),
  lg: grab(BTN, /\blg: "([^"]+)"/, ['h-11']),
};
type Variant = 'default' | 'destructive' | 'outline';
const btn = (variant: Variant, size: string, extra = '') =>
  cn(button.base, button[variant], size === 'lg' ? button.lg : size === 'sm' ? button.sm : '', extra);

const BASE = {
  badge: grab(`${UI}/badge.tsx`, /cva\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/, ['whitespace-nowrap']),
  card: grab(`${UI}/card.tsx`, /"(rounded-lg border bg-card[^"]+)"/, ['border']),
  cardContent: grab(`${UI}/card.tsx`, /cn\("(p-6 pt-0)", className\)/, ['p-6']),
  tabsList: grab(`${UI}/tabs.tsx`, /"(inline-flex h-10 items-center justify-center rounded-md bg-muted[^"]+)"/, ['h-10']),
  tabsTrigger: grab(`${UI}/tabs.tsx`, /"(inline-flex items-center justify-center whitespace-nowrap rounded-sm[^"]+)"/, ['px-3']),
  tableBox: grab(`${UI}/table.tsx`, /<div className=\{cn\("(relative w-full overflow-auto)"/, ['overflow-auto']),
  table: grab(`${UI}/table.tsx`, /cn\("(w-full caption-bottom text-sm)"/, ['w-full']),
  th: grab(`${UI}/table.tsx`, /"(h-12 px-4 text-left align-middle[^"]+)"/, ['px-4']),
  td: grab(`${UI}/table.tsx`, /cn\("(p-4 align-middle[^"]+)"/, ['p-4']),
  sheet: grab(`${UI}/sheet.tsx`, /const sheetVariants = cva\(\s*"([^"]+)"/, ['fixed']),
  sheetRight: grab(`${UI}/sheet.tsx`, /right:\s*"([^"]+)"/, ['w-3/4']),
  sheetHeader: grab(`${UI}/sheet.tsx`, /"(flex flex-col space-y-2 text-center sm:text-left)"/, ['flex-col']),
  sheetTitle: grab(`${UI}/sheet.tsx`, /cn\("(text-lg font-semibold text-foreground)"/, ['text-lg']),
  sheetDescription: grab(`${UI}/sheet.tsx`, /cn\("(text-sm text-muted-foreground)", className\)/, ['text-sm']),
};

const F = INBOX_FILE;
const INBOX = {
  toolbar: grab(F, /<div className="([^"]+)">\s*<Tabs value=\{tab\}/, ['justify-between']),
  tableBox: grab(F, /<div className="([^"]+)">\s*<Table>/, ['rounded-md']),
  heads: [...SRC[F].matchAll(/<TableHead className="([^"]+)">/g)].map((m) => m[1]),
  cardList: grab(F, /<div className="([^"]+)" data-testid="ai-inbox-cards">/, ['space-y-2']),
  card: grab('cards', /className="([^"]+)" data-testid=\{`ai-inbox-card-\$\{row\.id\}`\}/, ['border']),
  cardHead: grab('cards', /data-testid=\{`ai-inbox-card-\$\{row\.id\}`\}>\s*<div className="([^"]+)">/, ['flex']),
  action: grab('cards', /<div className="([^"]+)">\{row\.action_name\}<\/div>/, ['min-w-0']),
  badgeBox: grab('cards', /<div className="([^"]+)"><StatusBadge status=\{row\.status\}/, ['shrink-0']),
  meta: grab('cards', /<div className="([^"]+)">\s*<span className="[^"]+">\{row\.object_name\}/, ['flex']),
  object: grab('cards', /<span className="([^"]+)">\{row\.object_name\}/, ['min-w-0']),
  tool: grab('cards', /<span className="([^"]+)">\{row\.tool_name\}/, ['font-mono']),
  time: grab('cards', /<span className="([^"]+)">\s*<Clock className="h-3 w-3" \/>/, ['inline-flex']),
  buttons: grab('cards', /<div className="([^"]+)">\s*\{isPending \?/, ['flex']),
  approveSize: grab('cards', /<Button\s+size="([^"]+)"\s+variant="default"/),
  approve: grab('cards', /size="[^"]+"\s+variant="default"\s+className="([^"]+)"/, ['flex-1']),
  rejectSize: grab('cards', /<Button\s+size="([^"]+)"\s+variant="destructive"/),
  reject: grab('cards', /size="[^"]+"\s+variant="destructive"\s+className="([^"]+)"/, ['flex-1']),
  viewSize: grab('cards', /<Button\s+size="([^"]+)"\s+variant="outline"/),
  view: grab('cards', /size="[^"]+"\s+variant="outline"\s+className="([^"]+)"/, ['flex-1']),
  sheet: grab(F, /<SheetContent className="([^"]+)">/, ['sm:max-w-[560px]']),
  sheetTitle: grab(F, /<SheetTitle className="([^"]+)">/, ['flex']),
  sheetDescription: grab(F, /<SheetDescription className="([^"]+)">/),
  sheetBody: grab(F, /\{selected \? \(\s*<div className="([^"]+)">/, ['px-4']),
  sheetButtons: grab(F, /\{selected\.status === 'pending' \? \(\s*<div className="([^"]+)">/, ['flex']),
};
if (INBOX.heads.length !== 6) throw new Error(`${F}: expected the table's six header cells, read ${INBOX.heads.length}.`);

type Labels = {
  pending: string; decided: string; all: string; refresh: string;
  view: string; approve: string; reject: string; approveAndExecute: string;
};
const EN: Labels = {
  pending: 'Pending', decided: 'Decided', all: 'All', refresh: 'Refresh',
  view: 'View', approve: 'Approve', reject: 'Reject', approveAndExecute: 'Approve & Execute',
};
const DE: Labels = {
  pending: 'Ausstehend', decided: 'Entschieden', all: 'Alle', refresh: 'Aktualisieren',
  view: 'Ansehen', approve: 'Genehmigen', reject: 'Ablehnen', approveAndExecute: 'Genehmigen & ausführen',
};

const ROWS = [
  { id: 'a1', tool: 'action_opportunity_mark_won', action: 'mark_won', object: 'opportunity', status: 'Pending', pending: true },
  {
    id: 'a2',
    tool: 'mcp_crm_update_opportunity_stage_and_notify_owner',
    action: 'update_opportunity_stage_and_notify_owner_with_summary',
    object: 'opportunity_line_item',
    status: 'Pending',
    pending: true,
  },
  { id: 'a3', tool: 'action_invoice_send', action: 'send_invoice', object: 'invoice', status: 'Executed', pending: false },
];

const icon = '<svg class="h-3.5 w-3.5 mr-1" width="14" height="14"></svg>';

/** The inbox in its card variant, inside the page's 16 px gutter. `tableAtPhone` shows the desktop face below `md` — the pre-fix arm. */
function inbox(l: Labels, opts: { tableAtPhone?: boolean; rows?: typeof ROWS } = {}): string {
  const rows = opts.rows ?? ROWS;
  const tableBox = opts.tableAtPhone ? cn(INBOX.tableBox, 'block') : INBOX.tableBox;
  const head = (i: number, label: string) => `<th class="${cn(BASE.th, INBOX.heads[i])}">${label}</th>`;
  const tableRows = rows.map(
    (r) =>
      `<tr class="border-b">` +
      `<td class="${cn(BASE.td, 'font-mono text-xs')}">${r.tool}</td>` +
      `<td class="${cn(BASE.td, 'text-sm')}">${r.action}</td>` +
      `<td class="${cn(BASE.td, 'text-sm')}">${r.object}</td>` +
      `<td class="${BASE.td}"><span class="${BASE.badge}">${r.status}</span></td>` +
      `<td class="${cn(BASE.td, 'text-xs')}">just now</td>` +
      `<td class="${cn(BASE.td, 'text-right')}"><div class="inline-flex gap-1.5">` +
      `<button data-control="table view ${r.id}" class="${btn('outline', 'sm')}">${icon}${l.view}</button>` +
      (r.pending
        ? `<button data-control="table approve ${r.id}" class="${btn('default', 'sm')}">${icon}${l.approve}</button>` +
          `<button data-control="table reject ${r.id}" class="${btn('destructive', 'sm')}">${icon}${l.reject}</button>`
        : '') +
      `</div></td></tr>`,
  ).join('');
  const cards = rows.map(
    (r) =>
      `<div data-card="${r.id}" class="${INBOX.card}">` +
      `<div class="${INBOX.cardHead}"><div data-action="${r.id}" class="${INBOX.action}">${r.action}</div>` +
      `<div class="${INBOX.badgeBox}"><span class="${BASE.badge}">${r.status}</span></div></div>` +
      `<div class="${INBOX.meta}"><span class="${INBOX.object}">${r.object}</span><span>·</span>` +
      `<span class="${INBOX.tool}">${r.tool}</span><span>·</span>` +
      `<span class="${INBOX.time}"><svg class="h-3 w-3" width="12" height="12"></svg> just now</span></div>` +
      `<div class="${INBOX.buttons}">` +
      (r.pending
        ? `<button data-control="card approve ${r.id}" class="${btn('default', INBOX.approveSize, INBOX.approve)}">${icon}${l.approve}</button>` +
          `<button data-control="card reject ${r.id}" class="${btn('destructive', INBOX.rejectSize, INBOX.reject)}">${icon}${l.reject}</button>`
        : '') +
      `<button data-control="card view ${r.id}" class="${btn('outline', INBOX.viewSize, INBOX.view)}">${icon}${l.view}</button>` +
      `</div></div>`,
  ).join('');
  return (
    `<div id="inbox" class="${BASE.card}"><div class="${cn(BASE.cardContent, 'pt-6')}"><div class="space-y-3">` +
    `<div id="toolbar" class="${INBOX.toolbar}">` +
    `<div role="tablist" class="${BASE.tabsList}">` +
    `<button class="${BASE.tabsTrigger}">${l.pending}</button><button class="${BASE.tabsTrigger}">${l.decided}</button>` +
    `<button class="${BASE.tabsTrigger}">${l.all}</button></div>` +
    `<button data-control="refresh" class="${btn('outline', 'sm')}">${icon}${l.refresh}</button></div>` +
    `<div id="table-face" class="${tableBox}"><div id="table-box" class="${BASE.tableBox}"><table class="${BASE.table}">` +
    `<thead><tr>${head(0, 'Tool')}${head(1, 'Action')}${head(2, 'Object')}${head(3, 'Status')}${head(4, 'Proposed')}${head(5, 'Decision')}</tr></thead>` +
    `<tbody>${tableRows}</tbody></table></div></div>` +
    `<div id="card-face" class="${INBOX.cardList}">${cards}</div>` +
    `</div></div></div>`
  );
}

/**
 * The detail drawer for the long-named pending row. `preFix` drops the classes
 * this fix added (the drawer's `w-full`, the button row's `flex-wrap`) — the
 * pre-fix arm.
 */
function drawer(l: Labels, opts: { preFix?: boolean } = {}): string {
  const drop = (cls: string, token: string) => (opts.preFix ? cls.split(/\s+/).filter((c) => c !== token).join(' ') : cls);
  const r = ROWS[1];
  return (
    `<div id="sheet" role="dialog" class="${cn(BASE.sheet, BASE.sheetRight, drop(INBOX.sheet, 'w-full'))}">` +
    `<div class="${BASE.sheetHeader}">` +
    `<h2 class="${cn(BASE.sheetTitle, INBOX.sheetTitle)}"><svg class="h-4 w-4 shrink-0" width="16" height="16"></svg>${r.action}</h2>` +
    `<p class="${cn(BASE.sheetDescription, INBOX.sheetDescription)}">Tool ${r.tool} on ${r.object}</p></div>` +
    `<div class="${INBOX.sheetBody}"><div class="grid grid-cols-2 gap-3 text-sm"><div>Status</div><div>Proposed</div></div>` +
    `<div class="${drop(INBOX.sheetButtons, 'flex-wrap')}">` +
    `<button data-control="sheet approve" class="${btn('default', 'sm')}">${icon}${l.approveAndExecute}</button>` +
    `<button data-control="sheet reject" class="${btn('destructive', 'sm')}">${icon}${l.reject}</button>` +
    `</div></div></div>`
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
  const html = [inbox(EN), inbox(EN, { tableAtPhone: true }), drawer(EN), drawer(EN, { preFix: true })].join(' ');
  const candidates = html.match(/class="([^"]+)"/g) ?? [];
  css = compiler.build(candidates.flatMap((c) => c.slice(7, -1).split(/\s+/)).filter(Boolean));
  if (!css.includes('@media')) throw new Error('Tailwind produced no media queries — `md:hidden` would be inert.');
});

type Box = { left: number; right: number; top: number; bottom: number; width: number };
type Reading = {
  docScrollWidth: number;
  boxes: Record<string, Box>;
  tableBox: { clientWidth: number; scrollWidth: number };
  clipped: string[];
};

async function measure(page: Page, width: number, body: string): Promise<Reading> {
  await page.setViewportSize({ width, height: 844 });
  await page.setContent(
    `<style>html,body{margin:0}body{padding:16px;font:14px sans-serif}${css}</style>${body}`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width) };
    };
    const boxes: Record<string, Box> = {};
    document.querySelectorAll('[data-control]').forEach((el) => { boxes[el.getAttribute('data-control')!] = box(el); });
    document.querySelectorAll('[data-action]').forEach((el) => { boxes[`action ${el.getAttribute('data-action')}`] = box(el); });
    document.querySelectorAll('[data-card]').forEach((el) => { boxes[`card ${el.getAttribute('data-card')}`] = box(el); });
    for (const id of ['inbox', 'toolbar', 'table-face', 'card-face', 'sheet']) {
      const el = document.getElementById(id);
      if (el) boxes[id] = box(el);
    }
    const tb = document.getElementById('table-box');
    // Any element in the phone face that holds more than it shows sideways is a clip.
    const clipped = Array.from(document.querySelectorAll('#card-face *, #sheet *'))
      .filter((el) => (el as HTMLElement).offsetParent !== null && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.')}`);
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      boxes,
      tableBox: { clientWidth: tb?.clientWidth ?? 0, scrollWidth: tb?.scrollWidth ?? 0 },
      clipped,
    };
  });
}

const inside = (b: Box | undefined, width: number) => !!b && b.width > 0 && b.left >= -0.5 && b.right <= width + 0.5;

test.describe('AI approvals inbox at phone width (objectstack#35449)', () => {
  for (const [lang, l] of [['en', EN], ['de', DE]] as const) {
    for (const width of [360, 390]) {
      test(`${lang} ${width}px: each action is a card that names it and keeps Approve / Reject / View on screen`, async ({ page }) => {
        const r = await measure(page, width, inbox(l));
        expect(r.docScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(width);
        expect(r.boxes['table-face'].width, 'the desktop table is drawn at phone width').toBe(0);
        expect(inside(r.boxes['toolbar'], width), `toolbar ${JSON.stringify(r.boxes['toolbar'])}`).toBe(true);
        expect(inside(r.boxes['refresh'], width), `Refresh ${JSON.stringify(r.boxes['refresh'])}`).toBe(true);
        for (const row of ROWS) {
          const card = r.boxes[`card ${row.id}`];
          expect(inside(card, width), `card ${row.id} ${JSON.stringify(card)}`).toBe(true);
          const action = r.boxes[`action ${row.id}`];
          expect(inside(action, width), `the action name of ${row.id} ${JSON.stringify(action)}`).toBe(true);
          const controls = row.pending ? ['approve', 'reject', 'view'] : ['view'];
          for (const c of controls) {
            const b = r.boxes[`card ${c} ${row.id}`];
            expect(inside(b, width), `${c} on ${row.id}: ${JSON.stringify(b)} at ${width}px`).toBe(true);
            expect(b.right, `${c} on ${row.id} leaves its card`).toBeLessThanOrEqual(card.right + 0.5);
            expect(b.bottom - b.top, `${c} on ${row.id} is under the 44 px touch floor`).toBeGreaterThanOrEqual(44);
          }
        }
        expect(r.clipped, 'something in a card is cut sideways').toEqual([]);
      });

      test(`${lang} ${width}px: the detail drawer keeps both decision buttons inside the screen`, async ({ page }) => {
        const r = await measure(page, width, drawer(l));
        expect(r.docScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(width);
        expect(inside(r.boxes['sheet'], width), `sheet ${JSON.stringify(r.boxes['sheet'])}`).toBe(true);
        // Full width below `sm`, not the primitive's three quarters.
        expect(r.boxes['sheet'].width, 'the drawer is narrower than the phone').toBeGreaterThanOrEqual(width - 0.5);
        for (const c of ['sheet approve', 'sheet reject']) {
          expect(inside(r.boxes[c], width), `${c}: ${JSON.stringify(r.boxes[c])} at ${width}px`).toBe(true);
          expect(r.boxes[c].right, `${c} leaves the drawer`).toBeLessThanOrEqual(r.boxes['sheet'].right + 0.5);
        }
        expect(r.clipped, 'something in the drawer is cut sideways').toEqual([]);
      });
    }
  }

  test('not vacuous at 390px: the pre-fix arms fail the same checks', async ({ page }) => {
    const table = await measure(page, 390, inbox(EN, { tableAtPhone: true }));
    expect(table.tableBox.scrollWidth, 'the desktop table fit a phone, so the card check measured nothing')
      .toBeGreaterThan(table.tableBox.clientWidth);
    expect(inside(table.boxes['table approve a1'], 390), 'Approve in the table was on screen at 390px').toBe(false);
    const sheet = await measure(page, 390, drawer(EN, { preFix: true }));
    expect(inside(sheet.boxes['sheet reject'], 390), 'Reject in the pre-fix drawer was on screen at 390px').toBe(false);
  });

  test('1280px control: the desktop table as before, nothing to scroll sideways', async ({ page }) => {
    // The two ordinary rows: the table's fixed columns are unchanged, and a
    // name longer than its column widens it on a desktop as it did before.
    const r = await measure(page, 1280, inbox(EN, { rows: ROWS.filter((x) => x.id !== 'a2') }) + drawer(EN));
    expect(r.docScrollWidth).toBeLessThanOrEqual(1280);
    expect(r.boxes['card-face'].width, 'the phone cards are drawn on a desktop').toBe(0);
    expect(r.boxes['table-face'].width).toBeGreaterThan(0);
    expect(r.tableBox.scrollWidth, 'the desktop table scrolls sideways at 1280px').toBeLessThanOrEqual(r.tableBox.clientWidth);
    for (const c of ['view', 'approve', 'reject']) {
      expect(inside(r.boxes[`table ${c} a1`], 1280), `${c} on a1`).toBe(true);
    }
    // The drawer keeps its 560 px cap from `sm` up.
    expect(Math.round(r.boxes['sheet'].width)).toBe(560);
  });
});
