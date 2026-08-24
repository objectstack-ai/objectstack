#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-overlay-whitelist-table (#11752) -- the "Overlay whitelist (shared-DB
 * tenancy invariant)" table in `content/docs/concepts/metadata-lifecycle.mdx`
 * must agree with `DEFAULT_METADATA_TYPE_REGISTRY`, in BOTH directions.
 *
 *   node scripts/check-overlay-whitelist-table.mjs              # judge the checked-in tree
 *   node scripts/check-overlay-whitelist-table.mjs --list       # every type and where it is asserted
 *   node scripts/check-overlay-whitelist-table.mjs --self-test  # prove the battery can go red
 *
 * ## The gap this closes
 *
 * The section states its own contract: "The whitelist lives in **one** place:
 * `MetadataTypeRegistryEntry.allowOrgOverride`". The table under that sentence
 * is hand-maintained -- no generator writes the page, there is no `DO NOT EDIT`
 * marker -- so the single source of truth had a hand-kept copy sitting directly
 * beneath it with nothing holding the two together.
 *
 * It drifted on FOUR types and stayed drifted long enough to be caught by a
 * human fact-checking a promo video (#11664), not by CI:
 *
 *   type          table said   registry says
 *   -----------   ----------   -------------
 *   flow          ✅           ❌  (rolled back #6283)
 *   permission    ✅           ❌  (rolled back #6483)
 *   position      ✅           ❌  (same rollback)
 *   translation   absent       ✅
 *
 * #11750 corrected the table. This gate is what stops the next drift.
 *
 * ## Why BOTH directions (constraint 1, established by measurement on #11750)
 *
 * `translation` was a false negative BY OMISSION -- a type the registry marks
 * `allowOrgOverride: true` that the table simply did not list. A one-directional
 * table→registry gate ("every row I can see agrees with the registry") passes
 * on a table that is missing a whole row. Three of the four defects were
 * findable from the table side; the fourth was findable ONLY from the registry
 * side. A one-legged gate would have shipped 3/4 and reported clean.
 *
 * So the comparison runs as two legs, and BOTH counts are printed even when
 * both are zero -- a reader has to be able to see that the second leg exists
 * and ran:
 *
 *   LEG 1  table → registry: every type named in the table carries the
 *          registry's verdict for it (and is a type the registry declares).
 *   LEG 2  registry → table: every registry entry with `allowOrgOverride: true`
 *          is named somewhere in the table.
 *
 * Leg 2 is deliberately asymmetric: it demands rows only for the `true` set.
 * The table is a WHITELIST -- it enumerates what may be overridden, plus the
 * `false` types whose second tier (`allowRuntimeCreate`) is worth calling out.
 * Requiring a row for all 27 types would demand a table nobody wants and would
 * be the kind of gate that gets deleted rather than obeyed.
 *
 * ## Why AST, not regex (constraint 2, and the whole reason this file is 400
 * lines instead of a grep)
 *
 * This is not a style preference. A same-line regex silently UNDER-READS this
 * exact registry. Measured on `origin/main` @ `2a6122bd9`:
 *
 *   grep -cE "^  \{ type: '"  packages/spec/src/kernel/metadata-plugin.zod.ts  ->  26
 *   this file's AST walk                                                      ->  27
 *
 * The missed entry is `datasource`, whose object literal opens `{` on its own
 * line, so `type:` and `allowOrgOverride:` land on separate lines. A
 * regex-built gate would have been born with one type invisible to it -- and
 * invisible in the direction that matters, because an entry the gate never
 * parsed can never be reported as an omission from the table. It would have
 * been a gate with a permanent, silent hole, printing a green line.
 *
 * Two more shapes in the same file that a regex reads wrong, both present today:
 *
 *   grep -c 'allowOrgOverride: true'   -> 6, but only 5 are ENTRIES; the sixth
 *                                        is prose inside a code comment.
 *   grep -c 'allowOrgOverride: false'  -> 33 inside the registry region, but
 *                                        only 22 are entries; the other 11 are
 *                                        comments discussing the flags.
 *
 * The AST sees 5 and 22. Comments are not nodes. `--self-test` pins all three
 * of these numbers against fixtures, including a fixture whose regex/AST counts
 * differ, so the next person to "simplify this to a grep" gets a red battery
 * rather than a quiet under-read.
 *
 * ## Structural findings are RED, never skipped
 *
 * Every way this gate can lose track of its subject is a finding:
 *
 *   - the `## Overlay whitelist ...` heading is gone or renamed;
 *   - the table's header row no longer reads `Type | allowOrgOverride | ...`
 *     (a column swap would otherwise make the gate read the WRONG column and
 *     keep printing green);
 *   - a verdict cell holds anything but a bare ✅ / ❌;
 *   - a type cell holds anything but backticked type names;
 *   - the registry is not an array literal of object literals with literal
 *     `type` / `allowOrgOverride` values (a spread, a computed key, an
 *     identifier flag, a helper call).
 *
 * That last one is the route-around clause. If the registry ever grows a shape
 * this walk cannot read honestly, the gate REFUSES rather than skipping the
 * entry -- because skipping is exactly how the regex version would have failed,
 * one level up. A gate that cannot read its input must not report "nothing to
 * report".
 *
 * ## Scope: this table only, deliberately
 *
 * Sibling pages state the same facts correctly in PROSE, not in a machine-shaped
 * type→flag table: `content/docs/permissions/authorization.mdx:236`
 * ("`permission` declares `allowOrgOverride: false`"),
 * `content/docs/automation/jobs.mdx:42` (a job-vs-flow comparison table whose
 * flag mention sits inside an English cell), `content/docs/ai/agents.mdx`,
 * `content/docs/permissions/capabilities.mdx`,
 * `content/docs/references/system/email-template.mdx`.
 *
 * Measured before deciding: `grep -rn allowOrgOverride content/docs/` hits 22
 * lines across 13 files. Of those, ~5 are genuine "<type> is <bool>" assertions;
 * the rest are the schema-field reference row, a code sample using an invented
 * type, and sentences ABOUT the flag rather than about any type
 * (`metadata-lifecycle.mdx:121` itself is one). Covering them mechanically
 * means a co-occurrence regex over English plus a per-site allowlist of ~17
 * exceptions to catch ~5 assertions -- a worse gate than none, and the kind
 * whose baseline gets bulk-updated to green. They are left out on purpose, and
 * this paragraph exists so the next person re-deciding it starts from the count
 * rather than from scratch.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const REGISTRY_FILE = 'packages/spec/src/kernel/metadata-plugin.zod.ts';
const REGISTRY_CONST = 'DEFAULT_METADATA_TYPE_REGISTRY';
const DOC_FILE = 'content/docs/concepts/metadata-lifecycle.mdx';

/** The section that owns the table. Pinned: if it moves, the gate goes red. */
const HEADING = '## Overlay whitelist (shared-DB tenancy invariant)';
/** Any `##` heading -- what ends the section. */
const ANY_H2 = /^##\s+/;
/** `|:---|:---:|:---|` -- the alignment row that proves the line above is a header. */
const TABLE_DIVIDER = /^\|[\s:|-]+\|\s*$/;
const TABLE_LINE = /^\s*\|/;

/** The two columns this gate reads, by name. A rename or reorder is a finding. */
const COL_TYPE = 'Type';
const COL_FLAG = 'allowOrgOverride';

const YES = '✅';
const NO = '❌';

/** A metadata type name as the registry spells it. */
const TYPE_NAME = /^[a-z][a-z0-9_]*$/;
/** A backticked token inside a table cell. */
const BACKTICKED = /`([^`]*)`/g;

// ---------------------------------------------------------------------------
// Registry side -- AST
// ---------------------------------------------------------------------------

/**
 * Read `DEFAULT_METADATA_TYPE_REGISTRY` by AST.
 *
 * @returns {{ entries: Array<{type: string, allowOrgOverride: boolean, line: number}>,
 *             findings: Array<{kind: string, message: string, line: number}> }}
 *   `findings` non-empty means the registry could not be read honestly. It is
 *   never "read what we could and carry on" -- see the header.
 */
export function readRegistry(text, fileLabel = REGISTRY_FILE) {
  const source = parseSourceFile(fileLabel, text, ts.ScriptKind.TS);
  const findings = [];
  const entries = [];
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  let array = null;
  const findDecl = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === REGISTRY_CONST
    ) {
      array = node.initializer ?? null;
      return;
    }
    ts.forEachChild(node, findDecl);
  };
  findDecl(source);

  if (array === null) {
    findings.push({
      kind: 'structure',
      line: 1,
      message: `no \`${REGISTRY_CONST}\` declaration with an initializer in this file`,
    });
    return { entries, findings };
  }
  if (!ts.isArrayLiteralExpression(array)) {
    findings.push({
      kind: 'structure',
      line: lineOf(array),
      message:
        `\`${REGISTRY_CONST}\` is no longer a plain array literal (found ` +
        `${ts.SyntaxKind[array.kind]}). This gate reads entries positionally; ` +
        `it refuses rather than guessing.`,
    });
    return { entries, findings };
  }

  for (const element of array.elements) {
    const line = lineOf(element);
    if (!ts.isObjectLiteralExpression(element)) {
      findings.push({
        kind: 'structure',
        line,
        message:
          `registry element is ${ts.SyntaxKind[element.kind]}, not an object literal — ` +
          `a spread or computed element cannot be read as a type/flag pair, and ` +
          `skipping it is how a type goes invisible to this gate.`,
      });
      continue;
    }

    let type = null;
    let flag = null;
    let bad = false;

    for (const prop of element.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        // A shorthand or spread inside the entry. Only fatal if it could carry
        // one of the two keys this gate reads — which, unread, it could.
        findings.push({
          kind: 'structure',
          line: lineOf(prop),
          message:
            `registry entry contains a ${ts.SyntaxKind[prop.kind]} member; ` +
            `\`type\` / \`${COL_FLAG}\` may be hidden inside it, so the entry cannot be read honestly.`,
        });
        bad = true;
        continue;
      }
      const key = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isStringLiteral(prop.name)
          ? prop.name.text
          : null;
      if (key === null) {
        findings.push({
          kind: 'structure',
          line: lineOf(prop),
          message: 'registry entry has a computed property key; the entry cannot be read honestly.',
        });
        bad = true;
        continue;
      }
      if (key === 'type') {
        if (!ts.isStringLiteral(prop.initializer)) {
          findings.push({
            kind: 'structure',
            line: lineOf(prop),
            message: '`type` is not a string literal; the entry cannot be read honestly.',
          });
          bad = true;
          continue;
        }
        type = prop.initializer.text;
      } else if (key === COL_FLAG) {
        const kind = prop.initializer.kind;
        if (kind !== ts.SyntaxKind.TrueKeyword && kind !== ts.SyntaxKind.FalseKeyword) {
          findings.push({
            kind: 'structure',
            line: lineOf(prop),
            message:
              `\`${COL_FLAG}\` is not a \`true\`/\`false\` literal (found ` +
              `${ts.SyntaxKind[kind]}); a non-literal flag cannot be compared to a ✅/❌ cell.`,
          });
          bad = true;
          continue;
        }
        flag = kind === ts.SyntaxKind.TrueKeyword;
      }
    }

    if (bad) continue;
    if (type === null) {
      findings.push({
        kind: 'structure',
        line,
        message: 'registry entry declares no `type`; the entry cannot be joined to a table row.',
      });
      continue;
    }
    // `allowOrgOverride` is optional in the schema and defaults to false
    // (see the reference row for MetadataTypeRegistryEntry). An entry that
    // omits it is a legitimate `false`.
    entries.push({ type, allowOrgOverride: flag === true, line });
  }

  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.type)) {
      findings.push({
        kind: 'structure',
        line: e.line,
        message: `registry declares \`${e.type}\` twice (also at :${seen.get(e.type)}).`,
      });
    } else seen.set(e.type, e.line);
  }

  // Vacuity floor. A parse that finds nothing must not read as "nothing to report".
  if (findings.length === 0 && entries.length === 0) {
    findings.push({
      kind: 'structure',
      line: lineOf(array),
      message: `\`${REGISTRY_CONST}\` parsed to ZERO entries — the gate has no input and must not report clean.`,
    });
  }
  if (findings.length === 0 && !entries.some((e) => e.allowOrgOverride)) {
    findings.push({
      kind: 'structure',
      line: lineOf(array),
      message:
        `no entry in \`${REGISTRY_CONST}\` has \`${COL_FLAG}: true\` — leg 2 would be ` +
        `vacuously green. If the whitelist really did empty out, this table (and ADR-0005) ` +
        `need rewriting, not this gate.`,
    });
  }

  return { entries, findings };
}

// ---------------------------------------------------------------------------
// Doc side -- table rows
// ---------------------------------------------------------------------------

/** Split a markdown table line into cells (an escaped `\|` is not a separator). */
export function splitCells(line) {
  const parts = line.trim().split(/(?<!\\)\|/);
  parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map((c) => c.trim());
}

/** Strip markdown emphasis/backticks to compare a header cell by name. */
function headerName(cell) {
  return cell.replace(/[`*_]/g, '').trim();
}

/**
 * Read the whitelist table.
 *
 * @returns {{ rows: Array<{types: string[], allow: boolean, line: number}>,
 *             findings: Array<{kind: string, message: string, line: number}> }}
 */
export function readTable(text) {
  const lines = text.split('\n');
  const findings = [];
  const rows = [];

  const headingIdx = lines.findIndex((l) => l.trim() === HEADING);
  if (headingIdx === -1) {
    findings.push({
      kind: 'structure',
      line: 1,
      message:
        `no \`${HEADING}\` heading in this page. The gate reads the table under that ` +
        `heading; if the section was renamed or moved, re-point this gate — a heading ` +
        `it cannot find must not read as a table with nothing wrong.`,
    });
    return { rows, findings };
  }

  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (ANY_H2.test(lines[i])) {
      end = i;
      break;
    }
  }

  // The first header+divider pair inside the section.
  let headerIdx = -1;
  for (let i = headingIdx + 1; i < end - 1; i++) {
    if (TABLE_LINE.test(lines[i]) && TABLE_DIVIDER.test(lines[i + 1])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    findings.push({
      kind: 'structure',
      line: headingIdx + 1,
      message: `the \`${HEADING}\` section contains no markdown table.`,
    });
    return { rows, findings };
  }

  const header = splitCells(lines[headerIdx]).map(headerName);
  if (header[0] !== COL_TYPE || header[1] !== COL_FLAG) {
    findings.push({
      kind: 'structure',
      line: headerIdx + 1,
      message:
        `table header reads [${header.map((h) => `"${h}"`).join(', ')}]; this gate reads ` +
        `column 0 as "${COL_TYPE}" and column 1 as "${COL_FLAG}". A reordered or renamed ` +
        `column would otherwise be read from the wrong cell, silently.`,
    });
    return { rows, findings };
  }

  for (let i = headerIdx + 2; i < end; i++) {
    const raw = lines[i];
    if (!TABLE_LINE.test(raw)) {
      if (raw.trim() === '') continue;
      break; // the table ended; prose follows
    }
    const cells = splitCells(raw);
    const line = i + 1;
    if (cells.length < 2) {
      findings.push({ kind: 'structure', line, message: 'table row has fewer than two cells.' });
      continue;
    }

    // --- type cell: backticked names ONLY, one or more, comma-separated.
    const cell = cells[0];
    const names = [];
    let m;
    BACKTICKED.lastIndex = 0;
    while ((m = BACKTICKED.exec(cell)) !== null) names.push(m[1].trim());
    const residue = cell.replace(BACKTICKED, '').replace(/[,\s]/g, '');
    if (names.length === 0 || residue !== '') {
      findings.push({
        kind: 'structure',
        line,
        message:
          `type cell ${JSON.stringify(cell)} is not a plain list of backticked type names` +
          (residue === '' ? '.' : ` (leftover text ${JSON.stringify(residue)}).`) +
          ` Prose here would be read as "no types on this row" and the row would pass unchecked.`,
      });
      continue;
    }
    const badName = names.find((n) => !TYPE_NAME.test(n));
    if (badName !== undefined) {
      findings.push({
        kind: 'structure',
        line,
        message: `type cell names \`${badName}\`, which is not a metadata type name.`,
      });
      continue;
    }

    // --- verdict cell: exactly ✅ or ❌.
    const verdict = cells[1];
    if (verdict !== YES && verdict !== NO) {
      findings.push({
        kind: 'structure',
        line,
        message:
          `\`${COL_FLAG}\` cell is ${JSON.stringify(verdict)}; it must be exactly ` +
          `"${YES}" or "${NO}". A qualified verdict ("${YES} (mostly)") is a fact this ` +
          `gate cannot compare to a boolean.`,
      });
      continue;
    }

    rows.push({ types: names, allow: verdict === YES, line });
  }

  if (findings.length === 0 && rows.length === 0) {
    findings.push({
      kind: 'structure',
      line: headerIdx + 1,
      message: 'the whitelist table parsed to ZERO rows — the gate has no input and must not report clean.',
    });
  }

  return { rows, findings };
}

// ---------------------------------------------------------------------------
// The two legs
// ---------------------------------------------------------------------------

/**
 * @returns {{ leg1: Array<object>, leg2: Array<object>, tableTypes: Map<string, object> }}
 */
export function compare(entries, rows) {
  const registry = new Map(entries.map((e) => [e.type, e]));
  const tableTypes = new Map();
  const leg1 = [];
  const leg2 = [];

  for (const row of rows) {
    for (const type of row.types) {
      if (tableTypes.has(type)) {
        leg1.push({
          kind: 'duplicate',
          type,
          line: row.line,
          message:
            `\`${type}\` is listed twice in the table (also at :${tableTypes.get(type).line}) — ` +
            `two rows can disagree, and a reader has no way to know which is authoritative.`,
        });
        continue;
      }
      tableTypes.set(type, row);

      const entry = registry.get(type);
      if (entry === undefined) {
        leg1.push({
          kind: 'unknown-type',
          type,
          line: row.line,
          message:
            `the table lists \`${type}\`, which \`${REGISTRY_CONST}\` does not declare — ` +
            `either the type was retired and the row outlived it, or the name is misspelt.`,
        });
        continue;
      }
      if (entry.allowOrgOverride !== row.allow) {
        leg1.push({
          kind: 'mismatch',
          type,
          line: row.line,
          message:
            `the table says \`${type}\` is ${row.allow ? YES : NO}, the registry declares ` +
            `\`${COL_FLAG}: ${entry.allowOrgOverride}\` (${REGISTRY_FILE}:${entry.line}).`,
        });
      }
    }
  }

  for (const entry of entries) {
    if (entry.allowOrgOverride && !tableTypes.has(entry.type)) {
      leg2.push({
        kind: 'missing-row',
        type: entry.type,
        line: entry.line,
        message:
          `\`${entry.type}\` is \`${COL_FLAG}: true\` (${REGISTRY_FILE}:${entry.line}) and is ` +
          `named nowhere in the table — an overridable type the whitelist page does not ` +
          `disclose. This is the direction a table→registry gate cannot see.`,
      });
    }
  }

  return { leg1, leg2, tableTypes };
}

// ---------------------------------------------------------------------------
// Self-test -- the non-vacuity battery
// ---------------------------------------------------------------------------

/**
 * A registry fixture that reproduces every shape the real file has, INCLUDING
 * the multi-line entry that defeats a same-line regex and the comment lines
 * that inflate a naive `grep -c`.
 */
const FIXTURE_REGISTRY = `
export const ${REGISTRY_CONST}: MetadataTypeRegistryEntryParsed[] = [
  // Pure rendering. ${COL_FLAG}: true is safe here — this comment is PROSE and
  // must not be counted as an entry (${COL_FLAG}: true appears twice in it).
  { type: 'view', label: 'View', supportsOverlay: true, ${COL_FLAG}: true, loadOrder: 50 },
  { type: 'dashboard', label: 'Dashboard', supportsOverlay: true, ${COL_FLAG}: true, loadOrder: 60 },
  { type: 'report', label: 'Report', supportsOverlay: true, ${COL_FLAG}: true, loadOrder: 60 },
  { type: 'translation', label: 'Translation', supportsOverlay: true, ${COL_FLAG}: true, loadOrder: 90 },
  { type: 'email_template', label: 'Email Template', supportsOverlay: true, ${COL_FLAG}: true, loadOrder: 85 },
  // Rolled back (#6283): ${COL_FLAG}: false, and this line is a comment too.
  { type: 'flow', label: 'Flow', supportsOverlay: false, ${COL_FLAG}: false, loadOrder: 80 },
  { type: 'permission', label: 'Permission Set', supportsOverlay: true, ${COL_FLAG}: false, loadOrder: 15 },
  { type: 'position', label: 'Position', supportsOverlay: true, ${COL_FLAG}: false, loadOrder: 15 },
  { type: 'agent', label: 'AI Agent', supportsOverlay: false, ${COL_FLAG}: false, loadOrder: 90 },
  { type: 'object', label: 'Object', supportsOverlay: false, ${COL_FLAG}: false, loadOrder: 10 },
  { type: 'field', label: 'Field', supportsOverlay: false, ${COL_FLAG}: false, loadOrder: 20 },
  // Declared by the registry, deliberately NOT named in the table fixture: the
  // table is a whitelist, so leg 2 must not demand a row for a false type.
  { type: 'hook', label: 'Hook', supportsOverlay: false, ${COL_FLAG}: false, loadOrder: 30 },
  { type: 'job', label: 'Background Job', supportsOverlay: false, ${COL_FLAG}: false, loadOrder: 80 },
  // THE SHAPE A REGEX MISSES: opens \`{\` on its own line, so \`type:\` and
  // \`${COL_FLAG}:\` land on separate lines from the brace.
  {
    type: 'datasource',
    label: 'Datasource',
    supportsOverlay: false,
    ${COL_FLAG}: false,
    loadOrder: 5,
  },
];
`;

/** The table as it stood BEFORE #11750 — the ready-made positive control. */
const FIXTURE_TABLE_BEFORE = `
${HEADING}

Prose above the table.

| Type | \`${COL_FLAG}\` | Rationale |
| :--- | :---: | :--- |
| \`view\`, \`dashboard\`, \`report\`, \`email_template\` | ${YES} | Pure rendering. |
| \`flow\` | ${YES} | Per-org overlays are allowed for automation definitions. |
| \`agent\` | ${NO} | Platform-owned (ADR-0063 §2). |
| \`permission\`, \`position\` | ${YES} | Tenant-level controls layer on top. |
| \`object\` | ${NO} | Defines the table schema. |
| \`field\` | ${NO} | Authored inside the object. |
| \`datasource\` | ${NO} | Connection strings. |
| \`job\` | ${NO} | Handler lives in the compiled bundle. |

Prose after the table.

## Next section
`;

/** The table as #11750 left it. */
const FIXTURE_TABLE_AFTER = FIXTURE_TABLE_BEFORE.replace(
  `| \`view\`, \`dashboard\`, \`report\`, \`email_template\` | ${YES} |`,
  `| \`view\`, \`dashboard\`, \`report\`, \`email_template\`, \`translation\` | ${YES} |`,
)
  .replace(`| \`flow\` | ${YES} |`, `| \`flow\` | ${NO} |`)
  .replace(`| \`permission\`, \`position\` | ${YES} |`, `| \`permission\`, \`position\` | ${NO} |`);

function run(registryText, tableText) {
  const reg = readRegistry(registryText, 'fixture.ts');
  const tab = readTable(tableText);
  if (reg.findings.length || tab.findings.length) {
    return { structure: [...reg.findings, ...tab.findings], leg1: [], leg2: [], entries: reg.entries };
  }
  const { leg1, leg2 } = compare(reg.entries, tab.rows);
  return { structure: [], leg1, leg2, entries: reg.entries, rows: tab.rows };
}

export function selfTest() {
  const failures = [];
  const check = (name, ok, detail = '') => {
    if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  };

  // ---- 1. THE POSITIVE CONTROL: the pre-#11750 table must produce exactly 4.
  const before = run(FIXTURE_REGISTRY, FIXTURE_TABLE_BEFORE);
  check('before/structure-clean', before.structure.length === 0, JSON.stringify(before.structure));
  const beforeTotal = before.leg1.length + before.leg2.length;
  check('before/total=4', beforeTotal === 4, `got ${beforeTotal}`);
  check('before/leg1=3', before.leg1.length === 3, `got ${before.leg1.length}`);
  check('before/leg2=1', before.leg2.length === 1, `got ${before.leg2.length}`);
  const beforeL1 = before.leg1.map((f) => `${f.kind}:${f.type}`).sort();
  check(
    'before/leg1 names flow,permission,position as mismatches',
    JSON.stringify(beforeL1) ===
      JSON.stringify(['mismatch:flow', 'mismatch:permission', 'mismatch:position']),
    JSON.stringify(beforeL1),
  );
  check(
    'before/leg2 names translation as the omission',
    before.leg2.length === 1 &&
      before.leg2[0].type === 'translation' &&
      before.leg2[0].kind === 'missing-row',
    JSON.stringify(before.leg2.map((f) => `${f.kind}:${f.type}`)),
  );

  // ---- 2. The corrected table must be green on BOTH legs.
  const after = run(FIXTURE_REGISTRY, FIXTURE_TABLE_AFTER);
  check('after/structure-clean', after.structure.length === 0, JSON.stringify(after.structure));
  check('after/leg1=0', after.leg1.length === 0, JSON.stringify(after.leg1));
  check('after/leg2=0', after.leg2.length === 0, JSON.stringify(after.leg2));

  // ---- 3. A ONE-LEGGED gate would have shipped 3 of the 4. Pinned so that
  //         deleting leg 2 cannot pass this battery.
  check('leg2 is load-bearing (3 != 4)', before.leg1.length !== beforeTotal);

  // ---- 4. AST vs REGEX on the fixture: the numbers must differ, in the
  //         direction the header documents.
  const regexEntryCount = (FIXTURE_REGISTRY.match(/^ {2}\{ type: '/gm) || []).length;
  const astEntryCount = before.entries.length;
  check('fixture/ast=14', astEntryCount === 14, `got ${astEntryCount}`);
  check(
    'fixture/regex under-reads by exactly the multi-line entry',
    regexEntryCount === astEntryCount - 1,
    `regex ${regexEntryCount}, ast ${astEntryCount}`,
  );
  check(
    'fixture/AST reads the multi-line `datasource` entry',
    before.entries.some((e) => e.type === 'datasource' && e.allowOrgOverride === false),
  );

  // ---- 5. Comments are not entries. `grep -c` over the fixture inflates both
  //         flags; the AST count must be the smaller, correct one.
  const grepTrue = (FIXTURE_REGISTRY.match(new RegExp(`${COL_FLAG}: true`, 'g')) || []).length;
  const astTrue = before.entries.filter((e) => e.allowOrgOverride).length;
  check('fixture/ast true-set = 5', astTrue === 5, `got ${astTrue}`);
  check(
    'fixture/grep over-counts true because of comment prose',
    grepTrue > astTrue,
    `grep ${grepTrue}, ast ${astTrue}`,
  );

  // ---- 6. MULTI-TYPE CELL control: five names in one cell become five types.
  const multi = readTable(FIXTURE_TABLE_AFTER);
  const rowWith5 = multi.rows.find((r) => r.types.length === 5);
  check(
    'multi-type cell yields 5 separate types',
    rowWith5 !== undefined &&
      JSON.stringify(rowWith5.types) ===
        JSON.stringify(['view', 'dashboard', 'report', 'email_template', 'translation']),
    JSON.stringify(rowWith5 && rowWith5.types),
  );
  const flatCount = multi.rows.reduce((n, r) => n + r.types.length, 0);
  check('after/table names 13 types across 8 rows', flatCount === 13 && multi.rows.length === 8,
    `${flatCount} types / ${multi.rows.length} rows`);

  // ---- 7. A mismatch inside a MULTI-TYPE cell is caught per type, not per row.
  const oneWrongInCell = FIXTURE_TABLE_AFTER.replace(
    `| \`view\`, \`dashboard\`, \`report\`, \`email_template\`, \`translation\` | ${YES} |`,
    `| \`view\`, \`dashboard\`, \`report\`, \`email_template\`, \`translation\`, \`hook\` | ${YES} |`,
  );
  const cellRes = run(FIXTURE_REGISTRY, oneWrongInCell);
  check(
    'a wrong type inside a 6-name cell is caught, per type not per row',
    cellRes.leg1.length === 1 && cellRes.leg1[0].kind === 'mismatch' && cellRes.leg1[0].type === 'hook',
    JSON.stringify(cellRes.leg1.map((f) => `${f.kind}:${f.type}`)),
  );

  // ---- 8. STRUCTURAL refusals. Each must be RED, none may read as clean.
  const structural = [
    ['renamed heading', FIXTURE_TABLE_AFTER.replace(HEADING, '## Overlay whitelist')],
    ['no table', `${HEADING}\n\nJust prose now.\n\n## Next\n`],
    [
      'swapped columns',
      FIXTURE_TABLE_AFTER.replace(`| Type | \`${COL_FLAG}\` | Rationale |`, `| \`${COL_FLAG}\` | Type | Rationale |`),
    ],
    [
      'renamed column',
      FIXTURE_TABLE_AFTER.replace(`| Type | \`${COL_FLAG}\` | Rationale |`, `| Type | \`overridable\` | Rationale |`),
    ],
    ['qualified verdict', FIXTURE_TABLE_AFTER.replace(`| \`agent\` | ${NO} |`, `| \`agent\` | ${NO} (mostly) |`)],
    ['prose in type cell', FIXTURE_TABLE_AFTER.replace('| `agent` |', '| everything else |')],
    ['non-type name in cell', FIXTURE_TABLE_AFTER.replace('| `agent` |', '| `Agent Type` |')],
  ];
  for (const [name, text] of structural) {
    const res = readTable(text);
    check(`structure/${name} is refused`, res.findings.length > 0, 'read clean');
  }

  // ---- 9. REGISTRY structural refusals -- the route-around clause.
  const registryStructural = [
    ['spread element', FIXTURE_REGISTRY.replace("  { type: 'agent'", '  ...EXTRA_ENTRIES,\n  { type: \'agent\'')],
    [
      'non-literal flag',
      FIXTURE_REGISTRY.replace(`{ type: 'agent', label: 'AI Agent', supportsOverlay: false, ${COL_FLAG}: false`,
        `{ type: 'agent', label: 'AI Agent', supportsOverlay: false, ${COL_FLAG}: AGENT_OVERRIDE`),
    ],
    [
      'computed type value',
      FIXTURE_REGISTRY.replace("{ type: 'agent'", '{ type: TYPES.agent'),
    ],
    ['not an array', `export const ${REGISTRY_CONST}: X[] = buildRegistry();`],
    ['no declaration', 'export const SOMETHING_ELSE = [];'],
    ['empty array', `export const ${REGISTRY_CONST}: X[] = [];`],
    [
      'no true-set left',
      FIXTURE_REGISTRY.replace(new RegExp(`${COL_FLAG}: true`, 'g'), `${COL_FLAG}: false`),
    ],
  ];
  for (const [name, text] of registryStructural) {
    const res = readRegistry(text, 'fixture.ts');
    check(`registry/${name} is refused`, res.findings.length > 0, 'read clean');
  }

  // ---- 10. A duplicated type in the table is caught.
  const dup = run(
    FIXTURE_REGISTRY,
    FIXTURE_TABLE_AFTER.replace(`| \`job\` | ${NO} |`, `| \`job\` | ${NO} |\n| \`job\` | ${NO} |`),
  );
  check(
    'duplicate table row is caught',
    dup.leg1.some((f) => f.kind === 'duplicate' && f.type === 'job'),
    JSON.stringify(dup.leg1.map((f) => f.kind)),
  );

  // ---- 11. A retired type left behind in the table is caught.
  const retired = run(FIXTURE_REGISTRY, FIXTURE_TABLE_AFTER.replace('| `job` |', '| `validation` |'));
  check(
    'a table row for an undeclared type is caught',
    retired.leg1.some((f) => f.kind === 'unknown-type' && f.type === 'validation'),
    JSON.stringify(retired.leg1.map((f) => `${f.kind}:${f.type}`)),
  );

  // ---- 12. An entry that OMITS the optional flag counts as false, not as a
  //          structural refusal (the schema's documented default).
  const omitted = readRegistry(
    FIXTURE_REGISTRY.replace(`{ type: 'agent', label: 'AI Agent', supportsOverlay: false, ${COL_FLAG}: false, loadOrder: 90 }`,
      `{ type: 'agent', label: 'AI Agent', supportsOverlay: false, loadOrder: 90 }`),
    'fixture.ts',
  );
  check('omitted flag defaults to false', omitted.findings.length === 0 &&
    omitted.entries.some((e) => e.type === 'agent' && e.allowOrgOverride === false),
    JSON.stringify(omitted.findings));

  if (failures.length > 0) {
    console.error('\n✗ check-overlay-whitelist-table self-test failed:\n');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    process.exit(1);
  }
  console.log(
    '✓ check-overlay-whitelist-table self-test: positive control reproduces the 4 known ' +
      'divergences (leg 1: flow, permission, position; leg 2: translation), the corrected ' +
      'table is green on both legs, and 21 structural/parser cases are refused.',
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const registryText = readFileSync(join(ROOT, REGISTRY_FILE), 'utf8');
  const docText = readFileSync(join(ROOT, DOC_FILE), 'utf8');

  const reg = readRegistry(registryText);
  const tab = readTable(docText);

  const structural = [
    ...reg.findings.map((f) => ({ ...f, file: REGISTRY_FILE })),
    ...tab.findings.map((f) => ({ ...f, file: DOC_FILE })),
  ];

  if (structural.length > 0) {
    console.error('\n✗ the overlay whitelist could not be READ — refusing to report a verdict:\n');
    for (const f of structural) console.error(`  ${f.file}:${f.line}  [${f.kind}] ${f.message}`);
    console.error(
      '\nA gate that cannot read its input must not print a clean line: that is exactly\n' +
        'the failure this gate exists to prevent, one level up. Re-point the gate, or\n' +
        'restore the shape it reads.\n',
    );
    process.exit(1);
  }

  const { leg1, leg2, tableTypes } = compare(reg.entries, tab.rows);
  const trueSet = reg.entries.filter((e) => e.allowOrgOverride).map((e) => e.type);

  if (process.argv.includes('--list')) {
    console.log(`${REGISTRY_FILE} — ${reg.entries.length} types, ${trueSet.length} overridable:\n`);
    for (const e of reg.entries.slice().sort((a, b) => a.type.localeCompare(b.type))) {
      const row = tableTypes.get(e.type);
      console.log(
        `  ${(e.allowOrgOverride ? YES : NO)}  ${e.type.padEnd(20)} ` +
          `registry:${String(e.line).padEnd(5)} ` +
          `${row ? `table:${row.line}` : 'table: (not listed)'}`,
      );
    }
    console.log('');
  }

  if (leg1.length === 0 && leg2.length === 0) {
    console.log(
      `✓ ${DOC_FILE}: the overlay whitelist table agrees with ${REGISTRY_CONST} in both ` +
        `directions — leg 1 (table → registry) 0 divergence(s) over ` +
        `${tableTypes.size} type(s) named in ${tab.rows.length} row(s); leg 2 ` +
        `(registry → table) 0 divergence(s) over ${trueSet.length} \`${COL_FLAG}: true\` ` +
        `type(s) [${trueSet.join(', ')}] out of ${reg.entries.length} declared.`,
    );
    return;
  }

  console.error(`\n✗ ${DOC_FILE} — the overlay whitelist table disagrees with ${REGISTRY_CONST}:\n`);
  console.error(`  LEG 1  table → registry: ${leg1.length} divergence(s)`);
  for (const f of leg1) console.error(`    ${DOC_FILE}:${f.line}  [${f.kind}] ${f.message}`);
  console.error(`\n  LEG 2  registry → table: ${leg2.length} divergence(s)`);
  for (const f of leg2) console.error(`    ${REGISTRY_FILE}:${f.line}  [${f.kind}] ${f.message}`);
  console.error(`
VERDICT: ${leg1.length + leg2.length} DIVERGENCE(S)

⛔ Fix the TABLE, not the registry. \`${REGISTRY_CONST}\` is the single
   machine-readable whitelist and the page says so in its own first sentence.
   Flipping a flag there to make this gate green is an ADR-0005 whitelist
   CHANGE — it requires the ADR revised, not a file edit
   (scripts/adr-anchors/packages__spec__src__kernel__metadata-plugin.zod.ts.json).
   A gate "fixed" by editing the thing it measures has inverted its own point.

   leg 1 [mismatch]      the row's ${YES}/${NO} contradicts the registry -> correct the cell.
   leg 1 [unknown-type]  the table names a type the registry does not declare ->
                         the type was retired and the row outlived it, or it is misspelt.
   leg 1 [duplicate]     the same type is listed on two rows -> keep one.
   leg 2 [missing-row]   an overridable type the table never names -> add it. This is
                         the \`translation\` shape from #11664: invisible to any gate
                         that only checks the rows it can see.
`);
  process.exit(1);
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  main();
}
