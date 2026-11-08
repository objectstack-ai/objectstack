// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync } from 'node:fs';
import chalk from 'chalk';
import type { Plugin } from '@objectstack/core';
import {
  loadInstalledPlugins,
  pluginInstallationsFile,
  type InstalledPluginRefusal,
  type InstalledPluginsLoad,
} from '@objectstack/runtime';
import { isExitSignal } from './format.js';
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
 * bundle; this file's URL, so a plugin's bare `@objectstack/*` imports resolve
 * to the packages this CLI runs on; and `kernel.use` for each plugin that
 * passed, so dependency order and health checks are the kernel's.
 *
 * A refused plugin is printed by name, one `✗` line each, with the count on
 * the banner, and answered in `refused`; `os serve` then refuses the boot when
 * one of them cannot be ruled out as the crypto provider
 * (`refuseRefusedInstalledCryptoProviderPlugins`), and otherwise goes on
 * without it. A plugin refused here carries what the loader read it declares
 * (`declaredServices`), as one the loader refused after its import does.
 *
 * A plugin refused before its import had nothing of it evaluated; one refused
 * after it (`import_failed`, `not_a_plugin`, `signature_conflict`,
 * `plugin_name_taken`, `kernel_refused`) had its entry module's top-level code
 * run, and is not registered. An installed plugin never supersedes a plugin
 * this boot already registered under the same name (the kernel's same-name
 * rule would replace the host's): it is refused instead. A host plugin
 * registered LATER under the same name supersedes the installed one, with the
 * kernel's warning: the host's wins either way. Even a loader that throws
 * outright is one `✗` line (`loader_failed`).
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

/**
 * What a throw says, whatever was thrown: a plugin's getter or `init` can throw
 * anything, `undefined` and `null` included, and reading `.message` off that
 * would throw in the catch meant to name it.
 */
function thrownMessage(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error);
  } catch {
    return 'a value that cannot be printed';
  }
}

/** A refusal of an imported plugin, carrying what the loader read it declares. */
function withDeclaredServices(declaredServices: string[] | undefined, refusal: InstalledPluginRefusal): InstalledPluginRefusal {
  return declaredServices === undefined ? refusal : { ...refusal, declaredServices };
}

/**
 * The installed plugins of this project and environment, verified and imported
 * by the runtime's loader with this host's parts (module header), and nothing
 * registered: `null` when there is no installations file. A loader that throws
 * outright is one `loader_failed` refusal. `os serve` registers what this
 * answers ({@link registerInstalledPlugins}); a one-shot command reads it
 * without registering, with `leaveUninstallsPending`, so it removes nothing.
 */
export async function loadHostInstalledPlugins(
  opts: { leaveUninstallsPending?: boolean } = {},
): Promise<InstalledPluginsLoad | null> {
  const environmentId = pluginEnvironmentId();
  if (!existsSync(pluginInstallationsFile(environmentId))) return null;
  try {
    return await loadInstalledPlugins({
      environmentId,
      leaveUninstallsPending: opts.leaveUninstallsPending,
      resolveKeys: async (keyIds) => {
        const read = await readTrustedKeys(keyIds, { databaseUrl: process.env.OS_DATABASE_URL, json: false });
        if (!read.ok) throw new Error(read.message);
        return read.keys;
      },
      wrapBundle: async (bundle) => {
        const { AppPlugin } = await import('@objectstack/runtime');
        return new AppPlugin(bundle);
      },
      resolveHostPackagesFrom: import.meta.url,
    });
  } catch (error) {
    if (isExitSignal(error)) throw error;
    return {
      loaded: [],
      removed: [],
      disabled: [],
      refused: [{ id: '*', version: '*', error: 'loader_failed', message: `the installed-plugin loader failed (${thrownMessage(error)}); no installed plugin was loaded.` }],
    };
  }
}

export async function registerInstalledPlugins(input: {
  kernel: BootKernel;
  track(name: string): void;
}): Promise<InstalledPluginsBoot | null> {
  const result = await loadHostInstalledPlugins();
  if (result === null) return null;

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
  for (const { record, plugin, declaredServices } of result.loaded) {
    let name: string;
    try {
      name = String((plugin as { name?: unknown }).name ?? record.id);
    } catch (error) {
      out.refused.push(withDeclaredServices(declaredServices, { id: record.id, version: record.version, error: 'kernel_refused', message: `its plugin name cannot be read: ${thrownMessage(error)}` }));
      continue;
    }
    if (input.kernel.hasPlugin(name)) {
      out.refused.push(withDeclaredServices(declaredServices, {
        id: record.id,
        version: record.version,
        error: 'plugin_name_taken',
        message: `its plugin name '${name}' is a plugin this boot already registered, and an installed plugin does not replace one.`,
      }));
      continue;
    }
    try {
      await input.kernel.use(plugin as Plugin);
    } catch (error) {
      out.refused.push(withDeclaredServices(declaredServices, {
        id: record.id,
        version: record.version,
        error: 'kernel_refused',
        message: thrownMessage(error),
      }));
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
