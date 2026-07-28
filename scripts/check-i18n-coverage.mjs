#!/usr/bin/env node
// check-i18n-coverage — declared-label translation ratchet for the examples AND
// every package that owns a translation bundle.
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
import { readdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// NOTE: covers both `examples/*` and every package with an extract config.
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

/**
 * Every package that owns a translation bundle, via the same
 * `scripts/i18n-extract.config.ts` its drift gate uses.
 *
 * These matter more than the examples: an example is a demo, but a platform
 * package's untranslated label is what a customer actually reads in Setup /
 * Studio. Covering only `examples/` is how `platform-objects` sat on 77
 * untranslated navigation and widget labels per locale without anything saying so.
 */
function discoverPackages(dir = 'packages', out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) discoverPackages(p, out);
    else if (e.name === 'i18n-extract.config.ts' && p.includes('/scripts/')) out.push(p);
  }
  return out.sort();
}

/**
 * Untranslated declared strings `os lint` would show for one config.
 *
 * Captured to a FILE rather than a pipe. Node writes stdout synchronously to a
 * file and asynchronously to a pipe, so a command that exits right after a
 * large `console.log` can hand a pipe reader a payload cut off at one 64 KiB
 * buffer — which is exactly what `os lint --json` did on `platform-objects`
 * until the `emitJson` fix. A gate must never be able to read a truncated
 * payload and quietly report a smaller number, so it does not use a pipe at all.
 */
function countI18nIssues(configPath) {
  const tmp = join(tmpdir(), `os-lint-${randomUUID()}.json`);
  const fd = openSync(tmp, 'w');
  try {
    try {
      execFileSync(process.execPath, [CLI, 'lint', configPath, '--json'], {
        stdio: ['ignore', fd, 'pipe'],
      });
    } catch {
      // `os lint` exits non-zero whenever the config has errors of any kind;
      // the JSON payload is still what we want. A run that produced no output
      // is a hard failure — never silently a zero.
    }
    closeSync(fd);
    const raw = readFileSync(tmp, 'utf8');
    if (!raw.trim()) throw new Error(`os lint produced no output for ${configPath}`);
    let report;
    try {
      report = JSON.parse(raw);
    } catch (err) {
      throw new Error(`os lint produced unparseable JSON for ${configPath} (${raw.length} bytes): ${err.message}`);
    }
    if (report.error) throw new Error(`os lint failed for ${configPath}: ${report.error}`);
    const issues = report.issues ?? [];
    return issues.filter((i) => typeof i.rule === 'string' && i.rule.startsWith('i18n/')).length;
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

const current = {};
for (const configPath of [...discoverExamples(), ...discoverPackages()]) {
  current[configPath] = countI18nIssues(configPath);
}

if (update) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(`i18n coverage baseline updated: ${Object.keys(current).length} config(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

const errors = [];
for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file];
  if (allowed === undefined) {
    errors.push(
      `${file}: not baselined (${count} untranslated declared string(s)). ` +
        `Translate them, or run \`node scripts/check-i18n-coverage.mjs --update\` to freeze the debt.`,
    );
  } else if (count > allowed) {
    errors.push(
      `${file}: untranslated declared strings grew ${allowed} → ${count}. ` +
        `Something declared a label without translating it for a locale this example claims to support ` +
        `(see \`i18n.supportedLocales\`). Run \`node scripts/check-i18n-bundles.mjs --write\` to scaffold the new keys, then translate them; \`os lint ${file}\` lists them.`,
    );
  }
}
for (const [file, allowed] of Object.entries(baseline)) {
  const now = current[file];
  if (now === undefined) {
    errors.push(
      `${file}: baselined config is gone (was ${allowed}) — ratchet DOWN: ` +
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
  `check-i18n-coverage: OK (${Object.keys(current).length} config(s), ${total} baselined untranslated string(s), none new).`,
);
