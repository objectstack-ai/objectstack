#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Quick-reference section-count guard (#6319, #6530).
 *
 * ## What it guards
 *
 * `content/docs/getting-started/quick-reference.mdx` is the protocol index: one
 * `## <Name> Protocol (N of M schemas)` section per namespace, each followed by
 * a table with one row per protocol. Both numbers in that heading are
 * DECLARATIONS, and this gate is what makes each of them true:
 *
 *   - **N** — how many protocols the table under the heading lists. Compared
 *     with the table itself.
 *   - **M** — how many reference pages the matching
 *     `content/docs/references/<category>/` directory publishes (`.mdx`, minus
 *     `index.mdx`). Compared with the real directory.
 *
 * That page is hand-written — `packages/spec/scripts/build-docs.ts` writes only
 * `content/docs/references/`, and AGENTS.md's Documentation Guardrails table
 * lists `content/docs/getting-started/` as hand-written. So the declaration and
 * the table drift apart one edit at a time: #6319 found the Kernel heading
 * claiming 17 while its table held 15, because two kernel rows had migrated
 * into the Cloud section and only Cloud's heading was updated. Nobody hit a bug
 * — the cost is that `content/docs/` is the corpus humans and AIs copy from, so
 * a miscounted index is read as a fact about the schema catalog and propagates.
 *
 * Declared = enforced: the heading now has to be true.
 *
 * ## Why the second number exists (#6530)
 *
 * The heading used to read `(N schemas)`, and that check is SELF-REFERENTIAL: N
 * is compared with the table right under it and with nothing else. #6530
 * measured what that leaves unwatched — `## Data Protocol (17 schemas)` sitting
 * over a directory that publishes 29 (now 30) schema pages, with 13 of them
 * having no row anywhere on the page. The gate was green the whole time and
 * always would have been: a curated table and its own heading agree with each
 * other no matter how far both drift from the reference tree.
 *
 * The maintainer's ruling (2026-08-08, option C) is that the table STAYS
 * curated — a beginner's fast lookup that mirrored 30 data pages would stop
 * being quick — but that the wording must carry the truth and the drift must be
 * watched. Hence `(N of M schemas)`: N is still the table, M is the real
 * directory, and `N < M` is the normal, gate-checked state.
 *
 * ## The row rule, and the three rows that point outside `references/`
 *
 * A section's category is not guessed from its title: it is DERIVED from the
 * rows, as the single `<category>` every unmarked row links into
 * (`/docs/references/<category>/<page>`). That derivation is what keeps #6319's
 * defect caught — a kernel row that migrates into the Cloud section makes that
 * section point into two categories, and the gate names both.
 *
 * Three rows legitimately document their protocol somewhere else: UI's
 * `Widget Contract` (ObjectUI's own contract page), Kernel's `Events` (the
 * hand-written kernel guide), and Shared's `Connector Auth` (a `src/shared/`
 * file that `@objectstack/spec/shared` does not publish — it reaches consumers
 * through `@objectstack/spec/integration`, so `build-docs.ts` documents it on
 * the Connector page; see that script's `integration:` comment and
 * `scripts/lib/root-index.ts`, which names a `shared/connector-auth.zod.ts` row
 * as a defect class). Those rows carry a `↗` marker, and the marker is what
 * reconciles N with M: a marked row is one of the N rows but is NOT one of the
 * M pages. The rule, in both directions:
 *
 *   - every row must link somewhere — a bare unlinked name is refused;
 *   - an UNMARKED row must link into this section's own category directory, at
 *     a page that exists, and no two unmarked rows may claim the same page;
 *   - a row that links anywhere else MUST carry `↗`;
 *   - a row that carries `↗` must NOT link into its own category — otherwise
 *     the marker silently subtracts a page from the coverage it advertises.
 *
 * (There is deliberately no `unmarked rows <= M` check: unmarked rows are
 * distinct, existing pages of that directory, so the inequality is already a
 * theorem of the three rules above. A check that can never go red reads as
 * coverage and is not.)
 *
 * ## Curation also happens one level up
 *
 * `references/studio/` (3 pages) and `references/contracts/` (0 pages) have no
 * section on the page at all. Left implicit, that is the same unwatched drift
 * one level up, so the page carries a `## Categories Without a Section` table
 * and this gate reads it: every category directory under
 * `content/docs/references/` must either be a section's derived category or be
 * declared there with its real page count — never both, never neither.
 *
 * ## Absence must be loud
 *
 * A count checker that stops recognising the page silently passes — it finds no
 * sections, compares nothing, and reports success, which is the "declared but
 * not enforced" failure this gate exists to prevent, one level up. So every
 * structural surprise is an error, not a skip: zero counted sections, a
 * `## ... Protocol` heading with no count (which is also what refuses the old
 * `(N schemas)` spelling), a counted section with no table or with more than
 * one, a counted section whose table has no rows, a missing
 * `## Categories Without a Section` block.
 *
 * Run `--self-test` to check the parser against known-good and known-bad pages
 * before trusting a green run.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TARGET = 'content/docs/getting-started/quick-reference.mdx';
const REFERENCES = 'content/docs/references';

/** `## Kernel Protocol (17 of 31 schemas)` / `## QA Protocol (1 of 1 schema)` */
const COUNTED_HEADING = /^##\s+(.+?)\s+\((\d+)\s+of\s+(\d+)\s+schemas?\)\s*$/;
/** Any `##` heading — what ends a section, counted or not. */
const ANY_H2 = /^##\s+/;
/** A heading that names a protocol section but carries no count. */
const PROTOCOL_HEADING = /^##\s+(.*\bProtocol\b.*)$/;
/** The block that states which reference categories deliberately have no section. */
const UNSECTIONED_HEADING = /^##\s+Categories Without a Section\s*$/;
/** `|:---|:---|` — the alignment row that proves the line above was a header. */
const TABLE_DIVIDER = /^\|[\s:|-]+\|\s*$/;
const TABLE_LINE = /^\|/;
/** A row link that lands inside the generated reference tree. */
const REFERENCE_ROUTE = /^\/docs\/references\/([^/]+)\/([^/#?]+)$/;
/** Marks a row whose protocol is documented outside its category's reference tree. */
const OUT_OF_TREE_MARK = '↗';

/** Split a markdown table line into its cells (an escaped `\|` is not a separator). */
function splitCells(line) {
  const parts = line.split(/(?<!\\)\|/);
  parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map((c) => c.trim());
}

/** The first cell of a row, read as `{ name, link, marked }`. */
function readRowCell(cell) {
  const marked = cell.includes(OUT_OF_TREE_MARK);
  const link = /\[([^\]]*)\]\(([^)]*)\)/.exec(cell);
  const name = link
    ? link[1].trim()
    : cell.replace(new RegExp(`[*\`${OUT_OF_TREE_MARK}]`, 'g'), '').trim();
  return { name: name || '(empty)', link: link ? link[2].trim() : null, marked };
}

/**
 * Parse the page into counted sections, the unsectioned-category declarations,
 * and structural complaints.
 *
 * @returns {{ sections: Array<{title: string, declared: number, declaredTotal: number,
 *                              actual: number, rows: Array, line: number}>,
 *             unsectioned: {line: number, entries: Array<{category: string, pages: number, line: number}>} | null,
 *             structural: Array<{line: number, message: string}> }}
 */
export function parsePage(text) {
  const lines = text.split('\n');
  const sections = [];
  const structural = [];
  let unsectioned = null;

  /** @type {{title: string, declared: number, declaredTotal: number, line: number, body: string[], bodyStart: number} | null} */
  let current = null;
  /** @type {{line: number, body: string[], bodyStart: number} | null} */
  let unsectionedBlock = null;

  const closeSection = () => {
    if (!current) return;
    const { rows, tables, rowLines } = countTableRows(current.body, current.bodyStart);
    if (tables === 0) {
      structural.push({
        line: current.line,
        message: `section "${current.title}" declares ${current.declared} but has no table under it`,
      });
    } else if (tables > 1) {
      structural.push({
        line: current.line,
        message: `section "${current.title}" has ${tables} tables; the count is ambiguous (expected exactly 1)`,
      });
    } else if (rows.length === 0) {
      structural.push({
        line: current.line,
        message: `section "${current.title}" has a table with no rows; the row format may have changed`,
      });
    }
    sections.push({
      title: current.title,
      declared: current.declared,
      declaredTotal: current.declaredTotal,
      actual: rows.length,
      rows: rows.map((r, i) => ({ ...readRowCell(splitCells(r)[0] ?? ''), line: rowLines[i] })),
      line: current.line,
    });
    current = null;
  };

  const closeUnsectioned = () => {
    if (!unsectionedBlock) return;
    const { rows, rowLines } = countTableRows(unsectionedBlock.body, unsectionedBlock.bodyStart);
    const entries = [];
    rows.forEach((row, i) => {
      const cells = splitCells(row);
      const category = /`([^`]+)`/.exec(cells[0] ?? '');
      const pages = /^\d+$/.test(cells[1] ?? '') ? Number(cells[1]) : null;
      if (!category || pages === null) {
        structural.push({
          line: rowLines[i],
          message:
            'a "Categories Without a Section" row must read "| `<directory>` | <pages> | <why> |"; ' +
            `got "${row.trim()}"`,
        });
        return;
      }
      entries.push({ category: category[1], pages, line: rowLines[i] });
    });
    unsectioned = { line: unsectionedBlock.line, entries };
    unsectionedBlock = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const counted = COUNTED_HEADING.exec(line);
    if (counted) {
      closeSection();
      closeUnsectioned();
      current = {
        title: counted[1],
        declared: Number(counted[2]),
        declaredTotal: Number(counted[3]),
        line: i + 1,
        body: [],
        bodyStart: i + 1,
      };
      continue;
    }
    if (ANY_H2.test(line)) {
      // A `##` heading ALWAYS ends the current section — including one with no
      // count. This is the containment that stops a section from running to the
      // end of the file and counting unrelated tables (#6319's Shared/12).
      closeSection();
      closeUnsectioned();
      if (UNSECTIONED_HEADING.test(line)) {
        unsectionedBlock = { line: i + 1, body: [], bodyStart: i + 1 };
        continue;
      }
      const protocolish = PROTOCOL_HEADING.exec(line);
      if (protocolish) {
        structural.push({
          line: i + 1,
          message: `heading "${protocolish[1]}" names a protocol section but declares no "(N of M schemas)" count`,
        });
      }
      continue;
    }
    if (current) current.body.push(line);
    else if (unsectionedBlock) unsectionedBlock.body.push(line);
  }
  closeSection();
  closeUnsectioned();

  if (sections.length === 0) {
    structural.push({
      line: 1,
      message:
        'no "## <Name> (N of M schemas)" sections found at all — the page structure or the heading format changed',
    });
  }
  if (!unsectioned) {
    structural.push({
      line: 1,
      message:
        'no "## Categories Without a Section" block found — category-level curation must be stated on the page, not left implicit',
    });
  }

  return { sections, unsectioned, structural };
}

/** Count body rows of the markdown table(s) in a section body. */
function countTableRows(body, bodyStart) {
  const rows = [];
  const rowLines = [];
  let tables = 0;
  for (let i = 0; i < body.length; i++) {
    // A table is a header line immediately followed by an alignment divider.
    if (!TABLE_LINE.test(body[i]) || !TABLE_DIVIDER.test(body[i + 1] ?? '')) continue;
    tables++;
    let j = i + 2;
    while (j < body.length && TABLE_LINE.test(body[j])) {
      rows.push(body[j]);
      rowLines.push(bodyStart + j + 1);
      j++;
    }
    i = j - 1;
  }
  return { rows, tables, rowLines };
}

/**
 * @param {string} text  the page
 * @param {Record<string, string[]>} catalog  category -> published page slugs
 *        (`content/docs/references/<category>/*.mdx` minus `index.mdx`)
 * @returns {{ findings: Array<{kind: string, line: number, message: string}>, sections: Array }}
 */
export function checkPage(text, catalog) {
  const { sections, unsectioned, structural } = parsePage(text);
  const findings = structural.map((s) => ({ ...s, kind: 'structure' }));
  const add = (kind, line, message) => findings.push({ kind, line, message });

  /** @type {Map<string, string>} derived category -> section title */
  const sectioned = new Map();

  for (const s of sections) {
    if (s.declared !== s.actual) {
      add(
        'count',
        s.line,
        `section "${s.title}" declares ${s.declared} schema(s) but its table has ${s.actual} row(s)`,
      );
    }

    // --- rows: link shape, and the ↗ marker in both directions ---------------
    const linked = [];
    for (const row of s.rows) {
      if (!row.link) {
        add(
          'row',
          row.line,
          `row "${row.name}" in section "${s.title}" has no link; every row must link to the page that documents it`,
        );
        continue;
      }
      const route = REFERENCE_ROUTE.exec(row.link);
      linked.push({ ...row, category: route?.[1] ?? null, page: route?.[2] ?? null });
      if (!route && !row.marked) {
        add(
          'row',
          row.line,
          `row "${row.name}" in section "${s.title}" links to ${row.link}, outside content/docs/references/, ` +
            `but is not marked ${OUT_OF_TREE_MARK} — the marker is what tells the reader it is not one of the M pages`,
        );
      }
    }

    // --- the section's category is DERIVED from its unmarked rows ------------
    const own = new Set(linked.filter((r) => !r.marked && r.category).map((r) => r.category));
    if (own.size > 1) {
      add(
        'row',
        s.line,
        `section "${s.title}" has unmarked rows pointing into ${own.size} different reference categories ` +
          `(${[...own].sort().join(', ')}); a row belongs to the section its /docs/references/<category>/ link names`,
      );
      continue;
    }
    if (own.size === 0) {
      add(
        'structure',
        s.line,
        `section "${s.title}" has no unmarked /docs/references/<category>/ row, so its category cannot be ` +
          'derived and its "of M" number cannot be checked against anything',
      );
      continue;
    }
    const category = [...own][0];
    if (sectioned.has(category)) {
      add(
        'coverage',
        s.line,
        `sections "${sectioned.get(category)}" and "${s.title}" both cover reference category \`${category}\``,
      );
    }
    sectioned.set(category, s.title);

    // --- M: the declared total against the real directory --------------------
    const pages = catalog[category];
    if (!pages) {
      add(
        'total',
        s.line,
        `section "${s.title}" derives category \`${category}\`, but ${REFERENCES}/${category}/ does not exist`,
      );
      continue;
    }
    if (s.declaredTotal !== pages.length) {
      add(
        'total',
        s.line,
        `section "${s.title}" declares "of ${s.declaredTotal} schemas" but ${REFERENCES}/${category}/ ` +
          `publishes ${pages.length} page(s)`,
      );
    }

    // --- unmarked rows must name real, distinct pages of that directory ------
    const claimed = new Map();
    for (const row of linked) {
      if (row.marked) {
        if (row.category === category) {
          add(
            'row',
            row.line,
            `row "${row.name}" in section "${s.title}" is marked ${OUT_OF_TREE_MARK} but links into its own ` +
              `category \`${category}\`; drop the marker or the row stops counting toward coverage`,
          );
        }
        continue;
      }
      if (!pages.includes(row.page)) {
        add(
          'row',
          row.line,
          `row "${row.name}" in section "${s.title}" links to ${row.link}, but ` +
            `${REFERENCES}/${category}/${row.page}.mdx does not exist`,
        );
        continue;
      }
      if (claimed.has(row.page)) {
        add(
          'row',
          row.line,
          `rows "${claimed.get(row.page)}" and "${row.name}" in section "${s.title}" both link to ` +
            `${row.link}; one page, two rows inflates N`,
        );
        continue;
      }
      claimed.set(row.page, row.name);
    }
  }

  // --- category-level curation: every directory is sectioned or declared -----
  if (unsectioned) {
    const declared = new Map();
    for (const entry of unsectioned.entries) {
      if (declared.has(entry.category)) {
        add('coverage', entry.line, `category \`${entry.category}\` is declared twice`);
        continue;
      }
      declared.set(entry.category, entry);
      const pages = catalog[entry.category];
      if (!pages) {
        add(
          'coverage',
          entry.line,
          `\`${entry.category}\` is declared as having no section, but ${REFERENCES}/${entry.category}/ does not exist`,
        );
        continue;
      }
      if (entry.pages !== pages.length) {
        add(
          'coverage',
          entry.line,
          `\`${entry.category}\` is declared with ${entry.pages} page(s) but ${REFERENCES}/${entry.category}/ ` +
            `publishes ${pages.length}`,
        );
      }
      if (sectioned.has(entry.category)) {
        add(
          'coverage',
          entry.line,
          `\`${entry.category}\` is declared as having no section, but "${sectioned.get(entry.category)}" covers it`,
        );
      }
    }
    for (const category of Object.keys(catalog).sort()) {
      if (sectioned.has(category) || declared.has(category)) continue;
      add(
        'coverage',
        unsectioned.line,
        `${REFERENCES}/${category}/ (${catalog[category].length} page(s)) has no section on this page and is not ` +
          'declared under "Categories Without a Section"',
      );
    }
  }

  findings.sort((a, b) => a.line - b.line);
  return { findings, sections };
}

/** Read `content/docs/references/` into `{ category: [pageSlug, ...] }`. */
export function readCatalog(referencesDir) {
  const catalog = {};
  for (const entry of readdirSync(referencesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    catalog[entry.name] = readdirSync(join(referencesDir, entry.name))
      .filter((f) => f.endsWith('.mdx') && f !== 'index.mdx')
      .map((f) => f.slice(0, -'.mdx'.length))
      .sort();
  }
  return catalog;
}

const GOOD_CATALOG = {
  data: ['field', 'filter', 'object', 'query'],
  qa: ['testing'],
  studio: ['flow-builder', 'object-designer', 'plugin'],
  contracts: [],
};

const GOOD_PAGE = [
  '# Quick Reference Guide',
  '',
  '## Data Protocol (3 of 4 schemas)',
  '',
  'Core business logic.',
  '',
  '| Protocol | Source File | Key Schemas | Purpose |',
  '|:---------|:-----------|:------------|:--------|',
  '| **[Field](/docs/references/data/field)** | `field.zod.ts` | Field | Field types |',
  '| **[Object](/docs/references/data/object)** | `object.zod.ts` | Object | Object defs |',
  '| **[Events](/docs/kernel/events)** ↗ | `events.zod.ts` | Event | Documented outside the tree |',
  '',
  '## QA Protocol (1 of 1 schema)',
  '',
  '| Protocol | Source File | Key Schemas | Purpose |',
  '|:---------|:-----------|:------------|:--------|',
  '| **[Testing](/docs/references/qa/testing)** | `testing.zod.ts` | TestSuite | Tests |',
  '',
  '## Categories Without a Section',
  '',
  '| Category directory | Pages | Why it has no section |',
  '|:---|---:|:---|',
  '| [`studio`](/docs/references/studio) | 3 | Designer-facing metadata. |',
  '| `contracts` | 0 | Publishes no reference page at all. |',
  '',
  '## Common Patterns',
  '',
  '### Declarative Endpoints (`apis:`)',
  '',
  '| Rule | Value |',
  '|:---|:---|',
  '| **Path shape** | only the subpath is yours |',
  '| **Namespace** | must be declared explicitly |',
  '',
].join('\n');

function selfTest() {
  const failures = [];
  const expect = (label, got, want) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) failures.push(`  ✗ ${label}: expected ${w}, got ${g}`);
  };
  const has = (findings, re) => findings.some((f) => re.test(f.message));

  // 1. POSITIVE — the measurement itself, per section, on BOTH numbers. A
  //    gutted checker that returns nothing fails here, and so does one that
  //    stops resolving the directory side: the fourth column is the catalog's
  //    real size, not the page's claim about it.
  {
    const { sections, findings } = checkPage(GOOD_PAGE, GOOD_CATALOG);
    expect(
      'good page measures every section (title, N, rows, declared M)',
      sections.map((s) => [s.title, s.declared, s.actual, s.declaredTotal]),
      [
        ['Data Protocol', 3, 3, 4],
        ['QA Protocol', 1, 1, 1],
      ],
    );
    // NEGATIVE (declared): "a correct page is clean". Trivially true for a
    // checker that reports nothing — it is here to catch false positives, and
    // it can never be the case that turns this gate red.
    expect('good page is clean', findings.length, 0);
  }

  // 2. POSITIVE — a wrong N is caught, and the message names the section and
  //    BOTH numbers. A gate that merely says "mismatch" fails this.
  {
    const bad = GOOD_PAGE.replace('## Data Protocol (3 of 4 schemas)', '## Data Protocol (5 of 4 schemas)');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('wrong N produces exactly one finding', findings.length, 1);
    expect('wrong N is a count finding', findings[0]?.kind, 'count');
    expect('names the section', /"Data Protocol"/.test(findings[0]?.message ?? ''), true);
    expect('names the declared number', /\b5 schema/.test(findings[0]?.message ?? ''), true);
    expect('names the actual number', /\b3 row/.test(findings[0]?.message ?? ''), true);
  }

  // 3. POSITIVE — the M-ASSERTION, and the case that makes this gate more than
  //    self-referential (#6530). The page's table is internally consistent and
  //    only the directory disagrees. Delete the `declaredTotal !== pages.length`
  //    comparison in checkPage and this case measures zero findings — which is
  //    exactly the green-forever state #6530 documented.
  {
    const bad = GOOD_PAGE.replace('## Data Protocol (3 of 4 schemas)', '## Data Protocol (3 of 9 schemas)');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('wrong M produces exactly one finding', findings.length, 1);
    expect('wrong M is a total finding', findings[0]?.kind, 'total');
    expect('names the declared total', /of 9 schemas/.test(findings[0]?.message ?? ''), true);
    expect('names the real page count', /publishes 4 page/.test(findings[0]?.message ?? ''), true);
  }

  // 4. POSITIVE — a deleted table row is caught.
  {
    const bad = GOOD_PAGE.replace(
      '| **[Object](/docs/references/data/object)** | `object.zod.ts` | Object | Object defs |\n',
      '',
    );
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('deleted row produces one finding', findings.length, 1);
    expect('deleted row names both numbers', /3 schema\(s\).*2 row\(s\)/.test(findings[0]?.message ?? ''), true);
  }

  // 5. POSITIVE — the SINGULAR "(1 of 1 schema)" heading is a real section.
  //    #6319's report came from a plural-only regex; under one, this page yields
  //    no finding at all because QA is not a section and its row is charged to
  //    Data.
  {
    const bad = GOOD_PAGE.replace('## QA Protocol (1 of 1 schema)', '## QA Protocol (2 of 1 schema)');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('singular heading is parsed as a section', findings.length, 1);
    expect('singular section named in the finding', /"QA Protocol"/.test(findings[0]?.message ?? ''), true);
  }

  // 6. POSITIVE — a section ends at the next `##` even when that heading has no
  //    count, so neither the "Categories Without a Section" table nor the
  //    Declarative Endpoints rule table is charged to QA. Asserted as a measured
  //    value (1), not as "no findings" — the leaky scanner of #6319 would
  //    measure 5 here.
  {
    const { sections } = checkPage(GOOD_PAGE, GOOD_CATALOG);
    const qa = sections.find((s) => s.title === 'QA Protocol');
    expect('last section stops at the uncounted heading', qa?.actual, 1);
  }

  // 7. POSITIVE — the heading FORMAT changing is loud, not silent. Both halves
  //    matter: the section stops being counted (so nothing is compared) and the
  //    gate must say so — including that its category then has no section.
  {
    const bad = GOOD_PAGE.replace('## Data Protocol (3 of 4 schemas)', '## Data Protocol - 3 schemas');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('reformatted heading is reported', has(findings, /declares no "\(N of M schemas\)" count/), true);
    expect('and its category falls out of coverage', has(findings, /references\/data\/ \(4 page\(s\)\) has no section/), true);
  }

  // 8. POSITIVE — the OLD `(N schemas)` spelling is refused rather than silently
  //    accepted. Without this, #6530's migration could be reverted one heading
  //    at a time and the M-assertion would quietly stop applying to it.
  {
    const bad = GOOD_PAGE.replace('## Data Protocol (3 of 4 schemas)', '## Data Protocol (3 schemas)');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('bare "(N schemas)" is not a counted heading', has(findings, /declares no "\(N of M schemas\)" count/), true);
  }

  // 9. POSITIVE — a counted section whose table vanished.
  {
    const bad = [
      '## Data Protocol (2 of 4 schemas)',
      '',
      'Core business logic.',
      '',
      '## Categories Without a Section',
      '',
      '| Category directory | Pages | Why it has no section |',
      '|:---|---:|:---|',
      '| `contracts` | 0 | none. |',
      '',
    ].join('\n');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('missing table is a structure finding', findings[0]?.kind, 'structure');
    expect('missing table says so', has(findings, /has no table under it/), true);
  }

  // 10. POSITIVE — a page the parser no longer recognises at all fails loudly
  //     instead of passing with zero comparisons.
  {
    const { findings } = checkPage('# Quick Reference Guide\n\nnothing here.\n', GOOD_CATALOG);
    expect('unrecognised page is reported', has(findings, /no "## <Name> \(N of M schemas\)" sections found at all/), true);
    expect('unrecognised page is a structure finding', findings[0]?.kind, 'structure');
  }

  // 11. POSITIVE — two tables in one counted section is ambiguous, not silently
  //     summed.
  {
    const bad = GOOD_PAGE.replace(
      '| **[Object](/docs/references/data/object)** | `object.zod.ts` | Object | Object defs |',
      [
        '| **[Object](/docs/references/data/object)** | `object.zod.ts` | Object | Object defs |',
        '',
        '| A | B |',
        '|:--|:--|',
        '| x | y |',
      ].join('\n'),
    );
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('two tables is a structure finding', has(findings, /has 2 tables/), true);
  }

  // 12. POSITIVE — a bare unlinked name is refused. This is the shape Shared's
  //     `Connector Auth` row had before #6530.
  {
    const bad = GOOD_PAGE.replace(
      '| **[Field](/docs/references/data/field)** | `field.zod.ts` | Field | Field types |',
      '| **Field** | `field.zod.ts` | Field | Field types |',
    );
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('unlinked row is a row finding', has(findings, /row "Field" .* has no link/), true);
  }

  // 13. POSITIVE — a row that documents its protocol outside the reference tree
  //     must carry the marker; unmarked, it silently claims to be one of the M.
  {
    const bad = GOOD_PAGE.replace(
      '| **[Events](/docs/kernel/events)** ↗ |',
      '| **[Events](/docs/kernel/events)** |',
    );
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('unmarked foreign row is reported', has(findings, /outside content\/docs\/references\/, but is not marked/), true);
  }

  // 14. POSITIVE — and the mirror: marking a row that IS in its own tree hides a
  //     page from the coverage the heading advertises.
  {
    const bad = GOOD_PAGE.replace(
      '| **[Field](/docs/references/data/field)** |',
      '| **[Field](/docs/references/data/field)** ↗ |',
    );
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('mismarked in-tree row is reported', has(findings, /is marked ↗ but links into its own category `data`/), true);
  }

  // 15. POSITIVE — a row pointing at a reference page that no longer exists.
  //     Nothing else on the page changes, so only the directory can catch it.
  {
    const bad = GOOD_PAGE.replace('/docs/references/data/object)', '/docs/references/data/ghost)');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('dead reference row is reported', has(findings, /references\/data\/ghost\.mdx does not exist/), true);
  }

  // 16. POSITIVE — #6319's actual defect, caught by LINK rather than by count: a
  //     row that migrated into the wrong section. The counts still agree.
  {
    const bad = GOOD_PAGE.replace('/docs/references/data/object)', '/docs/references/qa/testing)');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('cross-category rows are reported', has(findings, /pointing into 2 different reference categories \(data, qa\)/), true);
  }

  // 17. POSITIVE — one page listed twice inflates N while every count still
  //     agrees with every other count.
  {
    const bad = GOOD_PAGE.replace('/docs/references/data/object)', '/docs/references/data/field)');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('duplicate row is reported', has(findings, /both link to .*data\/field; one page, two rows inflates N/), true);
  }

  // 18. POSITIVE — a category directory that is neither sectioned nor declared.
  //     This is the category-level half of #6530's drift.
  {
    const bad = GOOD_PAGE.replace('| [`studio`](/docs/references/studio) | 3 | Designer-facing metadata. |\n', '');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('undeclared category is reported', has(findings, /references\/studio\/ \(3 page\(s\)\) has no section/), true);
    expect('undeclared category is a coverage finding', findings.find((f) => /studio/.test(f.message))?.kind, 'coverage');
  }

  // 19. POSITIVE — the declared page count of an unsectioned category is checked
  //     against the directory too, so `studio` growing a page is not silent.
  {
    const bad = GOOD_PAGE.replace('](/docs/references/studio) | 3 |', '](/docs/references/studio) | 5 |');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('wrong unsectioned count is reported', has(findings, /`studio` is declared with 5 page\(s\) but .* publishes 3/), true);
  }

  // 20. POSITIVE — declaring a category as unsectioned while it HAS a section is
  //     a contradiction, not a harmless duplicate.
  {
    const bad = GOOD_PAGE.replace('| `contracts` | 0 |', '| `data` | 4 |');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('contradictory declaration is reported', has(findings, /`data` is declared as having no section, but "Data Protocol" covers it/), true);
    expect('and contracts then falls out of coverage', has(findings, /references\/contracts\/ \(0 page\(s\)\) has no section/), true);
  }

  // 21. POSITIVE — a declared directory that does not exist. The symmetric
  //     rot: the block outliving the tree it describes.
  {
    const bad = GOOD_PAGE.replace('| `contracts` | 0 |', '| `gone` | 0 |');
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('stale declaration is reported', has(findings, /`gone` is declared as having no section, but .* does not exist/), true);
  }

  // 22. POSITIVE — deleting the whole block is loud. Without this, "state the
  //     curation on the page" is enforced only while someone keeps it there.
  {
    const bad = GOOD_PAGE.split('## Categories Without a Section')[0] + '## Common Patterns\n';
    const { findings } = checkPage(bad, GOOD_CATALOG);
    expect('missing block is reported', has(findings, /no "## Categories Without a Section" block found/), true);
  }

  if (failures.length) {
    console.error('\n✗ check-quick-reference-counts self-test failed:\n');
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log('✓ check-quick-reference-counts self-test: 22 cases pass.');
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const full = join(ROOT, TARGET);
  if (!existsSync(full)) {
    // The page moving is itself a finding: a silent skip would retire the gate.
    console.error(`\n✗ ${TARGET} not found.\n`);
    console.error(
      'This guard exists because that page\'s "(N of M schemas)" headings are a\n' +
        'declaration about the table under each one AND about the reference\n' +
        'directory it curates. If the page moved, point TARGET in\n' +
        'scripts/check-quick-reference-counts.mjs at its new home; if it is gone,\n' +
        'delete this gate and its package.json / lint.yml wiring.\n',
    );
    process.exit(1);
  }

  const referencesDir = join(ROOT, REFERENCES);
  if (!existsSync(referencesDir)) {
    console.error(`\n✗ ${REFERENCES}/ not found.\n`);
    console.error(
      'The "of M" half of every heading is measured against that tree. Without\n' +
        'it there is nothing to compare, and passing anyway would put this gate\n' +
        'back where #6530 found it: green by vacancy.\n',
    );
    process.exit(1);
  }

  const catalog = readCatalog(referencesDir);
  const { findings, sections } = checkPage(readFileSync(full, 'utf8'), catalog);

  if (findings.length === 0) {
    console.log(
      `✓ ${TARGET}: ${sections.length} section(s), every "(N of M schemas)" heading matches its table AND ` +
        `${REFERENCES}/ (${Object.keys(catalog).length} categories, all sectioned or declared).`,
    );
    return;
  }

  console.error(`\n✗ ${TARGET} — the declared sections do not match the page or the reference tree:\n`);
  for (const f of findings) {
    console.error(`  ${TARGET}:${f.line}  [${f.kind}] ${f.message}`);
  }
  console.error(`
Each "## <Name> Protocol (N of M schemas)" heading declares two things: N, how
many rows its table has, and M, how many pages
${REFERENCES}/<category>/ publishes. Decide which side is wrong before
editing — the heading is not automatically the stale one:

  - [count] the section really did gain or lose a row  -> update N;
  - [count] a row is missing, or sits in the wrong section  -> restore or move
    the row (its /docs/references/<category>/ link names the section it belongs
    to);
  - [total] the category gained or lost a reference page -> update M. The table
    is a CURATED subset (#6530): N < M is the normal state, and adding rows to
    close the gap is a decision, not a fix;
  - [row] a row points outside its category's reference tree -> mark it ${OUT_OF_TREE_MARK}; a row
    with no link at all is refused outright;
  - [coverage] a category directory appeared or vanished -> give it a section,
    or state it under "## Categories Without a Section".

A [structure] finding means the page no longer looks the way this gate reads
it. That is reported rather than skipped on purpose: a count checker that
quietly stops recognising its page reports success forever.
`);
  process.exit(1);
}

main();
