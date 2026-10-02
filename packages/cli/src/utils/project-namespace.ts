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
