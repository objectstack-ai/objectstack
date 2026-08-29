#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-reference-carrier-shape -- the relationship-CARRIER ratchet (#13103).
 *
 *   node packages/lint/scripts/check-reference-carrier-shape.mjs             # scan
 *   node packages/lint/scripts/check-reference-carrier-shape.mjs --census    # site table
 *   node packages/lint/scripts/check-reference-carrier-shape.mjs --self-test # both directions
 *
 * Run from the repo root, the GATE INVOCATION IDIOM lint.yml states once at its
 * top. It lives under `packages/lint/` because that package owns the authoring
 * lane this judges, beside the two docs gates that already follow the same
 * shape; it needs no build and no package import, so it runs in the pre-build
 * `Lint & Repo Gates` job rather than in its siblings' post-build lane.
 *
 * ## The predicate, and the two words that keep it honest
 *
 *     a `reference` whose value is a LITERAL must be a STRING literal,
 *     at a field-def carrier position.
 *
 * LITERAL is the first word. This is NOT "a `reference` must be a string" --
 * that wider rule would judge the spellings a source scan cannot evaluate
 * (identifiers holding string constants, runtime pass-throughs, the Zod
 * declarations that DEFINE the key) and would be wrong about every one of
 * them. Those stay UNJUDGED here, and they are counted rather than dropped so
 * the census says how much of the population the gate declined to judge.
 *
 * POSITION is the second. `reference` is an ordinary English word and this
 * tree writes it as a map key, a test's expected-result slot, and a
 * translation entry. Judging by the key name alone reds four generated i18n
 * bundles and three driver assertions on the day it lands.
 *
 * ## The defect class, and why the BROAD version of this gate was refused
 *
 * #13053: a runtime-gate fixture spelled `reference: { object: 'shop_invoice' }`
 * inside `fields:`. `FieldSchema.reference` is `z.string().optional()`, so
 * `ObjectSchema.safeParse` refuses that carrier -- and the rule the fixture
 * exercises does not read it either (`validate-security-posture.ts` `refOf()`
 * returns `undefined` for a non-string), so the suite was blind in both
 * directions at once. The fixture passed, and would have kept passing if a
 * later assertion had come to depend on the parent it silently could not see.
 *
 * The obvious guard -- run every object fixture through `ObjectSchema.safeParse`
 * -- was measured and REFUSED (#13103): **838 fixtures across 303 files** would
 * red, and they are invalid ON PURPOSE. A fixture that parses cleanly cannot
 * drive a rule that fires on malformed input. This repo has already adjudicated
 * exactly that carve-out, in `check:query-options-erasure`'s own printed text:
 * a rejection test must be able to build off-contract input.
 *
 * So the population this gate judges is the CARRIER, not the fixture. A
 * deliberately-invalid fixture stays free to be invalid in the ways its rule
 * exists to judge; what it may not do is carry a relationship target in a shape
 * no reader in the tree can read.
 *
 * ## Zero-baseline ratchet -- no grandfathering file, and none is wanted
 *
 * Re-measured on this tree before landing: 0 object-valued and 0 array-valued
 * `reference` carriers at a field-def position. That is the whole warrant for
 * landing a new gate without a maintainer decision, and it is why there is no
 * baseline JSON next to this file. A baseline here would be a place to put the
 * next defect.
 *
 * ## How a field-def carrier position is identified (and how it REFUSES)
 *
 * Two POSITIVE rules say a holder object literal IS a carrier position:
 *
 *   R1  the holder is a value in a `fields` map, or an element of a `fields`
 *       array. Structural, and the exact shape of #13053.
 *   R2  the holder declares `type` as a string literal that is a member of
 *       `FieldType`. That enum is the field definition's own discriminator, and
 *       it is READ from `packages/spec/src/data/field.zod.ts` at run time, never
 *       copied here -- a value added to the enum is picked up with no edit.
 *
 * Three POSITIVE rules say a holder provably is NOT one, each derived from the
 * spec rather than from a path ignore:
 *
 *   N1  `reference` is itself a key of a `fields` map -- so it names a FIELD,
 *       and its value is that field's definition or its translation entry, not
 *       a carrier. This is the whole of the generated-i18n exclusion.
 *   N2  the holder declares a key `data/Field` does not. `FieldSchema` is a
 *       `strictObject`, so such a literal cannot be a field definition. The key
 *       set is READ from `packages/spec/authorable-surface/data.json`, the
 *       ratcheted authorable surface, never copied here.
 *   N3  the holder declares `type` as a string literal that is NOT a
 *       `FieldType`. The enum would refuse it, so the holder is a map keyed by
 *       field-property NAME (`FIELD_KEY_STORAGE_CLASS` in driver-sql is the
 *       live example) rather than a field definition.
 *
 * When neither side fires -- or when both do -- the position is UNRESOLVED, and
 * this is where the gate refuses instead of guessing. An unresolved position
 * silently counted as "not a field def" is a hole shaped exactly like the
 * defect. But the refusal is scoped to the ambiguity that CHANGES THE VERDICT:
 *
 *   - value is a string literal        -> PASS under either reading. Immaterial.
 *   - value is not a literal at all    -> UNJUDGED under either reading. Immaterial.
 *   - value is a non-string literal    -> the readings disagree. **REFUSE (exit 3).**
 *
 * Measured on the tree at landing: 27 unresolved and 5 conflicting positions,
 * every one of them holding a string literal, so the gate is green while the
 * refusal branch is live. It is the branch, not the count, that closes the hole.
 *
 * ## `null` is not a wrong carrier -- it is an absent one
 *
 * Four `reference: null` sites in `packages/spec/src/ai/solution-blueprint.test.ts`
 * sit at a field-def position and are spec-LEGAL there: `StrictField` (the shape
 * behind `SolutionBlueprintStrict`) declares `reference: z.string().nullable()`.
 * `null` and `undefined` express ABSENCE of a target, not a target spelled in the
 * wrong shape, and deciding whether absence is legal would require knowing WHICH
 * schema a literal is an instance of -- precisely what the position recogniser
 * deliberately does not attempt. They are counted in their own census bucket, so
 * the exemption is visible rather than folded into "unjudged".
 *
 * ## Exclusions by SHAPE, not by path -- and the path spellings were already stale
 *
 * The #13103 census excluded three paths because `reference` there is a map KEY:
 * `packages/spec/json-schema/**`, `packages/spec/liveness/**`, and the generated
 * i18n translation maps. Re-verified here rather than inherited, and none of the
 * three survives as a path rule:
 *
 *   - `packages/spec/json-schema/**` does not exist under that name; the sharded
 *     `packages/spec/json-schema.manifest/` that replaced it contains the string
 *     `reference` zero times.
 *   - `packages/spec/liveness/**` is JSON, outside a TS/JS source scan entirely.
 *     (Its `reference` really is a props-map key -- `liveness/field.json` has it
 *     under `props` and `props > inlineColumns > children`, never under `fields`.)
 *   - the i18n maps are real and really do write `reference: { label, helpText }`
 *     -- four of them, and they are the only object-valued `reference` in the
 *     tree. N1 excludes them by their SHAPE, which also covers the map nobody has
 *     generated yet, and an object that legitimately declares a field NAMED
 *     `reference`.
 *
 * An exclusion inherited without its reason is how a gate quietly stops watching
 * a real population; a path list is the form that rots first.
 *
 * ## Refusal when nothing was measured
 *
 * A guard whose success condition equals its total-failure condition must
 * refuse: "0 bad carriers" and "the scan found no carriers at all" print the
 * same green. A moved directory, a renamed key or a parse failure would produce
 * the second while reading as the first, so a run that finds no field-def
 * carrier -- or no files -- exits 3 saying it is NOT a pass. Same shape as
 * `check:dual-build-cjs-loads`.
 *
 * Exit codes: 0 clean · 1 findings · 3 could not measure (unresolved material
 * ambiguity, an empty population, or a missing spec input). Both non-zero, and a
 * reader never has to guess which verdict they got.
 *
 * ## What it does NOT claim
 *
 * - It reads SOURCE, so a carrier assembled from a variable, a helper or a
 *   spread is invisible to it. #13103 measured that second population at 511
 *   not-statically-evaluable fixtures repo-wide: covering those needs a runtime
 *   hook, not a scan, and is a different card.
 * - R2 also admits the field-def-ADJACENT literals that carry a `type` and a
 *   `reference`: `data/InlineGridColumn`, `ui/ActionParam`, `ui/FormField` and
 *   `ai/BlueprintField`. That is deliberate and costs nothing -- all five
 *   schemas that declare a `reference` key declare it as a string, so the
 *   verdict is identical whichever one a literal turns out to be.
 */

import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { requireDefaultExport } from '../../../scripts/import-prerequisite.mjs';
import { parseSourceFile, EXIT_UNPARSEABLE } from '../../../scripts/ts-parse.mjs';

const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

/**
 * The SCAN SURFACE, in the syntax `scripts/pm/dispatch-gates.mjs` reads as this
 * gate's declared population, so a card touching one of these trees derives it.
 *
 * ⚠️ Provenance, never a lookup key. `walk(REPO_ROOT)` does the walking and it
 * walks the WHOLE root minus `SKIP_DIRS` -- deliberately wider than this list,
 * because a directory that can hide from the scan is the failure this gate's
 * empty-measurement refusal exists to catch. The four trees named here are the
 * ones that actually hold source today (4,985 / 205 / 191 / 35 files; the
 * remainder is three root-level config files), measured rather than assumed.
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**', 'examples/**', 'scripts/**', 'apps/**'];
void ROOT_DIR_WATCH_HINTS;

/** Where the two spec inputs live. Missing or empty -> refuse, never degrade. */
const FIELD_ZOD = 'packages/spec/src/data/field.zod.ts';
const AUTHORABLE_SURFACE = 'packages/spec/authorable-surface/data.json';
const FIELD_ENTRY_PREFIX = 'data/Field:';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.next', 'coverage', 'build', '.cache']);
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);

const KEY = 'reference';

// ── spec inputs ─────────────────────────────────────────────────────────────

/** Every `FieldType` value, read from the Zod enum that declares them. */
function readFieldTypes(root = REPO_ROOT) {
  const file = join(root, FIELD_ZOD);
  const sf = parseSourceFile(file, readFileSync(file, 'utf8'));
  const values = new Set();
  (function find(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'FieldType'
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(sf) === 'z.enum'
      && node.initializer.arguments[0]
      && ts.isArrayLiteralExpression(node.initializer.arguments[0])
    ) {
      for (const el of node.initializer.arguments[0].elements) {
        if (ts.isStringLiteralLike(el)) values.add(el.text);
      }
    }
    ts.forEachChild(node, find);
  })(sf);
  return values;
}

/** Every authorable key on `data/Field`, read from the ratcheted surface. */
function readFieldKeys(root = REPO_ROOT) {
  const raw = JSON.parse(readFileSync(join(root, AUTHORABLE_SURFACE), 'utf8'));
  const keys = new Set();
  for (const entry of raw.keys ?? []) {
    if (!entry.startsWith(FIELD_ENTRY_PREFIX)) continue;
    // A retired key is still a key a fixture may spell, and treating it as
    // unknown would make N2 fire on a real field def -- the hole direction.
    keys.add(entry.slice(FIELD_ENTRY_PREFIX.length).replace(/\s*\[RETIRED\]$/, ''));
  }
  return keys;
}

// ── AST helpers ─────────────────────────────────────────────────────────────

const propertyName = (name) =>
  (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : null);

/** Peel the wrappers that do not change a value's literal-ness. */
function unwrap(expr) {
  let v = expr;
  for (;;) {
    if (!v) return v;
    if (ts.isParenthesizedExpression(v) || ts.isAsExpression(v) || ts.isNonNullExpression(v)) { v = v.expression; continue; }
    if (ts.isSatisfiesExpression?.(v)) { v = v.expression; continue; }
    return v;
  }
}

/**
 * What KIND of carrier a value expression is.
 *
 * `string` and `non-string-literal` are the only two the predicate judges;
 * `absent` and `non-literal` are counted and left unjudged. The literal test is
 * TypeScript's own (`isLiteralExpression`), so a literal kind this file has
 * never heard of is classified as a literal rather than slipping into
 * "non-literal" -- the direction that would hide a carrier.
 */
function classifyValue(expr) {
  if (expr === null) return 'non-literal';           // shorthand `{ reference }`
  const v = unwrap(expr);
  if (ts.isStringLiteralLike(v)) return 'string';
  if (v.kind === ts.SyntaxKind.NullKeyword) return 'absent';
  if (ts.isIdentifier(v) && v.text === 'undefined') return 'absent';
  if (ts.isObjectLiteralExpression(v) || ts.isArrayLiteralExpression(v)) return 'non-string-literal';
  if (v.kind === ts.SyntaxKind.TrueKeyword || v.kind === ts.SyntaxKind.FalseKeyword) return 'non-string-literal';
  if (ts.isLiteralExpression(v)) return 'non-string-literal';
  return 'non-literal';
}

/**
 * Which rules fire on the object literal holding this `reference` property.
 * Returns the rule names, never a verdict -- `positionOf` composes them so the
 * both-sides-fire case stays visible instead of being resolved by precedence.
 */
function rulesFor(prop, vocab) {
  const fired = [];
  const holder = prop.parent;
  if (!holder || !ts.isObjectLiteralExpression(holder)) return ['N0'];
  const up = holder.parent;

  // N1 -- `reference` is a key of a `fields` map, so it NAMES a field.
  if (up && ts.isPropertyAssignment(up) && propertyName(up.name) === 'fields') fired.push('N1');

  // R1 -- holder is a value in a `fields` map ...
  if (up && ts.isPropertyAssignment(up)) {
    const grand = up.parent;
    if (
      grand && ts.isObjectLiteralExpression(grand) && grand.parent
      && ts.isPropertyAssignment(grand.parent) && propertyName(grand.parent.name) === 'fields'
    ) fired.push('R1');
  }
  // ... or an element of a `fields` array.
  if (
    up && ts.isArrayLiteralExpression(up) && up.parent
    && ts.isPropertyAssignment(up.parent) && propertyName(up.parent.name) === 'fields'
  ) fired.push('R1');

  // R2 / N3 -- the `type` discriminator, when it is statically a string.
  for (const member of holder.properties) {
    if (!ts.isPropertyAssignment(member) || propertyName(member.name) !== 'type') continue;
    const v = unwrap(member.initializer);
    if (!ts.isStringLiteralLike(v)) continue;
    fired.push(vocab.fieldTypes.has(v.text) ? 'R2' : 'N3');
  }

  // N2 -- a key `FieldSchema` (a strictObject) does not declare.
  for (const member of holder.properties) {
    if (ts.isSpreadAssignment(member)) continue;
    const k = member.name ? propertyName(member.name) : null;
    if (k === null || !vocab.fieldKeys.has(k)) { fired.push('N2'); break; }
  }

  return fired;
}

function positionOf(fired) {
  const yes = fired.some((r) => r[0] === 'R');
  const no = fired.some((r) => r[0] === 'N');
  if (yes && no) return 'conflicting';
  if (yes) return 'field-def';
  if (no) return 'not-a-carrier';
  return 'unresolved';
}

// ── the scan ────────────────────────────────────────────────────────────────

/** Every `reference` property site in one source text, classified. */
function scanText(fileName, text, vocab) {
  const sites = [];
  const sf = parseSourceFile(fileName, text);
  (function visit(node) {
    let expr;
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === KEY) expr = node.initializer;
    else if (ts.isShorthandPropertyAssignment(node) && propertyName(node.name) === KEY) expr = null;
    else expr = undefined;
    if (expr !== undefined) {
      const fired = rulesFor(node, vocab);
      sites.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        position: positionOf(fired),
        rules: fired.join('+') || '(none)',
        value: classifyValue(expr),
        text: expr === null ? '{ reference }' : unwrap(expr).getText(sf).replace(/\s+/g, ' ').slice(0, 72),
      });
    }
    ts.forEachChild(node, visit);
  })(sf);
  return sites;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out); continue; }
    if (e.isFile() && SOURCE_EXTS.has(extname(e.name))) out.push(join(dir, e.name));
  }
  return out;
}

/** Scan a whole tree. Returns the census; decides nothing. */
function scanTree(root, vocab) {
  const files = walk(root);
  const sites = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes(KEY)) continue;            // over-inclusive on purpose
    for (const s of scanText(file, text, vocab)) {
      sites.push({ ...s, file: relative(root, file).split('\\').join('/') });
    }
  }
  return { filesScanned: files.length, sites };
}

const tally = (sites, position) => {
  const row = { string: 0, 'non-string-literal': 0, absent: 0, 'non-literal': 0 };
  for (const s of sites) if (s.position === position) row[s.value] += 1;
  return row;
};

// ── verdict ─────────────────────────────────────────────────────────────────

function main() {
  const vocab = { fieldTypes: readFieldTypes(), fieldKeys: readFieldKeys() };
  const refusals = [];
  if (vocab.fieldTypes.size === 0) refusals.push(`${FIELD_ZOD} yielded no FieldType values — the enum moved or was renamed.`);
  if (vocab.fieldKeys.size === 0) refusals.push(`${AUTHORABLE_SURFACE} yielded no \`${FIELD_ENTRY_PREFIX}*\` keys — the shard moved or was renamed.`);
  if (refusals.length > 0) return refuse(refusals);

  const { filesScanned, sites } = scanTree(REPO_ROOT, vocab);
  if (filesScanned === 0) return refuse(['walked the tree and found no source files at all.']);

  const fieldDef = tally(sites, 'field-def');
  const notCarrier = tally(sites, 'not-a-carrier');
  const unresolved = tally(sites, 'unresolved');
  const conflicting = tally(sites, 'conflicting');

  if (process.argv.includes('--census')) {
    for (const s of sites) console.log(`${s.position}\t${s.value}\t${s.rules}\t${s.file}:${s.line}\t${s.text}`);
  }

  const carriersMeasured = fieldDef.string + fieldDef['non-string-literal'];
  if (carriersMeasured === 0) {
    return refuse([
      `scanned ${filesScanned} file(s) and found ZERO \`${KEY}\` carriers at a field-def position.`,
      'This is NOT a pass: nothing was measured. A moved directory, a renamed key or a',
      'position recogniser that stopped matching produces this reading, and it is',
      'indistinguishable from a clean tree by the exit code alone.',
    ]);
  }

  const material = sites.filter(
    (s) => (s.position === 'unresolved' || s.position === 'conflicting') && s.value === 'non-string-literal',
  );
  if (material.length > 0) {
    return refuse([
      `${material.length} \`${KEY}\` site(s) carry a non-string LITERAL at a position this gate could not resolve.`,
      'The two readings disagree here — "field def" makes it a finding, "not a carrier"',
      'makes it invisible — so the gate refuses rather than picking one.',
      'Resolve it by making the holder legible: put the field definition under a `fields:`',
      'map/array, or give it a `type` that is a FieldType string literal. If the holder is',
      'genuinely not a field definition, say so in its shape (a key FieldSchema does not',
      'declare already proves it) — never by adding a path ignore here.',
      '',
      ...material.map((s) => `  ${s.file}:${s.line}  ${s.text}   [rules: ${s.rules}]`),
    ]);
  }

  const findings = sites.filter((s) => s.position === 'field-def' && s.value === 'non-string-literal');
  if (findings.length > 0) {
    console.error(`\ncheck-reference-carrier-shape: ${findings.length} problem(s).\n`);
    for (const s of findings) {
      console.error(`  ${s.file}:${s.line}`);
      console.error(`    \`${KEY}\` carries a literal that is not a string: ${s.text}`);
    }
    console.error(
      `\n\`FieldSchema.${KEY}\` is \`z.string()\` — a relationship target is the target object's`
      + '\n  NAME. A non-string carrier is refused by `ObjectSchema.safeParse` AND read as'
      + '\n  `undefined` by every rule that resolves it, so the site is invisible in both'
      + '\n  directions at once (#13053). Spell it as the object name string.\n',
    );
    process.exit(1);
  }

  const unjudged = fieldDef['non-literal'] + fieldDef.absent;
  console.log(
    `check-reference-carrier-shape: OK — ${filesScanned} file(s) scanned, ${sites.length} \`${KEY}\` site(s).\n`
    + `  field-def carrier position:  ${fieldDef.string} string literal(s), `
    + `${fieldDef['non-string-literal']} non-string literal(s) — ${unjudged} unjudged `
    + `(${fieldDef['non-literal']} non-literal, ${fieldDef.absent} null/undefined).\n`
    + `  provably not a carrier:      ${notCarrier.string + notCarrier['non-string-literal'] + notCarrier.absent + notCarrier['non-literal']} site(s), `
    + `${notCarrier['non-string-literal']} of them non-string literals (excluded by SHAPE, not by path).\n`
    + `  position unresolved:         ${unresolved.string + unresolved['non-literal'] + unresolved.absent} site(s) + `
    + `${conflicting.string + conflicting['non-literal'] + conflicting.absent} conflicting — 0 material `
    + '(a refusal here is scoped to a non-string literal, where the readings disagree).',
  );
}

function refuse(lines) {
  console.error('\ncheck-reference-carrier-shape: REFUSED — could not measure.\n');
  for (const l of lines) console.error(l ? `  ${l}` : '');
  console.error('');
  process.exit(EXIT_UNPARSEABLE);
}

// ── self-test ───────────────────────────────────────────────────────────────

function selfTest() {
  const failures = [];
  const check = (ok, msg) => { if (!ok) failures.push(msg); };

  const vocab = { fieldTypes: readFieldTypes(), fieldKeys: readFieldKeys() };
  check(vocab.fieldTypes.has('lookup') && vocab.fieldTypes.has('master_detail'),
    'FieldType vocabulary does not contain lookup/master_detail — the enum read is broken');
  check(vocab.fieldKeys.has('reference') && vocab.fieldKeys.has('type'),
    'data/Field authorable keys do not contain reference/type — the surface read is broken');

  const one = (src, label) => {
    const sites = scanText(join(REPO_ROOT, `selftest-${label}.ts`), src, vocab);
    check(sites.length === 1, `${label}: expected exactly 1 \`${KEY}\` site, got ${sites.length}`);
    return sites[0] ?? { position: '(none)', value: '(none)' };
  };
  const expect = (label, src, position, value) => {
    const s = one(src, label);
    check(s.position === position && s.value === value,
      `${label}: expected ${position}/${value}, got ${s.position}/${s.value} [rules: ${s.rules}]`);
    return s;
  };

  // ── the DEFECT, in both container spellings. Without these the whole gate
  //    could be a function that returns "clean". ──────────────────────────────
  expect('defect-map', `const o = { name: 'a', fields: { invoice: { type: 'master_detail', reference: { object: 'shop_invoice' } } } };`,
    'field-def', 'non-string-literal');
  expect('defect-array', `const o = { fields: [{ name: 'invoice', type: 'lookup', reference: ['shop_invoice'] }] };`,
    'field-def', 'non-string-literal');
  expect('defect-no-container', `const f = { name: 'invoice', type: 'lookup', reference: { object: 'x' } };`,
    'field-def', 'non-string-literal');
  expect('defect-number', `const o = { fields: { a: { type: 'lookup', reference: 42 } } };`,
    'field-def', 'non-string-literal');

  // ── the string carrier, which is the whole 451-site population. ────────────
  expect('ok-map', `const o = { fields: { a: { type: 'lookup', reference: 'crm_account' } } };`, 'field-def', 'string');
  expect('ok-array', `const o = { fields: [{ name: 'a', type: 'lookup', reference: 'crm_account' }] };`, 'field-def', 'string');
  expect('ok-template', `const o = { fields: { a: { type: 'lookup', reference: \`crm_account\` } } };`, 'field-def', 'string');
  expect('ok-as-const', `const o = { fields: { a: { type: 'lookup', reference: 'crm_account' as const } } };`, 'field-def', 'string');

  // ── the 17 non-literal spellings the census left UNJUDGED, one per family.
  //    Every one of these staying green IS the narrowness of the predicate. ───
  expect('unjudged-identifier', `const o = { fields: { a: { type: 'lookup', reference: ACCOUNT } } };`, 'field-def', 'non-literal');
  expect('unjudged-template-sub', `const o = { fields: { a: { type: 'lookup', reference: \`\${p}_1\` } } };`, 'field-def', 'non-literal');
  expect('unjudged-member', `const o = { fields: { a: { type: 'lookup', reference: cfg.target } } };`, 'field-def', 'non-literal');
  expect('unjudged-call', `const o = { fields: { a: { type: 'lookup', reference: String(f.reference) } } };`, 'field-def', 'non-literal');
  expect('unjudged-conditional', `const o = { fields: { a: { type: 'lookup', reference: ok ? a : undefined } } };`, 'field-def', 'non-literal');
  expect('unjudged-shorthand', `const mk = (reference) => ({ type: 'lookup', reference });`, 'field-def', 'non-literal');
  expect('unjudged-zod', `const S = strictObject({ name: z.string(), type: FieldType, reference: z.string().optional() });`,
    'unresolved', 'non-literal');

  // ── `reference: null` — spec-legal under StrictField's z.string().nullable().
  expect('absent-null', `const o = { fields: [{ name: 'f', type: 'text', reference: null }] };`, 'field-def', 'absent');
  expect('absent-undefined', `const o = { fields: [{ name: 'f', type: 'text', reference: undefined }] };`, 'field-def', 'absent');

  // ── the shapes that are provably NOT carriers. Each of these reds a
  //    key-name-only gate on the day it lands. ───────────────────────────────
  expect('not-i18n-map', `export const t = { field: { fields: { type: { label: 'T' }, reference: { label: 'Reference', helpText: 'x' } } } };`,
    'not-a-carrier', 'non-string-literal');
  expect('not-expect-object', `it('x', () => { expect({ live, reference: ['1', '2'] }).toEqual(y); });`,
    'not-a-carrier', 'non-string-literal');
  expect('not-field-key-class', `const C = { type: 'storage', maxLength: 'storage', reference: 'storage' };`,
    'not-a-carrier', 'string');

  // ── the REFUSAL branch: a non-string literal at a position neither side
  //    claims. This must never be silently read as "not a field def". ────────
  const amb = one(`const x = { label: 'Account', reference: { object: 'crm_account' } };`, 'ambiguous');
  check(amb.position === 'unresolved' && amb.value === 'non-string-literal',
    `ambiguous: expected unresolved/non-string-literal, got ${amb.position}/${amb.value}`);

  // ── a field NAMED `fields` makes N1 and R1 both fire: a real conflict, and
  //    it must surface as one rather than being resolved by rule order. ──────
  const conflict = one(`const o = { fields: { fields: { type: 'lookup', reference: { object: 'x' } } } };`, 'conflict');
  check(conflict.position === 'conflicting',
    `conflict: expected conflicting, got ${conflict.position} [rules: ${conflict.rules}]`);

  // ── the empty-measurement refusal, over a real tree on disk. This is the
  //    control that makes the green line mean something: the same code path
  //    that prints OK must exit non-zero when it reads nothing. ─────────────
  {
    const dir = mkdtempSync(join(tmpdir(), 'ref-carrier-'));
    try {
      writeFileSync(join(dir, 'a.ts'), `export const x = { note: 'no carriers here' };\n`);
      const empty = scanTree(dir, vocab);
      check(empty.filesScanned === 1, `empty-tree: expected 1 file, got ${empty.filesScanned}`);
      check(tally(empty.sites, 'field-def').string === 0,
        'empty-tree: a tree with no carriers reported carriers — the instrument is fabricating');

      writeFileSync(join(dir, 'b.ts'), `export const o = { fields: { a: { type: 'lookup', reference: 'crm_account' } } };\n`);
      const seeded = scanTree(dir, vocab);
      check(tally(seeded.sites, 'field-def').string === 1,
        'seeded-tree: the same scan over one real carrier did not count it — a zero here would be unfalsifiable');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`✗ self-test: ${f}`);
    console.error(`\ncheck-reference-carrier-shape --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    '✅  self-test: flags an object / array / numeric carrier at a field-def position in all\n'
    + '    three container spellings; stays silent on string, template and `as const` carriers;\n'
    + '    leaves every non-literal spelling and `reference: null` unjudged; excludes the i18n\n'
    + '    field-name map, the { live, reference } assertion and the field-key class map BY SHAPE;\n'
    + '    surfaces an unresolved position and a rule conflict instead of guessing; and proves\n'
    + '    over a real tree that the same scan returns 0 on an empty one and 1 on a seeded one.',
  );
}

if (process.argv.includes('--self-test')) selfTest();
else main();
