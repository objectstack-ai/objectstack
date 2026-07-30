// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { bundleRequire } from 'bundle-require';
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
 * Load and bundle a config file using bundle-require.
 * Returns the resolved config object and load time.
 */
export async function loadConfig(source?: string): Promise<LoadedConfig> {
  const absolutePath = resolveConfigPath(source);
  const start = Date.now();

  const { mod } = await bundleRequire({
    filepath: absolutePath,
    external: BUNDLE_REQUIRE_EXTERNALS,
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
