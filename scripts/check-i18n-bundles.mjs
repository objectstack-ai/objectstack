#!/usr/bin/env node
// check-i18n-bundles — drift gate for EVERY package that owns a translation bundle.
//
// `pnpm check:i18n` guarded exactly one package (platform-objects) while eight
// others shipped an `i18n-extract.config.ts` that nothing ever ran. Four of
// them had already drifted out of sync with the schema unnoticed — bundles
// carrying keys the schema had renamed away, and missing keys it had gained.
// That is the same silent-staleness this gate exists to prevent, just outside
// the one directory it happened to cover.
//
// The command each package is checked with is not repeated here: it is parsed
// out of the config file's own docstring, which already documents how to
// regenerate that bundle. Executing exactly the documented command means the
// docs and the gate cannot diverge — the same reason `os lint`'s coverage
// detector was made to share the extractor's walker (#3370).
//
//   node scripts/check-i18n-bundles.mjs            # check all, fail on drift
//   node scripts/check-i18n-bundles.mjs --write     # regenerate in place
//   node scripts/check-i18n-bundles.mjs --filter=security
//
// Requires the workspace build (it runs the built CLI), so it belongs after
// the build step with the other consumer gates.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLI = 'packages/cli/bin/run.js';
const write = process.argv.includes('--write');
const filterArg = process.argv.find((a) => a.startsWith('--filter='));
const filter = filterArg ? filterArg.slice('--filter='.length) : '';

/** Every `scripts/i18n-extract.config.ts` under packages/. */
function findConfigs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findConfigs(p, out);
    else if (e.name === 'i18n-extract.config.ts' && p.includes('/scripts/')) out.push(p);
  }
  return out;
}

/**
 * Read the regenerate command the config documents about itself. Every flag the
 * gate passes comes from there, so a package that changes its locales or output
 * directory updates one place and the gate follows.
 */
function flagsFromDocstring(configPath) {
  const src = readFileSync(configPath, 'utf8');
  const head = src.slice(0, src.indexOf('*/') + 2);
  const flags = head.match(/--(?:locales|fill|out)=[^\s\\*]+|--(?:objects-only|no-metadata-forms|no-merge)\b/g) ?? [];
  return [...new Set(flags)];
}

const configs = findConfigs('packages').sort().filter((c) => !filter || c.includes(filter));
if (configs.length === 0) {
  console.error(`check-i18n-bundles: no extract configs matched${filter ? ` --filter=${filter}` : ''}`);
  process.exit(1);
}

const drifted = [];
const broken = [];
for (const config of configs) {
  const pkg = config.replace(/^packages\//, '').replace(/\/scripts\/i18n-extract\.config\.ts$/, '');
  const flags = flagsFromDocstring(config);
  const out = flags.find((f) => f.startsWith('--out='));
  if (!out) {
    broken.push(`${pkg}: its docstring documents no --out=<dir>, so the gate cannot tell where the bundles live`);
    continue;
  }
  const outDir = out.slice('--out='.length);
  if (!existsSync(outDir)) {
    broken.push(`${pkg}: documented --out directory does not exist: ${outDir}`);
    continue;
  }
  const args = [CLI, 'i18n', 'extract', config, ...flags, ...(write ? [] : ['--check'])];
  let stdout = '';
  let failed = false;
  try {
    stdout = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    stdout = err.stdout ?? '';
    failed = true;
  }
  if (write) {
    console.log(`  ${pkg.padEnd(30)} regenerated`);
    continue;
  }
  if (failed) {
    const stale = [...stdout.matchAll(/(?:out of date|missing):\s+(\S+)/g)].map((m) => m[1]);
    if (stale.length) {
      drifted.push(`${pkg}: ${stale.length} bundle(s) drifted from the schema`);
      console.log(`  ${pkg.padEnd(30)} DRIFTED (${stale.length})`);
    } else {
      // Not a drift result — the extract itself blew up. Never report that as
      // a pass; a config that cannot load is a broken gate, not a clean one.
      broken.push(`${pkg}: extract failed — ${(stdout.trim().split('\n').pop() || 'no output').trim()}`);
      console.log(`  ${pkg.padEnd(30)} ERROR`);
    }
    continue;
  }
  const n = (stdout.match(/(\d+) bundle\(s\) are in sync/) ?? [, '?'])[1];
  console.log(`  ${pkg.padEnd(30)} in sync (${n} bundle(s))`);
}

if (write) process.exit(0);

if (broken.length || drifted.length) {
  console.error(`\ncheck-i18n-bundles: ${broken.length + drifted.length} problem(s)\n`);
  for (const b of broken) console.error('  • ' + b);
  for (const d of drifted) {
    console.error('  • ' + d);
  }
  if (drifted.length) {
    console.error(
      `\nRegenerate and commit: node scripts/check-i18n-bundles.mjs --write\n` +
        `Merge mode is on, so no existing translation is overwritten — new schema keys are\n` +
        `added filled with the source text, and they still need translating.`,
    );
  }
  process.exit(1);
}
console.log(`\ncheck-i18n-bundles: OK (${configs.length} package(s), all bundles in sync).`);
