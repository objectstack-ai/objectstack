// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Default host config — built-in fallback used by `objectstack start`
 * (and `objectstack serve`) when the project does NOT ship an explicit
 * `objectstack.config.ts`.
 *
 * Goal: an `objectstack build` artifact (`dist/objectstack.json`) is
 * fully self-describing — it carries the manifest, objects, views,
 * flows and a `requires: [...]` capability list. That should be enough
 * to boot a runtime, with zero hand-written host code.
 *
 * Boot mode: **standalone only**. This module deliberately has zero
 * dependency on the cloud distribution — cloud / multi-environment hosts
 * ship their own bootstrap and write their own `objectstack.config.ts`.
 *
 * Resolution order for the artifact path:
 *   1. `options.artifactPath` (explicit caller override)
 *   2. `OS_ARTIFACT_PATH` env var (file path **or** `http(s)://` URL)
 *   3. `<cwd>/dist/objectstack.json`
 *
 * The returned object is shaped like the result of `defineStack()` —
 * `{ plugins, api, requires, objects, manifest }` — so the CLI can use
 * it interchangeably with a user-authored stack config.
 */

import { resolve as resolvePath } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createStandaloneStack, resolveObjectStackHome, type StandaloneStackConfig, type StandaloneStackResult } from './standalone-stack.js';
import { isHttpUrl } from './load-artifact-bundle.js';

export interface DefaultHostConfigOptions extends StandaloneStackConfig {
    /**
     * When true (the default), throws if no artifact source can be
     * resolved (no explicit `artifactPath`, no `OS_ARTIFACT_PATH` env,
     * and `<cwd>/dist/objectstack.json` does not exist).
     *
     * Set to false to allow booting an empty kernel — useful for tests
     * that want to assemble plugins manually after the stack is built.
     */
    requireArtifact?: boolean;
}

export type DefaultHostConfigResult = StandaloneStackResult;

/**
 * Resolve the artifact source for a default-host boot.
 *
 * Returns the explicit override, then `OS_ARTIFACT_PATH`, then the
 * canonical `<cwd>/dist/objectstack.json` if it exists on disk.
 * Returns `undefined` if none of these are available.
 *
 * URLs (`http(s)://`) are returned as-is — they are validated lazily by
 * the loader, since we cannot stat a remote resource cheaply.
 */
export function resolveDefaultArtifactPath(
    explicitPath?: string,
    cwd: string = process.cwd(),
): string | undefined {
    const candidate = explicitPath
        ?? process.env.OS_ARTIFACT_PATH
        ?? resolvePath(cwd, 'dist/objectstack.json');

    if (isHttpUrl(candidate)) return candidate;
    if (explicitPath || process.env.OS_ARTIFACT_PATH) return candidate;
    return existsSync(candidate) ? candidate : undefined;
}

/**
 * Build a `defineStack()`-shaped config from an `objectstack build`
 * artifact, with no `objectstack.config.ts` required.
 *
 * @example
 *   // packages/cli/src/commands/serve.ts
 *   if (!fs.existsSync(absolutePath)) {
 *       config = await createDefaultHostConfig();
 *   }
 */
export async function createDefaultHostConfig(
    options: DefaultHostConfigOptions = {},
): Promise<DefaultHostConfigResult> {
    const { requireArtifact = true, ...standaloneOpts } = options;

    let resolvedArtifact = resolveDefaultArtifactPath(standaloneOpts.artifactPath);
    if (!resolvedArtifact && requireArtifact) {
        throw new Error(
            '[createDefaultHostConfig] No artifact source available. ' +
            'Set OS_ARTIFACT_PATH (file path or http(s):// URL), ' +
            'place the artifact at <cwd>/dist/objectstack.json, ' +
            'or pass `{ artifactPath: ... }` explicitly. ' +
            'To boot an empty kernel anyway, pass `{ requireArtifact: false }`.',
        );
    }

    // A NAMED artifact that is not there is a broken instruction, and this is
    // the boot with no `objectstack.config.ts` — the artifact IS the whole
    // deployment, so there is nothing else to serve. Fail loudly.
    //
    // The distinction that matters is **named vs conventional**, not the errno.
    // `<cwd>/dist/objectstack.json` missing means "not compiled yet", which is a
    // healthy state a development platform must boot from (#4085) — and
    // `resolveDefaultArtifactPath` already returns `undefined` for it, so it
    // never reaches here. But `OS_ARTIFACT_PATH` / `{ artifactPath }` are
    // returned WITHOUT an existence check (validated lazily by the loader), and
    // since #4110 made an absent artifact non-fatal all the way down —
    // `loadArtifactBundle` logs and returns null, `MetadataPlugin` starts
    // empty — that laziness turned a typo'd path into a silent empty boot:
    // `OS_ARTIFACT_PATH=/nope os serve` printed "booting from artifact", then
    // "Server is ready", and named the missing path NOWHERE in its output
    // (serve's boot-quiet window drops the loader's calm line). Checked here so
    // the fix lands where the intent is known, leaving the loader's tolerance
    // intact for the config-boot path that needs it.
    const namedBy = standaloneOpts.artifactPath
        ? '`artifactPath`'
        : (process.env.OS_ARTIFACT_PATH ? 'OS_ARTIFACT_PATH' : null);
    if (
        namedBy
        && resolvedArtifact
        && !isHttpUrl(resolvedArtifact)
        && !existsSync(resolvedArtifact)
    ) {
        throw new Error(
            `[createDefaultHostConfig] The artifact named by ${namedBy} does not exist: `
            + `"${resolvedArtifact}". Run 'os compile' to build it, correct the path, `
            + `or unset ${namedBy} to boot from <cwd>/dist/objectstack.json.`,
        );
    }

    // Empty-boot path: synthesize a minimal artifact stub inside the
    // ObjectStack home directory so MetadataPlugin has a real file to
    // read (and to watch for marketplace installs that land later).
    if (!resolvedArtifact && !requireArtifact) {
        const home = resolveObjectStackHome();
        const stubPath = resolvePath(home, 'dist/objectstack.json');
        if (!existsSync(stubPath)) {
            mkdirSync(resolvePath(stubPath, '..'), { recursive: true });
            writeFileSync(
                stubPath,
                JSON.stringify(
                    {
                        manifest: {
                            id: 'com.objectstack.empty',
                            name: 'empty',
                            version: '0.0.0',
                            type: 'app',
                            description: 'Empty starter kernel — install apps via the Studio marketplace.',
                        },
                        objects: [],
                        views: [],
                        apps: [],
                        flows: [],
                        requires: [],
                    },
                    null,
                    2,
                ),
                'utf8',
            );
        }
        resolvedArtifact = stubPath;
    }

    return createStandaloneStack({
        ...standaloneOpts,
        artifactPath: resolvedArtifact,
    });
}
