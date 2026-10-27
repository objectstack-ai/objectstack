// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { dirname, basename, resolve as resolvePath, relative, sep as PATH_SEP } from 'node:path';

/**
 * Build a single ESM bundle that re-exports every inline handler function
 * collected by `lowerCallables`. The bundle is the second half of the
 * "two-product" build (alongside `objectstack.json`):
 *
 *   dist/
 *   ├── objectstack.json
 *   └── objectstack-runtime.{contenthash}.mjs   ← THIS
 *
 * At runtime, `StandaloneStack` (and `MultiProjectPlugin`) dynamic-import
 * the mjs and merge `module.functions` into the bundle before
 * `bindHooks(...)` runs — so string-named handlers resolve to real code
 * even though the JSON artifact is pure metadata.
 */

type AnyFn = (...args: unknown[]) => unknown;

export interface BuildRuntimeOptions {
  /** Absolute path to the user's `objectstack.config.{ts,js,mjs}`. */
  sourceConfigPath: string;
  /**
   * `LoweringResult.functions`: ref → the callable it names. The module serves
   * exactly these refs, each with exactly this callable.
   */
  callables: Readonly<Record<string, AnyFn>>;
  /**
   * The config `loadConfig` answered for `sourceConfigPath` (its `config`), the
   * value `lowerCallables`' input was normalized from. Every callable is
   * located in it by identity, so the module can pick the same function back
   * up when it re-evaluates the config.
   */
  loadedConfig: unknown;
  /** Output directory (e.g. `<cwd>/dist`). Created if missing. */
  outputDir: string;
  /** Base file name without hash, e.g. `objectstack-runtime`. */
  baseName?: string;
  /** External package names to mark as external (`@objectstack/*` etc.). */
  externalPackages?: string[];
}

export interface BuildRuntimeResult {
  /** Absolute path to the emitted mjs. */
  outputPath: string;
  /** File name (relative to outputDir) — embedded in objectstack.json. */
  outputFileName: string;
  /** Content hash (sha256, first 16 hex chars). */
  hash: string;
  /** Bundle size in bytes. */
  size: number;
}

const DEFAULT_BASE = 'objectstack-runtime';

/**
 * Where a callable lives in the loaded config: a property path from its top
 * level (`['hooks', 0, 'handler']`, `['functions', 'score_lead']`).
 */
export type CallableLocator = readonly (string | number)[];

/**
 * Locate every ref's callable in `loadedConfig` by IDENTITY, breadth-first
 * over its own enumerable properties, so each path is the shortest one.
 *
 * The ref → callable pairing is `lowerCallables`' (`callables`), and this
 * function adds only WHERE each callable is, so the module never re-derives a
 * name. The template used to: it walked `hooks`, then `functions`, keyed each
 * callable by the hook's name or the entry's authored key, and kept those
 * present in the ref list. It therefore disagreed with the lowering whenever
 * one name or one function served two slots (a hook's ref resolved to a
 * `functions` entry's code, an authored key shipped as a bare string), and it
 * never reached an action's `target` or a `packages[i].manifest` body at all.
 *
 * Every callable `lowerCallables` registered was read off this same config
 * (normalizing copies containers, never functions), so a callable it cannot
 * find is an internal inconsistency. It throws, naming the refs, rather than
 * writing a module that silently leaves them out.
 */
export function locateCallables(
  callables: Readonly<Record<string, AnyFn>>,
  loadedConfig: unknown,
): Record<string, CallableLocator> {
  const wanted = new Map<AnyFn, string[]>();
  for (const [ref, fn] of Object.entries(callables)) {
    const refs = wanted.get(fn);
    if (refs === undefined) wanted.set(fn, [ref]);
    else refs.push(ref);
  }
  const at = new Map<AnyFn, CallableLocator>();
  const seen = new Set<object>();
  let frontier: Array<[unknown, CallableLocator]> = [[loadedConfig, []]];
  while (frontier.length > 0 && at.size < wanted.size) {
    const next: Array<[unknown, CallableLocator]> = [];
    for (const [value, path] of frontier) {
      if (typeof value === 'function') {
        const fn = value as AnyFn;
        if (path.length > 0 && wanted.has(fn) && !at.has(fn)) at.set(fn, path);
        continue;
      }
      if (value === null || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item, i) => next.push([item, [...path, i]]));
        continue;
      }
      for (const key of Object.keys(value)) {
        let item: unknown;
        try {
          item = (value as Record<string, unknown>)[key];
        } catch {
          continue; // a throwing getter holds no callable this pass could have read either
        }
        next.push([item, [...path, key]]);
      }
    }
    frontier = next;
  }
  const locators: Record<string, CallableLocator> = {};
  const missing: string[] = [];
  for (const [ref, fn] of Object.entries(callables)) {
    const path = at.get(fn);
    if (path === undefined) missing.push(ref);
    else locators[ref] = path;
  }
  if (missing.length > 0) {
    throw new Error(
      `[build-runtime] ${missing.length} lowered callable(s) are not reachable from the loaded config, ` +
        `so the runtime module could not serve them: ${missing.map((r) => `'${r}'`).join(', ')}`,
    );
  }
  return locators;
}

/**
 * Generate the entry source of the runtime module. It bundles the user's
 * config transitively (so every `*.hook.ts` import is captured) and exports
 * `functions`: each ref of `locators`, bound to the callable found at its
 * path. The runtime merges that map into `bundle.functions`.
 *
 * A path starts at the config `loadConfig` assembled: the default export's own
 * keys, then the module's named exports for the keys it does not have (the
 * named-export merge `loadConfig` performs, read back the same way).
 */
function generateEntrySource(
  sourceConfigPath: string,
  locators: Record<string, CallableLocator>,
  entryDir: string,
): string {
  // Use a POSIX-style relative path so esbuild's resolver bundles the
  // user's config + every transitively-imported `*.hook.ts` into the
  // emitted ESM. A `file://` URL would be treated as external.
  let importPath = relative(entryDir, sourceConfigPath).split(PATH_SEP).join('/');
  if (!importPath.startsWith('.')) importPath = './' + importPath;

  return `// AUTO-GENERATED by @objectstack/cli — do not edit.
import * as configModule from ${JSON.stringify(importPath)};

// ref → where \`lowerCallables\` found its callable in the loaded config.
const LOCATORS = ${JSON.stringify(locators)};

const base = configModule.default;
function top(key) {
  if (base && (typeof base === 'object' || typeof base === 'function') && Object.prototype.hasOwnProperty.call(base, key)) {
    return base[key];
  }
  return key === 'default' ? undefined : configModule[key];
}

function collect() {
  const out = Object.create(null);
  for (const ref of Object.keys(LOCATORS)) {
    const path = LOCATORS[ref];
    let value = top(path[0]);
    for (let i = 1; i < path.length && value != null; i++) value = value[path[i]];
    if (typeof value === 'function') out[ref] = value;
  }
  return out;
}

export const functions = collect();
export const meta = {
  builtAt: new Date().toISOString(),
  refCount: ${Object.keys(locators).length},
};
`;
}

export async function buildRuntimeBundle(opts: BuildRuntimeOptions): Promise<BuildRuntimeResult> {
  const { sourceConfigPath, callables, loadedConfig, outputDir } = opts;
  const baseName = opts.baseName ?? DEFAULT_BASE;
  const locators = locateCallables(callables, loadedConfig);

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const entryDir = dirname(sourceConfigPath);

  let esbuild: typeof import('esbuild');
  try {
    esbuild = await import('esbuild');
  } catch (err) {
    throw new Error(
      `[build-runtime] esbuild is required to bundle declarative handlers but is not installed: ${(err as Error).message}`,
    );
  }

  // Bundle to an in-memory buffer first so we can hash, then rename.
  //
  // The name is a hash of these bytes, so nothing that varies between two
  // builds of the same app may reach them. esbuild prints every input's path
  // into the output, as a `// path` comment and in the inline sourcemap's
  // `sources`. So the entry goes in as `stdin` under one fixed name (no file on
  // disk, so concurrent builds share nothing), and paths are relative to the
  // config's directory rather than to the process's cwd.
  const result = await esbuild.build({
    stdin: {
      contents: generateEntrySource(sourceConfigPath, locators, entryDir),
      resolveDir: entryDir,
      sourcefile: `.${baseName}.entry.mjs`,
      loader: 'js',
    },
    absWorkingDir: entryDir,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    sourcemap: 'inline',
    packages: 'external',
    logLevel: 'silent',
    legalComments: 'none',
    resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json'],
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
    banner: { js: '// @generated by @objectstack/cli — do not edit.' },
  });

  const out = result.outputFiles?.[0];
  if (!out) throw new Error('[build-runtime] esbuild produced no output');

  const code = out.text;
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
  const fileName = `${baseName}.${hash}.mjs`;
  const outputPath = resolvePath(outputDir, fileName);
  writeFileSync(outputPath, code);

  return {
    outputPath,
    outputFileName: fileName,
    hash,
    size: Buffer.byteLength(code, 'utf8'),
  };
}

/** Best-effort cleanup of stale `objectstack-runtime.*.mjs` files. */
export function cleanupOldRuntimeBundles(outputDir: string, keepFileName: string, baseName = DEFAULT_BASE): number {
  if (!existsSync(outputDir)) return 0;
  let removed = 0;
  try {
    const re = new RegExp(`^${baseName}\\.[a-f0-9]+\\.mjs(\\.map)?$`);
    for (const f of readdirSync(outputDir)) {
      if (!re.test(f)) continue;
      if (f === keepFileName) continue;
      try {
        unlinkSync(resolvePath(outputDir, f));
        removed += 1;
      } catch { /* noop */ }
    }
  } catch { /* noop */ }
  return removed;
}

/** Reuse: read an existing bundle and recompute its size for stats. */
export function statBundle(outputPath: string): { size: number } | null {
  try {
    const buf = readFileSync(outputPath);
    return { size: buf.byteLength };
  } catch {
    return null;
  }
}

export const runtimeBundlePathRelative = (outputDir: string, file: string): string =>
  relative(outputDir, resolvePath(outputDir, basename(file)));
