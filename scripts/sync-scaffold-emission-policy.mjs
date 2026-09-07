#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Generate `create-objectstack`'s bundled-template version pins FROM the shared
// scaffold emission policy, and refuse a tree where the two have drifted.
//
//   node scripts/sync-scaffold-emission-policy.mjs            # write
//   node scripts/sync-scaffold-emission-policy.mjs --check    # verdict only, exit 1 on drift
//   node scripts/sync-scaffold-emission-policy.mjs --self-test
//
// ## The defect, and why a hand edit does not close it
//
// Three scaffolders emit a `package.json` for a new project: `os init`, `os
// create` and `npx create-objectstack`. The first two IMPORT the emission
// policy (`SCAFFOLD_*` in `packages/cli/src/commands/init.ts`); the third
// restated it, in a committed template file, and the restatement decayed —
// `typescript` sat at `^6.0.0` there while the policy said `^5.3.0`, so two
// projects created the same day got different TypeScript MAJORS depending on
// which documented entry point the reader followed.
//
// The structural cause is not carelessness: `create-objectstack` CANNOT import
// from `@objectstack/cli`. The dependency edge runs the other way (the CLI
// depends on this package for its `created-summary` renderer), so a reverse
// import is a cycle — and the package publishes as a two-dependency `npx`
// entry point that must not pull the CLI's ~50-package closure. Its emission is
// a committed template copied byte-for-byte, with no renderer to route through
// a constant.
//
// ⛔ So editing `^6.0.0` to `^5.3.0` by hand does NOT close this. The two
// values would agree today and diverge again the next time the policy moves,
// silently, for the same structural reason and with nothing red. What closes it
// is the repo's usual generated-file pattern: the values are GENERATED into the
// committed template at build time (`create-objectstack`'s `build` runs this
// script, the way `packages/spec`'s runs `gen:schema`), and `--check` is a gate
// that reddens the moment the inlined values disagree with the source.
//
// ## Which range survived, and the measurement behind it
//
// `^5.3.0`, the shared policy's value. The repo's OWN devDependency is
// `typescript@^6.0.3` in every workspace package — which is exactly the reading
// that could have made `^6.0.0` the right value and the policy the stale one.
// It does not, and the two facts are stated TOGETHER in one sentence on a live
// doc page (`content/docs/getting-started/index.mdx`): "ObjectStack works with
// TypeScript 5.3+, but the project itself is built and tested against
// TypeScript 6.x". The floor a scaffolded project DECLARES is a support
// promise to its user; the version this monorepo builds itself with is not that
// promise. `content/docs/deployment/troubleshooting.mdx` states the same floor
// again, and `init.ts` records the type-check measurement behind it (5.3.3
// checks every emitted shape with results identical to 6.0.3).
//
// ## Two failure contracts, both deliberately LOUD
//
// The sibling rewriter `sync-template-versions.mjs` carries the lesson this one
// is built on: its failure mode was loud for the keys it covered and MUTE for
// the key it did not, and `specVersion` drifted eleven majors inside that mute
// spot. So here:
//
//   * a policy constant that cannot be read out of the source is a THROW, never
//     a skipped stamp — a renamed or deleted `SCAFFOLD_*` export must red, not
//     quietly stop being enforced;
//   * a template `package.json` that does not DECLARE a stamped key is a hard
//     failure naming the path, never a template silently exempted. A new
//     template that genuinely should not declare `typescript` is a row to
//     reconsider in `POLICY_STAMPS`, not a file to skip.
//
// The template set is DISCOVERED by walking `src/templates/` — reused from
// `sync-template-versions.mjs` rather than restated, for the reason its header
// gives: a hand-kept list is what let the sibling drift.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';
import { TEMPLATE_DIR, TEMPLATE_PKG_FILE, findTemplateDirs } from './sync-template-versions.mjs';

/** The repo this script lives in — resolved from the script, so cwd cannot lie. */
const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The single source of the emission policy, repo-relative.
 *
 * `os init` declares these constants and `os create` imports them, so this file
 * is already the one definition for two of the three scaffolders; this script
 * is what extends it to the third across the package boundary that forbids an
 * import.
 */
export const POLICY_SOURCE = 'packages/cli/src/commands/init.ts';

/**
 * The stamps, as a table over (template JSON block, field, policy constant).
 *
 * Table-driven so that adding a fourth generated surface is a row and every row
 * shares ONE failure contract — the shape whose absence let the sibling
 * rewriter go mute on the one key it did not cover.
 *
 * Only the values that are POLICY are here. `@objectstack/*` ranges are stamped
 * from the scaffolder's own version by `sync-template-versions.mjs` and are not
 * this script's business; the two tables are disjoint by construction, which
 * `--self-test` pins.
 */
export const POLICY_STAMPS = [
  {
    key: 'engines.pnpm',
    block: 'engines',
    field: 'pnpm',
    constant: 'SCAFFOLD_PNPM_RANGE',
    // The minimum pnpm measured to honour the emitted `pnpm-workspace.yaml`'s
    // build allowlist. `os init` writes it from the same constant.
  },
  {
    key: 'devDependencies.typescript',
    block: 'devDependencies',
    field: 'typescript',
    constant: 'SCAFFOLD_TYPESCRIPT_RANGE',
    // The floor the docs already promise. This is the value that split three
    // ways across three scaffolders (#16485).
  },
];

/** Repo-relative, always POSIX-separated: these paths are git pathspecs downstream. */
const rel = (p) => relative(root, p).split(sep).join('/');

/**
 * Read one `export const <NAME> = '<value>';` out of the policy source.
 *
 * Exactly one declaration must match. Zero means the constant was renamed or
 * deleted and this script would otherwise stamp nothing while exiting 0; more
 * than one means the source no longer has a single answer to give. Both THROW —
 * this module is importable, and a library call that exits the host process is
 * not a usable declaration surface (`main()` turns the throw into the exit).
 */
export function readPolicyConstant(source, name, { label = POLICY_SOURCE } = {}) {
  const re = new RegExp(`^export const ${name}\\s*=\\s*'([^']*)';`, 'gm');
  const matches = [...source.matchAll(re)];
  if (matches.length === 0) {
    throw new Error(
      `sync-scaffold-emission-policy: ${label} declares no \`export const ${name} = '…';\`.\n` +
        'The emission policy is the SOURCE this script generates from — a renamed or deleted\n' +
        'constant must red here rather than silently stop being enforced. Either restore the\n' +
        'export or update the matching row in POLICY_STAMPS.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `sync-scaffold-emission-policy: ${label} declares \`${name}\` ${matches.length} times; ` +
        'the policy source must have exactly one answer per constant.',
    );
  }
  return matches[0][1];
}

/**
 * The whole policy, as `{ <constant>: <range> }` over every declared stamp.
 *
 * @param {string} [file] absolute path to the policy source
 */
export function readEmissionPolicy(file = join(root, POLICY_SOURCE)) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`sync-scaffold-emission-policy: cannot read policy source ${rel(file)}: ${err.message}`);
  }
  const label = rel(file);
  const policy = {};
  for (const stamp of POLICY_STAMPS) {
    policy[stamp.constant] = readPolicyConstant(source, stamp.constant, { label });
  }
  return policy;
}

/**
 * Every repo-relative path this script may write, across ALL template dirs.
 *
 * Zero templates THROWS rather than returning `[]`, for the same reason the run
 * refuses a vacuous green: an empty set reads exactly like "nothing to stamp"
 * and means "the directory moved".
 *
 * @param {{ root?: string }} [options] checkout to walk; defaults to this one
 */
export function stampedPolicyPaths({ root: base = root } = {}) {
  const templates = findTemplateDirs(join(base, TEMPLATE_DIR));
  if (templates.length === 0) {
    throw new Error(
      `sync-scaffold-emission-policy: no template directories under ${TEMPLATE_DIR}. Every bundled\n` +
        'template carries the emission policy, so this is almost certainly a moved directory rather\n' +
        'than an empty one — refusing to report an empty stamped-path set.',
    );
  }
  return templates.map((template) => `${TEMPLATE_DIR}/${template}/${TEMPLATE_PKG_FILE}`).sort();
}

/**
 * The `[start, end)` span of the object literal `"<blockKey>": { … }` in JSON
 * text, with string contents skipped so a brace inside a value cannot end it.
 */
function findBlockSpan(text, blockKey, label) {
  const opens = [...text.matchAll(new RegExp(`"${blockKey}"\\s*:\\s*\\{`, 'g'))];
  if (opens.length !== 1) {
    throw new Error(
      `sync-scaffold-emission-policy: ${label} declares the \`${blockKey}\` object ${opens.length} time(s); ` +
        'exactly one is required so a targeted rewrite cannot land in the wrong block.',
    );
  }
  const start = opens[0].index + opens[0][0].length - 1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { start, end: i + 1 };
  }
  throw new Error(`sync-scaffold-emission-policy: ${label} has an unterminated \`${blockKey}\` object.`);
}

/**
 * Apply every stamp to one template `package.json`, as TEXT.
 *
 * Rewritten by targeted replacement rather than parse/re-serialize so a run
 * touches the stamped values and nothing else — the same reason the sibling
 * rewriter is text-based. The PARSE is still done, and its value is compared
 * against the one the text pattern found: two independent reads that must
 * agree, so a pattern that matched the wrong span cannot pass unnoticed.
 *
 * @returns {{ text: string, drift: Array<{ key: string, from: string, to: string }> }}
 */
export function stampPolicy(text, policy, { label = TEMPLATE_PKG_FILE } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`sync-scaffold-emission-policy: ${label} could not be read as JSON: ${err.message}`);
  }
  let out = text;
  const drift = [];
  for (const stamp of POLICY_STAMPS) {
    const expected = policy[stamp.constant];
    if (typeof expected !== 'string' || expected === '') {
      throw new Error(`sync-scaffold-emission-policy: no policy value for ${stamp.constant}.`);
    }
    const declared = parsed?.[stamp.block]?.[stamp.field];
    if (typeof declared !== 'string') {
      throw new Error(
        `sync-scaffold-emission-policy: ${label} declares no \`${stamp.key}\`.\n` +
          'Every bundled template carries the whole emission policy — a template that omits a\n' +
          'stamped key would be silently exempt from it, which is the mute-failure class this\n' +
          'script exists to close. Declare the key, or reconsider the POLICY_STAMPS row.',
      );
    }
    const span = findBlockSpan(out, stamp.block, label);
    const block = out.slice(span.start, span.end);
    const field = new RegExp(`("${stamp.field}"\\s*:\\s*)"([^"]*)"`, 'g');
    const hits = [...block.matchAll(field)];
    if (hits.length !== 1) {
      throw new Error(
        `sync-scaffold-emission-policy: ${label} matches \`${stamp.key}\` ${hits.length} time(s) as text ` +
          'while JSON.parse found it once — refusing to rewrite a span this script cannot locate exactly.',
      );
    }
    if (hits[0][2] !== declared) {
      throw new Error(
        `sync-scaffold-emission-policy: ${label} — the text match for \`${stamp.key}\` reads ` +
          `"${hits[0][2]}" but JSON.parse reads "${declared}". The rewrite would land somewhere ` +
          'other than the value being checked.',
      );
    }
    if (declared === expected) continue;
    drift.push({ key: stamp.key, from: declared, to: expected });
    out =
      out.slice(0, span.start) +
      block.replace(field, `$1"${expected}"`) +
      out.slice(span.end);
  }
  return { text: out, drift };
}

// ---------------------------------------------------------------------------

/** @param {{ check: boolean, base?: string }} options */
export function run({ check, base = root }) {
  const policy = readEmissionPolicy(join(base, POLICY_SOURCE));
  const paths = stampedPolicyPaths({ root: base });
  const drifted = [];
  let clean = 0;

  for (const path of paths) {
    const abs = join(base, path);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch (err) {
      throw new Error(`sync-scaffold-emission-policy: cannot read ${path}: ${err.message}`);
    }
    const result = stampPolicy(text, policy, { label: path });
    if (result.drift.length === 0) {
      clean++;
      console.log(`  ${path} already emits the shared policy`);
      continue;
    }
    for (const d of result.drift) drifted.push({ path, ...d });
    if (!check) {
      writeFileSync(abs, result.text);
      for (const d of result.drift) console.log(`  ${path}: ${d.key} ${d.from} -> ${d.to}`);
    }
  }

  const declared = Object.entries(policy)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');

  if (check && drifted.length > 0) {
    console.error(
      `\n✗ create-objectstack's bundled templates have drifted from the shared emission policy.\n` +
        `  Policy source: ${POLICY_SOURCE} (${declared})\n`,
    );
    for (const d of drifted) {
      console.error(`  ${d.path}: ${d.key} is "${d.from}" but the policy declares "${d.to}"`);
    }
    console.error(
      '\n  These values are GENERATED, not authored — ⛔ do not hand-edit them into agreement,\n' +
        '  which is what let them diverge in the first place. Regenerate:\n' +
        '\n      pnpm gen:scaffold-emission-policy\n' +
        '\n  and commit the result. To change what a scaffolded project DECLARES, move the\n' +
        `  constant in ${POLICY_SOURCE} — all three scaffolders follow it.\n`,
    );
    return 1;
  }

  console.log(
    check
      ? `✓ check:scaffold-emission-policy: ${paths.length} bundled template(s) emit the shared policy (${declared}).`
      : `✓ sync-scaffold-emission-policy: ${paths.length} bundled template(s) in lockstep with ${POLICY_SOURCE} ` +
          `(${declared}); ${clean} already clean, ${drifted.length} value(s) rewritten.`,
  );
  return 0;
}

function main() {
  const check = process.argv.includes('--check');
  try {
    process.exit(run({ check }));
  } catch (err) {
    console.error(`\n✗ ${err.message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

// Every section opens with `battery(<name>)` and every assertion is attributed
// to the battery most recently opened, so "the cases never ran" cannot print the
// same line as "every case held". The counts are a FLOOR — adding cases is
// ordinary work — and a battery BELOW its floor means cases stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'A: a CLEAN corpus is REACHED, and left byte-identical and UNWRITTEN': 6,
  'B: DRIFT is rewritten, and --check reds on it first': 8,
  'C: a renamed policy constant is a hard failure, never a silent skip': 3,
  'D: a template omitting a stamped key exits 1 naming the path': 3,
  'E: an unparseable template package.json exits 1 naming it': 2,
  'F: zero templates refuses a vacuous green': 2,
  'G: the stamp table and the sibling rewriter do not both own a value': 2,
});
const SELF_TEST_BATTERY_FLOOR = 7;
const UNATTRIBUTED_BATTERY = '(no battery open)';
const SELF_TEST_VERDICT = 'sync-scaffold-emission-policy self-test reached its verdict';

const SELF_TEST_POLICY = { SCAFFOLD_PNPM_RANGE: '>=99.1', SCAFFOLD_TYPESCRIPT_RANGE: '^9.9.9' };
const STALE = { SCAFFOLD_PNPM_RANGE: '>=1.0', SCAFFOLD_TYPESCRIPT_RANGE: '^1.0.0' };

function policySource(policy = SELF_TEST_POLICY) {
  return [
    '// fixture policy source',
    `export const SCAFFOLD_PNPM_RANGE = '${policy.SCAFFOLD_PNPM_RANGE}';`,
    '',
    `export const SCAFFOLD_TYPESCRIPT_RANGE = '${policy.SCAFFOLD_TYPESCRIPT_RANGE}';`,
    '',
  ].join('\n');
}

function templatePkg(policy) {
  return `${JSON.stringify(
    {
      name: 'objectstack-fixture',
      private: true,
      engines: { pnpm: policy.SCAFFOLD_PNPM_RANGE },
      dependencies: { '@objectstack/spec': '^17.0.0' },
      devDependencies: { '@objectstack/cli': '^17.0.0', typescript: policy.SCAFFOLD_TYPESCRIPT_RANGE },
    },
    null,
    2,
  )}\n`;
}

function buildFixture(dir, { templates = ['blank', 'second'], policy = SELF_TEST_POLICY, templatePolicy = policy } = {}) {
  const scripts = join(dir, 'scripts');
  mkdirSync(scripts, { recursive: true });
  for (const file of ['sync-scaffold-emission-policy.mjs', 'sync-template-versions.mjs', 'invoked-as.mjs']) {
    cpSync(join(root, 'scripts', file), join(scripts, file));
  }
  mkdirSync(join(dir, dirname(POLICY_SOURCE)), { recursive: true });
  writeFileSync(join(dir, POLICY_SOURCE), policySource(policy));
  for (const template of templates) {
    mkdirSync(join(dir, TEMPLATE_DIR, template), { recursive: true });
    writeFileSync(join(dir, TEMPLATE_DIR, template, TEMPLATE_PKG_FILE), templatePkg(templatePolicy));
  }
  return join(scripts, 'sync-scaffold-emission-policy.mjs');
}

function runFixture(script, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function selfTest() {
  const failures = [];
  const opened = new Map();
  let battery = UNATTRIBUTED_BATTERY;
  let checked = 0;
  const open = (name) => {
    battery = name;
    if (!opened.has(name)) opened.set(name, 0);
  };
  const ok = (cond, what) => {
    checked++;
    opened.set(battery, (opened.get(battery) ?? 0) + 1);
    console.log(`  ${cond ? '✓' : '✗'} [${battery}] ${what}`);
    if (!cond) failures.push(`[${battery}] ${what}`);
  };
  const sandbox = (fn, options) => {
    const dir = mkdtempSync(join(tmpdir(), 'scaffold-policy-'));
    try {
      return fn(dir, buildFixture(dir, options));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const readTemplates = (dir, templates = ['blank', 'second']) =>
    templates.map((t) => readFileSync(join(dir, TEMPLATE_DIR, t, TEMPLATE_PKG_FILE), 'utf8'));

  open('A: a CLEAN corpus is REACHED, and left byte-identical and UNWRITTEN');
  sandbox((dir, script) => {
    const before = readTemplates(dir);
    const write = runFixture(script);
    ok(write.status === 0, 'a clean corpus exits 0 on a write run');
    ok(write.output.includes('blank/package.json already emits'), 'the run REACHED blank and judged it clean');
    ok(write.output.includes('second/package.json already emits'), 'the run REACHED second — the walk is not a literal');
    ok(readTemplates(dir).every((t, i) => t === before[i]), 'a clean corpus is left BYTE-IDENTICAL');
    const check = runFixture(script, ['--check']);
    ok(check.status === 0, '--check exits 0 on a clean corpus');
    ok(check.output.includes('>=99.1') && check.output.includes('^9.9.9'), 'the verdict names the policy it enforced');
  });

  open('B: DRIFT is rewritten, and --check reds on it first');
  sandbox(
    (dir, script) => {
      const before = readTemplates(dir);
      ok(before[0].includes('^1.0.0'), 'the fixture really is STALE — a clean one would prove nothing here');
      const check = runFixture(script, ['--check']);
      ok(check.status === 1, '--check EXITS 1 on drift');
      ok(check.output.includes('devDependencies.typescript is "^1.0.0"'), '--check names the key and the found value');
      ok(check.output.includes('"^9.9.9"'), '--check names the value the policy declares');
      ok(check.output.includes('pnpm gen:scaffold-emission-policy'), '--check names the remedy');
      ok(readTemplates(dir).every((t, i) => t === before[i]), '--check WROTE NOTHING');
      const write = runFixture(script);
      ok(write.status === 0, 'the write run exits 0');
      const after = readTemplates(dir);
      ok(
        after.every((t) => t.includes('"typescript": "^9.9.9"') && t.includes('"pnpm": ">=99.1"') && t.includes('"@objectstack/spec": "^17.0.0"')),
        'EVERY template now emits the policy, with the @objectstack/* ranges untouched',
      );
      ok(runFixture(script, ['--check']).status === 0, '--check is green after the rewrite (idempotent)');
    },
    { templatePolicy: STALE },
  );

  open('C: a renamed policy constant is a hard failure, never a silent skip');
  sandbox((dir, script) => {
    writeFileSync(
      join(dir, POLICY_SOURCE),
      policySource().replace('SCAFFOLD_TYPESCRIPT_RANGE', 'SCAFFOLD_TS_RANGE_RENAMED'),
    );
    const r = runFixture(script, ['--check']);
    ok(r.status === 1, 'a renamed constant EXITS 1 rather than stamping the rest and passing');
    ok(r.output.includes('SCAFFOLD_TYPESCRIPT_RANGE'), 'the failure names the constant it could not read');
    ok(r.output.includes(POLICY_SOURCE), 'the failure names the policy source');
  });

  open('D: a template omitting a stamped key exits 1 naming the path');
  sandbox((dir, script) => {
    const pkg = JSON.parse(readFileSync(join(dir, TEMPLATE_DIR, 'second', TEMPLATE_PKG_FILE), 'utf8'));
    delete pkg.devDependencies.typescript;
    writeFileSync(join(dir, TEMPLATE_DIR, 'second', TEMPLATE_PKG_FILE), `${JSON.stringify(pkg, null, 2)}\n`);
    const r = runFixture(script, ['--check']);
    ok(r.status === 1, 'a template that omits a stamped key EXITS 1 — never a silent exemption');
    ok(r.output.includes('second/package.json'), 'the failure names the template path');
    ok(r.output.includes('devDependencies.typescript'), 'the failure names the missing key');
  });

  open('E: an unparseable template package.json exits 1 naming it');
  sandbox((dir, script) => {
    writeFileSync(join(dir, TEMPLATE_DIR, 'blank', TEMPLATE_PKG_FILE), '{ not json\n');
    const r = runFixture(script, ['--check']);
    ok(r.status === 1, 'an unparseable template EXITS 1');
    ok(r.output.includes('blank/package.json') && r.output.includes('could not be read as JSON'), 'it names the file');
  });

  open('F: zero templates refuses a vacuous green');
  sandbox(
    (dir, script) => {
      rmSync(join(dir, TEMPLATE_DIR, 'blank'), { recursive: true, force: true });
      const r = runFixture(script, ['--check']);
      ok(r.status === 1, 'an empty templates directory EXITS 1 rather than reporting nothing to do');
      ok(r.output.includes(TEMPLATE_DIR), 'the refusal names the directory it walked');
    },
    { templates: ['blank'] },
  );

  open('G: the stamp table and the sibling rewriter do not both own a value');
  ok(POLICY_STAMPS.length > 0, 'the stamp table is non-empty — an empty table would make every case above vacuous');
  ok(
    POLICY_STAMPS.every((s) => !s.field.startsWith('@objectstack/')),
    'no row claims an @objectstack/* range — those belong to sync-template-versions.mjs',
  );

  const missing = Object.keys(SELF_TEST_BATTERIES).filter((n) => !opened.has(n));
  const extra = [...opened.keys()].filter((n) => !(n in SELF_TEST_BATTERIES));
  const below = [...opened].filter(([n, c]) => n in SELF_TEST_BATTERIES && c < SELF_TEST_BATTERIES[n]);
  if (missing.length || extra.length || below.length || opened.size < SELF_TEST_BATTERY_FLOOR) {
    console.error(
      '\n✗ sync-scaffold-emission-policy self-test: the battery roster does not hold.\n' +
        `  never opened: ${JSON.stringify(missing)}\n  unattributed/unknown: ${JSON.stringify(extra)}\n` +
        `  below floor: ${JSON.stringify(below)}\n  batteries opened: ${opened.size} (floor ${SELF_TEST_BATTERY_FLOOR})\n` +
        '  A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the number.\n',
    );
    return 'roster failed';
  }
  if (failures.length) {
    console.error(`\n✗ sync-scaffold-emission-policy self-test: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    return 'assertions failed';
  }
  console.log(
    `✓ sync-scaffold-emission-policy --self-test: ${checked} assertions over temp fixtures, running the real CLI. ` +
      'A CLEAN corpus is observed REACHED, byte-identical and UNWRITTEN; DRIFT is observed reddening --check ' +
      'BEFORE the rewrite and green after it; and a renamed policy constant, a template omitting a stamped key, ' +
      'an unparseable template and an empty templates directory are each observed exiting 1 and naming the path.',
  );
  return SELF_TEST_VERDICT;
}

// Entry-point guard: this file is importable, and an import that rewrote every
// bundled template as a side effect is strictly worse than a missing export.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ sync-scaffold-emission-policy self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
          'finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    main();
  }
}
