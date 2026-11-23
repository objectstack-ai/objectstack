// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plugins an app's stack lists that this kernel does not run — named, once
 * per boot, at `warn`.
 *
 * A stack's `plugins` are runtime ASSEMBLY instructions (`stack.zod.ts`, the
 * artifact envelope keys): what a host hands to `kernel.use()`. A compiled
 * artifact is inert JSON, so what `os build` writes there for a code plugin is
 * a plain descriptor (`{ name, version, dependencies, options }`), not anything
 * a loader could construct, and the runtime module it ships beside the JSON
 * exports the hook handlers (`functions`) only. Nothing on the artifact path
 * turns a descriptor back into a plugin, and nothing should: code and its
 * dependencies are distributed as a signed `.osplugin` (ADR-0025, layer L2), or
 * assembled by a host config. So an artifact booted on its own runs none of its
 * app's code plugins.
 *
 * That is correct. Doing it in silence is the defect: the build summary counts
 * the plugins, the boot lists the platform's plugins and not the app's, and
 * every service the missing plugins would have registered fails later and
 * somewhere else (an empty retrieval, a hook that finds no service). This is the
 * one place that knows both halves, the app's list and the kernel's table, so
 * it is where the absence is said.
 *
 * The judgment is per name, against the kernel's own plugin table: a host that
 * assembles the app's plugins itself (a config boot over the app's own compiled
 * output, or a host config that imports the artifact and appends them) has them
 * registered under those names, and is told nothing. The table is final by the
 * time this is read: the kernel refuses `use()` once bootstrap has begun.
 *
 * A functional degradation (a capability is absent, and the next caller of it
 * finds out), so `warn`, not `error` (AGENTS.md, "Degradation log levels").
 */

/**
 * The names a stack's `plugins` entry can be running under: a plugin's (or its
 * serialized descriptor's) `name`, and, for an entry with no `init`, the name
 * of the `AppPlugin` a host wraps such a bundle into (`materializeStackPlugin`,
 * `@objectstack/core`). Answers nothing for an entry that names no plugin.
 *
 * A string entry answers nothing too. It is a package specifier, and a host
 * that loads it registers whatever name the module's plugin carries, which the
 * specifier does not tell. So such an entry is never named as missing: this
 * says only what the kernel's table can confirm.
 */
function candidateNames(entry: unknown): { name: string; aliases: string[] } | undefined {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const record = entry as { name?: unknown; init?: unknown; manifest?: { id?: unknown } | null };
    const name = record.name;
    if (typeof name !== 'string' || name.length === 0) return undefined;
    if (typeof record.init === 'function') return { name, aliases: [] };
    const manifestId = record.manifest && typeof record.manifest.id === 'string' ? record.manifest.id : undefined;
    return { name, aliases: [`plugin.app.${manifestId ?? name}`] };
}

/**
 * The names of the entries of `declared` (a stack's `plugins`) that
 * `isRegistered` answers for under none of their names, in listed order, each
 * once. `undefined` (or anything not an array) lists nothing.
 */
export function findUnmountedDeclaredPlugins(
    declared: unknown,
    isRegistered: (name: string) => boolean,
): string[] {
    const missing: string[] = [];
    if (!Array.isArray(declared)) return missing;
    for (const entry of declared) {
        const candidate = candidateNames(entry);
        if (candidate === undefined) continue;
        if (isRegistered(candidate.name) || candidate.aliases.some(isRegistered)) continue;
        if (!missing.includes(candidate.name)) missing.push(candidate.name);
    }
    return missing;
}

/** The slice of a kernel this reads: its plugin table, by name. */
interface PluginTable {
    hasPlugin?: (name: string) => boolean;
    getPlugins?: () => Map<string, unknown>;
}

/** The slice of a plugin context this uses. */
interface DeclaredPluginsContext {
    getKernel?: () => unknown;
    logger: { warn: (message: string, meta?: Record<string, unknown>) => void };
}

/**
 * Warn once, naming every plugin the app's stack lists that this kernel does
 * not run. Silent when the stack lists none, when every one is registered, or
 * when the context exposes no plugin table to judge against (nothing is said
 * that the table could contradict).
 */
export function warnUnmountedDeclaredPlugins(
    ctx: DeclaredPluginsContext,
    declared: unknown,
    appId: string,
): string[] | undefined {
    if (!Array.isArray(declared) || declared.length === 0) return undefined;
    let table: PluginTable | undefined;
    try {
        table = (typeof ctx.getKernel === 'function' ? ctx.getKernel() : undefined) as PluginTable | undefined;
    } catch {
        table = undefined;
    }
    let isRegistered: ((name: string) => boolean) | undefined;
    if (typeof table?.hasPlugin === 'function') {
        isRegistered = (name) => table!.hasPlugin!(name);
    } else if (typeof table?.getPlugins === 'function') {
        const registered = table.getPlugins();
        isRegistered = (name) => registered.has(name);
    }
    if (isRegistered === undefined) return undefined;

    const missing = findUnmountedDeclaredPlugins(declared, isRegistered);
    if (missing.length === 0) return missing;

    ctx.logger.warn(
        `[AppPlugin] app '${appId}' lists ${missing.length} plugin(s) that are not running on this kernel: `
        + `${missing.map((n) => `'${n}'`).join(', ')}. A compiled artifact carries an app's metadata and hook `
        + 'handlers, not its code plugins, so every service those plugins register is absent here and '
        + 'whatever depends on them fails later. To run them, boot the app from its objectstack.config.ts, '
        + 'or from a host config that loads this artifact and lists the plugins in its own `plugins`, '
        + 'or package them as a plugin (os plugin build, then os plugin install).',
        { appId, plugins: missing },
    );
    return missing;
}
