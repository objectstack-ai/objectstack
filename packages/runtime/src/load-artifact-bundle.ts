// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared artifact loader used by every code path that boots a kernel
 * from an `objectstack build` artifact:
 *
 *   - `FsAppBundleResolver`         — cloud / multi-environment file binding
 *   - `runtime-stack.ts:basePlugins` — single-environment local boot
 *   - `StandaloneStack`              — `objectstack serve --standalone`
 *   - `http-dispatcher.ts`           — in-flight artifact rebind
 *
 * Reads the JSON artifact (from a local path *or* an `http(s)://` URL) and,
 * for **local** artifacts only, if the bundle declares a sibling
 * `runtimeModule` (the ESM produced by `packages/cli/src/utils/build-runtime.ts`),
 * dynamic-imports it and merges its `functions` map onto the bundle so
 * declarative Hooks resolve their handlers at boot.
 *
 * For **remote** (`http(s)://`) artifacts the `runtimeModule` reference is
 * intentionally ignored — Node cannot dynamic-import arbitrary URLs and we
 * refuse to execute remote code by default. Remote artifacts are therefore
 * expected to be fully declarative (Hooks/Flows carry their bodies inline).
 *
 * Mutates the returned bundle in place. Returns `null` on read/parse
 * failure (callers may treat as "no bundle for this project yet").
 * Runtime-module load failures are logged but non-fatal — the bundle
 * is still returned, just without runtime functions.
 */

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface LoadArtifactBundleOptions {
    /** Optional log tag for warnings (defaults to `[loadArtifactBundle]`). */
    tag?: string;
    /** When true, an unwrapped `{ schemaVersion, metadata }` envelope is unwrapped. */
    unwrapEnvelope?: boolean;
    /** Optional fetch timeout in ms for `http(s)://` sources (default 15000). */
    fetchTimeoutMs?: number;
}

/** Returns true when `pathOrUrl` looks like an `http://` or `https://` URL. */
export function isHttpUrl(pathOrUrl: string): boolean {
    return /^https?:\/\//i.test(pathOrUrl);
}

/**
 * Read a JSON artifact from either a local file path or an `http(s)://` URL.
 * Returns the raw text body. Throws on network or filesystem failure.
 */
export async function readArtifactSource(
    pathOrUrl: string,
    opts: { fetchTimeoutMs?: number } = {},
): Promise<string> {
    if (isHttpUrl(pathOrUrl)) {
        const timeoutMs = opts.fetchTimeoutMs ?? 15_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(pathOrUrl, {
                redirect: 'follow',
                signal: controller.signal,
                headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' },
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} ${res.statusText} for ${pathOrUrl}`);
            }
            return await res.text();
        } finally {
            clearTimeout(timer);
        }
    }
    return readFile(pathOrUrl, 'utf-8');
}

export async function loadArtifactBundle(
    absArtifactPath: string,
    opts: LoadArtifactBundleOptions = {},
): Promise<any | null> {
    const tag = opts.tag ?? '[loadArtifactBundle]';
    const isUrl = isHttpUrl(absArtifactPath);
    let bundle: any;
    try {
        const raw = await readArtifactSource(absArtifactPath, { fetchTimeoutMs: opts.fetchTimeoutMs });
        const parsed = JSON.parse(raw);
        bundle = opts.unwrapEnvelope && parsed?.schemaVersion != null && parsed?.metadata !== undefined
            ? parsed.metadata
            : parsed;
    } catch (err: any) {
        // An ABSENT artifact is not a failure (#4085). The platform is a
        // development platform first: `os serve objectstack.config.ts` boots
        // from the config, `os migrate` reads metadata, and a freshly authored
        // project has no `dist/` at all until its first `os compile`. Shouting
        // "read FAILED" at those callers described a healthy state as a fault
        // and sent readers hunting for a build problem. A PRESENT-but-unusable
        // artifact (malformed JSON, bad permissions, HTTP error) is a real
        // fault and keeps the loud warning.
        if (err?.code === 'ENOENT') {
            // eslint-disable-next-line no-console
            console.log(
                `${tag} no compiled artifact at '${absArtifactPath}' — booting without one ` +
                `(run 'os compile' to build it)`,
            );
            return null;
        }
        // eslint-disable-next-line no-console
        console.warn(`${tag} artifact read FAILED: path='${absArtifactPath}' error=${err?.message ?? err}`);
        return null;
    }

    if (isUrl) {
        // Remote artifacts cannot dynamic-import a sibling ESM runtime module
        // safely (Node does not allow importing arbitrary URLs and we never
        // want to execute remote code by default). Hooks/flow handlers must
        // be carried in the JSON itself (declarative bodies, sandbox-eval).
        if (typeof bundle?.runtimeModule === 'string' && bundle.runtimeModule.length > 0) {
            // eslint-disable-next-line no-console
            console.warn(
                `${tag} ignoring runtimeModule='${bundle.runtimeModule}' for remote artifact ${absArtifactPath} ` +
                `(remote ESM imports are not supported; embed handlers in the JSON instead)`,
            );
            // Strip the reference so downstream code doesn't try to resolve it
            // as a local path against process.cwd().
            delete bundle.runtimeModule;
        }
        return bundle;
    }

    await mergeRuntimeModule(bundle, absArtifactPath, tag);
    return bundle;
}

export async function mergeRuntimeModule(bundle: any, artifactAbsPath: string, tag = '[loadArtifactBundle]'): Promise<void> {
    const ref = bundle?.runtimeModule;
    if (typeof ref !== 'string' || ref.length === 0) return;
    const moduleAbsPath = isAbsolute(ref) ? ref : resolvePath(dirname(artifactAbsPath), ref);
    try {
        const mod: any = await import(pathToFileURL(moduleAbsPath).href);
        const fns = (mod && (mod.functions ?? mod.default?.functions)) ?? null;
        if (!fns || typeof fns !== 'object') {
            // eslint-disable-next-line no-console
            console.warn(`${tag} runtime module '${moduleAbsPath}' exported no \`functions\` map`);
            return;
        }
        // The ARRAY form (`[{ name, handler: '<ref>', effect }]`) carries its
        // declaration exactly like the map form, but names itself by an entry's
        // `name` instead of by a map key. Rebuilding it as a map below would
        // attach the callable and drop everything standing beside it —
        // `effect: 'writes'` included — which is #4396's silent un-declaring in
        // the other spelling: the function still registers, still runs, and its
        // writes are still counted as none, so #4354's broken-sweep alert stays
        // quiet on the one run that needed it. Unreachable until #6238 let the
        // array form past the parse; reachable now, so it is handled here.
        if (Array.isArray(bundle.functions)) {
            const moduleFns = fns as Record<string, unknown>;
            const attached = new Set<string>();
            const mergedEntries = (bundle.functions as unknown[]).map((entry) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
                const record = entry as Record<string, unknown>;
                const name = typeof record.name === 'string' ? record.name : undefined;
                if (name === undefined) return entry;
                const fn = moduleFns[name];
                if (typeof fn !== 'function') return entry;
                attached.add(name);
                return { ...record, handler: fn };
            });
            // A module function the artifact declared no entry for still has to
            // register — the map branch keeps those, and dropping them here
            // would make the array form quietly ship fewer functions than it
            // was built with.
            for (const [name, fn] of Object.entries(moduleFns)) {
                if (typeof fn === 'function' && !attached.has(name)) mergedEntries.push({ name, handler: fn });
            }
            bundle.functions = mergedEntries;
            return;
        }
        const existing = (bundle.functions && typeof bundle.functions === 'object')
            ? bundle.functions as Record<string, unknown>
            : {};
        // The module supplies the CALLABLE; the JSON supplies what the function
        // DECLARED about itself (`{ handler: '<ref>', effect: 'writes' }`,
        // #4396). A plain overwrite would keep the first and drop the second,
        // silently un-declaring every writer on the artifact path.
        const merged: Record<string, unknown> = { ...existing };
        for (const [name, fn] of Object.entries(fns as Record<string, unknown>)) {
            const declared = merged[name];
            merged[name] =
                typeof fn === 'function' && declared && typeof declared === 'object' && !Array.isArray(declared)
                    ? { ...(declared as Record<string, unknown>), handler: fn }
                    : fn;
        }
        bundle.functions = merged;
    } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`${tag} runtime module load FAILED: path='${moduleAbsPath}' error=${err?.message ?? err}`);
    }
}
