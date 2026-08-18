// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'path';
import fs from 'fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { bundleRequire } from 'bundle-require';
import type { Plugin } from 'esbuild';
import { printError } from './format.js';

export interface LoadedConfig {
  config: any;
  absolutePath: string;
  duration: number;
}

/**
 * Keep workspace packages and known native/driver deps external so they
 * are resolved at runtime via real Node ESM dynamic imports. Bundling
 * them through esbuild collapses each package's `createRequire(import.meta.url)`
 * chain into inline `require(...)` calls that throw in pure-ESM mode.
 *
 * Shared between `loadConfig()` and `serve.ts`'s direct `bundleRequire` call.
 */
export const BUNDLE_REQUIRE_EXTERNALS: (string | RegExp)[] = [
  /^@objectstack\//,
  'sql.js',
  'knex',
  'better-sqlite3',
  'pg',
  'mysql',
  'mysql2',
  'mongodb',
  'tedious',
  'oracledb',
  'sqlite3',
  'libsql',
  '@libsql/client',
];

/**
 * Resolve the config file path. Supports:
 * - explicit path (objectstack.config.ts)
 * - auto-detection (searches for objectstack.config.{ts,js,mjs})
 */
export function resolveConfigPath(source?: string): string {
  if (source) {
    const abs = path.resolve(process.cwd(), source);
    if (!fs.existsSync(abs)) {
      printError(`Config file not found: ${chalk.white(abs)}`);
      console.log('');
      console.log(chalk.dim('  Hint: Run this command from a directory with objectstack.config.ts'));
      console.log(chalk.dim('  Or specify the path: objectstack <command> path/to/config.ts'));
      process.exit(1);
    }
    return abs;
  }

  // Auto-detect
  const candidates = [
    'objectstack.config.ts',
    'objectstack.config.js',
    'objectstack.config.mjs',
  ];

  for (const candidate of candidates) {
    const abs = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(abs)) return abs;
  }

  printError('No objectstack.config.{ts,js,mjs} found in current directory');
  console.log('');
  console.log(chalk.dim('  Hint: Run `objectstack init` to create a new project'));
  process.exit(1);
}

/**
 * Every `@objectstack/spec` entrypoint an authored config can reach the
 * `define*` helpers through — the root and every subpath export. Real projects
 * use both: the example apps import `defineView`/`defineApp` from
 * `@objectstack/spec/ui` and `defineHook`/`defineDatasource` from
 * `@objectstack/spec/data`, so a shim that knew only the root package would
 * cover the smaller half of the authored surface.
 */
const SPEC_MODULE_RE = /^@objectstack\/spec(?:\/[\w./-]+)?$/;

/** esbuild namespace the authored-source shim modules live in. */
const AUTHORED_SOURCE_NAMESPACE = 'objectstack-authored-source';

/** `defineStack`, `defineView`, … — the authoring helpers, by naming convention. */
const DEFINE_HELPER_RE = /^define[A-Z]/;

/**
 * The `define*` helpers a given `@objectstack/spec` entrypoint exports, read
 * from the copy **the config itself would import** (resolved from the config's
 * own directory, not the CLI's).
 *
 * Returns `[]` — i.e. "shim nothing" — when the entrypoint cannot be resolved
 * or imported. That is the safe direction: an unshimmed load is exactly
 * today's behaviour, so a project the enumeration cannot read is no worse off
 * than before.
 */
async function defineHelpersOf(specifier: string, requireFromConfig: NodeRequire): Promise<string[]> {
  try {
    const resolved = requireFromConfig.resolve(specifier);
    const ns = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
    return Object.keys(ns).filter((k) => DEFINE_HELPER_RE.test(k) && typeof ns[k] === 'function');
  } catch {
    return [];
  }
}

/**
 * Load an authored config **as authored**, for the one consumer whose input is
 * a source the CURRENT schema is expected to refuse: the `os migrate meta`
 * codemod (#9418).
 *
 * ## The defect this exists to close
 *
 * A retired authorable key is a `retiredKey()` tombstone — `z.never()` carrying
 * the upgrade prescription — so the current schema does not strip it, it
 * REJECTS it. Every `define*` helper in `@objectstack/spec` is a
 * `Schema.parse(config)`, and a real `objectstack.config.ts` calls them: `os
 * init` scaffolds `export default defineStack({ … })`, and larger projects
 * spread `defineView` / `defineAgent` / `defineFlow` across per-artifact
 * modules. So the rejection happens while the config MODULE is being evaluated,
 * inside `bundleRequire` — before `os migrate meta` has run a line of its own.
 *
 * The CLI never had a validation step to reorder: the gate lives in the loaded
 * module. That made the codemod refuse the only input class it exists for, and
 * the refusal it printed was the prescription telling the author to run it —
 * `Run \`os migrate meta --from <N>\`…` ships 144 times across 39 files under
 * `packages/spec/src`, so the upgrade path closed a loop on itself.
 *
 * ## What the shim does
 *
 * Each `@objectstack/spec` entrypoint the config imports is replaced by a
 * generated module that re-exports the real one and wraps its `define*`
 * helpers as **try-real-then-authored**:
 *
 * ```js
 * export const defineView = (...authored) => {
 *   try { return realDefineView(...authored); } catch { return authored[0]; }
 * };
 * ```
 *
 * The narrowness is the point, and it is what keeps this a restoration rather
 * than a widening of what the command accepts:
 *
 *  - **A source that loads today loads identically.** The real helper runs, so
 *    its defaults and transforms still apply (`defineForm` moves `schemaId`
 *    into `data`, `defineStack` merges actions into objects, …). Nothing about
 *    the existing happy path is re-decided.
 *  - **A source the current schema refuses reaches the chain as authored** —
 *    which is precisely the codemod's input. `defineX(config: z.input<typeof
 *    XSchema>)` means the authored argument is by construction a shape
 *    `XSchema` accepts, so handing it on unparsed yields a well-formed
 *    authoring tree rather than an ad-hoc one.
 *  - **Validation is not skipped, it is moved after the conversion.** The
 *    command still parses the MIGRATED stack through
 *    `ObjectStackDefinitionSchema` and reports `schemaValid`, so a source that
 *    is broken for reasons the chain cannot fix is still reported as broken —
 *    just after the codemod has done the part it can.
 *
 * A swallowed verdict is announced on **stderr** rather than dropped: the
 * author deserves to know an artifact bypassed the parse, and stderr keeps a
 * `--json` run's stdout a single parseable document.
 *
 * ⚠️ Deliberately NOT the default for `loadConfig()`. Every other command —
 * `os build`, `os validate`, `os serve` — must keep hearing the rejection: the
 * tombstone IS their upgrade channel. Only the codemod is entitled to read
 * past it.
 */
function authoredSourcePlugin(configPath: string): Plugin {
  const requireFromConfig = createRequire(configPath);
  return {
    name: 'objectstack:authored-source',
    setup(build) {
      build.onResolve({ filter: SPEC_MODULE_RE }, (args) => {
        // The shim re-exports the SAME specifier it stands in for. Left to
        // resolve normally that import would land back here and shim itself
        // forever, so inside the namespace the specifier is handed straight to
        // the runtime — which is also what keeps `__real` the project's own
        // copy of spec rather than the CLI's.
        if (args.namespace === AUTHORED_SOURCE_NAMESPACE) {
          return { path: args.path, external: true };
        }
        return { path: args.path, namespace: AUTHORED_SOURCE_NAMESPACE };
      });

      build.onLoad({ filter: /.*/, namespace: AUTHORED_SOURCE_NAMESPACE }, async (args) => {
        const helpers = await defineHelpersOf(args.path, requireFromConfig);
        const spec = JSON.stringify(args.path);
        const lines = [
          `import * as __real from ${spec};`,
          `export * from ${spec};`,
        ];
        for (const name of helpers) {
          lines.push(
            `export const ${name} = (...authored) => {`,
            `  try {`,
            `    return __real.${name}(...authored);`,
            `  } catch (error) {`,
            `    console.warn(`,
            `      '[authored-source] ' + ${JSON.stringify(name)} + '(): the current schema refuses this '`,
            `      + 'artifact, so it is handed to the migration chain exactly as authored. '`,
            `      + ((error && error.message) || String(error)),`,
            `    );`,
            `    return authored[0];`,
            `  }`,
            `};`,
          );
        }
        return { contents: lines.join('\n'), loader: 'js' };
      });
    },
  };
}

export interface LoadConfigOptions {
  /**
   * Read the config as AUTHORED rather than as the current schema would have
   * it — see {@link authoredSourcePlugin}. Set by `os migrate meta` only.
   *
   * @default false
   */
  authoredSource?: boolean;
}

/**
 * Load and bundle a config file using bundle-require.
 * Returns the resolved config object and load time.
 */
export async function loadConfig(source?: string, options?: LoadConfigOptions): Promise<LoadedConfig> {
  const absolutePath = resolveConfigPath(source);
  const start = Date.now();

  const { mod } = await bundleRequire({
    filepath: absolutePath,
    external: BUNDLE_REQUIRE_EXTERNALS,
    ...(options?.authoredSource
      ? { esbuildOptions: { plugins: [authoredSourcePlugin(absolutePath)] } }
      : {}),
  });

  const baseConfig = mod.default || mod;
  if (!baseConfig) {
    throw new Error(`No default export found in ${path.basename(absolutePath)}`);
  }

  // Preserve named exports (e.g. the `onEnable` runtime hook and `functions`)
  // alongside the default-exported stack. Module-namespace named exports are
  // otherwise dropped when we unwrap `mod.default`, which prevents AppPlugin
  // from invoking runtime hooks.
  const config = (baseConfig === mod || mod.default == null)
    ? baseConfig
    : (() => {
        const merged: any = { ...baseConfig };
        for (const key of Object.keys(mod)) {
          if (key === 'default' || key in merged) continue;
          merged[key] = (mod as any)[key];
        }
        return merged;
      })();

  return {
    config,
    absolutePath,
    duration: Date.now() - start,
  };
}

/**
 * Check whether a file exists at the given path (relative to cwd).
 */
export function configExists(name: string = 'objectstack.config.ts'): boolean {
  return fs.existsSync(path.resolve(process.cwd(), name));
}
