#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-skill-top-level-keys — the published platform skill's `defineStack()`
 * top-level key enumeration is reconciled, in BOTH directions, against the
 * keys `ObjectStackDefinitionSchema` declares.
 *
 *   node scripts/check-skill-top-level-keys.mjs                  # the gate
 *   node scripts/check-skill-top-level-keys.mjs --skill <path>   # judge another copy of the page (a git blob, a fixture)
 *   node scripts/check-skill-top-level-keys.mjs --self-test      # verify the checker itself, offline
 *
 * ## Why
 *
 * The enumeration is where an AI author learns which keys `defineStack()`
 * accepts, on the same page that says the top level REFUSES an unknown key.
 * Nothing read it: the schema gained `packages`, then `onEnable`, then
 * `devHint` and `devLogins`, and the list stayed at 40 — an author following
 * it could not find four legal, runtime-honoured keys. The four existing
 * readers of this file judge other things (the decision frame, table-row
 * liveness, the token ceiling, the compatibility line). The liveness gate's
 * Leg 2 is the nearest shape and still not this one: it is one-directional (a
 * member with no row), section-scoped (this section also quotes the phantom
 * keys the top level refuses, which a section pool would read as documented),
 * and its extractor reads enums and literal unions, not an object literal's
 * keys. So: one sentence, one table, one symmetric difference.
 *
 * ## The two sides
 *
 *   schema  the keys of `COMPOSE_KEY_DISPOSITIONS`, read out of the SOURCE
 *           TEXT of stack.zod.ts. The table is total over the schema's declared
 *           keys (`satisfies Record<StackDefinitionKey, …>`; the runtime pin
 *           compose-key-dispositions-export.pin.test.ts holds it equal to the
 *           schema's shape both ways), so its keys ARE the top-level key set.
 *           Source text, not an import: this gate runs in the job that precedes
 *           the workspace build, and a fresh worktree has no dist to import. A
 *           lit control refuses a read of fewer than 40 keys or one without
 *           `manifest` — an extraction that stops matching must say so.
 *   prose   every backticked identifier after the words "top-level key" in the
 *           paragraph that opens with `defineStack()` accepts an
 *           `ObjectStackDefinitionInput`. An absent anchor is a prerequisite
 *           failure, never an empty set compared green.
 *
 * ## Machine-written keys are declared out, and each declaration is checked
 *
 * Two schema keys are not an author's to write: `viewItems` is typed `z.never`
 * (the machine-assembled channel) and `runtimeModule` is written by
 * `objectstack build` ("do not author by hand", per its own describe). Listing
 * either would teach exactly the trap the page warns about. Each exclusion
 * carries a WITNESS that must still match the key's declaration in the schema
 * source; a witness that stops matching is a prerequisite failure, so an
 * exclusion cannot outlive its reason. The table is small on purpose.
 *
 * ## Exit codes
 *
 *   0  the two sets are equal
 *   1  drift — every key named with its direction and the remedy
 *   2  prerequisite not met — an unreadable input, the anchor paragraph or
 *      the table absent, the lit control failed, a stale witness. Never 0.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKILL_PATH = 'skills/objectstack-platform/SKILL.md';
const SCHEMA_PATH = 'packages/spec/src/stack.zod.ts';
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';
const EXIT_CLEAN = 0;
const EXIT_DRIFT = 1;
const EXIT_PREREQUISITE = 2;
const LIT_CONTROL_FLOOR = 40;
const ANCHOR = '`defineStack()` accepts an `ObjectStackDefinitionInput`';
const LEAD_IN = 'top-level key';
/** The contract the page states, quoted in the drift text; a lit control below holds the page to it. */
const PAGE_CONTRACT = 'the top level refuses it and the stack fails to load';

/** Schema keys no author writes. `witness` must still match the schema source on every run. */
const NOT_AUTHORED = Object.freeze([
  { key: 'viewItems', witness: /^\s*viewItems:\s*z\.never\(/m, why: 'typed z.never — the machine-assembled channel; an authored value is refused' },
  { key: 'runtimeModule', witness: /^\s*runtimeModule:[^\n]*do not author by hand/m, why: 'written by objectstack build; its describe says do not author by hand' },
]);

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** @returns {{keys: string[]} | {error: string}} */
function schemaKeys(source) {
  const m = /export const COMPOSE_KEY_DISPOSITIONS = Object\.freeze\(\{([\s\S]*?)\}\s*as const satisfies Record<StackDefinitionKey/.exec(source);
  if (!m) {
    return { error: `${SCHEMA_PATH} no longer declares COMPOSE_KEY_DISPOSITIONS as Object.freeze({ … } as const satisfies Record<StackDefinitionKey, …>) — re-point the extraction; that table is the top-level key set.` };
  }
  const keys = [...stripComments(m[1]).matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*'[a-z]+'\s*,?\s*$/gm)].map((x) => x[1]);
  if (keys.length < LIT_CONTROL_FLOOR || !keys.includes('manifest')) {
    return { error: `lit control failed: ${keys.length} key(s) read out of COMPOSE_KEY_DISPOSITIONS (floor ${LIT_CONTROL_FLOOR}, must include manifest) — the extraction no longer reads the table.` };
  }
  return { keys };
}

/** @returns {{keys: string[], line: number} | {error: string}} */
function proseKeys(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(ANCHOR));
  if (start < 0) return { error: `anchor paragraph absent: no line opens with ${ANCHOR} — the enumeration moved or was reworded; re-point ANCHOR.` };
  let end = start;
  while (end < lines.length && lines[end].trim() !== '') end += 1;
  const para = lines.slice(start, end).join('\n');
  const at = para.indexOf(LEAD_IN);
  if (at < 0) return { error: `anchor paragraph carries no "${LEAD_IN}" lead-in, so where the enumeration starts is undecidable — re-point LEAD_IN.` };
  return { keys: [...para.slice(at).matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((x) => x[1]), line: start + 1 };
}

/** @returns {{exit: number, lines: string[]}} */
function judge(skillText, schemaText, skillLabel = SKILL_PATH) {
  const s = schemaKeys(schemaText);
  if (s.error) return { exit: EXIT_PREREQUISITE, lines: [`PREREQUISITE NOT MET: ${s.error}`] };
  const p = proseKeys(skillText);
  if (p.error) return { exit: EXIT_PREREQUISITE, lines: [`PREREQUISITE NOT MET: ${skillLabel}: ${p.error}`] };
  const stale = NOT_AUTHORED.filter((e) => !e.witness.test(schemaText) || !s.keys.includes(e.key));
  if (stale.length) {
    return { exit: EXIT_PREREQUISITE, lines: stale.map((e) => `PREREQUISITE NOT MET: stale exclusion — NOT_AUTHORED declares \`${e.key}\` (${e.why}), and its witness no longer matches ${SCHEMA_PATH} or the key is gone. The exclusion's written reason no longer holds: delete the row, or re-witness it against the declaration as it now reads.`) };
  }
  const excluded = new Set(NOT_AUTHORED.map((e) => e.key));
  const authorable = s.keys.filter((k) => !excluded.has(k));
  const missing = authorable.filter((k) => !p.keys.includes(k));
  const phantom = [...new Set(p.keys)].filter((k) => !authorable.includes(k));
  const duplicated = [...new Set(p.keys.filter((k, i) => p.keys.indexOf(k) !== i))];
  const where = `${skillLabel}:${p.line}`;
  const lines = [];
  for (const k of missing) {
    lines.push(`[missing] \`${k}\` is a top-level key ObjectStackDefinitionSchema declares (${SCHEMA_PATH}) and the enumeration at ${where} does not list it. The page tells the author that an unknown key means "${PAGE_CONTRACT}", so a key absent from this list is a key no AI author will write. REMEDY: name it in the enumeration.`);
  }
  for (const k of phantom) {
    const tag = excluded.has(k) ? ` — the schema declares it MACHINE-WRITTEN (${NOT_AUTHORED.find((e) => e.key === k).why})` : '';
    lines.push(`[phantom] \`${k}\` is listed in the enumeration at ${where} and is not a top-level key an author may write${tag}. The page's own contract for such a key is "${PAGE_CONTRACT}", so an author copying this list ships a refused stack. REMEDY: delete it from the enumeration. Declaring a key machine-written is a NOT_AUTHORED row with a witness, and that decision is ${RATCHET_AUTHORITY_MARKER}.`);
  }
  for (const k of duplicated) lines.push(`[duplicate] \`${k}\` is listed more than once at ${where}. REMEDY: list each key once.`);
  if (lines.length) return { exit: EXIT_DRIFT, lines };
  return { exit: EXIT_CLEAN, lines: [`✓ check-skill-top-level-keys: ${where} enumerates all ${authorable.length} authorable top-level keys of ObjectStackDefinitionSchema (${excluded.size} declared machine-written and held out: ${[...excluded].join(', ')}).`] };
}

function readInput(path, label) {
  try { return { text: readFileSync(path, 'utf8') }; } catch (e) {
    return { error: `PREREQUISITE NOT MET: cannot read ${label} at ${path} (${e.code || e.message}). A gate that cannot find its input must fail, never skip.` };
  }
}

// ── Self-test: batteries, floor, handshake ──────────────────────────────────
//
// Table-driven; the ROW is the battery, `registerCase(c.label)` is the first
// statement of the loop body, and the verdict flag below is set only after the
// success line prints. A pinned TOTAL would let a deleted row delete its floor.
let selfTestReachedVerdict = false;
const SELF_TEST_BATTERIES = Object.freeze({
  'clean — the prose set equals the authorable set → exit 0': 1,
  'the reproduction — the enumeration as published before this gate misses exactly four keys → exit 1 naming them, no phantom': 1,
  'a key in the prose the schema does not declare → exit 1 [phantom]': 1,
  'a machine-written key listed in the prose → exit 1 [phantom], tagged MACHINE-WRITTEN': 1,
  'a key listed twice → exit 1 [duplicate]': 1,
  'the phantom remedy names the exclusion table as a maintainer decision': 1,
  'a comment inside the table is not a key': 1,
  'anchor paragraph absent → exit 2, never 0': 1,
  'the table absent from the schema source → exit 2': 1,
  'lit control — a table of fewer than 40 keys → exit 2': 1,
  'a stale exclusion witness → exit 2 (self-invalidating)': 1,
  'an unreadable input path → exit 2 naming it': 1,
  'live tree — the real schema yields ≥ 40 keys including manifest, packages, onEnable, devHint, devLogins': 1,
  'live tree — the real page carries the anchor and the contract sentence the drift text quotes': 1,
});
const SELF_TEST_BATTERY_FLOOR = 14;

function selfTest() {
  const KEYS = ['manifest', 'objects', 'functions', 'packages', 'datasources', 'datasourceMapping', 'translations', 'objectExtensions', 'apps', 'views', 'viewItems', 'pages', 'dashboards', 'reports', 'datasets', 'actions', 'flows', 'jobs', 'emailTemplates', 'docs', 'books', 'positions', 'permissions', 'capabilities', 'sharingRules', 'apis', 'webhooks', 'agents', 'tools', 'skills', 'hooks', 'mappings', 'analyticsCubes', 'connectors', 'data', 'plugins', 'requires', 'tiers', 'devPlugins', 'devLogins', 'api', 'server', 'runtimeModule', 'devHint', 'onEnable', 'i18n'];
  const schemaOf = (keys, { witnesses = true, rows = '' } = {}) => `${witnesses ? '  viewItems: z.never({\n  runtimeModule: z.string().optional().describe(\'Set by build; do not author by hand.\'),\n' : ''}export const COMPOSE_KEY_DISPOSITIONS = Object.freeze({\n  // ── a section heading ──\n${keys.map((k) => `  ${k}: 'concat',`).join('\n')}\n${rows}} as const satisfies Record<StackDefinitionKey, ComposeDisposition>);\n`;
  const pageOf = (keys) => `# Page\n\n${ANCHOR} whose top-level keys\nare ${keys.map((k) => `\`${k}\``).join(', ')}.\n\nA phantom key is not a silent no-op — ${PAGE_CONTRACT}.\n`;
  const AUTHORABLE = KEYS.filter((k) => k !== 'viewItems' && k !== 'runtimeModule');
  // The enumeration exactly as the published page carried it before this gate — the shape the card reproduced.
  const PUBLISHED_BEFORE = '# Page\n\n' + ANCHOR + '. Each top-level key\nholds one metadata kind — `manifest`, `objects`, `objectExtensions`,\n`views`, `apps`, `pages`, `dashboards`, `reports`, `datasets`,\n`actions`, `flows`, `jobs`, `emailTemplates`, `docs`, `books`,\n`positions`, `permissions`, `capabilities`, `sharingRules`, `apis`,\n`webhooks`, `api`, `server`, `agents`, `tools`, `skills`, `hooks`,\n`functions`, `mappings`, `analyticsCubes`, `connectors`, `data` (seed),\n`datasources`, `datasourceMapping`, `translations`, `i18n`, `plugins`,\n`devPlugins`, `requires`, `tiers`.\n\nnext paragraph\n';
  const real = { skill: readFileSync(join(REPO_ROOT, SKILL_PATH), 'utf8'), schema: readFileSync(join(REPO_ROOT, SCHEMA_PATH), 'utf8') };
  const named = (r, tag) => r.lines.filter((l) => l.startsWith(tag)).map((l) => /`([^`]+)`/.exec(l)[1]).sort();
  const cases = [
    { label: 'clean — the prose set equals the authorable set → exit 0', run: () => judge(pageOf(AUTHORABLE), schemaOf(KEYS)).exit === EXIT_CLEAN },
    { label: 'the reproduction — the enumeration as published before this gate misses exactly four keys → exit 1 naming them, no phantom', run: () => { const r = judge(PUBLISHED_BEFORE, schemaOf(KEYS)); return r.exit === EXIT_DRIFT && named(r, '[missing]').join(',') === 'devHint,devLogins,onEnable,packages' && named(r, '[phantom]').length === 0; } },
    { label: 'a key in the prose the schema does not declare → exit 1 [phantom]', run: () => { const r = judge(pageOf([...AUTHORABLE, 'policies']), schemaOf(KEYS)); return r.exit === EXIT_DRIFT && named(r, '[phantom]').join() === 'policies' && !r.lines[0].includes('MACHINE-WRITTEN'); } },
    { label: 'a machine-written key listed in the prose → exit 1 [phantom], tagged MACHINE-WRITTEN', run: () => { const r = judge(pageOf([...AUTHORABLE, 'viewItems']), schemaOf(KEYS)); return r.exit === EXIT_DRIFT && named(r, '[phantom]').join() === 'viewItems' && r.lines[0].includes('MACHINE-WRITTEN'); } },
    { label: 'a key listed twice → exit 1 [duplicate]', run: () => { const r = judge(pageOf([...AUTHORABLE, 'apps']), schemaOf(KEYS)); return r.exit === EXIT_DRIFT && named(r, '[duplicate]').join() === 'apps'; } },
    { label: 'the phantom remedy names the exclusion table as a maintainer decision', run: () => judge(pageOf([...AUTHORABLE, 'policies']), schemaOf(KEYS)).lines[0].includes(`NOT_AUTHORED row with a witness, and that decision is ${RATCHET_AUTHORITY_MARKER}`) },
    { label: 'a comment inside the table is not a key', run: () => judge(pageOf(AUTHORABLE), schemaOf(KEYS, { rows: "  // ghost: 'single',\n  /* other: 'single', */\n" })).exit === EXIT_CLEAN },
    { label: 'anchor paragraph absent → exit 2, never 0', run: () => { const r = judge('# Page\n\nno enumeration here\n', schemaOf(KEYS)); return r.exit === EXIT_PREREQUISITE && r.lines[0].includes('anchor paragraph absent'); } },
    { label: 'the table absent from the schema source → exit 2', run: () => { const r = judge(pageOf(AUTHORABLE), 'export const SOMETHING_ELSE = {};\n'); return r.exit === EXIT_PREREQUISITE && r.lines[0].includes('no longer declares COMPOSE_KEY_DISPOSITIONS'); } },
    { label: 'lit control — a table of fewer than 40 keys → exit 2', run: () => { const r = judge(pageOf(AUTHORABLE), schemaOf(KEYS.slice(0, 12))); return r.exit === EXIT_PREREQUISITE && r.lines[0].includes('lit control failed'); } },
    { label: 'a stale exclusion witness → exit 2 (self-invalidating)', run: () => { const r = judge(pageOf(AUTHORABLE), schemaOf(KEYS, { witnesses: false })); return r.exit === EXIT_PREREQUISITE && r.lines.length === 2 && r.lines.every((l) => l.includes('stale exclusion')); } },
    { label: 'an unreadable input path → exit 2 naming it', run: () => { const r = readInput(join(REPO_ROOT, 'skills', 'no-such-skill-6f2a', 'SKILL.md'), 'the page'); return Boolean(r.error) && r.error.includes('no-such-skill-6f2a') && r.error.startsWith('PREREQUISITE NOT MET'); } },
    { label: 'live tree — the real schema yields ≥ 40 keys including manifest, packages, onEnable, devHint, devLogins', run: () => { const s = schemaKeys(real.schema); return !s.error && s.keys.length >= LIT_CONTROL_FLOOR && ['manifest', 'packages', 'onEnable', 'devHint', 'devLogins'].every((k) => s.keys.includes(k)); } },
    { label: 'live tree — the real page carries the anchor and the contract sentence the drift text quotes', run: () => !proseKeys(real.skill).error && real.skill.includes(PAGE_CONTRACT) },
  ];
  const seen = new Map();
  let failed = 0;
  for (const c of cases) {
    seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
    let ok = false;
    try { ok = c.run(); } catch (e) { console.error(`  ✗ ${c.label} — threw ${e.message}`); failed += 1; continue; }
    if (ok) console.log(`  ✓ ${c.label}`); else { console.error(`  ✗ ${c.label}`); failed += 1; }
  }
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = (msg) => { console.error(`✗ self-test floor: ${msg}`); failed += 1; };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  for (const [name, n] of seen) if (!declared.includes(name)) floor(`case "${name}" is attributed to no declared battery.`);
  for (const name of declared) if ((seen.get(name) ?? 0) < SELF_TEST_BATTERIES[name]) floor(`battery "${name}" DID NOT RUN (${seen.get(name) ?? 0} of ${SELF_TEST_BATTERIES[name]} pinned).`);
  if (failed > 0) { console.error(`\n✗ check-skill-top-level-keys self-test: ${failed} failure(s) (cases and floor).`); process.exit(1); }
  console.log(`\n✓ check-skill-top-level-keys self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) { console.error('\n✗ check-skill-top-level-keys self-test: selfTest() returned without reaching its verdict.'); process.exit(1); }
    return;
  }
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : join(REPO_ROOT, fallback); };
  const skillPath = flag('--skill', SKILL_PATH);
  const skill = readInput(skillPath, 'the page');
  const schema = readInput(flag('--schema', SCHEMA_PATH), 'the schema source');
  const early = [skill, schema].filter((r) => r.error).map((r) => r.error);
  if (early.length) { for (const l of early) console.error(l); process.exit(EXIT_PREREQUISITE); }
  const label = argv.includes('--skill') ? skillPath : SKILL_PATH;
  const verdict = judge(skill.text, schema.text, label);
  for (const l of verdict.lines) (verdict.exit === EXIT_CLEAN ? console.log : console.error)(l);
  process.exit(verdict.exit);
}

main();
