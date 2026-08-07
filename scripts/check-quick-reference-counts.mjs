#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Quick-reference section-count guard (#6319).
 *
 * ## What it guards
 *
 * `content/docs/getting-started/quick-reference.mdx` is the protocol index: one
 * `## <Name> Protocol (N schemas)` section per namespace, each followed by a
 * table with one row per protocol. The `(N schemas)` in the heading is a
 * DECLARATION about the table underneath it, and nothing checked it.
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
 * ## Why the gate counts instead of a reader
 *
 * Hand-counting this page is measurably unreliable, and #6319 is the specimen.
 * Its report listed three mismatches; only one was real. The other two came
 * from a scanner that recognised a section heading only by the PLURAL
 * `(N schemas)`, so `## Integration Protocol (1 schema)` and
 * `## QA Protocol (1 schema)` were invisible and their rows were charged to the
 * section above — and, because a section then ended only at the next
 * *recognised* heading, the Shared section also swallowed the six
 * `| **Path shape** | ... |` rows of the Declarative Endpoints rule table far
 * below it, reporting 12 rows where there are 5.
 *
 * Both traps are pinned by the self-test, and the parser is built to be immune:
 * a count is `(N schema)` OR `(N schemas)`, and a section ends at the next `##`
 * heading of ANY kind, counted or not.
 *
 * ## Absence must be loud
 *
 * A count checker that stops recognising the page silently passes — it finds no
 * sections, compares nothing, and reports success, which is the "declared but
 * not enforced" failure this gate exists to prevent, one level up. So every
 * structural surprise is an error, not a skip: zero counted sections, a
 * `## ... Protocol` heading with no count, a counted section with no table or
 * with more than one, a counted section whose table has no rows.
 *
 * Run `--self-test` to check the parser against known-good and known-bad pages
 * before trusting a green run.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TARGET = 'content/docs/getting-started/quick-reference.mdx';

/** `## Kernel Protocol (17 schemas)` / `## QA Protocol (1 schema)` */
const COUNTED_HEADING = /^##\s+(.+?)\s+\((\d+)\s+schemas?\)\s*$/;
/** Any `##` heading — what ends a section, counted or not. */
const ANY_H2 = /^##\s+/;
/** A heading that names a protocol section but carries no count. */
const PROTOCOL_HEADING = /^##\s+(.*\bProtocol\b.*)$/;
/** `|:---|:---|` — the alignment row that proves the line above was a header. */
const TABLE_DIVIDER = /^\|[\s:|-]+\|\s*$/;
const TABLE_LINE = /^\|/;

/**
 * Parse the page into counted sections plus structural complaints.
 *
 * @returns {{ sections: Array<{title: string, declared: number, actual: number, line: number}>,
 *             structural: Array<{line: number, message: string}> }}
 */
export function parsePage(text) {
  const lines = text.split('\n');
  const sections = [];
  const structural = [];

  /** @type {{title: string, declared: number, line: number, body: string[], bodyStart: number} | null} */
  let current = null;

  const closeSection = () => {
    if (!current) return;
    const { rows, tables } = countTableRows(current.body, current.bodyStart);
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
    } else if (rows === 0) {
      structural.push({
        line: current.line,
        message: `section "${current.title}" has a table with no rows; the row format may have changed`,
      });
    }
    sections.push({
      title: current.title,
      declared: current.declared,
      actual: rows,
      line: current.line,
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const counted = COUNTED_HEADING.exec(line);
    if (counted) {
      closeSection();
      current = {
        title: counted[1],
        declared: Number(counted[2]),
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
      const protocolish = PROTOCOL_HEADING.exec(line);
      if (protocolish) {
        structural.push({
          line: i + 1,
          message: `heading "${protocolish[1]}" names a protocol section but declares no "(N schemas)" count`,
        });
      }
      continue;
    }
    if (current) current.body.push(line);
  }
  closeSection();

  if (sections.length === 0) {
    structural.push({
      line: 1,
      message:
        'no "## <Name> (N schemas)" sections found at all — the page structure or the heading format changed',
    });
  }

  return { sections, structural };
}

/** Count body rows of the markdown table(s) in a section body. */
function countTableRows(body, _bodyStart) {
  let rows = 0;
  let tables = 0;
  for (let i = 0; i < body.length; i++) {
    // A table is a header line immediately followed by an alignment divider.
    if (!TABLE_LINE.test(body[i]) || !TABLE_DIVIDER.test(body[i + 1] ?? '')) continue;
    tables++;
    let j = i + 2;
    while (j < body.length && TABLE_LINE.test(body[j])) {
      rows++;
      j++;
    }
    i = j - 1;
  }
  return { rows, tables };
}

/** @returns {{ findings: Array<{line: number, message: string}>, sections: Array }} */
export function checkPage(text) {
  const { sections, structural } = parsePage(text);
  const findings = structural.map((s) => ({ ...s, kind: 'structure' }));
  for (const s of sections) {
    if (s.declared !== s.actual) {
      findings.push({
        kind: 'count',
        line: s.line,
        message: `section "${s.title}" declares ${s.declared} schema(s) but its table has ${s.actual} row(s)`,
      });
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, sections };
}

const GOOD_PAGE = [
  '# Quick Reference Guide',
  '',
  '## Data Protocol (2 schemas)',
  '',
  'Core business logic.',
  '',
  '| Protocol | Source File | Key Schemas | Purpose |',
  '|:---------|:-----------|:------------|:--------|',
  '| **[Field](/docs/references/data/field)** | `field.zod.ts` | Field | Field types |',
  '| **[Object](/docs/references/data/object)** | `object.zod.ts` | Object | Object defs |',
  '',
  '## QA Protocol (1 schema)',
  '',
  '| Protocol | Source File | Key Schemas | Purpose |',
  '|:---------|:-----------|:------------|:--------|',
  '| **[Testing](/docs/references/qa/testing)** | `testing.zod.ts` | TestSuite | Tests |',
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

  // 1. POSITIVE — the measurement itself, per section. A gutted checker that
  //    returns nothing fails here, which is why this asserts measured values
  //    rather than "no findings".
  {
    const { sections, findings } = checkPage(GOOD_PAGE);
    expect(
      'good page measures every section',
      sections.map((s) => [s.title, s.declared, s.actual]),
      [
        ['Data Protocol', 2, 2],
        ['QA Protocol', 1, 1],
      ],
    );
    // NEGATIVE (declared): "a correct page is clean". Trivially true for a
    // checker that reports nothing — it is here to catch false positives, and
    // it can never be the case that turns this gate red.
    expect('good page is clean', findings.length, 0);
  }

  // 2. POSITIVE — a wrong count is caught, and the message names the section
  //    and BOTH numbers. A gate that merely says "mismatch" fails this.
  {
    const bad = GOOD_PAGE.replace('## Data Protocol (2 schemas)', '## Data Protocol (3 schemas)');
    const { findings } = checkPage(bad);
    expect('wrong count produces exactly one finding', findings.length, 1);
    expect('wrong count is a count finding', findings[0]?.kind, 'count');
    expect('names the section', /"Data Protocol"/.test(findings[0]?.message ?? ''), true);
    expect('names the declared number', /\b3 schema/.test(findings[0]?.message ?? ''), true);
    expect('names the actual number', /\b2 row/.test(findings[0]?.message ?? ''), true);
  }

  // 3. POSITIVE — a deleted table row is caught.
  {
    const bad = GOOD_PAGE.replace(
      '| **[Object](/docs/references/data/object)** | `object.zod.ts` | Object | Object defs |\n',
      '',
    );
    const { findings } = checkPage(bad);
    expect('deleted row produces one finding', findings.length, 1);
    expect('deleted row names both numbers', /2 schema\(s\).*1 row\(s\)/.test(findings[0]?.message ?? ''), true);
  }

  // 4. POSITIVE — the SINGULAR "(1 schema)" heading is a real section. #6319's
  //    report came from a plural-only regex; under one, this page yields no
  //    finding at all because QA is not a section and its row is charged to
  //    Data (making Data look like 3, matching nothing).
  {
    const bad = GOOD_PAGE.replace('## QA Protocol (1 schema)', '## QA Protocol (2 schemas)');
    const { findings } = checkPage(bad);
    expect('singular heading is parsed as a section', findings.length, 1);
    expect('singular section named in the finding', /"QA Protocol"/.test(findings[0]?.message ?? ''), true);
  }

  // 5. POSITIVE — a section ends at the next `##` even when that heading has no
  //    count, so the Declarative Endpoints rule table is NOT charged to QA.
  //    Asserted as a measured value (1), not as "no findings" — the leaky
  //    scanner of #6319 would measure 3 here.
  {
    const { sections } = checkPage(GOOD_PAGE);
    const qa = sections.find((s) => s.title === 'QA Protocol');
    expect('last section stops at the uncounted heading', qa?.actual, 1);
  }

  // 6. POSITIVE — the heading FORMAT changing is loud, not silent. Both halves
  //    matter: the section stops being counted (so nothing is compared) and the
  //    gate must say so.
  {
    const bad = GOOD_PAGE.replace('## Data Protocol (2 schemas)', '## Data Protocol - 2 schemas');
    const { findings } = checkPage(bad);
    expect('reformatted heading is reported', findings.length, 1);
    expect('reformatted heading is a structure finding', findings[0]?.kind, 'structure');
    expect('reformatted heading names itself', /declares no "\(N schemas\)" count/.test(findings[0]?.message ?? ''), true);
  }

  // 7. POSITIVE — a counted section whose table vanished.
  {
    const bad = [
      '## Data Protocol (2 schemas)',
      '',
      'Core business logic.',
      '',
      '## Other',
      '',
    ].join('\n');
    const { findings } = checkPage(bad);
    expect('missing table is a structure finding', findings[0]?.kind, 'structure');
    expect('missing table says so', /has no table under it/.test(findings[0]?.message ?? ''), true);
  }

  // 8. POSITIVE — a page the parser no longer recognises at all fails loudly
  //    instead of passing with zero comparisons.
  {
    const { findings } = checkPage('# Quick Reference Guide\n\nnothing here.\n');
    expect('unrecognised page is reported', findings.length, 1);
    expect('unrecognised page is a structure finding', findings[0]?.kind, 'structure');
    expect(
      'unrecognised page says the structure changed',
      /no "## <Name> \(N schemas\)" sections found at all/.test(findings[0]?.message ?? ''),
      true,
    );
  }

  // 9. POSITIVE — two tables in one counted section is ambiguous, not silently
  //    summed.
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
    const { findings } = checkPage(bad);
    expect('two tables is a structure finding', findings.some((f) => /has 2 tables/.test(f.message)), true);
  }

  if (failures.length) {
    console.error('\n✗ check-quick-reference-counts self-test failed:\n');
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log('✓ check-quick-reference-counts self-test: 9 cases pass.');
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const full = join(ROOT, TARGET);
  if (!existsSync(full)) {
    // The page moving is itself a finding: a silent skip would retire the gate.
    console.error(`\n✗ ${TARGET} not found.\n`);
    console.error(
      'This guard exists because that page\'s "(N schemas)" headings are a\n' +
        'declaration about the table under each one. If the page moved, point\n' +
        'TARGET in scripts/check-quick-reference-counts.mjs at its new home;\n' +
        'if it is gone, delete this gate and its package.json / lint.yml wiring.\n',
    );
    process.exit(1);
  }

  const { findings, sections } = checkPage(readFileSync(full, 'utf8'));

  if (findings.length === 0) {
    console.log(
      `✓ ${TARGET}: ${sections.length} section(s), every "(N schemas)" heading matches its table.`,
    );
    return;
  }

  console.error(`\n✗ ${TARGET} — declared section counts do not match the tables:\n`);
  for (const f of findings) {
    console.error(`  ${TARGET}:${f.line}  [${f.kind}] ${f.message}`);
  }
  console.error(`
Each "## <Name> Protocol (N schemas)" heading declares how many rows its table
has. Decide which side is wrong before editing — the heading is not
automatically the stale one:

  - the section really did gain or lose a protocol  -> update the heading;
  - a row is missing, or sits in the wrong section  -> restore or move the row
    (its "Source File" column and its /docs/references/<domain>/ link both name
    the section it belongs to);
  - a row points at a retired schema                -> remove the row AND
    decrement the heading in the same edit.

A [structure] finding means the page no longer looks the way this gate reads
it. That is reported rather than skipped on purpose: a count checker that
quietly stops recognising its page reports success forever.
`);
  process.exit(1);
}

main();
