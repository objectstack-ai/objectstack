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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { createStandaloneStack, resolveObjectStackHome, type StandaloneStackConfig, type StandaloneStackResult } from './standalone-stack.js';
import { isHttpUrl } from './load-artifact-bundle.js';
import { makeDirectorySync } from './make-directory.js';

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
    const stubPath = resolvePath(resolveObjectStackHome(), 'dist/objectstack.json');
    if (!resolvedArtifact && !requireArtifact) {
        ensureEmptyBootStub(stubPath);
        resolvedArtifact = stubPath;
    } else if (
        resolvedArtifact
        && !isHttpUrl(resolvedArtifact)
        && resolvePath(resolvedArtifact) === stubPath
        && existsSync(stubPath)
    ) {
        // The stub is reached NAMED on every `os start` after the first: the
        // supervisor resolves `<home>/dist/objectstack.json` as an artifact
        // rung and hands it down as `artifactPath`, so the branch above never
        // runs again. Measured (#29937): a stub an older CLI wrote kept its
        // missing range, and its warning, on every later boot until refreshed
        // here. `ensureEmptyBootStub` touches the file only while it is still
        // the stub; an app artifact an operator placed at this path is left
        // alone.
        ensureEmptyBootStub(stubPath);
    }

    return createStandaloneStack({
        ...standaloneOpts,
        artifactPath: resolvedArtifact,
    });
}

/** The manifest id of the stub {@link ensureEmptyBootStub} writes. */
export const EMPTY_BOOT_STUB_ID = 'com.objectstack.empty';

/**
 * The protocol range the empty-boot stub declares: this runtime's own major.
 *
 * The stub is the platform's own package, written by the runtime that boots
 * it, so it is compatible by construction. Without a range the ADR-0087
 * handshake answered `no-range` and the boot diagnostics of `os start` in an
 * empty directory (the docs' one-line Community quickstart) warned the
 * newcomer about a package they never wrote and cannot find (#29937).
 */
function emptyBootStubProtocolRange(): string {
    return `^${PROTOCOL_MAJOR}`;
}

/**
 * Make sure the empty-boot stub artifact at `stubPath` exists and declares
 * this runtime's protocol range.
 *
 * - Absent → written, with `engines.protocol`.
 * - Present, still the stub (`manifest.id` is {@link EMPTY_BOOT_STUB_ID}),
 *   but its range is missing or names another major → only
 *   `manifest.engines.protocol` is rewritten; every other byte of meaning is
 *   kept. That covers the stub an older CLI wrote with no `engines` at all,
 *   and the one a CLI of the previous major stamped: left alone, that range
 *   would be refused as `OS_PROTOCOL_INCOMPATIBLE` the day the runtime moves
 *   to the next major, failing the very boot that has nothing in it.
 * - Present and not the stub, or not readable as JSON → left alone. This
 *   function owns only what it wrote; the loader reports anything else.
 */
export function ensureEmptyBootStub(stubPath: string): void {
    const range = emptyBootStubProtocolRange();
    if (!existsSync(stubPath)) {
        // Bounded (#23858): an `OS_HOME` that cannot be made is refused
        // here, at once, with the OS's code and the path — never a loop.
        makeDirectorySync(resolvePath(stubPath, '..'));
        writeFileSync(
            stubPath,
            JSON.stringify(
                {
                    manifest: {
                        id: EMPTY_BOOT_STUB_ID,
                        name: 'empty',
                        version: '0.0.0',
                        type: 'app',
                        description: 'Empty starter kernel — install apps via the Studio marketplace.',
                        engines: { protocol: range },
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
        return;
    }

    let stub: unknown;
    try {
        stub = JSON.parse(readFileSync(stubPath, 'utf8'));
    } catch {
        return;
    }
    const manifest = (stub as { manifest?: unknown } | null)?.manifest;
    if (!manifest || typeof manifest !== 'object' || (manifest as { id?: unknown }).id !== EMPTY_BOOT_STUB_ID) return;
    const engines = (manifest as { engines?: unknown }).engines;
    const engineBag = engines && typeof engines === 'object' && !Array.isArray(engines)
        ? engines as Record<string, unknown>
        : {};
    if (engineBag.protocol === range) return;
    (manifest as Record<string, unknown>).engines = { ...engineBag, protocol: range };
    writeFileSync(stubPath, JSON.stringify(stub, null, 2), 'utf8');
}
