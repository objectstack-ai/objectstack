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

import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);

import { isEntrypoint } from './invoked-as.mjs';
import { symbolResolutionClass } from './symbol-anchors.mjs';
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

/**
 * The subtrees this census walks -- the REAL population of every number it
 * reports and of the gate that holds the page to them.
 *
 * Named rather than spelled inline because a second reader needs it: the gate
 * declares this population to the dispatch derivation, and a declaration that
 * can drift from the walk is worse than none. `check-system-context-census.mjs`
 * derives its `ROOT_DIR_WATCH_HINTS` from this constant in both directions, so
 * a root added or removed here reddens that gate's self-test instead of quietly
 * widening the census past what any card is told about.
 */
export const CORPUS_ROOTS = ['packages', 'examples'];

/** Every tracked, non-dist TypeScript file of the corpus -- tests included. */
export function collectCorpus(root = ROOT) {
  return execFileSync('git', ['-C', root, 'ls-files', ...CORPUS_ROOTS], {
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
 * ── Where a read LIVES, named so an anchor can survive a line shift (#15921) ──
 *
 * The page used to anchor a read by `file:line`, and a line number rots on every
 * unrelated edit above it. It now anchors `path#symbol`, so the census has to
 * answer a second question about each site: WHICH DECLARATION encloses it.
 *
 * ## The rule, and why it is the OUTERMOST function-like scope
 *
 * A site sits inside a stack of named things -- a local arrow, the method that
 * built it, the class the method is on. The innermost name is the most precise
 * and the WORST anchor: locals are called `handler`, `context` and `isSystem`,
 * they are renamed by refactors that change no behaviour, and several of them
 * per file are indistinguishable to a reader who opens the file looking for the
 * row. Measured over this corpus, the innermost rule picked `handler`,
 * `session`, `permitted`, `context` and -- for the getter on the engine's
 * context wrapper -- the string `isSystem` itself.
 *
 * So the answer is the OUTERMOST function-like scope: the module-level function,
 * or the class member (a class is not function-like, so a method stops the walk
 * at itself rather than collapsing every method onto the class name). That is the
 * declaration a reader greps for, and the one a rename has to move.
 *
 * ⭐ The chosen name is only accepted when the SHARED resolver would resolve it
 * -- `symbolResolutionClass(...) === 'declaration'`, the same predicate
 * `scripts/check-adr-symbol-anchors.mjs` sweeps with. A census that named a
 * symbol the gate's resolver cannot bind would publish a population the page can
 * never satisfy, which is the one failure mode a population check cannot survive.
 *
 * ## The fallbacks, in order, and the honest bottom
 *
 *   1. the outermost function-like named scope that resolves;
 *   2. failing that, the innermost enclosing named declaration that resolves
 *      (a class, an interface, a `const` binding -- a read at module top level);
 *   3. failing that, `null` -- and `null` is NOT an error and NOT a guess. It
 *      means no declaration in that file can be named, and the page anchors the
 *      FILE. A file-level anchor stays checked (the file must exist) and it is
 *      the one honest answer when there is no symbol; ⛔ inventing one would put
 *      a name in the page that no rename can ever red.
 *
 * ⚠️ What this costs, stated where it is derived: several sites inside ONE symbol
 * collapse onto ONE anchor. `check-system-context-census.mjs` carries the
 * measurement and the consequence for what the gate can and cannot catch.
 */
function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  );
}

/** The name a node declares, or `null` when it declares none this census can cite. */
function declaredName(node, sourceFile) {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return node.name && ts.isIdentifier(node.name) ? node.name.text : null;
  }
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const name = node.name;
    return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null;
  }
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
    const name = node.name;
    return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null;
  }
  return null;
}

/**
 * The symbol a page anchor should name for a node, by the rule documented above.
 *
 * @param {import('typescript').Node} node
 * @param {import('typescript').SourceFile} sourceFile
 * @param {string} relPath
 * @param {string} text  the target's own source, for the resolver
 * @returns {string|null}
 */
export function enclosingSymbol(node, sourceFile, relPath, text) {
  const functionLike = [];
  const anyNamed = [];
  for (let p = node.parent; p; p = p.parent) {
    const name = declaredName(p, sourceFile);
    if (name === null) continue;
    anyNamed.push(name);
    /* A function or arrow bound to a name is function-like scope under the name
     * it is bound to -- so the walk records the BINDING's name, not the anonymous
     * expression's absence of one. */
    if (isFunctionLike(p) || (p.initializer !== undefined && p.initializer !== null && isFunctionLike(p.initializer))) {
      functionLike.push(name);
    }
  }
  const resolves = (name) => symbolResolutionClass(text, relPath, name) === 'declaration';
  for (let i = functionLike.length - 1; i >= 0; i -= 1) {
    if (resolves(functionLike[i])) return functionLike[i];
  }
  for (const name of anyNamed) {
    if (resolves(name)) return name;
  }
  return null;
}

/**
 * Every syntactic role the identifier takes in one parsed source.
 *
 * @returns {{ role: string, line: number, receiver: string|null, text: string,
 *             symbol: string|null }[]}
 */
export function classifyFile(relPath, text) {
  const sourceFile = parseSourceFile(relPath, text);
  const lines = text.split('\n');
  /** @type {{ role: string, line: number, receiver: string|null, text: string,
   *           symbol: string|null }[]} */
  const found = [];

  const record = (node, role, receiver) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({
      role,
      line: line + 1,
      receiver,
      text: (lines[line] ?? '').trim(),
      /* Only a READ is ever anchored, so only a read pays the ancestor walk. */
      symbol: role === 'read' ? enclosingSymbol(node, sourceFile, relPath, text) : null,
    });
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
 *   sites: { file: string, line: number, receiver: string, package: string|null,
 *            symbol: string|null }[],
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
        symbol: hit.symbol,
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

/** `file:line` keys for the elevation sites -- the census's positional form. */
export function siteKeys(census) {
  return new Set(census.sites.map((s) => `${s.file}:${s.line}`));
}

/**
 * The census's ANCHORABLE form: per file, the distinct symbols its read sites live
 * in, and whether any of them has no nameable symbol at all.
 *
 * ⭐ This is the population `check-system-context-census.mjs` holds the page to,
 * and it is deliberately smaller than `siteKeys` above: several sites inside one
 * symbol collapse to one entry. The two are both kept because they answer
 * different questions -- `siteKeys` is what the census COUNTS, this is what the
 * page can CITE without encoding a position.
 *
 * @param {{ sites: { file: string, symbol: string|null }[] }} census
 * @returns {Map<string, { symbols: Set<string>, fileLevel: boolean, sites: number }>}
 */
export function symbolPopulation(census) {
  /** @type {Map<string, { symbols: Set<string>, fileLevel: boolean, sites: number }>} */
  const byFile = new Map();
  for (const site of census.sites) {
    let entry = byFile.get(site.file);
    if (!entry) {
      entry = { symbols: new Set(), fileLevel: false, sites: 0 };
      byFile.set(site.file, entry);
    }
    entry.sites += 1;
    if (site.symbol === null) entry.fileLevel = true;
    else entry.symbols.add(site.symbol);
  }
  return byFile;
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
