// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin build` — compile a plugin into a signed-ready `.osplugin`
 * artifact (ADR-0025 §3.4 step 1, framework F2).
 *
 * Flow:
 *   1. Load + validate `objectstack.plugin.json` against the canonical
 *      ManifestSchema (@objectstack/spec/kernel, ADR-0025 §3.2 — landed by
 *      framework F1). Malformed manifests fail fast with zod diagnostics.
 *   2. esbuild-bundle the entry to `dist/index.mjs`, externalizing
 *      `@objectstack/*` (peer-provided by the host runtime; ADR §3.10 #2) and
 *      inlining every other dependency: `bundled` is the one packaging
 *      strategy (ADR-0025 v2 §3.3), since nothing installs a dependency at
 *      install time — `os plugin install` and the boot-time loader import
 *      `dist/index.mjs` as packed.
 *   3. Refuse a native addon (ADR-0025 v2 §3.3): a `.node` module the bundle
 *      reaches, a bundled package that builds or ships one, or a `.node` file
 *      under `assets/`. A compiled binary can be neither bundled nor
 *      verified as JavaScript, so the refusal names every one at once and
 *      no artifact is written.
 *   4. Compute per-file `integrity` (`sha256-<base64>`, ADR §3.2) and write
 *      the compiled manifest with that map + a `dist/index.mjs` entry.
 *   5. Pack everything (+ a `SIGNATURE` placeholder) into a reproducible
 *      ustar+gzip `<id>-<version>.osplugin`.
 *
 * Signing is a separate step (`os plugin sign`); this command emits an
 * unsigned artifact whose `SIGNATURE` is a placeholder.
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve as resolvePath, sep as PATH_SEP } from 'node:path';
import type { Metafile, Plugin as EsbuildPlugin } from 'esbuild';
import { Args, Command, Flags } from '@oclif/core';
import { ManifestSchema } from '@objectstack/spec/kernel';
import {
  printError,
  printHeader,
  printKV,
  printStep,
  printSuccess,
  formatZodErrors,
} from '../../utils/format.js';
import {
  type ArchiveFile,
  MANIFEST_FILENAME,
  OSPLUGIN_EXT,
  SIGNATURE_FILENAME,
  computeIntegrity,
  createTarGz,
  sha256Hex,
} from '../../utils/osplugin.js';
import { makeDirectorySync } from '../../utils/make-directory.js';

const ENTRY_CANDIDATES = ['src/index.ts', 'src/index.tsx', 'src/index.mjs', 'src/index.js'];

/** Walk a directory recursively, returning archive files under `prefix`. */
async function collectDir(dir: string, prefix: string): Promise<ArchiveFile[]> {
  const out: ArchiveFile[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(dir, e.name);
    const rel = `${prefix}/${e.name}`;
    if (e.isDirectory()) {
      out.push(...(await collectDir(abs, rel)));
    } else if (e.isFile()) {
      out.push({ path: rel, data: new Uint8Array(await readFile(abs)) });
    }
  }
  return out;
}

/** A compiled Node addon's file extension — the one binary shape ADR-0025 v2 §3.3 refuses. */
const isNativeAddonPath = (p: string): boolean => p.toLowerCase().endsWith('.node');

/**
 * Loads every `.node` module the bundle reaches as an empty one, so esbuild
 * finishes the graph and the refusal can name every addon at once (its own
 * answer is a bare "No loader is configured" for the first one only). The
 * output is never written: the metafile names the modules and the build
 * refuses.
 */
const nativeAddonCollector: EsbuildPlugin = {
  name: 'os-plugin-native-addon-refusal',
  setup(build) {
    build.onLoad({ filter: /\.node$/i }, () => ({ contents: '', loader: 'empty' }));
  },
};

/**
 * The package directory an esbuild input sits in — the segment after its LAST
 * `node_modules` (two for a scoped name), so a pnpm store path
 * (`node_modules/.pnpm/x@1/node_modules/x/…`) answers `x`. Inputs outside any
 * `node_modules` are the plugin's own source and answer `undefined`.
 */
function packageRootOf(input: string): { name: string; dir: string } | undefined {
  const segments = input.split('/');
  const at = segments.lastIndexOf('node_modules');
  if (at < 0 || at + 1 >= segments.length) return undefined;
  const width = segments[at + 1]!.startsWith('@') ? 2 : 1;
  if (at + width >= segments.length) return undefined;
  return { name: segments.slice(at + 1, at + 1 + width).join('/'), dir: segments.slice(0, at + 1 + width).join('/') };
}

/** The first `.node` file under `dir`, skipping nested `node_modules` (another package's) and symlinks. */
function findShippedAddon(dir: string, rel = ''): string | undefined {
  let entries;
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isFile() && isNativeAddonPath(e.name)) return childRel;
  }
  for (const e of entries) {
    if (e.isDirectory() && e.name !== 'node_modules') {
      const hit = findShippedAddon(dir, rel ? `${rel}/${e.name}` : e.name);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Why the package at `dir` is a native addon, or `undefined` when it is not. */
function nativePackageReason(dir: string): string | undefined {
  if (existsSync(join(dir, 'binding.gyp'))) return 'declares a node-gyp build (binding.gyp)';
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { gypfile?: unknown };
    if (pkg.gypfile === true) return 'declares a node-gyp build (gypfile: true)';
  } catch {
    /* no readable package.json — the binary scan below still answers */
  }
  const shipped = findShippedAddon(dir);
  return shipped ? `ships a compiled addon (${shipped})` : undefined;
}

/**
 * Who reaches the package at `dir` (a {@link packageRootOf} directory): the
 * files outside it that import a file inside it, and the shortest chain from
 * the plugin's own source to it, one step per package — so a transitive hit
 * (`ws` → `bufferutil`) names the direct dependency that pulled it in.
 */
function packageImporters(metafile: Metafile, dir: string): { importers: string[]; chain: string[] } {
  const inputs = Object.keys(metafile.inputs);
  const inside = (input: string): boolean => packageRootOf(input)?.dir === dir;
  const importers = inputs.filter(
    (i) => !inside(i) && metafile.inputs[i]!.imports.some((imp) => inside(imp.path)),
  );
  // Breadth-first from the plugin's own files (outside every `node_modules`).
  const from = new Map<string, string | null>();
  const queue = inputs.filter((i) => packageRootOf(i) === undefined);
  for (const start of queue) from.set(start, null);
  let hit: string | undefined;
  while (queue.length > 0 && hit === undefined) {
    const input = queue.shift()!;
    for (const imp of metafile.inputs[input]?.imports ?? []) {
      if (from.has(imp.path) || !(imp.path in metafile.inputs)) continue;
      from.set(imp.path, input);
      if (inside(imp.path)) {
        hit = imp.path;
        break;
      }
      queue.push(imp.path);
    }
  }
  const chain: string[] = [];
  for (let at: string | undefined = hit; at; at = from.get(at) ?? undefined) {
    const step = packageRootOf(at)?.name ?? at;
    if (chain[0] !== step) chain.unshift(step);
  }
  return { importers, chain };
}

/**
 * Every native addon a build would pack or load (ADR-0025 v2 §3.3), one line
 * each: a `.node` module the bundle reaches (named with its importers), a
 * bundled package that builds or ships one (its JS may be bundleable, but the
 * binary it locates at run time — `bindings`, `node-gyp-build` — is not in the
 * artifact; named with its importers and the chain that reaches it from the
 * plugin's own source), and a `.node` file staged from `assets/`.
 */
function findNativeAddons(metafile: Metafile, cwd: string, assets: ArchiveFile[]): string[] {
  const found: string[] = [];
  const inputs = Object.keys(metafile.inputs);
  for (const input of inputs.filter(isNativeAddonPath)) {
    const importers = inputs.filter((i) => metafile.inputs[i]!.imports.some((imp) => imp.path === input));
    found.push(importers.length > 0 ? `${input}, imported by ${importers.join(', ')}` : input);
  }
  const packages = new Map<string, { name: string; dir: string }>();
  for (const input of inputs) {
    const root = packageRootOf(input);
    if (root && !packages.has(root.dir)) packages.set(root.dir, root);
  }
  for (const { name, dir } of packages.values()) {
    const reason = nativePackageReason(resolvePath(cwd, dir));
    if (!reason) continue;
    const { importers, chain } = packageImporters(metafile, dir);
    found.push(
      `package \`${name}\` (${dir}) ${reason}`
        + (importers.length > 0 ? `, imported by ${importers.join(', ')}` : '')
        + (chain.length > 1 ? ` (reached through ${chain.join(' → ')})` : ''),
    );
  }
  for (const asset of assets) {
    if (isNativeAddonPath(asset.path)) found.push(asset.path);
  }
  return found;
}

export default class PluginBuild extends Command {
  static override description =
    'Compile a plugin into a signed-ready `.osplugin` artifact (ADR-0025 §3.4)';

  static override examples = [
    '$ os plugin build',
    '$ os plugin build --entry src/main.ts',
    '$ os plugin build --out dist/my-plugin.osplugin',
  ];

  static override args = {
    dir: Args.string({
      description: 'Plugin project directory (defaults to cwd)',
      required: false,
    }),
  };

  static override flags = {
    entry: Flags.string({
      char: 'e',
      description: 'Entry module to bundle (defaults to the first of src/index.{ts,tsx,mjs,js})',
    }),
    out: Flags.string({
      char: 'o',
      description: 'Output path for the .osplugin (defaults to <id>-<version>.osplugin in cwd)',
    }),
    minify: Flags.boolean({ description: 'Minify the bundled output', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginBuild);
    const cwd = resolvePath(process.cwd(), args.dir ?? '.');

    printHeader('Build Plugin');

    // 1. Load + validate the source manifest. ──────────────────────────
    const manifestPath = resolvePath(cwd, MANIFEST_FILENAME);
    let rawManifest: Record<string, unknown>;
    try {
      rawManifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    } catch (err) {
      printError(`Cannot read ${MANIFEST_FILENAME} in ${cwd}: ${(err as Error).message}`);
      this.exit(1);
      return;
    }

    const parsed = ManifestSchema.safeParse(rawManifest);
    if (!parsed.success) {
      printError(`${MANIFEST_FILENAME} is invalid:`);
      formatZodErrors(parsed.error);
      this.exit(1);
      return;
    }
    const manifest = parsed.data;
    const id = manifest.id;
    const version = manifest.version;
    if (!id || !version) {
      printError(`${MANIFEST_FILENAME} must declare both "id" and "version".`);
      this.exit(1);
      return;
    }
    const packaging = manifest.packaging ?? 'bundled';
    printStep(`Loaded ${id}@${version} (runtime: ${manifest.runtime ?? 'unset'}, packaging: ${packaging})`);

    // 2. Resolve entry + esbuild bundle. ───────────────────────────────
    const entryRel =
      flags.entry ?? (typeof rawManifest.main === 'string' ? rawManifest.main : undefined) ??
      ENTRY_CANDIDATES.find((c) => existsSync(resolvePath(cwd, c)));
    if (!entryRel) {
      printError(`No entry module found. Add a "main" to ${MANIFEST_FILENAME} or pass --entry.`);
      this.exit(1);
      return;
    }
    const entryAbs = resolvePath(cwd, entryRel);
    if (!existsSync(entryAbs)) {
      printError(`Entry module not found: ${entryRel}`);
      this.exit(1);
      return;
    }
    printStep(`Bundling ${relative(cwd, entryAbs).split(PATH_SEP).join('/')}...`);

    let esbuild: typeof import('esbuild');
    try {
      esbuild = await import('esbuild');
    } catch (err) {
      printError(`esbuild is required to build plugins but is not installed: ${(err as Error).message}`);
      this.exit(1);
      return;
    }

    // Externalize only the peer-provided @objectstack/* (host singletons);
    // every other dependency is inlined — `bundled` is the one strategy.
    let bundleBytes: Uint8Array;
    let metafile: Metafile;
    try {
      const result = await esbuild.build({
        entryPoints: [entryAbs],
        absWorkingDir: cwd,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node18',
        write: false,
        outfile: resolvePath(cwd, 'dist/index.mjs'),
        sourcemap: false,
        minify: flags.minify,
        external: ['@objectstack/*'],
        plugins: [nativeAddonCollector],
        metafile: true,
        logLevel: 'silent',
        legalComments: 'none',
        banner: { js: '// @generated by `os plugin build` — do not edit.' },
      });
      const outputs = result.outputFiles ?? [];
      const js = outputs.find((f) => f.path.endsWith('.mjs') || f.path.endsWith('.js')) ?? outputs[0];
      if (!js) throw new Error('esbuild produced no output');
      bundleBytes = js.contents;
      metafile = result.metafile;
    } catch (err) {
      printError(`Bundle failed: ${(err as Error).message}`);
      this.exit(1);
      return;
    }

    // 3. Stage archive files; refuse a native addon. ─────────────────────
    const files: ArchiveFile[] = [{ path: 'dist/index.mjs', data: bundleBytes }];

    const assetsDir = resolvePath(cwd, 'assets');
    const assets: ArchiveFile[] = [];
    if (existsSync(assetsDir) && (await stat(assetsDir)).isDirectory()) {
      assets.push(...(await collectDir(assetsDir, 'assets')));
    }
    files.push(...assets);

    const nativeAddons = findNativeAddons(metafile, cwd, assets);
    if (nativeAddons.length > 0) {
      printError(
        'Native addon refused: a plugin artifact carries bundled JavaScript only (ADR-0025 v2 §3.3), '
        + 'and a compiled `.node` binary can be neither bundled nor run by every host. Found:\n'
        + nativeAddons.map((line) => `      - ${line}`).join('\n')
        + '\n    Replace each with a pure-JavaScript or WebAssembly alternative, or drop it.',
      );
      this.exit(1);
      return;
    }

    // 4. Compute integrity, compile manifest. ────────────────────────────
    const integrity = computeIntegrity(files);
    const compiledManifest = { ...manifest, main: 'dist/index.mjs', integrity };
    const manifestBytes = new Uint8Array(
      Buffer.from(JSON.stringify(compiledManifest, null, 2) + '\n', 'utf-8'),
    );
    files.push({ path: MANIFEST_FILENAME, data: manifestBytes });
    // Unsigned placeholder; `os plugin sign` overwrites this (ADR §3.4).
    files.push({ path: SIGNATURE_FILENAME, data: new Uint8Array(Buffer.from('unsigned\n', 'utf-8')) });

    // 5. Pack the artifact. ─────────────────────────────────────────────
    const blob = createTarGz(files);
    const outPath = resolvePath(cwd, flags.out ?? `${id}-${version}${OSPLUGIN_EXT}`);
    // Bounded (#23858): an `--out` directory that can never be made is refused
    // at once with the OS's code and the path. Node's recursive mkdir, async
    // as here too, never settled on it.
    makeDirectorySync(resolvePath(outPath, '..'));
    await writeFile(outPath, blob);

    printSuccess('Plugin built');
    printKV('  Artifact', relative(cwd, outPath).split(PATH_SEP).join('/') || outPath);
    printKV('  Plugin', `${id}@${version}`);
    printKV('  Files', String(files.length));
    printKV('  Integrity entries', String(Object.keys(integrity).length));
    printKV('  Size', `${(blob.byteLength / 1024).toFixed(1)} KB`);
    printKV('  sha256', sha256Hex(blob));
  }
}
