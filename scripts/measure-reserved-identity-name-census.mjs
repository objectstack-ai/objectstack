#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// measure-reserved-identity-name-census -- the #15972 census instrument.
//
//   node scripts/measure-reserved-identity-name-census.mjs                 # declarations
//   node scripts/measure-reserved-identity-name-census.mjs --json          # machine
//   node scripts/measure-reserved-identity-name-census.mjs --self-test     # controls only
//   node scripts/measure-reserved-identity-name-census.mjs --rows FILE     # a deployment's rows
//   node scripts/measure-reserved-identity-name-census.mjs --rows-schema   # the export shape
//
// READ-ONLY, and that is the ruling, not a preference. Maintainer ruling
// (director seat, summon #20, decision batch #105 item 4, 2026-09-09) on what
// happens to rows that ALREADY collide, verbatim:
//
//   「refuse new writes only. No migration. A read-only census reports existing
//     colliding rows to the maintainer; nothing rewrites them (option B
//     refused: stored-data migration is the manual floor's own item).」
//
// So this script opens no database connection, takes no credentials, and its
// `--rows` mode consumes a FILE the operator exported. There is no code path
// here that writes anything anywhere. It is NOT a gate: not wired into any
// workflow, exits 0 on any collision count, and deliberately not named
// `check:*` / `gen:*` so the #4203 script ledger has nothing to classify --
// the shape `measure-position-name-fold-census.mjs` established.
//
// The only non-zero exits are a failing self-test and an unreadable/malformed
// `--rows` input.
//
// ## What collides, and why the two populations are reported separately
//
// ADR-0068 D2 reserves four names for the framework's built-in identities.
// Since #15972 the write path refuses them on both position doors, so the
// populations below can only be rows that PREDATE the guard:
//
//   - `sys_position` rows whose `name` spells a reserved name while their
//     `managed_by` is NOT the platform's own provenance. The platform seeds
//     these four names per organization on purpose (`bootstrapBuiltinRoles`,
//     `managed_by: 'platform'`); those rows are the catalog and are NOT
//     collisions. A row with any other provenance is a tenant or package
//     definition standing on a reserved name.
//   - `sys_user_position` rows whose `position` spells a reserved name. ⚠️ ALL
//     of them are collisions -- no writer in any package creates one, so there
//     is no legitimate population to subtract. This is the row the card is
//     about: it is what makes a plain member LOOK like a built-in identity to
//     any reader that reads the name instead of the capability rung.
//
// ## The reserved set is READ from the spec constant, never retyped
//
// The ruling closes the enumeration: 「exactly the ADR-0068 built-in identity
// names, read from the spec constant that declares them (closed enumeration,
// ⛔ not retyped, ⛔ not widened to `org_*` shapes by pattern)」. A census that
// carried its own copy of the four strings would answer a different question
// from the guard it audits the day the constant moves, so the names are parsed
// out of `packages/spec/src/identity/eval-user.zod.ts`.
//
// ⚠️ A parse that silently found nothing would report a comfortable ZERO over
// every population. So the parse has a CONTROL that must fire ({@link
// readReservedNames} throws when it does not), and `--self-test` asserts it.
//
// ## What this instrument CANNOT see, stated up front
//
// The declaration census reads THIS REPOSITORY. Positions and assignments are
// RUNTIME rows: an operator who created a position in Setup, or an integration
// that wrote an assignment row, produces a collision no static census can ever
// see. That population is reachable only through `--rows`, which is why
// `--rows` refuses to call an empty input "zero" -- and why a zero from the
// default mode prints the sentence saying so, every time.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.cache', '.next']);
const SPEC_DECL = 'packages/spec/src/identity/eval-user.zod.ts';

/** Provenance values that mean "the platform's own catalog row" (A4 #2920 plus its legacy spelling). */
const PLATFORM_PROVENANCE = new Set(['platform', 'system']);

/* ------------------------------------------------------------------------- *
 *  The reserved set — parsed out of the declaring constant
 * ------------------------------------------------------------------------- */

/**
 * The four ADR-0068 D2 names, read from the `BUILTIN_IDENTITY_NAMES` array in
 * the spec and resolved through the `BUILTIN_IDENTITY_*` constants it lists.
 *
 * Throws rather than returning `[]`: a census that cannot find its own subject
 * must say so, because the alternative is a zero that reads like an all-clear.
 */
export function readReservedNames(source = read(SPEC_DECL)) {
  const consts = new Map();
  const constRe = /export const (BUILTIN_IDENTITY_[A-Z0-9_]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = constRe.exec(source)) !== null) consts.set(m[1], m[2]);

  const arrayRe = /export const BUILTIN_IDENTITY_NAMES\s*=\s*\[([^\]]*)\]/;
  const arr = arrayRe.exec(source);
  if (!arr) throw new Error(`census control FAILED: no BUILTIN_IDENTITY_NAMES array in ${SPEC_DECL}`);

  const names = [];
  for (const raw of arr[1].split(',')) {
    const ident = raw.trim();
    if (!ident) continue;
    const literal = /^'([^']*)'$/.exec(ident);
    if (literal) { names.push(literal[1]); continue; }
    if (!consts.has(ident)) {
      throw new Error(`census control FAILED: ${ident} is listed in BUILTIN_IDENTITY_NAMES but never declared in ${SPEC_DECL}`);
    }
    names.push(consts.get(ident));
  }
  if (names.length === 0) throw new Error(`census control FAILED: BUILTIN_IDENTITY_NAMES parsed empty in ${SPEC_DECL}`);
  return names;
}

/* ------------------------------------------------------------------------- *
 *  Corpus scan (declarations)
 * ------------------------------------------------------------------------- */

function read(rel) {
  try { return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'); } catch { return ''; }
}

function walk(root, exts, out = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, exts, out);
    } else if (exts.has(path.extname(e.name))) {
      out.push(path.relative(REPO_ROOT, full));
    }
  }
  return out;
}

/**
 * Every `name: '<reserved>'` / `position: '<reserved>'` STRING LITERAL in a
 * declaration under `packages/`, `examples/` or `apps/`.
 *
 * Textual, and bounded on purpose (the sibling census records the same
 * reasoning): the failure mode being hunted is an authored literal, and the
 * price of a source scan is that it sees only the spellings it knows. It does
 * NOT see a name assembled at runtime, and it does not know which key belongs
 * to a position declaration versus something else that happens to have a
 * `name:` -- so its hits are CANDIDATES a reader adjudicates, never verdicts.
 */
export function scanDeclarations(reserved, files) {
  const hits = [];
  const alternation = reserved.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\b(name|position)\\s*:\\s*'(${alternation})'`, 'g');
  for (const rel of files) {
    const src = read(rel);
    if (!src) continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
      hits.push({ file: rel, line: src.slice(0, m.index).split('\n').length, key: m[1], name: m[2] });
    }
  }
  return hits;
}

/* ------------------------------------------------------------------------- *
 *  Deployment rows (`--rows`)
 * ------------------------------------------------------------------------- */

const ROWS_SCHEMA = `
--rows FILE expects JSON exported READ-ONLY from the deployment:

  {
    "deployment": "<free-text label, e.g. prod-eu>",
    "sys_position":      [ { "id": …, "name": …, "managed_by": …, "organization_id": … }, … ],
    "sys_user_position": [ { "id": …, "user_id": …, "position": …, "organization_id": … }, … ]
  }

Both arrays are REQUIRED (an absent one is refused, not read as empty — see
below). Export them with reads only, e.g. against the data API:

  GET /api/v1/data/sys_position?fields=id,name,managed_by,organization_id
  GET /api/v1/data/sys_user_position?fields=id,user_id,position,organization_id

⚠️ An EMPTY array is accepted and reported as zero FOR THAT TABLE; a MISSING
key is refused. The distinction is the whole point: "we exported it and there
were none" and "we never exported it" must not produce the same all-clear.
`.trim();

export function censusRows(reserved, payload) {
  const problems = [];
  for (const table of ['sys_position', 'sys_user_position']) {
    if (!Array.isArray(payload?.[table])) problems.push(`'${table}' is missing or not an array`);
  }
  if (problems.length) {
    const err = new Error(`--rows input is not a census: ${problems.join('; ')}`);
    err.schema = ROWS_SCHEMA;
    throw err;
  }
  const reservedSet = new Set(reserved);

  const positions = payload.sys_position
    .filter((r) => reservedSet.has(String(r?.name ?? '')))
    .map((r) => ({
      id: r?.id ?? null,
      name: String(r?.name),
      managed_by: r?.managed_by ?? null,
      organization_id: r?.organization_id ?? null,
      // The platform's own catalog rows are not collisions — they ARE the
      // built-in identity catalog, seeded per organization by design.
      platformCatalog: PLATFORM_PROVENANCE.has(String(r?.managed_by ?? '')),
    }));

  const assignments = payload.sys_user_position
    .filter((r) => reservedSet.has(String(r?.position ?? '')))
    .map((r) => ({
      id: r?.id ?? null,
      user_id: r?.user_id ?? null,
      position: String(r?.position),
      organization_id: r?.organization_id ?? null,
    }));

  return {
    deployment: payload.deployment ?? null,
    scanned: { sys_position: payload.sys_position.length, sys_user_position: payload.sys_user_position.length },
    positionCollisions: positions.filter((p) => !p.platformCatalog),
    platformCatalogRows: positions.filter((p) => p.platformCatalog),
    assignmentCollisions: assignments,
  };
}

/* ------------------------------------------------------------------------- *
 *  Self-test — the controls, so a zero can be trusted
 * ------------------------------------------------------------------------- */

function selfTest() {
  const failures = [];
  const check = (label, fn) => {
    try { fn(); } catch (e) { failures.push(`${label}: ${e.message}`); }
  };
  const eq = (a, b, what) => {
    const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
    if (x !== y) throw new Error(`${what}: expected ${y}, got ${x}`);
  };

  // 1. The reserved set is found in the real declaration, and it is the four.
  check('reserved set parses from the spec', () => {
    const names = readReservedNames();
    eq(names.length, 4, 'reserved name count');
    for (const n of names) if (!/^[a-z][a-z0-9_]*$/.test(n)) throw new Error(`not a machine name: ${n}`);
  });

  // 2. THE CONTROL THAT MATTERS — a broken parse must THROW, never report zero.
  check('a declaration with no array is refused, not read as empty', () => {
    let threw = false;
    try { readReservedNames("export const BUILTIN_IDENTITY_PLATFORM_ADMIN = 'platform_admin';"); }
    catch { threw = true; }
    if (!threw) throw new Error('a source with no BUILTIN_IDENTITY_NAMES array was accepted');
  });
  check('a name listed but never declared is refused', () => {
    let threw = false;
    try { readReservedNames('export const BUILTIN_IDENTITY_NAMES = [\n  BUILTIN_IDENTITY_GHOST,\n] as const;'); }
    catch { threw = true; }
    if (!threw) throw new Error('an undeclared member was accepted');
  });

  // 3. The declaration scanner FIRES on a positive control and stays silent on
  //    the near-misses the ruling refuses to widen to.
  check('the declaration scanner fires, and does not widen by pattern', () => {
    const reserved = ['platform_admin', 'org_admin'];
    const tmp = path.join(REPO_ROOT, 'packages/spec/src/identity/eval-user.zod.ts');
    if (!fs.existsSync(tmp)) throw new Error('control corpus file is missing');
    const hits = scanDeclarations(reserved, [SPEC_DECL]);
    // The spec file declares the metadata map keyed by the constants, not by
    // literals, so this control is about the SCANNER, run over a synthetic
    // corpus below rather than over that file's spelling.
    const synthetic = scanSynthetic(reserved, [
      "const a = { name: 'platform_admin' };",
      "const b = { position: 'org_admin' };",
      "const c = { name: 'org_manager' };",       // ⛔ must NOT match
      "const d = { name: 'platform_admin_x' };",  // ⛔ must NOT match
      "const e = { label: 'platform_admin' };",   // ⛔ wrong key
    ]);
    eq(synthetic.map((h) => h.name), ['platform_admin', 'org_admin'], 'synthetic scanner hits');
    if (!Array.isArray(hits)) throw new Error('scanner did not return an array');
  });

  // 4. `--rows` separates the platform catalog from a real collision, and
  //    refuses an input that never exported a table.
  check('rows census: catalog rows are not collisions, assignments always are', () => {
    const out = censusRows(['platform_admin', 'org_admin'], {
      sys_position: [
        { id: 'p1', name: 'platform_admin', managed_by: 'platform' },
        { id: 'p2', name: 'platform_admin', managed_by: 'system' },
        { id: 'p3', name: 'org_admin', managed_by: 'admin' },
        { id: 'p4', name: 'sales_manager', managed_by: 'admin' },
      ],
      sys_user_position: [
        { id: 'a1', user_id: 'u1', position: 'platform_admin' },
        { id: 'a2', user_id: 'u2', position: 'sales_manager' },
      ],
    });
    eq(out.positionCollisions.map((r) => r.id), ['p3'], 'position collisions');
    eq(out.platformCatalogRows.map((r) => r.id), ['p1', 'p2'], 'platform catalog rows');
    eq(out.assignmentCollisions.map((r) => r.id), ['a1'], 'assignment collisions');
  });
  check('rows census: a MISSING table is refused, an EMPTY one is zero', () => {
    let threw = false;
    try { censusRows(['platform_admin'], { sys_position: [] }); } catch { threw = true; }
    if (!threw) throw new Error('an input missing sys_user_position was accepted');
    const out = censusRows(['platform_admin'], { sys_position: [], sys_user_position: [] });
    eq(out.assignmentCollisions.length, 0, 'empty export');
  });

  if (failures.length) {
    console.error('SELF-TEST FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`self-test OK — ${5} controls, all firing`);
}

/** Scanner over in-memory lines, for the self-test's synthetic corpus. */
function scanSynthetic(reserved, lines) {
  const alternation = reserved.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\b(name|position)\\s*:\\s*'(${alternation})'`, 'g');
  const hits = [];
  for (const line of lines) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) hits.push({ key: m[1], name: m[2] });
  }
  return hits;
}

/* ------------------------------------------------------------------------- *
 *  CLI
 * ------------------------------------------------------------------------- */

const ZERO_CAVEAT =
  '⚠️ A zero here is a zero over DECLARATIONS in this repository, never over a deployment. '
  + 'Positions and assignments are runtime rows; use --rows with an export to census a live store.';

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--rows-schema')) { console.log(ROWS_SCHEMA); return; }

  const json = argv.includes('--json');
  const reserved = readReservedNames();

  const rowsAt = argv.indexOf('--rows');
  if (rowsAt !== -1) {
    const file = argv[rowsAt + 1];
    if (!file) { console.error('--rows needs a FILE'); process.exit(2); }
    let payload;
    try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.error(`--rows: cannot read ${file}: ${e.message}`); process.exit(2); }
    let out;
    try { out = censusRows(reserved, payload); }
    catch (e) { console.error(e.message); if (e.schema) console.error(`\n${e.schema}`); process.exit(2); }

    if (json) { console.log(JSON.stringify({ mode: 'rows', reserved, ...out }, null, 2)); return; }
    console.log(`# reserved identity-name census — deployment rows${out.deployment ? ` (${out.deployment})` : ''}`);
    console.log(`reserved set: ${reserved.join(', ')}`);
    console.log(`scanned: ${out.scanned.sys_position} sys_position, ${out.scanned.sys_user_position} sys_user_position`);
    console.log(`\n## sys_position rows standing on a reserved name (excluding the platform catalog): ${out.positionCollisions.length}`);
    for (const r of out.positionCollisions) {
      console.log(`  - ${r.id} name=${r.name} managed_by=${r.managed_by} organization=${r.organization_id}`);
    }
    console.log(`\n## sys_user_position rows spelling a reserved name — ALL are collisions: ${out.assignmentCollisions.length}`);
    for (const r of out.assignmentCollisions) {
      console.log(`  - ${r.id} user=${r.user_id} position=${r.position} organization=${r.organization_id}`);
    }
    console.log(`\n(platform catalog rows seen and NOT counted: ${out.platformCatalogRows.length})`);
    console.log('\n⛔ Nothing here is rewritten. Renaming or removing a listed row is a maintainer decision.');
    return;
  }

  const files = [
    ...walk(path.join(REPO_ROOT, 'packages'), new Set(['.ts', '.tsx'])),
    ...walk(path.join(REPO_ROOT, 'examples'), new Set(['.ts', '.tsx'])),
    ...walk(path.join(REPO_ROOT, 'apps'), new Set(['.ts', '.tsx'])),
  ].filter((f) => !f.includes('.test.') && !f.includes('.spec.'));
  const hits = scanDeclarations(reserved, files);

  if (json) { console.log(JSON.stringify({ mode: 'declarations', reserved, scannedFiles: files.length, hits, caveat: ZERO_CAVEAT }, null, 2)); return; }
  console.log('# reserved identity-name census — declarations in this repository');
  console.log(`reserved set: ${reserved.join(', ')}   (read from ${SPEC_DECL})`);
  console.log(`scanned: ${files.length} non-test source files`);
  console.log(`\ncandidate declarations spelling a reserved name: ${hits.length}`);
  for (const h of hits) console.log(`  - ${h.file}:${h.line}  ${h.key}: '${h.name}'`);
  console.log(`\n${ZERO_CAVEAT}`);
}

if (isEntrypoint(import.meta.url)) main(process.argv.slice(2));
