#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * isystem-census -- the committed enumeration of every `ExecutionContext.isSystem`
 * READ in non-test sources.
 *
 *   node scripts/isystem-census.mjs            # human summary
 *   node scripts/isystem-census.mjs --json     # the whole census, machine-readable
 *
 * `content/docs/permissions/system-context.mdx` calls itself "the authority" and
 * says it is "built by census over the whole repo, not by recall". This file is
 * that census, made re-runnable, so the page's claim has an instrument behind it
 * instead of a person's afternoon. `check-system-context-census.mjs` is the gate
 * that holds the page to what this reports.
 *
 * ## ⛔ Why this is an AST walk and not a regex, measured rather than asserted
 *
 * A regex pass over the same corpus **silently lost 6 real read sites** in
 * `packages/plugins/plugin-reports/src/report-service.ts` to a quote desync -- an
 * apostrophe inside a comment put the scanner inside a string literal for the rest
 * of the file -- and 11 more to `(ctx?.session as any)?.isSystem` casts, which do
 * not match a receiver-shaped pattern. Both losses are SILENT: fewer findings, a
 * clean exit, a smaller number that reads exactly like a smaller truth.
 *
 * A gate seeded from that reading would be worse than no gate. It would publish a
 * baseline that is wrong in the one direction this page cannot survive -- claiming
 * the census is complete when it is short -- and then hold the page to it.
 *
 * ## What counts as a read, and the two ways a count goes wrong
 *
 * The identifier `isSystem` appears in sources in five syntactic roles, and only
 * one of them is a read. Counting the identifier gives ~810; counting lines that
 * match `isSystem` gives ~795; the census is the ~115 property reads inside them.
 * A count that has not been DECOMPOSED cannot be compared to anything, which is
 * why `--json` reports every role and not just the answer.
 *
 * The second way is the collision. FOUR unrelated declarations share the
 * identifier -- `ExecutionContext.isSystem` (the elevation flag, what this census
 * is about), plus `Object.isSystem`, `EmailTemplate.isSystem` and
 * `Environment.isSystem`, all ordinary metadata fields on a stored document. A
 * census that does not subtract those over-reports.
 *
 * ## How the subtraction is spelled, and why it carries no line numbers
 *
 * `NON_ELEVATION_READS` below is keyed by (file, receiver expression). It is
 * deliberately NOT keyed by line: a ledger of line numbers rots exactly like the
 * page anchors this whole mechanism exists to stop rotting, and it rots
 * invisibly, because a stale entry subtracts a site that is still there.
 *
 * The default is the SAFE direction. An unrecognised receiver is counted as an
 * elevation read, so a new metadata-field read shows up as a site the page is
 * missing -- loud, and fixed by one ledger line. The reverse default would drop
 * real elevation sites in silence.
 *
 * A ledger row that matches nothing is an ERROR, not a shrug: the row's reason has
 * expired and the next reader would take it for a live exclusion.
 *
 * ## Population
 *
 * `packages/` and `examples/`, tracked files only, `.ts` / `.tsx` / `.mts` / `.cts`,
 * excluding `dist/` and tests. A file counts as a test when its path carries
 * `.test.` / `.spec.` or a `tests/` / `__tests__/` / `qa/` segment -- the same rule
 * the page states, so the page and the instrument cannot disagree about what was
 * counted.
 *
 * Every unread state is a refusal rather than a quiet pass: a corpus that resolves
 * to zero files, a source that cannot be read, or a source that does not parse
 * (`ts-parse.mjs` refuses -- a file a gate could not read must never be scored as a
 * file with nothing to report).
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';
import { parseSourceFile } from './ts-parse.mjs';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The identifier the census is about. */
export const FLAG = 'isSystem';

/**
 * ⛔ SHRINK-ONLY, and keyed by (file, receiver) -- never by line.
 *
 * Reads of `isSystem` that are NOT reads of the elevation flag. Each row names the
 * declaration it really reads, so the collision is documented where it is applied.
 * A row that matches no read in the tree FAILS: it has outlived its reason.
 */
export const NON_ELEVATION_READS = [
  {
    file: 'packages/lint/src/validate-security-posture.ts',
    receiver: 'obj',
    field: 'Object.isSystem',
    why: 'linting an object definition: a system OBJECT, not an elevated operation',
  },
  {
    file: 'packages/lint/src/validate-sharing-rule-enforceability.ts',
    receiver: 'obj',
    field: 'Object.isSystem',
    why: 'same object-definition lint, sharing-rule side',
  },
  {
    file: 'packages/plugins/plugin-email/src/bootstrap-declared-email-templates.ts',
    receiver: 'tpl',
    field: 'EmailTemplate.isSystem',
    why: 'copies the built-in-template marker onto the stored row',
  },
  {
    file: 'packages/plugins/plugin-security/src/explain-engine.ts',
    receiver: 'schema',
    field: 'Object.isSystem',
    why: 'object schema under explain(), paired with the `sys_` name-prefix test',
  },
  {
    file: 'packages/plugins/plugin-sharing/src/sharing-service.ts',
    receiver: 'schema',
    field: 'Object.isSystem',
    why: 'object schema, paired with the `sys_` name-prefix test',
  },
  {
    file: 'packages/runtime/src/system-environment-plugin.ts',
    receiver: 'result.project',
    field: 'Environment.isSystem',
    why: 'platform-infrastructure environment marker',
  },
];

/** A file counts as a test by PATH, the same rule the page publishes. */
export function isTestPath(relPath) {
  return /\.(test|spec)\./.test(relPath) || /(^|\/)(tests|__tests__|qa)\//.test(relPath);
}

/** Every tracked, non-dist TypeScript file of the corpus -- tests included. */
export function collectCorpus(root = ROOT) {
  return execFileSync('git', ['-C', root, 'ls-files', 'packages', 'examples'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mts|cts)$/.test(f) && !f.includes('/dist/'));
}

/** Tracked, non-test, non-dist TypeScript under `packages/` and `examples/`. */
export function collectSources(root = ROOT) {
  const sources = collectCorpus(root).filter((f) => !isTestPath(f));
  if (sources.length === 0) {
    throw new Error(
      'isystem-census: the corpus resolved to ZERO source files -- refusing to report a census ' +
        'over nothing (a walk that found nothing and a tree with nothing to find are different).'
    );
  }
  return sources;
}

/** The package directory a source belongs to, by nearest `package.json`. */
export function packageOf(relPath, root = ROOT) {
  let dir = dirname(join(root, relPath));
  while (dir.length > root.length) {
    if (existsSync(join(dir, 'package.json'))) return dir.slice(root.length + 1);
    dir = dirname(dir);
  }
  return null;
}

/**
 * Every syntactic role the identifier takes in one parsed source.
 *
 * @returns {{ role: string, line: number, receiver: string|null, text: string }[]}
 */
export function classifyFile(relPath, text) {
  const sourceFile = parseSourceFile(relPath, text);
  const lines = text.split('\n');
  /** @type {{ role: string, line: number, receiver: string|null, text: string }[]} */
  const found = [];

  const record = (node, role, receiver) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ role, line: line + 1, receiver, text: (lines[line] ?? '').trim() });
  };

  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === FLAG) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        record(node, 'read', parent.expression.getText(sourceFile).replace(/\s+/g, ' '));
      } else if (
        ts.isPropertySignature(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isEnumMember(parent)
      ) {
        record(node, 'declaration', null);
      } else if (
        ts.isPropertyAssignment(parent) ||
        ts.isShorthandPropertyAssignment(parent) ||
        ts.isBindingElement(parent)
      ) {
        record(node, 'key', null);
      } else {
        record(node, 'other', null);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** True when this read is subtracted by a `NON_ELEVATION_READS` row. */
function nonElevationRowFor(relPath, receiver) {
  return NON_ELEVATION_READS.find((r) => r.file === relPath && r.receiver === receiver) ?? null;
}

/**
 * Run the census.
 *
 * @returns {{
 *   sites: { file: string, line: number, receiver: string, package: string|null }[],
 *   nonElevationReads: { file: string, line: number, receiver: string, field: string }[],
 *   roleCounts: Record<string, number>,
 *   packages: string[],
 *   files: string[],
 *   staleLedgerRows: typeof NON_ELEVATION_READS,
 *   scannedFiles: number,
 * }}
 */
export function runCensus({ root = ROOT } = {}) {
  const sources = collectSources(root);
  const sites = [];
  const nonElevationReads = [];
  const roleCounts = { read: 0, declaration: 0, key: 0, other: 0 };
  const usedRows = new Set();
  let scannedFiles = 0;

  for (const relPath of sources) {
    let text;
    try {
      text = readFileSync(join(root, relPath), 'utf8');
    } catch (error) {
      throw new Error(`isystem-census: cannot read ${relPath} -- ${error.message}`);
    }
    if (!text.includes(FLAG)) continue;
    scannedFiles += 1;
    for (const hit of classifyFile(relPath, text)) {
      roleCounts[hit.role] = (roleCounts[hit.role] ?? 0) + 1;
      if (hit.role !== 'read') continue;
      const row = nonElevationRowFor(relPath, hit.receiver);
      if (row) {
        usedRows.add(row);
        nonElevationReads.push({
          file: relPath,
          line: hit.line,
          receiver: hit.receiver,
          field: row.field,
        });
        continue;
      }
      sites.push({
        file: relPath,
        line: hit.line,
        receiver: hit.receiver,
        package: packageOf(relPath, root),
        text: hit.text,
      });
    }
  }

  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const text = countText(root);
  const classified = roleCounts.read + roleCounts.declaration + roleCounts.key + roleCounts.other;
  return {
    text: { ...text, classified, inCommentsAndStrings: text.identifierAppearances - classified },
    sites,
    nonElevationReads,
    roleCounts,
    packages: [...new Set(sites.map((s) => s.package))].filter(Boolean).sort(),
    files: [...new Set(sites.map((s) => s.file))].sort(),
    staleLedgerRows: NON_ELEVATION_READS.filter((r) => !usedRows.has(r)),
    scannedFiles,
  };
}

/**
 * The TEXT counts, decomposed.
 *
 * The page's own advice, learned the expensive way: `grep -c` over the previous
 * edition answered 64 anchors where there were 111, because it counts LINES
 * CARRYING a match rather than matches. So every number here says which of the
 * three things it counts -- lines, identifier appearances, or syntactic roles --
 * and the page quotes them with the same wording.
 */
export function countText(root = ROOT) {
  const corpus = collectCorpus(root);
  const IDENT = /\bisSystem\b/g;
  let linesTotal = 0;
  let linesInTests = 0;
  let identifierAppearances = 0;
  for (const relPath of corpus) {
    const body = readFileSync(join(root, relPath), 'utf8');
    if (!body.includes(FLAG)) continue;
    const hits = body.split('\n').filter((l) => l.includes(FLAG)).length;
    linesTotal += hits;
    if (isTestPath(relPath)) linesInTests += hits;
    else identifierAppearances += (body.match(IDENT) ?? []).length;
  }
  return {
    corpusFiles: corpus.length,
    linesTotal,
    linesInTests,
    linesInSources: linesTotal - linesInTests,
    identifierAppearances,
  };
}

/** `file:line` keys for the elevation sites -- the census's comparable form. */
export function siteKeys(census) {
  return new Set(census.sites.map((s) => `${s.file}:${s.line}`));
}

function main(argv) {
  const census = runCensus();
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(census, null, 2)}\n`);
    return census.staleLedgerRows.length === 0 ? 0 : 1;
  }
  const roles = Object.entries(census.roleCounts)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  process.stdout.write(
    [
      `isystem-census: ${census.sites.length} ExecutionContext.isSystem read sites`,
      `  packages ${census.packages.length} · files ${census.files.length}`,
      `  identifier roles: ${roles}`,
      `  subtracted as unrelated metadata fields: ${census.nonElevationReads.length}`,
      `  sources scanned that mention the flag: ${census.scannedFiles}`,
      `  text: lines ${census.text.linesTotal} (tests ${census.text.linesInTests}, ` +
        `sources ${census.text.linesInSources}) · identifier appearances in sources ` +
        `${census.text.identifierAppearances} · in comments/strings ${census.text.inCommentsAndStrings}`,
      '',
    ].join('\n')
  );
  for (const row of census.staleLedgerRows) {
    process.stderr.write(
      `::error::[stale-ledger-row] NON_ELEVATION_READS names ${row.file} (receiver ` +
        `\`${row.receiver}\`) but no such read exists -- delete the row.\n`
    );
  }
  return census.staleLedgerRows.length === 0 ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
