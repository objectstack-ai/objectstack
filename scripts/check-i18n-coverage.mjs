#!/usr/bin/env node
// check-i18n-coverage — declared-label translation ratchet for the bundled examples.
//
// #3370 made `os lint` gate the WHOLE declared surface (inline object actions,
// action params / resultDialog, listViews, apps / dashboards / pages), not just
// object and field labels. That surfaced real pre-existing debt: the examples
// declare `i18n.supportedLocales: ['en', 'zh-CN', …]` and then leave a few
// hundred declared strings untranslated.
//
// So `os lint --i18n-strict` — the honest "these locales must be complete"
// gate — reports ~100-450 errors per example today. Turning it on as-is would
// paint CI red on day one and get switched back off, which is how a gate stops
// being a gate. This is the shippable middle: the debt is FROZEN, and the build
// fails the moment it grows.
//
// Mirrors scripts/check-role-word.mjs. Fails when:
//   • an example config is not in the baseline (translate it, or ratchet it in), or
//   • a baselined count INCREASES — a newly untranslated declared string, or
//   • a baselined count DECREASED / the example vanished (improvement!) —
//     run with --update to ratchet down and commit the baseline.
//
//   node scripts/check-i18n-coverage.mjs [--update]
//
// Counts only what `os lint` shows a user: the platform metadata-form baseline
// is folded away (it is owned and translated by platform-objects), so this
// tracks the example's OWN declared surface. Severity is ignored on purpose —
// warning-vs-error moves with --i18n-strict, but the SET of untranslated keys
// does not, and that set is what must not grow.
//
// Requires the workspace build (it runs the built CLI), so it belongs after the
// build step with the other consumer gates.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const EXAMPLES_DIR = 'examples';
const BASELINE_PATH = 'scripts/i18n-coverage-baseline.json';
const CLI = 'packages/cli/bin/run.js';

const update = process.argv.includes('--update');

/** Every bundled example that has a stack config. */
function discoverExamples() {
  if (!existsSync(EXAMPLES_DIR)) return [];
  return readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(EXAMPLES_DIR, e.name, 'objectstack.config.ts'))
    .filter((p) => existsSync(p))
    .sort();
}

/** Untranslated declared strings `os lint` would show for one config. */
function countI18nIssues(configPath) {
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [CLI, 'lint', configPath, '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // `os lint` exits non-zero when the config has errors of any kind; the JSON
    // payload is still on stdout and is what we want. A genuinely broken run
    // (no stdout) is a hard failure — never silently a zero.
    stdout = err.stdout ?? '';
    if (!stdout.trim()) {
      throw new Error(`os lint produced no output for ${configPath}: ${err.stderr || err.message}`);
    }
  }
  const report = JSON.parse(stdout);
  if (report.error) throw new Error(`os lint failed for ${configPath}: ${report.error}`);
  const issues = report.issues ?? [];
  return issues.filter((i) => typeof i.rule === 'string' && i.rule.startsWith('i18n/')).length;
}

const current = {};
for (const configPath of discoverExamples()) {
  current[configPath] = countI18nIssues(configPath);
}

if (update) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(`i18n coverage baseline updated: ${Object.keys(current).length} example(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

const errors = [];
for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file];
  if (allowed === undefined) {
    errors.push(
      `${file}: new example is not baselined (${count} untranslated declared string(s)). ` +
        `Translate them, or run \`node scripts/check-i18n-coverage.mjs --update\` to freeze the debt.`,
    );
  } else if (count > allowed) {
    errors.push(
      `${file}: untranslated declared strings grew ${allowed} → ${count}. ` +
        `Something declared a label without translating it for a locale this example claims to support ` +
        `(see \`i18n.supportedLocales\`). Run \`os i18n extract\` and fill the new keys, or \`os lint ${file}\` to list them.`,
    );
  }
}
for (const [file, allowed] of Object.entries(baseline)) {
  const now = current[file];
  if (now === undefined) {
    errors.push(
      `${file}: baselined example is gone (was ${allowed}) — ratchet DOWN: ` +
        `run \`node scripts/check-i18n-coverage.mjs --update\` and commit the baseline.`,
    );
  } else if (now < allowed) {
    errors.push(
      `${file}: untranslated declared strings improved ${allowed} → ${now} — ratchet DOWN: ` +
        `run \`node scripts/check-i18n-coverage.mjs --update\` and commit the baseline.`,
    );
  }
}

if (errors.length) {
  console.error(`check-i18n-coverage: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error('  • ' + e);
  process.exit(1);
}
const total = Object.values(current).reduce((a, b) => a + b, 0);
console.log(
  `check-i18n-coverage: OK (${Object.keys(current).length} example(s), ${total} baselined untranslated string(s), none new).`,
);
