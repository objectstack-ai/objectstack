#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Error-code PROVENANCE gate (#13353, ADR-0112 D3).
 *
 *   pnpm --filter @objectstack/spec check:error-code-provenance
 *   tsx scripts/check-error-code-provenance.ts --self-test
 *   tsx scripts/check-error-code-provenance.ts --report   # print every site
 *
 * ## What it guards
 *
 * The ledger's admission rules check casing, duplication and shadowing —
 * never WHO emits — so its provenance half ("a code emitted by several
 * packages is listed once per emitting package") drifted silently by
 * construction. Three hand sweeps re-found the same class (#7504 one code,
 * #13254 one row, #13353 five candidates), each leaving the next drift
 * invisible. This gate is the mechanical form of that sweep: every stamp site
 * of a REGISTERED code in `packages/**` non-test source must be listed under
 * the stamping package's own owner key, or carry a recorded
 * {@link PROVENANCE_WAIVERS} entry naming the owner key that deliberately
 * holds the row instead ("the door, not the producer, names the wire
 * vocabulary" — the `FLOW_DISABLED` / `UPDATE_ID_MISMATCH` class).
 *
 * Division of labour with `check:dispatcher-error-vocabulary` (the adjacent
 * gate, whose scanning idiom this one borrows): that gate reports codes the
 * vocabulary does NOT contain; this one reports registered codes stamped by a
 * package whose owner key does not list them. Population-disjoint on purpose
 * — a code is either in the registered union (this gate's subject) or not
 * (that gate's).
 *
 * ## Reconciled in both directions
 *
 * A stamp site with no row and no waiver fails. A waiver is held live three
 * ways: its `registeredUnder` key must still list the code, the waived
 * package must still NOT list it (a row plus a waiver is dead weight), and
 * the scan must still find a site for the pair — a waiver whose site is gone
 * comes out with it, which is how a refactor ratchets the waiver list down
 * instead of leaving stale rows promising decisions nobody is standing on.
 *
 * ## Declared bounds — printed on every run, so a partial gate cannot read as
 * ## a complete one
 *
 * Textual, not AST — the same reasoning the sibling gate records: the failure
 * mode is a string literal in a handful of syntactic positions. The price of a
 * source scan is that it sees only the spellings it knows, and an
 * unrecognised one produces no finding, SILENTLY — so the patterns are
 * PUBLISHED ({@link STAMP_PATTERNS}) and each is pinned by `--self-test`.
 * Reaching for a spelling that is not here? Extend the list and add a
 * self-test case in the same edit.
 *
 *   - Scanned: every package `src/` tree under `packages/` — non-test
 *     TypeScript source only (`.ts`/`.tsx`; not `.d.ts`, not tests — a test
 *     that CONSTRUCTS a code is not a producer, the ledger's own rule). Not
 *     `apps/`, not `examples/`, not package `scripts/` trees.
 *   - The ledger file itself is excluded by name: its waiver tables spell
 *     `code: '…'` about codes, which is mention, not stamping.
 *   - BLIND, and inheriting the sibling gate's declared blindness rather than
 *     re-litigating it: a code arriving through a constant NOT named `*_CODE`
 *     (`GLOBAL_UNIQUE_CONFIRMATION_REQUIRED` in `@objectstack/types` defines a
 *     registered code and is invisible here), an object-literal or helper
 *     indirection (`{ code }` shorthand, `makeError(code, …)` call sites), a
 *     template literal, and a class field. Those shapes DO have recognizers in
 *     the sibling gate; a registered code reaching a stamp through one of them
 *     is simply not this gate's finding yet. Widening is a gate-population
 *     change with an unmeasured blast radius — its own card, never a rider.
 *   - OVER-matching is accepted and absorbed by rows/waivers rather than
 *     heuristics: a TYPE-position literal (`{ code: 'ITEM_LOCKED'; reason:
 *     string }`) matches the object-literal pattern. That is deliberate — the
 *     type and the constructor beside it name the same string, and a package
 *     spelling a registered code in a stamp-shaped position owes the reader an
 *     answer either way.
 *   - The scan answers "does the stamping package list this code", never
 *     whether the site is wire-reachable. Reachability is the adjudication a
 *     ROW records in its comment (the #8035 test), and what a WAIVER records
 *     when the answer is "another package's door owns the emission".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import {
  ERROR_CODE_LEDGER,
  PROVENANCE_WAIVERS,
  ProvenanceWaiverSchema,
  type ProvenanceWaiver,
} from '../src/api/error-code-ledger.zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** The ledger file — mention, not stamping; excluded by name (see header). */
const LEDGER_FILE = 'packages/spec/src/api/error-code-ledger.zod.ts';

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/**
 * The recognised ways this repo stamps a registered code, PUBLISHED and each
 * pinned by `--self-test` (see the header on why, and on what is deliberately
 * NOT here). The card's own sweep method, verbatim: three patterns.
 */
export const STAMP_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // `code: 'X'` in an object literal (a returned envelope, `c.json(…)`) — the
  // broadest shape, and where four of #13353's five candidates lived. Also
  // matches the same spelling in a TYPE literal; see the over-match bound.
  { name: 'objlit', re: /\bcode:\s*'([A-Z][A-Z0-9_]*)'/g },
  // `err.code = 'X'` — stamped onto a value about to be thrown.
  { name: 'assign', re: /\.code\s*=\s*'([A-Z][A-Z0-9_]*)'/g },
  // `X_CODE = 'X'` — a `*_CODE`-named constant's literal initializer (the
  // driver-memory `UNIQUE_VIOLATION_CODE` shape). The optional `[^=\n]*?`
  // limb admits a type annotation between name and `=`.
  { name: 'constdef', re: /\b[A-Z][A-Z0-9_]*_CODE\s*(?::[^=\n]*?)?=\s*'([A-Z][A-Z0-9_]*)'/g },
];

export interface StampSite {
  /** Repo-relative file path. */
  file: string;
  /** 1-based line of the match (in the comment-masked source; identical line numbering). */
  line: number;
  /** The stamping package's `package.json` name. */
  package: string;
  /** The registered code stamped. */
  code: string;
  /** Which {@link STAMP_PATTERNS} member matched. */
  pattern: string;
}

/**
 * Scan ONE file's source text for stamp sites of registered codes. Pure and
 * injectable — `--self-test` and the vitest suite drive it with synthetic
 * sources; the real run feeds it every file {@link collectSourceFiles} lists.
 * Comments are masked first, so a code quoted in prose is not a site.
 */
export function scanSourceText(
  source: string,
  registered: ReadonlySet<string>,
): Array<{ code: string; pattern: string; line: number }> {
  const masked = maskComments(source);
  const hits: Array<{ code: string; pattern: string; line: number }> = [];
  for (const { name, re } of STAMP_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const code = m[1];
      if (!registered.has(code)) continue; // the sibling gate's population
      const line = masked.slice(0, m.index).split('\n').length;
      hits.push({ code, pattern: name, line });
    }
  }
  return hits;
}

/** Directories never descended into. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', 'build']);

/** Is this a non-test TypeScript source file inside some package's `src/`? */
function isScannable(relPath: string, name: string): boolean {
  if (!/\.(ts|tsx)$/.test(name)) return false;
  if (name.endsWith('.d.ts') || /\.(test|spec)\.tsx?$/.test(name)) return false;
  const parts = relPath.split(sep);
  if (parts.includes('__tests__') || parts.includes('tests')) return false;
  // Inside a `src/` segment under packages/ (nested package dirs included).
  return parts.includes('src');
}

/** Every scannable file under `packages/`, repo-relative. */
export function collectSourceFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = relative(repoRoot, abs);
      if (rel === LEDGER_FILE) continue;
      if (isScannable(rel, name)) out.push(rel);
    }
  };
  walk(join(repoRoot, 'packages'));
  return out.sort();
}

/** Nearest-`package.json` name for a repo-relative file, cached per directory. */
export function makePackageResolver(repoRoot: string): (relFile: string) => string | null {
  const cache = new Map<string, string | null>();
  const nameOf = (relDir: string): string | null => {
    const hit = cache.get(relDir);
    if (hit !== undefined) return hit;
    let name: string | null = null;
    try {
      const parsed = JSON.parse(readFileSync(join(repoRoot, relDir, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (typeof parsed.name === 'string') name = parsed.name;
    } catch {
      // no manifest at this level — keep walking up
    }
    if (name === null && relDir !== 'packages' && relDir.includes(sep)) {
      name = nameOf(dirname(relDir));
    }
    cache.set(relDir, name);
    return name;
  };
  return (relFile: string) => nameOf(dirname(relFile));
}

// ---------------------------------------------------------------------------
// The verdicts
// ---------------------------------------------------------------------------

export interface ProvenanceFindings {
  /** Stamp sites with no owner-key row and no waiver. */
  violations: StampSite[];
  /** Waiver-table defects — each a reason string naming the entry and the fix. */
  waiverProblems: string[];
  /** Sites admitted by a waiver (for the report). */
  waived: StampSite[];
  /** Sites listed under their own owner key (count only in the verdict line). */
  listed: StampSite[];
}

/**
 * Reconcile scan sites against the ledger and the waiver table — pure, so the
 * self-test and the vitest suite can drive it with synthetic inputs.
 */
export function deriveFindings(
  sites: readonly StampSite[],
  ledger: Record<string, readonly string[]>,
  waivers: readonly ProvenanceWaiver[],
): ProvenanceFindings {
  const listedIn = (pkg: string, code: string): boolean => ledger[pkg]?.includes(code) ?? false;
  const waiverKey = (pkg: string, code: string): string => `${pkg} → ${code}`;

  const waiverProblems: string[] = [];
  const waiverByKey = new Map<string, ProvenanceWaiver>();
  for (const waiver of waivers) {
    const parsed = ProvenanceWaiverSchema.safeParse(waiver);
    if (!parsed.success) {
      waiverProblems.push(`waiver ${waiverKey(waiver.package, waiver.code)} does not parse: ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const key = waiverKey(waiver.package, waiver.code);
    if (waiverByKey.has(key)) {
      waiverProblems.push(`duplicate waiver for ${key} — one decision, one record`);
      continue;
    }
    waiverByKey.set(key, waiver);
    if (!listedIn(waiver.registeredUnder, waiver.code)) {
      waiverProblems.push(
        `waiver ${key} names registeredUnder \`${waiver.registeredUnder}\`, whose owner key does not list the code — ` +
          `the decision it records is gone; re-adjudicate or remove the waiver`,
      );
    }
    if (listedIn(waiver.package, waiver.code)) {
      waiverProblems.push(
        `waiver ${key} is dead weight — the package's own owner key lists the code; remove one of the two`,
      );
    }
  }

  const violations: StampSite[] = [];
  const waived: StampSite[] = [];
  const listed: StampSite[] = [];
  const seenWaiverKeys = new Set<string>();
  for (const site of sites) {
    if (listedIn(site.package, site.code)) {
      listed.push(site);
      continue;
    }
    const key = waiverKey(site.package, site.code);
    if (waiverByKey.has(key)) {
      seenWaiverKeys.add(key);
      waived.push(site);
      continue;
    }
    violations.push(site);
  }

  // The third liveness direction: a waiver whose site is gone comes out.
  for (const key of waiverByKey.keys()) {
    if (!seenWaiverKeys.has(key)) {
      waiverProblems.push(
        `waiver ${key} matches NO stamp site in the scan — its subject is gone (or moved beyond the ` +
          `published patterns); remove the waiver, or extend STAMP_PATTERNS if the stamp still exists in a new spelling`,
      );
    }
  }

  return { violations, waiverProblems, waived, listed };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function printBounds(): void {
  console.log('bounds: packages/**/src non-test .ts/.tsx; ledger file excluded (mention, not stamping);');
  console.log(`bounds: patterns = ${STAMP_PATTERNS.map((p) => p.name).join(', ')} — blind to non-*_CODE constants,`);
  console.log('bounds: helper/shorthand indirections, templates and class fields (see the header; sibling-gate shapes).');
}

function run(report: boolean): number {
  const registered = new Set<string>(Object.values(ERROR_CODE_LEDGER).flat());
  const files = collectSourceFiles(REPO_ROOT);
  const packageOf = makePackageResolver(REPO_ROOT);
  const sites: StampSite[] = [];
  for (const file of files) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');
    if (!source.includes('code')) continue;
    const hits = scanSourceText(source, registered);
    if (hits.length === 0) continue;
    const pkg = packageOf(file);
    if (pkg === null) continue; // not under any package manifest — nothing to attribute
    for (const hit of hits) sites.push({ file, package: pkg, ...hit });
  }

  const { violations, waiverProblems, waived, listed } = deriveFindings(
    sites,
    ERROR_CODE_LEDGER,
    PROVENANCE_WAIVERS,
  );

  printBounds();
  console.log(`scanned ${files.length} files; ${sites.length} registered-code stamp site(s): ` +
    `${listed.length} listed, ${waived.length} waived`);

  if (report) {
    for (const site of sites) {
      const status = listed.includes(site) ? 'listed' : waived.includes(site) ? 'waived' : 'VIOLATION';
      console.log(`  [${status}] ${site.package} → ${site.code} (${site.pattern}) ${site.file}:${site.line}`);
    }
  }

  let red = false;
  if (violations.length > 0) {
    red = true;
    console.error(`\nFAIL — ${violations.length} stamp site(s) of a registered code with no provenance row:`);
    for (const v of violations) {
      console.error(`  ${v.package} stamps '${v.code}' (${v.pattern}) at ${v.file}:${v.line} — ` +
        `not listed under its own owner key`);
    }
    console.error(
      '\nFix: EITHER add the code under the stamping package\'s owner key in\n' +
        `  ${LEDGER_FILE}\n` +
        'with a comment recording the wire path (the #8035 reachability test), OR — when a door in\n' +
        'another package deliberately names the wire vocabulary — record a PROVENANCE_WAIVERS entry\n' +
        'there naming that owner key, with the evidence. Both are decisions on the record; silence is not.',
    );
  }
  if (waiverProblems.length > 0) {
    red = true;
    console.error(`\nFAIL — ${waiverProblems.length} provenance-waiver problem(s):`);
    for (const problem of waiverProblems) console.error(`  ${problem}`);
  }
  if (!red) {
    console.log(`OK — every registered-code stamp site is listed under its own owner key or carries a recorded waiver ` +
      `(${PROVENANCE_WAIVERS.length} waiver(s), all live)`);
  }
  return red ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Self-test — the red leg, pinned per pattern and per waiver direction
// ---------------------------------------------------------------------------

function selfTest(): number {
  const failures: string[] = [];
  const check = (name: string, ok: boolean): void => {
    if (!ok) failures.push(name);
  };
  const registered = new Set(['REGISTERED_ONE', 'REGISTERED_TWO']);
  const site = (pkg: string, code: string): StampSite => ({
    file: 'packages/x/src/a.ts',
    line: 1,
    package: pkg,
    code,
    pattern: 'objlit',
  });
  const ledger = { '@objectstack/owner': ['REGISTERED_ONE', 'REGISTERED_TWO'] } as const;

  // Each published pattern catches its spelling (red leg, per pattern).
  check(
    'objlit catches a stamp',
    scanSourceText("return { code: 'REGISTERED_ONE' };", registered).some((h) => h.pattern === 'objlit'),
  );
  check(
    'assign catches a stamp',
    scanSourceText("err.code = 'REGISTERED_ONE';", registered).some((h) => h.pattern === 'assign'),
  );
  check(
    'constdef catches a *_CODE constant',
    scanSourceText("export const MY_CODE = 'REGISTERED_ONE';", registered).some((h) => h.pattern === 'constdef'),
  );
  check(
    'constdef admits a type annotation',
    scanSourceText("const MY_CODE: string = 'REGISTERED_ONE';", registered).some((h) => h.pattern === 'constdef'),
  );
  // Population boundary: an unregistered code is the sibling gate's subject.
  check(
    'unregistered code is out of population',
    scanSourceText("return { code: 'NOT_IN_LEDGER' };", registered).length === 0,
  );
  // Comment masking: a code quoted in prose is not a site.
  check(
    'a commented stamp is not a site',
    scanSourceText("// answers { code: 'REGISTERED_ONE' } on refusal\nconst x = 1;", registered).length === 0,
  );
  // A synthetic unlisted stamper is caught THROUGH the real reconciliation.
  {
    const { violations } = deriveFindings([site('@objectstack/rogue', 'REGISTERED_ONE')], ledger, []);
    check('unlisted stamper is a violation', violations.length === 1);
  }
  // A listed stamper is green.
  {
    const { violations, listed } = deriveFindings([site('@objectstack/owner', 'REGISTERED_ONE')], ledger, []);
    check('listed stamper is green', violations.length === 0 && listed.length === 1);
  }
  // A waiver admits exactly its (package, code) pair — and only that pair.
  {
    const waiver: ProvenanceWaiver = {
      package: '@objectstack/rogue',
      code: 'REGISTERED_ONE',
      registeredUnder: '@objectstack/owner',
      reason: 'self-test fixture: recorded decision',
    };
    const admitted = deriveFindings([site('@objectstack/rogue', 'REGISTERED_ONE')], ledger, [waiver]);
    check('waiver admits its pair', admitted.violations.length === 0 && admitted.waived.length === 1
      && admitted.waiverProblems.length === 0);
    const other = deriveFindings(
      [site('@objectstack/rogue', 'REGISTERED_ONE'), site('@objectstack/rogue', 'REGISTERED_TWO')],
      ledger,
      [waiver],
    );
    check('waiver does not admit a different code', other.violations.length === 1);
  }
  // Stale-waiver directions, each red.
  {
    const noSite = deriveFindings([], ledger, [{
      package: '@objectstack/rogue',
      code: 'REGISTERED_ONE',
      registeredUnder: '@objectstack/owner',
      reason: 'self-test fixture',
    }]);
    check('waiver with no site reddens', noSite.waiverProblems.some((p) => p.includes('NO stamp site')));
    const wrongOwner = deriveFindings([site('@objectstack/rogue', 'REGISTERED_ONE')], ledger, [{
      package: '@objectstack/rogue',
      code: 'REGISTERED_ONE',
      registeredUnder: '@objectstack/absent',
      reason: 'self-test fixture',
    }]);
    check('waiver naming a non-listing owner reddens', wrongOwner.waiverProblems.some((p) => p.includes('registeredUnder')));
    const deadWeight = deriveFindings([site('@objectstack/owner', 'REGISTERED_ONE')], ledger, [{
      package: '@objectstack/owner',
      code: 'REGISTERED_ONE',
      registeredUnder: '@objectstack/owner',
      reason: 'self-test fixture',
    }]);
    check('row + waiver is dead weight', deadWeight.waiverProblems.some((p) => p.includes('dead weight')));
  }

  if (failures.length > 0) {
    console.error(`self-test FAILED: ${failures.join('; ')}`);
    return 1;
  }
  console.log(`self-test OK — ${STAMP_PATTERNS.length} patterns and every waiver direction pinned`);
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  process.exit(args.includes('--self-test') ? selfTest() : run(args.includes('--report')));
}
