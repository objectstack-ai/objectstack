// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/types/node` — the **node-only** slice of the shared utilities.
 *
 * WHY A SUBPATH AND NOT THE ROOT EXPORT. `@objectstack/types` is a dependency of
 * `@objectstack/hono`, whose whole reason to exist is "edge-compatible REST API
 * server for Cloudflare Workers, Deno, Bun, and Node" — and of the plugin/service
 * layer a `LiteKernel` boots on Workers. The root entry (`src/index.ts`) reaches
 * **zero** `node:` builtins today, and that is a property those consumers depend
 * on: a Workers bundle that pulls in `node:module` fails to build (or dies at
 * first call) even when nothing ever invokes it. Everything here needs
 * `node:module` / `node:url` by definition — it exists to drive Node's own
 * resolver — so it lives behind its own entry point instead.
 *
 * The isolation is structural, not conventional: `tsup` builds `src/index.ts` and
 * `src/node.ts` as separate entries with `splitting: false`, so the root bundle
 * contains no reference to this file, and `node-isolation.test.ts` fails the
 * build if anything reachable from the root ever imports a `node:` builtin. Same
 * arrangement `@objectstack/metadata` already ships for `./node`.
 *
 * ── What lives here ──────────────────────────────────────────────────────────
 *
 * Resolving optional packages from the **host app**, not from the framework
 * package doing the importing.
 *
 * Node ESM resolves a bare `import('pkg')` against the **importer's own
 * realpath**. Framework packages (the CLI, `@objectstack/verify`,
 * `@objectstack/dogfood`) are reached through `link:`/workspace dependencies, so
 * their realpath is inside the *framework* workspace — a bare import from any of
 * them can only ever see packages installed in the framework's own
 * `node_modules`. Every package that lives OUTSIDE that workspace and is supplied
 * by the app being served, verified or tested — a cloud-private package such as
 * `@objectstack/organizations` or `@objectstack/service-ai-studio`, or anything a
 * customer installs into their own project — is therefore invisible to a bare
 * import, no matter what the host app declares in its `package.json`
 * (cloud#1013: `objectstack serve` could never load the enterprise multi-org
 * runtime, so every self-hosted walled-posture deployment hit the ADR-0093 D5
 * fail-fast and exited 1; framework#4700: `bootStack({ multiTenant: true })` told
 * apps to install a package they had already installed, and the dogfood
 * multi-org probes were constant-false).
 *
 * The fix is to resolve from the host app's root and import the resolved
 * absolute path. The importing package's own resolution stays as the fallback,
 * for the framework-owned packages it depends on and the host does not declare.
 *
 * Resolution failure is the ONLY thing that falls back. A package the host
 * resolves but that throws while it evaluates is a genuine crash and propagates
 * unchanged: re-importing it bare would replace the real cause with a
 * `MODULE_NOT_FOUND`, which every caller here classifies as "not installed" —
 * turning a broken package into a silent skip (or, on the organizations path,
 * into a fatal message telling the operator to install what is already there).
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Imports a package as the host app would see it.
 *
 * `any` is the module namespace of a package this repo does not compile against
 * (it is not a dependency of the importing package at all) — every call site
 * reads an export off it dynamically, exactly as the bare `import()` it replaces
 * did.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HostImporter = (pkg: string) => Promise<any>;

/**
 * A `require` anchored at the **host app's** `package.json` — i.e. the project
 * `objectstack serve` was invoked in, or the app `bootStack` is verifying, whose
 * `node_modules` carries the packages it declares.
 *
 * @param hostRoot Directory holding the host app's `package.json` (default: the
 * process CWD, which is where the CLI reads `objectstack.config.ts` from too).
 */
export function createHostRequire(hostRoot: string = process.cwd()): NodeRequire {
  return createRequire(join(hostRoot, 'package.json'));
}

/**
 * Build an importer that resolves from the host app first, then falls back to
 * the importing package's own resolution.
 *
 * @param hostRequire Reuse an existing host `require` (callers usually also need
 * it to read the host `package.json`); defaults to one anchored at the CWD.
 */
export function createHostImporter(
  hostRequire: NodeRequire = createHostRequire(),
): HostImporter {
  return async (pkg: string): Promise<any> => {
    let resolved: string;
    try {
      resolved = hostRequire.resolve(pkg);
    } catch {
      // Invisible to the host app — try the importing package's own
      // dependencies. A package neither can see throws MODULE_NOT_FOUND from
      // here, which is what the callers' "missing vs crashed" classification
      // expects.
      return import(/* webpackIgnore: true */ pkg);
    }
    return import(pathToFileURL(resolved).href);
  };
}
