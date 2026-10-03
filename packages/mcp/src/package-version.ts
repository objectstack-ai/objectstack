// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one place `@objectstack/mcp` learns its own version.
 *
 * `MCPServerPluginOptions.version` is published as "Defaults to package
 * version", and the MCP `initialize` answer carries that string as
 * `serverInfo.version`. Both defaults used to be the literal `'1.0.0'` (the
 * plugin's own, and `MCPServerRuntime`'s), so every deployment that built the
 * plugin without options answered `1.0.0` while the package was somewhere
 * else entirely, and the registry listing in `server.json` disagreed with
 * every running server. Every default now reads this one value; an explicit
 * `version` option still overrides it.
 *
 * The read is the same shape `@objectstack/runtime`
 * (`packages/runtime/src/runtime-version.ts`) and `@objectstack/metadata-protocol`
 * (`packages/metadata-protocol/src/discovery-version.ts`) already use for their
 * own manifests: `createRequire(import.meta.url)` against `../package.json`,
 * which sits one directory above both `src/` (vitest) and the bundled
 * `dist/index.{js,cjs}` (tsup, single entry, `splitting: false`), so one path
 * resolves the same manifest from every shape. Its CJS half rests on
 * `shims: true` in this package's `tsup.config.ts` (see the comment there).
 */

import { createRequire } from 'node:module';

function readOwnVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `@objectstack/mcp`'s own installed version, from its `package.json`;
 * `undefined` when the manifest cannot be read (a bundle that no longer has the
 * file beside it).
 *
 * This is what the kernel plugin's own `version` takes, and the reason it stays
 * `undefined` rather than becoming a placeholder string: both kernels refuse a
 * plugin whose `version` is not SemVer 2.0.0, so any non-version placeholder
 * would turn an unreadable manifest into an MCP plugin that never loads. An
 * absent `version` is accepted, and the kernel supplies its own `0.0.0`.
 */
export const PACKAGE_VERSION: string | undefined = readOwnVersion();

/**
 * What an MCP server reports as `serverInfo.version` when the caller names none:
 * the package version, or `'unknown'` when the manifest cannot be read —
 * honest about not knowing, rather than a plausible-looking version a client
 * could mistake for real identity. `serverInfo.version` is a free string on the
 * wire, so unlike {@link PACKAGE_VERSION} it has no grammar to satisfy.
 */
export const DEFAULT_SERVER_VERSION: string = PACKAGE_VERSION ?? 'unknown';
