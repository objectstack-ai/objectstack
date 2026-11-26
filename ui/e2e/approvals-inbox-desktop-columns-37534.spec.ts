import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for the approvals inbox's desktop table at common desktop
 * widths (objectstack#37534): at a content width of 928 px and of 1102 px the
 * record name is readable in full, and the right-pinned Approve / Reject
 * column covers no other column.
 *
 * ## The defect
 *
 * The table pins its Approve / Reject column to the scroll box's right edge.
 * Its text columns (Request, Requester) kept their whole label on one line,
 * so their unbreakable width, the fixed Status / Submitted widths and the
 * pinned buttons together were wider than a 928 px or 1102 px card. The
 * table overflowed its box; at rest the pinned column then sat over the
 * Submitted column, and the only column allowed to give, Record, was cut to
 * about 110 px ("Polar Cargo – R…").
 *
 * The text columns now wrap instead of holding the table open (Request,
 * Record and Requester give their width back and break onto a second line),
 * so the table fits its card from 928 px up and the pin covers nothing at
 * rest. Below that the table still scrolls sideways under the pin, the
 * console's list behaviour (objectui#12708 / #12816). A record name too long
 * even for two lines is clamped, and the full text stays in its `title`.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * The reason `approvals-inbox-phone.spec.ts` gives: jsdom has no layout
 * engine, so a width, an overlap or a cut read there is 0 and vacuous.
 *
 * ## What is real here and what is a fixture
 *
 * REAL, read out of the source files at run time: every class string on the
 * table's path — the column heads, the cells, the Request / Record /
 * Requester / Submitted cell bodies, the pinned-column classes, the inline
 * buttons — from `ApprovalsInboxPage.tsx`; the base classes of the
 * `@object-ui/components` primitives they render through (Table, TableHead,
 * TableCell, TableRow, Button's `cva`, Badge, the overflow box and its pinned
 * seam), merged the way `cn` merges them; and real Tailwind compiled from the
 * installed `tailwindcss` for exactly those candidates.
 *
 * FIXTURE: the element tree, transcribed from the page's desktop face; the
 * rows (names of the length the card measured, in English and zh-CN); and
 * the width, set by a frame around the card, not by the console shell — 928
 * and 1102 px are the content widths the card measured. Fonts are Chromium's
 * fallbacks: the assertions are overlap, overflow and cut, not pixels.
 *
 * Not vacuous: at a 700 px frame the same table is wider than its box, and
 * the overlap and overflow readings report it.
 */

const REPO_ROOT = uiRoot();
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const PAGE_FILE = 'apps/console/src/pages/system/ApprovalsInboxPage.tsx';
const UI = 'packages/components/src/ui';
const OVERFLOW_HOOK = 'packages/components/src/custom/use-horizontal-overflow.ts';
const OVERFLOW_BOX = 'packages/components/src/custom/horizontal-overflow.tsx';
const SRC: Record<string, string> = {
  [PAGE_FILE]: read(PAGE_FILE),
  [OVERFLOW_HOOK]: read(OVERFLOW_HOOK),
  [OVERFLOW_BOX]: read(OVERFLOW_BOX),
};
for (const f of ['button', 'table', 'badge', 'card']) SRC[`${UI}/${f}.tsx`] = read(`${UI}/${f}.tsx`);

/** One capture out of a source file; a capture missing a token throws, so a drifted match cannot pass. */
function grab(file: string, re: RegExp, mustContain: string[] = []): string {
  const m = SRC[file].match(re);
  if (!m) throw new Error(`${file}: nothing matched ${re}`);
  const cls = m[1] ?? '';
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(`${file}: ${re} matched "${cls}", which does not carry "${token}" — the extraction walked onto the wrong string.`);
    }
  }
  return cls;
}

const requireFromComponents = createRequire(path.join(REPO_ROOT, 'packages/components/package.json'));
const { twMerge } = requireFromComponents('tailwind-merge') as { twMerge: (...c: string[]) => string };
const cn = (...parts: Array<string | false | undefined>) => twMerge(parts.filter(Boolean).join(' '));

const BASE = {
  tableBox: grab(`${UI}/table.tsx`, /<div className=\{cn\("([^"]+)", containerClassName\)\}/, ['overflow-auto']),
  table: grab(`${UI}/table.tsx`, /<table[\s\S]*?className=\{cn\("([^"]+)"/, ['w-full']),
  row: grab(`${UI}/table.tsx`, /<tr[\s\S]*?"(border-b[^"]+)"/, ['border-b']),
  head: grab(`${UI}/table.tsx`, /<th[\s\S]*?"(h-12 px-4[^"]+)"/, ['px-4']),
  cell: grab(`${UI}/table.tsx`, /<td[\s\S]*?className=\{cn\("([^"]+)"/, ['p-4']),
  card: grab(`${UI}/card.tsx`, /"(rounded-lg border bg-card[^"]+)"/, ['border']),
  button: grab(`${UI}/button.tsx`, /cva\(\s*"([^"]+)"/, ['inline-flex']),
  buttonGhost: grab(`${UI}/button.tsx`, /ghost: "([^"]+)"/, []),
  buttonSm: grab(`${UI}/button.tsx`, /\bsm: "([^"]+)"/, ['h-9']),
  badge: grab(`${UI}/badge.tsx`, /cva\([\s\S]*?\n\s*"(inline-flex[^"]+)"/, ['inline-flex']),
  boxOuter: grab(OVERFLOW_BOX, /<div className=\{cn\('([^']+)', outerClassName\)\}>/, ['relative']),
  boxInner: grab(OVERFLOW_BOX, /className=\{cn\('([^']+)', HOVER_SCROLLBAR_CLASSES/, ['overflow-x-auto']),
  seam: grab(OVERFLOW_HOOK, /PINNED_RIGHT_SEAM_SHADOW_CLASSES =\s*'([^']+)'/, ['before:absolute']),
};

const P = PAGE_FILE;
const PAGE = {
  pinned: grab(P, /const PINNED_ACTIONS_CLASSES = `([^`$]+)\$\{PINNED_RIGHT_SEAM_SHADOW_CLASSES\}`/, ['sticky']),
  boxOuter: grab(P, /<HorizontalOverflowBox seam="pinned" outerClassName="([^"]+)"/, ['overflow-hidden']),
  tableContainer: grab(P, /<Table containerClassName="([^"]+)">/, []),
  headCheckbox: grab(P, /\{tab === 'pending' && \(\s*<TableHead className="([^"]+)">/, ['w-10']),
  headRequest: grab(P, /<TableHead className="([^"]+)">\{tr\('colRequest'/, []),
  headRecord: grab(P, /<TableHead className="([^"]+)">\{tr\('colRecord'/, []),
  headRequester: grab(P, /<TableHead className="([^"]+)">\{tr\('colRequester'/, []),
  headStatus: grab(P, /<TableHead className="([^"]+)">\{tr\('colStatus'/, []),
  headSubmitted: grab(P, /<TableHead className="([^"]+)">\{tr\('colWaiting'/, []),
  headActions: grab(P, /<TableHead className=\{cn\('([^']+)', PINNED_ACTIONS_CLASSES/, ['w-px']),
  cellRequest: grab(P, /<TableCell(?: className="([^"]+)")?><RequestCell /, []),
  cellRecord: grab(P, /<TableCell(?: className="([^"]+)")?>\s*<RecordCell/, []),
  cellRequester: grab(P, /<TableCell(?: className="([^"]+)")?>\s*\{isSystemSubmitter\(r\)/, []),
  cellSubmitted: grab(P, /className=\{cn\('([^']+)', agingClass\(r, now\)\)\}/, ['text-xs']),
  cellActions: grab(P, /<TableCell\s+className=\{cn\(\s*'([^']+)',\s*PINNED_ACTIONS_CLASSES/, ['w-px']),
  requestWrap: grab(P, /function RequestCell[\s\S]*?<div className="([^"]+)">/, []),
  requestLabel: grab(P, /function RequestCell[\s\S]*?<div className="[^"]+">\s*<div className="([^"]+)">\{processLabel\(r\)\}/, ['font-medium']),
  requestStep: grab(P, /function RequestCell[\s\S]*?\{processLabel\(r\)\}<\/div>\s*<div className="([^"]+)">/, ['text-xs']),
  recordWrap: grab(P, /const title = r\.record_title[\s\S]*?return \(\s*<div className="([^"]+)">/, []),
  recordLink: grab(P, /onClick=\{\(e\) => e\.stopPropagation\(\)\}\s*className="([^"]+)"\s*title=\{title\}/, ['text-sm']),
  recordTitle: grab(P, /title=\{title\}\s*>\s*<span className="([^"]+)">\{title\}<\/span>/, []),
  recordMeta: grab(P, /<\/Link>\s*\)\}\s*<div className="([^"]+)">\s*\{objectDisplay\(r\)\}/, ['text-xs']),
  requester: grab(P, /<UserIcon[^\n]*\n\s*<span className="([^"]+)" title=\{r\.submitter_id/, []),
  requesterRow: grab(P, /\) : \(\s*<div className="([^"]+)">\s*<UserIcon/, ['flex']),
  actionsWrap: grab(P, /function InlineActions[\s\S]*?<div\s+className="([^"]+)"/, ['flex']),
  approve: grab(P, /variant="ghost"\s+className="([^"]+)"\s+disabled=\{busy \|\| needsInputs\}\s+onClick=\{\(\) => onApprove/, ['h-7']),
  reject: grab(P, /variant="ghost"\s+className="([^"]+)"\s+disabled=\{busy \|\| needsInputs\}\s+onClick=\{\(\) => onReject/, ['h-7']),
};

type Row = { process: string; step: string; record: string; meta: string; requester: string; status: string; ago: string; sla: string };
type Labels = { request: string; record: string; requester: string; status: string; submitted: string; approve: string; reject: string };

/** Names of the length the card measured ("Polar Cargo – R…", 171 px of text in a 112 px cell). */
const EN: { labels: Labels; rows: Row[] } = {
  labels: { request: 'Request', record: 'Record', requester: 'Requester', status: 'Status', submitted: 'Submitted', approve: 'Approve', reject: 'Reject' },
  rows: [
    { process: 'Opportunity Discount Approval', step: 'Sales manager review', record: 'Polar Cargo – Renewal 2027', meta: 'Opportunity · $128,400', requester: 'Morgan Whitfield', status: 'Pending', ago: '3 days ago', sla: 'Due in 2 days' },
    { process: 'Expense Report Sign-off', step: 'Finance', record: 'EXP-2026-0042 Offsite travel', meta: 'Expense Report · $8,900', requester: 'Sam Submitter', status: 'Pending', ago: '5 hours ago', sla: '' },
  ],
};
const ZH: { labels: Labels; rows: Row[] } = {
  labels: { request: '审批事项', record: '记录', requester: '提交人', status: '状态', submitted: '提交时间', approve: '通过', reject: '拒绝' },
  rows: [
    { process: '商机折扣审批', step: '销售经理审核', record: 'Polar Cargo – Renewal 2027', meta: '商机 · ¥128,400', requester: '王小明', status: '待审批', ago: '3 天前', sla: '2 天后到期' },
    { process: '费用报销审批', step: '财务', record: '华东区 2026 年度渠道返利结算', meta: '费用报销 · ¥8,900', requester: '李华', status: '待审批', ago: '5 小时前', sla: '' },
  ],
};

const svg = (cls: string) => `<span class="${cls}" style="display:inline-block;width:14px;height:14px"></span>`;

function fixture({ labels, rows }: { labels: Labels; rows: Row[] }, frame: number): string {
  const th = (cls: string, text: string, extra = '') => `<th class="${cn(BASE.head, cls)}"${extra}>${text}</th>`;
  const td = (cls: string, body: string, col: string) => `<td data-col="${col}" class="${cn(BASE.cell, cls)}">${body}</td>`;
  const pinnedHead = cn(BASE.head, PAGE.headActions, PAGE.pinned, BASE.seam, 'after:bg-muted/50');
  const pinnedCell = cn(BASE.cell, PAGE.cellActions, PAGE.pinned, BASE.seam, 'after:bg-accent/50');
  const btn = (extra: string, label: string) =>
    `<button class="${cn(BASE.button, BASE.buttonGhost, BASE.buttonSm, extra)}">${svg('h-4 w-4')}${label}</button>`;
  const body = rows.map((r) =>
    `<tr class="${cn(BASE.row, 'group cursor-pointer hover:bg-accent/50')}">` +
    td('w-10', '<input type="checkbox" style="width:16px;height:16px;margin:0" />', 'checkbox') +
    td(PAGE.cellRequest, `<div class="${PAGE.requestWrap}"><div class="${PAGE.requestLabel}">${r.process}</div><div class="${PAGE.requestStep}">${r.step}</div></div>`, 'request') +
    td(PAGE.cellRecord,
      `<div class="${PAGE.recordWrap}"><a data-record-title href="#" class="${PAGE.recordLink}" title="${r.record}"><span data-record-text class="${PAGE.recordTitle}">${r.record}</span>${svg('h-3 w-3 shrink-0')}</a>` +
      `<div class="${PAGE.recordMeta}">${r.meta}</div></div>`, 'record') +
    td(PAGE.cellRequester, `<div class="${PAGE.requesterRow}">${svg('h-3.5 w-3.5 shrink-0')}<span class="${PAGE.requester}">${r.requester}</span></div>`, 'requester') +
    td('', `<span class="${cn(BASE.badge, 'font-medium')}">${r.status}</span>`, 'status') +
    td(PAGE.cellSubmitted, `${svg('h-3 w-3 inline mr-1')}${r.ago}${r.sla ? `<div class="mt-0.5 text-xs font-medium">${r.sla}</div>` : ''}`, 'submitted') +
    `<td data-col="actions" class="${pinnedCell}"><div class="${PAGE.actionsWrap}">${btn(PAGE.approve, labels.approve)}${btn(PAGE.reject, labels.reject)}</div></td>` +
    `</tr>`,
  ).join('');
  return (
    `<div id="frame" style="width:${frame}px">` +
    `<div class="${cn(BASE.card, 'hidden md:block')}"><div class="p-0">` +
    `<div class="${cn(BASE.boxOuter, PAGE.boxOuter)}"><div id="scroller" class="${BASE.boxInner}">` +
    `<div class="${cn(BASE.tableBox, PAGE.tableContainer)}"><table class="${BASE.table}">` +
    `<thead class="[&_tr]:border-b"><tr class="${BASE.row}">` +
    th(PAGE.headCheckbox, '<input type="checkbox" style="width:16px;height:16px;margin:0" />') +
    th(PAGE.headRequest, labels.request) +
    th(PAGE.headRecord, labels.record) +
    th(PAGE.headRequester, labels.requester) +
    th(PAGE.headStatus, labels.status) +
    th(PAGE.headSubmitted, labels.submitted, ' data-col="submitted"') +
    `<th data-col="actions" class="${pinnedHead}"></th>` +
    `</tr></thead><tbody>${body}</tbody></table></div></div></div></div></div></div>`
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
  const candidates = [fixture(EN, 1000), fixture(ZH, 1000)].join(' ').match(/class="([^"]+)"/g) ?? [];
  css = compiler.build(candidates.flatMap((c) => c.slice(7, -1).split(/\s+/)).filter(Boolean));
  if (!css.includes('position: sticky')) throw new Error('Tailwind produced no `sticky` rule — the pinned column would be inert.');
});

type Reading = {
  scroller: { client: number; scroll: number };
  /** Right edge of each row's (and the head's) Submitted cell against the left edge of its pinned cell. */
  overlaps: { submittedRight: number; pinnedLeft: number }[];
  records: { text: string; cut: boolean; title: string | null; lines: number }[];
};

async function measure(page: Page, locale: typeof EN, frame: number): Promise<Reading> {
  await page.setViewportSize({ width: frame + 200, height: 900 });
  await page.setContent(`<style>html,body{margin:0}${css}</style>${fixture(locale, frame)}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const scroller = document.getElementById('scroller')!;
    const overlaps = Array.from(document.querySelectorAll('tr')).map((tr) => {
      const s = tr.querySelector('[data-col="submitted"]')!.getBoundingClientRect();
      const a = tr.querySelector('[data-col="actions"]')!.getBoundingClientRect();
      return { submittedRight: round(s.right), pinnedLeft: round(a.left) };
    });
    const records = Array.from(document.querySelectorAll<HTMLElement>('[data-record-text]')).map((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      return {
        text: el.textContent ?? '',
        cut: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
        title: el.closest('[title]')?.getAttribute('title') ?? null,
        lines: Math.round(el.getBoundingClientRect().height / lh),
      };
    });
    return { scroller: { client: scroller.clientWidth, scroll: scroller.scrollWidth }, overlaps, records };
  });
}

test.describe('Approvals inbox desktop table at common desktop widths (objectstack#37534)', () => {
  for (const [name, locale] of [['en', EN], ['zh-CN', ZH]] as const) {
    for (const frame of [928, 1102]) {
      test(`${name} at ${frame} px: the pinned column covers nothing and record names read in full`, async ({ page }) => {
        const r = await measure(page, locale, frame);
        test.info().annotations.push({ type: 'reading', description: JSON.stringify(r) });
        expect(r.scroller.scroll, `the table is ${r.scroller.scroll}px wide in a ${r.scroller.client}px box`).toBeLessThanOrEqual(r.scroller.client);
        expect(r.overlaps.length).toBe(locale.rows.length + 1);
        for (const o of r.overlaps) {
          expect(o.pinnedLeft, `the pinned column starts at ${o.pinnedLeft}, left of Submitted's right edge ${o.submittedRight}`).toBeGreaterThanOrEqual(o.submittedRight - 0.5);
        }
        expect(r.records.length).toBe(locale.rows.length);
        for (const rec of r.records) {
          expect(rec.cut, `"${rec.text}" is cut (${rec.lines} line(s))`).toBe(false);
          expect(rec.title, `"${rec.text}" carries no tooltip`).toBe(rec.text);
        }
      });
    }
  }

  test('a record name too long for two lines is clamped, keeps its full text as a tooltip, and widens nothing', async ({ page }) => {
    const long = 'ACC-000011 - Contoso Pharmaceuticals and Life Sciences Group Holdings';
    const r = await measure(page, { labels: EN.labels, rows: [{ ...EN.rows[0], record: long }, EN.rows[1]] }, 928);
    expect(r.scroller.scroll).toBeLessThanOrEqual(r.scroller.client);
    const rec = r.records.find((x) => x.text === long)!;
    expect(rec.cut, 'the long name is not clamped, so this case measures nothing').toBe(true);
    expect(rec.lines).toBe(2);
    expect(rec.title).toBe(long);
  });

  test('not vacuous: at 700 px the same table is wider than its box and the pin covers Submitted', async ({ page }) => {
    const r = await measure(page, EN, 700);
    expect(r.scroller.scroll).toBeGreaterThan(r.scroller.client);
    expect(r.overlaps.some((o) => o.pinnedLeft < o.submittedRight - 0.5)).toBe(true);
  });
});
