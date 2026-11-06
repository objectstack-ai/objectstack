// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { findConfigPath, loadConfig } from './config.js';

/**
 * What `os generate` learned about the project's `manifest.namespace`.
 *
 *  - `no-config` — there is no `objectstack.config.{ts,js,mjs}` in the working
 *    directory, so there is no manifest and no namespace to apply. The command
 *    has always worked outside a project and still does.
 *  - `loaded` — the config loaded; `namespace` is its `manifest.namespace`, or
 *    `undefined` when the manifest declares none (the gate is skipped for such
 *    a stack, so no prefix is owed).
 *  - `load-failed` — a config exists and did not load. The namespace is then
 *    UNKNOWN, which is not the same as absent: the caller refuses rather than
 *    write a name the gate may refuse.
 */
export type ProjectNamespace =
  | { kind: 'no-config' }
  | {
    kind: 'loaded';
    configPath: string;
    namespace: string | undefined;
    /**
     * The stack the config evaluated to (#21325): `os generate` reads the
     * objects and flows a binding scaffold may bind from it, off the same load.
     */
    config: unknown;
  }
  | { kind: 'load-failed'; configPath: string; message: string };

/**
 * Read `manifest.namespace` from the project in `cwd` (default `process.cwd()`,
 * where `os generate` writes), from the stack the config EVALUATES to, through
 * {@link loadConfig}.
 *
 * ## One source, the gate's own
 *
 * The namespace-prefix gate (`validateNamespacePrefix` in `defineStack`,
 * reached by `os validate` / `os compile` through this same loader) judges
 * every `object.name` against `config.manifest.namespace` of the loaded stack.
 * This reads that value from that stack, so the prefix a scaffold is given and
 * the prefix it is then judged against cannot come from two places. It never
 * re-derives a namespace from the project directory or `package.json` name:
 * that is how `os init` CHOSE the value once, not where the value lives.
 */
export async function readProjectNamespace(cwd: string = process.cwd()): Promise<ProjectNamespace> {
  const configPath = findConfigPath(cwd);
  if (!configPath) return { kind: 'no-config' };

  try {
    const { config } = await loadConfig(configPath);
    const namespace = (config as { manifest?: { namespace?: unknown } } | undefined)?.manifest?.namespace;
    return {
      kind: 'loaded',
      configPath,
      namespace: typeof namespace === 'string' && namespace !== '' ? namespace : undefined,
      config,
    };
  } catch (error) {
    return {
      kind: 'load-failed',
      configPath,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Whether a package-authored metadata name carries the package's namespace
 * (ruling C on #30798): it IS the namespace (the namespace-named app,
 * ADR-0019), starts with `<namespace>_`, or starts with the platform-reserved
 * `sys_` — the exemption the object rule (`validateObjectNamespacePrefix`)
 * grants. A name that starts with `<namespace>.` carries it too: that is the
 * dotted shape `CapabilitySchema` documents (`billing.refund`), and the only
 * names whose charset admits a dot, so `showcase.export_data` in the
 * `showcase` package is already namespaced.
 *
 * ONE predicate for the two places the CLI asks it: `os lint`'s
 * `naming/namespace-prefix` judges a name with it, and `os generate` decides
 * with it whether the name it writes needs the prefix, so a scaffold is never
 * written in a spelling the lint then reports.
 */
export function carriesPackageNamespace(name: string, namespace: string): boolean {
  return name === namespace
    || name.startsWith(`${namespace}_`)
    || name.startsWith(`${namespace}.`)
    || name.startsWith('sys_');
}

/**
 * The non-object metadata name `os generate` writes: `shortName` as derived
 * when it already carries the namespace ({@link carriesPackageNamespace}) or
 * the project declares none, `${namespace}_${shortName}` otherwise. Never
 * doubled: `os g flow crm_onboard` under namespace `crm` writes
 * `crm_onboard_flow`.
 */
export function namespacedItemName(shortName: string, namespace: string | undefined): string {
  if (!namespace || carriesPackageNamespace(shortName, namespace)) return shortName;
  return `${namespace}_${shortName}`;
}
