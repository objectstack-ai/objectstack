import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
// Hook parameters are annotated explicitly throughout: Vite types each hook as
// `ObjectHook<Fn>` (a function-or-object union), and TypeScript cannot
// contextually infer parameters across such a union — same reason
// `scripts/vite-crypto-stub.ts` spells its types out.
import type { Plugin, ResolvedConfig, Rollup, ViteDevServer } from 'vite';

/**
 * maplibre-gl loads its web worker as a **sibling of its own script URL** —
 * it never imports it, so no bundler can see the edge:
 *
 * ```js
 * // maplibre-gl/dist/maplibre-gl.mjs
 * let e = import.meta.url;
 * let t = e.endsWith(`-dev.mjs`) ? `maplibre-gl-worker-dev.mjs` : `maplibre-gl-worker.mjs`;
 * return new URL(`./${t}`, e).href;
 * ```
 *
 * Vite bundles maplibre into a hashed chunk under `assets/` and emits nothing
 * beside it, so at runtime that URL resolves to `<base>/assets/maplibre-gl-worker.mjs`
 * and 404s in every deployment (objectui#3297).
 *
 * This plugin closes the gap by copying maplibre's worker — and everything the
 * worker itself imports, which is a second sibling file (`maplibre-gl-shared.mjs`),
 * not just the worker — into the build's `assetsDir`, where the runtime looks.
 *
 * It is deliberately assertive rather than best-effort. A maplibre upgrade that
 * renames the worker, drops the sibling convention, or moves its dist layout
 * must fail the BUILD, loudly, instead of shipping a 404 that only a browser
 * tab reveals — the same "no silent drift" posture `scripts/build-console.sh`
 * takes with its `CONSOLE_BUNDLE_CANARY`.
 *
 * **Dev has the same hole, one directory over.** `optimizeDeps` pre-bundles
 * maplibre into `node_modules/.vite/deps/maplibre-gl-<hash>.js`, so the sibling
 * URL becomes `/node_modules/.vite/deps/maplibre-gl-worker.mjs` — equally
 * absent (measured: 404). The dev server therefore serves the same files out of
 * maplibre's real dist directory, so `pnpm dev` and a built console behave alike.
 */

/** Worker basename maplibre computes for a non-`-dev` script URL. */
export const MAPLIBRE_WORKER_ENTRY = 'maplibre-gl-worker.mjs';

/**
 * The other half of maplibre's ternary. It is picked only when the *loading*
 * script's URL ends in `-dev.mjs` (maplibre's own unminified distribution).
 * A Vite chunk is `assets/maplibre-gl-<hash>.js`, so this branch is
 * unreachable here — the name is whitelisted by the drift audit, not emitted.
 */
export const MAPLIBRE_DEV_WORKER_ENTRY = 'maplibre-gl-worker-dev.mjs';

/** Every `maplibre-gl-worker*.mjs` literal a bundled chunk may compute. */
const WORKER_REFERENCE_RE = /maplibre-gl-worker[A-Za-z0-9._-]*\.mjs/g;

/** `from"./x.mjs"`, `import"./x.mjs"`, `import("./x.mjs")` — ESM, minified or not. */
const RELATIVE_IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.[^"']*)["']/g;

/** `…/maplibre-gl/dist` out of any module id inside maplibre's dist directory. */
const MAPLIBRE_DIST_RE = /^(.*[\\/]maplibre-gl[\\/]dist)[\\/][^\\/]+$/;

/**
 * The directory maplibre's dist files live in, derived from a module id that
 * rollup actually pulled into this build — so the copied worker is by
 * construction the same version as the bundled main-thread code, with no
 * second resolution (and no chance of resolving a different hoisted copy).
 */
export function findMaplibreDistDir(moduleId: string): string | null {
  // Substring pre-filter: this runs per module in a build with thousands.
  if (!moduleId.includes('maplibre-gl')) return null;
  const match = MAPLIBRE_DIST_RE.exec(moduleId.split('?')[0]);
  return match ? match[1] : null;
}

/** Unique, sorted worker basenames referenced by bundled code. */
export function collectWorkerReferences(code: string): string[] {
  // Same reason: the audit reads every chunk, and only one mentions the worker.
  if (!code.includes('maplibre-gl-worker')) return [];
  return [...new Set(code.match(WORKER_REFERENCE_RE) ?? [])].sort();
}

/** Unique, sorted relative specifiers statically imported by a module. */
export function collectRelativeImports(code: string): string[] {
  const found = new Set<string>();
  for (const [, specifier] of code.matchAll(RELATIVE_IMPORT_RE)) found.add(specifier);
  return [...found].sort();
}

/**
 * Walk the worker's sibling-import closure. maplibre's worker is a *module*
 * worker whose first line imports `./maplibre-gl-shared.mjs`; emitting the
 * worker alone would trade a 404 on the worker for a 404 on its dependency.
 *
 * @param read returns a dist file's source, or null when it does not exist.
 * @returns basename -> source, in discovery order.
 * @throws when a referenced sibling is missing on disk (a broken/renamed dist).
 */
export function collectWorkerAssets(
  entry: string,
  read: (basename: string) => string | null,
): Map<string, string> {
  const assets = new Map<string, string>();
  const queue = [entry];
  const seenFrom = new Map<string, string>([[entry, "maplibre's runtime worker URL"]]);

  while (queue.length > 0) {
    const basename = queue.shift()!;
    if (assets.has(basename)) continue;
    const source = read(basename);
    if (source === null) {
      throw new Error(
        `maplibre dist file '${basename}' does not exist (required by ${seenFrom.get(basename)}).`,
      );
    }
    assets.set(basename, source);
    for (const specifier of collectRelativeImports(source)) {
      const next = path.posix.normalize(specifier);
      if (next.includes('/')) {
        throw new Error(
          `maplibre worker asset '${basename}' imports '${specifier}', which is not a flat sibling — ` +
            `the dist layout changed and this plugin's copy step no longer describes it.`,
        );
      }
      if (!seenFrom.has(next)) seenFrom.set(next, `'${basename}'`);
      queue.push(next);
    }
  }
  return assets;
}

/**
 * Drift audit: what the bundle asks for at runtime must be exactly what the
 * build put on disk. Returns a failure message, or null when they agree.
 */
export function auditWorkerReferences(referenced: string[], emitted: string[]): string | null {
  if (referenced.length === 0) {
    return (
      `No 'maplibre-gl-worker*.mjs' reference found in any built chunk.\n` +
      `  maplibre no longer resolves its worker as a sibling of its own script URL, so the\n` +
      `  files this plugin copies are either dead weight or landing under the wrong name.\n` +
      `  Re-read maplibre's worker loading code, then update or delete this plugin.`
    );
  }
  const known = new Set([...emitted, MAPLIBRE_DEV_WORKER_ENTRY]);
  const unsatisfied = referenced.filter((name) => !known.has(name));
  if (unsatisfied.length > 0) {
    return (
      `Built chunks request maplibre worker(s) this build does not emit: ${unsatisfied.join(', ')}.\n` +
      `  Emitted: ${emitted.join(', ') || '(none)'}.\n` +
      `  A maplibre upgrade renamed the worker — update MAPLIBRE_WORKER_ENTRY in\n` +
      `  scripts/vite-maplibre-worker.ts to match, or the console 404s at runtime.`
    );
  }
  return null;
}

/** A dev request for `maplibre-gl-worker.mjs` / `maplibre-gl-shared.mjs` / … */
const MAPLIBRE_SIBLING_RE = /^maplibre-gl-[A-Za-z0-9._-]*\.mjs$/;

/**
 * The slice of a rollup output entry the drift audit reads. Spelled out locally
 * because `scripts/` sits outside every package that depends on Vite, so Vite's
 * own types are not resolvable from here (the same is true of
 * `vite-crypto-stub.ts`) — and an audit that silently degrades to `any` is
 * exactly the kind of quiet failure this plugin exists to prevent.
 */
type BundleEntry = { type: 'chunk'; code: string } | { type: 'asset' };

/**
 * Copy maplibre-gl's worker (and its sibling imports) into the build's
 * `assetsDir`, serve the same files in dev, and fail the build if the bundle's
 * own worker URL stops matching what was copied.
 */
export function viteMaplibreWorker(): Plugin {
  let maplibreDistDir: string | null = null;
  let assetsDir = 'assets';
  let outDir = 'dist';
  let emitted: string[] = [];

  return {
    name: 'maplibre-sibling-worker',
    // `pre` so the resolveId hook below runs before Vite's core resolver
    // answers the specifier — once a plugin resolves an id, later plugins'
    // resolveId hooks never see it.
    enforce: 'pre',

    configResolved(config: ResolvedConfig) {
      assetsDir = config.build.assetsDir;
      outDir = path.resolve(config.root, config.build.outDir);
    },

    // Locating maplibre's dist directory takes two hooks, because dev and build
    // move maplibre through different pipelines:
    //
    // - build: every bundled module passes through `transform`, so the dist
    //   path arrives for free — and is by construction the copy rollup bundled.
    // - dev: maplibre is served from `optimizeDeps`' pre-bundle and never
    //   reaches `transform`. Resolve it with Node's own resolver instead,
    //   anchored at the importer that pulled maplibre in — pnpm-correct, no
    //   hardcoded node_modules layout, and (unlike `this.resolve`) it answers
    //   with the file on disk rather than a `.vite/deps/` pre-bundle, and does
    //   not make the optimizer bundle a new dep as a side effect.
    //
    // Any `maplibre-gl…` specifier is a usable anchor, not just the bare one:
    // plugin-map imports `react-map-gl/maplibre` plus maplibre's stylesheet, so
    // the bare specifier appears only inside an already-bundled dep, where no
    // plugin hook can see it.
    resolveId(source: string, importer: string | undefined) {
      if (maplibreDistDir || !importer || !path.isAbsolute(importer)) return null;
      if (source !== 'maplibre-gl' && !source.startsWith('maplibre-gl/')) return null;
      try {
        const worker = createRequire(importer).resolve(`maplibre-gl/dist/${MAPLIBRE_WORKER_ENTRY}`);
        maplibreDistDir = findMaplibreDistDir(worker);
      } catch {
        // Not resolvable from here; the build path still has `transform`, and
        // `generateBundle` fails loudly if nothing ever answered.
      }
      return null; // never claim the id — resolution continues untouched
    },

    transform(_code: string, id: string) {
      if (!maplibreDistDir) maplibreDistDir = findMaplibreDistDir(id);
      return null;
    },

    // Dev: answer the sibling URL maplibre computes next to its pre-bundled
    // dep with the real file from maplibre's dist. Narrow by construction —
    // it only ever serves a file that exists in that directory.
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const pathname = (req.url ?? '').split('?')[0];
        const basename = pathname.slice(pathname.lastIndexOf('/') + 1);
        if (!maplibreDistDir || !MAPLIBRE_SIBLING_RE.test(basename)) return next();
        const file = path.join(maplibreDistDir, basename);
        if (!file.startsWith(maplibreDistDir) || !fs.existsSync(file)) return next();
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.statusCode = 200;
        res.end(fs.readFileSync(file));
      });
    },

    generateBundle(_options: Rollup.NormalizedOutputOptions, bundle: Rollup.OutputBundle) {
      const referenced = new Set<string>();
      for (const output of Object.values(bundle) as BundleEntry[]) {
        if (output.type !== 'chunk') continue;
        for (const name of collectWorkerReferences(output.code)) referenced.add(name);
      }

      if (!maplibreDistDir) {
        this.error(
          `maplibre-gl was not found in this build.\n` +
            `  This plugin exists to ship maplibre's sibling worker (objectui#3297); if the map\n` +
            `  plugin was intentionally dropped from the console, remove viteMaplibreWorker()\n` +
            `  from apps/console/vite.config.ts in the same change.`,
        );
        return;
      }

      let assets: Map<string, string>;
      try {
        assets = collectWorkerAssets(MAPLIBRE_WORKER_ENTRY, (basename) => {
          const file = path.join(maplibreDistDir!, basename);
          return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        });
      } catch (error) {
        this.error(
          `${(error as Error).message}\n` +
            `  Looked in ${maplibreDistDir}. maplibre's dist layout changed — update\n` +
            `  scripts/vite-maplibre-worker.ts rather than letting the console 404 at runtime.`,
        );
        return;
      }

      emitted = [...assets.keys()];
      const drift = auditWorkerReferences([...referenced].sort(), emitted);
      if (drift) {
        this.error(drift);
        return;
      }

      for (const [basename, source] of assets) {
        this.emitFile({
          type: 'asset',
          // Verbatim name, in assetsDir: maplibre computes this URL as a
          // literal sibling of its own chunk, so it can be neither hashed
          // nor placed anywhere else.
          fileName: path.posix.join(assetsDir, basename),
          source,
        });
      }
    },

    // Canary: emitFile can be undone by a later plugin or an output option.
    // Assert against the real filesystem, after the write.
    writeBundle() {
      const missing = emitted.filter(
        (basename) => !fs.existsSync(path.join(outDir, assetsDir, basename)),
      );
      if (missing.length > 0) {
        this.error(
          `maplibre worker asset(s) missing from the build output: ${missing.join(', ')}.\n` +
            `  Expected them in ${path.join(outDir, assetsDir)} — something dropped the emitted\n` +
            `  files, and every map page would 404 at runtime.`,
        );
      }
    },
  };
}
