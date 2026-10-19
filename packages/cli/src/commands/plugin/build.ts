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
 *      `@objectstack/*` (peer-provided by the host runtime; ADR §3.10 #2).
 *      For `packaging: manifest-deps`, dependencies are externalized too and
 *      `package.json` + lockfile are carried for install-time resolution.
 *   3. Compute per-file `integrity` (`sha256-<base64>`, ADR §3.2) and write
 *      the compiled manifest with that map + a `dist/index.mjs` entry.
 *   4. Pack everything (+ a `SIGNATURE` placeholder) into a reproducible
 *      ustar+gzip `<id>-<version>.osplugin`.
 *
 * Signing is a separate step (`os plugin sign`); this command emits an
 * unsigned artifact whose `SIGNATURE` is a placeholder.
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve as resolvePath, sep as PATH_SEP } from 'node:path';
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

    // Externalize peer-provided @objectstack/*; for manifest-deps, also keep
    // declared dependencies external (resolved at install time).
    const external = ['@objectstack/*'];
    if (packaging === 'manifest-deps') {
      try {
        const pkg = JSON.parse(await readFile(resolvePath(cwd, 'package.json'), 'utf-8'));
        external.push(...Object.keys(pkg.dependencies ?? {}));
      } catch {
        /* no package.json — nothing extra to externalize */
      }
    }

    let bundleBytes: Uint8Array;
    try {
      const result = await esbuild.build({
        entryPoints: [entryAbs],
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node18',
        write: false,
        outfile: resolvePath(cwd, 'dist/index.mjs'),
        sourcemap: false,
        minify: flags.minify,
        external,
        logLevel: 'silent',
        legalComments: 'none',
        banner: { js: '// @generated by `os plugin build` — do not edit.' },
      });
      const outputs = result.outputFiles ?? [];
      const js = outputs.find((f) => f.path.endsWith('.mjs') || f.path.endsWith('.js')) ?? outputs[0];
      if (!js) throw new Error('esbuild produced no output');
      bundleBytes = js.contents;
    } catch (err) {
      printError(`Bundle failed: ${(err as Error).message}`);
      this.exit(1);
      return;
    }

    // 3. Stage archive files, compute integrity, compile manifest. ──────
    const files: ArchiveFile[] = [{ path: 'dist/index.mjs', data: bundleBytes }];

    const assetsDir = resolvePath(cwd, 'assets');
    if (existsSync(assetsDir) && (await stat(assetsDir)).isDirectory()) {
      files.push(...(await collectDir(assetsDir, 'assets')));
    }

    if (packaging === 'manifest-deps') {
      for (const dep of ['package.json', 'pnpm-lock.yaml']) {
        const p = resolvePath(cwd, dep);
        if (existsSync(p)) files.push({ path: dep, data: new Uint8Array(await readFile(p)) });
      }
    }

    const integrity = computeIntegrity(files);
    const compiledManifest = { ...manifest, main: 'dist/index.mjs', integrity };
    const manifestBytes = new Uint8Array(
      Buffer.from(JSON.stringify(compiledManifest, null, 2) + '\n', 'utf-8'),
    );
    files.push({ path: MANIFEST_FILENAME, data: manifestBytes });
    // Unsigned placeholder; `os plugin sign` overwrites this (ADR §3.4).
    files.push({ path: SIGNATURE_FILENAME, data: new Uint8Array(Buffer.from('unsigned\n', 'utf-8')) });

    // 4. Pack the artifact. ─────────────────────────────────────────────
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
