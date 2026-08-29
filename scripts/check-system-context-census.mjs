#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-system-context-census -- holds `content/docs/permissions/system-context.mdx`
 * to the code it claims to enumerate.
 *
 *   node scripts/check-system-context-census.mjs
 *   node scripts/check-system-context-census.mjs --self-test
 *   node scripts/check-system-context-census.mjs --fix   # re-anchor rotted lines
 *
 * That page declares itself "the authority" for every platform behaviour keyed off
 * `ExecutionContext.isSystem`, and says it is "built by census over the whole repo,
 * not by recall". Nothing held it to either claim. Measured over the 19 days after
 * its census was written:
 *
 *   111 anchors on the page          101 pointed at a line that no longer held
 *                                    what the row named; 10 were still correct
 *   read sites in the code            83 -> 109; 28 arrived, 2 were deleted
 *   the page's headline               "80 sites across 18 packages", while its own
 *                                     tables anchored 77 and the code held 109
 *
 * ## ⭐ Why the POPULATION check is the mandatory half
 *
 * The obvious gate resolves every anchor the page writes. That gate would have been
 * ALL GREEN at the commit above -- while the page was missing 32 sites and its
 * headline was 29 too low.
 *
 *   ⭐ A gate that only checks what the page already says can never find what the
 *      page failed to say.
 *
 * So the load-bearing direction is CENSUS -> PAGE: every read site in the code must
 * carry an anchor. The other direction (PAGE -> CENSUS) is worth having and cheap,
 * but it is the second gate, not the first.
 *
 * The two deletions are the reason a symbol-name anchor is not sufficient either.
 * Both were the `isSystem` propagation inside a `callerContext()` helper; both
 * helpers still exist under the same name. **A symbol anchor would still resolve
 * and would still be green** while the protection the row described was gone.
 * Deletions are caught here by the counts, which are census-derived: lose a site
 * and the page's declared 109 stops being true.
 *
 * ## The four checks
 *
 *   A  RESOLUTION   every anchor resolves to exactly one tracked file, at a line
 *                   that file has. Ambiguity is an error, never a guess: the
 *                   previous edition had 41 of 111 anchors whose bare basename
 *                   matched two files and could only be placed by reading the
 *                   row's prose.
 *   B  POPULATION   every elevation read site the census finds is anchored at its
 *                   exact `file:line`. Zero omissions. ⭐ This is the mandatory one.
 *   C  COUNTS       every number the page states about the current tree equals the
 *                   census. A pattern that matches NOTHING is an error, so a
 *                   reworded page cannot silently stop being checked.
 *   D  CLASSIFICATION  an anchor that is not a read site must be a declared
 *                   `NON_READ_ANCHORS` row, and that row must still locate the line.
 *
 * ## Why `NON_READ_ANCHORS` carries needles instead of line numbers
 *
 * 28 of the page's anchors are deliberately not read sites: the four unrelated
 * `isSystem` declarations, the `sys_`-prefix name helpers, a guard block a row
 * cites as the thing being skipped, and the prose targets in the "what it does NOT
 * do" table. They need an allow-list -- and an allow-list of LINE NUMBERS would rot
 * exactly like the anchors this gate exists to stop rotting, silently, because a
 * stale row still excuses an anchor.
 *
 * So each row carries a `needle`: a literal that must appear on exactly one line of
 * the file. The gate LOCATES the line and requires the page's anchor to name it.
 * That makes every anchor on the page enforced and mechanically repairable, and it
 * makes the ledger self-retiring -- a needle that matches zero lines, or more than
 * one, is an error naming the row.
 *
 * ## `--fix` repairs rot and REFUSES to repair population
 *
 * Per file, when the page's read-anchor count equals the census's site count, the
 * two are mapped in line order and the numbers rewritten: that is a pure shift, the
 * shape an unrelated edit produces. When the counts differ, the population changed
 * -- a site arrived or vanished -- and no mechanical mapping is honest. `--fix`
 * leaves those alone and the gate stays red until a human writes the row.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * A page that cannot be read, a census with no sites, zero anchors found, a corpus
 * of zero files, a declared-count pattern that matches nothing, and a ledger row
 * that locates nothing are all exit 1 naming what could not be read.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { runCensus, siteKeys } from './isystem-census.mjs';
import { extractLineAnchors, extractPathCitations, resolveAnchorFile } from './doc-line-anchors.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const PAGE = 'content/docs/permissions/system-context.mdx';

/**
 * ⛔ SHRINK-ONLY. Anchors the page writes that are deliberately NOT elevation read
 * sites. `needle` must appear on exactly ONE line of `file`; that line is where the
 * page's anchor has to point.
 */
export const NON_READ_ANCHORS = [
  // ── The four declarations that share the identifier ──────────────────────────
  {
    file: 'packages/spec/src/kernel/execution-context.zod.ts',
    needle: 'isSystem: z.boolean().default(false),',
    why: 'the elevation flag itself -- a declaration, not a read',
  },
  {
    file: 'packages/spec/src/data/object.zod.ts',
    needle: "isSystem: z.boolean().optional().default(false).describe('Is system object",
    why: 'Object.isSystem -- an unrelated metadata field the page names to defuse the collision',
  },
  {
    file: 'packages/spec/src/system/email-template.zod.ts',
    needle: 'isSystem: z.boolean().default(false),',
    why: 'EmailTemplate.isSystem -- unrelated metadata field',
  },
  {
    file: 'packages/spec/src/cloud/environment.zod.ts',
    needle: "isSystem: z.boolean().default(false).describe('Whether this is a system environment",
    why: 'Environment.isSystem -- unrelated metadata field',
  },
  // ── The `sys_` name-prefix family, cited to keep it apart from the flag ──────
  {
    file: 'packages/runtime/src/action-execution.ts',
    needle: 'export function isSystemObjectName(name: string): boolean {',
    why: 'keys on the `sys_` NAME PREFIX, not on any flag',
  },
  {
    file: 'packages/mcp/src/mcp-http-tools.ts',
    needle: 'function isSystemObject(name: string): boolean {',
    why: 'the same name-prefix helper, MCP side',
  },
  // ── Constructs a table row deliberately cites alongside its read ─────────────
  {
    file: 'packages/plugins/plugin-security/src/security-plugin.ts',
    needle: '3.5. [#3004]',
    why: 'row 2 -- the `owner_id` guard block that the row-1 short-circuit skips',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    needle: 'if (!hasTx && !hasTenant && !isSystem && !hasTz && !preserveAudit) return base;',
    why: 'row 24 -- the early return the tenant-audit read feeds',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    needle: 'if (isSystem && opts.bypassTenantAudit === undefined) {',
    why: 'row 24 -- where `bypassTenantAudit` is threaded to the driver',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    needle: 'if (options?.strictReadonlyWrites === true) {',
    why: 'row 22 -- the strict-drop refusal that never fires under elevation',
  },
  {
    file: 'packages/objectql/src/readonly-strict-errors.ts',
    needle: 'const READONLY_CLASS_REASONS',
    why: 'row 22 -- the reason set the silent refusal would have used',
  },
  {
    file: 'packages/plugins/plugin-security/src/system-write-guard.ts',
    needle: 'if (!isUserContextWrite(context)) return;',
    why: 'row 25 -- the bypass expressed through a helper rather than a direct read',
  },
  {
    file: 'packages/plugins/plugin-sharing/src/sharing-service.ts',
    needle: "if (row.source != null && row.source !== 'manual') {",
    why: 'row 34 -- the CONFLICT guard `revoke()` deletes in front of',
  },
  {
    file: 'packages/services/service-automation/src/builtin/crud-nodes.ts',
    needle: 'stampSystemInsertOwner(fields, dataCtx, data, objectName);',
    why: 'row 60 -- the call site of the compensating owner stamp',
  },
  {
    file: 'packages/objectql/src/registry.ts',
    needle: 'export function applySystemFields(',
    why: 'rough edge 5 -- named as if it read the flag; it reads it zero times',
  },
  // ── Prose targets: "what `isSystem` does NOT do", and the rough edges ────────
  {
    file: 'packages/metadata-protocol/src/seed-loader.ts',
    needle: 'so it must carry `skipTriggers` too.',
    why: 'the rationale comment the triggers row cites',
  },
  {
    file: 'packages/metadata-protocol/src/seed-loader.ts',
    needle: 'does NOT suppress trigger dispatch, only `skipTriggers` does',
    why: 'end of that rationale comment',
  },
  {
    file: 'packages/metadata-protocol/src/seed-loader.ts',
    needle: 'SEED_OPTIONS = { context: { isSystem: true, skipTriggers: true',
    why: 'the seed options that carry BOTH flags -- a producer, not a read',
  },
  {
    file: 'packages/spec/src/automation/flow.zod.ts',
    needle: 'Declare `system` to make the elevation explicit.',
    why: 'the flow-side declaration of the same distinction',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    needle: '// Runs BEFORE validation on purpose: a value the caller was never',
    why: 'start of the strip-before-validation block the validation row cites',
  },
  {
    file: 'packages/spec/src/data/field.zod.ts',
    needle: "readonly: z.boolean().default(false).describe(",
    why: '`preserveAudit` is the separate opt-in -- this is the `readonly` declaration',
  },
  {
    file: 'packages/services/service-automation/src/runtime-identity.ts',
    needle: 'const userId = (dataCtx as RunIdentityContext).userId;',
    why: 'audit stamping reads `userId`, not the flag',
  },
  {
    file: 'packages/services/service-automation/src/runtime-identity.ts',
    needle: 'if (!userId) return;',
    why: 'the user-less system write that stamps nothing',
  },
  {
    file: 'packages/plugins/plugin-auth/src/last-admin-guard.ts',
    needle: 'applies to EVERY context, `isSystem` included',
    why: 'the guard that is NOT bypassed -- cited to refute "it bypasses every guard"',
  },
  {
    file: 'packages/rest/src/rest-server.ts',
    needle: '"authenticated". `isSystem` flags are never set on inbound HTTP',
    why: 'inbound HTTP cannot set the flag',
  },
  {
    file: 'packages/rest/src/rest-server.ts',
    needle: '`isSystem` is never set on inbound HTTP, so it cannot bypass.',
    why: 'the second inbound seam',
  },
  {
    file: 'packages/runtime/src/domains/actions.ts',
    needle: '`isSystem` is never settable from the wire; internal',
    why: 'an action body cannot set the flag',
  },
];

/**
 * Numbers the page states ABOUT THE CURRENT TREE, each tied to the census value it
 * must equal.
 *
 * ⚠️ Deliberately excluded: every figure describing the PREVIOUS edition (111
 * anchors, 101 rotted, 41 ambiguous, the `grep -c` 64, "80 sites across 18
 * packages"). Those are history, they are true of a tree that no longer exists, and
 * a gate that "corrected" them would be rewriting the record.
 *
 * `pattern` must have exactly one capture group -- the number -- and must match at
 * least once. A pattern that matches nothing is an ERROR: it means the page was
 * reworded out from under the check, which is how a counts gate goes quietly
 * vacuous.
 */
export const DECLARED_COUNTS = [
  {
    id: 'headline-sites',
    pattern: /a single boolean read at \*\*(\d+)\s*\n?\s*distinct sites/,
    value: (c) => c.sites.length,
    why: 'the headline claim in the opening section',
  },
  {
    id: 'headline-packages',
    pattern: /distinct sites across (\d+) packages\*\*/,
    value: (c) => c.packages.length,
    why: 'the headline package count',
  },
  {
    id: 'sharing-share',
    pattern: /The largest single consumer — \*\*(\d+) of the \d+ sites\*\*/,
    value: (c) => c.sites.filter((s) => s.package.endsWith('plugin-sharing')).length,
    why: "section 3's claim about plugin-sharing's share",
  },
  {
    id: 'sharing-total',
    pattern: /The largest single consumer — \*\*\d+ of the (\d+) sites\*\*/,
    value: (c) => c.sites.length,
    why: 'the denominator of the same claim',
  },
  {
    id: 'table-lines-total',
    pattern: /\| Lines carrying `isSystem` in the corpus \|\s*(\d+) \|/,
    value: (c) => c.text.linesTotal,
    why: 'the decomposition table: text lines, tests included',
  },
  {
    id: 'table-lines-tests',
    pattern: /\| — in tests \|\s*(\d+) \|/,
    value: (c) => c.text.linesInTests,
    why: 'the decomposition table: text lines in tests',
  },
  {
    id: 'table-lines-sources',
    pattern: /\| — in non-test sources \|\s*(\d+) \|/,
    value: (c) => c.text.linesInSources,
    why: 'the decomposition table: text lines in sources',
  },
  {
    id: 'table-appearances',
    pattern: /\| Appearances of the bare identifier `isSystem` in non-test sources \|\s*(\d+) \|/,
    value: (c) => c.text.identifierAppearances,
    why: 'the decomposition table: identifier appearances',
  },
  {
    id: 'table-declarations',
    pattern: /\| — parsed as a declaration \|\s*(\d+) \|/,
    value: (c) => c.roleCounts.declaration,
    why: 'the decomposition table: declarations',
  },
  {
    id: 'table-keys',
    pattern: /\| — parsed as an object-literal \/ type key[^|]*\|\s*(\d+) \|/,
    value: (c) => c.roleCounts.key,
    why: 'the decomposition table: producers and option objects',
  },
  {
    id: 'table-reads',
    pattern: /\| — parsed as a property \*\*read\*\* \|\s*(\d+) \|/,
    value: (c) => c.roleCounts.read,
    why: 'the decomposition table: property reads',
  },
  {
    id: 'table-other',
    pattern: /\| — parsed in some other syntactic position[^|]*\|\s*(\d+) \|/,
    value: (c) => c.roleCounts.other,
    why: 'the decomposition table: everything else the parser saw',
  },
  {
    id: 'table-prose',
    pattern: /\| — the remainder: text inside comments and string literals \|\s*(\d+) \|/,
    value: (c) => c.text.inCommentsAndStrings,
    why: 'the decomposition table: the prose remainder',
  },
  {
    id: 'table-unrelated-reads',
    pattern: /\| Of those reads: reads of one of the unrelated metadata fields \|\s*(\d+) \|/,
    value: (c) => c.nonElevationReads.length,
    why: 'the decomposition table: the collision subtraction',
  },
  {
    id: 'table-elevation-reads',
    pattern: /\| Of those reads: reads of `ExecutionContext.isSystem` \|\s*\*\*(\d+)\*\* \|/,
    value: (c) => c.sites.length,
    why: 'the decomposition table: the census answer',
  },
  {
    id: 'table-packages',
    pattern: /\| Packages containing at least one elevation read \|\s*\*\*(\d+)\*\* \|/,
    value: (c) => c.packages.length,
    why: 'the decomposition table: package count',
  },
  {
    id: 'table-files',
    pattern: /\| Files containing at least one elevation read \|\s*(\d+) \|/,
    value: (c) => c.files.length,
    why: 'the decomposition table: file count',
  },
  {
    id: 'ruling-sites',
    pattern: /`isSystem` is a published contract with (\d+) read sites/,
    value: (c) => c.sites.length,
    why: "the #4707 ruling's premise -- it is quoted as a live count, so it must stay one",
  },
  {
    id: 'ruling-packages',
    pattern: /read sites\s*\n?\s*in (\d+) packages\./,
    value: (c) => c.packages.length,
    why: "the ruling's package count",
  },
];

/** Tracked files, for anchor resolution. */
export function trackedFiles(root = ROOT) {
  const files = execFileSync('git', ['-C', root, 'ls-files'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\n')
    .filter(Boolean);
  if (files.length === 0) throw new Error('check-system-context-census: `git ls-files` listed nothing');
  return files;
}

/**
 * Locate every `NON_READ_ANCHORS` row by its needle.
 *
 * @returns {{ located: Map<string, object>, problems: string[] }} keyed `file:line`
 */
export function locateNonReadAnchors(rows, readFile) {
  const located = new Map();
  const problems = [];
  for (const row of rows) {
    let body;
    try {
      body = readFile(row.file);
    } catch {
      problems.push(
        `[ledger-unreadable] NON_READ_ANCHORS names ${row.file}, which cannot be read -- ` +
          'the file moved or was deleted; update or drop the row.'
      );
      continue;
    }
    const hits = [];
    body.split('\n').forEach((line, i) => {
      if (line.includes(row.needle)) hits.push(i + 1);
    });
    if (hits.length === 0) {
      problems.push(
        `[ledger-stale] NON_READ_ANCHORS row for ${row.file} no longer finds its needle ` +
          `\`${row.needle}\` -- the construct it excuses is gone or reworded (${row.why}).`
      );
      continue;
    }
    if (hits.length > 1) {
      problems.push(
        `[ledger-ambiguous] NON_READ_ANCHORS needle \`${row.needle}\` matches ${hits.length} ` +
          `lines of ${row.file} (${hits.join(', ')}) -- lengthen it until it is unique.`
      );
      continue;
    }
    located.set(`${row.file}:${hits[0]}`, row);
  }
  return { located, problems };
}

/**
 * The whole verdict, as data. Pure, so `--self-test` can drive it on fixtures.
 *
 * @returns {{ problems: string[], stats: object }}
 */
export function evaluate({
  pageText,
  census,
  tracked,
  readFile,
  ledger = NON_READ_ANCHORS,
  declaredCounts = DECLARED_COUNTS,
}) {
  const problems = [];

  const anchors = extractLineAnchors(pageText);
  if (anchors.length === 0) {
    problems.push(
      '[no-anchors] the page yielded ZERO `file:line` anchors -- the reader stopped ' +
        'recognising the page rather than the page being clean.'
    );
    return { problems, stats: { anchors: 0 } };
  }
  if (census.sites.length === 0) {
    problems.push('[empty-census] the census found ZERO read sites -- refusing to compare against nothing.');
    return { problems, stats: { anchors: anchors.length } };
  }
  for (const row of census.staleLedgerRows) {
    problems.push(
      `[stale-ledger-row] isystem-census NON_ELEVATION_READS names ${row.file} (receiver ` +
        `\`${row.receiver}\`) but no such read exists -- delete the row.`
    );
  }

  // ── A. RESOLUTION ───────────────────────────────────────────────────────────
  /** @type {Map<string, object[]>} `file:line` -> anchors pointing there */
  const anchored = new Map();
  const fileLengths = new Map();
  for (const anchor of anchors) {
    const resolved = resolveAnchorFile(anchor.spelling, tracked);
    if ('error' in resolved) {
      problems.push(
        resolved.error === 'ambiguous'
          ? `[ambiguous-anchor] ${PAGE}:${anchor.docLine} spells \`${anchor.spelling}\`, which ` +
            `matches ${resolved.matches.length} tracked files (${resolved.matches.join(', ')}) -- ` +
            'lengthen the spelling until it is unique.'
          : `[unresolved-anchor] ${PAGE}:${anchor.docLine} spells \`${anchor.spelling}\`, which ` +
            'matches no tracked file -- the file moved or was deleted.'
      );
      continue;
    }
    const path = resolved.path;
    if (!fileLengths.has(path)) {
      try {
        fileLengths.set(path, readFile(path).split('\n').length);
      } catch {
        fileLengths.set(path, -1);
      }
    }
    const length = fileLengths.get(path);
    if (length === -1) {
      problems.push(`[unreadable-anchor-target] ${path} cannot be read (anchored at ${PAGE}:${anchor.docLine}).`);
      continue;
    }
    if (anchor.line < 1 || anchor.line > length) {
      problems.push(
        `[out-of-range-anchor] ${PAGE}:${anchor.docLine} anchors ${path}:${anchor.line}, ` +
          `but that file has ${length} lines.`
      );
      continue;
    }
    const key = `${path}:${anchor.line}`;
    if (!anchored.has(key)) anchored.set(key, []);
    anchored.get(key).push(anchor);
  }

  for (const citation of extractPathCitations(pageText)) {
    const resolved = resolveAnchorFile(citation.spelling, tracked);
    if ('error' in resolved) {
      problems.push(
        `[unresolved-citation] ${PAGE}:${citation.docLine} cites \`${citation.spelling}\`, ` +
          `which ${resolved.error === 'ambiguous' ? 'matches several tracked files' : 'matches no tracked file'}.`
      );
    }
  }

  // ── B. POPULATION — ⭐ the mandatory direction ───────────────────────────────
  const sites = siteKeys(census);
  const missing = [...sites].filter((key) => !anchored.has(key)).sort();
  for (const key of missing) {
    const site = census.sites.find((s) => `${s.file}:${s.line}` === key);
    problems.push(
      `[site-without-a-row] ${key} reads \`${site.receiver}.isSystem\` and NO row on the page ` +
        `anchors it — \`${site.text.slice(0, 90)}\`. ` +
        'Either the page is missing this elevation behaviour, or an existing row rotted off it.'
    );
  }

  // ── D. CLASSIFICATION ───────────────────────────────────────────────────────
  const { located, problems: ledgerProblems } = locateNonReadAnchors(ledger, readFile);
  problems.push(...ledgerProblems);
  const unexplained = [...anchored.keys()].filter((key) => !sites.has(key) && !located.has(key)).sort();
  for (const key of unexplained) {
    problems.push(
      `[anchor-is-not-a-read-site] the page anchors ${key}, which the census does not call an ` +
        'elevation read and NON_READ_ANCHORS does not declare. Either the line rotted, or the ' +
        'citation is deliberate and needs a ledger row with a needle.'
    );
  }
  const unusedLedger = [...located.entries()].filter(([key]) => !anchored.has(key));
  for (const [key, row] of unusedLedger) {
    problems.push(
      `[ledger-row-unused] NON_READ_ANCHORS excuses ${key} (${row.why}) but no anchor on the page ` +
        'points there -- the row outlived the citation, or the anchor rotted off it.'
    );
  }

  // ── C. COUNTS ───────────────────────────────────────────────────────────────
  for (const declared of declaredCounts) {
    const match = declared.pattern.exec(pageText);
    if (!match) {
      problems.push(
        `[count-pattern-unmatched] the page no longer carries the \`${declared.id}\` sentence ` +
          `(${declared.why}) -- this gate stopped checking a number nobody removed. Update the ` +
          'pattern together with the wording.'
      );
      continue;
    }
    const stated = Number(match[1]);
    const actual = declared.value(census);
    if (stated !== actual) {
      problems.push(
        `[declared-count] \`${declared.id}\` says ${stated}, the census says ${actual} (${declared.why}).`
      );
    }
  }

  return {
    problems,
    stats: {
      anchors: anchors.length,
      anchorTargets: anchored.size,
      sites: sites.size,
      packages: census.packages.length,
      files: census.files.length,
      nonReadAnchors: located.size,
      missing: missing.length,
    },
  };
}

/**
 * Rewrite rotted read-site anchors and ledger anchors in place.
 *
 * Only pure shifts: per file, the page's read-anchor count must equal the census's
 * site count. A population change is left for a human.
 *
 * @returns {{ text: string, rewrites: string[], refused: string[] }}
 */
export function fixAnchors({ pageText, census, tracked, readFile, ledger = NON_READ_ANCHORS }) {
  const anchors = extractLineAnchors(pageText);
  const sites = siteKeys(census);
  const { located } = locateNonReadAnchors(ledger, readFile);
  /** ledger target lines, per file */
  const ledgerByFile = new Map();
  for (const key of located.keys()) {
    const at = key.lastIndexOf(':');
    const file = key.slice(0, at);
    if (!ledgerByFile.has(file)) ledgerByFile.set(file, []);
    ledgerByFile.get(file).push(Number(key.slice(at + 1)));
  }

  /** @type {Map<object, string>} anchor -> resolved path */
  const paths = new Map();
  for (const anchor of anchors) {
    const resolved = resolveAnchorFile(anchor.spelling, tracked);
    if ('path' in resolved) paths.set(anchor, resolved.path);
  }

  /** @type {Map<object, number>} anchor -> new line */
  const newLine = new Map();
  const refused = [];
  const byFile = new Map();
  for (const anchor of anchors) {
    const path = paths.get(anchor);
    if (!path) continue;
    if (!byFile.has(path)) byFile.set(path, []);
    byFile.get(path).push(anchor);
  }
  for (const [path, fileAnchors] of byFile) {
    const ledgerLines = new Set(ledgerByFile.get(path) ?? []);
    const censusLines = census.sites.filter((s) => s.file === path).map((s) => s.line);
    // Anchors already on a ledger line, or on a census line, keep their meaning.
    const readAnchors = fileAnchors.filter(
      (a) => !ledgerLines.has(a.line) && !(ledgerByFile.get(path) ?? []).includes(a.line)
    );
    if (readAnchors.length !== censusLines.length) {
      refused.push(
        `${path}: page anchors ${readAnchors.length} read site(s), census finds ` +
          `${censusLines.length} -- the POPULATION changed, this is not a shift. A row has to be ` +
          'written or deleted by hand.'
      );
      continue;
    }
    const sorted = [...readAnchors].sort((a, b) => a.line - b.line);
    const target = [...censusLines].sort((a, b) => a - b);
    sorted.forEach((anchor, i) => {
      if (anchor.line !== target[i]) newLine.set(anchor, target[i]);
    });
  }

  // Ledger anchors: an anchor whose file has exactly one ledger line it is nearest
  // to, and which is neither a census site nor already on a ledger line.
  for (const [path, fileAnchors] of byFile) {
    const ledgerLines = ledgerByFile.get(path) ?? [];
    if (ledgerLines.length === 0) continue;
    const taken = new Set(fileAnchors.filter((a) => ledgerLines.includes(a.line)).map((a) => a.line));
    const free = ledgerLines.filter((l) => !taken.has(l));
    const orphans = fileAnchors.filter(
      (a) => !ledgerLines.includes(a.line) && !sites.has(`${path}:${a.line}`) && !newLine.has(a)
    );
    if (free.length === 1 && orphans.length === 1) newLine.set(orphans[0], free[0]);
  }

  // Apply, latest anchor first, so earlier offsets stay valid.
  const rewrites = [];
  let text = pageText;
  const ordered = [...newLine.keys()].sort((a, b) => b.docLine - a.docLine || b.raw.length - a.raw.length);
  for (const anchor of ordered) {
    const to = newLine.get(anchor);
    const from = anchor.raw;
    const replacement =
      anchor.kind === 'full' ? `${anchor.spelling}:${to}` : anchor.kind === 'continuation' ? `:${to}` : `${to}`;
    const needle = `\`${from}\``;
    const at = text.indexOf(needle, offsetOfDocLine(text, anchor.docLine));
    if (at === -1) {
      refused.push(`could not re-find \`${from}\` at ${PAGE}:${anchor.docLine}`);
      continue;
    }
    text = `${text.slice(0, at)}\`${replacement}\`${text.slice(at + needle.length)}`;
    rewrites.push(`${PAGE}:${anchor.docLine}  \`${from}\` -> \`${replacement}\``);
  }
  return { text, rewrites, refused };
}

function offsetOfDocLine(text, docLine) {
  let offset = 0;
  for (let n = 1; n < docLine; n += 1) {
    const at = text.indexOf('\n', offset);
    if (at === -1) return offset;
    offset = at + 1;
  }
  return offset;
}

function readFileAt(root) {
  return (relPath) => readFileSync(join(root, relPath), 'utf8');
}

function run({ fix = false } = {}) {
  const readFile = readFileAt(ROOT);
  let pageText;
  try {
    pageText = readFile(PAGE);
  } catch (error) {
    process.stderr.write(`::error::[unreadable-page] ${PAGE} could not be read -- ${error.message}\n`);
    return 1;
  }
  const census = runCensus({ root: ROOT });
  const tracked = trackedFiles(ROOT);

  if (fix) {
    const { text, rewrites, refused } = fixAnchors({ pageText, census, tracked, readFile });
    if (rewrites.length > 0) writeFileSync(join(ROOT, PAGE), text);
    for (const line of rewrites) process.stdout.write(`  re-anchored ${line}\n`);
    for (const line of refused) process.stdout.write(`  ⛔ NOT fixable: ${line}\n`);
    process.stdout.write(`check-system-context-census --fix: ${rewrites.length} anchor(s) rewritten\n`);
    pageText = text;
  }

  const { problems, stats } = evaluate({ pageText, census, tracked, readFile });
  for (const problem of problems) process.stderr.write(`::error::${problem}\n`);
  if (problems.length > 0) {
    process.stderr.write(
      `\ncheck-system-context-census: ${problems.length} problem(s) over ${stats.anchors} anchors ` +
        `and ${stats.sites} census sites.\n` +
        `Re-run the census with \`node scripts/isystem-census.mjs --json\`; pure line rot is ` +
        `repaired by \`node scripts/check-system-context-census.mjs --fix\`.\n`
    );
    return 1;
  }
  process.stdout.write(
    `check-system-context-census: OK — ${stats.sites} elevation read sites in ${stats.packages} ` +
      `packages across ${stats.files} files, all anchored; ${stats.anchors} anchors resolve, ` +
      `${stats.nonReadAnchors} declared non-read.\n`
  );
  return 0;
}

/* ────────────────────────────── self-test ────────────────────────────────── */

const FIXTURE_SOURCE = [
  'export function handler(ctx: ExecutionContext) {', // 1
  '  if (ctx.isSystem) return ALLOW;', // 2
  '  const other = obj.isSystem;', // 3
  '  return DENY;', // 4
  '}', // 5
  '// the sys_ prefix helper lives here', // 6
  'export function isSystemObjectName(name: string) { return name.startsWith("sys_"); }', // 7
].join('\n');

const FIXTURE_CENSUS = {
  sites: [{ file: 'pkg/a.ts', line: 2, receiver: 'ctx', package: 'pkg', text: 'if (ctx.isSystem) return ALLOW;' }],
  nonElevationReads: [{ file: 'pkg/a.ts', line: 3, receiver: 'obj', field: 'Object.isSystem' }],
  roleCounts: { read: 2, declaration: 0, key: 0, other: 0 },
  packages: ['pkg'],
  files: ['pkg/a.ts'],
  staleLedgerRows: [],
  scannedFiles: 1,
  text: { linesTotal: 3, linesInTests: 0, linesInSources: 3, identifierAppearances: 3, classified: 2, inCommentsAndStrings: 1 },
};

const FIXTURE_LEDGER = [
  { file: 'pkg/a.ts', needle: 'export function isSystemObjectName', why: 'name-prefix helper, not a read' },
];

function fixtureRead(relPath) {
  if (relPath === 'pkg/a.ts') return FIXTURE_SOURCE;
  throw new Error(`no fixture for ${relPath}`);
}

const FIXTURE_TRACKED = ['pkg/a.ts', 'other/a.ts'];

/** A one-row stand-in for `DECLARED_COUNTS`, so the fixtures need one sentence. */
const FIXTURE_COUNTS = [
  {
    id: 'headline-sites',
    pattern: /a single boolean read at \*\*(\d+)\s*\n?\s*distinct sites/,
    value: (c) => c.sites.length,
    why: 'fixture headline',
  },
];

function fixturePage({ anchor = 'pkg/a.ts:2', helper = 'pkg/a.ts:7' } = {}) {
  return [
    '---',
    'title: fixture',
    '---',
    '',
    'read at `' + anchor + '` and the name helper at `' + helper + '`.',
    '',
    '```bash',
    'grep -rn "isSystem" packages   # `pkg/a.ts:999` inside a fence is not an anchor',
    '```',
    '',
  ].join('\n');
}

function selfTest() {
  let failures = 0;
  const t = (name, ok, detail = '') => {
    if (!ok) failures += 1;
    process.stdout.write(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` -- ${detail}` : ''}\n`);
  };
  const run = (page, census = FIXTURE_CENSUS, declaredCounts = []) =>
    evaluate({
      pageText: page,
      census,
      tracked: FIXTURE_TRACKED,
      readFile: fixtureRead,
      ledger: FIXTURE_LEDGER,
      declaredCounts,
    });

  // ── the GREEN control: a page that is correct ───────────────────────────────
  const green = run(fixturePage());
  t('green control: a correct page reports nothing', green.problems.length === 0, green.problems.join(' | '));
  t('green control: the fenced `pkg/a.ts:999` is not read as an anchor', green.stats.anchors === 2);

  // ── ⭐ the RED that matters: a site the page never mentions ──────────────────
  const arrived = {
    ...FIXTURE_CENSUS,
    sites: [...FIXTURE_CENSUS.sites, { file: 'pkg/a.ts', line: 4, receiver: 'ctx', package: 'pkg', text: 'return DENY;' }],
  };
  const missing = run(fixturePage(), arrived);
  t(
    'POPULATION: a read site with no row is a finding',
    missing.problems.some((p) => p.startsWith('[site-without-a-row] pkg/a.ts:4'))
  );

  // ── the deletion shape: the row stands, the site is gone ────────────────────
  const deleted = { ...FIXTURE_CENSUS, sites: [] };
  const gone = run(fixturePage(), deleted);
  t('POPULATION: an empty census refuses rather than passing', gone.problems.some((p) => p.startsWith('[empty-census]')));

  const shrunk = {
    ...FIXTURE_CENSUS,
    sites: [{ file: 'pkg/a.ts', line: 4, receiver: 'ctx', package: 'pkg', text: 'return DENY;' }],
  };
  const stale = run(fixturePage(), shrunk);
  t(
    'DELETION: a row anchoring a line that is no longer a read site is a finding',
    stale.problems.some((p) => p.startsWith('[anchor-is-not-a-read-site]') && p.includes('pkg/a.ts:2'))
  );

  // ── rot ────────────────────────────────────────────────────────────────────
  const rotted = run(fixturePage({ anchor: 'pkg/a.ts:4' }));
  t('ROT: a shifted anchor is caught from both sides', rotted.problems.length === 2, rotted.problems.join(' | '));

  // ── resolution ─────────────────────────────────────────────────────────────
  const ambiguous = run(fixturePage({ anchor: 'a.ts:2' }));
  t('RESOLUTION: a bare basename matching two files is refused', ambiguous.problems.some((p) => p.startsWith('[ambiguous-anchor]')));
  const gonefile = run(fixturePage({ anchor: 'pkg/nope.ts:2' }));
  t('RESOLUTION: an anchor to a file that does not exist is refused', gonefile.problems.some((p) => p.startsWith('[unresolved-anchor]')));
  const overrun = run(fixturePage({ anchor: 'pkg/a.ts:999' }));
  t('RESOLUTION: a line past end of file is refused', overrun.problems.some((p) => p.startsWith('[out-of-range-anchor]')));

  // ── ledger ─────────────────────────────────────────────────────────────────
  const ledgerStale = evaluate({
    pageText: fixturePage(),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: [{ file: 'pkg/a.ts', needle: 'no such text anywhere', why: 'x' }],
    declaredCounts: [],
  });
  t('LEDGER: a needle that matches nothing is a finding', ledgerStale.problems.some((p) => p.startsWith('[ledger-stale]')));
  const ledgerAmbig = evaluate({
    pageText: fixturePage(),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: [{ file: 'pkg/a.ts', needle: 'return', why: 'x' }],
    declaredCounts: [],
  });
  t('LEDGER: a needle matching two lines is a finding', ledgerAmbig.problems.some((p) => p.startsWith('[ledger-ambiguous]')));
  const ledgerUnused = evaluate({
    pageText: fixturePage({ helper: 'pkg/a.ts:2' }),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
    declaredCounts: [],
  });
  t('LEDGER: a row no anchor uses is a finding', ledgerUnused.problems.some((p) => p.startsWith('[ledger-row-unused]')));

  // ── counts ─────────────────────────────────────────────────────────────────
  const countPage =
    fixturePage() + '\nit is a single boolean read at **1\ndistinct sites across 1 packages**.\n';
  const countsOk = run(countPage, FIXTURE_CENSUS, FIXTURE_COUNTS);
  t(
    'COUNTS: a matching declared count is silent',
    !countsOk.problems.some((p) => p.startsWith('[declared-count] `headline-sites`'))
  );
  const countBad =
    fixturePage() + '\nit is a single boolean read at **7\ndistinct sites across 1 packages**.\n';
  const countsRed = run(countBad, FIXTURE_CENSUS, FIXTURE_COUNTS);
  t(
    'COUNTS: a wrong declared count is a finding',
    countsRed.problems.some((p) => p.includes('`headline-sites` says 7, the census says 1'))
  );
  t(
    'COUNTS: a pattern that matches nothing is a finding, not a silent skip',
    run(fixturePage(), FIXTURE_CENSUS, FIXTURE_COUNTS).problems.some((p) =>
      p.startsWith('[count-pattern-unmatched]')
    )
  );

  // ── absence is loud ────────────────────────────────────────────────────────
  const noAnchors = run('---\ntitle: x\n---\n\nnothing here.\n');
  t('ABSENCE: a page with no anchors refuses', noAnchors.problems.some((p) => p.startsWith('[no-anchors]')));

  // ── --fix ──────────────────────────────────────────────────────────────────
  const fixed = fixAnchors({
    pageText: fixturePage({ anchor: 'pkg/a.ts:4' }),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
  });
  t('FIX: a pure shift is rewritten', fixed.text.includes('`pkg/a.ts:2`'), fixed.rewrites.join(' | '));
  const refusedFix = fixAnchors({
    pageText: fixturePage(),
    census: arrived,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
  });
  t(
    'FIX: a population change is REFUSED, never guessed',
    refusedFix.rewrites.length === 0 && refusedFix.refused.length === 1,
    JSON.stringify(refusedFix.refused)
  );

  process.stdout.write(
    failures === 0
      ? '\ncheck-system-context-census --self-test: all cases passed\n'
      : `\ncheck-system-context-census --self-test: ${failures} case(s) FAILED\n`
  );
  return failures === 0 ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.exit(argv.includes('--self-test') ? selfTest() : run({ fix: argv.includes('--fix') }));
}
