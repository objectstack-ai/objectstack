#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `orgLessWrite` declaration census and gate (#13636).
 *
 *   node scripts/check-orgless-write-declarations.mjs             # gate + count
 *   node scripts/check-orgless-write-declarations.mjs --self-test # the gate's own cases
 *
 * ## What this discharges, and why a gate rather than a convention
 *
 * The maintainer's 2026-08-31 ruling (总监席第 7 场决裁批 #17, direction B) put
 * three words in the decision text rather than leaving them to implementation:
 *
 *   > 申报必须 **loud, checkable, countable** ... 静默可选标记不合格 —— 那只是
 *   > 给旁路换名。
 *
 * The engine discharges *loud* (every unadmitted declaration throws, at the
 * write) and *checkable* (each one is validated against `PLATFORM_OBJECT_TENANCY`
 * before the resolver's first early return). Neither of those produces a NUMBER,
 * and neither is readable without running the platform. This gate is the third
 * word: it enumerates every declaration in the monorepo, holds each to the same
 * ledger the runtime holds it to, and prints the count on every CI pass.
 *
 * ⚠️ A declaration that only the runtime can check is checkable by nobody at
 * review time, which is the point the ruling makes about silent markers. The
 * ledger below is what makes a NEW declaration a diff a reviewer has to approve
 * rather than a line that merges unnoticed among a hundred others.
 *
 * ## Why the declaration is a plain literal key and not a factory call
 *
 * `@objectstack/metadata-protocol` writes `sys_metadata` and **cannot import
 * from `@objectstack/objectql`** — objectql depends on IT, so the edge would be
 * a cycle. A factory would therefore be importable only in the packages that
 * happen to sit downstream of the engine, and the two admitted objects do not
 * both sit there. One literal spelling is writable from anywhere in the tree and
 * countable from anywhere by this scan; the type safety a factory would have
 * bought is bought instead by the runtime refusal and by the LITERAL rule below.
 *
 * ## The three refusals
 *
 *  1. **Non-literal.** `orgLessWrite: someVariable` is refused. A declaration
 *     computed at a distance is one a reviewer cannot check by reading the call
 *     site, and one this gate cannot count — both of the properties the ruling
 *     asked for, lost to one indirection. The CONDITION under which a site
 *     declares may be computed (and at four of the six sites it is); the
 *     declaration's own object and reason may not.
 *  2. **Unadmitted.** The (object, reason) pair must appear in
 *     `PLATFORM_OBJECT_TENANCY`'s `conditional` entries. Same admission bar as
 *     the runtime's, read from the same source of truth, so the two cannot
 *     drift into disagreement.
 *  3. **Unledgered.** The site must be listed in {@link DECLARATION_SITES}. This
 *     is the ratchet: adding a declaration means editing this file, in the same
 *     PR, with a reason a reviewer reads. ⛔ Do not add an entry to shorten a red
 *     gate — a new declaration is a new claim that some population is
 *     adjudicated org-less, and the adjudication is the maintainer's.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isEntrypoint } from './invoked-as.mjs';

/** The hand-adjudicated ledger the runtime reads, as its committed source. */
const LEDGER_PATH = 'packages/objectql/src/tenancy/platform-object-tenancy.ts';

/**
 * Every declaration site in the monorepo, with the fact that makes its rows
 * legitimately org-less. One entry per FILE; a file may declare more than once.
 *
 * `why` is not decoration: it is the half of the admission the ledger cannot
 * carry. The ledger says an OBJECT has an adjudicated org-less population; this
 * says which of that object's writers is producing it, and on what test.
 */
const DECLARATION_SITES = {
  'packages/metadata-protocol/src/sys-metadata-repository.ts':
    'The env-level repository (`organizationId == null`) writes the #6190 option A population — a ' +
    'metadata row that belongs to the installation. The test is the repository\'s scope, fixed at ' +
    'construction, so an org-scoped repository never declares.',
  'packages/plugins/plugin-audit/src/audit-writers.ts':
    'The record-change writer declares ONLY when the audited subject resolves no organization column ' +
    'at all (`recordOrgResolver.organizationFieldFor(...) === null`) — case 1 of its own enumeration. ' +
    'A subject whose column is present but NULL is indistinguishable here from the missing-stamp ' +
    'defect and is deliberately left to the refusal.',
  'packages/plugins/plugin-audit/src/read-audit.ts':
    'The read-audit flush declares only when EVERY subject in the batch resolves no organization ' +
    'column; a mixed batch declares nothing, so one untenanted subject cannot launder its siblings.',
  'packages/plugins/plugin-audit/src/auth-event-audit.ts':
    'Every row describes the better-auth session object, which resolves no tenant field, so the ' +
    'subject population is fixed by the writer rather than varying per event.',
  'packages/plugins/plugin-auth/src/admin-import-users.ts':
    'The run-level import row describes `sys_user` (better-auth, no tenant field) and belongs to the ' +
    'installation rather than to one organization.',
  'packages/services/service-settings/src/config-change-audit.ts':
    'A `global`-scope setting belongs to the installation, so its audit row has no organization to ' +
    'inherit. The test is the setting\'s declared scope — an organization-scope entry arriving without ' +
    'a tenant id is a missing stamp and keeps meeting the refusal.',
};

/** Files this scan never reads: tests state their own fixtures, including bad ones. */
const isScannable = (file) =>
  /\.(ts|mts|tsx)$/.test(file) && !/\.(test|spec)\.[cm]?tsx?$/.test(file) && !file.startsWith('scripts/');

/** Every tracked source file, from git rather than a walk (untracked ≠ shipped). */
export function trackedSources(cwd = process.cwd()) {
  const out = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').filter((f) => f && isScannable(f));
}

/**
 * The (object → admitted reasons) map, read from the ledger's committed source.
 *
 * Parsed rather than imported because this gate is `.mjs` and the ledger is TS
 * that imports across package boundaries; a parse of the literal is exact for
 * the shape the ledger actually uses (an object literal of object literals) and
 * costs no build. A ledger entry whose `orgLessReasons` cannot be read is a
 * PARSE FAILURE reported as such, never an empty admission set — silently
 * admitting nothing would turn every declaration red and read as a code defect.
 */
export function readAdmittedReasons(source) {
  const admitted = new Map();
  const entry = /(\w+):\s*\{\s*tenancy:\s*'conditional',\s*orgLessReasons:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = entry.exec(source)) !== null) {
    const reasons = [...m[2].matchAll(/'([^']+)'/g)].map((r) => r[1]);
    admitted.set(m[1], reasons);
  }
  const conditionalCount = (source.match(/tenancy: 'conditional'/g) ?? []).length;
  if (conditionalCount !== admitted.size) {
    throw new Error(
      `ledger parse failed: ${conditionalCount} 'conditional' entr(ies) in ${LEDGER_PATH} but ` +
        `${admitted.size} could be read with an orgLessReasons list. A conditional entry MUST carry ` +
        'one — the declaration channel has nothing to check against without it.',
    );
  }
  return admitted;
}

/**
 * Every `orgLessWrite:` declaration in one file.
 *
 * Deliberately a literal-shape match rather than a TS parse: the rule this
 * enforces IS that the declaration is a literal, so a matcher that only sees
 * literals reports exactly the population the rule admits, and everything else
 * falls into {@link findNonLiteralDeclarations} to be refused by name.
 */
export function findDeclarations(source) {
  const re = /orgLessWrite:\s*\{\s*object:\s*'([^']+)',\s*reason:\s*'([^']+)'\s*\}/g;
  return [...source.matchAll(re)].map((m) => ({ object: m[1], reason: m[2] }));
}

/** Every `orgLessWrite:` that is NOT the literal shape above. */
export function findNonLiteralDeclarations(source) {
  const all = [...source.matchAll(/orgLessWrite:/g)].length;
  return all - findDeclarations(source).length;
}

export function scan({ files, read, ledgerSource }) {
  const admitted = readAdmittedReasons(ledgerSource);
  const sites = [];
  const problems = [];
  for (const file of files) {
    const source = read(file);
    if (!source.includes('orgLessWrite')) continue;
    const nonLiteral = findNonLiteralDeclarations(source);
    if (nonLiteral > 0) {
      problems.push(
        `${file}: ${nonLiteral} 'orgLessWrite' occurrence(s) are not the literal ` +
          "{ object: '…', reason: '…' } shape. A declaration a reviewer cannot read at the call site, " +
          'and this gate cannot count, is not the declaration the ruling asked for.',
      );
      continue;
    }
    const declarations = findDeclarations(source);
    if (declarations.length === 0) continue;
    if (!(file in DECLARATION_SITES)) {
      problems.push(
        `${file}: declares an org-less write but is not in DECLARATION_SITES ` +
          '(scripts/check-orgless-write-declarations.mjs). Add it in THIS PR with the writer fact that ' +
          'makes its rows legitimately org-less, so the claim is reviewed rather than merged unseen.',
      );
      continue;
    }
    for (const d of declarations) {
      const reasons = admitted.get(d.object);
      if (!reasons) {
        problems.push(
          `${file}: declares '${d.object}', which ${LEDGER_PATH} does not classify as 'conditional'. ` +
            'Only an object with an adjudicated org-less population can be declared.',
        );
      } else if (!reasons.includes(d.reason)) {
        problems.push(
          `${file}: declares reason '${d.reason}' for '${d.object}', which admits: ${reasons.join(', ')}.`,
        );
      }
    }
    sites.push({ file, declarations });
  }
  const unusedLedgerEntries = Object.keys(DECLARATION_SITES).filter(
    (f) => !sites.some((s) => s.file === f),
  );
  for (const file of unusedLedgerEntries) {
    problems.push(
      `${file}: listed in DECLARATION_SITES but declares nothing. A stale entry pre-authorises a ` +
        'declaration nobody reviewed — remove it in the PR that removed the declaration.',
    );
  }
  return { sites, problems, admitted };
}

const SELF_TEST_VERDICT = 'orgless-write-declarations-self-test-ok';

export function selfTest() {
  const ledger = `
  sys_metadata: {
    tenancy: 'conditional',
    orgLessReasons: ['env-level-metadata'],
    evidence: 'x',
  },
  sys_permission_set: { tenancy: 'global', evidence: 'y' },
`;
  const admitted = readAdmittedReasons(ledger);
  if (admitted.get('sys_metadata')?.[0] !== 'env-level-metadata') throw new Error('self-test: admission parse');
  if (admitted.has('sys_permission_set')) throw new Error('self-test: a global entry must not admit reasons');

  // A conditional entry with no reasons list is a PARSE FAILURE, not an empty set.
  let threw = false;
  try {
    readAdmittedReasons("  sys_x: {\n    tenancy: 'conditional',\n    evidence: 'z',\n  },");
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('self-test: a conditional entry without orgLessReasons must fail the parse');

  const good = "insert('sys_metadata', r, { orgLessWrite: { object: 'sys_metadata', reason: 'env-level-metadata' } })";
  if (findDeclarations(good).length !== 1) throw new Error('self-test: literal declaration not found');
  if (findNonLiteralDeclarations(good) !== 0) throw new Error('self-test: literal counted as non-literal');
  if (findNonLiteralDeclarations('{ orgLessWrite: decl }') !== 1) {
    throw new Error('self-test: a computed declaration must be refused');
  }

  const read = () => good;
  const unledgered = scan({ files: ['packages/x/src/a.ts'], read, ledgerSource: ledger });
  if (!unledgered.problems.some((p) => p.includes('DECLARATION_SITES'))) {
    throw new Error('self-test: an unledgered site must be refused');
  }
  const wrongReason = scan({
    files: [Object.keys(DECLARATION_SITES)[0]],
    read: () => "{ orgLessWrite: { object: 'sys_metadata', reason: 'made-up' } }",
    ledgerSource: ledger,
  });
  if (!wrongReason.problems.some((p) => p.includes("'made-up'"))) {
    throw new Error('self-test: an unadmitted reason must be refused');
  }
  const wrongObject = scan({
    files: [Object.keys(DECLARATION_SITES)[0]],
    read: () => "{ orgLessWrite: { object: 'sys_permission_set', reason: 'env-level-metadata' } }",
    ledgerSource: ledger,
  });
  if (!wrongObject.problems.some((p) => p.includes("does not classify"))) {
    throw new Error('self-test: a non-conditional object must be refused');
  }
  console.log(
    '✓ check:orgless-write-declarations --self-test — ledger admission parse (including the ' +
      'conditional-without-reasons parse failure), the literal rule, the unledgered-site ratchet, the ' +
      'unadmitted-reason refusal and the non-conditional-object refusal all hold.',
  );
  return SELF_TEST_VERDICT;
}

function main() {
  const files = trackedSources();
  const ledgerSource = readFileSync(LEDGER_PATH, 'utf8');
  const { sites, problems, admitted } = scan({
    files,
    read: (f) => readFileSync(f, 'utf8'),
    ledgerSource,
  });
  const total = sites.reduce((n, s) => n + s.declarations.length, 0);
  if (problems.length > 0) {
    console.error('\n✗ check:orgless-write-declarations\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      `\nAn 'orgLessWrite' declaration asserts that a write's rows belong to an ADJUDICATED org-less\n` +
        'population (#13636, maintainer ruling 2026-08-31). It is checked here for the same reason the\n' +
        'engine checks it at the write: a declaration nobody can count is the silent marker the ruling\n' +
        'disqualified by name.\n',
    );
    process.exit(1);
  }
  const byObject = new Map();
  for (const s of sites) for (const d of s.declarations) byObject.set(d.object, (byObject.get(d.object) ?? 0) + 1);
  const breakdown = [...byObject.entries()].sort().map(([o, n]) => `${o}=${n}`).join(', ');
  console.log(
    `✓ check:orgless-write-declarations: ${total} declaration(s) across ${sites.length} file(s), ` +
      `every one admitted by ${LEDGER_PATH} and ledgered here` +
      (breakdown ? ` — ${breakdown}` : '') +
      `; ${admitted.size} object(s) classified 'conditional'.`,
  );
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      '\n✗ check-orgless-write-declarations self-test: selfTest() returned without reaching its\n' +
        'verdict, so no success line was printed. Exiting 0 here would report a self-test that never\n' +
        'finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
  process.exit(0);
}

if (invokedDirectly) main();
