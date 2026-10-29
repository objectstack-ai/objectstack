// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync } from 'node:fs';
import chalk from 'chalk';
import type { Plugin } from '@objectstack/core';
import {
  loadInstalledPlugins,
  pluginInstallationsFile,
  type InstalledPluginRefusal,
} from '@objectstack/runtime';
import { pluginEnvironmentId } from './plugin-install.js';
import { readTrustedKeys } from './plugin-trust-read.js';

/**
 * `os serve`'s half of the boot-time loader for plugins `os plugin install`
 * installed (ADR-0025 §3.5 M1). Called once, after the config's `plugins` are
 * registered and before the kernel bootstraps, which takes no plugin after it
 * starts.
 *
 * The verification is `@objectstack/runtime`'s `loadInstalledPlugins`; this
 * supplies the host's parts: the environment's trusted keys, read once through
 * the read-only one-shot boot `os plugin install` reads them through
 * (`./plugin-trust-read.ts`, against `OS_DATABASE_URL` or the project
 * database, as the `os plugin` commands resolve it); `AppPlugin` for a plain
 * bundle; and `kernel.use` for each plugin that passed, so dependency order
 * and health checks are the kernel's.
 *
 * A refused plugin does not stop the boot — the config `plugins` loop's
 * precedent — but nothing of it runs and it is printed by name, one `✗` line
 * each, with the count on the banner. An installed plugin never supersedes a
 * plugin this boot already registered under the same name (the kernel's
 * same-name rule would replace the host's): it is refused instead.
 *
 * No installations file for this project and environment: nothing is read,
 * and the boot is as it was.
 */
export interface InstalledPluginsBoot {
  loaded: string[];
  refused: InstalledPluginRefusal[];
}

interface BootKernel {
  use(plugin: Plugin): Promise<unknown>;
  hasPlugin(name: string): boolean;
}

export async function registerInstalledPlugins(input: {
  kernel: BootKernel;
  track(name: string): void;
}): Promise<InstalledPluginsBoot | null> {
  const environmentId = pluginEnvironmentId();
  if (!existsSync(pluginInstallationsFile(environmentId))) return null;

  const result = await loadInstalledPlugins({
    environmentId,
    resolveKeys: async (keyIds) => {
      const read = await readTrustedKeys(keyIds, { databaseUrl: process.env.OS_DATABASE_URL, json: false });
      if (!read.ok) throw new Error(read.message);
      return read.keys;
    },
    wrapBundle: async (bundle) => {
      const { AppPlugin } = await import('@objectstack/runtime');
      return new AppPlugin(bundle);
    },
  });

  const out: InstalledPluginsBoot = { loaded: [], refused: [...result.refused] };
  for (const { record, kept } of result.removed) {
    console.error(
      chalk.dim(
        `  Uninstalled plugin ${record.id}@${record.version}`
          + (kept ? ` (its directory ${record.dir} is kept: another project here still records it)` : ''),
      ),
    );
  }
  for (const record of result.disabled) {
    console.error(chalk.dim(`  Installed plugin ${record.id}@${record.version} is disabled (os plugin enable ${record.id})`));
  }
  for (const { record, plugin } of result.loaded) {
    const name = String((plugin as { name?: unknown }).name ?? record.id);
    if (input.kernel.hasPlugin(name)) {
      out.refused.push({
        id: record.id,
        version: record.version,
        error: 'plugin_name_taken',
        message: `its plugin name '${name}' is a plugin this boot already registered, and an installed plugin does not replace one.`,
      });
      continue;
    }
    try {
      await input.kernel.use(plugin as Plugin);
    } catch (error) {
      out.refused.push({
        id: record.id,
        version: record.version,
        error: 'kernel_refused',
        message: (error as Error).message,
      });
      continue;
    }
    if (record.trustUnsigned) {
      console.error(
        chalk.yellow(
          `  ⚠ Installed plugin ${record.id}@${record.version} loaded UNSIGNED (installed with --trust-unsigned). `
            + 'Nothing proves who built it. Dev use only.',
        ),
      );
    }
    input.track(name);
    out.loaded.push(`${record.id}@${record.version}`);
  }
  for (const r of out.refused) {
    console.error(chalk.red(`  ✗ Refused installed plugin ${r.id}@${r.version} (${r.error}): ${r.message}`));
  }
  return out;
}
