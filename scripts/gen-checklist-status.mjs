#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// gen-checklist-status — the platform's capability list AND its implementation
// status, read off the one ledger that already holds both.
//
//   node scripts/gen-checklist-status.mjs                # the status report, to stdout
//   node scripts/gen-checklist-status.mjs --out <dir>    # ALSO render the wiki pages into <dir>
//   node scripts/gen-checklist-status.mjs --self-test
//
// ## Why this is a command and not a page
//
// The maintainer's ask was 「一个可以人工阅读确认的入口」 for 「平台真的功能清单,
// 以及实现状态」. The trap it is one step away from is a SECOND document: a
// hand-maintained feature list drifts against the ledger the moment either is
// edited, and the two then disagree with no gate able to say which is wrong.
// One ledger, one id space, one status axis — and this command is the only
// thing that ever states a number. ⛔ Nothing downstream types a count; the
// wiki pages below carry numbers exactly because they are generated from here.
//
// ## Where the output goes, and why NOT into the tree
//
// A generated page committed to the repo is a third artifact to keep fresh, and
// a stale one is indistinguishable from a current one at reading time. So the
// pages are published to the repository WIKI on a schedule
// (`.github/workflows/checklist-status.yml`) — one stable URL, outside branch
// protection and the merge queue, regenerated wholesale every run. There is no
// `STATUS.md` in this tree and no gate pairing one, by maintainer ruling.
//
// ## The page set
//
// One INDEX page (`Platform-Checklist`) — a row per area, which is a row per
// definition item: area, active count, planned count, link — plus one page per
// area (`Checklist-<area>`) listing every item as `id · title · priority ·
// status · personas`, with the `planned` items in their OWN section, FIRST.
// Planned first is the whole point of the page: the reader came to find out
// what the platform does not do yet, and a gap listed after 39 active items is
// a gap nobody reads.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const AREAS_DIR = join(ROOT, 'docs/qa/platform-checklist/areas');

/** The wiki page name of the index. Referenced by README.md and the workflow. */
const INDEX_PAGE = 'Platform-Checklist';
/** One area JSON -> one wiki page, by this rule and no other. */
const areaPage = (area) => `Checklist-${area}`;

// ── reading the ledger ──────────────────────────────────────────────────────

/**
 * Every area file, in filename order, with its items.
 * @param {string} [dir]
 * @returns {{area: string, title: string, items: object[]}[]}
 */
function readAreas(dir = AREAS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return { area: doc.area ?? basename(f, '.json'), title: doc.title ?? '', items: doc.items ?? [] };
    });
}

/**
 * The status census. Every number this command or its pages print comes from
 * here — ⛔ there is no second counter and nothing downstream may add one.
 *
 * `other` is deliberately not folded into either column: a `draft` or `retired`
 * item is neither a verified capability nor a declared gap, and adding it to
 * one of the two totals would make the headline sentence quietly false.
 *
 * @param {{area: string, title: string, items: object[]}[]} areas
 */
export function census(areas) {
  const rows = areas.map(({ area, title, items }) => {
    const byStatus = (s) => items.filter((it) => it.status === s);
    return {
      area,
      title,
      active: byStatus('active'),
      planned: byStatus('planned'),
      other: items.filter((it) => it.status !== 'active' && it.status !== 'planned'),
    };
  });
  return {
    rows,
    areas: rows.length,
    active: rows.reduce((n, r) => n + r.active.length, 0),
    planned: rows.reduce((n, r) => n + r.planned.length, 0),
  };
}

/**
 * The one sentence every reader of this ledger is owed, and the ONE place it is
 * spelled. The wiki index prints this exact string, so a page and the command
 * can never report different totals.
 */
export function headline(c) {
  return `${c.active} active · ${c.planned} planned across ${c.areas} areas`;
}

// ── the terminal report ─────────────────────────────────────────────────────

/** @returns {string} */
export function renderReport(c) {
  const w = Math.max(4, ...c.rows.map((r) => r.area.length));
  const lines = [
    'Platform checklist — capabilities and implementation status',
    '',
    `  ${'area'.padEnd(w)}  active  planned`,
    `  ${'-'.repeat(w)}  ------  -------`,
  ];
  for (const r of c.rows) {
    lines.push(`  ${r.area.padEnd(w)}  ${String(r.active.length).padStart(6)}  ${String(r.planned.length).padStart(7)}`);
  }
  lines.push(`  ${'-'.repeat(w)}  ------  -------`);
  lines.push(`  ${'TOTAL'.padEnd(w)}  ${String(c.active).padStart(6)}  ${String(c.planned).padStart(7)}`);
  lines.push('');

  const withPlanned = c.rows.filter((r) => r.planned.length);
  if (withPlanned.length) {
    lines.push('planned — the definition requires these and the platform does not verify them yet:');
    lines.push('');
    for (const r of withPlanned) {
      for (const it of r.planned) {
        lines.push(`  ${it.priority ?? '--'}  ${it.id}${it.since ? `  → target ${it.since}` : ''}`);
      }
    }
    lines.push('');
  } else {
    lines.push('planned: none — every item on the ledger records a capability the platform verifies.');
    lines.push('');
  }
  lines.push(headline(c));
  return lines.join('\n');
}

// ── the wiki pages ──────────────────────────────────────────────────────────

const GENERATED_NOTE = (page) =>
  `> Generated by \`pnpm gen:checklist-status\` from \`docs/qa/platform-checklist/areas/*.json\`.`
  + ` ⛔ Do not edit this page — edits go to the area JSON and this page follows on the next run.`
  + ` This page is \`${page}\`.`;

const personasOf = (it) => (Array.isArray(it.personas) && it.personas.length ? it.personas.join(', ') : '—');
// A pipe inside a table cell ends the cell. Item titles are prose written by
// whoever found the capability, so they are escaped rather than trusted.
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');

/** One area page: every item, planned FIRST. @returns {string} */
export function renderAreaPage(row) {
  const page = areaPage(row.area);
  const lines = [`# ${row.area}`, '', GENERATED_NOTE(page), ''];
  if (row.title) lines.push(`${cell(row.title)}`, '');
  lines.push(`${row.active.length} active · ${row.planned.length} planned`, '');

  const table = (items) => {
    const out = ['| id | title | priority | status | personas |', '|---|---|---|---|---|'];
    for (const it of items) {
      out.push(`| \`${cell(it.id)}\` | ${cell(it.title)} | ${cell(it.priority)} | ${cell(it.status)} | ${cell(personasOf(it))} |`);
    }
    return out;
  };

  // ⛔ Planned first, unconditionally when non-empty. The reader of this page
  // came for what is missing; a gap below the implemented list is not found.
  if (row.planned.length) {
    lines.push(`## Planned (${row.planned.length})`, '');
    lines.push('The definition requires these capabilities and the platform does not verify them yet.');
    lines.push('They are skipped by every runner selector and reported as `planned` — never pass, fail or blocked.', '');
    lines.push(...table(row.planned), '');
  }
  lines.push(`## Active (${row.active.length})`, '');
  lines.push(...table(row.active), '');
  if (row.other.length) {
    lines.push(`## Other (${row.other.length})`, '');
    lines.push('Neither a verified capability nor a declared gap — counted in neither column above.', '');
    lines.push(...table(row.other), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** The index page: one row per area. @returns {string} */
export function renderIndexPage(c) {
  const lines = [
    '# Platform checklist — capabilities and implementation status',
    '',
    GENERATED_NOTE(INDEX_PAGE),
    '',
    'One row per area. `active` = the platform has the capability and the checklist verifies it.',
    '`planned` = the definition requires it and nothing verifies it yet.',
    '',
    '| area | active | planned | page |',
    '|---|---:|---:|---|',
  ];
  for (const r of c.rows) {
    lines.push(`| ${cell(r.area)} | ${r.active.length} | ${r.planned.length} | [${areaPage(r.area)}](${areaPage(r.area)}) |`);
  }
  lines.push(`| **total** | **${c.active}** | **${c.planned}** | ${c.areas} areas |`);
  lines.push('', headline(c), '');
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Every page this command publishes, as `name -> markdown`. One index plus one
 * page per area: the count is a PROPERTY of the ledger, never a constant.
 */
export function renderPages(c) {
  const pages = new Map([[INDEX_PAGE, renderIndexPage(c)]]);
  for (const r of c.rows) pages.set(areaPage(r.area), renderAreaPage(r));
  return pages;
}

// ── self-test ───────────────────────────────────────────────────────────────
//
// The defect class here is a SILENT NUMBER. Every page below carries counts, and
// a renderer that dropped a section, mis-summed a column or stopped reading an
// area file would publish a page that reads exactly as authoritative as a
// correct one — to a human, on a wiki, with no gate downstream (by ruling) to
// disagree with it. So the counts are driven off a fixture ledger whose answers
// are known, and the index is held against the per-area pages rather than
// against a second count of the same thing.

const BATTERY_CENSUS = 'census: the counts, the headline, and the areas they are read from';
const BATTERY_PAGES = 'pages: one index + one page per area, planned first, index equal to the pages';
const SELF_TEST_BATTERIES = Object.freeze({
  [BATTERY_CENSUS]: 12,
  [BATTERY_PAGES]: 16,
});
// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned beside the per-battery floors.
const SELF_TEST_BATTERY_FLOOR = 2;

let selfTestReachedVerdict = false;

function selfTest() {
  const failures = [];
  const ran = {};
  let open = null;
  const battery = (name) => { open = name; ran[name] = ran[name] ?? 0; };
  const t = (what, ok, note = '') => {
    ran[open ?? '(no battery open)'] = (ran[open ?? '(no battery open)'] ?? 0) + 1;
    if (!ok) failures.push(`${what}${note ? ` — ${note}` : ''}`);
  };

  const item = (id, status, over = {}) => ({ id, title: `t ${id}`, status, priority: 'P1', personas: ['admin'], ...over });
  const FIX = [
    { area: 'alpha', title: 'Alpha area', items: [item('alpha.one', 'active'), item('alpha.two', 'active'), item('alpha.gap', 'planned', { since: null })] },
    { area: 'beta', title: 'Beta area', items: [item('beta.one', 'active'), item('beta.old', 'retired')] },
    { area: 'gamma', title: 'Gamma area', items: [item('gamma.gap', 'planned', { since: 'v18' })] },
  ];

  battery(BATTERY_CENSUS);
  const c = census(FIX);
  t('N1 one row per area file', c.rows.length === 3 && c.areas === 3, `${c.rows.length}`);
  t('N2 active is counted, not assumed', c.active === 3, `${c.active}`);
  t('N3 planned is counted apart from active', c.planned === 2, `${c.planned}`);
  t('N4 a retired item is in NEITHER total — folding it in would make the headline quietly false',
    c.active === 3 && c.planned === 2 && c.rows[1].other.length === 1);
  t('N5 per-area counts sum to the totals — a total read off its own pass could not see one area stop being read',
    c.rows.reduce((n, r) => n + r.active.length, 0) === c.active && c.rows.reduce((n, r) => n + r.planned.length, 0) === c.planned);
  t('N6 the headline states all three numbers', headline(c) === '3 active · 2 planned across 3 areas', headline(c));
  t('N7 the headline MOVES with the ledger — a constant would pass N6 forever',
    headline(census([{ area: 'solo', title: '', items: [item('solo.one', 'active')] }])) === '1 active · 0 planned across 1 areas');
  t('N8 an area with only planned items still counts as an area', c.rows[2].planned.length === 1 && c.rows[2].active.length === 0);
  t('N9 an empty ledger reports zeros rather than throwing', headline(census([])) === '0 active · 0 planned across 0 areas');
  const report = renderReport(c);
  t('N10 the report ends with the headline, so the terminal and the pages cannot disagree', report.trimEnd().endsWith(headline(c)));
  t('N11 the report lists the planned ids — the counts alone do not tell a sweep where to point',
    report.includes('alpha.gap') && report.includes('gamma.gap'));
  t('N12 a ledger with no planned items says so in words rather than printing an empty heading',
    renderReport(census([{ area: 'solo', title: '', items: [item('solo.one', 'active')] }])).includes('planned: none'));

  battery(BATTERY_PAGES);
  const pages = renderPages(c);
  t('P1 one index plus one page per area', pages.size === 4, `${pages.size}`);
  t('P2 the index is named for the wiki page README links', pages.has(INDEX_PAGE));
  t('P3 every area has its own page, named by the one rule', ['alpha', 'beta', 'gamma'].every((a) => pages.has(`Checklist-${a}`)));
  t('P4 the page count is a PROPERTY of the ledger, not a constant', renderPages(census(FIX.slice(0, 1))).size === 2);
  const alpha = pages.get('Checklist-alpha');
  t('P5 an area page lists every item — id, title, priority, status and personas',
    ['alpha.one', 'alpha.two', 'alpha.gap', 'P1', 'active', 'planned', 'admin'].every((s) => alpha.includes(s)));
  t('P6 ⛔ planned comes FIRST — a gap listed after the implemented items is a gap nobody reads',
    alpha.indexOf('## Planned') > -1 && alpha.indexOf('## Planned') < alpha.indexOf('## Active'));
  t('P7 the planned section says what a planned item is', alpha.includes('does not verify them yet'));
  t('P8 and that the runner reports it as `planned`, never pass/fail/blocked', alpha.includes('never pass, fail or blocked'));
  const beta = pages.get('Checklist-beta');
  t('P9 an area with no planned items carries NO planned section — an empty heading reads as a missing one',
    !beta.includes('## Planned') && beta.includes('## Active'));
  t('P10 a retired item is still listed, under its own heading — "every item" means every item',
    beta.includes('## Other') && beta.includes('beta.old'));
  const index = pages.get(INDEX_PAGE);
  t('P11 the index carries one row per area, with its counts and a link to its page',
    ['| alpha | 2 | 1 |', '| beta | 1 | 0 |', '| gamma | 0 | 1 |'].every((r) => index.includes(r)), index);
  t('P12 ⭐ the index counts EQUAL the area pages\' own — the acceptance this page set is read for',
    c.rows.every((r) => pages.get(`Checklist-${r.area}`).includes(`${r.active.length} active · ${r.planned.length} planned`)));
  t('P13 the index totals equal the sum of its rows', index.includes(`| **total** | **3** | **2** |`));
  t('P14 the index ends with the same headline the command prints', index.includes(headline(c)));
  t('P15 every page says it is generated and where edits go — a wiki page is editable by anyone who can read it',
    [...pages.values()].every((p) => p.includes('Do not edit this page') && p.includes('area JSON')));
  t('P16 a `|` in an authored title cannot break the table it is rendered into',
    renderAreaPage(census([{ area: 'x', title: '', items: [item('x.one', 'active', { title: 'a | b' })] }]).rows[0]).includes('a \\| b'));

  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failures.push(`the roster declares ${declared.length} batteries but the floor is ${SELF_TEST_BATTERY_FLOOR} — deleting an entry silences its floor exactly as effectively as zeroing it`);
  }
  for (const name of declared) if (!(name in ran)) failures.push(`declared battery "${name}" did not run`);
  for (const name of Object.keys(ran)) if (!(name in SELF_TEST_BATTERIES)) failures.push(`battery "${name}" ran but is not declared`);
  for (const [name, floor] of Object.entries(SELF_TEST_BATTERIES)) {
    if (typeof ran[name] === 'number' && ran[name] < floor) {
      failures.push(`battery "${name}" reported ${ran[name]} assertions but its floor is ${floor} — cases stopped running; find what stopped registering (⛔ MAINTAINER-ONLY: lowering a floor is not the repair)`);
    }
  }

  if (failures.length) {
    console.error(`✗ gen-checklist-status --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  const total = Object.values(ran).reduce((n, x) => n + x, 0);
  console.log(
    `✓ gen-checklist-status --self-test: ${total} assertions — the census counts active and planned apart and leaves draft/retired out of both,`
      + ' the headline moves with the ledger rather than reading as a constant, the page set is one index plus one page per area,'
      + ' planned sections come FIRST and are absent rather than empty, and the index counts EQUAL the area pages they link to.',
  );
  selfTestReachedVerdict = true;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt === -1 ? null : args[outAt + 1];
  if (outAt !== -1 && (!out || out.startsWith('--'))) {
    console.error('gen-checklist-status: --out needs a directory');
    process.exit(2);
  }
  if (!existsSync(AREAS_DIR)) {
    console.error(`gen-checklist-status: ${AREAS_DIR} not found — this command reads the ledger and has nothing to report without it.`);
    process.exit(1);
  }

  const c = census(readAreas());
  // A refusal, not a pass: an empty ledger and a walk that stopped reading it
  // print the same "0 active · 0 planned" otherwise, and the second one would
  // be published to the wiki as the platform's capability list.
  if (c.areas === 0) {
    console.error(`gen-checklist-status: read ZERO area files from ${AREAS_DIR}.`);
    console.error('\nThis is a REFUSAL, not a pass: "the platform has no capabilities" and "this command stopped reading the ledger" render as the same page.');
    process.exit(1);
  }

  console.log(renderReport(c));

  if (out) {
    mkdirSync(out, { recursive: true });
    const pages = renderPages(c);
    for (const [name, body] of pages) writeFileSync(join(out, `${name}.md`), body);
    console.log(`\nwrote ${pages.size} page(s) to ${out}: ${INDEX_PAGE} + ${c.areas} area page(s)`);
  }
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ gen-checklist-status --self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(0);
  }
  main();
}
