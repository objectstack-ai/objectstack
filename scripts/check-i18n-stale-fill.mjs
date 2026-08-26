#!/usr/bin/env node
// check-i18n-stale-fill — the `pnpm check:i18n-stale-fill` gate.
//
// ONE verdict: a translated leaf that is a COPY OF A PREVIOUS SOURCE REVISION.
//
// ## The hole (#11671)
//
// `os i18n extract --fill=default` fills GAPS only. `packages/cli/src/utils/
// i18n-extract.ts` (the merge branch, ~line 1212):
//
//     if (opts.mergeExisting !== false && locale !== defaultLocale) {
//       const existingValue = lookupDeep(existing[locale], entry.path);
//       if (existingValue !== undefined && existingValue !== '') value = String(existingValue);
//     }
//
// Any NON-EMPTY existing value in a translated locale wins, forever. So the
// ordinary sequence — extract once, revise the source string, extract again —
// rewrites `en` (never merged, #8543) and silently keeps the previous source
// text in every other locale. The bundle is still in sync by key, so
// `check:i18n` reports OK; the leaf is still present, so `check:i18n-coverage`
// counts it translated (`i18n-coverage.ts`: `if (value !== undefined) {
// translated += 1; continue; }` — PRESENCE, not freshness). Measured on #11659
// at `bbe0b17`: three locales serving a 602-char superseded draft of a 411-char
// help string, under 31 green checks.
//
// The extractor's own generated-file header already states the gap in the
// clearest possible terms — "nothing here or in `os i18n check` tells a leaf a
// translator updated on purpose from one nobody has looked at since the source
// moved." This gate is the first thing that tells them apart, for the subset
// where the bundles carry enough evidence to do it without provenance.
//
// ## Why this is not simply "flag leaves that differ from the source"
//
// It cannot be, and the measurement says so. "Untranslated" has exactly one
// observable spelling today: EQUAL to the current source. Once the source is
// revised, a stale fill stops being equal to it and becomes indistinguishable
// BY VALUE from a real translation. Measured on this tree: 2648 of 3010 leaves
// differ from `en` in at least one locale — that set is essentially every
// correct translation in the repo. "Untranslated AND differing from the current
// source" is empty by construction, not merely noisy.
//
// ## The signal that IS decidable without provenance: cross-locale agreement
//
// Two DIFFERENT target languages do not independently produce byte-identical
// prose. When they hold the same bytes, neither translated it — both were
// filled from the source. If those shared bytes are not the CURRENT source,
// they are a previous revision of it. That is the ruling's primary target
// ("leaves byte-equal to a PREVIOUS source revision") reached with no recorded
// provenance and no format change, because the agreement between locales is
// itself the evidence.
//
// Four conditions, each closing one MEASURED false-positive class:
//
//   1. >=2 translated locales byte-identical at the same leaf path.
//      The provenance proxy. Alone: 47 leaves on this tree.
//   2. The shared value != the current `en` value at that path.
//      Identity EQUAL to `en` is the ordinary --fill=default state (578 leaves)
//      and is `check:i18n-coverage`'s business, not this gate's. This gate only
//      ever ADDS detection; it never restates a gap another gate owns.
//   3. At least one agreeing locale is SCRIPT-DISJOINT from the shared value —
//      a `zh-CN`/`ja-JP` leaf holding no CJK codepoint. Without it, `zh-CN` and
//      `ja-JP` legitimately coinciding on short Han labels (更新, 成功, 所有者)
//      is a live false-positive source: 47 -> 11.
//   4. The shared value differs from `en` by more than ASCII case. Deliberate
//      token casing (`csv`->`CSV`, `api`->`API`, `web`->`Web`, `cron`->`Cron`)
//      is the one benign class surviving 1-3: 11 -> 5.
//
// Nothing here is a threshold. There is no length cutoff, no ratio, no score —
// each condition is a statement about what the bundles can and cannot mean.
//
// ## What this gate deliberately CANNOT see — the format question (#11671 fork)
//
// Cross-locale agreement needs TWO locales to have gone stale together. A leaf
// stranded in ONE locale — because the others were re-translated, or because a
// package ships a single translated locale — carries no evidence at all and is
// invisible here. So is a stale pair among locales that share the source's
// script (two Latin-script locales agreeing is not proof of a fill).
//
// Closing THAT half needs recorded fill provenance, and the repo already has a
// ruled shape for it: `packages/platform-objects/src/apps/translations/
// source-hash.ts` implements maintainer ruling #8765 Option B — record the
// source hash at translation time, a mismatch marks the translation stale.
// It is scoped to the HAND-AUTHORED sections (`apps`, `dashboards`, `pages`),
// and its module note asserts the hole "cannot occur" in the generated sections
// because `en` is rewritten from the source on every run. That assertion is
// FALSE, and #11671 is its counterexample: rewriting `en` catches drift in `en`,
// while the translated locales keep merge semantics and strand the old text
// there. Extending that sidecar to the generated bundles would close the whole
// class — but it makes the extractor emit a new companion file per locale,
// which is a bundle/extract FORMAT change. Per triage's ruling on #11671 that
// is a fork to be reported, not invented inline, so this gate ships the half
// that needs no format change and names the other half here.
//
// ## Why a ratchet rather than a hard failure
//
// The rule finds real drift on `main` today, and repairing bundles is expressly
// not this gate's card (#11671 was re-routed to the tooling lane for exactly
// that reason). A gate that is red on arrival gets switched off, so the debt is
// FROZEN in the baseline and the build fails the moment it GROWS — the same
// shippable middle `check-i18n-coverage` and `check-role-word` take. Every
// baseline entry carries a reason, so the ledger is a worklist rather than a
// silencer.
//
//   node scripts/check-i18n-stale-fill.mjs             # gate
//   node scripts/check-i18n-stale-fill.mjs --update    # re-baseline from the tree
//   node scripts/check-i18n-stale-fill.mjs --self-test # prove every rule can go red
//
// Needs NO workspace build: it reads the committed bundles as text, so unlike
// `check:i18n` and `check:i18n-coverage` it belongs in the cheap lint job.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExtractConfigs, flagsFromDocstring } from './i18n-bundle-surface.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * Every read is anchored to the script's own location, never the cwd (#10907):
 * a cwd-relative population and a cwd-relative baseline empty TOGETHER, and the
 * comparison is left with nothing to disagree about — a green run over nothing.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(ROOT, p);

const BASELINE_PATH = 'scripts/i18n-stale-fill-baseline.json';
const PACKAGES_DIR = 'packages';

/**
 * The one `*.generated.ts` in an out-dir that is NOT a translation bundle.
 *
 * `os i18n extract --source-hashes` writes `<locale>.source-hashes.generated.ts`
 * beside the bundles — the provenance sidecar from maintainer ruling #12069
 * Option A, whose leaves are 16-hex digests of source strings, not prose.
 *
 * Excluded by NAME rather than by shape, and this gate's population is the
 * reason it has to be excluded at all: the discovery groups an out-dir's
 * `*.generated.ts` files by kind, so without this the three companions form a
 * fourth "bundle set" with no `en` member. Measured before the exclusion
 * landed: the gate exits 1 on the first one with "could not be parsed as a
 * bundle literal" (its refuse-rather-than-skip rule doing its job on a file
 * that is not a bundle). Had the sidecar happened to parse, the outcome would
 * have been worse and quieter — one digest per source string means the SAME
 * path carries the SAME digest in every locale, so condition 1 (>=2 locales
 * byte-identical) holds for hundreds of paths, and a hex digest is
 * script-disjoint from `zh-CN` and differs from an absent `en` by more than
 * case, so conditions 3 and 4 hold too. That is the shape this constant exists
 * to keep out of the population.
 *
 * ⛔ Not a way to shrink what the gate judges: the sidecar contains no
 * translated leaf, so no leaf leaves this gate's population with it.
 */
const PROVENANCE_KIND = 'source-hashes.generated.ts';

/** Is this `<locale>.<kind>` suffix a translation bundle rather than the sidecar? */
export function isTranslationBundleKind(kind) {
  return kind !== PROVENANCE_KIND;
}

/** The locale the extractor copies the source into. `os i18n extract`'s default. */
const DEFAULT_LOCALE = 'en';

/**
 * Locales whose script is disjoint from the source language's. A leaf in one of
 * these holding no character of that script is not a translation into it.
 *
 * Declared rather than detected: "which script must a zh-CN string contain" is
 * a fact about the locale, and a detector that guessed it from the committed
 * values would learn its answer from the very drift it is meant to find.
 */
const SCRIPT_REQUIRED = {
  'zh-CN': /[㐀-䶿一-鿿豈-﫿]/,
  'ja-JP': /[぀-ヿ㐀-䶿一-鿿豈-﫿]/,
};

const update = process.argv.includes('--update');

// ---------------------------------------------------------------------------
// Pure rules — every one of them driven by --self-test
// ---------------------------------------------------------------------------

/**
 * Parse the object literal a generated bundle exports.
 *
 * Exact, not approximate: `renderTranslationModule` serialises every string and
 * every non-identifier key with `JSON.stringify` and every identifier key bare,
 * one key per line, and `JSON.stringify` escapes newlines — so a literal becomes
 * JSON by quoting the bare keys, and no string value can span a line to be
 * mistaken for one. A parse failure is a hard error naming the file, never a
 * skip: a bundle this gate cannot read is a bundle it did not check.
 */
export function parseBundleLiteral(source) {
  const marker = source.indexOf('export const');
  const open = marker < 0 ? -1 : source.indexOf('= {', marker);
  if (open < 0) return { error: 'no `export const … = {` declaration found' };
  const literal = source.slice(open + 2).replace(/;\s*$/, '');
  const json = literal.replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)(:\s)/gm, '$1"$2"$3');
  try {
    return { data: JSON.parse(json) };
  } catch (err) {
    return { error: `could not be parsed as a bundle literal — ${err.message}` };
  }
}

/** Every string leaf keyed by dotted path, in walk order. */
export function collectLeaves(node, path = '', out = new Map()) {
  if (typeof node === 'string') {
    out.set(path, node);
    return out;
  }
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, child] of Object.entries(node)) collectLeaves(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}

/** Condition 4: the two strings differ by ASCII case alone (or not at all). */
export function differsByAsciiCaseOnly(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Condition 3: does this locale REQUIRE a script the value does not carry?
 * Locales with no declared script requirement can never satisfy it — silence
 * here is "this locale cannot testify", never "this locale says fine".
 */
export function scriptDisjoint(locale, value) {
  const required = SCRIPT_REQUIRED[locale];
  return required !== undefined && !required.test(value);
}

/**
 * The stale fills of one bundle set: `{ [locale]: Map<path, value> }` including
 * the default locale, which is the current source (#8543 rewrites it every run).
 *
 * Returns one finding per (path, shared value) group, carrying the agreeing
 * locales so a reader can see the evidence rather than take the verdict.
 */
export function findStaleFills(byLocale) {
  const source = byLocale[DEFAULT_LOCALE];
  if (!source) return [];
  const translated = Object.keys(byLocale).filter((l) => l !== DEFAULT_LOCALE);
  const findings = [];

  for (const [path, sourceValue] of source) {
    const groups = new Map();
    for (const locale of translated) {
      const value = byLocale[locale].get(path);
      if (value === undefined) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(locale);
    }
    for (const [value, locales] of groups) {
      if (locales.length < 2) continue; // 1: no cross-locale agreement
      if (value === sourceValue) continue; // 2: the ordinary --fill=default state
      if (!locales.some((l) => scriptDisjoint(l, value))) continue; // 3
      if (differsByAsciiCaseOnly(value, sourceValue)) continue; // 4
      findings.push({ path, value, source: sourceValue, locales: [...locales].sort() });
    }
  }
  return findings;
}

/** The two-sided ratchet verdict. Pure over already-collected ids. */
export function ratchet(found, baselined) {
  const foundSet = new Set(found);
  const baseSet = new Set(baselined);
  return {
    added: found.filter((id) => !baseSet.has(id)),
    removed: baselined.filter((id) => !foundSet.has(id)),
  };
}

const NEW_REASON = 'unclassified — triage this: real drift (re-translate the leaf) or a benign coincidence';

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

/**
 * Every bundle set in the repo, discovered through the extract configs' own
 * documented `--out=` and `--locales=` rather than by guessing at filenames —
 * the same seam `check:i18n` reads, so a package that lands tomorrow is gated
 * tomorrow and a package that changes its locales updates one place.
 */
function discoverBundleSets() {
  const sets = [];
  for (const config of findExtractConfigs(at(PACKAGES_DIR), PACKAGES_DIR)) {
    const flags = flagsFromDocstring(config.abs);
    const out = flags.find((f) => f.startsWith('--out='))?.slice('--out='.length);
    const locales = flags.find((f) => f.startsWith('--locales='))?.slice('--locales='.length);
    if (!out || !locales) continue;
    if (!existsSync(at(out))) continue;
    const wanted = new Set([DEFAULT_LOCALE, ...locales.split(',')]);
    const files = readdirSync(at(out)).filter((f) => f.endsWith('.generated.ts'));
    const kinds = [...new Set(files.map((f) => f.replace(/^[^.]+\./, '')))].filter(isTranslationBundleKind).sort();
    for (const kind of kinds) {
      const members = files
        .filter((f) => f.endsWith(kind))
        .map((f) => ({ locale: f.slice(0, f.length - kind.length - 1), file: `${out}/${f}` }))
        .filter((m) => wanted.has(m.locale));
      if (members.length) sets.push({ out, kind, members });
    }
  }
  return sets;
}

function selfTest() {
  let failures = 0;
  const expect = (what, ok) => {
    if (!ok) {
      failures += 1;
      console.error(`  ✗ ${what}`);
    } else console.log(`  ✓ ${what}`);
  };
  const M = (o) => new Map(Object.entries(o));

  console.log('check-i18n-stale-fill --self-test\n');

  // The card's own measured shape: three locales byte-identical on a superseded
  // draft. If this gate cannot go red here it cannot go red on #11671 at all.
  expect(
    "#11671's measured shape — 3 locales sharing a superseded draft — is reported",
    findStaleFills({
      en: M({ 'sys_activity.fields.type.help': 'The kind of activity this row records.' }),
      'zh-CN': M({ 'sys_activity.fields.type.help': 'The kind of activity, and how validateRecord treats readonly fields.' }),
      'ja-JP': M({ 'sys_activity.fields.type.help': 'The kind of activity, and how validateRecord treats readonly fields.' }),
      'es-ES': M({ 'sys_activity.fields.type.help': 'The kind of activity, and how validateRecord treats readonly fields.' }),
    }).length === 1,
  );

  // Condition 1 — one locale alone carries no evidence. This is the fork's half.
  expect(
    'a leaf stale in ONE locale only is NOT reported (no cross-locale evidence — the format fork)',
    findStaleFills({
      en: M({ 'a.b': 'current source text' }),
      'ja-JP': M({ 'a.b': 'previous source text' }),
      'zh-CN': M({ 'a.b': '当前的源文本' }),
    }).length === 0,
  );

  // Condition 2 — the ordinary --fill=default state is another gate's business.
  expect(
    'locales equal to the CURRENT source are NOT reported (ordinary --fill=default, coverage owns it)',
    findStaleFills({
      en: M({ 'a.b': 'Number of attempts' }),
      'ja-JP': M({ 'a.b': 'Number of attempts' }),
      'zh-CN': M({ 'a.b': 'Number of attempts' }),
    }).length === 0,
  );

  // Condition 3 — zh-CN and ja-JP sharing Han is a translation, not a fill.
  expect(
    'zh-CN and ja-JP agreeing on a Han label are NOT reported (shared script, a real translation)',
    findStaleFills({
      en: M({ 'a.b': 'Update' }),
      'zh-CN': M({ 'a.b': '更新' }),
      'ja-JP': M({ 'a.b': '更新' }),
    }).length === 0,
  );
  expect(
    'the same agreement on LATIN text IS reported (no CJK in a CJK locale ⇒ not a translation)',
    findStaleFills({
      en: M({ 'a.b': 'Updated recently' }),
      'zh-CN': M({ 'a.b': 'Update' }),
      'ja-JP': M({ 'a.b': 'Update' }),
    }).length === 1,
  );

  // Condition 4 — deliberate token casing.
  expect(
    'a case-only difference from the source is NOT reported (`csv` → `CSV`)',
    findStaleFills({
      en: M({ 'a.b': 'csv' }),
      'zh-CN': M({ 'a.b': 'CSV' }),
      'ja-JP': M({ 'a.b': 'CSV' }),
    }).length === 0,
  );
  expect('differsByAsciiCaseOnly separates case from content', differsByAsciiCaseOnly('API', 'api') && !differsByAsciiCaseOnly('Webhook', 'Webhooks'));
  expect('scriptDisjoint cannot testify for a locale with no declared script', scriptDisjoint('es-ES', 'anything') === false);

  // The parser is exact for this emitter — including a value that contains the
  // very shape a line-oriented key transform looks for.
  const rendered = [
    "// Copyright (c) 2025 ObjectStack.",
    '',
    "import type { TranslationData } from '@objectstack/spec/system';",
    '',
    'export const zhCNObjects: NonNullable<TranslationData[\'objects\']> = {',
    '  sys_audit_log: {',
    '    label: "审计日志",',
    '    "odd-key": "value",',
    '    description: "A line: with a colon, and a \\"quote\\""',
    '  }',
    '};',
    '',
  ].join('\n');
  const parsed = parseBundleLiteral(rendered);
  expect(
    'parseBundleLiteral reads bare keys, quoted keys and colon-bearing values',
    parsed.data?.sys_audit_log?.label === '审计日志' &&
      parsed.data?.sys_audit_log?.['odd-key'] === 'value' &&
      parsed.data?.sys_audit_log?.description === 'A line: with a colon, and a "quote"',
  );
  expect('parseBundleLiteral REFUSES a file it cannot read rather than returning empty', parseBundleLiteral('nothing here').error !== undefined);
  expect(
    'collectLeaves walks to string leaves by dotted path',
    collectLeaves({ a: { b: { c: 'x' } } }).get('a.b.c') === 'x',
  );

  // The ratchet, both directions.
  const both = ratchet(['a', 'c'], ['a', 'b']);
  expect('ratchet reports a NEW id', both.added.length === 1 && both.added[0] === 'c');
  expect('ratchet reports a REPAIRED id (ratchet down)', both.removed.length === 1 && both.removed[0] === 'b');

  // The provenance sidecar is not a bundle. Pinned because the discovery groups
  // an out-dir by filename kind, so a future companion file lands in the
  // population by default and this is the only thing that keeps it out.
  expect(
    'the source-hashes provenance companion is NOT a translation bundle kind',
    isTranslationBundleKind('source-hashes.generated.ts') === false,
  );
  expect(
    'the real bundle kinds still are',
    isTranslationBundleKind('objects.generated.ts') && isTranslationBundleKind('metadata-forms.generated.ts'),
  );

  console.log(failures === 0 ? '\ncheck-i18n-stale-fill: self-test OK\n' : `\ncheck-i18n-stale-fill: self-test FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Run
//
// Behind `isEntrypoint` because this module EXPORTS its rules for the sibling
// gates and self-tests to import: without the guard, importing `findStaleFills`
// would run the whole gate inside the importer and exit its process — the
// silent-success direction `scripts/invoked-as.mjs` documents, and what
// `check:entry-guard` is there to catch.
// ---------------------------------------------------------------------------

function main() {
const sets = discoverBundleSets();

// #4690 / #10907: zero is a broken scan, not a repo with nothing to translate.
// Refused rather than returned — the shape that made an off-root run print the
// same sentence and the same exit code a real pass uses.
if (sets.length === 0) {
  console.error(
    `\ncheck-i18n-stale-fill: REFUSING TO JUDGE — no translation bundle set was found under ${PACKAGES_DIR}/.\n\n` +
      `  This gate reads ${PACKAGES_DIR}/ from its own location (${ROOT}), so an empty\n` +
      `  population is a broken scan, not a clean tree. Nothing was compared and the\n` +
      `  baseline was left exactly as committed.\n`,
  );
  process.exit(1);
}

const findings = [];
for (const set of sets) {
  const byLocale = {};
  for (const { locale, file } of set.members) {
    const parsed = parseBundleLiteral(readFileSync(at(file), 'utf8'));
    if (parsed.error) {
      console.error(`\ncheck-i18n-stale-fill: ${file} ${parsed.error}\n`);
      process.exit(1);
    }
    byLocale[locale] = collectLeaves(parsed.data);
  }
  for (const f of findStaleFills(byLocale)) {
    findings.push({ id: `${set.out}/${set.kind}#${f.path}`, ...f });
  }
}

const byId = new Map(findings.map((f) => [f.id, f]));
const found = [...byId.keys()].sort();
const baseline = existsSync(at(BASELINE_PATH)) ? JSON.parse(readFileSync(at(BASELINE_PATH), 'utf8')) : {};
const { added, removed } = ratchet(found, Object.keys(baseline).sort());

if (update) {
  // Rewrites the ledger from the CURRENT tree, carrying every existing reason
  // forward — a re-baseline must not quietly relabel entries a human classified.
  const next = {};
  for (const id of found) next[id] = baseline[id] ?? NEW_REASON;
  writeFileSync(at(BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `\ncheck-i18n-stale-fill: re-baselined ${found.length} stale-fill leaf/leaves from ` +
      `${sets.length} bundle set(s) into ${BASELINE_PATH} (+${added.length} / -${removed.length}).\n` +
      `Every new entry is recorded as "${NEW_REASON}" — classify it before committing.\n`,
  );
  process.exit(0);
}

console.log(`check-i18n-stale-fill: scanned ${sets.length} bundle set(s), ${found.length} stale-fill leaf/leaves, ${Object.keys(baseline).length} baselined.`);

if (added.length) {
  console.error(
    `\ncheck-i18n-stale-fill: ${added.length} NEW stale-fill leaf/leaves\n\n` +
      `Two or more translated locales carry byte-identical text that is NOT the current\n` +
      `source. Different languages do not independently produce identical prose — these\n` +
      `were filled from the source, and the source has moved since. The bundles are still\n` +
      `in sync by key, so \`check:i18n\` cannot see this and reports OK.\n`,
  );
  for (const id of added) {
    const f = byId.get(id);
    console.error(`  • ${id}`);
    console.error(`      locales : ${f.locales.join(', ')}`);
    console.error(`      source  : ${JSON.stringify(f.source)}`);
    console.error(`      serving : ${JSON.stringify(f.value)}`);
  }
  console.error(
    `\nFix at the bundle: re-translate each leaf above from the CURRENT source string and\n` +
      `commit it. \`os i18n extract\` will NOT do it for you — merge fills gaps only, and a\n` +
      `present-but-stale string is not a gap.\n\n` +
      `If a leaf above is a benign coincidence rather than drift, ratchet it in with\n` +
      `\`node scripts/check-i18n-stale-fill.mjs --update\` and record WHY in ${BASELINE_PATH}.\n`,
  );
  process.exit(1);
}

if (removed.length) {
  console.error(
    `\ncheck-i18n-stale-fill: ${removed.length} baselined leaf/leaves are no longer stale (improvement!)\n`,
  );
  for (const id of removed) console.error(`  • ${id}`);
  console.error(`\nRatchet the baseline down: \`node scripts/check-i18n-stale-fill.mjs --update\` and commit ${BASELINE_PATH}.\n`);
  process.exit(1);
}

console.log(`\ncheck-i18n-stale-fill: OK (${sets.length} bundle set(s) — no new stale fills, ${found.length} baselined).`);
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  main();
}
