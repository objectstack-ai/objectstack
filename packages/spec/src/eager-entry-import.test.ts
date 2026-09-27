// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every published entry of `@objectstack/spec` imports cleanly as a process's
 * FIRST spec import under `OS_EAGER_SCHEMAS=1` (#19930).
 *
 * `OS_EAGER_SCHEMAS=1` is documented as the emergency rollback of the
 * lazy-schema memory optimization (`content/docs/deployment/
 * environment-variables.mdx`). Under it every `lazySchema` factory runs at
 * module init, so an import cycle whose partner is still half-initialized
 * throws at import. The default lazy path never runs a factory at import, so
 * the ordinary suite stays green over such a cycle. Only an eager first import
 * sees it, and which module comes first decides the order.
 *
 * The regression this pins: `shared/suggestions.zod.ts` carried a value import
 * of `FieldType` from `data/field.zod`, closing
 * `data/filter.zod → shared/strict-object → shared/suggestions.zod →
 * data/field.zod`. With `/api` or `/data` as the first import, `field.zod`'s
 * eager `FieldSchema` factory read `FilterConditionSchema` before `filter.zod`
 * finished, and both entries threw
 * (`Cannot access 'FilterConditionSchema' before initialization`).
 *
 * The entries come from this package's own `exports` map, so a new subpath is
 * covered on the day it is published. Each one gets a fresh child process,
 * because a second import in the same process reuses the module graph the
 * first one built and so measures a different load order.
 *
 * Two controls keep a green meaningful:
 *
 * - **the flag reached the child** — under the flag a known `lazySchema`
 *   export arrives as a built zod object (`typeof` → `object`). If the env
 *   never took effect, every factory stays deferred and the import cannot
 *   crash, so a pass would measure nothing.
 * - **the unflagged import** of the same entries still succeeds, and the same
 *   export arrives as the lazy Proxy (`typeof` → `function`), so the two legs
 *   really ran in different modes.
 *
 * Source entries only: the test task depends on `^build`, not on this
 * package's own build, so `dist/` is not guaranteed to exist when this suite
 * runs, and a unit verdict must be about the source in the checkout
 * (`check:test-source-alias`). The bundles are built from these same modules.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');

interface ConditionalTarget {
  readonly import?: { readonly default?: string };
}

/** `exports` subpath → source entry, e.g. `./data` → `src/data/index.ts`. */
function publishedSourceEntries(): Array<{ subpath: string; source: string }> {
  const manifest = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8')) as {
    exports: Record<string, string | ConditionalTarget>;
  };
  const entries: Array<{ subpath: string; source: string }> = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    // `./package.json` and `./openapi.json` are data files, not modules.
    if (typeof target === 'string') continue;
    const built = target.import?.default;
    if (!built) throw new Error(`exports["${subpath}"] has no import.default — cannot map it to a source entry`);
    const match = /^\.\/dist\/(.*)\.mjs$/.exec(built);
    if (!match) throw new Error(`exports["${subpath}"].import.default is not a ./dist/*.mjs path: ${built}`);
    entries.push({ subpath, source: `src/${match[1]}.ts` });
  }
  return entries;
}

const MARKER = 'EAGER_ENTRY_IMPORT ';

/**
 * Import `source` as the first spec module of a fresh child process and report
 * the `typeof` of each named export. tsx compiles `.ts` to CJS here, so the
 * namespace arrives under `default`.
 */
function importFirst(source: string, eager: boolean, probes: readonly string[] = []) {
  const env = { ...process.env };
  if (eager) env.OS_EAGER_SCHEMAS = '1';
  else delete env.OS_EAGER_SCHEMAS;
  const href = pathToFileURL(resolve(PKG_ROOT, source)).href;
  const child = spawnSync(
    process.execPath,
    [
      '--import', 'tsx',
      '--input-type=module',
      '-e',
      `const mod = await import(${JSON.stringify(href)});
       const ns = mod.default ?? mod;
       const probe = {};
       for (const name of ${JSON.stringify(probes)}) probe[name] = typeof ns[name];
       console.log(${JSON.stringify(MARKER)} + JSON.stringify(probe));`,
    ],
    { cwd: PKG_ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const line = child.stdout.split('\n').find((l) => l.startsWith(MARKER));
  return {
    status: child.status,
    probe: line ? (JSON.parse(line.slice(MARKER.length)) as Record<string, string>) : undefined,
    // The first lines of stderr carry the throw site, which is the diagnosis.
    stderr: child.stderr.split('\n').slice(0, 12).join('\n'),
  };
}

/** A `lazySchema`-wrapped export per entry the card names, for the mode controls. */
const MODE_PROBES: Record<string, string> = {
  './data': 'FieldSchema',
  './api': 'ApiErrorSchema',
};

const ENTRIES = publishedSourceEntries();

describe('#19930 — every published entry imports first under OS_EAGER_SCHEMAS=1', () => {
  it('maps every published module subpath to a source entry that exists', () => {
    // A subpath this cannot map would drop out of the loop below silently.
    expect(ENTRIES.map((e) => e.subpath)).toEqual(expect.arrayContaining(['.', './data', './api']));
    for (const { subpath, source } of ENTRIES) {
      expect(existsSync(resolve(PKG_ROOT, source)), `${subpath} → ${source}`).toBe(true);
    }
  });

  it.each(ENTRIES)('$subpath ($source) imports first under the flag', ({ subpath, source }) => {
    const probe = MODE_PROBES[subpath];
    const run = importFirst(source, true, probe ? [probe] : []);
    expect(run.status, `${subpath} threw at import under OS_EAGER_SCHEMAS=1:\n${run.stderr}`).toBe(0);
    expect(run.probe, `${subpath} printed no verdict:\n${run.stderr}`).toBeDefined();
    if (probe) {
      // Control 1: the flag reached the child, so the factories ran at import.
      expect(run.probe![probe], `${probe} was not built at import — the flag never took effect`).toBe('object');
    }
  }, 60_000);

  it.each(Object.entries(MODE_PROBES))('%s imports without the flag, and stays lazy', (subpath, probe) => {
    const entry = ENTRIES.find((e) => e.subpath === subpath);
    expect(entry, `${subpath} is not a published entry any more`).toBeDefined();
    const run = importFirst(entry!.source, false, [probe]);
    expect(run.status, `${subpath} threw at import without the flag:\n${run.stderr}`).toBe(0);
    // Control 2: without the flag the same export is the deferred Proxy.
    expect(run.probe?.[probe], `${probe} was built at import without the flag`).toBe('function');
  }, 60_000);
});
